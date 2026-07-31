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
