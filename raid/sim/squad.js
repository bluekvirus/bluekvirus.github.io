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
  // going.
  fallbackHealth: 0.35,
  // Metres each member's destination sits off the shared point (objective OR
  // the fallback rear anchor — see below), so four agents never share one
  // coordinate. Sharing a coordinate is what let goal-pull and separation-push
  // cancel exactly in phase B, freezing an agent that could not tell it was
  // making no progress.
  spread: 1.1,
  // Metres behind the objective direction that a falling-back member holds.
  fallbackDistance: 4.0,
  // Ticks a member holds its fallback position before rejoining the advance
  // regardless of hp. Nothing in this simulation heals — combat.js only ever
  // subtracts from hp — so "hurt" is monotone: once a member crosses
  // fallbackHealth it never becomes false again on its own, and a rejoin
  // condition phrased as "no longer the most exposed" cannot be built
  // honestly against a value that only ever goes down. Bounding the retreat
  // in time instead — the same shape as world.js's tie-breaking nudge, a
  // bounded impulse rather than a standing bias — is what stops one wounded
  // member from being able to subtract itself from the advance for the rest
  // of the mission. Sized off orders.js's own LEG_TIMEOUT precedent (3600
  // ticks / 60 simulated seconds is that codebase's existing answer to "how
  // long do we wait on one thing before moving on regardless"), not
  // reverse-engineered from any test's tick count.
  fallbackTicks: 3600,
  // Re-issue a member's goal when its intended destination has moved at least
  // this far. Small enough to track a changing objective, large enough that
  // ordinary jitter does not trigger an A* query every tick. Doubles as the
  // "close enough to its last issued goal to count as arrived" radius (see
  // the arrival check in update, below) — both are the same "not worth a
  // fresh A* query over" judgment call.
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
// least one — and separately, over 58 real blocked-centre objectives driven
// through this module, 35 had a slot point itself blocked too, not merely the
// shared centre). Rather than let a destination silently fail forever
// (setGoal returns false and never retries on its own), walk the nav grid
// outward in rings from the intended point until an open cell turns up, and
// route to that instead. Falls back to the original point untouched if
// nothing opens within a generous radius, so a genuinely unreachable target
// still fails the same way it always would.
//
// Same ring-search shape as orders.js's private nearestWalkable. The two are
// not shared from a common home in navgrid.js (which both modules already
// import, and which is where a shared version belongs) because that is a
// refactor, and this task builds alongside orders.js rather than touching it
// — moving shared logic out of it is the cutover task's call, not this one's.
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
  // Last goal actually issued per agent — the intended `want` (for deciding
  // whether it has moved enough to be worth a fresh query) alongside the
  // resolved `target` actually handed to setGoal (for deciding whether the
  // agent has arrived at what it was actually asked to reach, which can
  // differ from `want` whenever nearestWalkable moved it).
  const issued = new Map();
  // Members waiting for their turn at the one setGoal call update() allows
  // per tick (see the stagger below) — agent id -> the `want` computed the
  // last time this agent's need to be issued was noticed. Re-set on an
  // already-pending id updates the value without losing its place in queue
  // order (Map preserves insertion order across a re-set of an existing key).
  const pending = new Map();
  // Ticks remaining in a member's current bounded fallback window (see
  // SQUAD.fallbackTicks), and the set of members that have already used
  // theirs up. A spent member never falls back again — there is no healing
  // to make it eligible a second time in any sense that isn't already
  // covered by "spend the same window twice."
  const fallbackTicksLeft = new Map();
  const fallbackSpent = new Set();

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
        const belowThreshold = a.hp <= a.hpMax * SQUAD.fallbackHealth;
        // Falling back is never appropriate while extracting: pulling away
        // from the exit the whole squad (and the hostage) is converging on
        // cannot ever resolve, it can only stall the arrival check
        // director.js gates 'done' on forever. A member that has already
        // spent its one bounded retreat is likewise permanently ineligible —
        // see fallbackTicks above for why there is no second window to grant.
        const eligible = belowThreshold && objective.kind !== 'extract' && !fallbackSpent.has(a.id);

        let hurt;
        if (!eligible) {
          // Ineligible (healthy, extracting, or already spent) means "do not
          // fall back right now" — it must NOT mean "forget how much of the
          // window is already used." Deleting the countdown here handed a
          // fresh, full SQUAD.fallbackTicks budget to any member ineligible
          // for even a single tick, which for a member that dips in and out
          // of eligibility (extract flips it off, a later phase flips it
          // back on) never lets the countdown reach zero at all — the exact
          // permanent-retreat bug this window exists to prevent, just
          // reinstated under cover of "ineligible right now." Leaving the
          // Map entry untouched here is what makes the countdown resume
          // where it left off instead of restarting.
          hurt = false;
        } else {
          const remaining = fallbackTicksLeft.get(a.id) ?? SQUAD.fallbackTicks;
          if (remaining <= 0) {
            fallbackSpent.add(a.id);
            fallbackTicksLeft.delete(a.id);
            hurt = false;
          } else {
            fallbackTicksLeft.set(a.id, remaining - 1);
            hurt = true;
          }
        }

        let want;
        if (hurt) {
          // Directly away from the objective, from the squad's centre.
          const dx = cx - objective.point.x;
          const dz = cz - objective.point.z;
          const len = Math.hypot(dx, dz) || 1;
          const anchor = {
            x: cx + (dx / len) * SQUAD.fallbackDistance,
            z: cz + (dz / len) * SQUAD.fallbackDistance,
          };
          // Same slot spread the advance uses, just around the rear anchor
          // instead of the objective point — more than one member below the
          // threshold at once must not collapse onto one identical rear
          // coordinate any more than the advance may collapse onto one
          // identical objective coordinate.
          want = slotPoint(anchor, slot, members.length);
        } else {
          want = slotPoint(objective.point, slot, members.length);
        }

        const last = issued.get(a.id);
        const moved = !last || Math.hypot(last.want.x - want.x, last.want.z - want.z) > SQUAD.reissueDistance;
        // "Has this agent arrived at what was actually last asked for" — not
        // "does it currently have no path" — is what has to gate reissuing.
        // world.js nulls both `path` and `goal` identically whether an agent
        // arrived or whether its last setGoal simply failed, so `!a.path`
        // alone cannot tell those two apart. Gating on it alone re-issues a
        // fresh setGoal — a full A* query, and a reset of the goal-stall
        // detector's bookkeeping — every tick an already-arrived member's
        // `want` has not moved by enough to be worth a new query: measured
        // at 1.5 setGoal calls/tick sustained forever with three parked
        // members (16,353 calls over one 9,600-tick mission), and it starves
        // the goal-stall detector of the 90 consecutive ticks it needs to
        // ever accumulate a strike — exactly what this file's own header
        // warns re-issuing every tick would do.
        const arrived = !!last && Math.hypot(a.x - last.target.x, a.z - last.target.z) < SQUAD.reissueDistance;
        if (moved || (!a.path && !arrived)) {
          pending.set(a.id, want);
        } else if (arrived) {
          pending.delete(a.id);
        }
      });

      // Issue at most one setGoal — one A* query — per tick. Four members all
      // getting a fresh goal in the same tick is the exact per-tick burst
      // orders.js staggers away from with its own one-per-tick stageIssue,
      // for the same reason: setGoal's A* query is not free, and orders.js
      // was already once found blowing the per-tick budget by firing every
      // member's at once. A stale entry (its agent died while queued) costs
      // nothing to drop, so dropping one does not use up this tick's one
      // real attempt.
      for (const [id, want] of pending) {
        pending.delete(id);
        const agent = world.agentById(id);
        if (!agent || !agent.alive) continue;
        const target = nearestWalkable(world.grid, want.x, want.z);
        if (world.setGoal(id, target)) issued.set(id, { want, target });
        break;
      }

      // A member that died still holds a stale entry in every one of these
      // per-agent maps/sets; drop it from all of them so a respawn or an id
      // reuse cannot inherit someone else's destination, retreat countdown,
      // or spent-fallback status.
      for (const id of [...issued.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) issued.delete(id);
      }
      for (const id of [...pending.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) pending.delete(id);
      }
      for (const id of [...fallbackTicksLeft.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) fallbackTicksLeft.delete(id);
      }
      for (const id of [...fallbackSpent]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) fallbackSpent.delete(id);
      }
    },
  };
}
