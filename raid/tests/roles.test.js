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

test('the hostage spawns at its room\'s exact centre', () => {
  // raid/sim/director.js's search-phase correctness depends on this: a cell
  // is only marked "searched" once a member is within sight range of its
  // CENTRE (not merely inside it), which is only a sound proxy for "the
  // hostage would have been seen" because the hostage sits exactly there.
  // That coupling is documented in director.js's markVisited comment but
  // nothing enforces it — a future change here (e.g. scattering the hostage
  // like every other spawn) would silently reopen the exact "swept the room,
  // never saw the hostage" bug that fix closed. Caught this way instead of
  // only in director.test.js so whoever edits roles.js sees the failure in
  // the file they are actually changing.
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    const room = plan.cells.find((c) => c.id === m.hostageRoomId);
    const centreX = room.x + room.w / 2;
    const centreZ = room.z + room.d / 2;
    const off = Math.hypot(m.spawns.hostage.x - centreX, m.spawns.hostage.z - centreZ);
    assert.ok(off < 1e-9,
      `${seed}: hostage sits ${off.toFixed(3)}m off room ${room.id}'s centre`);
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

test('hostile weapon distribution is deterministic and includes both kinds', () => {
  // The weapon assignment is seed-invariant by construction: CAST.hostiles is a
  // frozen module constant (7), and the formula (i < 2 ? 'gun' : (i % 2 === 0 ?
  // 'gun' : 'melee')) depends only on the loop index. Result: guns at indices
  // 0, 1, 2, 4, 6 and melee at 3, 5. This test asserts that invariant explicitly
  // so that changing CAST.hostiles fails loudly rather than silently reshuffling
  // the mix.
  const mission = assignRoles(generateFloorplan('distribution-test'));
  const weapons = mission.spawns.hostiles.map((h) => h.weapon);

  assert.deepEqual(weapons, ['gun', 'gun', 'gun', 'melee', 'gun', 'melee', 'gun'],
    'hostile weapon distribution must be: guns at indices 0,1,2,4,6 and melee at 3,5');
});

test('every figure is issued a valid weapon field', () => {
  for (const seed of SEEDS) {
    const mission = assignRoles(generateFloorplan(seed));

    for (const s of mission.spawns.swat) {
      assert.equal(s.weapon, 'gun', `${seed}: a SWAT member is not carrying a gun`);
    }
    assert.equal(mission.spawns.hostage.weapon, 'none');

    const kinds = mission.spawns.hostiles.map((h) => h.weapon);
    assert.ok(kinds.every((k) => k === 'gun' || k === 'melee'),
      `${seed}: a hostile has an unknown weapon: ${JSON.stringify(kinds)}`);
  }
});

test('the two hostage guards are always armed with guns', () => {
  // A melee guard standing over the hostage would charge the squad the moment
  // it entered the room, abandoning the objective it exists to defend. The
  // guards are the two hostiles sharing the hostage's room.
  for (const seed of SEEDS) {
    const mission = assignRoles(generateFloorplan(seed));
    const guards = mission.spawns.hostiles.filter((h) => h.cellId === mission.hostageRoomId);
    assert.equal(guards.length, 2, `${seed}: expected exactly 2 hostage guards`);
    for (const g of guards) {
      assert.equal(g.weapon, 'gun', `${seed}: a hostage guard is carrying a melee weapon`);
    }
  }
});
