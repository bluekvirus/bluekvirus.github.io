// The mission director.
//
// Owns the objective, the outcome, the clock, and the hostiles' patrol — that
// is, everything that ticks and is not the squad's own tactical brain. It
// replaced the phase machine in orders.js (deleted at the phase D cutover),
// and its clock replaced that file's leg watchdogs.
//
// The clock is not a detail. Every anti-hang guarantee this project had lived
// in orders.js: LEG_TIMEOUT, LEG_MAX_REISSUES, the reissue-exhaustion escape,
// and the deliberate absence of an escape during extraction. Four separate
// stall classes were found and closed in phase C and three were only bounded
// because a watchdog eventually dragged the mission forward. Autonomy deletes
// all of that, so the replacement lands here, in the same task as the phase
// machine, rather than being bolted on later.

import { makeRng } from '../rng.js';
import { nearestWalkable } from './navgrid.js';
import { nextRoom } from './search.js';
import { SIM } from './world.js';

// 160 simulated seconds. A first pass at this constant (6000) was sized
// against a 45-mission sample whose worst case was 4111 ticks, and was
// itself found to be wrong: an independently-run 100-mission sample with a
// stand-in squad of the same shape put the real tail much further out --
// median 4218, p90 6090, p95 6512, max 7079, with 10 of 99 legitimate runs
// needing more than 6000 ticks. Comparing the 6000 clock against an
// otherwise-identical 30000-tick one over the same seeds showed 10
// 'timeout' verdicts, of which 9 were false: missions that actually reached
// `phase='done'`, `hostageReached=true`, `reason='extracted'`, reported as
// failures purely because the clock cut them off first. A clock that
// invalidates 91% of its own 'timeout' verdicts is worse than having no
// margin at all -- see task-2-report.md, round 3, for the full numbers.
//
// 9600 was chosen against that stand-in sample, where it cleared the observed
// 7079-tick max by ~1.36x. THAT MARGIN NO LONGER HOLDS, and this comment says
// so rather than leaving the flattering number standing.
//
// Re-measured at the phase D cutover against the real squad (Task 3) driven
// with this director exactly as main.js drives them, over ~450 missions across
// 8-12 rooms (the `tail-*` 250, `fmeas-*` 100, `widestall-*` 100 families plus
// the `dry-*`/`verify2-*`/`e2e-*` sets): **worst observed run 8757 ticks**, on
// seed `widestall-11-14` at 11 rooms, which resolves `success`/`extracted`.
// That is a margin of **1.10x**, not 1.36x. The real squad sweeps the whole
// building instead of beelining to the hostage, so it legitimately takes much
// longer than the stand-in this constant was sized against -- exactly the
// "if that measurably shifts the tail, this needs revisiting" case the
// previous version of this comment anticipated.
//
// The constant is deliberately NOT moved here. No measured mission has
// actually hit it (0 timeouts across all ~450), so nothing is being
// fabricated today, and raising the project's single remaining anti-hang
// bound is a change that wants its own before/after measurement rather than
// being folded into a cutover. But 1.10x is thin: a ~10% slowdown anywhere in
// the squad, the pathing, or the combat model would start manufacturing false
// 'timeout' verdicts, which is precisely the failure this constant's own
// history is a record of. Raising it is the recommended next piece of work;
// erring high costs only a slower test.
//
// This MUST sit BELOW whatever tick ceiling a headless-mission test harness
// uses, not above it -- a harness that gives up first would see `result`
// still `null` and misreport a genuine hang as "mission never resolved"
// instead of the clock's own 'timeout', which is the one failure mode this
// constant exists to name. (It previously sat at 10800, ABOVE the then
// dry-run harness's 7200-tick ceiling, with a comment claiming the opposite
// relationship.) Satisfied as of the cutover: dryrun.test.js's MAX_TICKS is
// 12600, comfortably above this value, with enough margin that neither number
// is a coincidence of the other.
export const MISSION_LIMIT = 9600;

const PATROL_PAUSE = 2.5;    // seconds a hostile waits before picking a new spot
const RESCUE_SIGHT = 4.0;    // metres: how close a member must be to see the hostage
const EXTRACT_RADIUS = 3.0;  // metres from the extraction point that counts as out

const centreOf = (cell) => ({ x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 });
const inCell = (a, c) => a.x >= c.x && a.x <= c.x + c.w && a.z >= c.z && a.z <= c.z + c.d;

export function createDirector(plan, mission) {
  const rng = makeRng(`${plan.seed}:mission`);
  const byId = new Map(plan.cells.map((c) => [c.id, c]));

  const state = {
    phase: 'search',
    result: null,
    reason: null,
    hostageReached: false,
    visited: new Set(),
    ticks: 0,
    targetCell: -1,
    patrol: new Map(),
  };

  // A cell is visited the moment a living member has come within RESCUE_SIGHT
  // of its CENTRE, not merely inside its bounds, and never reverts. That
  // monotonicity IS the termination argument for the sweep: key this on
  // "cleared of hostiles" instead and a hostile the squad cannot kill, or one
  // that wanders in behind them, leaves a cell permanently unvisited and the
  // search goes round forever.
  //
  // Centre proximity, not mere entry, is load-bearing: the hostage always
  // spawns at exactly its room's centre (roles.js), and a member sees it the
  // moment they are within RESCUE_SIGHT of that same point (the check below,
  // in 'search'). Marking a cell visited on bare entry let a member cross the
  // threshold of a large room, flip it to "done" on that same step, and have
  // `nextRoom` divert them to a different cell before they ever got near the
  // middle -- measured at 20 of 45 missions entering the hostage's room
  // without ever seeing the hostage, since room diagonals run 12-22m against
  // a 4m sight radius. Requiring the same distance used to spot the hostage
  // is what makes "this room is done" and "anything in it would have been
  // seen" the same claim, so reaching that bar for the hostage's own room
  // cannot help but also satisfy the sight check below in the same tick.
  const markVisited = (swat) => {
    for (const a of swat) {
      for (const c of plan.cells) {
        const centre = centreOf(c);
        // No `break`: cells are no longer disjoint under a radius test the
        // way they were under plain containment, so an agent can sit within
        // RESCUE_SIGHT of more than one cell's centre at once (small,
        // close-together rooms). Stopping at the first match in `plan.cells`
        // order let that first cell win and silently skipped the others even
        // when they were also in range -- under-marking only, never a
        // false-positive or a stall, but there is no reason to leave a cell
        // unmarked when it has genuinely been seen into.
        if (Math.hypot(a.x - centre.x, a.z - centre.z) < RESCUE_SIGHT) state.visited.add(c.id);
      }
    }
  };

  const currentCellOf = (agent) => {
    for (const c of plan.cells) if (inCell(agent, c)) return c.id;
    return mission.entryId;
  };

  const patrolHostiles = (world) => {
    for (const a of world.agents.filter((x) => x.role === 'hostile' && x.alive)) {
      const home = byId.get(a.cellId);
      if (!home) continue;
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
  };

  const api = {
    get phase() { return state.phase; },
    get result() { return state.result; },
    get reason() { return state.reason; },
    get hostageReached() { return state.hostageReached; },
    get visited() { return state.visited; },
    get objective() {
      if (state.phase === 'extract' || state.phase === 'done') {
        return { kind: 'extract', cellId: mission.entryId, point: mission.spawns.extraction };
      }
      if (state.phase === 'rescue') {
        const h = mission.spawns.hostage;
        return { kind: 'rescue', cellId: mission.hostageRoomId, point: { x: h.x, z: h.z } };
      }
      const cell = byId.get(state.targetCell);
      return {
        kind: 'clear',
        cellId: state.targetCell,
        point: cell ? centreOf(cell) : mission.spawns.extraction,
      };
    },

    update(world) {
      if (state.result !== null) return;

      state.ticks++;
      const swat = world.agents.filter((a) => a.role === 'swat' && a.alive);
      const hostage = world.agents.find((a) => a.role === 'hostage');

      // Terminal conditions first, so nothing below can run against a mission
      // that is already over.
      if (swat.length === 0) { state.result = 'failed'; state.reason = 'squad-lost'; return; }
      if (!hostage.alive) { state.result = 'failed'; state.reason = 'hostage-killed'; return; }
      if (state.ticks >= MISSION_LIMIT) { state.result = 'failed'; state.reason = 'timeout'; return; }

      patrolHostiles(world);
      markVisited(swat);

      if (state.phase === 'search') {
        // Found by sight, not by lookup: the squad has no idea where the
        // hostage is until a member is close enough to see it.
        const seen = swat.some((a) => Math.hypot(a.x - hostage.x, a.z - hostage.z) < RESCUE_SIGHT);
        if (seen) {
          state.phase = 'rescue';
          state.hostageReached = true;
          return;
        }
        const from = currentCellOf(swat[0]);
        if (state.targetCell === -1 || state.visited.has(state.targetCell)) {
          state.targetCell = nextRoom(plan, state.visited, from);
          // `nextRoom` deliberately never returns `fromId` — "where the squad
          // already is" is not a room to move to next (see search.js). But
          // STANDING IN a cell is not the same as having SEEN into it: this
          // director only marks a cell visited once a member is within
          // RESCUE_SIGHT (4m) of its CENTRE, and room diagonals run 12-22m.
          // So the lead can be inside the one remaining unvisited cell, six
          // metres from its middle, and `nextRoom` correctly reports "nowhere
          // else to go" — which the exhaustion branch below then reads as
          // "every cell has been searched."
          //
          // Measured on seed `widestall-11-14` (11 rooms): at tick 2186 the
          // only unvisited cell was 2, which was BOTH the hostage's room and
          // the cell the lead was standing in, 6.15m from its centre. The
          // search declared itself exhausted, the squad walked to the exit
          // with `hostageReached` still false, the hostage was never stood up,
          // and the mission burned the full 9600-tick clock to a `timeout`
          // with the hostage sitting 34m away. That is precisely the case the
          // comment on the exhaustion branch below used to claim could not
          // happen. Targeting `from` closes it: the squad walks to that cell's
          // own centre, which either marks it visited (and the search moves
          // on, monotonically) or spots the hostage on the way, since both use
          // the same RESCUE_SIGHT radius from the same centre point.
          if (state.targetCell === -1 && !state.visited.has(from)) state.targetCell = from;
        }
        // Every cell genuinely seen into and still no hostage. Nothing left to
        // search, so head for extraction and let the clock end it — note that
        // `hostageReached` is false on this path, so the 'done' gate below
        // cannot be satisfied and this can only ever resolve as a failure.
        if (state.targetCell === -1) state.phase = 'extract';
        return;
      }

      if (state.phase === 'rescue') {
        hostage.captive = false;
        state.phase = 'extract';
        return;
      }

      if (state.phase === 'extract') {
        const exit = mission.spawns.extraction;
        // The hostage is an NPC, not squad tactics, so escorting it out is the
        // director's job, not Task 3's: world.js spawns it with `wants: 0`
        // (a captive does not walk itself anywhere), and the only place that
        // used to raise it was orders.js's extract phase, which the cutover
        // deletes. Without this, `hostage.x/z` never change and the extract
        // arrival check above can never be satisfied — measured at 0
        // successes over 30 missions before this line existed. Re-issued
        // only when the hostage has no path (the same "if idle, give a fresh
        // goal" shape patrolHostiles already uses above), not every tick.
        // Gated on `hostageReached`, not just on being in this phase: a
        // still-captive hostage the squad never actually found should not
        // stand up and walk itself to the exit unescorted. Search-phase
        // exhaustion (see the 'search' branch above) reaches 'extract'
        // without ever setting `hostageReached`, and until now that path
        // was only latent -- Finding 1's fix means the search cannot
        // actually exhaust without finding the hostage first -- but nothing
        // here enforced it independently, so a future change to the search
        // logic could silently resurrect an unescorted walk-out.
        //
        // Routed to `nearestWalkable(exit)` rather than to `exit` itself.
        // `mission.spawns.extraction` lands on a BLOCKED navgrid cell in 6% of
        // plans (measured over 200), and findPath refuses a blocked goal
        // outright, so on those plans this setGoal could never succeed even
        // once: measured 7336 consecutive failures on seed `rr-27` and 6735 on
        // `squad-int-4` at 12 rooms, each ending in a `timeout` verdict with
        // the squad parked correctly at the exit and the hostage rooted where
        // it was rescued. squad.js has always run its own destinations through
        // the same helper, which is exactly why the squad arrived and the
        // hostage did not — the asymmetry was the bug, so both callers now use
        // navgrid.js's shared copy. The arrival check below still measures
        // against the true `exit`; EXTRACT_RADIUS (3m) comfortably covers the
        // sub-metre relocation a ring search makes.
        if (state.hostageReached) {
          hostage.wants = SIM.walkSpeed;
          if (!hostage.path) world.setGoal(hostage.id, nearestWalkable(world.grid, exit.x, exit.z));
        }
        const out = [...swat, hostage].every(
          (a) => Math.hypot(a.x - exit.x, a.z - exit.z) < EXTRACT_RADIUS);
        if (out && state.hostageReached) {
          state.phase = 'done';
          state.result = 'success';
          state.reason = 'extracted';
        }
      }
    },
  };

  return api;
}
