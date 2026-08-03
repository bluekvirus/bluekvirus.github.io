// Which room to clear next.
//
// Pure graph work: this module knows about cells and doors and nothing else —
// no agents, no world, no Babylon. That is deliberate. "Which room next" is a
// question about the blueprint, and keeping it separable means it can be
// tested against a hand-drawn four-cell chain where the right answer is
// obvious, rather than only against generated maps where it is not.
//
// The squad is given the blueprint at the start (see the phase D spec), so
// there is no exploration or fog of war here: every cell is known from tick
// zero and the only unknown is who is standing in it.

/** Hop counts from `fromId` through the door graph. Unreachable cells are absent. */
export function graphDistance(plan, fromId) {
  const dist = new Map([[fromId, 0]]);
  const queue = [fromId];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    const d = dist.get(at);
    for (const n of plan.adjacency[at] ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return dist;
}

/**
 * The nearest unvisited cell to `fromId`, or -1 if none remain.
 *
 * Nearest by DOOR-GRAPH hops rather than straight-line metres: two rooms can
 * be a metre apart through a wall and a long way apart through the building,
 * and it is the walk that costs the squad time. Ties break on the lower id so
 * a seed replays identically — the iteration order of `plan.cells` must never
 * be able to change the answer.
 *
 * `fromId` itself is never a valid answer, whether or not the caller has
 * added it to `visited`: it is where the squad already is, not a room to
 * move to next.
 */
export function nextRoom(plan, visited, fromId) {
  const dist = graphDistance(plan, fromId);
  let best = -1;
  let bestDist = Infinity;
  for (const cell of plan.cells) {
    if (cell.id === fromId) continue;
    if (visited.has(cell.id)) continue;
    const d = dist.get(cell.id);
    if (d === undefined) continue; // unreachable through the door graph
    if (d < bestDist || (d === bestDist && cell.id < best)) {
      bestDist = d;
      best = cell.id;
    }
  }
  return best;
}

/**
 * The full sweep order from the entry, as a flat list.
 *
 * Exists so a test can assert coverage over the whole building in one call,
 * and so the sweep can be inspected without stepping a simulation. The squad
 * itself re-asks `nextRoom` as it goes rather than following this list, since
 * where it actually ends up depends on the fight.
 */
export function roomOrder(plan) {
  const visited = new Set();
  const out = [];
  let at = plan.cells[0]?.id ?? -1;
  for (;;) {
    const next = nextRoom(plan, visited, at);
    if (next === -1) break;
    visited.add(next);
    out.push(next);
    at = next;
  }
  return out;
}
