import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { roomOrder, nextRoom, graphDistance } from '../sim/search.js';

// A hand-made four-cell chain: 0 - 1 - 2 - 3. Hand-made rather than generated
// because "which room is two hops away" must be obvious by inspection for the
// test to prove anything.
const chain = {
  seed: 'chain',
  cells: [
    { id: 0, x: 0, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 1, x: 4, z: 0, w: 4, d: 4, kind: 'corridor' },
    { id: 2, x: 8, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 3, x: 12, z: 0, w: 4, d: 4, kind: 'room' },
  ],
  adjacency: { 0: [1], 1: [0, 2], 2: [1, 3], 3: [2] },
};

test('graphDistance counts hops through the door graph', () => {
  const d = graphDistance(chain, 0);
  assert.equal(d.get(0), 0);
  assert.equal(d.get(1), 1);
  assert.equal(d.get(2), 2);
  assert.equal(d.get(3), 3);
});

test('nextRoom picks the nearest unvisited cell, not merely the lowest id', () => {
  // Standing at 3, cell 2 is one hop and cell 0 is three. Lowest-id-wins would
  // wrongly answer 0, so this distinguishes distance from id ordering.
  assert.equal(nextRoom(chain, new Set(), 3), 2);
});

test('nextRoom breaks distance ties on the lower id', () => {
  // 1 and 3 are both one hop from 2.
  assert.equal(nextRoom(chain, new Set([2]), 2), 1);
});

// The chain fixture above lists its cells in ascending id order (0, 1, 2, 3),
// so "first cell reached in `plan.cells` array order" and "lowest id" happen
// to be the exact same answer — a tie-break test built on it can pass even if
// the actual `d === bestDist && cell.id < best` clause is deleted outright,
// leaving nextRoom silently fall back to array order instead of id order.
// This fixture is the same 0-1-2-3 topology with `cells` declared in
// descending id order, so the two rules disagree: array order would answer
// 3 (the first same-distance cell iterated), id order (the documented
// contract) answers 1.
const reversedChain = {
  seed: 'reversed-chain',
  cells: [
    { id: 3, x: 12, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 2, x: 8, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 1, x: 4, z: 0, w: 4, d: 4, kind: 'corridor' },
    { id: 0, x: 0, z: 0, w: 4, d: 4, kind: 'room' },
  ],
  adjacency: { 0: [1], 1: [0, 2], 2: [1, 3], 3: [2] },
};

test('nextRoom breaks distance ties on the lower id, not on cells array order', () => {
  // 1 and 3 are both one hop from 2, but this fixture iterates 3 before 1 —
  // array-order-wins would answer 3, id-order-wins (the real contract)
  // answers 1.
  assert.equal(nextRoom(reversedChain, new Set([2]), 2), 1);
});

test('nextRoom returns -1 once everything is visited', () => {
  assert.equal(nextRoom(chain, new Set([0, 1, 2, 3]), 0), -1);
});

test('nextRoom skips visited cells', () => {
  assert.equal(nextRoom(chain, new Set([2]), 3), 1);
});

test('roomOrder covers every cell exactly once', () => {
  for (const seed of ['cover-a', 'cover-b', 'cover-c']) {
    const plan = generateFloorplan(seed, { targetRooms: 10 });
    const order = roomOrder(plan);
    assert.equal(new Set(order).size, order.length, `${seed}: a cell repeats`);
    assert.equal(order.length, plan.cells.length,
      `${seed}: swept ${order.length} of ${plan.cells.length} cells`);
  }
});

test('roomOrder is deterministic', () => {
  const plan = generateFloorplan('determinism', { targetRooms: 11 });
  assert.deepEqual(roomOrder(plan), roomOrder(plan));
});
