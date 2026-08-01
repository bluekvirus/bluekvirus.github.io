// The scripted mission dry run.
//
// Deliberately dumb: this exists so the movement machinery can be judged before
// any real decision-making is layered on. Phase D replaces this file wholesale,
// and nothing beneath it should need to change when that happens — if it does,
// the boundary was drawn in the wrong place.

import { makeRng } from '../rng.js';
import { SIM } from './world.js';

const ARRIVED = 1.4;      // how close counts as "at" a room or point
const PATROL_PAUSE = 2.5; // seconds a hostile waits before picking a new spot
const FORMATION_RADIUS = 0.8; // metres each squad member's destination sits off the shared point

// Neither phase below had any bound on how long it would wait: both block
// on every squad member arriving, so one member that cannot get there hangs
// the whole mission forever rather than failing. The simulation underneath
// is what has to not strand agents in the first place — this is the outer
// guard that turns "never finishes" into "finishes late", which is a
// bounded, observable degradation instead of a hang.
//
// 3600 ticks is 60 simulated seconds. The longest single leg measured over
// 460 healthy dry runs (families sweep/verify2/dry across 8-12 rooms, plus
// all 60 orders-N seeds) was 2157 ticks, so this cannot fire on a run that
// is merely slow. Re-issuing is the first response because it is the one
// that cannot fabricate progress: every goal is recomputed from where the
// agents actually are, which re-paths a straggler and resets its stall
// bookkeeping. Only the advance phase may eventually stop waiting and move
// to the next leg — its legs are waypoints on the way to the hostage, so
// skipping one degrades the route, not the outcome. The extract phase never
// gets that escape: "everyone reached extraction" is the thing the dry run
// exists to demonstrate, and a timeout must not be able to claim it.
const LEG_TIMEOUT = 3600;
// 4, not 3: LEG_TIMEOUT * (LEG_MAX_REISSUES + 1) must not collide with the
// 14,400-tick ceilings the long-run test harnesses use (orders.test.js's
// "dry" and "replaying" suites both run for 60 * 240 ticks). At 3 reissues
// the product was exactly 14,400 — a coincidence that let either constant
// silently mask a real regression in the other (a genuinely-hung run and a
// deliberately-exhausted watchdog would time out at the identical tick and
// be indistinguishable). 4 keeps the same "keep going without them" recovery
// this watchdog exists for, just decoupled from that number.
const LEG_MAX_REISSUES = 4;

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
    legTicks: 0,   // ticks spent on the current leg, for the watchdog above
    reissues: 0,   // how many times this leg's goals have been re-issued
    patrol: new Map(), // agentId -> seconds until the next patrol goal
    // Ground truth for whether the squad actually arrived at the hostage's
    // room, as opposed to the advance watchdog giving up and skipping the
    // final leg (see the reissue-exhaustion branch below). `phase === 'done'`
    // alone cannot tell those apart — both reach 'extract' and then 'done'
    // the same way — so this is what lets a caller (and the end-to-end test)
    // tell a genuine rescue from a mission that quietly walked past it.
    hostageReached: false,
  };

  // Start the current leg over: fresh setGoal calls for everyone from wherever
  // they actually are now.
  const restartLeg = () => {
    state.issued = false;
    state.issueQueue = null;
    state.legTicks = 0;
  };

  const beginLeg = () => { restartLeg(); state.reissues = 0; };

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
    // Ground truth behind `phase === 'done'` — see the field comment on
    // `state.hostageReached` above.
    get hostageReached() { return state.hostageReached; },
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
        // A squad advances to contact fast, not at a stroll — running is
        // what SIM.runSpeed and the Run clip exist for (see agents.js). Set
        // every tick rather than once: cheap (no side effects beyond the
        // number `wants` itself, see world.js), and keeps this correct even
        // if an agent's wants was ever touched elsewhere.
        for (const a of swat) a.wants = SIM.runSpeed;
        const centre = centreOf(route[state.leg]);
        state.legTicks++;
        // Gated on `state.legTicks` alone, deliberately NOT on `state.issued`.
        // This watchdog exists precisely for the case where issuing itself is
        // what is failing — a squad member standing on a perfectly open cell
        // whose *destination* this leg happens to be unreachable from (a
        // formation point that lands across a sealed corridor, say) never
        // gets `setGoal` to succeed, so `state.issued` never becomes true.
        // Requiring it here as well would make the one thing meant to bound
        // this failure depend on the failure not happening — a guard gated on
        // the thing it is supposed to guard against, which cannot ever fire.
        // `state.legTicks` — simulated ticks, counted every update() call
        // regardless of anything else in this phase — elapses whether or not
        // issuing is succeeding, so that is what this is keyed on instead.
        if (state.legTicks > LEG_TIMEOUT) {
          state.reissues++;
          if (state.reissues > LEG_MAX_REISSUES) {
            // Stop waiting for whoever is not coming. The next leg's goals
            // go out to the whole squad, straggler included, so this is
            // "keep going and take them with you", not "abandon them".
            state.leg++;
            beginLeg();
            if (state.leg >= route.length) { state.phase = 'rescue'; }
            return;
          }
          restartLeg();
        }
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
          beginLeg();
          if (state.leg >= route.length) {
            state.phase = 'rescue';
            // Reached here via genuine arrival (`allThere`), never via the
            // reissue-exhaustion watchdog above — that branch returns before
            // this point, so this is only ever true when the squad actually
            // stood in the hostage's room.
            state.hostageReached = true;
          }
        }
        return;
      }

      if (state.phase === 'rescue') {
        // The hostage joins the squad and they all head for extraction.
        state.phase = 'extract';
        beginLeg();
        return;
      }

      if (state.phase === 'extract') {
        const exit = mission.spawns.extraction;
        // A squad moves fast to contact but slow with a casualty: escorting
        // the hostage out is a walk, not a run, for the whole squad as well
        // as the hostage — same reasoning as the run speed set in 'advance'
        // above.
        for (const a of swat) a.wants = SIM.walkSpeed;
        hostage.wants = SIM.walkSpeed;
        // The squad plus the rescued hostage: one more formation slot than
        // the advance phase used, so the hostage gets its own spot too
        // instead of sharing the exact extraction coordinate with whichever
        // SWAT member happens to arrive alongside it.
        const total = swat.length + 1;
        state.legTicks++;
        // Re-issue only — never a way out of the arrival check itself. Gated
        // on ticks alone, not on `state.issued`, for the same reason as the
        // advance-phase watchdog above: `state.issued` is exactly what a
        // permanently-failing `setGoal` prevents from ever becoming true, so
        // requiring it here too would make this restart unable to fire in
        // the one case it exists for.
        if (state.legTicks > LEG_TIMEOUT) { state.reissues++; restartLeg(); }
        if (!state.issued) {
          const tasks = swat.map((a, i) => ({ agent: a, point: formationPoint(exit, i, total) }));
          tasks.push({ agent: hostage, point: formationPoint(exit, swat.length, total) });
          stageIssue(world, tasks);
        }
        const out = [...swat, hostage].every((a) => Math.hypot(a.x - exit.x, a.z - exit.z) < 3);
        if (out) state.phase = 'done';
      }
    },
  };

  return api;
}
