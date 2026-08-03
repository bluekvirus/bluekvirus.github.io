import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { findPath } from '../sim/path.js';
import { createWorld } from '../sim/world.js';
import { createDirector } from '../sim/director.js';
import { createSquad } from '../sim/squad.js';

const prepare = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  const placements = layoutProps(plan, mission);
  return { plan, mission, placements };
};

// Exactly what main.js runs every tick, in exactly the order main.js runs it:
// world, then director, then squad. Before the phase D cutover the two budget
// tests below drove `createOrders`, which no longer exists — and driving only
// the world (or only the director) would leave squad.js's per-tick cost
// unmeasured, which is precisely the cost that matters: its `nearestWalkable`
// ring search and its staggered `world.setGoal` A* query are the two most
// expensive things in the loop, and orders.js was itself once caught blowing
// this budget by firing four A* queries in a single tick.
//
// Missions are pre-built in a pool and rotated as each one resolves, because a
// resolved mission is nearly free to tick: `director.update` returns on its
// first line, the squad has nobody left to command, and the dead or parked
// agents run the cheapest path through `world.tick`. The seeds these tests use
// resolve at around tick 2350, so the throughput test's 6,600-tick window
// would otherwise have spent 71% of its measurement on a finished mission and
// reported a throughput number that no live mission could actually sustain.
// The rotation is a pointer move — no allocation inside the measured region;
// every world, grid and plan is built up front, outside it.
//
// `exhausted` is what keeps that honest: if the pool ever runs dry the driver
// keeps ticking the last, already-resolved mission, and the tests below assert
// it never happened rather than silently going back to measuring a dead world.
const driver = (seed, count = 8) => {
  const missions = [];
  for (let i = 0; i < count; i++) {
    const p = prepare(`${seed}-${i}`);
    missions.push({
      world: createWorld(p.plan, p.mission, p.placements),
      director: createDirector(p.plan, p.mission),
      squad: createSquad(p.plan),
    });
  }
  let at = 0;
  const state = { exhausted: false, used: 1 };
  return {
    get exhausted() { return state.exhausted; },
    get used() { return state.used; },
    tick: () => {
      if (missions[at].director.result !== null) {
        if (at + 1 < missions.length) { at++; state.used++; } else { state.exhausted = true; }
      }
      const m = missions[at];
      m.world.tick();
      m.director.update(m.world);
      m.squad.update(m.world, m.director.objective);
    },
  };
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
  const sim = driver('throughput');
  for (let i = 0; i < 600; i++) sim.tick();

  const start = process.cpuUsage();
  const TICKS = 6000;
  for (let i = 0; i < TICKS; i++) sim.tick();
  const elapsed = cpuMs(start) / 1000;
  const rate = TICKS / elapsed;
  assert.equal(sim.exhausted, false,
    'the throughput window outran its pool of live missions and finished by ticking a resolved one — the number below is not a live-simulation rate');
  assert.ok(sim.used > 1, 'test setup: the mission pool never rotated, so nothing checked that rotation works');
  assert.ok(rate > 1000,
    `headless throughput ${Math.round(rate)} ticks/s (CPU time), budget 1000 — reinforcement learning would not be viable at this speed`);
});

test('a single tick with twelve agents stays inside 2ms', () => {
  const sim = driver('tick');
  for (let i = 0; i < 600; i++) sim.tick();
  // A single tick with this cast is only ~0.01ms of real work — two orders
  // of magnitude below cpuUsage's own noise floor — so this is exactly the
  // case worstPerCall's batching exists for; 50 ticks per sample keeps the
  // batch itself well under the 2ms budget while diluting the per-call
  // measurement noise to a small fraction of it.
  const worst = worstPerCall(50, 2000, sim.tick);
  assert.equal(sim.exhausted, false,
    'the per-tick window outran its pool of live missions and finished by ticking a resolved one');
  assert.ok(worst < 2, `worst tick ${worst.toFixed(2)}ms CPU, budget 2ms`);
});
