import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan, FLOORPLAN_DEFAULTS } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid, NAV_DEFAULTS } from '../sim/navgrid.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `nav-${i}`);
const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return { plan, mission, grid: buildNavGrid(plan, layoutProps(plan, mission)) };
};

test('grid covers the footprint', () => {
  const { plan, grid } = build('cover');
  assert.ok(grid.cols * grid.cell >= plan.bounds.w, 'too few columns for the footprint');
  assert.ok(grid.rows * grid.cell >= plan.bounds.d, 'too few rows for the footprint');
});

test('world and cell coordinates round-trip', () => {
  const { grid } = build('roundtrip');
  for (let col = 0; col < grid.cols; col += 7) {
    for (let row = 0; row < grid.rows; row += 7) {
      const w = grid.cellToWorld(col, row);
      const c = grid.worldToCell(w.x, w.z);
      assert.equal(c.col, col, 'column did not round-trip');
      assert.equal(c.row, row, 'row did not round-trip');
    }
  }
});

test('wall interiors are blocked', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const { plan, grid } = build(seed);
    for (const wall of plan.walls) {
      const c = grid.worldToCell(wall.x + wall.w / 2, wall.z + wall.d / 2);
      assert.equal(grid.isBlocked(c.col, c.row), true,
        `${seed}: centre of a wall segment is walkable`);
    }
  }
});

test('door cells are tagged and not blocked', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const { plan, grid } = build(seed);
    for (const door of plan.doors) {
      const c = grid.worldToCell(door.x, door.z);
      assert.equal(grid.doorAt(c.col, c.row), door.id,
        `${seed}: door ${door.id} centre is not tagged with its id`);
      assert.equal(grid.isBlocked(c.col, c.row), false,
        `${seed}: door ${door.id} centre is blocked, so nobody could ever pass`);
    }
  }
});

test('prop footprints are blocked', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const { plan, mission, grid } = build(seed);
    for (const p of layoutProps(plan, mission)) {
      const c = grid.worldToCell(p.x, p.z);
      assert.equal(grid.isBlocked(c.col, c.row), true,
        `${seed}: a prop centre is walkable`);
    }
  }
});

test('every spawn stands on a walkable cell', () => {
  for (const seed of SEEDS) {
    const { mission, grid } = build(seed);
    const all = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
    for (const s of all) {
      const c = grid.worldToCell(s.x, s.z);
      assert.equal(grid.isBlocked(c.col, c.row), false,
        `${seed}: a figure spawned inside a blocked cell at ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    }
  }
});

test('building the grid is deterministic', () => {
  const a = build('same').grid;
  const b = build('same').grid;
  assert.deepEqual([...a.blocked], [...b.blocked]);
  assert.deepEqual([...a.door], [...b.door]);
});

test('defaults are frozen', () => {
  assert.throws(() => { NAV_DEFAULTS.cell = 1; });
});

// Doorway re-opening (buildNavGrid's "across" reach for a door, see that
// file) has to reach past the agent-radius erosion carve() applies to every
// room, or a doorway would never actually reopen and every room would seal
// shut. At today's defaults that margin is wallThickness/2 + cell (0.325)
// over agentRadius (0.32) — only 5mm. Nothing else pins that relationship,
// so tuning either constant in isolation could silently reverse it, sealing
// every doorway in the game with no test catching it until agents started
// freezing at their own room's exit. This pins the relationship, not the
// exact numbers, so either constant can still move as long as the other
// moves with it.
test('door re-opening reach clears the agent-radius erosion', () => {
  const across = FLOORPLAN_DEFAULTS.wallThickness / 2 + NAV_DEFAULTS.cell;
  assert.ok(across > NAV_DEFAULTS.agentRadius,
    `door reach ${across} does not clear the agent radius erosion ${NAV_DEFAULTS.agentRadius} — doorways would seal shut`);
});
