import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';
import { rangeOf, COMBAT } from '../sim/combat.js';

// Mirrors world.js's own two "legitimately holding position because of
// combat" cases exactly (see the tick() branches there), so tests that need
// to tell a real hold apart from a movement stall are checking the actual
// mechanism rather than a proxy that can drift out of sync with it:
//   - a gun agent standing to shoot, gated on `rangeOf` the same way the
//     halt itself is (an agent with a target that is OUT of range is not
//     engaged -- it is supposed to keep moving, and a regression that
//     freezes it anyway must still be caught, not laundered through here);
//   - a melee agent that has closed to strike range and is holding there
//     (the `chaseTarget` branch's `dist < COMBAT.meleeRange * 0.75` continue).
// Both were burned independently: a proxy of merely "has a target" hid a
// regression of the gunRange fix (see world.js), and omitting the melee case
// entirely misattributed a melee chaser's legitimate hold to "frozen short of
// its goal" (see the still-run tracker below).
const isEngaged = (a, world) => {
  if (!a.alive || a.target < 0) return false;
  const t = world.agents[a.target];
  const d = Math.hypot(t.x - a.x, t.z - a.z);
  return a.chasing ? d < COMBAT.meleeRange * 0.75 : d <= rangeOf(a);
};

const SEEDS = Array.from({ length: 60 }, (_, i) => `orders-${i}`);
const build = (seed, overrides) => {
  const plan = generateFloorplan(seed, overrides);
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, orders: createOrders(plan, mission) };
};

test('the squad reaches the hostage and then extraction', () => {
  // Combat is live: a squad can now be wiped, or lose the hostage, before ever
  // reaching extraction. Either is a legitimate resolution, not a bug -- the
  // thing this test actually guards is that a dry run never hangs, and that a
  // WINNING run really did make it to extraction (a losing run has nowhere
  // fixed to end up, so there is nothing useful to check about its position).
  for (const seed of SEEDS) {
    const { mission, world, orders } = build(seed);
    let ticks = 0;
    while (orders.outcome === null && ticks < 60 * 180) { world.tick(); orders.update(world); ticks++; }
    assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
      `${seed}: dry run did not resolve within 180 simulated seconds`);
    if (orders.outcome === 'success') {
      const lead = world.agents.find((a) => a.role === 'swat' && a.alive);
      const gap = Math.hypot(lead.x - mission.spawns.extraction.x, lead.z - mission.spawns.extraction.z);
      assert.ok(gap < 3, `${seed}: squad finished ${gap.toFixed(1)}m from extraction`);
    }
  }
});

test('the run is deterministic', () => {
  const a = build('det');
  const b = build('det');
  for (let i = 0; i < 1200; i++) {
    a.world.tick(); a.orders.update(a.world);
    b.world.tick(); b.orders.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.orders.phase, b.orders.phase);
});

test('doors along the route actually get opened', () => {
  const { world, orders } = build('doors');
  for (let i = 0; i < 60 * 90; i++) { world.tick(); orders.update(world); }
  const opened = Object.values(world.doors).filter((d) => d.state === 'open').length;
  assert.ok(opened > 0, 'the squad crossed the building without opening a single door');
});

test('hostiles move but stay in their own room', () => {
  const { plan, mission, world, orders } = build('patrol');
  const byId = new Map(plan.cells.map((c) => [c.id, c]));
  const homes = new Map(world.agents.filter((a) => a.role === 'hostile')
    .map((a, i) => [a.id, byId.get(mission.spawns.hostiles[i].cellId)]));
  let moved = 0;
  const startX = new Map(world.agents.map((a) => [a.id, a.x]));
  for (let i = 0; i < 60 * 40; i++) {
    world.tick(); orders.update(world);
    for (const a of world.agents.filter((x) => x.role === 'hostile')) {
      const home = homes.get(a.id);
      assert.ok(a.x >= home.x - 0.5 && a.x <= home.x + home.w + 0.5
        && a.z >= home.z - 0.5 && a.z <= home.z + home.d + 0.5,
        `hostile ${a.id} left its room`);
    }
  }
  for (const a of world.agents.filter((x) => x.role === 'hostile')) {
    if (Math.abs(a.x - startX.get(a.id)) > 0.3) moved++;
  }
  assert.ok(moved > 0, 'no hostile moved at all');
});

test('the hostage stays put until rescued', () => {
  const { world, orders } = build('hostage');
  const h = world.agents.find((a) => a.role === 'hostage');
  const x0 = h.x;
  const z0 = h.z;
  // Bounded by the phase, not a fixed tick count: the squad now runs to
  // contact (see orders.js), so a fixed 20-second window that used to fall
  // entirely inside 'advance' can now run past the rescue transition on a
  // short route, and the hostage legitimately starts moving once rescued.
  // The invariant this test actually cares about is "before rescue", so
  // testing exactly that is what keeps it meaningful regardless of squad
  // speed. 60 simulated seconds is a generous ceiling on 'advance' alone —
  // comfortably above the ~12s this seed takes at run speed — so a
  // regression that stalls the squad still fails this loop's own bound
  // rather than silently exiting having asserted nothing.
  let ticks = 0;
  while (orders.phase === 'advance' && ticks < 60 * 60) { world.tick(); orders.update(world); ticks++; }
  assert.notEqual(ticks, 60 * 60, 'the squad never left the advance phase within 60 simulated seconds');
  assert.ok(Math.hypot(h.x - x0, h.z - z0) < 0.1, 'the hostage wandered off before being rescued');
});

// Regression: seed `dry-10-8` with `{ targetRooms: 10 }` used to freeze one
// SWAT agent 18m from extraction forever. Several agents converging on the
// exact same extraction/advance coordinate let a goal-pull vector and a
// separation-push vector cancel to exactly zero (or land the step back on
// the agent's own already-open cell), which the old stall detector could
// never see as evidence — it only ever looked for a wall or a door refusing
// the move. A different seed family from `orders-N` on purpose: those seeds
// all passed throughout, which is exactly why one family was not enough to
// catch this.
test('a scripted dry run never leaves an agent frozen short of its goal', () => {
  const MAX_TICKS = 60 * 240;
  let worstTicks = 0;
  let worstSeed = null;
  let maxStillRun = 0;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 10; i++) {
      const seed = `dry-${rooms}-${i}`;
      const { world, orders } = build(seed, { targetRooms: rooms });
      const still = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z, run: 0 }]));
      let ticks = 0;
      while (orders.outcome === null && ticks < MAX_TICKS) {
        world.tick();
        orders.update(world);
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
          if (s.run > maxStillRun) maxStillRun = s.run;
        }
      }
      // Combat is live: a squad can now be wiped, or lose the hostage, before
      // ever reaching 'done'. Either is a legitimate resolution -- what this
      // test actually guards against is a hang, which `orders.outcome` above
      // already bounds; 'done' is no longer the only acceptable ending.
      assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
        `${seed} (rooms=${rooms}): dry run did not resolve within ${MAX_TICKS / 60} simulated seconds`);
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
  // is what makes this a property again rather than a number chasing
  // whatever the worst sampled seed happened to do.
  //
  // Measured across 335 seeds with the exclusion in place (the 50 seeds this
  // test itself samples, plus two independent 250-seed and 50-orders-N
  // sweeps run to check the exclusion generalizes, not just fits this file's
  // own sample): the ordinary case is a flat 25 ticks (the legitimate door
  // wait this was always meant to clear), with one outlier at 118
  // (`dry-11-26`, three SWAT bunched in a doorway with nobody in combat at
  // all -- a pure multi-agent separation jam, confirmed by inspecting every
  // nearby agent's `target`/`chasing` state at the tick it peaked). 200 keeps
  // real margin over that measured worst without laundering an unbounded
  // firefight through this number the way 150 did.
  assert.ok(maxStillRun < 200,
    `an agent held a path with zero displacement for ${maxStillRun} consecutive ticks`);
});

test('replaying the previously-frozen seed reproduces the same run', () => {
  const run = () => {
    const { world, orders } = build('dry-10-8', { targetRooms: 10 });
    for (let i = 0; i < 60 * 240 && orders.phase !== 'done'; i++) { world.tick(); orders.update(world); }
    return { hash: world.hash(), phase: orders.phase };
  };
  const a = run();
  const b = run();
  assert.equal(a.phase, 'done');
  assert.equal(a.hash, b.hash);
  assert.equal(a.phase, b.phase);
});

// A live-lock, not a deadlock. Seed `verify2-12-1` (12 rooms) hung with SWAT
// 1 holding a path 5.4m short of its goal at a steady 0.25 m/s: not frozen —
// creeping, oscillating a few centimetres back and forth against a wall and
// never arriving, while the other three sat waiting at the leg target
// forever. Every stall signal in place at the time was built for an agent
// that had STOPPED, and this one never stopped.
//
// So this test does not assert "did it finish" (a live-locked agent can keep
// a run finishing by luck on some other seed) or "did anyone stand perfectly
// still" (the whole point is that nobody did). It measures the thing that
// actually distinguishes progress from motion: the longest run of ticks an
// agent can hold a path without ever beating its own best distance to the
// goal it is currently pursuing. Oscillation scores exactly as badly as a
// full standstill, which is the property the detector was missing.
test('an agent that only oscillates is treated as stalled, not as moving', () => {
  const MAX_TICKS = 60 * 240;
  // 30 simulated seconds of motion that gets an agent no closer to where it
  // is going is not traffic, it is a live-lock. Measured worst across these
  // runs is ~870 ticks; the same measurement before this was fixed reached
  // 13,744 — the entire run, on this very seed.
  const NO_PROGRESS_LIMIT = 1800;
  const PROGRESS_EPS = 0.05;
  let worstRun = 0;
  let worstAt = null;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 5; i++) {
      const seed = `verify2-${rooms}-${i}`;
      const { world, orders } = build(seed, { targetRooms: rooms });
      // Per agent: which goal it is chasing, the closest it has come to that
      // goal, and how long since it last beat that. Reset when the goal
      // changes, so being sent somewhere new never counts against an agent.
      const track = new Map(world.agents.map((a) => [a.id, { key: null, best: Infinity, run: 0 }]));
      let ticks = 0;

      while (orders.outcome === null && ticks < MAX_TICKS) {
        world.tick();
        orders.update(world);
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
            if (t.run > worstRun) { worstRun = t.run; worstAt = `${seed} agent ${a.id}`; }
          }
        }
      }

      // Checked per seed, and deliberately BEFORE the "did it finish"
      // assertion: a live-locked agent is the diagnosis, running out of
      // budget is only the eventual symptom, and this is the assertion that
      // names which one it was.
      assert.ok(worstRun < NO_PROGRESS_LIMIT,
        `${worstAt} held a path for ${worstRun} consecutive ticks without ever getting closer to its goal`);
      // Combat is live: a squad can now be wiped, or lose the hostage, before
      // ever reaching 'done'. Either is a legitimate resolution -- what this
      // test actually guards against is a live-lock, which the assertion
      // above already covers; 'done' is no longer the only acceptable ending.
      assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
        `${seed} (rooms=${rooms}): dry run did not resolve within ${MAX_TICKS / 60} simulated seconds`);
    }
  }
});

test('a mission with the whole squad dead ends as failed, not hung', () => {
  const plan = generateFloorplan('outcome-wipe');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  for (let i = 0; i < 120; i++) { world.tick(); orders.update(world); }
  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.hp = 0; a.alive = false; }

  let ticks = 0;
  while (orders.outcome === null && ticks < 3000) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.outcome, 'failed', 'a wiped squad never resolved the mission');
  assert.equal(orders.phase, 'failed');
});

test('a dead squad member is not waited on', () => {
  // The advance leg used to require every SWAT member to arrive. A corpse
  // never arrives, so the first death would hang the leg until the watchdog
  // dragged it forward -- turning a casualty into a minutes-long stall. That
  // is the property this test exists to guard: a hang, not a win.
  //
  // This used to assert `orders.outcome === 'success'` on this one fixed
  // seed. From the casualty onward the rest of the mission is a live,
  // stochastic firefight (three SWAT plus a wounded formation against
  // whatever hostiles remain) -- pinning a fixed seed's win or loss is
  // exactly the "does one seed happen to win a coin flip" property this
  // project's own design rule forbids testing (see dryrun.test.js's
  // `outcome === 'success' || outcome === 'failed'`), and it is NOT the same
  // question as "did the watchdog drag a stranded leg forward instead of
  // hanging on the corpse forever". A reviewer confirmed the fixed-seed
  // assertion was non-monotonic under nearby constant changes -- proof it
  // was reading noise, not a property. What actually distinguishes "the
  // watchdog worked" from "the mission hung waiting for a corpse" is
  // resolving at all, and resolving nowhere near the ceiling a genuine hang
  // would ride out to.
  const plan = generateFloorplan('outcome-casualty');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  for (let i = 0; i < 60; i++) { world.tick(); orders.update(world); }
  const victim = world.agents.filter((a) => a.role === 'swat')[3];
  victim.hp = 0; victim.alive = false;

  let ticks = 0;
  while (orders.outcome === null && ticks < 14400) { world.tick(); orders.update(world); ticks++; }
  assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
    'a dead squad member hung the mission instead of the watchdog dragging it forward');
  // Comfortably under the 14400-tick ceiling used above, and well under the
  // per-leg LEG_TIMEOUT*(_MAX_REISSUES+1) watchdog escalation in orders.js:
  // a mission that actually hung on the corpse would ride out close to one
  // of those, not resolve early. Measured on this seed across a range of
  // COMBAT tunings: 1300-2600 ticks either way -- this bound leaves ample
  // margin above that without coming anywhere near the ceiling a real hang
  // would hit.
  assert.ok(ticks < 8000,
    `mission took ${ticks} ticks to resolve after a casualty -- too close to the watchdog ceiling to be confident this isn't the stall it guards against`);
});

test('the mission fails if the hostage is killed during the escort', () => {
  const plan = generateFloorplan('outcome-hostage');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  let ticks = 0;
  while (orders.phase !== 'extract' && ticks < 14400) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.phase, 'extract', 'never reached the escort');

  const hostage = world.agents.find((a) => a.role === 'hostage');
  assert.equal(hostage.captive, false, 'the hostage should stop being a prisoner at the rescue');
  hostage.hp = 0; hostage.alive = false;

  ticks = 0;
  while (orders.outcome === null && ticks < 3000) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.outcome, 'failed');
});
