import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createDirector, MISSION_LIMIT } from '../sim/director.js';

const build = (seed, rooms = 10) => {
  const plan = generateFloorplan(seed, { targetRooms: rooms });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, director: createDirector(plan, mission) };
};

test('a fresh director is searching with no result', () => {
  const { director } = build('fresh');
  assert.equal(director.phase, 'search');
  assert.equal(director.result, null);
  assert.equal(director.reason, null);
  assert.equal(director.hostageReached, false);
});

test('the objective names a real cell to clear', () => {
  const { plan, world, director } = build('objective');
  director.update(world);
  const o = director.objective;
  assert.equal(o.kind, 'clear');
  assert.ok(plan.cells.some((c) => c.id === o.cellId), 'objective cell is not in the plan');
  assert.ok(Number.isFinite(o.point.x) && Number.isFinite(o.point.z));
});

test('a wiped squad fails as squad-lost, not as a timeout', () => {
  const { world, director } = build('wipe');
  for (let i = 0; i < 60; i++) director.update(world);
  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.hp = 0; a.alive = false; }
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'squad-lost');
});

test('a dead hostage fails as hostage-killed', () => {
  const { world, director } = build('hostage-dead');
  for (let i = 0; i < 60; i++) director.update(world);
  const hostage = world.agents.find((a) => a.role === 'hostage');
  hostage.hp = 0; hostage.alive = false;
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'hostage-killed');
});

test('the mission clock fails as timeout and cannot be outrun', () => {
  // Freeze every agent so nothing can ever progress. Without a clock this
  // would run forever -- which is exactly the guarantee orders.js's leg
  // watchdogs used to provide and which this replaces.
  const { world, director } = build('timeout');
  const frozen = world.agents.map((a) => ({ x: a.x, z: a.z }));
  let ticks = 0;
  while (director.result === null && ticks < MISSION_LIMIT + 600) {
    world.tick();
    world.agents.forEach((a, i) => { a.x = frozen[i].x; a.z = frozen[i].z; });
    director.update(world);
    ticks++;
  }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'timeout');
  assert.ok(ticks <= MISSION_LIMIT + 1,
    `the clock let the mission run ${ticks} ticks past its ${MISSION_LIMIT} limit`);
});

test('visited grows as the squad enters cells and never shrinks', () => {
  const { world, director } = build('visited');
  // Nothing gives squad members goals at this stage (Task 3 does); set one
  // manually here so members actually move and can be observed entering cells.
  for (const a of world.agents.filter((x) => x.role === 'swat')) {
    const other = world.agents.find((x) => x.role === 'hostage');
    world.setGoal(a.id, { x: other.x, z: other.z });
  }
  let previous = 0;
  for (let i = 0; i < 1200; i++) {
    world.tick(); director.update(world);
    assert.ok(director.visited.size >= previous, 'visited shrank');
    previous = director.visited.size;
  }
  assert.ok(director.visited.size >= 1, 'the squad never registered entering any cell');
});

test('hostiles still patrol', () => {
  const { world, director } = build('patrol');
  const start = world.agents.filter((a) => a.role === 'hostile').map((a) => ({ id: a.id, x: a.x, z: a.z }));
  for (let i = 0; i < 900; i++) { world.tick(); director.update(world); }
  const moved = world.agents
    .filter((a) => a.role === 'hostile' && a.alive)
    .filter((a) => {
      const s = start.find((p) => p.id === a.id);
      return Math.hypot(a.x - s.x, a.z - s.z) > 0.5;
    });
  assert.ok(moved.length >= 2, `only ${moved.length} hostiles moved — patrol did not survive the move out of orders.js`);
});

test('the director is deterministic', () => {
  const a = build('determinism');
  const b = build('determinism');
  for (let i = 0; i < 900; i++) {
    a.world.tick(); a.director.update(a.world);
    b.world.tick(); b.director.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.director.phase, b.director.phase);
});
