import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan, FLOORPLAN_DEFAULTS } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid, nearestWalkable, NAV_DEFAULTS } from '../sim/navgrid.js';

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

// --- nearestWalkable's own contract ---
//
// It became public API at the phase D cutover, when squad.js's private copy
// and orders.js's were consolidated here. Both callers (squad.js for every
// member destination, director.js for the hostage's walk to the exit) exercise
// it heavily, but only behaviourally — nothing pinned the contract itself, and
// the properties below are exactly the ones a caller silently depends on. In
// particular the determinism one: this runs inside a simulation whose whole
// replay guarantee is that the same seed produces the same hash.

test('nearestWalkable leaves an already-walkable point exactly as it found it', () => {
  const { grid } = build('nw-open');
  // Find a genuinely open cell and ask about a point inside it that is NOT
  // the cell centre, so a version that snapped to the grid would be caught.
  let probe = null;
  for (let row = 0; row < grid.rows && !probe; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.isBlocked(col, row)) continue;
      const c = grid.cellToWorld(col, row);
      probe = { x: c.x + grid.cell * 0.17, z: c.z - grid.cell * 0.11 };
      break;
    }
  }
  assert.ok(probe, 'test setup: the grid has no open cell at all');
  const pc = grid.worldToCell(probe.x, probe.z);
  assert.equal(grid.isBlocked(pc.col, pc.row), false,
    'test setup: the offset pushed the probe point off its open cell');
  const got = nearestWalkable(grid, probe.x, probe.z);
  assert.equal(got.x, probe.x, 'an open point was moved in x');
  assert.equal(got.z, probe.z, 'an open point was moved in z');
});

test('nearestWalkable returns an open cell when the point is blocked', () => {
  const { grid } = build('nw-blocked');
  let blocked = null;
  for (let row = 1; row < grid.rows - 1 && !blocked; row++) {
    for (let col = 1; col < grid.cols - 1; col++) {
      // A blocked cell with an open neighbour, so there is something to find.
      if (!grid.isBlocked(col, row)) continue;
      if (grid.isBlocked(col + 1, row) && grid.isBlocked(col - 1, row)
        && grid.isBlocked(col, row + 1) && grid.isBlocked(col, row - 1)) continue;
      blocked = { col, row };
      break;
    }
  }
  assert.ok(blocked, 'test setup: no blocked cell with an open neighbour');
  const p = grid.cellToWorld(blocked.col, blocked.row);
  const got = nearestWalkable(grid, p.x, p.z);
  const gc = grid.worldToCell(got.x, got.z);
  assert.equal(grid.isBlocked(gc.col, gc.row), false,
    'nearestWalkable handed back a cell that is still blocked');
  // Ring 1 had an open neighbour, so the answer must come from ring 1 — a
  // scan that widened before exhausting the current ring would return
  // something further away and still pass a bare "is it open" check.
  assert.ok(Math.max(Math.abs(gc.col - blocked.col), Math.abs(gc.row - blocked.row)) === 1,
    'nearestWalkable skipped past an open cell in the first ring');
});

test('nearestWalkable is deterministic', () => {
  // The simulation's replay guarantee runs through this function on every
  // squad destination, so "same grid, same point, same answer" is not a nicety.
  const { grid } = build('nw-determinism');
  for (let row = 0; row < grid.rows; row += 7) {
    for (let col = 0; col < grid.cols; col += 7) {
      const p = grid.cellToWorld(col, row);
      const a = nearestWalkable(grid, p.x, p.z);
      const b = nearestWalkable(grid, p.x, p.z);
      assert.deepEqual(a, b, `nearestWalkable disagreed with itself at (${col},${row})`);
    }
  }
});

test('nearestWalkable gives the original point back when the ring search is exhausted', () => {
  // The documented fallback: a genuinely unreachable target must fail the same
  // way it always would, not be quietly relocated across the building. Forced
  // with maxRing = 0 against a blocked point, so no ring is ever scanned.
  const { grid } = build('nw-exhausted');
  let blocked = null;
  for (let row = 0; row < grid.rows && !blocked; row++) {
    for (let col = 0; col < grid.cols; col++) if (grid.isBlocked(col, row)) { blocked = { col, row }; break; }
  }
  assert.ok(blocked, 'test setup: the grid has no blocked cell');
  const p = grid.cellToWorld(blocked.col, blocked.row);
  const got = nearestWalkable(grid, p.x, p.z, 0);
  assert.equal(got.x, p.x, 'an exhausted search moved the point in x instead of giving it back');
  assert.equal(got.z, p.z, 'an exhausted search moved the point in z instead of giving it back');
});

test('nearestWalkable treats out of bounds as blocked and walks back onto the grid', () => {
  // grid.isBlocked reports true for anything out of bounds, which is what lets
  // a point off the edge of the map ring-search its way back to real floor
  // rather than being handed straight back as if it were walkable.
  const { plan, grid } = build('nw-oob');
  const outside = { x: plan.bounds.x - 3, z: plan.bounds.z - 3 };
  const oc = grid.worldToCell(outside.x, outside.z);
  assert.equal(grid.inBounds(oc.col, oc.row), false, 'test setup: the probe point is not actually off-grid');
  assert.equal(grid.isBlocked(oc.col, oc.row), true, 'out of bounds must read as blocked');
  const got = nearestWalkable(grid, outside.x, outside.z);
  const gc = grid.worldToCell(got.x, got.z);
  assert.equal(grid.inBounds(gc.col, gc.row), true, 'nearestWalkable stayed off the grid');
  assert.equal(grid.isBlocked(gc.col, gc.row), false, 'nearestWalkable handed back a blocked cell');
});
