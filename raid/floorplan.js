// Floor plan generation. Pure data — this module never imports Babylon and never
// touches the DOM, so the properties that decide whether a map is usable
// (determinism, no overlaps, connectivity, room sizes) can be asserted directly
// over hundreds of seeds instead of judged from a screenshot.

import { makeRng } from './rng.js';

export const FLOORPLAN_DEFAULTS = Object.freeze({
  width: 35,
  depth: 35,
  targetRooms: 10,
  minRoomSide: 3.2,
  corridorWidth: 1.8,
  corridorSplits: 2,   // how many of the earliest splits become corridors
  wallThickness: 0.15,
  wallHeight: 2.6,
  doorWidth: 1.0,
  doorMargin: 0.6,
  splitJitter: 0.16,   // how far off centre a split may land, as a fraction
});

/**
 * Can this rectangle be split along `axis` leaving both halves usable?
 * A split consumes the corridor band when one is carved, so the test has to
 * account for it — otherwise the splitter produces slivers too thin to hold a
 * door, and the connectivity check fails much later with a confusing symptom.
 */
function canSplit(rect, axis, band, cfg) {
  const span = axis === 'x' ? rect.xMax - rect.xMin : rect.zMax - rect.zMin;
  return span >= cfg.minRoomSide * 2 + band;
}

/**
 * How far two cells overlap along the shared edge, and where that overlap sits.
 * Returns null when they do not touch, or touch too briefly to fit a door.
 *
 * Adjacency is measured geometrically rather than read off the BSP tree: once a
 * corridor band is carved between two children they are no longer neighbours,
 * and cells on opposite sides of a corridor must not get a door through it.
 */
function sharedEdge(a, b, cfg) {
  const need = cfg.doorWidth + cfg.doorMargin * 2;
  const near = 1e-6;

  const touchZ = Math.abs((a.z + a.d) - b.z) < near || Math.abs((b.z + b.d) - a.z) < near;
  if (touchZ) {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo >= need) {
      return { axis: 'x', lo, hi, at: Math.abs((a.z + a.d) - b.z) < near ? a.z + a.d : b.z + b.d };
    }
  }

  const touchX = Math.abs((a.x + a.w) - b.x) < near || Math.abs((b.x + b.w) - a.x) < near;
  if (touchX) {
    const lo = Math.max(a.z, b.z);
    const hi = Math.min(a.z + a.d, b.z + b.d);
    if (hi - lo >= need) {
      return { axis: 'z', lo, hi, at: Math.abs((a.x + a.w) - b.x) < near ? a.x + a.w : b.x + b.w };
    }
  }

  return null;
}

/**
 * Every cell must be reachable. BSP tiles the footprint with no gaps, so a
 * disconnected plan means the splitter produced a cell too thin along a shared
 * edge to take a door. That is a bug in the split rules, not an unlucky seed, so
 * it throws rather than quietly regenerating and hiding the cause.
 */
function assertConnected(plan) {
  const seen = new Set([plan.cells[0].id]);
  const queue = [plan.cells[0].id];
  while (queue.length) {
    for (const n of plan.adjacency[queue.pop()]) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  if (seen.size !== plan.cells.length) {
    const lost = plan.cells.filter((c) => !seen.has(c.id)).map((c) => c.id);
    throw new Error(`floorplan "${plan.seed}": cells ${lost.join(', ')} unreachable`);
  }
}

/**
 * One cell edge becomes one or more wall segments, broken around any doors on it.
 *
 * Walls are built per edge and deduplicated by position, because two cells share
 * an edge and would otherwise each build the same wall — doubling the geometry
 * and leaving z-fighting along every interior partition.
 */
function buildWalls(cells, doors, cfg) {
  const t = cfg.wallThickness;
  const half = t / 2;
  const segments = [];
  const seen = new Set();

  const push = (x, z, w, d) => {
    const key = `${x.toFixed(3)}:${z.toFixed(3)}:${w.toFixed(3)}:${d.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    segments.push({ x, z, w, d, height: cfg.wallHeight });
  };

  for (const cell of cells) {
    const edges = [
      { axis: 'x', at: cell.z, lo: cell.x, hi: cell.x + cell.w },
      { axis: 'x', at: cell.z + cell.d, lo: cell.x, hi: cell.x + cell.w },
      { axis: 'z', at: cell.x, lo: cell.z, hi: cell.z + cell.d },
      { axis: 'z', at: cell.x + cell.w, lo: cell.z, hi: cell.z + cell.d },
    ];

    for (const edge of edges) {
      // Every door sitting on this exact edge line punches a gap in it.
      const gaps = doors
        .filter((dr) => dr.axis === edge.axis
          && Math.abs((edge.axis === 'x' ? dr.z : dr.x) - edge.at) < 1e-6)
        .map((dr) => {
          const centre = edge.axis === 'x' ? dr.x : dr.z;
          return [centre - dr.width / 2, centre + dr.width / 2];
        })
        .filter(([lo, hi]) => hi > edge.lo && lo < edge.hi)
        .sort((a, b) => a[0] - b[0]);

      let cursor = edge.lo;
      for (const [lo, hi] of gaps) {
        if (lo > cursor) {
          if (edge.axis === 'x') push(cursor, edge.at - half, lo - cursor, t);
          else push(edge.at - half, cursor, t, lo - cursor);
        }
        cursor = Math.max(cursor, hi);
      }
      if (cursor < edge.hi) {
        if (edge.axis === 'x') push(cursor, edge.at - half, edge.hi - cursor, t);
        else push(edge.at - half, cursor, t, edge.hi - cursor);
      }
    }
  }

  return segments;
}

export function generateFloorplan(seed, overrides = {}) {
  const config = { ...FLOORPLAN_DEFAULTS, ...overrides };
  const rng = makeRng(seed);

  const bounds = { x: -config.width / 2, z: -config.depth / 2, w: config.width, d: config.depth };
  const corridors = [];

  // Internally, rects are tracked as min/max edges rather than origin+span.
  // A width recomputed from independent origin/span arithmetic can drift a
  // femtometre from its neighbour's edge — computed the same way but through
  // a different chain of additions — which is enough for the strict overlap
  // check to trip. Carrying edges forward unchanged (never re-deriving one
  // from the other) keeps every shared boundary bit-identical.
  let leaves = [{ xMin: bounds.x, xMax: bounds.x + bounds.w, zMin: bounds.z, zMax: bounds.z + bounds.d }];
  let splits = 0;

  // Leaves are split largest-first until the room target is met. Taking the
  // largest each time keeps rooms comparable in size; splitting at random
  // leaves one cavernous room beside a row of cupboards.
  while (leaves.length < config.targetRooms) {
    const band = splits < config.corridorSplits ? config.corridorWidth : 0;

    const candidates = leaves.filter(
      (r) => canSplit(r, 'x', band, config) || canSplit(r, 'z', band, config),
    );
    if (!candidates.length) break;

    candidates.sort((a, b) =>
      (b.xMax - b.xMin) * (b.zMax - b.zMin) - (a.xMax - a.xMin) * (a.zMax - a.zMin));
    const target = candidates[0];

    const canX = canSplit(target, 'x', band, config);
    const canZ = canSplit(target, 'z', band, config);
    // Cut across the longer side so rooms tend towards square.
    const targetW = target.xMax - target.xMin;
    const targetD = target.zMax - target.zMin;
    const axis = canX && canZ ? (targetW >= targetD ? 'x' : 'z') : (canX ? 'x' : 'z');

    const span = axis === 'x' ? targetW : targetD;
    const origin = axis === 'x' ? target.xMin : target.zMin;
    const usable = span - band;
    const lo = config.minRoomSide;
    const hi = usable - config.minRoomSide;
    const mid = usable / 2;
    const jitter = usable * config.splitJitter;
    const cut = Math.min(hi, Math.max(lo, rng.range(mid - jitter, mid + jitter)));

    // cutPos and bandEnd are each computed once and reused everywhere they
    // form a shared boundary, so touching rects agree on that edge exactly.
    const cutPos = origin + cut;
    const bandEnd = cutPos + band;

    const first = axis === 'x'
      ? { xMin: target.xMin, xMax: cutPos, zMin: target.zMin, zMax: target.zMax }
      : { xMin: target.xMin, xMax: target.xMax, zMin: target.zMin, zMax: cutPos };
    const second = axis === 'x'
      ? { xMin: bandEnd, xMax: target.xMax, zMin: target.zMin, zMax: target.zMax }
      : { xMin: target.xMin, xMax: target.xMax, zMin: bandEnd, zMax: target.zMax };

    if (band > 0) {
      corridors.push(axis === 'x'
        ? { xMin: cutPos, xMax: bandEnd, zMin: target.zMin, zMax: target.zMax }
        : { xMin: target.xMin, xMax: target.xMax, zMin: cutPos, zMax: bandEnd });
    }

    leaves = leaves.filter((r) => r !== target).concat([first, second]);
    splits++;
  }

  const toRect = (r) => ({ x: r.xMin, z: r.zMin, w: r.xMax - r.xMin, d: r.zMax - r.zMin });

  const cells = [
    ...leaves.map((r) => ({ ...toRect(r), kind: 'room' })),
    ...corridors.map((r) => ({ ...toRect(r), kind: 'corridor' })),
  ].map((c, id) => ({ id, ...c }));

  const adjacency = Object.fromEntries(cells.map((c) => [c.id, []]));
  const doors = [];

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const edge = sharedEdge(cells[i], cells[j], config);
      if (!edge) continue;

      adjacency[cells[i].id].push(cells[j].id);
      adjacency[cells[j].id].push(cells[i].id);

      // Centre the door on the shared span, then pull it inside the corner
      // clearance at both ends. `sharedEdge` guarantees the span is wide enough
      // for that to be possible.
      const clearance = config.doorWidth / 2 + config.doorMargin;
      const centre = Math.min(edge.hi - clearance, Math.max(edge.lo + clearance, (edge.lo + edge.hi) / 2));

      doors.push({
        id: doors.length,
        a: cells[i].id,
        b: cells[j].id,
        axis: edge.axis,
        width: config.doorWidth,
        x: edge.axis === 'x' ? centre : edge.at,
        z: edge.axis === 'x' ? edge.at : centre,
      });
    }
  }

  const walls = buildWalls(cells, doors, config);
  const plan = { seed, config, bounds, cells, adjacency, doors, walls };
  assertConnected(plan);
  return plan;
}
