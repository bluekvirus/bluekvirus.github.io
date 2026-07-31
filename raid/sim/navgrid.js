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
