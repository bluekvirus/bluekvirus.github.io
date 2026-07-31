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

  // A room or corridor's geometric centre is not guaranteed walkable — furnish.js
  // is free to drop a cabinet exactly there. Rather than have a waypoint silently
  // fail forever (setGoal returns false and never retries on its own), walk the
  // nav grid outward in rings from the intended point until an open cell turns
  // up, and route to that instead. Falls back to the original point untouched if
  // nothing opens within a generous radius, so a genuinely unreachable target
  // still fails the same way it always would.
  const nearestWalkable = (grid, x, z, maxRing = 60) => {
    const start = grid.worldToCell(x, z);
    if (!grid.isBlocked(start.col, start.row)) return { x, z };
    for (let r = 1; r <= maxRing; r++) {
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
          const col = start.col + dc;
          const row = start.row + dr;
          if (!grid.isBlocked(col, row)) return grid.cellToWorld(col, row);
        }
      }
    }
    return { x, z };
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
        const centre = centreOf(route[state.leg]);
        const target = nearestWalkable(world.grid, centre.x, centre.z);
        if (!state.issued) {
          // Only counted as issued once every SWAT member actually got a route —
          // a failed setGoal leaves that agent's path null forever otherwise, and
          // this phase would then wait on an "allThere" check nothing can satisfy.
          state.issued = swat.reduce((ok, a) => world.setGoal(a.id, target) && ok, true);
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
        const target = nearestWalkable(world.grid, exit.x, exit.z);
        if (!state.issued) {
          const swatOk = swat.reduce((ok, a) => world.setGoal(a.id, target) && ok, true);
          const hostageOk = world.setGoal(hostage.id, target);
          hostage.wants = 1.4;
          state.issued = swatOk && hostageOk;
        }
        const out = [...swat, hostage].every((a) => Math.hypot(a.x - exit.x, a.z - exit.z) < 3);
        if (out) state.phase = 'done';
      }
    },
  };

  return api;
}
