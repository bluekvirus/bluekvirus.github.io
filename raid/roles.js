// Mission placement: which room is the objective, and where everyone starts.
//
// This is a graph problem, not a geometric one — the hostage belongs as many
// doors from the entry as possible, regardless of how far that is in metres.
// Keeping it out of floorplan.js means the layout algorithm and the mission
// rules can each change without disturbing the other.

import { makeRng } from './rng.js';

export const CAST = Object.freeze({ swat: 4, hostiles: 7, hostage: 1 });

const MIN_HOSTAGE_DEPTH = 3;
const ENTRY_MAX_CANDIDATES = 12; // bound the O(perimeter x cells) entry search
const SPAWN_GAP = 0.7;      // metres between figures, comfortably over the 0.55 test floor
const WALL_CLEARANCE = 0.9; // keep figures off the walls

/** Breadth-first door count from `startId` to every reachable cell. */
function doorDepth(plan, startId) {
  const depth = { [startId]: 0 };
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const n of plan.adjacency[current]) {
      if (depth[n] === undefined) {
        depth[n] = depth[current] + 1;
        queue.push(n);
      }
    }
  }
  return depth;
}

const touchesPerimeter = (cell, b) => {
  const near = 1e-6;
  return Math.abs(cell.x - b.x) < near
    || Math.abs(cell.z - b.z) < near
    || Math.abs((cell.x + cell.w) - (b.x + b.w)) < near
    || Math.abs((cell.z + cell.d) - (b.z + b.d)) < near;
};

/**
 * Scatter `count` points inside a cell, no two closer than SPAWN_GAP.
 *
 * Rejection sampling with a bounded attempt count, then a relaxed fallback: a
 * small room genuinely cannot hold seven people at arm's length, and failing to
 * place a figure at all is worse than placing two a little close.
 */
function scatter(cell, count, rng, taken) {
  const points = [];
  const minX = cell.x + WALL_CLEARANCE;
  const maxX = cell.x + cell.w - WALL_CLEARANCE;
  const minZ = cell.z + WALL_CLEARANCE;
  const maxZ = cell.z + cell.d - WALL_CLEARANCE;

  for (let i = 0; i < count; i++) {
    let best = null;
    let bestGap = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = {
        x: maxX > minX ? rng.range(minX, maxX) : cell.x + cell.w / 2,
        z: maxZ > minZ ? rng.range(minZ, maxZ) : cell.z + cell.d / 2,
      };
      const gap = [...taken, ...points].reduce(
        (m, q) => Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)), Infinity);
      if (gap >= SPAWN_GAP) { best = p; break; }
      if (gap > bestGap) { bestGap = gap; best = p; }
    }
    points.push(best);
  }
  return points;
}

export function assignRoles(plan) {
  // Seeded from the plan so a given map always yields the same mission, and so
  // this never consumes the floorplan's own RNG stream.
  const rng = makeRng(`${plan.seed}:mission`);
  const rooms = plan.cells.filter((c) => c.kind === 'room');

  // Entry: the perimeter room the building runs DEEPEST from — which is also
  // how a breach point gets chosen in reality, since it maximises the approach.
  //
  // Picking the smallest perimeter room instead (the obvious "lobby, not
  // ballroom" rule) is measurably wrong here: across 200 seeds at 8 rooms it
  // leaves 20 plans whose deepest room is only 2 doors from the entry, and this
  // function then throws on the MIN_HOSTAGE_DEPTH check. Choosing for depth
  // clears 3 on every seed at every room count the HUD offers.
  //
  // Ties break by smaller area then id, so the choice stays deterministic.
  const perimeter = rooms
    .filter((c) => touchesPerimeter(c, plan.bounds))
    .sort((a, b) => (a.w * a.d) - (b.w * b.d) || a.id - b.id)
    .slice(0, ENTRY_MAX_CANDIDATES);

  let entry = perimeter[0] ?? rooms[0];
  let depth = doorDepth(plan, entry.id);
  let reach = -1;

  for (const candidate of perimeter) {
    const candidateDepth = doorDepth(plan, candidate.id);
    const deepest = rooms
      .filter((r) => r.id !== candidate.id)
      .reduce((max, r) => Math.max(max, candidateDepth[r.id] ?? -1), -1);
    if (deepest > reach) {
      reach = deepest;
      entry = candidate;
      depth = candidateDepth;
    }
  }

  // Hostage: deepest room by door count, ties broken by id.
  const hostageRoom = rooms
    .filter((c) => c.id !== entry.id)
    .sort((a, b) => (depth[b.id] ?? -1) - (depth[a.id] ?? -1) || a.id - b.id)[0];

  if ((depth[hostageRoom.id] ?? 0) < MIN_HOSTAGE_DEPTH) {
    throw new Error(
      `floorplan "${plan.seed}": deepest room is only ${depth[hostageRoom.id]} doors from entry, `
      + `need ${MIN_HOSTAGE_DEPTH} — the splitter is producing too shallow a plan`);
  }

  const roles = {};
  for (const c of plan.cells) roles[c.id] = c.kind === 'corridor' ? 'corridor' : 'filler';
  roles[entry.id] = 'entry';
  roles[hostageRoom.id] = 'hostage';

  const taken = [];

  // SWAT stack up in the entry room, facing into the building.
  const swatPoints = scatter(entry, CAST.swat, rng, taken);
  taken.push(...swatPoints);
  const inwardFrom = (p) => Math.atan2(-p.x, -p.z); // face the footprint centre
  const swat = swatPoints.map((p) => ({ ...p, facing: inwardFrom(p), cellId: entry.id }));

  // The hostage sits in the middle of the objective room.
  const hostagePoint = { x: hostageRoom.x + hostageRoom.w / 2, z: hostageRoom.z + hostageRoom.d / 2 };
  taken.push(hostagePoint);
  const hostage = { ...hostagePoint, facing: rng.range(0, Math.PI * 2), cellId: hostageRoom.id };

  // Hostiles: two guarding the hostage, the rest spread over the deeper rooms so
  // the squad meets resistance on the way in rather than all at the objective.
  const guardable = rooms
    .filter((c) => c.id !== entry.id)
    .sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0) || a.id - b.id);

  const assignments = [hostageRoom, hostageRoom];
  let cursor = 0;
  while (assignments.length < CAST.hostiles) {
    assignments.push(guardable[cursor % guardable.length]);
    cursor++;
  }

  const hostiles = [];
  for (const cell of assignments) {
    const [p] = scatter(cell, 1, rng, taken);
    taken.push(p);
    hostiles.push({ ...p, facing: rng.range(0, Math.PI * 2), cellId: cell.id });
    if (roles[cell.id] === 'filler') roles[cell.id] = 'guard';
  }

  const extraction = { x: entry.x + entry.w / 2, z: entry.z + entry.d / 2 };

  return {
    entryId: entry.id,
    hostageRoomId: hostageRoom.id,
    depth,
    roles,
    spawns: { swat, hostiles, hostage, extraction },
  };
}
