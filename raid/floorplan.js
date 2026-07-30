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

  return { seed, config, bounds, cells };
}
