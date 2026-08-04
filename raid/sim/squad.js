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

import { nearestWalkable } from './navgrid.js';
import { SIM } from './world.js';

export const SQUAD = Object.freeze({
  // Metres each member's destination sits off the shared objective point, so
  // four agents never share one coordinate. Sharing a coordinate is what let
  // goal-pull and separation-push cancel exactly in phase B, freezing an
  // agent that could not tell it was making no progress.
  spread: 1.1,
  // Re-issue a member's goal when its intended destination has moved at least
  // this far. Small enough to track a changing objective, large enough that
  // ordinary jitter does not trigger an A* query every tick. Doubles as the
  // "close enough to its last issued goal to count as arrived" radius (see
  // the arrival check in update, below) — both are the same "not worth a
  // fresh A* query over" judgment call.
  reissueDistance: 1.5,
});

// A prior revision pulled a badly hurt member back from the advance below a
// health threshold (`fallbackHealth`), bounded to one 3600-tick window per
// member. Measured directly against its own absence over two independent
// 300-mission seed families (rooms 8-12): it cost 8-10 points of extraction
// rate (42.7% -> 51.7% and 44.3% -> 54.0%), produced 35-79% more squad wipes,
// and made missions run 21-29% longer — with zero timeouts either way, so
// none of that cost was ever recovered as fewer hangs. Its own stated purpose
// ("the others keep going, and it rejoins once it is no longer the most
// exposed") was never built: there is no rejoin condition, only the fixed
// timer, and a hurt member pulling itself out of the fight is not neutral —
// it is one fewer gun on the firefight that is actually killing the squad.
// Removed rather than kept and retuned; see task-1-report.md for the full
// measurement.

/** Even spread around a shared point, by fixed slot — never random. */
const slotPoint = (point, slot, total) => {
  const angle = (slot / Math.max(1, total)) * Math.PI * 2;
  return {
    x: point.x + Math.cos(angle) * SQUAD.spread,
    z: point.z + Math.sin(angle) * SQUAD.spread,
  };
};

// Every destination this module issues goes through navgrid.js's
// `nearestWalkable` first: the director hands out the geometric centre of the
// target cell as `objective.point` with no regard for what furnish.js put
// there, and measured across 200 director plans, 129 of 2400 cell centres were
// blocked navgrid cells (48% of plans hit at least one — and separately, over
// 58 real blocked-centre objectives driven through this module, 35 had a slot
// point itself blocked too, not merely the shared centre). See navgrid.js for
// why a blocked point is a permanent, silent setGoal failure rather than a
// recoverable one.

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

      members.forEach((a, slot) => {
        const want = slotPoint(objective.point, slot, members.length);

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
      // getting a fresh goal in the same tick is the exact per-tick burst the
      // deleted orders.js staggered away from with its own one-per-tick
      // stageIssue, for the same reason: setGoal's A* query is not free, and
      // orders.js was once found blowing the per-tick budget by firing every
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

      // A member that died still holds a stale entry in these per-agent maps;
      // drop it from both so a respawn or an id reuse cannot inherit someone
      // else's destination.
      for (const id of [...issued.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) issued.delete(id);
      }
      for (const id of [...pending.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) pending.delete(id);
      }
    },
  };
}
