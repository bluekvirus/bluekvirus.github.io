import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan, FLOORPLAN_DEFAULTS } from '../floorplan.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

test('the same seed produces an identical plan', () => {
  const a = generateFloorplan('repeat');
  const b = generateFloorplan('repeat');
  assert.deepEqual(a.cells, b.cells);
});

test('different seeds produce different plans', () => {
  const a = JSON.stringify(generateFloorplan('one').cells);
  const b = JSON.stringify(generateFloorplan('two').cells);
  assert.notEqual(a, b);
});

test('room count lands in the spec range on every seed', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const rooms = plan.cells.filter((c) => c.kind === 'room').length;
    assert.ok(rooms >= 8 && rooms <= 12, `${seed} produced ${rooms} rooms`);
  }
});

test('no two cells overlap', () => {
  for (const seed of SEEDS) {
    const { cells } = generateFloorplan(seed);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        assert.ok(!overlaps(cells[i], cells[j]),
          `${seed}: cell ${cells[i].id} overlaps ${cells[j].id}`);
      }
    }
  }
});

test('every cell sits inside the footprint', () => {
  for (const seed of SEEDS) {
    const { cells, bounds } = generateFloorplan(seed);
    for (const c of cells) {
      assert.ok(c.x >= bounds.x - 1e-9 && c.z >= bounds.z - 1e-9
        && c.x + c.w <= bounds.x + bounds.w + 1e-9
        && c.z + c.d <= bounds.z + bounds.d + 1e-9,
        `${seed}: cell ${c.id} escapes the footprint`);
    }
  }
});

test('no room is thinner than the minimum side', () => {
  for (const seed of SEEDS) {
    const { cells, config } = generateFloorplan(seed);
    for (const c of cells.filter((x) => x.kind === 'room')) {
      assert.ok(Math.min(c.w, c.d) >= config.minRoomSide - 1e-9,
        `${seed}: room ${c.id} is ${Math.min(c.w, c.d).toFixed(2)}m thin`);
    }
  }
});

test('corridors are produced and are the configured width', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { cells, config } = generateFloorplan(seed);
    const corridors = cells.filter((c) => c.kind === 'corridor');
    assert.ok(corridors.length > 0, `${seed} produced no corridor`);
    for (const c of corridors) {
      assert.ok(Math.abs(Math.min(c.w, c.d) - config.corridorWidth) < 1e-9,
        `${seed}: corridor ${c.id} is ${Math.min(c.w, c.d)}m wide`);
    }
  }
});

test('overrides are honoured', () => {
  const plan = generateFloorplan('override', { width: 20, depth: 20 });
  assert.equal(plan.bounds.w, 20);
  assert.equal(plan.bounds.d, 20);
});

test('defaults are frozen so a caller cannot corrupt later generations', () => {
  assert.throws(() => { FLOORPLAN_DEFAULTS.width = 1; });
});
