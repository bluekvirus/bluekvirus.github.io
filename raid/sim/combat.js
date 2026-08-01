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
  gunCooldown: 0.8,
  meleeCooldown: 1.1,
  gunDamage: 25,
  meleeDamage: 35,
  swatHp: 120,
  hostileHp: 80,
  hostageHp: 60,
  swatAccuracy: 0.8,
  hostileAccuracy: 0.55,
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
      // Ties break on the lower id, so a seed replays identically regardless
      // of how the agents array happens to be ordered.
      if (d < bestDist) { bestDist = d; best = b.id; }
    }
    return best;
  };

  return {
    step(tick) {
      for (const a of agents) {
        if (!a.alive || a.weapon === 'none') { a.target = -1; a.chasing = false; continue; }

        if (a.target >= 0 && !canTarget(a, agents[a.target])) a.target = -1;
        if (a.target < 0 && tick % COMBAT.scanInterval === a.id % COMBAT.scanInterval) {
          a.target = acquire(a);
        }
        a.chasing = a.target >= 0 && a.weapon === 'melee';

        if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - step);
      }
    },
  };
}
