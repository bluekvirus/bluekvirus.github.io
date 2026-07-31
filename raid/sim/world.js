// The simulation.
//
// Fixed timestep, seeded, and completely free of Babylon: the renderer reads
// this, never the other way round. That is what lets a misbehaving agent be
// replayed from its seed, lets "did anyone walk through a wall" be a Node
// assertion, and keeps a headless RL environment possible later.

import { makeRng } from '../rng.js';
import { buildNavGrid } from './navgrid.js';
import { findPath, smoothPath } from './path.js';

export const SIM = Object.freeze({
  step: 1 / 60,
  walkSpeed: 1.4,
  runSpeed: 3.2,
  arriveRadius: 0.28,
  separation: 0.75,
  separationForce: 1.6,
  turnRate: 8,
  doorOpenTime: 0.4,
  doorReach: 0.9,
});

const round = (v) => Math.round(v * 1e4) / 1e4;

// How the "am I actually jammed" check is windowed: measured over half a
// second of ticks rather than tick-to-tick, so the ordinary noise of
// separation nudges among crowded agents never reads as a jam — only a
// sustained failure to cover a reasonable fraction of the ground a clear
// run at `wants` speed would have covered does.
const STALL_WINDOW = 30;
const STALL_FRACTION = 0.2;

export function createWorld(plan, mission, placements = []) {
  const grid = buildNavGrid(plan, placements);
  const rng = makeRng(`${plan.seed}:sim`);

  const doors = {};
  for (const d of plan.doors) doors[d.id] = { id: d.id, state: 'closed', timer: 0, x: d.x, z: d.z };

  const isDoorOpen = (id) => doors[id]?.state === 'open';

  const agents = [];
  const add = (role, spawn) => {
    agents.push({
      id: agents.length,
      role,
      // The cell this agent spawned in. Carried here so behaviour code can ask
      // an agent where it belongs, rather than reconstructing it from an index
      // offset into mission.spawns — which silently breaks the moment the cast
      // order changes.
      cellId: spawn.cellId ?? -1,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      speed: 0,
      facing: spawn.facing ?? 0,
      goal: null,
      path: null,
      pathIndex: 0,
      waitingFor: -1,
      wants: role === 'hostage' ? 0 : SIM.walkSpeed,
      // Internal bookkeeping, not part of the public Agent shape: a rolling
      // checkpoint used to notice when an agent is barely crawling despite
      // wanting to move, and whether anything in the current window was
      // actually a wall refusing it, rather than mutual give-and-take with
      // other agents (see the stall check in tick()).
      _stallX: spawn.x,
      _stallZ: spawn.z,
      _stallCountdown: STALL_WINDOW,
      _stallSawWall: false,
    });
  };
  mission.spawns.swat.forEach((s) => add('swat', s));
  mission.spawns.hostiles.forEach((s) => add('hostile', s));
  add('hostage', mission.spawns.hostage);

  const world = {
    grid,
    agents,
    doors,
    rng,
    time: 0,
    ticks: 0,
    isDoorOpen,
    agentById: (id) => agents[id],
  };

  world.setGoal = (id, point) => {
    const a = agents[id];
    if (!a) return false;
    // Path with every door treated as open. A closed door on the route is a
    // thing to walk up to and open, not a reason to route the long way round —
    // and re-pathing every time a door changes state would thrash.
    const raw = findPath(grid, a, point, () => true);
    if (!raw) { a.goal = null; a.path = null; return false; }
    a.goal = { x: point.x, z: point.z };
    a.path = smoothPath(grid, raw, () => true);
    a.pathIndex = 0;
    a.waitingFor = -1;
    return true;
  };

  // What refuses a proposed move into (x, z): a wall, a specific shut door,
  // or nothing. A closed (or still-opening) door counts as blocked exactly
  // like a wall — that is what makes "walk up to a shut door and wait" a
  // physical guarantee rather than a distance-based approximation, and
  // reporting which door (if any) is what lets a stalled step be classified
  // by what actually stopped it, rather than by scanning ahead for any
  // closed door that happens to sit somewhere further down the smoothed
  // route (see the classification in tick(), and the regression test for
  // why that distinction matters).
  const refusalAt = (x, z) => {
    const c = grid.worldToCell(x, z);
    if (grid.isBlocked(c.col, c.row)) return { blocked: true, doorId: -1 };
    const id = grid.doorAt(c.col, c.row);
    if (id >= 0 && !isDoorOpen(id)) return { blocked: true, doorId: id };
    return { blocked: false, doorId: -1 };
  };
  const blockedAt = (x, z) => refusalAt(x, z).blocked;

  // Re-path from wherever the agent actually is, deliberately WITHOUT the
  // smoothing pass. `hasLineOfSight` (path.js) is an exact cell traversal
  // now, not the point sample it used to be, so a shortcut it approves can
  // no longer be what clips a corner — but the raw, single-cell-step route
  // is still what recovers fastest from a genuine jam, since it never has
  // to re-derive a shortcut at all. This is only ever reached after the
  // stall counter below trips, and only once real wall evidence has been
  // seen (not merely low net progress — see that check), so it cannot
  // thrash: it fires once per genuine jam, not once per door toggle, once
  // per tick, or once per bout of ordinary crowding near a shared goal.
  const replan = (a) => {
    if (!a.goal) return false;
    const raw = findPath(grid, a, a.goal, () => true);
    if (!raw) { a.path = null; a.goal = null; return false; }
    a.path = raw;
    a.pathIndex = 0;
    return true;
  };

  world.tick = () => {
    // Doors first, so an agent that opened one last tick can move through it
    // on this one rather than stuttering for a frame.
    for (const d of Object.values(doors)) {
      if (d.state === 'opening') {
        d.timer += SIM.step;
        if (d.timer >= SIM.doorOpenTime) { d.state = 'open'; d.timer = SIM.doorOpenTime; }
      }
    }

    for (const a of agents) {
      a.speed = 0;
      if (!a.path || a.pathIndex >= a.path.length) {
        a.vx = 0; a.vz = 0;
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
        continue;
      }

      const target = a.path[a.pathIndex];
      const dx = target.x - a.x;
      const dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);

      if (dist < SIM.arriveRadius) {
        a.pathIndex++;
        if (a.pathIndex >= a.path.length) { a.path = null; a.goal = null; a.vx = 0; a.vz = 0; }
        continue;
      }

      let dirX = dx / dist;
      let dirZ = dz / dist;

      // Separation, capped: it may nudge an agent aside in a doorway but must
      // never be strong enough to shove one through a wall.
      let sepX = 0;
      let sepZ = 0;
      for (const other of agents) {
        if (other === a) continue;
        const ox = a.x - other.x;
        const oz = a.z - other.z;
        const d = Math.hypot(ox, oz);
        if (d > 1e-6 && d < SIM.separation) {
          const push = (SIM.separation - d) / SIM.separation;
          sepX += (ox / d) * push;
          sepZ += (oz / d) * push;
        }
      }
      dirX += sepX * SIM.separationForce * 0.5;
      dirZ += sepZ * SIM.separationForce * 0.5;
      const norm = Math.hypot(dirX, dirZ) || 1;
      dirX /= norm;
      dirZ /= norm;

      const speed = a.wants;
      const nx = a.x + dirX * speed * SIM.step;
      const nz = a.z + dirZ * speed * SIM.step;
      const beforeX = a.x;
      const beforeZ = a.z;

      // Integrate, then verify. Sliding along a blocked axis keeps an agent
      // moving past a corner instead of jamming against it — and, since a
      // shut door counts as blocked too, is what actually stops an agent at
      // one. Each attempt's refusal reason is kept (only computed if the
      // previous attempt failed, same short-circuiting as before) so that,
      // if the agent ends up not moving at all, classification below can ask
      // what actually refused THIS step rather than scanning ahead for any
      // closed door on the smoothed route — a door metres away on the same
      // segment as a genuine wall-corner jam is not what is stopping the
      // agent, and must not be reported, or mistaken, as such.
      const primary = refusalAt(nx, nz);

      // A shut door directly ahead starts opening once in reach, regardless
      // of whether this particular step actually moves the agent. Tying
      // this to "did the agent fully stop" instead would deadlock a crowd
      // at a doorway forever: several agents jostling for the same narrow
      // opening can perpetually find SOME sliding movement via separation,
      // never fully stopping, so the door would never be told to open at
      // all and nobody would ever get through.
      if (primary.doorId >= 0) {
        const door = doors[primary.doorId];
        if (door.state === 'closed' && Math.hypot(door.x - a.x, door.z - a.z) < SIM.doorReach) {
          door.state = 'opening';
        }
      }

      const slideX = primary.blocked ? refusalAt(nx, a.z) : null;
      const slideZ = (slideX && slideX.blocked) ? refusalAt(a.x, nz) : null;

      if (!primary.blocked) { a.x = nx; a.z = nz; }
      else if (!slideX.blocked) { a.x = nx; }
      else if (!slideZ.blocked) { a.z = nz; }

      const moved = Math.hypot(a.x - beforeX, a.z - beforeZ);
      const refusedByDoor = moved < 1e-9
        ? [primary, slideX, slideZ].find((r) => r && r.doorId >= 0)
        : undefined;

      if (refusedByDoor) {
        // Genuinely refused by a shut door right here, not jammed against a
        // wall: report it (the door itself is already nudged open above,
        // if in reach), and reset the stall window so the wait itself is
        // never mistaken for a jam once the door opens.
        a.waitingFor = refusedByDoor.doorId;
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
      } else {
        a.waitingFor = -1;
        // The primary (most direct) step being refused — by a wall, or by a
        // door not yet close enough to be worth opening — is evidence for
        // this window, even on a tick where a fallback slide still lands
        // some partial, nonzero progress; that is exactly the "creeps along
        // a wall without ever truly clearing it" case this detector exists
        // to catch. A tick where nothing was refused at all but the agent
        // still barely moved is not: every crowded agent converging on one
        // point eventually decelerates to a near-standstill purely from
        // mutual separation, on perfectly open floor, and that alone must
        // not justify a re-path.
        if (primary.blocked) a._stallSawWall = true;

        // Both slide attempts can still fail at a tight corner the smoothed
        // path clips (arriving within `arriveRadius` of one waypoint can
        // leave the agent off the exact line to the next, wedged against a
        // wall it then creeps along without ever actually clearing).
        // Checked over a half-second window rather than tick to tick, so
        // this only fires on a genuine jam.
        a._stallCountdown--;
        if (a._stallCountdown <= 0) {
          const progressed = Math.hypot(a.x - a._stallX, a.z - a._stallZ);
          const expected = speed * SIM.step * STALL_WINDOW;
          if (a._stallSawWall && expected > 0 && progressed < expected * STALL_FRACTION) replan(a);
          a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
        }
      }

      // Velocity reflects actual displacement, not intent: an agent halted
      // at a shut door or jammed against a corner is not "walking in place".
      a.vx = (a.x - beforeX) / SIM.step;
      a.vz = (a.z - beforeZ) / SIM.step;
      a.speed = Math.hypot(a.vx, a.vz);

      const want = Math.atan2(dirX, dirZ);
      let delta = want - a.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      a.facing += delta * Math.min(1, SIM.turnRate * SIM.step);
    }

    world.time += SIM.step;
    world.ticks++;
  };

  world.hash = () => {
    const parts = [];
    for (const a of agents) {
      parts.push(`${a.id}:${round(a.x)},${round(a.z)},${round(a.facing)},${round(a.speed)},${a.waitingFor}`);
    }
    for (const d of Object.values(doors)) parts.push(`d${d.id}:${d.state}:${round(d.timer)}`);
    return parts.join('|');
  };

  return world;
}
