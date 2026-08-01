import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { findPath, smoothPath, hasLineOfSight } from '../sim/path.js';

const SEEDS = Array.from({ length: 100 }, (_, i) => `path-${i}`);
const open = () => true;
const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return { plan, mission, grid: buildNavGrid(plan, layoutProps(plan, mission)) };
};

test('a path exists from the entry to the hostage on every seed', () => {
  for (const seed of SEEDS) {
    const { mission, grid } = build(seed);
    const path = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
    assert.ok(path && path.length > 0, `${seed}: no route from entry to hostage`);
  }
});

test('paths never pass through a blocked cell', () => {
  for (const seed of SEEDS) {
    const { mission, grid } = build(seed);
    const path = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
    for (const p of path) {
      const c = grid.worldToCell(p.x, p.z);
      assert.equal(grid.isBlocked(c.col, c.row), false,
        `${seed}: path crosses a blocked cell`);
    }
  }
});

test('smoothing shortens the path without leaving the walkable area', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const { mission, grid } = build(seed);
    const raw = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
    const smooth = smoothPath(grid, raw, open);
    assert.ok(smooth.length <= raw.length, `${seed}: smoothing added waypoints`);
    for (let i = 1; i < smooth.length; i++) {
      assert.ok(hasLineOfSight(grid, smooth[i - 1], smooth[i], open),
        `${seed}: smoothed segment ${i} cuts through geometry`);
    }
  }
});

test('smoothing keeps the endpoints', () => {
  const { mission, grid } = build('ends');
  const raw = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
  const smooth = smoothPath(grid, raw, open);
  assert.deepEqual(smooth[0], raw[0]);
  assert.deepEqual(smooth.at(-1), raw.at(-1));
});

test('a closed door blocks the route through it', () => {
  const { plan, mission, grid } = build('closed');
  const all = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
  assert.ok(all, 'baseline route should exist');
  // Shut every door: the hostage room is at least 3 doors deep, so no route
  // can survive.
  const none = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, () => false);
  assert.equal(none, null, 'a route was found with every door shut');
});

test('unreachable goals return null rather than hanging', () => {
  const { grid, mission } = build('unreachable');
  const outside = { x: grid.originX - 50, z: grid.originZ - 50 };
  assert.equal(findPath(grid, mission.spawns.swat[0], outside, open), null);
});

test('pathfinding is deterministic', () => {
  const { mission, grid } = build('det');
  const a = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
  const b = findPath(grid, mission.spawns.swat[0], mission.spawns.hostage, open);
  assert.deepEqual(a, b);
});
