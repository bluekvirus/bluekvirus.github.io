// The fight.
//
// Pure data, like everything else under sim/: no Babylon, no DOM, no clock.
// "Did that bullet pass through a wall" is a Node assertion over hundreds of
// seeds rather than something to catch by eye at 60fps.
//
// This module must never import world.js — world.js imports this, and the
// cycle would fail to resolve under Node.

import { hasLineOfSight } from './path.js';

export const COMBAT = Object.freeze({
  sightRange: 12,
  gunRange: 10,
  meleeRange: 1.2,
  // How close a melee hostile lets its target get before it breaks into a
  // charge, rather than the instant it acquires a target at up to sightRange
  // (12m) in the open. This does NOT buy engagement -- engagement rises
  // monotonically with chargeRange in every sweep that measured it (4->8.1%
  // ever-swung, 10->17.1%), so a lower value only ever costs it. What it
  // buys is less exposure per charge: at identical accuracy, paired,
  // chargeRange 6 vs 10 differ by 2.4-2.6pp of engagement for only
  // 0.06-0.24pp of failure rate -- a bad trade an earlier pass got wrong by
  // reading a single 450-mission family's noise (family spread is +-2pp) as
  // a trend. 10 keeps a sliver of margin under sightRange (12) so a charger
  // still never breaks into a run from the absolute far edge of
  // acquisition, while giving up none of the engagement that a tighter gate
  // (6) cost for essentially no reduction in failure rate. See
  // melee-brief.md and melee-report.md for the full sweep.
  chargeRange: 10,
  gunCooldown: 0.8,
  meleeCooldown: 1.1,
  gunDamage: 25,
  meleeDamage: 35,
  swatHp: 75,
  hostileHp: 80,
  hostageHp: 40,
  swatAccuracy: 0.80,
  // Retuned 0.75 -> 0.70 to bring mission failure back inside the held-out
  // 13.3-19.2% band once chargers became effective, WITHOUT touching
  // meleeAccuracy (measured inert in an earlier task -- see melee-brief.md
  // -- and off-limits regardless) or swatAccuracy (an earlier pass tried
  // raising that instead; reverted here because this lever does strictly
  // better at the same failure rate -- see melee-report.md). accuracyOf()
  // routes a `weapon === 'melee'` agent to meleeAccuracy unconditionally, so
  // this constant governs GUN-armed hostiles only and can never touch a
  // charger's own hit chance; it works purely by hostiles losing more of
  // their own gunfights, which costs the squad less overall than making
  // SWAT's rifles more accurate did for the same failure-rate target. SWAT
  // keeps its accuracy edge (0.80 > 0.70, wider than the original 0.80 vs
  // 0.75 -- see docs/superpowers/specs/2026-08-01-raid-combat-design.md).
  hostileAccuracy: 0.70,
  meleeAccuracy: 0.75,
  // Ticks between target scans for any one agent. Twelve agents each testing
  // line of sight to eleven others every tick is 132 grid traversals per tick
  // against a 2ms budget; staggering by id divides that by six for at most
  // 0.1s of reaction delay. orders.js staggers its setGoal calls for exactly
  // the same reason.
  scanInterval: 6,
});

/** SWAT and the hostage on one side, hostiles on the other. */
export function isEnemy(a, b) {
  if (a === b) return false;
  const friendly = (r) => r === 'swat' || r === 'hostage';
  return friendly(a.role) !== friendly(b.role);
}

const accuracyOf = (a) => {
  if (a.weapon === 'melee') return COMBAT.meleeAccuracy;
  return a.role === 'swat' ? COMBAT.swatAccuracy : COMBAT.hostileAccuracy;
};

/**
 * Odds a single attack lands. A gun falls off linearly to half its accuracy at
 * maximum range, so distance is worth something without a shot ever becoming
 * impossible; melee is flat, because at 1.2m there is no falloff worth
 * modelling.
 *
 * Clamped at 0: past 2*gunRange the linear falloff above goes negative.
 * step() never calls this beyond gunRange itself (the range gate in the loop
 * below precedes every call), so the clamp is unreachable from there — but
 * this is an exported function callable directly with any distance, and a
 * negative "probability" is a defect regardless of whether anything in this
 * module currently triggers it.
 */
export function hitChance(a, distance) {
  const base = accuracyOf(a);
  if (a.weapon === 'melee') return base;
  return Math.max(0, base * (1 - 0.5 * distance / COMBAT.gunRange));
}

export const damageOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeDamage : COMBAT.gunDamage);
export const rangeOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeRange : COMBAT.gunRange);
export const cooldownOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeCooldown : COMBAT.gunCooldown);

// `runSpeed`/`walkSpeed` mirror `SIM.runSpeed`/`SIM.walkSpeed` in world.js.
// combat.js cannot import world.js (that cycle would fail to resolve — see
// the header comment above), so the caller passes the numbers in instead;
// the defaults here exist only so a test harness that omits them still gets
// production-accurate speeds rather than `undefined`.
export function createCombat({ grid, agents, rng, isDoorOpen, step, runSpeed = 3.2, walkSpeed = 1.4 }) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // `a.target` is an agent id, not an index into `agents` — the two only
  // coincide if `agents` happens to be ordered exactly by id. world.js's own
  // array always is (see the invariant comment where it builds `agents`),
  // but this module must not assume its caller does the same: resolve every
  // id through this map instead of indexing `agents` directly.
  const byId = new Map(agents.map((a) => [a.id, a]));

  // Whether `a` may hold `b` as a target right now. Checked on acquisition AND
  // every tick thereafter, so a target that dies or steps behind a wall is
  // dropped immediately rather than lingering until the next scan window.
  const canTarget = (a, b) => {
    if (!b || !b.alive || !isEnemy(a, b)) return false;
    // A prisoner lying on the floor is not shot at; a hostage being walked out
    // with the squad is. Without this the mission could be lost in the first
    // two seconds, before the squad had any chance to intervene — and the
    // "hostage killed" failure condition would be unreachable without it.
    if (b.role === 'hostage' && b.captive) return false;
    if (distance(a, b) > COMBAT.sightRange) return false;
    return hasLineOfSight(grid, a, b, isDoorOpen);
  };

  const acquire = (a) => {
    let best = -1;
    let bestDist = Infinity;
    for (const b of agents) {
      if (!canTarget(a, b)) continue;
      const d = distance(a, b);
      // Ties break explicitly on the lower id (never on iteration order), so
      // a seed replays identically regardless of how the `agents` array
      // happens to be ordered — a splice on death or a re-sort elsewhere
      // must not be able to change which candidate wins a distance tie.
      if (d < bestDist || (d === bestDist && b.id < best)) { bestDist = d; best = b.id; }
    }
    return best;
  };

  // Everything that makes a dead agent inert, in one place. Missing any one of
  // these leaves a corpse that still steers, still shoots, or still soaks
  // fire that should be going somewhere useful.
  const kill = (a, tick) => {
    a.hp = 0;
    a.alive = false;
    a.diedAt = tick;
    a.target = -1;
    a.chasing = false;
    a.path = null;
    a.goal = null;
    a.vx = 0;
    a.vz = 0;
    a.speed = 0;
    a.wants = 0;
  };

  const attack = (a, b, d, tick) => {
    a.cooldown = cooldownOf(a);
    a.firedAt = tick;
    // One roll per attack, drawn in the fixed order `agents` is iterated in
    // step() below (array order, not necessarily agent-id order — this
    // project's own tie-break test in combat.test.js proves the two can
    // differ) — a replay is exact because that order is fixed, not because
    // it happens to match id.
    if (rng.next() >= hitChance(a, d)) return;
    b.hp -= damageOf(a);
    b.hitAt = tick;
    if (b.hp <= 0) kill(b, tick);
  };

  return {
    step(tick) {
      for (const a of agents) {
        // hp is the single source of truth for whether an agent is alive.
        // Ordinarily `kill()` below finalizes a death atomically the instant
        // an attack causes it, but hp can also reach zero by some other means
        // entirely outside this module -- a test sabotaging it directly, or
        // some future system that damages an agent without going through
        // `attack()`. Self-healing that here, in the module that owns the
        // concept, is what keeps such an agent from lingering marked `alive:
        // true` at zero health for even one more tick, and means callers
        // (world.js) need no death-handling code of their own at all.
        if (a.alive && a.hp <= 0) kill(a, tick);
        if (!a.alive || a.weapon === 'none') { a.target = -1; a.chasing = false; continue; }

        if (a.target >= 0 && !canTarget(a, byId.get(a.target))) a.target = -1;
        if (a.target < 0 && tick % COMBAT.scanInterval === a.id % COMBAT.scanInterval) {
          a.target = acquire(a);
        }
        // A melee agent acquires and holds a target exactly like a gunner
        // does, out to sightRange -- so it still reacts the instant an enemy
        // comes into view -- but does not break into a charge from all the
        // way out there. Only once the target has closed to chargeRange does
        // it start running it down; beyond that it behaves as it did before
        // combat existed, following whatever patrol goal orders.js gave it.
        // Checked every tick (not just on acquisition), so a target that
        // walks back out past chargeRange calls off the charge just as
        // promptly as one that walks in starts it.
        a.chasing = a.target >= 0 && a.weapon === 'melee'
          && distance(a, byId.get(a.target)) <= COMBAT.chargeRange;

        // A charging melee agent sprints; it drops back to its patrol speed
        // (walkSpeed — what it spawned with, and what orders.js's patrol
        // wander never changes) the instant it stops chasing. Read every
        // tick, not only on the chasing/not-chasing transition, for the same
        // reason orders.js re-sets `wants` every tick during its own
        // run/walk phases: cheap, and correct even if something else ever
        // touched `wants` in between. Only ever written here for a
        // `weapon === 'melee'` agent, and only SWAT carries a gun (roles.js
        // never gives one melee), so this can never race orders.js's own
        // `wants` writes, which are scoped to `swat`.
        if (a.weapon === 'melee') a.wants = a.chasing ? runSpeed : walkSpeed;

        if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - step);

        if (a.target < 0 || a.cooldown > 0) continue;
        const b = byId.get(a.target);
        const d = distance(a, b);
        if (d > rangeOf(a)) continue;
        attack(a, b, d, tick);
      }
    },
  };
}
