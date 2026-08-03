# Raid Phase D, Plan A: The Autonomous Squad

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the scripted route and give the squad a mind — it searches the building room by room over a known blueprint, clears what it finds, and rescues the hostage on sight.

**Architecture:** Three new pure modules replace `raid/sim/orders.js`. `search.js` answers "which room next" as a pure graph question. `squad.js` turns an objective into per-member movement. `director.js` owns the objective state machine, the outcome, the mission clock, and the hostile patrol relocated out of `orders.js`. The first three tasks build them alongside the existing system so the suite stays green; task 4 is the cutover.

**Tech Stack:** Vanilla ES modules, Babylon.js 9.18.1 from CDN, Node's built-in test runner, no dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-08-01-raid-phase-d-design.md`

**This is Plan A of two.** It covers the spec's build-order items 1–3 plus the cutover. Plan B covers melee survivability, ammo and reload, hard body collision, and final tuning, and is written after this lands so it can be tuned against real measurements.

## Global Constraints

- No build step. Plain ES modules loaded directly by the browser; push is deploy. No dependency, no bundler.
- `raid/sim/search.js`, `raid/sim/squad.js` and `raid/sim/director.js` are PURE. They MUST NOT import Babylon or reference `BABYLON`, `window`, `document`, `performance`, `location`, or `Math.random`. Add all three to `PURE_FILES` in `raid/tests/purity.test.js`.
- `raid/sim/combat.js` MUST NOT import `raid/sim/world.js` (world imports combat; the cycle breaks under Node). The same rule applies to any new module world imports.
- Seeded RNG only. The hostile patrol keeps its own stream, renamed from `${plan.seed}:orders` to `${plan.seed}:mission`.
- Fixed simulation timestep `SIM.step` = 1/60s.
- Determinism: same seed and tick count must produce an identical `world.hash()`.
- Nothing may splice, sort, or filter-in-place `world.agents` — `combat.js` indexes it by stored id. Build new arrays with `.filter()`.
- Run the suite with `node --test raid/tests/*.test.js` from the repository root. It is **121 tests** and all pass at the start of this plan.
- `MISSION_LIMIT` is 10800 ticks (180 simulated seconds).

## Data the plan relies on (verified, not assumed)

- `plan.cells` — array of `{ id, x, z, w, d, kind }`, `kind` is `'room'` or `'corridor'`. `x`/`z` are a MINIMUM corner; `w` spans x and `d` spans z.
- `plan.adjacency` — object keyed by cell id (string keys, numeric values): `{ "0": [1, 9, 10], "1": [0, 9], ... }`.
- `mission` (from `assignRoles`) — `{ entryId, hostageRoomId, depth, roles, spawns }`.
- `world.agents[i].cellId` — the cell an agent spawned in. Not updated as it moves.
- `orders.js`'s public API today: `{ get phase(), get hostageReached(), get outcome(), update(world) }`.
- Consumers of that API: `raid/main.js` (lines ~146, ~165, ~195-197) and `raid/agents.js` (line ~389, reads `orders?.hostageReached`).

---

### Task 1: Room search over the blueprint

A pure graph module. No agents, no world, no Babylon — it answers "which room next" given a graph and a visited set, and nothing else.

**Files:**
- Create: `raid/sim/search.js`
- Create: `raid/tests/search.test.js`
- Modify: `raid/tests/purity.test.js` (add `sim/search.js` to `PURE_FILES`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `roomOrder(plan)` → array of cell ids the squad should sweep, in a fixed order.
  - `nextRoom(plan, visited, fromId)` → the id of the nearest unvisited cell by door-graph distance from `fromId`, ties broken by lower id; `-1` when every cell is visited.
  - `graphDistance(plan, fromId)` → a `Map` of cell id → hop count from `fromId`, for cells reachable through the door graph.

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { roomOrder, nextRoom, graphDistance } from '../sim/search.js';

// A hand-made four-cell chain: 0 - 1 - 2 - 3. Hand-made rather than generated
// because "which room is two hops away" must be obvious by inspection for the
// test to prove anything.
const chain = {
  seed: 'chain',
  cells: [
    { id: 0, x: 0, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 1, x: 4, z: 0, w: 4, d: 4, kind: 'corridor' },
    { id: 2, x: 8, z: 0, w: 4, d: 4, kind: 'room' },
    { id: 3, x: 12, z: 0, w: 4, d: 4, kind: 'room' },
  ],
  adjacency: { 0: [1], 1: [0, 2], 2: [1, 3], 3: [2] },
};

test('graphDistance counts hops through the door graph', () => {
  const d = graphDistance(chain, 0);
  assert.equal(d.get(0), 0);
  assert.equal(d.get(1), 1);
  assert.equal(d.get(2), 2);
  assert.equal(d.get(3), 3);
});

test('nextRoom picks the nearest unvisited cell, not merely the lowest id', () => {
  // Standing at 3, cell 2 is one hop and cell 0 is three. Lowest-id-wins would
  // wrongly answer 0, so this distinguishes distance from id ordering.
  assert.equal(nextRoom(chain, new Set(), 3), 2);
});

test('nextRoom breaks distance ties on the lower id', () => {
  // 1 and 3 are both one hop from 2.
  assert.equal(nextRoom(chain, new Set([2]), 2), 1);
});

test('nextRoom returns -1 once everything is visited', () => {
  assert.equal(nextRoom(chain, new Set([0, 1, 2, 3]), 0), -1);
});

test('nextRoom skips visited cells', () => {
  assert.equal(nextRoom(chain, new Set([2]), 3), 1);
});

test('roomOrder covers every cell exactly once', () => {
  for (const seed of ['cover-a', 'cover-b', 'cover-c']) {
    const plan = generateFloorplan(seed, { targetRooms: 10 });
    const order = roomOrder(plan);
    assert.equal(new Set(order).size, order.length, `${seed}: a cell repeats`);
    assert.equal(order.length, plan.cells.length,
      `${seed}: swept ${order.length} of ${plan.cells.length} cells`);
  }
});

test('roomOrder is deterministic', () => {
  const plan = generateFloorplan('determinism', { targetRooms: 11 });
  assert.deepEqual(roomOrder(plan), roomOrder(plan));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/search.test.js`
Expected: FAIL — cannot resolve `../sim/search.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/search.js`:

```js
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
 */
export function nextRoom(plan, visited, fromId) {
  const dist = graphDistance(plan, fromId);
  let best = -1;
  let bestDist = Infinity;
  for (const cell of plan.cells) {
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test raid/tests/search.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add to the purity guard**

In `raid/tests/purity.test.js`, add `'sim/search.js'` to the `PURE_FILES` array.

Run: `node --test raid/tests/purity.test.js`
Expected: PASS.

- [ ] **Step 6: Sabotage-verify the coverage test**

This project has had **nine** tests found asserting nothing. Before committing, break the thing each test covers and watch it fail.

Change `nextRoom`'s `if (visited.has(cell.id)) continue;` to `if (false) continue;` and run `node --test raid/tests/search.test.js`. Expected: the `-1` test and the coverage test fail. Restore, confirm green. Record what you saw in the report.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/search.js raid/tests/search.test.js raid/tests/purity.test.js
git commit -m "feat(raid): room search over the known blueprint"
```

---

### Task 2: The director — objective, outcome, clock, patrol

The mission state machine that replaces `orders.js`'s phase handling, plus the termination guarantee that replaces its watchdogs. Built alongside `orders.js`; nothing switches over yet.

**Files:**
- Create: `raid/sim/director.js`
- Create: `raid/tests/director.test.js`
- Modify: `raid/tests/purity.test.js`

**Interfaces:**
- Consumes: `nextRoom(plan, visited, fromId)` from Task 1.
- Produces: `createDirector(plan, mission)` → an object with
  - `get phase()` — `'search' | 'rescue' | 'extract' | 'done'`
  - `get result()` — `null | 'success' | 'failed'`
  - `get reason()` — `null | 'extracted' | 'squad-lost' | 'hostage-killed' | 'timeout'`
  - `get hostageReached()` — boolean, kept from `orders.js` because `raid/agents.js` reads it
  - `get visited()` — `Set` of visited cell ids, for measurement
  - `get objective()` — `{ kind: 'clear'|'rescue'|'extract', cellId, point }`, what Task 3's squad executes
  - `update(world)` — advance one tick
- Also produces `MISSION_LIMIT` (10800) as a named export.

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/director.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createDirector, MISSION_LIMIT } from '../sim/director.js';

const build = (seed, rooms = 10) => {
  const plan = generateFloorplan(seed, { targetRooms: rooms });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, director: createDirector(plan, mission) };
};

test('a fresh director is searching with no result', () => {
  const { director } = build('fresh');
  assert.equal(director.phase, 'search');
  assert.equal(director.result, null);
  assert.equal(director.reason, null);
  assert.equal(director.hostageReached, false);
});

test('the objective names a real cell to clear', () => {
  const { plan, world, director } = build('objective');
  director.update(world);
  const o = director.objective;
  assert.equal(o.kind, 'clear');
  assert.ok(plan.cells.some((c) => c.id === o.cellId), 'objective cell is not in the plan');
  assert.ok(Number.isFinite(o.point.x) && Number.isFinite(o.point.z));
});

test('a wiped squad fails as squad-lost, not as a timeout', () => {
  const { world, director } = build('wipe');
  for (let i = 0; i < 60; i++) director.update(world);
  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.hp = 0; a.alive = false; }
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'squad-lost');
});

test('a dead hostage fails as hostage-killed', () => {
  const { world, director } = build('hostage-dead');
  for (let i = 0; i < 60; i++) director.update(world);
  const hostage = world.agents.find((a) => a.role === 'hostage');
  hostage.hp = 0; hostage.alive = false;
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'hostage-killed');
});

test('the mission clock fails as timeout and cannot be outrun', () => {
  // Freeze every agent so nothing can ever progress. Without a clock this
  // would run forever -- which is exactly the guarantee orders.js's leg
  // watchdogs used to provide and which this replaces.
  const { world, director } = build('timeout');
  const frozen = world.agents.map((a) => ({ x: a.x, z: a.z }));
  let ticks = 0;
  while (director.result === null && ticks < MISSION_LIMIT + 600) {
    world.tick();
    world.agents.forEach((a, i) => { a.x = frozen[i].x; a.z = frozen[i].z; });
    director.update(world);
    ticks++;
  }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'timeout');
  assert.ok(ticks <= MISSION_LIMIT + 1,
    `the clock let the mission run ${ticks} ticks past its ${MISSION_LIMIT} limit`);
});

test('visited grows as the squad enters cells and never shrinks', () => {
  const { world, director } = build('visited');
  let previous = 0;
  for (let i = 0; i < 1200; i++) {
    world.tick(); director.update(world);
    assert.ok(director.visited.size >= previous, 'visited shrank');
    previous = director.visited.size;
  }
  assert.ok(director.visited.size >= 1, 'the squad never registered entering any cell');
});

test('hostiles still patrol', () => {
  const { world, director } = build('patrol');
  const start = world.agents.filter((a) => a.role === 'hostile').map((a) => ({ id: a.id, x: a.x, z: a.z }));
  for (let i = 0; i < 900; i++) { world.tick(); director.update(world); }
  const moved = world.agents
    .filter((a) => a.role === 'hostile' && a.alive)
    .filter((a) => {
      const s = start.find((p) => p.id === a.id);
      return Math.hypot(a.x - s.x, a.z - s.z) > 0.5;
    });
  assert.ok(moved.length >= 2, `only ${moved.length} hostiles moved — patrol did not survive the move out of orders.js`);
});

test('the director is deterministic', () => {
  const a = build('determinism');
  const b = build('determinism');
  for (let i = 0; i < 900; i++) {
    a.world.tick(); a.director.update(a.world);
    b.world.tick(); b.director.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.director.phase, b.director.phase);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/director.test.js`
Expected: FAIL — cannot resolve `../sim/director.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/director.js`:

```js
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

// 180 simulated seconds. Phase C measured a 41s median and a ~67s worst case;
// this phase adds a building sweep, so the ceiling has to clear a healthy
// swept run with real margin while staying far enough under the harness's own
// limit that a genuine hang is still caught rather than masked.
export const MISSION_LIMIT = 10800;

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

  // A cell is visited the moment a living member is inside it, and never
  // reverts. That monotonicity IS the termination argument for the sweep: key
  // this on "cleared of hostiles" instead and a hostile the squad cannot kill,
  // or one that wanders in behind them, leaves a cell permanently unvisited
  // and the search goes round forever.
  const markVisited = (swat) => {
    for (const a of swat) {
      for (const c of plan.cells) {
        if (inCell(a, c)) { state.visited.add(c.id); break; }
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test raid/tests/director.test.js`
Expected: PASS, 8 tests.

If the `visited` test fails because no squad member ever moves, that is expected at this stage — nothing is giving them goals yet. Set a goal manually inside that test to make members move, and say so in your report.

- [ ] **Step 5: Add to the purity guard**

Add `'sim/director.js'` to `PURE_FILES` in `raid/tests/purity.test.js`.

Run: `node --test raid/tests/*.test.js`
Expected: all pass. `orders.js` is untouched, so the existing suite is unaffected.

- [ ] **Step 6: Sabotage-verify the clock**

Comment out the `state.ticks >= MISSION_LIMIT` branch and run `node --test raid/tests/director.test.js`. Expected: the timeout test fails (or hangs — if it hangs, that itself proves the point; kill it and record that). Restore, confirm green.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/director.js raid/tests/director.test.js raid/tests/purity.test.js
git commit -m "feat(raid): mission director with a real termination guarantee"
```

---

### Task 3: The squad — tactical execution

Turns the director's objective into per-member movement: stack at the door, one member breaches, the rest cover, the hurt fall back.

**Files:**
- Create: `raid/sim/squad.js`
- Create: `raid/tests/squad.test.js`
- Modify: `raid/tests/purity.test.js`

**Interfaces:**
- Consumes: the objective shape from Task 2 — `{ kind: 'clear'|'rescue'|'extract', cellId, point }`.
- Produces: `createSquad(plan)` → `{ update(world, objective) }`, plus `SQUAD`, a frozen constants object. Nothing else is exported — the tactical assignment is an internal detail exercised through `update`, and the tests below drive it that way.

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/squad.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createSquad, SQUAD } from '../sim/squad.js';

const build = (seed, rooms = 10) => {
  const plan = generateFloorplan(seed, { targetRooms: rooms });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, squad: createSquad(plan) };
};

const objectiveFor = (plan, cellId) => {
  const c = plan.cells.find((x) => x.id === cellId);
  return { kind: 'clear', cellId, point: { x: c.x + c.w / 2, z: c.z + c.d / 2 } };
};

test('every living member is given a goal', () => {
  const { plan, mission, world, squad } = build('goals');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  for (let i = 0; i < 30; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const swat = world.agents.filter((a) => a.role === 'swat' && a.alive);
  assert.ok(swat.every((a) => a.goal !== null || a.path !== null),
    'a living squad member has no goal at all');
});

test('a dead member is never given a goal', () => {
  const { plan, mission, world, squad } = build('dead-goal');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const victim = world.agents.find((a) => a.role === 'swat');
  victim.hp = 0; victim.alive = false;
  for (let i = 0; i < 60; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  assert.equal(victim.path, null, 'a corpse was issued a path');
  assert.equal(victim.goal, null);
});

test('members converge on the objective cell', () => {
  const { plan, mission, world, squad } = build('converge');
  const target = plan.cells.find((c) => c.id !== mission.entryId && c.kind === 'room').id;
  const cell = plan.cells.find((c) => c.id === target);
  const centre = { x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 };
  const before = Math.min(...world.agents.filter((a) => a.role === 'swat')
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  for (let i = 0; i < 2400; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const after = Math.min(...world.agents.filter((a) => a.role === 'swat' && a.alive)
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  assert.ok(after < before - 1,
    `nearest member went from ${before.toFixed(1)}m to ${after.toFixed(1)}m — the squad did not advance`);
});

test('a badly hurt member falls back instead of advancing', () => {
  const { plan, mission, world, squad } = build('fallback');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const cell = plan.cells.find((c) => c.id === target);
  const centre = { x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 };
  const hurt = world.agents.find((a) => a.role === 'swat');
  const healthy = world.agents.filter((a) => a.role === 'swat' && a.id !== hurt.id);
  hurt.hp = 1;
  for (let i = 0; i < 1800; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const hurtDist = Math.hypot(hurt.x - centre.x, hurt.z - centre.z);
  const bestHealthy = Math.min(...healthy.filter((a) => a.alive)
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  assert.ok(hurtDist > bestHealthy,
    `the wounded member (${hurtDist.toFixed(1)}m) is no further from the objective than the healthiest (${bestHealthy.toFixed(1)}m)`);
});

test('SQUAD constants are frozen', () => {
  assert.throws(() => { SQUAD.fallbackHealth = 1; });
});

test('the squad is deterministic', () => {
  const a = build('determinism');
  const b = build('determinism');
  const t = a.plan.cells.find((c) => c.id !== a.mission.entryId).id;
  for (let i = 0; i < 900; i++) {
    a.world.tick(); a.squad.update(a.world, objectiveFor(a.plan, t));
    b.world.tick(); b.squad.update(b.world, objectiveFor(b.plan, t));
  }
  assert.equal(a.world.hash(), b.world.hash());
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/squad.test.js`
Expected: FAIL — cannot resolve `../sim/squad.js`.

- [ ] **Step 3: Implement**

Create `raid/sim/squad.js`:

```js
// Tactical execution.
//
// The director says WHERE the squad is going; this module decides how the
// four of them get there — who leads, who holds, who pulls back. It issues
// goals through world.setGoal and nothing else, so it needs no knowledge of
// paths, steering, or combat resolution.
//
// Goals are re-issued only when they change. setGoal runs a full A* query and
// resets an agent's stall bookkeeping, so calling it every tick would both
// blow the per-tick budget and permanently suppress the stall detector — the
// same reason orders.js staggered its issuing.

export const SQUAD = Object.freeze({
  // Below this fraction of starting health a member stops advancing and pulls
  // back toward the rear. Not a retreat from the mission — the others keep
  // going, and it rejoins once it is no longer the most exposed.
  fallbackHealth: 0.35,
  // Metres each member's destination sits off the shared objective point, so
  // four agents never share one coordinate. Sharing a coordinate is what let
  // goal-pull and separation-push cancel exactly in phase B, freezing an agent
  // that could not tell it was making no progress.
  spread: 1.1,
  // Metres behind the objective direction that a falling-back member holds.
  fallbackDistance: 4.0,
  // Re-issue a member's goal when its intended destination has moved at least
  // this far. Small enough to track a changing objective, large enough that
  // ordinary jitter does not trigger an A* query every tick.
  reissueDistance: 1.5,
});

/** Even spread around a shared point, by fixed slot — never random. */
const slotPoint = (point, slot, total) => {
  const angle = (slot / Math.max(1, total)) * Math.PI * 2;
  return {
    x: point.x + Math.cos(angle) * SQUAD.spread,
    z: point.z + Math.sin(angle) * SQUAD.spread,
  };
};

export function createSquad(plan) {
  // Last destination actually issued per agent, so a goal is only recomputed
  // when it has meaningfully moved.
  const issued = new Map();

  return {
    update(world, objective) {
      if (!objective || !objective.point) return;

      const members = world.agents.filter((a) => a.role === 'swat' && a.alive);
      if (members.length === 0) return;

      // Centre of mass, used to place a falling-back member behind the group
      // rather than at some absolute point that might be inside a wall.
      let cx = 0;
      let cz = 0;
      for (const a of members) { cx += a.x; cz += a.z; }
      cx /= members.length;
      cz /= members.length;

      members.forEach((a, slot) => {
        const hurt = a.hp <= a.hpMax * SQUAD.fallbackHealth;

        let want;
        if (hurt) {
          // Directly away from the objective, from the squad's centre.
          const dx = cx - objective.point.x;
          const dz = cz - objective.point.z;
          const len = Math.hypot(dx, dz) || 1;
          want = {
            x: cx + (dx / len) * SQUAD.fallbackDistance,
            z: cz + (dz / len) * SQUAD.fallbackDistance,
          };
        } else {
          want = slotPoint(objective.point, slot, members.length);
        }

        const last = issued.get(a.id);
        const moved = !last || Math.hypot(last.x - want.x, last.z - want.z) > SQUAD.reissueDistance;
        // Also re-issue when an agent has no path at all: it either arrived,
        // or its last setGoal failed, and either way it will stand still
        // forever otherwise.
        if (moved || !a.path) {
          if (world.setGoal(a.id, want)) issued.set(a.id, want);
        }
      });

      // A member that died still holds a stale entry; drop it so a respawn or
      // an id reuse cannot inherit someone else's destination.
      for (const id of [...issued.keys()]) {
        const agent = world.agentById(id);
        if (!agent || !agent.alive) issued.delete(id);
      }
    },
  };
}
```

- [ ] **Step 4: Add `hpMax` to the agent record**

`SQUAD.fallbackHealth` is a fraction of starting health, and nothing records starting health today. In `raid/sim/world.js`, in the `add` closure where `hp` is set, add alongside it:

```js
      hpMax: role === 'swat' ? COMBAT.swatHp : role === 'hostage' ? COMBAT.hostageHp : COMBAT.hostileHp,
```

Keep it identical in shape to the existing `hp` line so the two cannot drift.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test raid/tests/squad.test.js`
Expected: PASS, 6 tests.

Run: `node --test raid/tests/*.test.js`
Expected: all pass — `orders.js` is still the live system and is untouched.

- [ ] **Step 6: Sabotage-verify the fallback**

Change `const hurt = a.hp <= a.hpMax * SQUAD.fallbackHealth;` to `const hurt = false;` and run `node --test raid/tests/squad.test.js`. Expected: the fallback test fails. Restore, confirm green. Record it.

- [ ] **Step 7: Add to the purity guard and commit**

Add `'sim/squad.js'` to `PURE_FILES`.

```bash
git add raid/sim/squad.js raid/tests/squad.test.js raid/tests/purity.test.js raid/sim/world.js
git commit -m "feat(raid): squad tactical execution with fallback"
```

---

### Task 4: Cutover — delete `orders.js`

Switch the live system to director + squad, delete `orders.js`, and migrate its tests rather than losing them.

**Files:**
- Modify: `raid/main.js`
- Modify: `raid/agents.js` (parameter rename only)
- Delete: `raid/sim/orders.js`
- Delete: `raid/tests/orders.test.js` (after migrating its assertions)
- Modify: `raid/tests/dryrun.test.js`
- Modify: `raid/tests/simbudget.test.js` (imports `createOrders`)
- Modify: `raid/tests/purity.test.js` (remove `sim/orders.js`)

**Interfaces:**
- Consumes: `createDirector` (Task 2), `createSquad` (Task 3).
- Produces: nothing new. `raid/main.js` holds `director` and `squad` where it held `orders`.

- [ ] **Step 1: Inventory what `orders.test.js` guarantees**

Before deleting anything, list every test in `raid/tests/orders.test.js` and decide its fate. Write the list into your report. Each is one of:

- **Migrate** — the guarantee still applies; it moves to `director.test.js`, `squad.test.js` or `dryrun.test.js` against the new modules.
- **Retire** — it asserts a mechanism that no longer exists (leg watchdogs, reissue exhaustion, the scripted leg sequence). State which mechanism, so the retirement is a recorded decision rather than a silent deletion.

Do not skip this step. Several of those tests were written to catch defects that took multiple fix rounds to find, and the anti-hang guarantees among them are the reason this phase is risky.

- [ ] **Step 2: Rewire `raid/main.js`**

Replace the `createOrders` import:

```js
import { createDirector } from './sim/director.js';
import { createSquad } from './sim/squad.js';
```

Replace the `orders` module-level binding with `director` and `squad`, and in `regenerate()` where `orders = createOrders(plan, mission)` was:

```js
  director = createDirector(plan, mission);
  squad = createSquad(plan);
```

Wherever `orders.update(world)` was called (the catch-up loop in `advance()` and the `stepOnce` handler), call both, director first:

```js
  director.update(world);
  squad.update(world, director.objective);
```

Director first is deliberate: the squad executes the objective the director has just chosen, so a one-tick-stale objective would be issued on every leg change.

Update the HUD block to read the new shape:

```js
  if (director.result) {
    outcomeEl.textContent = director.result === 'success'
      ? 'HOSTAGE EXTRACTED'
      : `MISSION FAILED — ${director.reason.replace('-', ' ').toUpperCase()}`;
    outcomeEl.dataset.state = director.result;
  } else {
    const alive = (role) => world.agents.filter((a) => a.role === role && a.alive).length;
    outcomeEl.textContent = `SWAT ${alive('swat')}/${CAST.swat} · HOSTILES ${alive('hostile')}/${CAST.hostiles} · ${director.visited.size}/${plan.cells.length} CLEARED`;
    outcomeEl.dataset.state = 'live';
  }
```

Pass the director where `orders` went in the `bindAgents` call, and add both to the debug surface (`window.__raid`).

- [ ] **Step 3: Rename the parameter in `raid/agents.js`**

`bindAgents(scene, world, cast, orders, agentDiscs)` reads `orders?.hostageReached`. The director exposes the same property, so this is a rename for honesty, not a behaviour change: rename the parameter `orders` to `director` and update the two references and the comment that says "ground truth from orders.js".

- [ ] **Step 4: Migrate `dryrun.test.js`**

Replace its `createOrders` import with `createDirector` and `createSquad`, drive both in the loop, and change the loop condition and assertions to the new shape:

```js
      while (director.result === null && ticks < MAX_TICKS) {
        world.tick();
        director.update(world);
        squad.update(world, director.objective);
        ticks++;
        // ... existing per-tick geometry and door assertions, unchanged ...
      }

      assert.ok(director.result === 'success' || director.result === 'failed',
        `${seed}: mission never resolved within ${MAX_TICKS / 60} simulated seconds`);
      assert.ok(['extracted', 'squad-lost', 'hostage-killed', 'timeout'].includes(director.reason),
        `${seed}: resolved with an unrecognised reason ${director.reason}`);

      if (director.result === 'success') {
        assert.ok(director.hostageReached,
          `${seed}: reported success without the squad ever reaching the hostage`);
        assert.ok(world.agents.find((a) => a.role === 'hostage').alive,
          `${seed}: reported success with a dead hostage`);
      }
```

Add a coverage assertion — this is the win condition of the whole plan and must be a test, not a note:

```js
      // The scripted route entered 55% of cells and met 50% of hostiles.
      // A searching squad must do materially better or this phase achieved
      // nothing. Deliberately a floor well under what is expected, so it
      // catches "search broke" rather than tracking every tuning change.
      assert.ok(director.visited.size / plan.cells.length > 0.7,
        `${seed}: swept only ${director.visited.size} of ${plan.cells.length} cells`);
```

- [ ] **Step 5: Fix `simbudget.test.js`**

It imports `createOrders` and drives it in the throughput and per-tick budget tests. Swap in director + squad, driving both exactly as `main.js` does, so the budget measures what actually runs.

- [ ] **Step 6: Delete `orders.js` and its test**

```bash
git rm raid/sim/orders.js raid/tests/orders.test.js
```

Remove `'sim/orders.js'` from `PURE_FILES` in `raid/tests/purity.test.js`.

- [ ] **Step 7: Run everything**

Run: `node --test raid/tests/*.test.js`
Expected: all pass. Report the new total and account for the change against 121 — tests removed with `orders.test.js`, tests added in Tasks 1–3.

Run five concurrent copies to confirm no wall-clock flakiness:

```bash
for i in 1 2 3 4 5; do (node --test raid/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)") & done; wait
```

Expected: `fail 0` five times.

- [ ] **Step 8: Verify in the browser**

There is no Node harness for the renderer. Serve with `python3 -m http.server 8080` and open `http://localhost:8080/raid/?debug` with the Playwright MCP tools. **The browser profile caches `raid/*.js` aggressively — disable and clear the cache via CDP (`Network.setCacheDisabled`, `Network.clearBrowserCache`) and hard-reload before trusting anything.** A `favicon.ico` 404 is pre-existing; any other console error is yours.

Confirm: the squad moves room to room rather than beelining, the HUD's cleared counter climbs, a mission reaches a verdict, and regenerating resets it. Screenshot a sweep in progress.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(raid): autonomous squad replaces the scripted route"
```

---

### Task 5: Measure the win, and tune

**Files:**
- Modify: `raid/sim/director.js`, `raid/sim/squad.js` (constants only, if measurement says so)
- Modify: `docs/superpowers/specs/2026-08-01-raid-phase-d-design.md` (architecture table: `mission.js` → `director.js`)

- [ ] **Step 1: Write the sweep**

In the scratchpad, NOT the repository. Over at least 150 missions across room counts 8–12, report: map coverage, hostile encounter rate (fraction of hostiles in cells the squad entered), the outcome split by **reason**, hangs, worst and median completion, and mean SWAT lost.

- [ ] **Step 2: Compare against the pre-phase-D baseline**

The numbers to beat, measured on the merged phase C code: **55.0% cell coverage** and **50.1% of hostiles in rooms the squad entered**. Measure the same quantities the same way. Use a git worktree at the merge commit so the comparison is on identical seeds rather than against remembered figures.

- [ ] **Step 3: Confirm the budget still holds**

Run: `node --test raid/tests/simbudget.test.js`
Expected: PASS. Searching re-issues goals more often than the scripted route did, and `setGoal` is a full A* query — if the per-tick budget fails, raise `SQUAD.reissueDistance` before touching the budget. The budget is the requirement.

- [ ] **Step 4: Tune only if measurement demands it**

Adjust only `SQUAD` and the director's constants. Never a test. If coverage does not clear the 70% floor the dryrun test asserts, that is a defect to fix, not a threshold to lower.

- [ ] **Step 5: Fix the spec's stale module name**

The spec's architecture table names `raid/sim/mission.js`. It shipped as `director.js`, because `mission` is already the name of `assignRoles()`'s output and a factory taking a differently-meaning `mission` would mislead. Update the table and note the reason.

- [ ] **Step 6: Report and commit**

```bash
git add -A
git commit -m "fix(raid): tune the sweep, and record what it bought"
```

---

## Self-Review Notes

**Spec coverage for Plan A's scope.** Search over a known blueprint → Task 1. Objective machine, outcome with reason, mission clock, hostile patrol relocation → Task 2. Stack/cover/fallback → Task 3. `orders.js` deletion and test migration → Task 4. Coverage as a measurable win condition → Task 4 Step 4 and Task 5.

**Deferred to Plan B, per the spec's build order:** melee survivability (evasion, health, charge speed), ammo and reload with the `Rifle_Reload` clip from `archive/rifle-wip`, hard body collision, and the final tuning pass across all four subsystems.

**Two deliberate deviations from the spec, both recorded in-plan:** the module is `director.js`, not `mission.js` (Task 5 Step 5 updates the spec). And `hpMax` is added to the agent record in Task 3 Step 4 — the spec's fallback rule is a fraction of starting health, and nothing recorded starting health.

**Known thin spot.** Task 3's "stack at the door, one breaches, the rest cover" is implemented as slot-spread convergence plus a fallback rule, not as an explicit door-stacking state machine. That delivers the measurable objective — the squad sweeps the building and covers more of it — but it is less than the spec's prose describes. A richer breach sequence is worth its own task once coverage is proven; do not let it expand Task 3.
