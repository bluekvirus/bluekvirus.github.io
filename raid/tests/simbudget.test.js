import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { findPath } from '../sim/path.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

const prepare = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  const placements = layoutProps(plan, mission);
  return { plan, mission, placements };
};

// CPU time, not wall clock. `node --test` (the default, and the mode CI runs
// in) executes every test file concurrently, so a wall-clock stopwatch is
// measuring "how much of the CPU did the OS scheduler give this process
// during this window", not "is this algorithm fast" — the two only agree
// when nothing else is competing for a core. On a loaded machine this test
// used to fail 3 runs out of 5 with observed durations of 176-204ms against
// a 3ms budget, purely from contention with the other test files, not from
// the algorithm being slow. `process.cpuUsage()` reports CPU time actually
// consumed by this process (user + system), which does not inflate when the
// scheduler hands the core to someone else in between — it is the thing
// that is actually supposed to be under budget, and it stays a meaningful
// signal under concurrency instead of a coin flip.
const cpuMs = (start) => {
  const u = process.cpuUsage(start);
  return (u.user + u.system) / 1000;
};

// `process.cpuUsage()`'s own accounting is coarse relative to a single path
// query or a single tick (both well under 1ms of real work): measured back
// to back against `performance.now()` in the very same, otherwise-idle
// process, cpuUsage's reported per-call cost is regularly 1-2ms higher than
// wall clock ever shows for the identical call — noise from the measurement
// itself, not from the work, and on its own enough to occasionally clear a
// tight per-call budget with nothing having gotten slower. That noise is
// close to fixed per *measurement*, not per unit of work, so timing a batch
// of calls together and dividing by the batch size amortizes it down to a
// fraction of the result, while a genuine regression — which slows down
// every call in the batch, not one measurement — still shows up at full
// size. Same idea as `STALL_WINDOW` in world.js: judge over enough samples
// that measurement noise cannot masquerade as the thing being measured.
const worstPerCall = (batchSize, totalCalls, run) => {
  let worst = 0;
  for (let done = 0; done < totalCalls; done += batchSize) {
    const t = process.cpuUsage();
    for (let i = 0; i < batchSize; i++) run();
    worst = Math.max(worst, cpuMs(t) / batchSize);
  }
  return worst;
};

test('grid build stays inside 20ms', () => {
  for (let i = 0; i < 10; i++) { const p = prepare(`warm-${i}`); buildNavGrid(p.plan, p.placements); }
  // A grid build is itself several milliseconds of real work — comfortably
  // above the measurement noise above — so a single call per sample is
  // already reliable here; no batching needed.
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const p = prepare(`grid-${i}`);
    const t = process.cpuUsage();
    buildNavGrid(p.plan, p.placements);
    worst = Math.max(worst, cpuMs(t));
  }
  assert.ok(worst < 20, `worst grid build ${worst.toFixed(1)}ms CPU, budget 20ms`);
});

test('a path query stays inside 3ms', () => {
  const p = prepare('query');
  const grid = buildNavGrid(p.plan, p.placements);
  const open = () => true;
  for (let i = 0; i < 20; i++) findPath(grid, p.mission.spawns.swat[0], p.mission.spawns.hostage, open);
  const worst = worstPerCall(20, 100,
    () => findPath(grid, p.mission.spawns.swat[0], p.mission.spawns.hostage, open));
  assert.ok(worst < 3, `worst path query ${worst.toFixed(2)}ms CPU, budget 3ms`);
});

test('headless simulation runs faster than 1000 ticks per second', () => {
  // This number is what makes the reinforcement-learning option honest rather
  // than aspirational: RL needs an environment that steps thousands of times a
  // second with no renderer attached. If this fails, RL was never realistic
  // here, and that is worth knowing now rather than after building toward it.
  const p = prepare('throughput');
  const world = createWorld(p.plan, p.mission, p.placements);
  const orders = createOrders(p.plan, p.mission);
  for (let i = 0; i < 600; i++) { world.tick(); orders.update(world); }

  const start = process.cpuUsage();
  const TICKS = 6000;
  for (let i = 0; i < TICKS; i++) { world.tick(); orders.update(world); }
  const elapsed = cpuMs(start) / 1000;
  const rate = TICKS / elapsed;
  assert.ok(rate > 1000,
    `headless throughput ${Math.round(rate)} ticks/s (CPU time), budget 1000 — reinforcement learning would not be viable at this speed`);
});

test('a single tick with twelve agents stays inside 2ms', () => {
  const p = prepare('tick');
  const world = createWorld(p.plan, p.mission, p.placements);
  const orders = createOrders(p.plan, p.mission);
  for (let i = 0; i < 600; i++) { world.tick(); orders.update(world); }
  // A single tick with this cast is only ~0.01ms of real work — two orders
  // of magnitude below cpuUsage's own noise floor — so this is exactly the
  // case worstPerCall's batching exists for; 50 ticks per sample keeps the
  // batch itself well under the 2ms budget while diluting the per-call
  // measurement noise to a small fraction of it.
  const worst = worstPerCall(50, 2000, () => { world.tick(); orders.update(world); });
  assert.ok(worst < 2, `worst tick ${worst.toFixed(2)}ms CPU, budget 2ms`);
});
