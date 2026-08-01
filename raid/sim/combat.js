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
  sightRange: 14,
  gunRange: 10,
  meleeRange: 1.2,
  gunCooldown: 0.8,
  meleeCooldown: 1.1,
  gunDamage: 25,
  meleeDamage: 45,
  swatHp: 120,
  hostileHp: 80,
  hostageHp: 19,
  swatAccuracy: 0.73,
  hostileAccuracy: 0.93,
  meleeAccuracy: 0.9,
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

export function createCombat({ grid, agents, rng, isDoorOpen, step }) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

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

        if (a.target >= 0 && !canTarget(a, agents[a.target])) a.target = -1;
        if (a.target < 0 && tick % COMBAT.scanInterval === a.id % COMBAT.scanInterval) {
          a.target = acquire(a);
        }
        a.chasing = a.target >= 0 && a.weapon === 'melee';

        if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - step);

        if (a.target < 0 || a.cooldown > 0) continue;
        const b = agents[a.target];
        const d = distance(a, b);
        if (d > rangeOf(a)) continue;
        attack(a, b, d, tick);
      }
    },
  };
}
