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
      // wanting to move (see the stall check in tick()).
      _stallX: spawn.x,
      _stallZ: spawn.z,
      _stallCountdown: STALL_WINDOW,
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

  const blockedAt = (x, z) => {
    const c = grid.worldToCell(x, z);
    return grid.isBlocked(c.col, c.row);
  };

  const doorBetween = (a, target) => {
    const c = grid.worldToCell(target.x, target.z);
    const id = grid.doorAt(c.col, c.row);
    if (id < 0 || isDoorOpen(id)) return -1;
    return id;
  };

  // Re-path from wherever the agent actually is, deliberately WITHOUT the
  // smoothing pass. A shortcut is exactly what jams an agent solid in the
  // first place: smoothPath's line-of-sight check samples every half-cell,
  // coarse enough to pronounce a shortcut clear when it grazes a prop or
  // wall corner between samples, and the same start position would smooth
  // to the same clipping shortcut every time — replanning with smoothing
  // would just reproduce the jam it is meant to fix. The raw cell-to-cell
  // route has no shortcuts to clip a corner with, only single-cell steps the
  // integrate-then-verify slide can always make. This is only ever reached
  // after the stall counter below trips, never pre-emptively, so it cannot
  // thrash: it fires once per genuine jam, not once per door toggle or once
  // per tick.
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
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW;
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

      // A shut door on the next waypoint: walk up to it, start it opening, and
      // only actually stop once within reach — the door cell itself is never
      // "blocked" in the nav grid (that is how a closed door differs from a
      // wall), so nothing else would halt an agent short of it.
      const blockingDoor = doorBetween(a, target);
      let aimX = dx;
      let aimZ = dz;
      let aimDist = dist;
      if (blockingDoor >= 0) {
        a.waitingFor = blockingDoor;
        const door = doors[blockingDoor];
        const doorDist = Math.hypot(door.x - a.x, door.z - a.z);
        if (doorDist < SIM.doorReach) {
          if (door.state === 'closed') door.state = 'opening';
          a.vx = 0; a.vz = 0;
          // Waiting on a door is not a jam: reset the window so the wait
          // itself is never mistaken for one once the door opens.
          a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW;
          continue;
        }
        // Still approaching: aim at the door itself, not the far waypoint on
        // the other side of it.
        aimX = door.x - a.x;
        aimZ = door.z - a.z;
        aimDist = doorDist;
      } else {
        a.waitingFor = -1;
      }

      let dirX = aimX / aimDist;
      let dirZ = aimZ / aimDist;

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

      // Integrate, then verify. Sliding along a blocked axis keeps an agent
      // moving past a corner instead of jamming against it.
      if (!blockedAt(nx, nz)) { a.x = nx; a.z = nz; }
      else if (!blockedAt(nx, a.z)) { a.x = nx; }
      else if (!blockedAt(a.x, nz)) { a.z = nz; }

      // Both slide attempts can still fail at a tight corner the smoothed
      // path clips (arriving within `arriveRadius` of one waypoint can leave
      // the agent off the exact line to the next, wedged against a wall it
      // then creeps along without ever actually clearing). Checked over a
      // half-second window rather than tick to tick, so this only fires on a
      // genuine jam and never on the ordinary give-and-take of separation
      // among crowded agents.
      a._stallCountdown--;
      if (a._stallCountdown <= 0) {
        const progressed = Math.hypot(a.x - a._stallX, a.z - a._stallZ);
        const expected = speed * SIM.step * STALL_WINDOW;
        if (expected > 0 && progressed < expected * STALL_FRACTION) replan(a);
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW;
      }

      a.vx = dirX * speed;
      a.vz = dirZ * speed;
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
