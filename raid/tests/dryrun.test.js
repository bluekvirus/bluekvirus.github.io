import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';
import { createDirector, MISSION_LIMIT } from '../sim/director.js';
import { createSquad } from '../sim/squad.js';
import { rangeOf, COMBAT } from '../sim/combat.js';

// End-to-end missions: director + squad driven together, exactly as main.js
// drives them (director first, then squad, so the squad executes the objective
// the director has just chosen rather than a one-tick-stale one).
//
// This file is also where the anti-hang guarantees that used to live in
// orders.test.js came to rest at the phase D cutover. orders.js's leg
// watchdogs, its reissue-exhaustion escape and its scripted leg sequence are
// all gone, but the properties those mechanisms existed to protect are not:
// a mission must always resolve, no agent may be left frozen short of its
// goal, and an agent that only oscillates must score as badly as one standing
// perfectly still. Each of those cost multiple fix rounds to find the first
// time. They are re-measured here against the new modules rather than
// retired with the old ones.

// The harness ceiling must sit ABOVE the director's own MISSION_LIMIT clock,
// not below it. At 7200 (the pre-cutover value) it sat below the then 9600-tick
// clock, so `director.result` would still be null when the loop gave up and
// every genuine clock 'timeout' verdict would have been misreported as
// "mission never resolved" — the one verdict this harness exists to be able
// to observe would have been unobservable. 12600 cleared 9600 with 1.3x margin.
//
// Task 5 raised MISSION_LIMIT 9600 -> 12000 (see director.js for the
// before/after measurement behind that number), so this is raised alongside
// it, 12600 -> 15600, keeping the same 1.3x margin over the clock it exists to
// sit above rather than letting the two drift into an accidental near-tie.
//
// This constant is a test-harness loop bound, not a `SQUAD` or director
// constant, so raising it sits outside the letter of Task 5's tuning scope
// (which named only those two). It is called out here as a deliberate,
// recorded deviation rather than a routine tuning edit: it MUST move in
// lockstep with MISSION_LIMIT specifically because it sits above that clock
// (see the paragraph above) — leaving it at 12600 would recreate the exact
// failure this comment already describes, a harness that gives up before the
// clock does and launders a real `timeout` into "mission never resolved."
const MAX_TICKS = 15600;

// Mirrors world.js's own two "legitimately holding position because of
// combat" cases exactly (see the tick() branches there), so the stall trackers
// below can tell a real hold apart from a movement stall by checking the
// actual mechanism rather than a proxy that can drift out of sync with it:
//   - a gun agent standing to shoot, gated on `rangeOf` the same way the
//     halt itself is (an agent with a target that is OUT of range is not
//     engaged -- it is supposed to keep moving, and a regression that
//     freezes it anyway must still be caught, not laundered through here);
//   - a melee agent that has closed to strike range and is holding there
//     (the `chaseTarget` branch's `dist < COMBAT.meleeRange * 0.75` continue).
// Both were burned independently: a proxy of merely "has a target" hid a
// regression of the gunRange fix (see world.js), and omitting the melee case
// entirely misattributed a melee chaser's legitimate hold to "frozen short of
// its goal".
const isEngaged = (a, world) => {
  if (!a.alive || a.target < 0) return false;
  const t = world.agents[a.target];
  const d = Math.hypot(t.x - a.x, t.z - a.z);
  return a.chasing ? d < COMBAT.meleeRange * 0.75 : d <= rangeOf(a);
};

const build = (seed, rooms) => {
  const plan = generateFloorplan(seed, rooms === undefined ? undefined : { targetRooms: rooms });
  const mission = assignRoles(plan);
  const placements = layoutProps(plan, mission);
  const world = createWorld(plan, mission, placements);
  return { plan, mission, placements, world, director: createDirector(plan, mission), squad: createSquad(plan) };
};

/** One tick of the live system, in the order main.js runs it. */
const step = (world, director, squad) => {
  world.tick();
  director.update(world);
  squad.update(world, director.objective);
};

// The whole point of a pure simulation: run the entire mission, on every room
// count the HUD offers, without a renderer — and assert nothing went wrong at
// any tick, which no amount of watching the screen could establish.
//
// Two tests elsewhere in this project were caught asserting nothing: one
// drove agents toward a goal that resolved outside the grid, so nobody ever
// moved; another measured a quantity that stayed correct while the real
// defect went unmeasured in a run that had gone quietly wrong. A dry run
// that resolves because nothing happened must fail here too, so this test
// also totals distance travelled and counts doors opened, and requires
// both to be non-trivial — on top of the per-tick geometry checks. Total
// distance alone is not enough by itself, though: the patrolling hostiles
// wander constantly, so a frozen SWAT squad could still clear a >50m total.
// Distance is also tracked per agent, and the SWAT squad specifically is
// required to have covered real ground. And success itself is checked against
// `director.hostageReached`, not just the verdict — the extract phase is
// reachable through search exhaustion without the hostage ever having been
// found, which must never be able to report a win.
test('a full headless mission completes cleanly at every room count', () => {
  const SEEDS_PER_ROOM_COUNT = 4;
  const outcomes = new Set();
  let sweptCells = 0;
  let totalCells = 0;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < SEEDS_PER_ROOM_COUNT; i++) {
      const seed = `e2e-${rooms}-${i}`;
      const { plan, mission, world, director, squad } = build(seed, rooms);

      const last = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z }]));
      const distance = new Map(world.agents.map((a) => [a.id, 0]));
      let totalDistance = 0;
      const openedDoors = new Set();

      let ticks = 0;
      while (director.result === null && ticks < MAX_TICKS) {
        step(world, director, squad);
        ticks++;

        for (const a of world.agents) {
          assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z),
            `${seed}: agent ${a.id} position went non-finite at tick ${ticks}`);

          const c = world.grid.worldToCell(a.x, a.z);
          assert.equal(world.grid.isBlocked(c.col, c.row), false,
            `${seed}: agent ${a.id} inside geometry at tick ${ticks}`);

          const doorId = world.grid.doorAt(c.col, c.row);
          if (doorId !== -1) {
            assert.equal(world.doors[doorId].state, 'open',
              `${seed}: agent ${a.id} inside door ${doorId} while it is ${world.doors[doorId].state} at tick ${ticks}`);
          }

          const prev = last.get(a.id);
          const stepped = Math.hypot(a.x - prev.x, a.z - prev.z);
          totalDistance += stepped;
          distance.set(a.id, distance.get(a.id) + stepped);
          prev.x = a.x; prev.z = a.z;
        }

        for (const door of Object.values(world.doors)) {
          if (door.state === 'open') openedDoors.add(door.id);
        }
      }

      outcomes.add(director.result);

      // Either side may win — that is the point of a genuine contest. What is
      // never acceptable is a mission that neither finishes nor fails: that is
      // a hang, and it is the thing this test exists to catch.
      assert.ok(director.result === 'success' || director.result === 'failed',
        `${seed}: mission never resolved within ${MAX_TICKS / 60} simulated seconds`);
      assert.ok(['extracted', 'squad-lost', 'hostage-killed', 'timeout'].includes(director.reason),
        `${seed}: resolved with an unrecognised reason ${director.reason}`);

      if (director.result === 'success') {
        assert.ok(director.hostageReached,
          `${seed}: reported success without the squad ever reaching the hostage`);
        assert.ok(world.agents.find((a) => a.role === 'hostage').alive,
          `${seed}: reported success with a dead hostage`);
      }

      // A run that "completes" without anyone actually moving would still
      // resolve if a goal resolved off-grid and every phase fell through an
      // unchecked branch. These two are what tell a real mission apart from a
      // no-op that happens to report success.
      assert.ok(totalDistance > 50,
        `${seed}: agents travelled only ${totalDistance.toFixed(1)}m total across the whole mission`);
      assert.ok(openedDoors.size > 0,
        `${seed}: no door was ever opened during the run`);

      // Total distance alone is satisfied by the patrolling hostiles pacing
      // their rooms for the whole run — a frozen SWAT squad would still pass
      // it. Require the squad specifically to have covered real ground.
      //
      // Deliberately NOT filtered on `.alive`: a squad wipe is now a designed
      // outcome (not a rare accident), and filtering to survivors makes this
      // loop iterate zero agents on any seed where every SWAT dies — silently
      // asserting nothing on exactly the seeds where a frozen squad would be
      // hardest to tell apart from a genuinely fought-and-lost one. Every
      // SWAT agent's tracked distance already freezes at the tick it dies
      // (a corpse cannot move), so it still reads as real ground covered
      // before death, not zero.
      //
      // The `> 5` bar has much less headroom against a general seed
      // population than that might suggest -- two independent sweeps across
      // seeds outside this test's own fixed set found legitimate early
      // casualties under it: one a dead SWAT at 4.02m, with roughly 0.35% of
      // all dead-SWAT records landing under the bar; another a 5.31m minimum
      // over 644 dead-SWAT records, 0.31m of margin. What actually keeps this
      // assertion from being flaky is that this test runs a fixed set of 20
      // seeds, not any margin baked into the `5` itself -- do not read `> 5`
      // as safe against an arbitrary seed, only against this specific set.
      for (const a of world.agents.filter((x) => x.role === 'swat')) {
        assert.ok(distance.get(a.id) > 5,
          `${seed}: SWAT agent ${a.id} travelled only ${distance.get(a.id).toFixed(1)}m — a frozen squad would still pass the aggregate distance check`);
      }

      // Aggregate distance is satisfied by a couple of busy patrollers while
      // the rest stand frozen. Every hostile that survived the mission should
      // have covered ground of its own.
      for (const a of world.agents.filter((x) => x.role === 'hostile' && x.alive)) {
        assert.ok(distance.get(a.id) > 1,
          `${seed}: surviving hostile ${a.id} never moved (${distance.get(a.id).toFixed(1)}m)`);
      }

      // Per seed: the squad must have seen into strictly more cells than there
      // were ROOMS ON the scripted route it replaced.
      //
      // Be precise about what this bounds, because the obvious reading is
      // wrong. `depth[hostageRoomId] + 1` is the LENGTH of orders.js's BFS
      // shortest path from the entry to the hostage's room — the number of
      // cells it deliberately walked through — verified over 200 plans against
      // a direct re-implementation of that BFS. It is NOT how many cells
      // orders.js measurably swept, which was always more: walking a corridor
      // brings you within the 4m marking radius of rooms you never entered.
      // Driving the real orders.js over these same 20 seeds with this same
      // marking rule, it swept a mean of 6.25 cells against a mean route
      // length of 4.50, and cleared this very bar on 16 of the 20.
      //
      // So this is a structural bar ("did the squad go beyond the corridor the
      // beeline would have walked"), not a claim to beat orders.js seed for
      // seed. That stronger bar was measured and does NOT hold: the squad
      // sweeps more than orders.js on 17 of 20 seeds, but less on e2e-8-0
      // (5 vs 7) and e2e-10-3 (7 vs 8), and ties on e2e-11-3 (8 vs 8) — for
      // exactly the reason the per-seed coverage floor was rejected above, that
      // a search which finds the hostage early legitimately stops early. The
      // aggregate assertion at the end of this test is where beating the
      // scripted route is actually claimed, and there it is not close:
      // 191 cells against 125 over the same seeds, 1.53x.
      //
      // Still a real bar rather than a formality: orders.js itself would have
      // failed it on 4 of these 20 seeds (e2e-8-2, e2e-8-3, e2e-9-3, e2e-12-1),
      // and a director sabotaged to beeline straight at the hostage room fails
      // it on 10 of 20. Measured margin for the current squad across this fixed
      // set: +1 cell at worst (e2e-8-0, 5 cells against a 4-cell route), +9 at
      // best (e2e-12-1, 14 against 5).
      const scriptedRouteCells = mission.depth[mission.hostageRoomId] + 1;
      assert.ok(director.visited.size > scriptedRouteCells,
        `${seed}: swept ${director.visited.size} cells, no more than the ${scriptedRouteCells} rooms on the scripted route it replaced`);

      sweptCells += director.visited.size;
      totalCells += plan.cells.length;
    }
  }

  // A combat model where SWAT always win is as broken as one where they always
  // lose, and a suite that only ever observes one outcome is not testing
  // combat at all. This is deliberately about the SET of seeds, not any one
  // of them -- no individual seed is required to go either way.
  assert.ok(outcomes.has('success'), 'no seed produced a successful mission');

  // The win condition of the whole of phase D, as a test rather than a note.
  //
  // Deliberately aggregated over the whole fixed seed set rather than asserted
  // per seed, because per-seed coverage is not a property of the search: the
  // sweep stops the moment the hostage is spotted, so a seed that hides the
  // hostage two rooms in legitimately ends at 50% however good the search is,
  // and a squad wiped at tick 1400 legitimately ends lower still. Aggregating
  // measures the thing that IS a property of the search — how much of the
  // building gets swept per mission on average — without turning "the hostage
  // happened to be close on this seed" into a failure.
  //
  // The 0.7 floor is not tuned to this number, and was not lowered to fit it.
  // Driving the deleted orders.js over these same 20 seeds with this same
  // marking rule measured an aggregate of 125/240 = 0.5208, and a per-seed
  // MAXIMUM of exactly 0.700 that no single seed exceeded — so the scripted
  // route could not have passed this assertion in either form. A director
  // sabotaged to beeline straight at the hostage's room scores 108/240 = 0.450.
  // Measured here: 191/240 = 0.7958.
  assert.ok(sweptCells / totalCells > 0.7,
    `the squad swept only ${sweptCells} of ${totalCells} cells across the seed set (${(sweptCells / totalCells * 100).toFixed(1)}%) — the scripted route this phase replaced managed 52%`);
});

// Migrated from orders.test.js's "the squad reaches the hostage and then
// extraction". Combat is live, so a squad can be wiped, or lose the hostage,
// before ever reaching extraction: either is a legitimate resolution, not a
// bug. What this guards is that a mission never hangs across a wide seed
// family, and that a WINNING run really did end up at extraction (a losing run
// has nowhere fixed to end up, so there is nothing useful to check about its
// position).
test('every mission in a wide seed family resolves, and a win really ends at extraction', () => {
  for (let i = 0; i < 60; i++) {
    const seed = `orders-${i}`;
    const { mission, world, director, squad } = build(seed);
    let ticks = 0;
    while (director.result === null && ticks < MAX_TICKS) { step(world, director, squad); ticks++; }
    assert.ok(director.result === 'success' || director.result === 'failed',
      `${seed}: mission did not resolve within ${MAX_TICKS / 60} simulated seconds`);
    if (director.result === 'success') {
      const lead = world.agents.find((a) => a.role === 'swat' && a.alive);
      const gap = Math.hypot(lead.x - mission.spawns.extraction.x, lead.z - mission.spawns.extraction.z);
      assert.ok(gap < 3, `${seed}: squad finished ${gap.toFixed(1)}m from extraction`);
      assert.ok(director.hostageReached, `${seed}: reported success without ever finding the hostage`);
    }
  }
});

// Migrated from orders.test.js's "a scripted dry run never leaves an agent
// frozen short of its goal".
//
// Regression origin: seed `dry-10-8` with `{ targetRooms: 10 }` used to freeze
// one SWAT agent 18m from extraction forever. Several agents converging on the
// exact same coordinate let a goal-pull vector and a separation-push vector
// cancel to exactly zero (or land the step back on the agent's own already-open
// cell), which the stall detector of the day could never see as evidence — it
// only ever looked for a wall or a door refusing the move. A different seed
// family from `orders-N` on purpose: those seeds all passed throughout, which
// is exactly why one family was not enough to catch this.
test('no agent is ever left frozen short of its goal', () => {
  let worstTicks = 0;
  let worstSeed = null;
  let maxStillRun = 0;
  let stillAt = null;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 10; i++) {
      const seed = `dry-${rooms}-${i}`;
      const { world, director, squad } = build(seed, rooms);
      const still = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z, run: 0 }]));
      let ticks = 0;
      while (director.result === null && ticks < MAX_TICKS) {
        step(world, director, squad);
        ticks++;
        for (const a of world.agents) {
          const s = still.get(a.id);
          // Physically pinned against a neighbour that is itself legitimately
          // engaged: separation keeps this agent from moving even though IT
          // isn't the one that chose to stop. That's bounded by how long the
          // neighbour's fight lasts, not by anything a stall detector could
          // ever recover from, so it is excluded from the count entirely
          // (frozen, not reset -- see below) rather than folded into
          // "legitimate hold".
          const pinned = world.agents.some((b) => b.id !== a.id
            && isEngaged(b, world)
            && Math.hypot(a.x - b.x, a.z - b.z) < SIM.separation);
          if (pinned) { s.x = a.x; s.z = a.z; continue; }
          // A live agent standing its own ground in combat (see world.js) is
          // a deliberate hold, not the frozen-short-of-goal failure this test
          // hunts for -- only count stillness against a moving order, never
          // this agent's own combat hold or a corpse (whose path is null the
          // instant it dies). Checked with `isEngaged`, not merely "has a
          // target": an agent with a target it cannot yet reach (out of gun
          // range, not yet at strike range) is supposed to keep moving, and
          // must still be caught here if a future regression freezes it
          // anyway.
          if (a.path && !isEngaged(a, world) && Math.hypot(a.x - s.x, a.z - s.z) < 1e-9) s.run++;
          else s.run = 0;
          s.x = a.x; s.z = a.z;
          if (s.run > maxStillRun) { maxStillRun = s.run; stillAt = `${seed} agent ${a.id} (${a.role})`; }
        }
      }
      assert.ok(director.result === 'success' || director.result === 'failed',
        `${seed} (rooms=${rooms}): mission did not resolve within ${MAX_TICKS / 60} simulated seconds`);
      if (ticks > worstTicks) { worstTicks = ticks; worstSeed = seed; }
    }
  }

  // A generous ceiling on how long even the worst of the 50 runs may take.
  assert.ok(worstTicks < MAX_TICKS,
    `worst run (${worstSeed}) used the entire ${MAX_TICKS / 60}s budget`);

  // How long any single agent may hold a path while displacing nothing at
  // all, now that combat holds (its own, or a neighbour's within
  // SIM.separation) are excluded above rather than folded into this number.
  // What's left after that exclusion is not firefight duration -- it is the
  // wall/goal-stall recovery machinery's own cycle time (GOAL_STALL_WINDOW=90
  // to detect no progress, then NUDGE_TICKS=20 to escalate and clear a
  // multi-agent formation jam), which is bounded by fixed constants rather
  // than by how long two agents choose to keep shooting at each other. That
  // is what makes this a property rather than a number chasing whatever the
  // worst sampled seed happened to do.
  //
  // Re-measured at the phase D cutover against director + squad (the number
  // was 200 under orders.js, whose missions were far shorter — a beeline to
  // the hostage rather than a building sweep, so the escorted hostage spent
  // much less time in traffic). The 247-tick figure this comment used to
  // claim (worst on a HOSTAGE being escorted out, "~1.6x margin") did not
  // survive a fresh sample and was never re-verified after being written: the
  // director's extract-phase escort had a live-lock (world.js nulls `path`
  // and `goal` identically on arrival or on setGoal failure, so `!hostage.path`
  // alone re-issued an identical goal forever) that this test's own tracker
  // measures as an ever-growing still-run, not a fixed 247. Measured with this
  // test's own tracker over 600 fresh missions: worst still-runs of 402, 571
  // and 566, all on the hostage, all breaching this file's 400 bar. The fixed
  // 50-seed `dry-N` set above never showed it (peaks at 27), which is exactly
  // why the false margin was never caught by CI.
  //
  // director.js now tracks the hostage's last issued target and skips
  // re-issuing within SQUAD.reissueDistance of it (mirroring squad.js's own
  // fix for the identical defect), closing the live-lock. Re-measured
  // post-fix over a 1500-mission fresh sweep (`revD-N`, room counts 8-12):
  // hostage worst still-run 25 (down from 571), global worst 183 — now a SWAT
  // agent, not the hostage — on seed `revD-9-25`. 400 keeps a real ~2.19x
  // margin over that measured worst while staying an order of magnitude below
  // the thousands of ticks a genuine freeze rides out to.
  assert.ok(maxStillRun < 400,
    `${stillAt} held a path with zero displacement for ${maxStillRun} consecutive ticks`);
});

// Migrated from orders.test.js's "an agent that only oscillates is treated as
// stalled, not as moving".
//
// A live-lock, not a deadlock. Seed `verify2-12-1` (12 rooms) once hung with
// SWAT 1 holding a path 5.4m short of its goal at a steady 0.25 m/s: not
// frozen — creeping, oscillating a few centimetres back and forth against a
// wall and never arriving, while the rest of the squad waited forever. Every
// stall signal in place at the time was built for an agent that had STOPPED,
// and this one never stopped.
//
// So this test does not assert "did it finish" first (a live-locked agent can
// keep a run finishing by luck on some other seed) or "did anyone stand
// perfectly still" (the whole point is that nobody did). It measures the thing
// that actually distinguishes progress from motion: the longest run of ticks
// an agent can hold a path without ever beating its own best distance to the
// goal it is currently pursuing. Oscillation scores exactly as badly as a full
// standstill, which is the property the detector was missing.
test('an agent that only oscillates is treated as stalled, not as moving', () => {
  // 30 simulated seconds of motion that gets an agent no closer to where it
  // is going is not traffic, it is a live-lock. Measured worst across ~400
  // missions at the cutover (the `tail-N`, `fmeas-N`, `widestall-N` and
  // `verify2-N` families) is 541 ticks; the same measurement before the
  // original fix reached 13,744 — the entire run, on `verify2-12-1`. 1800
  // keeps 3.3x margin over the measured worst and still sits far below the
  // signal it exists to catch.
  const NO_PROGRESS_LIMIT = 1800;
  const PROGRESS_EPS = 0.05;
  let worstRun = 0;
  let worstAt = null;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 5; i++) {
      const seed = `verify2-${rooms}-${i}`;
      const { world, director, squad } = build(seed, rooms);
      // Per agent: which goal it is chasing, the closest it has come to that
      // goal, and how long since it last beat that. Reset when the goal
      // changes, so being sent somewhere new never counts against an agent.
      const track = new Map(world.agents.map((a) => [a.id, { key: null, best: Infinity, run: 0 }]));
      let ticks = 0;

      while (director.result === null && ticks < MAX_TICKS) {
        step(world, director, squad);
        ticks++;
        for (const a of world.agents) {
          const t = track.get(a.id);
          if (!a.goal || !a.path) { t.key = null; t.best = Infinity; t.run = 0; continue; }
          const key = `${a.goal.x},${a.goal.z}`;
          if (t.key !== key) { t.key = key; t.best = Infinity; t.run = 0; }
          const dist = Math.hypot(a.x - a.goal.x, a.z - a.goal.z);
          if (dist < t.best - PROGRESS_EPS) { t.best = dist; t.run = 0; }
          else {
            t.run++;
            if (t.run > worstRun) { worstRun = t.run; worstAt = `${seed} agent ${a.id} (${a.role})`; }
          }
        }
      }

      // Checked per seed, and deliberately BEFORE the "did it finish"
      // assertion: a live-locked agent is the diagnosis, running out of
      // budget is only the eventual symptom, and this is the assertion that
      // names which one it was.
      assert.ok(worstRun < NO_PROGRESS_LIMIT,
        `${worstAt} held a path for ${worstRun} consecutive ticks without ever getting closer to its goal`);
      assert.ok(director.result === 'success' || director.result === 'failed',
        `${seed} (rooms=${rooms}): mission did not resolve within ${MAX_TICKS / 60} simulated seconds`);
    }
  }
});

// Migrated from orders.test.js's "replaying the previously-frozen seed
// reproduces the same run", and from its "the run is deterministic".
//
// director.test.js and squad.test.js each check their own module replays, but
// neither drives the two TOGETHER, and it is the pair that main.js runs. A
// replay divergence introduced by the interaction (an objective read one tick
// later, a Map iterated in a different order) would be invisible to both.
//
// Stops on resolution, not on a fixed phase: combat is live, and a squad wipe
// or a lost hostage resolves without ever reaching 'done'. Pinning the loop to
// a phase would burn the entire budget every time the seed went the other way.
test('director and squad replay bit-for-bit on the seed that used to freeze', () => {
  const run = () => {
    const { world, director, squad } = build('dry-10-8', 10);
    let ticks = 0;
    while (director.result === null && ticks < MAX_TICKS) { step(world, director, squad); ticks++; }
    return { hash: world.hash(), result: director.result, reason: director.reason,
      visited: director.visited.size, ticks };
  };
  const a = run();
  const b = run();
  assert.ok(a.result === 'success' || a.result === 'failed',
    `dry-10-8 did not resolve within ${MAX_TICKS / 60} simulated seconds (result: ${a.result})`);
  // The point of this test: the same seed replayed twice must reach bit-for-
  // bit identical state, whichever way the mission resolves.
  assert.equal(a.hash, b.hash);
  assert.equal(a.result, b.result);
  assert.equal(a.reason, b.reason);
  assert.equal(a.visited, b.visited);
  assert.equal(a.ticks, b.ticks);
});

// Migrated from orders.test.js's "a dead squad member is not waited on".
//
// The mechanism that test named is gone: orders.js's advance leg required
// every living SWAT member to arrive before moving on, a corpse never arrives,
// and the first death would hang the leg until the watchdog dragged it
// forward. squad.js has no arrival gate at all — it issues goals and never
// waits on anyone. But "a casualty must not stall the mission" is a property,
// not a mechanism, and it survives the rewrite: the squad's per-agent maps
// (issued/pending) are exactly the kind of bookkeeping a dead member can be
// left stuck in, and the director's extract arrival check reads
// `[...swat, hostage]` where a corpse that stayed in the list could never
// satisfy it.
//
// Deliberately does not pin a win or a loss on this seed. From the casualty
// onward the rest of the mission is a live, stochastic firefight, and pinning
// one fixed seed's coin flip is the property this project's own design rule
// forbids testing. What distinguishes "the casualty was handled" from "the
// mission stalled on the corpse" is resolving at all, and resolving nowhere
// near the clock a genuine stall would ride out to.
test('a casualty does not stall the mission', () => {
  const { world, director, squad } = build('outcome-casualty');

  for (let i = 0; i < 60; i++) step(world, director, squad);
  const victim = world.agents.filter((a) => a.role === 'swat')[3];
  victim.hp = 0; victim.alive = false;

  let ticks = 0;
  while (director.result === null && ticks < MAX_TICKS) { step(world, director, squad); ticks++; }

  assert.ok(director.result === 'success' || director.result === 'failed',
    'a dead squad member hung the mission');
  assert.notEqual(director.reason, 'timeout',
    `the mission ran out the ${MISSION_LIMIT}-tick clock after a casualty — the corpse stalled it rather than being dropped`);
  // Comfortably under the clock: a mission that actually stalled on the corpse
  // would ride out close to MISSION_LIMIT, not resolve early. Measured on this
  // seed: well under 4000 ticks.
  assert.ok(ticks < MISSION_LIMIT / 2,
    `mission took ${ticks} ticks to resolve after a casualty — too close to the ${MISSION_LIMIT}-tick clock to be confident this isn't the stall it guards against`);
});

// Regression: the extraction point is not guaranteed to be a walkable navgrid
// cell — measured at 6% of plans over 200 — and `findPath` refuses a blocked
// GOAL outright. squad.js has always run its own destinations through
// `nearestWalkable`, so the squad always arrived; director.js escorted the
// hostage with a raw `setGoal(hostage, exit)`, which on those plans could
// never succeed even once. Measured before the fix: 7336 consecutive failed
// setGoal calls on seed `rr-27` and 6735 on the original seed this test used,
// each ending in a `timeout` verdict with the squad parked correctly at the
// exit and the hostage rooted where it was rescued, 26m away.
//
// Asserts the MECHANISM (did the hostage actually get escorted anywhere)
// rather than the verdict, so this test only ever cared whether the escort
// itself works, not whether the squad happens to win whatever fight this
// seed's hostiles pick a fight with along the way. It was stranded twice
// regardless — Task 1's fallback-rule removal, then this task's melee
// changes — each time because *reaching* 'extract' at all depended on the
// squad surviving combat on one fixed seed, and neither change touched the
// escort mechanism this test exists to guard.
//
// Fixed at Task 2 review by removing that dependency rather than re-seeding
// around it a second time (see the `hostage-escort` test below, and
// director.test.js's search-exhaustion test, for the same call): every
// hostile is killed immediately after the world is built, so the squad's
// search is uncontested and reaching 'extract' depends only on real search/
// pathing behaviour, never on a combat retune. `blocked-exit-12-116` is kept
// as the seed rather than swept again — its extraction point being blocked is
// a floorplan-generation property, entirely unrelated to combat, so nothing
// about this fix required a new seed.
test('the hostage is escorted out even when the extraction point is not itself walkable', () => {
  const { mission, world, director, squad } = build('blocked-exit-12-116', 12);
  for (const h of world.agents.filter((a) => a.role === 'hostile')) { h.hp = 0; h.alive = false; }
  const exit = mission.spawns.extraction;
  const exitCell = world.grid.worldToCell(exit.x, exit.z);
  assert.ok(world.grid.isBlocked(exitCell.col, exitCell.row),
    'test setup: this seed\'s extraction point is walkable, so nothing here exercises the blocked-goal fallback');

  const hostage = world.agents.find((a) => a.role === 'hostage');
  let ticks = 0;
  while (director.phase !== 'extract' && ticks < MAX_TICKS) { step(world, director, squad); ticks++; }
  assert.equal(director.phase, 'extract', 'the escort never began on this seed');
  assert.ok(director.hostageReached, 'reached extract without ever finding the hostage');

  // Measured 26.25m at this point, closing to 0.59m by the end.
  const startGap = Math.hypot(hostage.x - exit.x, hostage.z - exit.z);
  assert.ok(startGap > 10, `test setup: the hostage was already ${startGap.toFixed(1)}m from the exit at the rescue`);

  while (director.result === null && ticks < MAX_TICKS) { step(world, director, squad); ticks++; }
  const endGap = Math.hypot(hostage.x - exit.x, hostage.z - exit.z);

  assert.notEqual(director.reason, 'timeout',
    `the mission ran out the ${MISSION_LIMIT}-tick clock during the escort`);
  assert.ok(endGap < startGap - 10,
    `the hostage was never routed anywhere: ${startGap.toFixed(1)}m from the exit at the rescue, ${endGap.toFixed(1)}m at the end`);
});

// Regression, found while migrating the anti-hang tests at the cutover, and
// formerly covered HERE against a fixed seed (`widestall-11-14`, then
// `widestall-11-16`).
//
// Retired as a seed-bound test at Task 2 review: a fixed seed reproduces
// director.js:239's specific geometry — the sole remaining unvisited cell IS
// the one the squad is already standing in, more than RESCUE_SIGHT from its
// centre — only by coincidence of that seed's floorplan and combat outcome,
// and a Task-2 review caught a replacement seed (`widestall-11-16`) that
// LOOKED right (a member sat in the last unvisited cell, off-centre, for 184
// ticks) but never actually exercised the line it was meant to guard: deleting
// line 239 left that seed's mission byte-identical. Every combat task in this
// plan (2-5) retunes outcomes on every seed, so re-seeding this test each time
// it breaks was chasing a moving target rather than fixing it.
//
// The regression is now covered seed-independently, by hand-building the exact
// state director.js:239 exists for rather than hoping a generated floorplan
// produces it — see `director.test.js`'s
// "the search re-targets its own cell when it is the only one left unvisited".
// That test cannot be stranded by a combat retune: it never runs a fight.

// Migrated from orders.test.js's "the hostage stays put until rescued" and
// "the mission fails if the hostage is killed during the escort".
//
// Both need the squad as well as the director: nothing moves the squad toward
// the hostage without it, so driven against the director alone the hostage
// would sit still for a trivially uninteresting reason and the escort would
// never begin. Bounded by the PHASE, not by a fixed tick count — the search
// takes as long as it takes, and the hostage legitimately starts moving the
// moment it is rescued, so a fixed window that happened to span the transition
// would be asserting the opposite of what it claims.
//
// This test is about the hostage's own captivity/movement bookkeeping and the
// search/rescue/escort phase transitions, not about the squad surviving a
// fight — so every hostile is killed immediately after the world is built,
// exactly as in the blocked-exit test above, making the search uncontested and
// this test immune to every combat retune in Tasks 2-5, the same way that one
// now is.
test('the hostage stays put until it is found, then stops being a captive', () => {
  const { world, director, squad } = build('hostage-escort', 10);
  for (const a of world.agents.filter((x) => x.role === 'hostile')) { a.hp = 0; a.alive = false; }
  const h = world.agents.find((a) => a.role === 'hostage');
  const x0 = h.x;
  const z0 = h.z;

  let ticks = 0;
  while (director.phase === 'search' && ticks < MAX_TICKS) {
    step(world, director, squad);
    ticks++;
    assert.ok(Math.hypot(h.x - x0, h.z - z0) < 0.1,
      `the hostage wandered off ${Math.hypot(h.x - x0, h.z - z0).toFixed(2)}m during the search, at tick ${ticks}`);
    assert.equal(h.captive, true, `the hostage stopped being a captive at tick ${ticks}, before being found`);
  }
  assert.notEqual(ticks, MAX_TICKS, 'the squad never found the hostage at all');
  assert.equal(director.hostageReached, true, 'the search ended without the hostage being found');

  // The rescue phase is a single transitional tick that frees the hostage.
  step(world, director, squad);
  assert.equal(h.captive, false, 'the hostage should stop being a prisoner at the rescue');
  assert.equal(director.phase, 'extract');

  // Killing the freed hostage mid-escort must fail the mission, not hang it.
  h.hp = 0; h.alive = false;
  let after = 0;
  while (director.result === null && after < 3000) { step(world, director, squad); after++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'hostage-killed');
});
