// Where the cover goes. Pure data, so "does a desk block a doorway" is an
// assertion rather than something spotted in a screenshot after the fact.

import { makeRng } from './rng.js';
import { buildNavGrid } from './sim/navgrid.js';

const CATALOGUE = {
  desk:    { w: 1.6, d: 0.8 },
  cabinet: { w: 1.0, d: 0.5 },
  crate:   { w: 0.9, d: 0.9 },
  pillar:  { w: 0.6, d: 0.6 },
};

const DOOR_CLEARANCE = 1.35;  // keeps props off doorways, over the 1.2 test floor
const FIGURE_CLEARANCE = 0.8; // keeps props off spawned figures
const WALL_CLEARANCE = 0.35;

const BY_ROLE = {
  entry:    ['cabinet', 'pillar'],
  hostage:  ['desk', 'crate', 'cabinet'],
  guard:    ['desk', 'cabinet', 'crate'],
  filler:   ['desk', 'cabinet', 'crate', 'pillar'],
  corridor: ['cabinet'],
};

const TARGET_PER_ROLE = { entry: 2, hostage: 3, guard: 3, filler: 3, corridor: 1 };

// Keeping props off doorways is not enough to keep the building walkable.
// The nav grid erodes every walkable surface by the agent radius before
// anything is placed, so a corridor that measures 1.16m wide on the plan is
// only ~0.5m wide to a pathfinder — and a 0.5x1m cabinet standing in it, well
// clear of both doors and walls by the checks above, can sever it completely.
// Measured on 100 generated maps: the bare grid was connected every single
// time, and props split it on 32 of them, stranding pockets of up to 95 cells.
// A stranded pocket is not a cosmetic problem: if a formation point lands in
// one, that squad member's setGoal fails forever and only the leg watchdog
// eventually drags the mission past it.
//
// So connectivity is checked directly, on the same grid the simulation will
// actually path over, rather than approximated with a wider clearance radius
// (which would reject harmless props in open rooms and still miss the
// genuinely tight cases). Reachability under findPath is exactly 4-connected
// reachability — its diagonals are legal only when both orthogonal neighbours
// they squeeze between are open, so every legal diagonal can be replaced by
// two orthogonal steps — which is why the flood below is 4-connected.
const NEIGHBOUR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function connectivityGuard(plan, mission) {
  const grid = buildNavGrid(plan);
  const size = grid.cols * grid.rows;
  const blocked = Uint8Array.from(grid.blocked);
  const reach = new Uint8Array(size);
  const stack = new Int32Array(size);

  // Flood the walkable space from `seed`, treating every door as open (which
  // is how setGoal paths — a shut door is something to walk up to and open,
  // not a severed edge). Returns how many cells the main component holds.
  const flood = (seed) => {
    reach.fill(0);
    if (blocked[seed]) return 0;
    let top = 0;
    let count = 0;
    stack[top++] = seed;
    reach[seed] = 1;
    while (top > 0) {
      const at = stack[--top];
      count++;
      const col = at % grid.cols;
      const row = (at - col) / grid.cols;
      for (const [dc, dr] of NEIGHBOUR_OFFSETS) {
        const nc = col + dc;
        const nr = row + dr;
        if (!grid.inBounds(nc, nr)) continue;
        const idx = grid.index(nc, nr);
        if (reach[idx] || blocked[idx]) continue;
        reach[idx] = 1;
        stack[top++] = idx;
      }
    }
    return count;
  };

  // Anchor the flood somewhere guaranteed to matter: where the squad actually
  // starts. If that cell were somehow not walkable, fall back to any open cell
  // — the guard must keep measuring something real rather than degrade into
  // silently approving everything.
  const start = grid.worldToCell(mission.spawns.swat[0].x, mission.spawns.swat[0].z);
  let seed = grid.inBounds(start.col, start.row) ? grid.index(start.col, start.row) : -1;
  if (seed < 0 || blocked[seed]) {
    seed = blocked.indexOf(0);
    if (seed < 0) return { accept: () => true };
  }

  let mainCount = flood(seed);

  // The cells a prop stands on, and whether any cell inside its bounding box
  // is being left walkable. Door cells are skipped for the same reason
  // buildNavGrid skips them when baking props in — a prop clipping a doorway
  // must not seal it — so they must be skipped here too, or the two would
  // disagree about what the grid ends up looking like. `holes` counts exactly
  // those left-walkable cells, because the fast path below is only sound when
  // there are none.
  const footprintOf = (x, z, w, d) => {
    const cells = [];
    let holes = 0;
    const minC = Math.floor((x - w / 2 - grid.originX) / grid.cell);
    const maxC = Math.ceil((x + w / 2 - grid.originX) / grid.cell);
    const minR = Math.floor((z - d / 2 - grid.originZ) / grid.cell);
    const maxR = Math.ceil((z + d / 2 - grid.originZ) / grid.cell);
    for (let row = minR; row < maxR; row++) {
      for (let col = minC; col < maxC; col++) {
        if (!grid.inBounds(col, row)) continue;
        const idx = grid.index(col, row);
        if (blocked[idx]) continue;
        if (grid.door[idx] >= 0) { holes++; continue; }
        cells.push(idx);
      }
    }
    return { cells, holes, minC, maxC, minR, maxR };
  };

  // Is the whole ring of cells immediately around the prop's bounding box open
  // floor? If so the prop provably cannot strand anything, and the flood can
  // be skipped: that ring is a closed cycle of free cells, consecutive members
  // are 4-adjacent all the way round (including at the corners, where the turn
  // is between two cells sharing an edge), so every free cell touching the
  // prop is attached to one connected loop that survives the placement. Only
  // sound when the box has no walkable holes in it — a free cell left INSIDE
  // the box need not touch the ring at all, and could be exactly what gets
  // sealed in. Worth the check because most props stand in the middle of a
  // room, where it holds: it turns the common case from a full-grid flood into
  // a walk of ~30 cells.
  const ringIsOpenFloor = (minC, maxC, minR, maxR) => {
    for (let col = minC - 1; col <= maxC; col++) {
      for (const row of [minR - 1, maxR]) {
        if (!grid.inBounds(col, row) || blocked[grid.index(col, row)]) return false;
      }
    }
    for (let row = minR; row < maxR; row++) {
      for (const col of [minC - 1, maxC]) {
        if (!grid.inBounds(col, row) || blocked[grid.index(col, row)]) return false;
      }
    }
    return true;
  };

  return {
    // Take this placement if it strands nothing. Accepting is binding: on true
    // the prop is already baked into the guard's grid, so the caller must
    // actually place it.
    //
    // The test itself: block the footprint, re-flood, and require the main
    // component to have shrunk by exactly the cells the prop took out of it —
    // no more. Any further shortfall is cells that used to be reachable and no
    // longer are, which is precisely a sealed pocket.
    accept(x, z, w, d) {
      const { cells, holes, minC, maxC, minR, maxR } = footprintOf(x, z, w, d);
      if (cells.length === 0) return true;
      const removed = cells.reduce((n, idx) => n + reach[idx], 0);

      if (holes === 0 && ringIsOpenFloor(minC, maxC, minR, maxR)) {
        for (const idx of cells) { blocked[idx] = 1; reach[idx] = 0; }
        mainCount -= removed;
        return true;
      }

      for (const idx of cells) blocked[idx] = 1;
      const after = flood(seed);
      if (after === mainCount - removed) { mainCount = after; return true; }
      for (const idx of cells) blocked[idx] = 0;
      flood(seed); // restore `reach` to match the reverted `blocked`
      return false;
    },
  };
}

export function layoutProps(plan, mission) {
  const rng = makeRng(`${plan.seed}:props`);
  const figures = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
  const placed = [];
  const guard = connectivityGuard(plan, mission);

  for (const cell of plan.cells) {
    const role = mission.roles[cell.id] ?? 'filler';
    const kinds = BY_ROLE[role] ?? BY_ROLE.filler;
    const want = TARGET_PER_ROLE[role] ?? 2;

    for (let i = 0; i < want; i++) {
      const kind = rng.pick(kinds);
      const size = CATALOGUE[kind];
      // Half the time a rectangular prop is turned to lie along the other axis.
      const turned = rng.next() < 0.5;
      const w = turned ? size.d : size.w;
      const d = turned ? size.w : size.d;

      const minX = cell.x + WALL_CLEARANCE + w / 2;
      const maxX = cell.x + cell.w - WALL_CLEARANCE - w / 2;
      const minZ = cell.z + WALL_CLEARANCE + d / 2;
      const maxZ = cell.z + cell.d - WALL_CLEARANCE - d / 2;
      if (maxX <= minX || maxZ <= minZ) continue; // cell too small for this prop

      // Rejection sampling. A prop that cannot find a clear spot is simply not
      // placed — an empty corner is fine, a desk across a doorway is not.
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = rng.range(minX, maxX);
        const z = rng.range(minZ, maxZ);

        const nearDoor = plan.doors.some(
          (dr) => Math.hypot(x - dr.x, z - dr.z) < DOOR_CLEARANCE);
        if (nearDoor) continue;

        const onFigure = figures.some(
          (f) => Math.abs(f.x - x) * 2 < w + FIGURE_CLEARANCE
              && Math.abs(f.z - z) * 2 < d + FIGURE_CLEARANCE);
        if (onFigure) continue;

        const onProp = placed.some(
          (p) => Math.abs(p.x - x) * 2 < p.w + w && Math.abs(p.z - z) * 2 < p.d + d);
        if (onProp) continue;

        // Last, because it is the only check that can cost a grid flood, and
        // because accepting is binding: no point paying for one on a spot
        // already rejected for sitting on a door, a figure, or another prop.
        // Another attempt gets tried on rejection, so a sealing spot costs this
        // prop a position, not its existence.
        if (!guard.accept(x, z, w, d)) continue;

        placed.push({ kind, x, z, w, d, cellId: cell.id });
        break;
      }
    }
  }

  return placed;
}
