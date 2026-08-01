// Pathfinding over the navigation grid.
//
// Pure data, like the grid it walks: a path that cuts through a wall is caught
// by assertion over hundreds of seeds, not by noticing a figure clipping a
// desk on screen.

const SQRT2 = Math.SQRT2;

// 8-connected. Diagonals are last purely for readability; the open set below
// no longer takes insertion order into account for ties (see OpenHeap).
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

const passable = (grid, col, row, isDoorOpen) => {
  if (grid.isBlocked(col, row)) return false;
  const id = grid.doorAt(col, row);
  return id < 0 || isDoorOpen(id);
};

// Binary min-heap keyed on f, with the cell index as an explicit tie-break.
// A plain array scanned linearly on every pop (the previous approach) is
// O(n) per pop over a ~140x140 grid, which is what blew the per-tick budget
// once several agents queried a path on the same tick. A heap makes push and
// pop both O(log n) — but a heap's sift only guarantees *a* minimum comes out
// first, not which of several equal-f entries; left to the swaps, that order
// depends on incidental insertion history and is not guaranteed to repeat
// identically across runs. The idx tie-break gives every pop a single,
// reproducible answer regardless of how entries were shuffled to get there,
// which is what this simulation's replay guarantee depends on.
class OpenHeap {
  constructor() {
    this.f = [];
    this.idx = [];
  }

  get size() { return this.f.length; }

  push(idx, f) {
    const i = this.f.length;
    this.f.push(f);
    this.idx.push(idx);
    this.#siftUp(i);
  }

  // Returns just the popped index — every caller here only ever needs that,
  // and a query touches this often enough that skipping the {idx, f} wrapper
  // object avoids a real amount of otherwise-pointless allocation.
  pop() {
    const topIdx = this.idx[0];
    const last = this.f.length - 1;
    this.f[0] = this.f[last];
    this.idx[0] = this.idx[last];
    this.f.pop();
    this.idx.pop();
    if (this.f.length) this.#siftDown(0);
    return topIdx;
  }

  #less(a, b) {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && this.idx[a] < this.idx[b]);
  }

  #swap(a, b) {
    let t = this.f[a]; this.f[a] = this.f[b]; this.f[b] = t;
    t = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = t;
  }

  #siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#less(i, parent)) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  #siftDown(i) {
    const n = this.f.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.#less(l, smallest)) smallest = l;
      if (r < n && this.#less(r, smallest)) smallest = r;
      if (smallest === i) break;
      this.#swap(i, smallest);
      i = smallest;
    }
  }
}

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

  const openList = new OpenHeap();
  openList.push(startIdx, 0);

  const heuristic = (col, row) => {
    const dc = Math.abs(col - goal.col);
    const dr = Math.abs(row - goal.row);
    // Octile: the exact cost of an unobstructed 8-connected walk.
    return (dc + dr) + (SQRT2 - 2) * Math.min(dc, dr);
  };

  while (openList.size) {
    const idx = openList.pop();
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
        openList.push(nIdx, tentative + heuristic(nc, nr));
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
  // Amanatides-Woo voxel traversal: walks every cell the segment actually
  // enters, rather than sampling points along it. Point sampling — even at
  // half a cell — can step clean over a corner a continuous line clips,
  // approving a "shortcut" that a moving body cannot really take. This
  // function backs both pathfinding's line-of-sight smoothing (a bad
  // approval there jams a walking agent solid in a wall) and, in a later
  // phase, ranged line of sight (a bad approval there is a bullet passing
  // through a wall), so it has to be exact, not merely fine-grained.
  const start = grid.worldToCell(a.x, a.z);
  const end = grid.worldToCell(b.x, b.z);
  if (!passable(grid, start.col, start.row, isDoorOpen)) return false;
  if (!passable(grid, end.col, end.row, isDoorOpen)) return false;
  if (start.col === end.col && start.row === end.row) return true;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const stepCol = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepRow = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // A tie between the two axes' crossing distances means the segment passes
  // exactly through a grid corner. Recomputing each crossing fresh from the
  // endpoints (rather than accumulating `+= tDelta` step after step) keeps
  // that comparison meaningful — an accumulated sum drifts by a few ULP over
  // many steps, which is enough for a mathematically exact tie to stop
  // reading as one right when it matters most.
  const EPS = 1e-9;
  const crossingX = (col) => (stepCol !== 0 ? (grid.originX + (col + (stepCol > 0 ? 1 : 0)) * grid.cell - a.x) / dx : Infinity);
  const crossingZ = (row) => (stepRow !== 0 ? (grid.originZ + (row + (stepRow > 0 ? 1 : 0)) * grid.cell - a.z) / dz : Infinity);

  let col = start.col;
  let row = start.row;
  // Bounded by the number of grid lines the segment can possibly cross;
  // guards against a runaway loop if floating-point imprecision ever kept it
  // from landing exactly on the end cell.
  const maxSteps = Math.abs(end.col - start.col) + Math.abs(end.row - start.row) + 2;

  for (let i = 0; i < maxSteps && (col !== end.col || row !== end.row); i++) {
    const tMaxX = crossingX(col);
    const tMaxZ = crossingZ(row);
    if (Math.abs(tMaxX - tMaxZ) < EPS) {
      // Crossing exactly through a corner: the line grazes both cells it
      // passes between, so both must be open for it to really be clear.
      if (!passable(grid, col + stepCol, row, isDoorOpen)) return false;
      if (!passable(grid, col, row + stepRow, isDoorOpen)) return false;
      col += stepCol;
      row += stepRow;
    } else if (tMaxX < tMaxZ) {
      col += stepCol;
    } else {
      row += stepRow;
    }
    if (!passable(grid, col, row, isDoorOpen)) return false;
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
