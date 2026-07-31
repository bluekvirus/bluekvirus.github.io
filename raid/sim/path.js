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
