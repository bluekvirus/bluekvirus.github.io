// The scripted mission dry run.
//
// Deliberately dumb: this exists so the movement machinery can be judged before
// any real decision-making is layered on. Phase D replaces this file wholesale,
// and nothing beneath it should need to change when that happens — if it does,
// the boundary was drawn in the wrong place.

import { makeRng } from '../rng.js';

const ARRIVED = 1.4;      // how close counts as "at" a room or point
const PATROL_PAUSE = 2.5; // seconds a hostile waits before picking a new spot
const FORMATION_RADIUS = 0.8; // metres each squad member's destination sits off the shared point

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

  // Sending every agent to the exact same coordinate is what lets several of
  // them stack on one point: with everyone pulled toward the same spot, a
  // goal-pull vector can cancel a separation-push vector exactly (or a step
  // lands back on the agent's own already-open cell), and an agent can end
  // up permanently unable to tell it isn't making progress. Spreading the
  // squad's individual destinations around the shared point — evenly, by a
  // fixed slot index, never Math.random — removes the identical-coordinate
  // case entirely, and incidentally looks like a squad taking up positions
  // rather than a stack of figures on a single tile.
  const formationPoint = (centre, slot, total) => {
    const angle = (slot / total) * Math.PI * 2;
    return {
      x: centre.x + Math.cos(angle) * FORMATION_RADIUS,
      z: centre.z + Math.sin(angle) * FORMATION_RADIUS,
    };
  };

  const state = {
    phase: 'advance',
    leg: 0,
    issued: false,
    issueQueue: null, // pending {agent, point} setGoal calls for the current leg, staggered one per tick
    issueOk: true,
    patrol: new Map(), // agentId -> seconds until the next patrol goal
  };

  // A route-leg transition used to fire every squad member's setGoal call on
  // the very same tick — up to four full A* queries landing in one tick,
  // which is what blew the per-tick performance budget (see
  // simbudget.test.js). Issuing one setGoal per tick instead spreads that
  // cost out without changing what is asked for, in what order, or the
  // retry-until-everyone-has-a-route contract `state.issued` implements.
  const stageIssue = (world, tasks) => {
    if (!state.issueQueue) {
      state.issueQueue = tasks;
      state.issueOk = true;
    }
    if (state.issueQueue.length) {
      const { agent, point } = state.issueQueue.shift();
      state.issueOk = world.setGoal(agent.id, nearestWalkable(world.grid, point.x, point.z)) && state.issueOk;
    }
    if (!state.issueQueue.length) {
      state.issued = state.issueOk;
      state.issueQueue = null;
    }
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
        if (!state.issued) {
          // Only counted as issued once every SWAT member actually got a route —
          // a failed setGoal leaves that agent's path null forever otherwise, and
          // this phase would then wait on an "allThere" check nothing can satisfy.
          // Each member gets its own spot around the room's centre rather than
          // the identical coordinate (see formationPoint above).
          stageIssue(world, swat.map((a, i) => ({ agent: a, point: formationPoint(centre, i, swat.length) })));
        }
        const allThere = swat.every((a) => Math.hypot(a.x - centre.x, a.z - centre.z) < ARRIVED + 1.2);
        if (allThere) {
          state.leg++;
          state.issued = false;
          state.issueQueue = null;
          if (state.leg >= route.length) { state.phase = 'rescue'; }
        }
        return;
      }

      if (state.phase === 'rescue') {
        // The hostage joins the squad and they all head for extraction.
        state.phase = 'extract';
        state.issued = false;
        state.issueQueue = null;
        return;
      }

      if (state.phase === 'extract') {
        const exit = mission.spawns.extraction;
        // The squad plus the rescued hostage: one more formation slot than
        // the advance phase used, so the hostage gets its own spot too
        // instead of sharing the exact extraction coordinate with whichever
        // SWAT member happens to arrive alongside it.
        const total = swat.length + 1;
        if (!state.issued) {
          const tasks = swat.map((a, i) => ({ agent: a, point: formationPoint(exit, i, total) }));
          tasks.push({ agent: hostage, point: formationPoint(exit, swat.length, total) });
          hostage.wants = 1.4;
          stageIssue(world, tasks);
        }
        const out = [...swat, hostage].every((a) => Math.hypot(a.x - exit.x, a.z - exit.z) < 3);
        if (out) state.phase = 'done';
      }
    },
  };

  return api;
}
