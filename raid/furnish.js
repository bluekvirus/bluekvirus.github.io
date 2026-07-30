// Where the cover goes. Pure data, so "does a desk block a doorway" is an
// assertion rather than something spotted in a screenshot after the fact.

import { makeRng } from './rng.js';

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

export function layoutProps(plan, mission) {
  const rng = makeRng(`${plan.seed}:props`);
  const figures = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
  const placed = [];

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

        placed.push({ kind, x, z, w, d, cellId: cell.id });
        break;
      }
    }
  }

  return placed;
}
