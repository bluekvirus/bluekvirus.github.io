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

test('grid build stays inside 20ms', () => {
  for (let i = 0; i < 10; i++) { const p = prepare(`warm-${i}`); buildNavGrid(p.plan, p.placements); }
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const p = prepare(`grid-${i}`);
    const t = performance.now();
    buildNavGrid(p.plan, p.placements);
    worst = Math.max(worst, performance.now() - t);
  }
  assert.ok(worst < 20, `worst grid build ${worst.toFixed(1)}ms, budget 20ms`);
});

test('a path query stays inside 3ms', () => {
  const p = prepare('query');
  const grid = buildNavGrid(p.plan, p.placements);
  const open = () => true;
  for (let i = 0; i < 20; i++) findPath(grid, p.mission.spawns.swat[0], p.mission.spawns.hostage, open);
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    findPath(grid, p.mission.spawns.swat[0], p.mission.spawns.hostage, open);
    worst = Math.max(worst, performance.now() - t);
  }
  assert.ok(worst < 3, `worst path query ${worst.toFixed(2)}ms, budget 3ms`);
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

  const start = performance.now();
  const TICKS = 6000;
  for (let i = 0; i < TICKS; i++) { world.tick(); orders.update(world); }
  const elapsed = (performance.now() - start) / 1000;
  const rate = TICKS / elapsed;
  assert.ok(rate > 1000,
    `headless throughput ${Math.round(rate)} ticks/s, budget 1000 — reinforcement learning would not be viable at this speed`);
});

test('a single tick with twelve agents stays inside 2ms', () => {
  const p = prepare('tick');
  const world = createWorld(p.plan, p.mission, p.placements);
  const orders = createOrders(p.plan, p.mission);
  for (let i = 0; i < 600; i++) { world.tick(); orders.update(world); }
  let worst = 0;
  for (let i = 0; i < 2000; i++) {
    const t = performance.now();
    world.tick();
    orders.update(world);
    worst = Math.max(worst, performance.now() - t);
  }
  assert.ok(worst < 2, `worst tick ${worst.toFixed(2)}ms, budget 2ms`);
});
