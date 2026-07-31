import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => `orders-${i}`);
const build = (seed, overrides) => {
  const plan = generateFloorplan(seed, overrides);
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, orders: createOrders(plan, mission) };
};

test('the squad reaches the hostage and then extraction', () => {
  for (const seed of SEEDS) {
    const { mission, world, orders } = build(seed);
    let ticks = 0;
    while (orders.phase !== 'done' && ticks < 60 * 180) { world.tick(); orders.update(world); ticks++; }
    assert.equal(orders.phase, 'done', `${seed}: dry run did not finish within 180 simulated seconds`);
    const lead = world.agents.find((a) => a.role === 'swat');
    const gap = Math.hypot(lead.x - mission.spawns.extraction.x, lead.z - mission.spawns.extraction.z);
    assert.ok(gap < 3, `${seed}: squad finished ${gap.toFixed(1)}m from extraction`);
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
      while (orders.phase !== 'done' && ticks < MAX_TICKS) {
        world.tick();
        orders.update(world);
        ticks++;
        for (const a of world.agents) {
          const s = still.get(a.id);
          if (a.path && Math.hypot(a.x - s.x, a.z - s.z) < 1e-9) s.run++;
          else s.run = 0;
          s.x = a.x; s.z = a.z;
          if (s.run > maxStillRun) maxStillRun = s.run;
        }
      }
      assert.equal(orders.phase, 'done',
        `${seed} (rooms=${rooms}): dry run did not finish within ${MAX_TICKS / 60} simulated seconds`);
      if (ticks > worstTicks) { worstTicks = ticks; worstSeed = seed; }
    }
  }

  // A generous ceiling on how long even the worst of the 50 runs may take,
  // and on how long any single agent may hold a path while displacing
  // nothing at all — comfortably above the ~25 ticks a legitimate door wait
  // takes, so a door is never what trips this.
  assert.ok(worstTicks < MAX_TICKS,
    `worst run (${worstSeed}) used the entire ${MAX_TICKS / 60}s budget`);
  assert.ok(maxStillRun < 60,
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

      while (orders.phase !== 'done' && ticks < MAX_TICKS) {
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
      assert.equal(orders.phase, 'done',
        `${seed} (rooms=${rooms}): dry run did not finish within ${MAX_TICKS / 60} simulated seconds`);
    }
  }
});
