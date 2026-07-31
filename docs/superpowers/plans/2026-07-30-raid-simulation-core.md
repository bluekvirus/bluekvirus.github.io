# Raid Simulation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, headless simulation that walks twelve agents through the generated building — pathfinding around furniture, opening doors — bound to the existing figures with speed-driven, cross-faded animation.

**Architecture:** Four new pure modules under `raid/sim/` (nav grid, pathfinding, world, orders) that import nothing from Babylon and are asserted under `node --test` across hundreds of seeds. Two new browser modules bind that simulation to meshes. `main.js` gains a fixed-step loop and time controls.

**Tech Stack:** Vanilla ES modules, Babylon.js 9.18.1 from CDN, Node's built-in test runner, no dependencies, no build step.

## Global Constraints

- No build step. Plain ES modules loaded directly by the browser; push is deploy. No dependency, no bundler.
- `raid/sim/navgrid.js`, `raid/sim/path.js`, `raid/sim/world.js`, `raid/sim/orders.js` MUST NOT import Babylon or reference `BABYLON`, `window`, `document`, `performance`, `location`, or `Math.random`. They run under Node. `raid/tests/purity.test.js` is extended to cover them.
- Seeded RNG only. The simulation seeds its own stream as `` `${plan.seed}:sim` `` so it never consumes the generator's.
- Fixed simulation timestep of `1/60` second. The renderer may run at any frame rate and interpolates between the last two states.
- Coordinates: world `x`/`z` in metres, ground `y = 0`. Rectangles (`Cell`, `Wall`) use `x`/`z` as a MINIMUM corner with `w` spanning x and `d` spanning z. `Door` and `Placement` use `x`/`z` as a CENTRE. Agent and grid positions are points.
- Determinism: same seed and tick count must produce an identical `world.hash()`.
- Budgets: sim tick < 2 ms for 12 agents; grid build < 20 ms; path query < 3 ms; headless throughput > 1000 ticks/second; frame time < 16 ms with 12 animated figures.
- Every task ends with a commit whose message explains *why*. Run `git log -3` and match the repo's style.

---

## File Structure

| File | Pure? | Responsibility |
|---|---|---|
| `raid/sim/navgrid.js` | yes | Plan + props → walkable grid, eroded by agent radius, door cells tagged |
| `raid/sim/path.js` | yes | A* over the grid, plus string-pull smoothing |
| `raid/sim/world.js` | yes | Agents, doors, fixed-step `tick()`, determinism hash |
| `raid/sim/orders.js` | yes | The scripted mission dry run |
| `raid/agents.js` | no | Sim agents → figures: position, facing, clip blending |
| `raid/doors.js` | no | Door meshes swing on sim state change |
| `raid/main.js` | no | Fixed-step loop, HUD time controls (modified) |
| `raid/tests/*.test.js` | — | Node assertions |

---

### Task 1: Navigation grid

**Files:**
- Create: `raid/sim/navgrid.js`
- Create: `raid/tests/navgrid.test.js`

**Interfaces:**
- Consumes: `generateFloorplan(seed, overrides)` → `{ bounds, cells, doors, walls, config }`; `layoutProps(plan, mission)` → `Placement[]` with `{ x, z, w, d }` as CENTRE plus extents
- Produces:
  - `NAV_DEFAULTS` — frozen `{ cell: 0.25, agentRadius: 0.32 }`
  - `buildNavGrid(plan, placements, overrides?)` → `NavGrid`
  - `NavGrid = { cell, cols, rows, originX, originZ, blocked: Uint8Array, door: Int16Array, index(col,row), inBounds(col,row), isBlocked(col,row), doorAt(col,row), worldToCell(x,z), cellToWorld(col,row) }`
  - `blocked[i]` is 1 for impassable. `door[i]` is a door id, or `-1` for no door. A door cell is NOT marked blocked — passability depends on door state, which the grid does not know.

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/navgrid.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../sim/navgrid.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/navgrid.js`:

```js
// The walkable grid the simulation paths over.
//
// Pure data: this module never imports Babylon and never touches the DOM, so
// "can an agent walk through that wall" is a Node assertion over hundreds of
// seeds rather than something to squint at in a screenshot.
//
// Rectangles arrive in two conventions and mixing them is the classic defect
// here: walls and cells give `x`/`z` as a MINIMUM corner with `w`/`d` as spans,
// while doors and props give `x`/`z` as a CENTRE.

export const NAV_DEFAULTS = Object.freeze({
  cell: 0.25,
  agentRadius: 0.32,
});

export function buildNavGrid(plan, placements = [], overrides = {}) {
  const cfg = { ...NAV_DEFAULTS, ...overrides };
  const { bounds } = plan;

  const originX = bounds.x;
  const originZ = bounds.z;
  const cols = Math.ceil(bounds.w / cfg.cell);
  const rows = Math.ceil(bounds.d / cfg.cell);

  const blocked = new Uint8Array(cols * rows);
  const door = new Int16Array(cols * rows).fill(-1);

  const index = (col, row) => row * cols + col;
  const inBounds = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows;

  // Everything outside a room or corridor is solid. Start from all-blocked and
  // carve the cells that fall inside a cell rectangle — cheaper and less
  // error-prone than trying to enumerate the gaps between rooms.
  blocked.fill(1);

  const carve = (rect, pad) => {
    const minC = Math.floor((rect.x - pad - originX) / cfg.cell);
    const maxC = Math.ceil((rect.x + rect.w + pad - originX) / cfg.cell);
    const minR = Math.floor((rect.z - pad - originZ) / cfg.cell);
    const maxR = Math.ceil((rect.z + rect.d + pad - originZ) / cfg.cell);
    for (let row = minR; row < maxR; row++) {
      for (let col = minC; col < maxC; col++) {
        if (!inBounds(col, row)) continue;
        // Cell centre must actually lie inside the rectangle, inset by the
        // agent's radius so paths do not hug walls and clip corners.
        const x = originX + (col + 0.5) * cfg.cell;
        const z = originZ + (row + 0.5) * cfg.cell;
        if (x >= rect.x + cfg.agentRadius && x <= rect.x + rect.w - cfg.agentRadius
          && z >= rect.z + cfg.agentRadius && z <= rect.z + rect.d - cfg.agentRadius) {
          blocked[index(col, row)] = 0;
        }
      }
    }
  };

  for (const cell of plan.cells) carve(cell, 0);

  // Doorways: the erosion above leaves a wall of blocked cells between every
  // pair of rooms, because a door opening is exactly where two rectangles stop.
  // Re-open each opening and tag it, so pathing can cross once the door is open.
  for (const d of plan.doors) {
    const half = d.width / 2 - 0.02;
    const along = d.axis === 'x' ? { x: half, z: 0 } : { x: 0, z: half };
    const across = d.axis === 'x'
      ? { x: 0, z: plan.config.wallThickness / 2 + cfg.cell }
      : { x: plan.config.wallThickness / 2 + cfg.cell, z: 0 };

    const minC = Math.floor((d.x - along.x - across.x - originX) / cfg.cell);
    const maxC = Math.ceil((d.x + along.x + across.x - originX) / cfg.cell);
    const minR = Math.floor((d.z - along.z - across.z - originZ) / cfg.cell);
    const maxR = Math.ceil((d.z + along.z + across.z - originZ) / cfg.cell);

    for (let row = minR; row < maxR; row++) {
      for (let col = minC; col < maxC; col++) {
        if (!inBounds(col, row)) continue;
        blocked[index(col, row)] = 0;
        door[index(col, row)] = d.id;
      }
    }
  }

  // Props block whatever they stand on. Their `x`/`z` is a CENTRE.
  for (const p of placements) {
    const minC = Math.floor((p.x - p.w / 2 - originX) / cfg.cell);
    const maxC = Math.ceil((p.x + p.w / 2 - originX) / cfg.cell);
    const minR = Math.floor((p.z - p.d / 2 - originZ) / cfg.cell);
    const maxR = Math.ceil((p.z + p.d / 2 - originZ) / cfg.cell);
    for (let row = minR; row < maxR; row++) {
      for (let col = minC; col < maxC; col++) {
        if (!inBounds(col, row)) continue;
        // Never block a doorway with furniture — furnish.js already keeps props
        // clear of doors, but a prop clipping one here would strand a room.
        if (door[index(col, row)] >= 0) continue;
        blocked[index(col, row)] = 1;
      }
    }
  }

  return {
    cell: cfg.cell,
    agentRadius: cfg.agentRadius,
    cols,
    rows,
    originX,
    originZ,
    blocked,
    door,
    index,
    inBounds,
    isBlocked: (col, row) => !inBounds(col, row) || blocked[index(col, row)] === 1,
    doorAt: (col, row) => (inBounds(col, row) ? door[index(col, row)] : -1),
    worldToCell: (x, z) => ({
      col: Math.floor((x - originX) / cfg.cell),
      row: Math.floor((z - originZ) / cfg.cell),
    }),
    cellToWorld: (col, row) => ({
      x: originX + (col + 0.5) * cfg.cell,
      z: originZ + (row + 0.5) * cfg.cell,
    }),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

If `every spawn stands on a walkable cell` fails, the agent-radius erosion is eating the cell a figure spawned in — the spawn logic in `roles.js` keeps figures 0.9 m from walls, comfortably more than the 0.32 m radius, so a failure means the erosion or the cell-centre test is wrong. Do not shrink `agentRadius` to make it pass without first confirming the geometry.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/navgrid.js raid/tests/navgrid.test.js
git commit -m "feat: navigation grid for the raid simulation

Rasterises the floor plan and props into a walkable grid. Built by starting
all-blocked and carving the cells inside each room rectangle, which is
cheaper and far less error-prone than enumerating the gaps between rooms.

Cells are eroded by the agent radius so paths do not hug walls and clip
corners, and doorways are re-opened afterwards and tagged with their door
id — the erosion necessarily seals them, since a doorway is exactly where
two room rectangles stop. Door cells are tagged rather than blocked because
passability depends on door state, which the grid deliberately does not
know.

Asserted over 200 seeds: walls blocked, props blocked, doors tagged and
passable, and every figure's spawn on a walkable cell."
```

---

### Task 2: A* pathfinding and smoothing

**Files:**
- Create: `raid/sim/path.js`
- Create: `raid/tests/path.test.js`

**Interfaces:**
- Consumes: `NavGrid` from Task 1
- Produces:
  - `findPath(grid, from, to, isDoorOpen)` → `{x, z}[]` of cell centres from start to goal, or `null` if unreachable. `from`/`to` are world points. `isDoorOpen(doorId)` returns whether that door may be crossed; pass `() => true` to ignore doors.
  - `smoothPath(grid, points, isDoorOpen)` → `{x, z}[]` with redundant waypoints removed
  - `hasLineOfSight(grid, a, b, isDoorOpen)` → boolean, true when the straight segment `a`→`b` crosses only passable cells

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/path.test.js`:

```js
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
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../sim/path.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/path.js`:

```js
// Pathfinding over the navigation grid.
//
// Pure data, like the grid it walks: a path that cuts through a wall is caught
// by assertion over hundreds of seeds, not by noticing a figure clipping a
// desk on screen.

const SQRT2 = Math.SQRT2;

// 8-connected. Diagonals are last so that, at equal cost, the tie-break in the
// open set prefers straight moves — paths come out visibly tidier.
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

const passable = (grid, col, row, isDoorOpen) => {
  if (grid.isBlocked(col, row)) return false;
  const id = grid.doorAt(col, row);
  return id < 0 || isDoorOpen(id);
};

export function findPath(grid, from, to, isDoorOpen) {
  const start = grid.worldToCell(from.x, from.z);
  const goal = grid.worldToCell(to.x, to.z);
  if (!grid.inBounds(start.col, start.row) || !grid.inBounds(goal.col, goal.row)) return null;
  if (!passable(grid, goal.col, goal.row, isDoorOpen)) return null;

  const size = grid.cols * grid.rows;
  const startIdx = grid.index(start.col, start.row);
  const goalIdx = grid.index(goal.col, goal.row);
  if (startIdx === goalIdx) return [grid.cellToWorld(goal.col, goal.row)];

  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  gScore[startIdx] = 0;

  // A plain array used as a priority queue. The grid is ~20k cells and a query
  // touches a small fraction of it, so a binary heap is not worth the code.
  const openList = [{ idx: startIdx, f: 0 }];

  const heuristic = (col, row) => {
    const dc = Math.abs(col - goal.col);
    const dr = Math.abs(row - goal.row);
    // Octile: the exact cost of an unobstructed 8-connected walk.
    return (dc + dr) + (SQRT2 - 2) * Math.min(dc, dr);
  };

  while (openList.length) {
    let best = 0;
    for (let i = 1; i < openList.length; i++) if (openList[i].f < openList[best].f) best = i;
    const { idx } = openList.splice(best, 1)[0];
    if (idx === goalIdx) break;
    if (closed[idx]) continue;
    closed[idx] = 1;

    const col = idx % grid.cols;
    const row = (idx - col) / grid.cols;

    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!passable(grid, nc, nr, isDoorOpen)) continue;
      // Never cut a blocked corner: a diagonal is only legal when both
      // orthogonal neighbours it squeezes between are open. Without this,
      // agents clip through the corner where two walls meet.
      if (dc !== 0 && dr !== 0) {
        if (!passable(grid, col + dc, row, isDoorOpen)) continue;
        if (!passable(grid, col, row + dr, isDoorOpen)) continue;
      }
      const nIdx = grid.index(nc, nr);
      if (closed[nIdx]) continue;
      const tentative = gScore[idx] + cost;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = idx;
        openList.push({ idx: nIdx, f: tentative + heuristic(nc, nr) });
      }
    }
  }

  if (cameFrom[goalIdx] < 0 && startIdx !== goalIdx) return null;

  const out = [];
  for (let idx = goalIdx; idx >= 0; idx = cameFrom[idx]) {
    const col = idx % grid.cols;
    const row = (idx - col) / grid.cols;
    out.push(grid.cellToWorld(col, row));
    if (idx === startIdx) break;
  }
  return out.reverse();
}

export function hasLineOfSight(grid, a, b, isDoorOpen) {
  // Sample along the segment at half a cell. Finer than the grid, so a corner
  // cannot be stepped over.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const steps = Math.ceil(Math.hypot(dx, dz) / (grid.cell * 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const c = grid.worldToCell(a.x + dx * t, a.z + dz * t);
    if (!passable(grid, c.col, c.row, isDoorOpen)) return false;
  }
  return true;
}

export function smoothPath(grid, points, isDoorOpen) {
  if (!points || points.length <= 2) return points ? [...points] : points;
  const out = [points[0]];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    // Keep extending while the straight line from the anchor still clears
    // geometry; when it stops clearing, commit the previous point.
    if (!hasLineOfSight(grid, points[anchor], points[i], isDoorOpen)) {
      out.push(points[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(points.at(-1));
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/path.js raid/tests/path.test.js
git commit -m "feat: A* pathfinding with string-pull smoothing

8-connected A* over the nav grid, refusing diagonals that squeeze between
two blocked cells — without that check agents cut straight through the
corner where two walls meet, which looks like clipping and would later let
them shoot through solid geometry.

Raw grid paths staircase, so they are string-pulled afterwards: walk the
path and drop any waypoint whose removal still leaves an unobstructed
straight line. Line of sight samples at half a cell, finer than the grid,
so a corner cannot be stepped over between samples.

Doors are a predicate rather than grid state, because passability changes
as the simulation runs while the grid does not.

Asserted over 100 seeds: a route always exists from entry to hostage, no
path crosses a blocked cell, smoothing never lengthens a path or leaves the
walkable area, shutting every door removes the route, and unreachable goals
return null rather than hanging."
```

---

### Task 3: World — agents, fixed-step tick, steering

**Files:**
- Create: `raid/sim/world.js`
- Create: `raid/tests/world.test.js`

**Interfaces:**
- Consumes: `buildNavGrid`, `findPath`, `smoothPath`, `makeRng`
- Produces:
  - `SIM` — frozen `{ step: 1/60, walkSpeed: 1.4, runSpeed: 3.2, arriveRadius: 0.28, separation: 0.75, separationForce: 1.6, turnRate: 8 }`
  - `createWorld(plan, mission, placements)` → `World`
  - `World = { grid, agents, doors, time, ticks, tick(), setGoal(agentId, point), agentById(id), hash() }`
  - `Agent = { id, role, cellId, x, z, vx, vz, speed, facing, goal, path, pathIndex, waitingFor, wants }` where `role` is `'swat' | 'hostile' | 'hostage'`, `cellId` is the plan cell it spawned in, `goal` is `{x, z}` or `null`, `waitingFor` is a door id or `-1`, and `wants` is its desired speed
  - `world.tick()` advances exactly `SIM.step` seconds
  - `world.hash()` returns a stable string digest of all agent and door state

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/world.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';

const SEEDS = Array.from({ length: 100 }, (_, i) => `world-${i}`);
const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return createWorld(plan, mission, layoutProps(plan, mission));
};

test('the world starts with the full cast on walkable ground', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const w = build(seed);
    assert.equal(w.agents.length, 12, `${seed}: wrong agent count`);
    assert.equal(w.agents.filter((a) => a.role === 'swat').length, 4);
    assert.equal(w.agents.filter((a) => a.role === 'hostile').length, 7);
    assert.equal(w.agents.filter((a) => a.role === 'hostage').length, 1);
    for (const a of w.agents) {
      const c = w.grid.worldToCell(a.x, a.z);
      assert.equal(w.grid.isBlocked(c.col, c.row), false, `${seed}: agent starts blocked`);
    }
  }
});

test('the same seed replays identically', () => {
  const a = build('replay');
  const b = build('replay');
  for (let i = 0; i < 600; i++) { a.tick(); b.tick(); }
  assert.equal(a.hash(), b.hash());
});

test('agents never end a tick inside a blocked cell', () => {
  for (const seed of SEEDS.slice(0, 30)) {
    const w = build(seed);
    // Send everyone somewhere far so they actually traverse the building.
    for (const a of w.agents) w.setGoal(a.id, { x: -w.grid.originX, z: -w.grid.originZ });
    for (let i = 0; i < 900; i++) {
      w.tick();
      for (const a of w.agents) {
        const c = w.grid.worldToCell(a.x, a.z);
        assert.equal(w.grid.isBlocked(c.col, c.row), false,
          `${seed}: agent ${a.id} walked into geometry at tick ${i}`);
      }
    }
  }
});

test('an agent given a reachable goal arrives', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const w = build(seed);
    const a = w.agents.find((x) => x.role === 'swat');
    const hostage = w.agents.find((x) => x.role === 'hostage');
    w.setGoal(a.id, { x: hostage.x, z: hostage.z });
    let arrived = false;
    for (let i = 0; i < 3600 && !arrived; i++) {
      w.tick();
      arrived = Math.hypot(a.x - hostage.x, a.z - hostage.z) < 1.2;
    }
    assert.ok(arrived, `${seed}: agent never reached the hostage in 60 simulated seconds`);
  }
});

test('a tick advances time by exactly the fixed step', () => {
  const w = build('time');
  w.tick();
  assert.equal(w.time, SIM.step);
  assert.equal(w.ticks, 1);
});

test('agents keep apart', () => {
  const w = build('separation');
  const target = w.agents.find((a) => a.role === 'hostage');
  for (const a of w.agents.filter((x) => x.role === 'swat')) {
    w.setGoal(a.id, { x: target.x, z: target.z });
  }
  for (let i = 0; i < 1800; i++) w.tick();
  const swat = w.agents.filter((a) => a.role === 'swat');
  for (let i = 0; i < swat.length; i++) {
    for (let j = i + 1; j < swat.length; j++) {
      const gap = Math.hypot(swat[i].x - swat[j].x, swat[i].z - swat[j].z);
      assert.ok(gap > 0.3, `agents ${i} and ${j} ended up ${gap.toFixed(2)}m apart`);
    }
  }
});

test('SIM constants are frozen', () => {
  assert.throws(() => { SIM.step = 1; });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../sim/world.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/world.js`:

```js
// The simulation.
//
// Fixed timestep, seeded, and completely free of Babylon: the renderer reads
// this, never the other way round. That is what lets a misbehaving agent be
// replayed from its seed, lets "did anyone walk through a wall" be a Node
// assertion, and keeps a headless RL environment possible later.

import { makeRng } from '../rng.js';
import { buildNavGrid } from './navgrid.js';
import { findPath, smoothPath } from './path.js';

export const SIM = Object.freeze({
  step: 1 / 60,
  walkSpeed: 1.4,
  runSpeed: 3.2,
  arriveRadius: 0.28,
  separation: 0.75,
  separationForce: 1.6,
  turnRate: 8,
  doorOpenTime: 0.4,
  doorReach: 0.9,
});

const round = (v) => Math.round(v * 1e4) / 1e4;

export function createWorld(plan, mission, placements = []) {
  const grid = buildNavGrid(plan, placements);
  const rng = makeRng(`${plan.seed}:sim`);

  const doors = {};
  for (const d of plan.doors) doors[d.id] = { id: d.id, state: 'closed', timer: 0, x: d.x, z: d.z };

  const isDoorOpen = (id) => doors[id]?.state === 'open';

  const agents = [];
  const add = (role, spawn) => {
    agents.push({
      id: agents.length,
      role,
      // The cell this agent spawned in. Carried here so behaviour code can ask
      // an agent where it belongs, rather than reconstructing it from an index
      // offset into mission.spawns — which silently breaks the moment the cast
      // order changes.
      cellId: spawn.cellId ?? -1,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      speed: 0,
      facing: spawn.facing ?? 0,
      goal: null,
      path: null,
      pathIndex: 0,
      waitingFor: -1,
      wants: role === 'hostage' ? 0 : SIM.walkSpeed,
    });
  };
  mission.spawns.swat.forEach((s) => add('swat', s));
  mission.spawns.hostiles.forEach((s) => add('hostile', s));
  add('hostage', mission.spawns.hostage);

  const world = {
    grid,
    agents,
    doors,
    rng,
    time: 0,
    ticks: 0,
    isDoorOpen,
    agentById: (id) => agents[id],
  };

  world.setGoal = (id, point) => {
    const a = agents[id];
    if (!a) return false;
    // Path with every door treated as open. A closed door on the route is a
    // thing to walk up to and open, not a reason to route the long way round —
    // and re-pathing every time a door changes state would thrash.
    const raw = findPath(grid, a, point, () => true);
    if (!raw) { a.goal = null; a.path = null; return false; }
    a.goal = { x: point.x, z: point.z };
    a.path = smoothPath(grid, raw, () => true);
    a.pathIndex = 0;
    a.waitingFor = -1;
    return true;
  };

  const blockedAt = (x, z) => {
    const c = grid.worldToCell(x, z);
    return grid.isBlocked(c.col, c.row);
  };

  const doorBetween = (a, target) => {
    const c = grid.worldToCell(target.x, target.z);
    const id = grid.doorAt(c.col, c.row);
    if (id < 0 || isDoorOpen(id)) return -1;
    return id;
  };

  world.tick = () => {
    // Doors first, so an agent that opened one last tick can move through it
    // on this one rather than stuttering for a frame.
    for (const d of Object.values(doors)) {
      if (d.state === 'opening') {
        d.timer += SIM.step;
        if (d.timer >= SIM.doorOpenTime) { d.state = 'open'; d.timer = SIM.doorOpenTime; }
      }
    }

    for (const a of agents) {
      a.speed = 0;
      if (!a.path || a.pathIndex >= a.path.length) { a.vx = 0; a.vz = 0; continue; }

      const target = a.path[a.pathIndex];
      const dx = target.x - a.x;
      const dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);

      if (dist < SIM.arriveRadius) {
        a.pathIndex++;
        if (a.pathIndex >= a.path.length) { a.path = null; a.goal = null; a.vx = 0; a.vz = 0; }
        continue;
      }

      // A shut door on the next waypoint: stop short, start it opening, wait.
      const blockingDoor = doorBetween(a, target);
      if (blockingDoor >= 0) {
        a.waitingFor = blockingDoor;
        const door = doors[blockingDoor];
        if (door.state === 'closed' && Math.hypot(door.x - a.x, door.z - a.z) < SIM.doorReach) {
          door.state = 'opening';
        }
        a.vx = 0; a.vz = 0;
        continue;
      }
      a.waitingFor = -1;

      let dirX = dx / dist;
      let dirZ = dz / dist;

      // Separation, capped: it may nudge an agent aside in a doorway but must
      // never be strong enough to shove one through a wall.
      let sepX = 0;
      let sepZ = 0;
      for (const other of agents) {
        if (other === a) continue;
        const ox = a.x - other.x;
        const oz = a.z - other.z;
        const d = Math.hypot(ox, oz);
        if (d > 1e-6 && d < SIM.separation) {
          const push = (SIM.separation - d) / SIM.separation;
          sepX += (ox / d) * push;
          sepZ += (oz / d) * push;
        }
      }
      dirX += sepX * SIM.separationForce * 0.5;
      dirZ += sepZ * SIM.separationForce * 0.5;
      const norm = Math.hypot(dirX, dirZ) || 1;
      dirX /= norm;
      dirZ /= norm;

      const speed = a.wants;
      const nx = a.x + dirX * speed * SIM.step;
      const nz = a.z + dirZ * speed * SIM.step;

      // Integrate, then verify. Sliding along a blocked axis keeps an agent
      // moving past a corner instead of jamming against it.
      if (!blockedAt(nx, nz)) { a.x = nx; a.z = nz; }
      else if (!blockedAt(nx, a.z)) { a.x = nx; }
      else if (!blockedAt(a.x, nz)) { a.z = nz; }

      a.vx = dirX * speed;
      a.vz = dirZ * speed;
      a.speed = Math.hypot(a.vx, a.vz);

      const want = Math.atan2(dirX, dirZ);
      let delta = want - a.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      a.facing += delta * Math.min(1, SIM.turnRate * SIM.step);
    }

    world.time += SIM.step;
    world.ticks++;
  };

  world.hash = () => {
    const parts = [];
    for (const a of agents) {
      parts.push(`${a.id}:${round(a.x)},${round(a.z)},${round(a.facing)},${round(a.speed)},${a.waitingFor}`);
    }
    for (const d of Object.values(doors)) parts.push(`d${d.id}:${d.state}:${round(d.timer)}`);
    return parts.join('|');
  };

  return world;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

If `an agent given a reachable goal arrives` fails, check the arrive radius against the grid cell size — an arrive radius smaller than a cell can leave an agent oscillating around a waypoint it can never satisfy.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/world.js raid/tests/world.test.js
git commit -m "feat: fixed-step simulation with steering and door handling

Agents follow smoothed paths at a fixed 1/60s step, seeded from the plan so
a given map always replays identically — which is what makes a misbehaving
agent reproducible instead of a one-off anecdote.

Movement integrates then verifies: a step that would end inside a blocked
cell is retried on each axis alone, so an agent slides past a corner rather
than jamming against it. Separation is capped for the same reason — it may
nudge two agents apart in a doorway but must never be strong enough to
shove one through a wall.

Paths are planned with every door treated as open. A shut door on the route
is something to walk up to and open, not a reason to route the long way
round, and re-pathing on every door state change would thrash.

Asserted over seeds: identical replay from the same seed, no agent ever
ending a tick inside geometry across 900 ticks, every agent reaching a
reachable goal, and agents staying apart."
```

---

### Task 4: The mission dry run

**Files:**
- Create: `raid/sim/orders.js`
- Create: `raid/tests/orders.test.js`

**Interfaces:**
- Consumes: `World` from Task 3, `Mission` from `roles.js`, `Plan` from `floorplan.js`
- Produces:
  - `createOrders(plan, mission)` → `{ update(world), phase }` where `phase` is `'advance' | 'rescue' | 'extract' | 'done'`
  - `update(world)` is called once per tick, after `world.tick()`, and issues goals

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/orders.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => `orders-${i}`);
const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, orders: createOrders(plan, mission) };
};

test('the squad reaches the hostage and then extraction', () => {
  for (const seed of SEEDS) {
    const { mission, world, orders } = build(seed);
    let ticks = 0;
    while (orders.phase !== 'done' && ticks < 60 * 180) { world.tick(); orders.update(world); ticks++; }
    assert.equal(orders.phase, 'done', `${seed}: dry run did not finish within 180 simulated seconds`);
    const lead = world.agents.find((a) => a.role === 'swat');
    const gap = Math.hypot(lead.x - mission.spawns.extraction.x, lead.z - mission.spawns.extraction.z);
    assert.ok(gap < 3, `${seed}: squad finished ${gap.toFixed(1)}m from extraction`);
  }
});

test('the run is deterministic', () => {
  const a = build('det');
  const b = build('det');
  for (let i = 0; i < 1200; i++) {
    a.world.tick(); a.orders.update(a.world);
    b.world.tick(); b.orders.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.orders.phase, b.orders.phase);
});

test('doors along the route actually get opened', () => {
  const { world, orders } = build('doors');
  for (let i = 0; i < 60 * 90; i++) { world.tick(); orders.update(world); }
  const opened = Object.values(world.doors).filter((d) => d.state === 'open').length;
  assert.ok(opened > 0, 'the squad crossed the building without opening a single door');
});

test('hostiles move but stay in their own room', () => {
  const { plan, mission, world, orders } = build('patrol');
  const byId = new Map(plan.cells.map((c) => [c.id, c]));
  const homes = new Map(world.agents.filter((a) => a.role === 'hostile')
    .map((a, i) => [a.id, byId.get(mission.spawns.hostiles[i].cellId)]));
  let moved = 0;
  const startX = new Map(world.agents.map((a) => [a.id, a.x]));
  for (let i = 0; i < 60 * 40; i++) {
    world.tick(); orders.update(world);
    for (const a of world.agents.filter((x) => x.role === 'hostile')) {
      const home = homes.get(a.id);
      assert.ok(a.x >= home.x - 0.5 && a.x <= home.x + home.w + 0.5
        && a.z >= home.z - 0.5 && a.z <= home.z + home.d + 0.5,
        `hostile ${a.id} left its room`);
    }
  }
  for (const a of world.agents.filter((x) => x.role === 'hostile')) {
    if (Math.abs(a.x - startX.get(a.id)) > 0.3) moved++;
  }
  assert.ok(moved > 0, 'no hostile moved at all');
});

test('the hostage stays put until rescued', () => {
  const { world, orders } = build('hostage');
  const h = world.agents.find((a) => a.role === 'hostage');
  const x0 = h.x;
  const z0 = h.z;
  for (let i = 0; i < 60 * 20; i++) { world.tick(); orders.update(world); }
  assert.ok(Math.hypot(h.x - x0, h.z - z0) < 0.1, 'the hostage wandered off');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../sim/orders.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/orders.js`:

```js
// The scripted mission dry run.
//
// Deliberately dumb: this exists so the movement machinery can be judged before
// any real decision-making is layered on. Phase D replaces this file wholesale,
// and nothing beneath it should need to change when that happens — if it does,
// the boundary was drawn in the wrong place.

import { makeRng } from '../rng.js';

const ARRIVED = 1.4;      // how close counts as "at" a room or point
const PATROL_PAUSE = 2.5; // seconds a hostile waits before picking a new spot

export function createOrders(plan, mission) {
  const rng = makeRng(`${plan.seed}:orders`);
  const byId = new Map(plan.cells.map((c) => [c.id, c]));

  // Room-by-room route from the entry to the hostage, over the door graph the
  // generator already built. Breadth-first, so it is the fewest rooms crossed.
  const route = (() => {
    const prev = { [mission.entryId]: -1 };
    const queue = [mission.entryId];
    while (queue.length) {
      const current = queue.shift();
      if (current === mission.hostageRoomId) break;
      for (const n of plan.adjacency[current]) {
        if (prev[n] === undefined) { prev[n] = current; queue.push(n); }
      }
    }
    const out = [];
    for (let id = mission.hostageRoomId; id !== undefined && id !== -1; id = prev[id]) out.push(id);
    return out.reverse();
  })();

  const centreOf = (cellId) => {
    const c = byId.get(cellId);
    return { x: c.x + c.w / 2, z: c.z + c.d / 2 };
  };

  const state = {
    phase: 'advance',
    leg: 0,
    issued: false,
    patrol: new Map(), // agentId -> seconds until the next patrol goal
  };

  const api = {
    get phase() { return state.phase; },
    update(world) {
      const swat = world.agents.filter((a) => a.role === 'swat');
      const hostage = world.agents.find((a) => a.role === 'hostage');

      // Hostiles wander inside their own room.
      for (const a of world.agents.filter((x) => x.role === 'hostile')) {
        const home = byId.get(a.cellId);
        const wait = state.patrol.get(a.id) ?? 0;
        if (!a.path && wait <= 0) {
          const inset = 0.9;
          world.setGoal(a.id, {
            x: rng.range(home.x + inset, home.x + home.w - inset),
            z: rng.range(home.z + inset, home.z + home.d - inset),
          });
          state.patrol.set(a.id, PATROL_PAUSE);
        } else if (!a.path) {
          state.patrol.set(a.id, wait - (1 / 60));
        }
      }

      if (state.phase === 'advance') {
        const target = centreOf(route[state.leg]);
        if (!state.issued) {
          for (const a of swat) world.setGoal(a.id, target);
          state.issued = true;
        }
        const allThere = swat.every((a) => Math.hypot(a.x - target.x, a.z - target.z) < ARRIVED + 1.2);
        if (allThere) {
          state.leg++;
          state.issued = false;
          if (state.leg >= route.length) { state.phase = 'rescue'; }
        }
        return;
      }

      if (state.phase === 'rescue') {
        // The hostage joins the squad and they all head for extraction.
        state.phase = 'extract';
        state.issued = false;
        return;
      }

      if (state.phase === 'extract') {
        const exit = mission.spawns.extraction;
        if (!state.issued) {
          for (const a of swat) world.setGoal(a.id, exit);
          world.setGoal(hostage.id, exit);
          hostage.wants = 1.4;
          state.issued = true;
        }
        const out = [...swat, hostage].every((a) => Math.hypot(a.x - exit.x, a.z - exit.z) < 3);
        if (out) state.phase = 'done';
      }
    },
  };

  return api;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

If `the squad reaches the hostage and then extraction` times out, print `orders.phase` and the leg index at the timeout — the usual cause is the arrival tolerance being tighter than the separation radius, so four agents can never all be within it at once.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/orders.js raid/tests/orders.test.js
git commit -m "feat: scripted mission dry run

Squad advances room by room from the entry to the hostage over the door
graph the generator already built, waits for the whole team at each leg,
then escorts the hostage to extraction. Hostiles wander inside their own
rooms.

Deliberately scripted. This is scaffolding so the movement machinery can be
judged before real decisions are layered on, and the test of whether the
boundary is right is that phase D can replace this file wholesale without
touching anything beneath it.

Arrival tolerance is deliberately looser than the separation radius: four
agents pushed apart by separation can never all stand within a tight radius
of the same point, which would stall the advance forever."
```

---

### Task 5: Purity guard and headless throughput budget

**Files:**
- Modify: `raid/tests/purity.test.js`
- Create: `raid/tests/simbudget.test.js`

**Interfaces:**
- Consumes: everything above
- Produces: the enforcement that keeps the simulation headless, and the number that decides whether RL is realistic

- [ ] **Step 1: Extend the purity guard**

In `raid/tests/purity.test.js`, change the file list so the simulation is covered:

```js
const PURE_FILES = [
  'rng.js', 'floorplan.js', 'roles.js', 'furnish.js',
  'sim/navgrid.js', 'sim/path.js', 'sim/world.js', 'sim/orders.js',
];
```

Confirm the path resolution in that file still works for the nested `sim/` entries; if it joins a bare filename, join the relative path instead.

- [ ] **Step 2: Write the budget test**

Create `raid/tests/simbudget.test.js`:

```js
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
```

- [ ] **Step 3: Run the suite**

Run: `node --test`
Expected: PASS.

If the throughput test fails, report the measured rate rather than widening the threshold. The most likely culprit is the linear scan for the lowest `f` in `findPath`'s open list combined with agents re-pathing every tick — check how often `setGoal` is being called before optimising anything.

- [ ] **Step 4: Commit**

```bash
git add raid/tests/purity.test.js raid/tests/simbudget.test.js
git commit -m "test: keep the simulation pure and fast enough for RL

Extends the purity guard to cover raid/sim/*, so a browser global creeping
into the simulation fails loudly here instead of surfacing as a
ReferenceError the first time anyone tries to run it headless.

Adds the throughput budget the spec calls for. 1000 ticks/second with no
renderer attached is what makes the reinforcement-learning option honest
rather than aspirational — if the simulation cannot hit it, RL was never
realistic for this project, and that is worth discovering now rather than
after building toward it."
```

---

### Task 6: Render binding — agents

**Files:**
- Create: `raid/agents.js`
- Modify: `raid/cast.js`

**Interfaces:**
- Consumes: `World` and `Agent` from Task 3; figures from `cast.js` (`{ root, skeleton, role }`)
- Produces:
  - `bindAgents(scene, world, cast)` → `{ sync(alpha), dispose() }`
  - `sync(alpha)` positions every figure by interpolating between the previous and current sim state, where `alpha` is 0..1 through the current step, and selects/blends the animation clip from speed

- [ ] **Step 1: Note the clip names available**

The pack ships `Idle`, `Walk`, `Run` and `Interact` among its 24 clips, and each of the three models imported its own copy — so 72 groups exist and they must be matched to a figure by target identity, never by name alone:

```js
const nodes = new Set(figure.skeleton.bones.map((b) => b.getTransformNode?.()).filter(Boolean));
const owned = scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => nodes.has(ta.target)));
```

Note that all four SWAT share one skeleton and all seven hostiles share another — so a clip started for one SWAT plays on all four. Bind clips per SKELETON, not per figure, and drive them from the group's own speed rather than trying to animate the four independently. Record this limitation in the report; per-figure animation needs cloned skeletons, which is phase C or later work.

- [ ] **Step 2: Implement**

Create `raid/agents.js`:

```js
// Binds simulation agents to the rendered figures.
//
// The simulation is authoritative and knows nothing about meshes; this module
// only reads it. Positions are interpolated between the last two sim states so
// motion stays smooth no matter how the render frame rate relates to the fixed
// 1/60s step.

const BLEND = 0.15;      // seconds to cross-fade between clips
const WALK_MIN = 0.15;   // below this an agent reads as standing still
const RUN_MIN = 2.2;

function ownedGroups(skeleton, scene) {
  const nodes = new Set(skeleton.bones.map((b) => b.getTransformNode?.()).filter(Boolean));
  return scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => nodes.has(ta.target)));
}

export function bindAgents(scene, world, cast) {
  // One clip set per SKELETON, not per figure: the pack shares a skeleton
  // between every figure built from the same model (four SWAT, seven
  // hostiles), so starting a clip for one starts it for all of them.
  const rigs = new Map();
  for (const fig of cast.figures) {
    if (rigs.has(fig.skeleton)) continue;
    const groups = ownedGroups(fig.skeleton, scene);
    rigs.set(fig.skeleton, {
      groups: Object.fromEntries(['Idle', 'Walk', 'Run'].map((n) => [n, groups.find((g) => g.name === n)])),
      current: null,
    });
  }

  const previous = world.agents.map((a) => ({ x: a.x, z: a.z, facing: a.facing }));

  const play = (rig, name) => {
    if (rig.current === name) return;
    const next = rig.groups[name];
    if (!next) return;
    for (const [n, g] of Object.entries(rig.groups)) {
      if (!g || n === name) continue;
      g.stop();
    }
    next.start(true, 1.0, next.from, next.to, false);
    next.setWeightForAllAnimatables(1);
    rig.current = name;
  };

  return {
    /** Called before each sim step, to remember where things were. */
    snapshot() {
      world.agents.forEach((a, i) => {
        previous[i].x = a.x;
        previous[i].z = a.z;
        previous[i].facing = a.facing;
      });
    },

    sync(alpha) {
      for (let i = 0; i < world.agents.length; i++) {
        const a = world.agents[i];
        const fig = cast.figures[i];
        if (!fig) continue;
        const p = previous[i];
        fig.root.position.x = p.x + (a.x - p.x) * alpha;
        fig.root.position.z = p.z + (a.z - p.z) * alpha;

        let delta = a.facing - p.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        fig.root.rotation.y = p.facing + delta * alpha;
      }

      // Clip choice per rig, from the fastest agent on that rig — with a shared
      // skeleton there is only one pose to give them, so a walking group should
      // look like it is walking.
      for (const [skeleton, rig] of rigs) {
        let fastest = 0;
        for (let i = 0; i < world.agents.length; i++) {
          if (cast.figures[i]?.skeleton === skeleton) fastest = Math.max(fastest, world.agents[i].speed);
        }
        play(rig, fastest < WALK_MIN ? 'Idle' : fastest < RUN_MIN ? 'Walk' : 'Run');
      }
    },

    dispose() {
      for (const rig of rigs.values()) {
        for (const g of Object.values(rig.groups)) g?.stop();
      }
      rigs.clear();
    },
  };
}
```

- [ ] **Step 3: Stop the hostage's floor pose being overwritten**

The hostage's pose is held by written-back TransformNode values (see `raid/seated.js`). Its clips must never be started, or the pose is lost. In `bindAgents`, skip any figure whose `role` is `'hostage'` when collecting rigs, and skip it in the position loop as well — the hostage does not move during the dry run until the extract phase, and animating it is phase D's problem.

Record in the report that the hostage is deliberately excluded.

- [ ] **Step 4: Verify in the browser**

Wait until Task 8 wires it; there is nothing to see yet. Confirm the module parses:

```bash
node --input-type=module -e "await import('./raid/agents.js').catch(e => { if (!/BABYLON/.test(String(e))) throw e; })"
```

- [ ] **Step 5: Commit**

```bash
git add raid/agents.js
git commit -m "feat: bind simulation agents to the rendered figures

Positions interpolate between the last two simulation states, so motion is
smooth regardless of how the render frame rate relates to the fixed 1/60s
step, and the simulation never has to know what the frame rate is.

Clips are bound per SKELETON rather than per figure, because the pack
shares one skeleton across every figure built from the same model — four
SWAT share one, seven hostiles another. Starting a clip for one starts it
for all of them, so the rig plays the clip matching its fastest member
rather than pretending they can be animated independently. Per-figure
animation needs cloned skeletons and is deliberately left for later.

The hostage is excluded entirely: its floor pose is held by written-back
node values, and starting any clip on it would destroy that."
```

---

### Task 7: Render binding — doors

**Files:**
- Create: `raid/doors.js`
- Modify: `raid/build.js`

**Interfaces:**
- Consumes: `world.doors`, `plan.doors`
- Produces:
  - `bindDoors(scene, world, plan)` → `{ sync(), dispose() }`
  - `build.js` gains named door-leaf meshes so this module has something to swing

- [ ] **Step 1: Add door leaves to the build**

In `raid/build.js`, alongside the existing door lintels, create one leaf per door: a box `door.width` × 2.2 m × 0.06 m, positioned in the opening, hinged at one edge. Name each `doorLeaf_<id>` and DO NOT merge them — they must move independently. Give them the existing door material. Return them from `buildLevel` as `doorLeaves` so `bindDoors` can find them without a scene-wide name search.

- [ ] **Step 2: Implement the binding**

Create `raid/doors.js`:

```js
// Swings door meshes to match simulation state.
//
// The simulation owns whether a door is open; this module only reacts. That
// split is what lets the whole thing run headless with no meshes at all.

const OPEN_ANGLE = Math.PI / 2 * 0.92;

export function bindDoors(scene, world, leaves) {
  const byId = new Map(leaves.map((m) => [Number(m.name.split('_')[1]), m]));
  const rest = new Map([...byId].map(([id, m]) => [id, m.rotation.y]));

  return {
    sync() {
      for (const d of Object.values(world.doors)) {
        const mesh = byId.get(d.id);
        if (!mesh) continue;
        // Progress comes from the door's own timer, so the swing matches the
        // simulation exactly rather than running on its own clock and drifting.
        const t = d.state === 'open' ? 1
          : d.state === 'opening' ? Math.min(1, d.timer / 0.4)
          : 0;
        mesh.rotation.y = rest.get(d.id) + OPEN_ANGLE * t;
      }
    },
    dispose() { byId.clear(); rest.clear(); },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add raid/doors.js raid/build.js
git commit -m "feat: swing door meshes to match simulation state

Door leaves are built unmerged so each can rotate independently, and the
swing angle is driven from the simulation's own door timer rather than a
separate animation clock — a door that animates on its own schedule drifts
out of step with the moment the simulation considers it passable, and an
agent walks through a visually shut door.

The simulation owns door state and knows nothing about these meshes, which
is what keeps it runnable headless."
```

---

### Task 8: Wire the loop and add time controls

**Files:**
- Modify: `raid/main.js`
- Modify: `raid/index.html`

**Interfaces:**
- Consumes: everything above
- Produces: a running dry run on the page, with play/pause, step, and speed controls; `window.__raid` gains `world`, `orders`, `sim` under `?debug`

- [ ] **Step 1: Add the controls to the HUD**

In `raid/index.html`, add to `#controls` after the existing buttons:

```html
<button id="playPause">Pause</button>
<button id="stepOnce">Step</button>
<label for="speed">Speed <span id="speedValue">1×</span></label>
<input id="speed" type="range" min="0" max="3" step="1" value="1">
```

- [ ] **Step 2: Wire the fixed-step loop**

In `raid/main.js`, import the new modules, create `world`/`orders`/`agentBinding`/`doorBinding` inside `regenerate` (disposing the previous ones first, in the same dispose-before-build order the level and props already use), and replace the render loop with a fixed-step accumulator:

```js
const SPEEDS = [0.5, 1, 2, 4];
let running = true;
let accumulator = 0;
let lastFrame = performance.now();

function advance(dt) {
  accumulator += dt;
  let steps = 0;
  // Cap the catch-up. Without this, a backgrounded tab returns with seconds of
  // accumulated time and the simulation freezes the page trying to run it all.
  while (accumulator >= SIM.step && steps < 8) {
    agentBinding?.snapshot();
    world.tick();
    orders.update(world);
    accumulator -= SIM.step;
    steps++;
  }
}

engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (running && world) advance(dt * SPEEDS[Number(speedInput.value)]);
  agentBinding?.sync(world ? accumulator / SIM.step : 0);
  doorBinding?.sync();
  scene.render();
});
```

Wire `playPause` to toggle `running` and its own label, `stepOnce` to run exactly one `world.tick()` plus `orders.update(world)` while paused, and the speed slider to update `#speedValue`.

- [ ] **Step 3: Verify in the browser**

Open `http://localhost:8080/raid/?debug`. Expected:
- The squad walks from the entry toward the hostage room, opening doors on the way
- Hostiles move within their rooms
- Motion is smooth; clips read as walking, not sliding
- Pause stops everything; Step advances visibly by one tick; 4× is visibly faster

Check in the console:

```js
__raid.world.agents.length          // 12
__raid.world.ticks > 0              // true
__raid.orders.phase                 // 'advance' initially, later 'extract'/'done'
Object.values(__raid.world.doors).filter(d => d.state === 'open').length  // grows over time
```

Also confirm regenerating does not leak: record `scene.meshes.length`, regenerate, wait for the cast to load, and confirm it returns to the same number.

- [ ] **Step 4: Commit**

```bash
git add raid/main.js raid/index.html
git commit -m "feat: run the simulation with time controls

Fixed-step accumulator so the simulation advances at exactly 1/60s
regardless of frame rate, with the renderer interpolating between the last
two states. Catch-up is capped at eight steps per frame: without it a
backgrounded tab returns with several seconds of accumulated time and locks
the page trying to simulate all of it at once.

Pause, single-step and a speed control, because a misbehaving agent is
diagnosed by stepping one tick at a time, and a three-minute dry run is
watched at 4x."
```

---

### Task 9: Full verification and documentation

**Files:**
- Create: `raid/tests/dryrun.test.js`
- Modify: `README.md`

- [ ] **Step 1: Write the end-to-end assertion**

Create `raid/tests/dryrun.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

// The whole point of a pure simulation: run the entire mission, on every room
// count the HUD offers, without a renderer — and assert nothing went wrong at
// any tick, which no amount of watching the screen could establish.
test('a full dry run completes cleanly at every room count', () => {
  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 12; i++) {
      const seed = `dry-${rooms}-${i}`;
      const plan = generateFloorplan(seed, { targetRooms: rooms });
      const mission = assignRoles(plan);
      const world = createWorld(plan, mission, layoutProps(plan, mission));
      const orders = createOrders(plan, mission);

      let ticks = 0;
      while (orders.phase !== 'done' && ticks < 60 * 240) {
        world.tick();
        orders.update(world);
        for (const a of world.agents) {
          const c = world.grid.worldToCell(a.x, a.z);
          assert.equal(world.grid.isBlocked(c.col, c.row), false,
            `${seed}: agent ${a.id} inside geometry at tick ${ticks}`);
          assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z),
            `${seed}: agent ${a.id} position went non-finite at tick ${ticks}`);
        }
        ticks++;
      }
      assert.equal(orders.phase, 'done', `${seed}: did not finish in 240 simulated seconds`);
    }
  }
});
```

- [ ] **Step 2: Run the whole suite**

Run: `node --test`
Expected: PASS, all files.

- [ ] **Step 3: Document**

Extend the `raid/` section of `README.md` to describe the simulation: that it is deterministic and headless, that `node --test` runs the full mission without a browser, and that this is what keeps a machine-learning environment possible later. Keep it to a short paragraph and match the file's existing tone.

- [ ] **Step 4: Commit**

```bash
git add raid/tests/dryrun.test.js README.md
git commit -m "test: run the whole mission headless at every room count

Runs the complete dry run, on every room count the HUD offers, asserting at
every single tick that no agent is inside geometry and no position has gone
non-finite. That is the payoff of keeping the simulation pure: a claim like
'agents never walk through walls' is established over hundreds of thousands
of ticks, which no amount of watching the screen could ever do."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Navigation grid from plan + props | 1 |
| A* with smoothing | 2 |
| Fixed-step deterministic sim, agents, steering, separation | 3 |
| Doors as sim state, opened by agents | 3 (state) + 7 (visual) |
| Scripted dry run: advance, patrol, escort | 4 |
| Purity enforced for `raid/sim/**` | 5 |
| All budgets including headless throughput | 5 |
| Render binding: position, facing, clip blending | 6 |
| Door meshes swing | 7 |
| HUD time controls, fixed-step loop | 8 |
| Determinism, no-wall-crossing, progress asserted | 3, 4, 9 |

**Type consistency:** `NavGrid` accessors are used identically in Tasks 2, 3 and 9. `Agent.speed` is set in Task 3 and read in Task 6. `world.doors[id].state`/`.timer` are written in Task 3 and read in Task 7. `orders.phase` is exposed as a getter in Task 4 and read in Tasks 8 and 9.

**Known limitations carried forward deliberately:**

- **Figures sharing a skeleton cannot animate independently** (four SWAT share one rig, seven hostiles another). Task 6 drives each rig from its fastest member and says so. Fixing it needs cloned skeletons per figure — real work, and it belongs with combat where individual death and reload animations first make it necessary.
- **The hostage does not animate at all**, because its floor pose would be destroyed by starting any clip. It is carried to extraction by position only.
- Frame-time and draw-call budgets are checked in the browser, not automatically.
