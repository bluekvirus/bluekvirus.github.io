import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles, CAST } from '../roles.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `mission-${i}`);
const inside = (p, cell) =>
  p.x >= cell.x && p.x <= cell.x + cell.w && p.z >= cell.z && p.z <= cell.z + cell.d;

test('the same plan always yields the same mission', () => {
  const plan = generateFloorplan('stable');
  assert.deepEqual(assignRoles(plan), assignRoles(plan));
});

test('the cast is exactly 4 SWAT, 7 hostiles and 1 hostage', () => {
  for (const seed of SEEDS) {
    const { spawns } = assignRoles(generateFloorplan(seed));
    assert.equal(spawns.swat.length, CAST.swat, `${seed}: wrong SWAT count`);
    assert.equal(spawns.hostiles.length, CAST.hostiles, `${seed}: wrong hostile count`);
    assert.ok(spawns.hostage, `${seed}: no hostage`);
  }
});

test('the hostage room is at least 3 doors from the entry', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    assert.ok(m.depth[m.hostageRoomId] >= 3,
      `${seed}: hostage only ${m.depth[m.hostageRoomId]} doors deep`);
  }
});

test('hostage depth holds at every room count the HUD offers', () => {
  // The slider reaches 8, and a naive entry rule fails 10% of seeds there while
  // looking perfect at the default of 10. Sweep the range, not just the default.
  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 60; i++) {
      const plan = generateFloorplan(`hud-${rooms}-${i}`, { targetRooms: rooms });
      const m = assignRoles(plan);
      assert.ok(m.depth[m.hostageRoomId] >= 3,
        `${rooms} rooms, seed ${i}: hostage only ${m.depth[m.hostageRoomId]} doors deep`);
    }
  }
});

test('the entry room touches the perimeter', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    const cell = plan.cells.find((c) => c.id === m.entryId);
    const b = plan.bounds;
    const near = 1e-6;
    const onEdge = Math.abs(cell.x - b.x) < near
      || Math.abs(cell.z - b.z) < near
      || Math.abs((cell.x + cell.w) - (b.x + b.w)) < near
      || Math.abs((cell.z + cell.d) - (b.z + b.d)) < near;
    assert.ok(onEdge, `${seed}: entry cell ${cell.id} is not on the perimeter`);
  }
});

test('every spawn sits inside the cell it claims', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const byId = new Map(plan.cells.map((c) => [c.id, c]));
    const { spawns } = assignRoles(plan);
    for (const s of [...spawns.swat, ...spawns.hostiles, spawns.hostage]) {
      assert.ok(inside(s, byId.get(s.cellId)),
        `${seed}: spawn at ${s.x.toFixed(1)},${s.z.toFixed(1)} escapes cell ${s.cellId}`);
    }
  }
});

test('the hostage is in the hostage room and guarded', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    assert.equal(m.spawns.hostage.cellId, m.hostageRoomId,
      `${seed}: hostage is not in the hostage room`);
    const guards = m.spawns.hostiles.filter((h) => h.cellId === m.hostageRoomId).length;
    assert.ok(guards >= 1, `${seed}: hostage room has no guard`);
  }
});

test('exactly two hostiles guard the hostage room', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    const guards = m.spawns.hostiles.filter((h) => h.cellId === m.hostageRoomId).length;
    assert.equal(guards, 2, `${seed}: ${guards} hostiles in the hostage room`);
  }
});

test('no two spawns land on top of each other', () => {
  for (const seed of SEEDS) {
    const { spawns } = assignRoles(generateFloorplan(seed));
    const all = [...spawns.swat, ...spawns.hostiles, spawns.hostage];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const gap = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
        assert.ok(gap >= 0.55, `${seed}: spawns ${i} and ${j} are ${gap.toFixed(2)}m apart`);
      }
    }
  }
});
