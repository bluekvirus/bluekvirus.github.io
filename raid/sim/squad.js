// Tactical execution.
//
// The director says WHERE the squad is going; this module decides how the
// four of them get there — who leads, who holds, who pulls back. It issues
// goals through world.setGoal and nothing else, so it needs no knowledge of
// paths, steering, or combat resolution.
//
// Goals are re-issued only when they change. setGoal runs a full A* query and
// resets an agent's stall bookkeeping, so calling it every tick would both
// blow the per-tick budget and permanently suppress the stall detector — the
// same reason orders.js staggered its issuing.

import { SIM } from './world.js';

export const SQUAD = Object.freeze({
  // Below this fraction of starting health a member stops advancing and pulls
  // back toward the rear. Not a retreat from the mission — the others keep
  // going, and it rejoins once it is no longer the most exposed.
  fallbackHealth: 0.35,
  // Metres each member's destination sits off the shared objective point, so
  // four agents never share one coordinate. Sharing a coordinate is what let
  // goal-pull and separation-push cancel exactly in phase B, freezing an agent
  // that could not tell it was making no progress.
  spread: 1.1,
  // Metres behind the objective direction that a falling-back member holds.
  fallbackDistance: 4.0,
  // Re-issue a member's goal when its intended destination has moved at least
  // this far. Small enough to track a changing objective, large enough that
  // ordinary jitter does not trigger an A* query every tick.
  reissueDistance: 1.5,
});

/** Even spread around a shared point, by fixed slot — never random. */
const slotPoint = (point, slot, total) => {
  const angle = (slot / Math.max(1, total)) * Math.PI * 2;
  return {
    x: point.x + Math.cos(angle) * SQUAD.spread,
    z: point.z + Math.sin(angle) * SQUAD.spread,
  };
};

// A room or corridor's geometric centre is not guaranteed walkable —
// furnish.js is free to drop a cabinet exactly there, and the director hands
// out the geometric centre of the target cell as `objective.point` with no
// regard for what furnish.js put there: measured across 200 director plans,
// 129 of 2400 cell centres were blocked navgrid cells (48% of plans hit at
// least one). Rather than let a destination silently fail forever (setGoal
// returns false and never retries on its own), walk the nav grid outward in
// rings from the intended point until an open cell turns up, and route to
// that instead. Falls back to the original point untouched if nothing opens
// within a generous radius, so a genuinely unreachable target still fails
// the same way it always would.
//
// Same ring-search shape as orders.js's nearestWalkable (that module is left
// untouched — Task 3 builds alongside it, not on top of it — so this is a
// second, independent copy rather than an import: the two modules must not
// come to depend on each other before the cutover task decides which one, if
// either, survives it).
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

export function createSquad(plan) {
  // Last destination actually issued per agent, so a goal is only recomputed
  // when it has meaningfully moved.
  const issued = new Map();

  return {
    update(world, objective) {
      if (!objective || !objective.point) return;

      const members = world.agents.filter((a) => a.role === 'swat' && a.alive);
      if (members.length === 0) return;

      // A squad moves fast to contact but slow with a casualty — the same
      // split orders.js made between its 'advance' phase (SIM.runSpeed) and
      // its 'extract' phase (SIM.walkSpeed). Nothing else writes `wants`, so
      // without this every member would only ever walk, and SIM.runSpeed
      // (and the directional run clips) would go unused. Set every tick
      // rather than once: cheap (no side effects beyond the number itself),
      // and keeps this correct even if `wants` was ever touched elsewhere.
      // 'rescue' is a single-tick transitional objective on the way to
      // 'extract' (see director.js), so it is treated the same as escorting.
      const wants = objective.kind === 'clear' ? SIM.runSpeed : SIM.walkSpeed;
      for (const a of members) a.wants = wants;

      // Centre of mass, used to place a falling-back member behind the group
      // rather than at some absolute point that might be inside a wall.
      let cx = 0;
      let cz = 0;
      for (const a of members) { cx += a.x; cz += a.z; }
      cx /= members.length;
      cz /= members.length;

      members.forEach((a, slot) => {
        const hurt = a.hp <= a.hpMax * SQUAD.fallbackHealth;

        let want;
        if (hurt) {
          // Directly away from the objective, from the squad's centre.
          const dx = cx - objective.point.x;
          const dz = cz - objective.point.z;
          const len = Math.hypot(dx, dz) || 1;
          want = {
            x: cx + (dx / len) * SQUAD.fallbackDistance,
            z: cz + (dz / len) * SQUAD.fallbackDistance,
          };
        } else {
          want = slotPoint(objective.point, slot, members.length);
        }

        const last = issued.get(a.id);
        const moved = !last || Math.hypot(last.x - want.x, last.z - want.z) > SQUAD.reissueDistance;
        // Also re-issue when an agent has no path at all: it either arrived,
        // or its last setGoal failed, and either way it will stand still
        // forever otherwise.
        if (moved || !a.path) {
          // Resolved at issue time, not on every tick's `want` computation —
          // the ring search only costs anything when it actually has to run,
          // and gating it behind the same "about to issue" check that guards
          // the A* query in setGoal keeps that cost off every idle tick.
          const target = nearestWalkable(world.grid, want.x, want.z);
          if (world.setGoal(a.id, target)) issued.set(a.id, want);
        }
      });

      // A member that died still holds a stale entry; drop it so a respawn or
      // an id reuse cannot inherit someone else's destination.
      for (const id of [...issued.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) issued.delete(id);
      }
    },
  };
}
