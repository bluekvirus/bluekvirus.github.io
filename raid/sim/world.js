// The simulation.
//
// Fixed timestep, seeded, and completely free of Babylon: the renderer reads
// this, never the other way round. That is what lets a misbehaving agent be
// replayed from its seed, lets "did anyone walk through a wall" be a Node
// assertion, and keeps a headless RL environment possible later.

import { makeRng } from '../rng.js';
import { buildNavGrid } from './navgrid.js';
import { findPath, smoothPath } from './path.js';
import { createCombat, COMBAT, rangeOf } from './combat.js';

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

// A second, independent stall signal: has the agent gotten meaningfully
// closer to its current waypoint at all in the last GOAL_STALL_WINDOW
// ticks? Unlike the wall-evidence check above, this does not care whether
// `refusalAt` ever reported anything blocked — several agents converging
// on one shared point can have their goal-pull and separation-push vectors
// cancel to exactly zero, or land back on their own already-open cell,
// which reports as "not blocked" forever while genuinely never getting an
// inch closer. Comfortably above the ~25 ticks an agent legitimately
// spends waiting for a door to open, so that wait is never misread as this
// kind of stall.
const GOAL_STALL_WINDOW = 90;
const GOAL_STALL_EPS = 0.02;

// How long the tie-breaking sideways nudge (below) stays applied after a
// stall strike. It is deliberately a short impulse rather than a standing
// steering bias: at the magnitudes needed to shove an agent out of a
// face-to-face corridor stand-off, a *permanent* sideways term overwhelms
// the goal pull entirely and steers the agent along whatever wall it is
// against instead of toward its destination — which does not deadlock it
// (it keeps moving, so no "stuck" signal fires) but does live-lock it, and
// the escalation then ratchets the bias up forever because the agent never
// gets closer to its goal. Shoving for a third of a second and then
// steering normally again gives the agent a chance to actually use the
// space the shove opened up. Escalation still persists across bursts, so a
// genuinely symmetric stand-off keeps getting harder shoves.
const NUDGE_TICKS = 20;

// How long an agent that has been asked to give way spends backing off.
// A sideways nudge cannot solve a stand-off over a gap narrower than
// `SIM.separation` — two agents contending for a one-cell doorway push each
// other out of it symmetrically, and nudging both aside only decides which
// of them misses the opening. One of them has to retreat far enough to stop
// pushing at all, which means clearing the separation radius: 0.75m at
// walking pace is ~32 ticks, so this is that with margin.
const YIELD_TICKS = 45;

// Every field either stall detector owns, reset to "clean, starting fresh
// from here". Shared by every tick()-loop branch that deliberately holds or
// idles rather than jams -- a gun halt, a melee hold, and an agent with
// nothing left to do all mean the exact same thing to both detectors: this
// is not evidence of being stuck. Extracted after the melee-hold branch was
// found (Task 10 review) to have skipped this reset entirely, the one the
// gun-halt branch had always done -- three call sites carrying an identical
// ten-field block by copy-paste is itself the kind of drift that let that
// asymmetry happen unnoticed in the first place.
const resetStallBookkeeping = (a) => {
  a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
  a._goalBestDist = Infinity; a._goalCountdown = GOAL_STALL_WINDOW; a._goalStrikes = 0;
  a._nudgeBias = 0; a._nudgeTicks = 0; a._yieldTicks = 0;
};

export function createWorld(plan, mission, placements = []) {
  const grid = buildNavGrid(plan, placements);
  const rng = makeRng(`${plan.seed}:sim`);

  const doors = {};
  for (const d of plan.doors) doors[d.id] = { id: d.id, state: 'closed', timer: 0, x: d.x, z: d.z };

  const isDoorOpen = (id) => doors[id]?.state === 'open';

  const agents = [];
  // Invariant: `id` is assigned as this array's own length at push time, and
  // nothing ever reorders or splices `agents` afterward — so array position
  // equals id for the whole life of a world. combat.js's target resolution
  // (`byId.get`), the halt/chase branches and `_yieldTo` lookups below
  // (`agents[...]`), `agentById`, and dryrun.test.js's `isEngaged` all index
  // this array directly by id rather than searching it, and depend on that
  // holding. A caller that reorders `agents` (combat.test.js's `order`
  // fixture does exactly this, deliberately, to prove combat.js itself does
  // not rely on it) must not carry that assumption into this module.
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
      // The second, independent stall signal (see GOAL_STALL_WINDOW): the
      // closest this agent has gotten to its current waypoint recently, how
      // many ticks are left before that has to have improved, and how many
      // times in a row it hasn't — which is what decides whether a plain
      // replan is enough or a small tie-breaking nudge is warranted too.
      _goalBestDist: Infinity,
      _goalCountdown: GOAL_STALL_WINDOW,
      _goalStrikes: 0,
      _nudgeBias: 0,
      _nudgeTicks: 0,
      _yieldTicks: 0,
      _yieldTo: -1,
      weapon: spawn.weapon ?? (role === 'hostage' ? 'none' : 'gun'),
      hp: role === 'swat' ? COMBAT.swatHp : role === 'hostage' ? COMBAT.hostageHp : COMBAT.hostileHp,
      hpMax: role === 'swat' ? COMBAT.swatHp : role === 'hostage' ? COMBAT.hostageHp : COMBAT.hostileHp,
      alive: true,
      target: -1,
      chasing: false,
      cooldown: 0,
      firedAt: -1,
      hitAt: -1,
      diedAt: -1,
      // The hostage is a prisoner until the squad reaches it: combat.js
      // treats a captive hostage as untargetable, so hostiles do not shoot
      // their own leverage. director.js clears this flag in the rescue phase
      // once the squad actually reaches the hostage, so from that point on
      // hostiles can target it and the "hostage killed" failure condition
      // becomes reachable.
      captive: role === 'hostage',
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

  const combat = createCombat({
    grid, agents, rng, isDoorOpen, step: SIM.step,
    runSpeed: SIM.runSpeed, walkSpeed: SIM.walkSpeed,
  });

  world.setGoal = (id, point) => {
    const a = agents[id];
    if (!a) return false;
    // A corpse cannot be given new orders. Without this, a caller that built
    // its task list from the living squad and then dispatches it staggered
    // over several ticks (see squad.js's one-setGoal-per-tick stagger) can
    // still hand a setGoal to an agent that died in the ticks between: tick()
    // already skips dead agents in its movement loop, so a path/goal written here
    // after death is never read by movement, never cleared by another death
    // (kill() only runs once, at the moment hp reaches zero), and the corpse
    // holds it forever -- indistinguishable from a genuinely frozen agent to
    // anything measuring "is this agent's position changing while it holds a
    // path." Refusing here, at the one place a goal is ever written, is
    // cheaper and more robust than requiring every caller to remember to
    // check `alive` first.
    if (!a.alive) return false;
    // Path with every door treated as open. A closed door on the route is a
    // thing to walk up to and open, not a reason to route the long way round —
    // and re-pathing every time a door changes state would thrash.
    const raw = findPath(grid, a, point, () => true);
    if (!raw) { a.goal = null; a.path = null; return false; }
    a.goal = { x: point.x, z: point.z };
    a.path = smoothPath(grid, raw, () => true);
    a.pathIndex = 0;
    a.waitingFor = -1;
    a._goalBestDist = Infinity; a._goalCountdown = GOAL_STALL_WINDOW; a._goalStrikes = 0; a._nudgeBias = 0; a._nudgeTicks = 0; a._yieldTicks = 0;
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

  // Re-path from wherever the agent actually is, keeping the first few steps
  // raw and smoothing everything past them.
  //
  // This used to hand back the raw grid route entire, on the reasoning that
  // single-cell steps are what recovers fastest from a jam. The recovery
  // argument is sound but it was applied to the whole route, and a replan
  // never expires: an agent that jammed once then ran the rest of its journey
  // as a cell-by-cell staircase. Measured over 100 missions, 17.4% of all
  // agent-ticks were spent on such a path, at a visibly reduced speed, because
  // a 45-degree staircase covers less ground per step than the straight line
  // it approximates and the turn rate never settles.
  //
  // What actually recovers a jam is the raw stepping NEAR the agent — the
  // stretch where it is wedged and needs to pick its way out one cell at a
  // time. Beyond that the argument does not apply, and smoothing there is
  // free: `hasLineOfSight` is an exact cell traversal now, not the point
  // sample it used to be, so a shortcut it approves cannot be what clips a
  // corner. So the lead stays raw and the tail gets smoothed.
  //
  // RAW_LEAD is in waypoints, and a raw waypoint is one grid cell, so this is
  // ~1m of picking-out-of-the-jam before the route opens up again — comfortably
  // past the arriveRadius (0.28m) and the separation radius (0.75m) that
  // define how far a jam physically extends.
  const RAW_LEAD = 4;
  const replan = (a) => {
    if (!a.goal) return false;
    const raw = findPath(grid, a, a.goal, () => true);
    if (!raw) { a.path = null; a.goal = null; return false; }
    if (raw.length > RAW_LEAD) {
      // The tail is smoothed starting FROM the last raw waypoint, not from the
      // one after it, so the join is a segment smoothPath actually checked for
      // line of sight; slicing the two halves apart at different points would
      // leave one unverified segment across the seam.
      const tail = smoothPath(grid, raw.slice(RAW_LEAD - 1), () => true);
      a.path = raw.slice(0, RAW_LEAD - 1).concat(tail);
    } else {
      a.path = raw;
    }
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

    // Before movement, so a decision to stand and fight applies on the tick it
    // is made rather than one tick late. combat.js owns the alive/hp
    // invariant entirely (including self-healing an agent whose hp reached
    // zero by some means other than its own attacks) -- world.js needs no
    // death-handling code of its own.
    combat.step(world.ticks);

    for (const a of agents) {
      a.speed = 0;
      if (!a.alive) { a.vx = 0; a.vz = 0; continue; }

      // Engaged with a gun: stand and shoot. Movement stops, but the agent
      // still turns to face what it is shooting at.
      //
      // Gated on actual weapon range (`rangeOf`), not merely on having a
      // target: combat.js's own canTarget acquires and holds a target out to
      // `sightRange` (12m), a full 2m past `gunRange` (10m) at which it could
      // ever actually fire. Halting for that entire gap left two agents that
      // could see but not hit each other frozen facing one another forever —
      // neither firing (out of range), neither moving (deliberate-halt
      // bookkeeping exempts them from every stall detector) — an unbounded
      // hang no watchdog above this layer can see, because nothing here ever
      // looks stuck by the signals they check. Out of range, this agent falls
      // through to ordinary path movement instead, which is what lets it
      // close the distance (or simply carry on its orders) until it is
      // actually able to shoot.
      //
      // The stall bookkeeping is reset every tick this holds, for the same
      // reason the door-wait branch below resets it: this is a deliberate
      // wait, not a jam. Without this the goal-stall detector counts the
      // firing position as a lack of progress, strikes, replans, and finally
      // nudges the agent sideways along whatever wall it is behind — the
      // recovery machinery actively fighting the behaviour it should ignore.
      if (a.target >= 0 && !a.chasing && Math.hypot(agents[a.target].x - a.x, agents[a.target].z - a.z) <= rangeOf(a)) {
        a.vx = 0; a.vz = 0;
        const t = agents[a.target];
        const want = Math.atan2(t.x - a.x, t.z - a.z);
        let delta = want - a.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        a.facing += delta * Math.min(1, SIM.turnRate * SIM.step);
        resetStallBookkeeping(a);
        continue;
      }

      // A melee agent closing on someone steers at the person, not at the
      // waypoint its orders handed it. It has no path of its own to follow
      // while charging, so the no-path guard must not apply to it.
      const chaseTarget = a.chasing && a.target >= 0 ? agents[a.target] : null;
      if (!chaseTarget && (!a.path || a.pathIndex >= a.path.length)) {
        a.vx = 0; a.vz = 0;
        resetStallBookkeeping(a);
        continue;
      }

      const target = chaseTarget ?? a.path[a.pathIndex];
      const dx = target.x - a.x;
      const dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);

      // A chaser has arrived when it is in striking distance; combat.js does
      // the striking, so there is nothing further to do but hold position.
      // Stall bookkeeping is reset here for the same reason the gun-halt
      // branch above resets it: this is a deliberate hold, not a jam, and
      // leaving it un-reset let a melee agent pinned at strike range for a
      // long fight accrue goal-stall strikes it never earned, exactly the
      // asymmetry the gun branch was already immune to.
      if (chaseTarget) {
        if (dist < COMBAT.meleeRange * 0.75) {
          a.vx = 0; a.vz = 0;
          resetStallBookkeeping(a);
          continue;
        }
      } else if (dist < SIM.arriveRadius) {
        a.pathIndex++;
        if (a.pathIndex >= a.path.length) { a.path = null; a.goal = null; a.vx = 0; a.vz = 0; }
        continue;
      }

      // Second stall signal: is this agent actually getting any closer to
      // its ultimate destination (`a.goal`), at all, lately? Tracked
      // independently of the wall-evidence check below, because the
      // failure mode it exists for never trips that one — a goal-pull
      // vector exactly cancelled by a separation-push vector (or a step
      // that lands back on the agent's own already-open cell) reports as
      // "nothing blocked" every tick, so `_stallSawWall` never gets set and
      // `replan()` never runs, and several agents converging on one shared
      // point is exactly the situation that produces it. This deliberately
      // measures distance to the final goal, not to the current waypoint:
      // a waypoint changes every time a path is (re)computed or a step
      // finishes, and resetting on every one of those would let a run of
      // ineffective replans keep re-arming this window forever without
      // ever actually reaching the count it needs to trip.
      if (!chaseTarget) {
        const goalDist = Math.hypot(a.x - a.goal.x, a.z - a.goal.z);
        if (goalDist < a._goalBestDist - GOAL_STALL_EPS) {
          a._goalBestDist = goalDist;
          a._goalCountdown = GOAL_STALL_WINDOW;
          a._goalStrikes = 0;
          a._nudgeBias = 0;
          a._nudgeTicks = 0;
          a._yieldTicks = 0;
        } else {
          a._goalCountdown--;
          if (a._goalCountdown <= 0) {
            replan(a);
            a._goalStrikes++;
            a._goalCountdown = GOAL_STALL_WINDOW;
            // `_goalBestDist` is deliberately NOT touched here. It is a
            // ratchet: the closest this agent has ever come to this goal,
            // lowered only by genuine progress and never raised. Both other
            // ways of re-arming it are broken, and each hid a different live
            // bug:
            //
            //   Infinity — every finite distance then counts as an
            //   improvement next tick, zeroing `_goalStrikes` immediately, so
            //   the counter could never pass one strike however many times
            //   the same deadlock recurred.
            //
            //   the CURRENT distance — this raises the bar back up to
            //   wherever the agent has drifted to, which lets an agent that
            //   is merely oscillating slip the ratchet: drift 10cm away, and
            //   drifting the same 10cm back now reads as fresh progress and
            //   resets the strike count. That is not a deadlock — the agent
            //   is moving the whole time, so no "stuck" signal fires — but it
            //   is a live-lock, and it is why one agent and the hostage could
            //   stand there trading centimetres for 9,000 ticks while the
            //   detector reported them as making progress.
            //
            // Only beating the best distance ever achieved counts, so
            // oscillation accumulates strikes exactly as a full standstill
            // does.
            // A replan alone did not break it last time either — most likely
            // several agents (or an agent and the hostage) are pressed
            // together in a tight space, so a fresh route from here still
            // points the same way. A deterministic-per-agent (never
            // Math.random, so replay stays identical) sideways bias, growing
            // with each repeated failure, is what tips this: a fixed small
            // nudge can itself be overpowered by a strong separation force in
            // a head-on corridor stand-off (up to roughly 0.8 in magnitude
            // here), so a persistent deadlock needs an answer that keeps
            // growing until it wins, not a single fixed-size tie-breaker.
            // Zero until an agent has proven itself stuck more than once.
            //
            // Applied as a bounded impulse (see NUDGE_TICKS), not as a
            // standing bias. Left standing, a bias this large simply replaces
            // the goal direction: the agent slides sideways along whatever
            // wall it is against, forever, at a perfectly healthy speed. That
            // is a live-lock, not a deadlock — every "is it stuck" signal
            // reports a moving agent — and the escalation above then ratchets
            // the bias to its cap and pins it there, so the recovery becomes
            // the thing preventing recovery.
            if (a._goalStrikes > 1) {
              // Is another agent actually in the way? A stand-off over an
              // opening narrower than `SIM.separation` cannot be nudged
              // apart: both sides push each other clear of the gap, and
              // shoving both sideways only decides which of them misses it.
              // Exactly one has to give way, so the two sides must never
              // reach the same answer — lowest id has right of way. The
              // choice of rule is arbitrary; that it is stable, symmetric-
              // breaking, and derived from nothing but agent ids (so a seed
              // replays identically) is not.
              let rival = -1;
              let rivalDist = Infinity;
              for (const other of agents) {
                if (other === a || !other.alive) continue;
                // Only an agent that is ITSELF getting nowhere counts as a
                // stand-off partner. Someone merely walking past happens to
                // be within separation range constantly, and backing off for
                // them costs three quarters of a second and buys nothing —
                // measured as a 2.2x slowdown on the one seed with a long
                // escort down a corridor, where the hostage yielded to every
                // squad member that drifted alongside it.
                if (other._goalStrikes === 0) continue;
                const d = Math.hypot(a.x - other.x, a.z - other.z);
                if (d < SIM.separation && d < rivalDist) { rivalDist = d; rival = other.id; }
              }
              if (rival >= 0 && rival < a.id) {
                a._yieldTo = rival;
                a._yieldTicks = YIELD_TICKS;
                a._nudgeBias = 0;
                a._nudgeTicks = 0;
              } else {
                const sign = a.id % 2 === 0 ? 1 : -1;
                a._nudgeBias = sign * Math.min(1.5, 0.25 * (a._goalStrikes - 1));
                a._nudgeTicks = NUDGE_TICKS;
                a._yieldTicks = 0;
              }
            }
          }
        }
      }

      const baseDirX = dx / dist;
      const baseDirZ = dz / dist;
      let dirX = baseDirX;
      let dirZ = baseDirZ;

      // Separation, capped: it may nudge an agent aside in a doorway but must
      // never be strong enough to shove one through a wall.
      let sepX = 0;
      let sepZ = 0;
      for (const other of agents) {
        if (other === a || !other.alive) continue;
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

      // The tie-breaking nudge from a repeated goal stall, applied
      // perpendicular to the goal direction itself (not the possibly
      // near-zero combined vector above) so it is well-defined exactly
      // when it is needed most: at an exact cancellation.
      // Expires on its own so the agent goes back to steering at its goal
      // between shoves; `_goalStrikes` is deliberately NOT reset with it, so
      // a stand-off that survives one burst gets a harder one next time.
      if (a._nudgeTicks > 0) {
        dirX += -baseDirZ * a._nudgeBias;
        dirZ += baseDirX * a._nudgeBias;
        a._nudgeTicks--;
        if (a._nudgeTicks === 0) a._nudgeBias = 0;
      }

      // Giving way: back straight off the agent with right of way,
      // overriding the goal pull rather than adding to it. Adding to it is
      // what the separation term already does, and it is precisely what is
      // not enough here — the goal keeps pulling this agent back into the
      // opening it is supposed to be clearing. Bounded in time, so a
      // yielding agent always resumes its own route.
      if (a._yieldTicks > 0) {
        const rival = agents[a._yieldTo];
        const ox = a.x - rival.x;
        const oz = a.z - rival.z;
        const d = Math.hypot(ox, oz);
        if (d > 1e-6) { dirX = ox / d; dirZ = oz / d; }
        a._yieldTicks--;
      }

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
      const slideX = primary.blocked ? refusalAt(nx, a.z) : null;
      const slideZ = (slideX && slideX.blocked) ? refusalAt(a.x, nz) : null;

      // A shut door directly ahead starts opening once in reach, regardless
      // of whether this particular step actually moves the agent. Tying
      // this to "did the agent fully stop" instead would deadlock a crowd
      // at a doorway forever: several agents jostling for the same narrow
      // opening can perpetually find SOME sliding movement via separation,
      // never fully stopping, so the door would never be told to open at
      // all and nobody would ever get through.
      //
      // Checked across all three refusals this step considered (the direct
      // step, and both sliding fallbacks), not just the direct one. A step
      // refused head-on by a WALL while a slide axis is refused by a closed
      // door is exactly the shape that used to disarm this trigger: `primary`
      // reported the wall, so its doorId was -1 and the door behind the slide
      // was never told to open, even though the agent was standing right next
      // to it. That left only the slower 90-tick goal-stall path to recover.
      // Using the same three refusals the classification below inspects
      // keeps this consistent with what actually stopped the agent.
      for (const r of [primary, slideX, slideZ]) {
        if (r && r.doorId >= 0) {
          const door = doors[r.doorId];
          if (door.state === 'closed' && Math.hypot(door.x - a.x, door.z - a.z) < SIM.doorReach) {
            door.state = 'opening';
          }
        }
      }

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
          // Deliberately does NOT reset the goal-stall tracker: `replan()`
          // keeps the same `a.goal`, only recomputing the route to it, so a
          // run of wall-triggered replans that each buy a few ticks of
          // progress through fresh nearby waypoints — without the agent
          // ever actually getting closer to where it is ultimately
          // going — is exactly the pattern the goal-stall window has to
          // keep counting through, not lose track of.
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
      parts.push(`${a.id}:${round(a.x)},${round(a.z)},${round(a.facing)},${round(a.speed)},${a.waitingFor},${a.hp},${a.alive ? 1 : 0}`);
    }
    for (const d of Object.values(doors)) parts.push(`d${d.id}:${d.state}:${round(d.timer)}`);
    return parts.join('|');
  };

  return world;
}
