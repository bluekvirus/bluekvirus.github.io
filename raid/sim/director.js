// The mission director.
//
// Owns the objective, the outcome, the clock, and the hostiles' patrol — that
// is, everything that ticks and is not the squad's own tactical brain. It
// replaces the phase machine in orders.js, and its clock replaces that file's
// leg watchdogs.
//
// The clock is not a detail. Every anti-hang guarantee this project had lived
// in orders.js: LEG_TIMEOUT, LEG_MAX_REISSUES, the reissue-exhaustion escape,
// and the deliberate absence of an escape during extraction. Four separate
// stall classes were found and closed in phase C and three were only bounded
// because a watchdog eventually dragged the mission forward. Autonomy deletes
// all of that, so the replacement lands here, in the same task as the phase
// machine, rather than being bolted on later.

import { makeRng } from '../rng.js';
import { nextRoom } from './search.js';
import { SIM } from './world.js';

// 100 simulated seconds. Measured with a stand-in squad brain (Task 3 owns
// the real one) over 130+ full autonomous missions at 8-12 rooms: a
// legitimately-progressing run (full sweep, or found early, plus rescue and
// escort) finished in 4111 ticks worst case, ~2900 median -- see
// task-2-report.md, Important 3, for the raw numbers. 6000 leaves that worst
// case a comfortable ~1.5x of headroom without being so large it stops
// meaning anything.
//
// This MUST sit BELOW whatever tick ceiling a headless-mission test harness
// uses, not above it -- a harness that gives up first would see `result`
// still `null` and misreport a genuine hang as "mission never resolved"
// instead of the clock's own 'timeout', which is the one failure mode this
// constant exists to name. (It previously sat at 10800, ABOVE the existing
// dry-run harness's 7200-tick ceiling, with a comment claiming the opposite
// relationship -- see task-2-report.md, Important 3, for how that was
// found and fixed.) Task 4's headless-mission harness must set its own
// ceiling comfortably above this value -- recommended 9600 -- with enough
// margin that neither number is a coincidence of the other.
export const MISSION_LIMIT = 6000;

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
        if (Math.hypot(a.x - centre.x, a.z - centre.z) < RESCUE_SIGHT) { state.visited.add(c.id); break; }
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
        }
        // Every cell visited and still no hostage. Nothing left to search, so
        // head for extraction and let the clock or the arrival check end it.
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
        hostage.wants = SIM.walkSpeed;
        if (!hostage.path) world.setGoal(hostage.id, exit);
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
