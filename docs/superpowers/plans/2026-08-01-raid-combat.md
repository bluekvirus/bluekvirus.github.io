# Raid Combat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hostiles engage the SWAT squad with guns and melee weapons; both sides take damage and die; the mission can be won or lost.

**Architecture:** A new pure module `raid/sim/combat.js` runs each tick before movement, acquiring targets over exact line of sight and resolving attacks against a seeded roll. `world.js` owns the health fields and suspends movement for engaged agents. `orders.js` gains casualty bookkeeping and a real outcome. On the render side, `cast.js` is rewritten to give every figure its own skeleton — without that, one hostile dying collapses all seven.

**Tech Stack:** Vanilla ES modules, Babylon.js 9.18.1 from CDN, Node's built-in test runner, no dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-08-01-raid-combat-design.md`

## Global Constraints

- No build step. Plain ES modules loaded directly by the browser; push is deploy. No dependency, no bundler.
- `raid/sim/combat.js` joins the pure set. It MUST NOT import Babylon or reference `BABYLON`, `window`, `document`, `performance`, `location`, or `Math.random`. Add it to `PURE_FILES` in `raid/tests/purity.test.js`.
- `raid/sim/combat.js` MUST NOT import `raid/sim/world.js` — `world.js` imports it, and the cycle would break under Node.
- Seeded RNG only. Combat draws from the existing `${plan.seed}:sim` stream, which `world.js` already creates and currently never uses.
- Fixed simulation timestep of `1/60` second. Combat cooldowns are in seconds and decremented by `SIM.step`.
- Determinism: same seed and tick count must produce an identical `world.hash()`, which now includes `hp` and `alive`.
- Coordinates: world `x`/`z` in metres, ground `y = 0`. Agent positions are points.
- Every existing test must keep passing. The suite is 87 tests before this plan starts.
- Run the suite with `node --test raid/tests/*.test.js` from the repository root.

---

### Task 1: Per-figure skeletons

The prerequisite. `TransformNode.clone()` does not clone the `Skeleton` of a skinned child mesh, so today all four SWAT share one skeleton and all seven hostiles share another. Every later task in this plan assumes each figure can be posed independently.

**Files:**
- Modify: `raid/cast.js` (rewrite `loadTemplate`/`place`/`populate`)
- Modify: `raid/agents.js:83-100` (one rig per figure, not per skeleton)
- Modify: `raid/agents.js:241-254` (drop the "fastest agent on this rig" logic)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `populate(scene, mission, shadows)` returns `{ figures, dispose }` unchanged in shape, but every entry of `figures` now has a **distinct** `skeleton`, and a new `groups` array holding that figure's own `AnimationGroup`s. `figures[i]` still corresponds to `world.agents[i]`.

- [ ] **Step 1: Write the failing test**

This one cannot be asserted under Node — it is a Babylon behaviour. Add a browser check to `raid/main.js`'s debug surface instead, and verify it manually in Step 6. Write this assertion helper into `raid/cast.js` as an exported function so it is real code, not a console snippet:

```js
/**
 * Every figure must own its own skeleton. Four SWAT sharing one skeleton is
 * the pack's default (TransformNode.clone() does not clone a skinned mesh's
 * Skeleton) and it makes per-figure animation impossible: one hostile dying
 * would put all seven into the Death pose. Exported so the browser can assert
 * it rather than leaving it to be noticed on screen.
 */
export function skeletonsAreDistinct(figures) {
  const seen = new Set();
  for (const f of figures) {
    if (!f.skeleton || seen.has(f.skeleton)) return false;
    seen.add(f.skeleton);
  }
  return true;
}
```

- [ ] **Step 2: Rewrite the loader to use an AssetContainer**

Replace `loadTemplate` and `place` in `raid/cast.js`:

Use the `SceneLoader` form, matching the `SceneLoader.ImportMeshAsync` call this replaces. Babylon 8+ also exposes a bare `LoadAssetContainerAsync` with a different signature; this codebase is pinned to 9.18.1 where both exist, and mixing the two styles is how the argument order gets silently wrong. Confirm before writing more against it:

```js
console.log(typeof BABYLON.SceneLoader.LoadAssetContainerAsync); // expect "function"
```

```js
/** Load one model into a container we can instantiate from repeatedly. */
async function loadContainer(scene, file) {
  const container = await BABYLON.SceneLoader.LoadAssetContainerAsync(ASSET_DIR, file, scene);
  // The loader auto-starts clips on the container's own groups; those groups
  // are templates and must never play.
  for (const g of container.animationGroups) g.stop();
  return container;
}

/**
 * One independent copy: its own meshes, its own Skeleton, and its own
 * AnimationGroups retargeted onto that skeleton. This is the whole point of
 * instantiateModelsToScene over clone() — `cloneMaterials: false` keeps the
 * materials shared (there is no reason for twelve copies of the same
 * material), while skeletons and animation groups are genuinely per-instance.
 */
function instantiate(container, spawn, name) {
  const entries = container.instantiateModelsToScene((n) => `${name}_${n}`, false);
  const root = entries.rootNodes[0];
  root.setEnabled(true);
  root.position.set(spawn.x, 0, spawn.z);
  // Plain Euler assignment, not a rotationQuaternion — seated.js reads this
  // node's `.rotation.y` back out to derive the hostage's facing for its pose.
  root.rotation = new BABYLON.Vector3(0, facingToRotationY(spawn.facing ?? 0), 0);

  const skinned = root.getChildMeshes().find((m) => m.skeleton);
  return {
    root,
    skeleton: skinned?.skeleton ?? entries.skeletons[0] ?? null,
    groups: entries.animationGroups,
    entries,
  };
}
```

- [ ] **Step 3: Rewrite `populate` to use it**

```js
export async function populate(scene, mission, shadows) {
  const containers = {};
  try {
    for (const [role, file] of Object.entries(MODEL)) {
      containers[role] = await loadContainer(scene, file);
    }
  } catch (err) {
    for (const c of Object.values(containers)) c.dispose();
    throw err;
  }

  const figures = [];
  const add = (role, spawn, i) => {
    const made = instantiate(containers[role], spawn, `${role}_${i}`);
    for (const m of made.root.getChildMeshes()) {
      if (m.getTotalVertices() > 0) {
        m.receiveShadows = true;
        shadows?.addShadowCaster(m);
      }
    }
    figures.push({ root: made.root, skeleton: made.skeleton, groups: made.groups, role, entries: made.entries });
  };

  mission.spawns.swat.forEach((s, i) => add('swat', s, i));
  mission.spawns.hostiles.forEach((s, i) => add('hostile', s, i));
  add('hostage', mission.spawns.hostage, 0);

  if (!skeletonsAreDistinct(figures)) {
    throw new Error('cast: figures are sharing skeletons — per-figure animation is impossible');
  }

  const hostage = figures.find((f) => f.role === 'hostage');
  hostage.standUp = layHostageOnFloor(hostage, scene).standUp;

  return {
    figures,
    dispose() {
      for (const f of figures) {
        for (const g of f.groups) g.dispose();
        f.root.dispose(false, true);
      }
      for (const c of Object.values(containers)) c.dispose();
    },
  };
}
```

Throwing rather than warning is deliberate: a silent fallback to shared skeletons would surface much later as "all the hostiles died at once", which is far harder to diagnose than a startup error.

- [ ] **Step 4: Point `agents.js` at per-figure groups**

`ownedGroups(skeleton, scene)` scanned the whole scene to find which groups drive a skeleton. Each figure now carries its own, so replace it. In `raid/agents.js`, delete `ownedGroups` and change `makeRig`:

```js
function makeRig(figure) {
  return {
    groups: Object.fromEntries(CLIP_NAMES.map((n) => [n, figure.groups.find((g) => g.name === n)])),
    weight: Object.fromEntries(CLIP_NAMES.map((n) => [n, 0])),
    playing: new Set(),
    started: false,
  };
}
```

Replace the rig map construction at `raid/agents.js:95-100` with one rig per figure index:

```js
  // One rig per FIGURE now, not per skeleton. Every figure owns its skeleton
  // and its animation groups (see cast.js), so the old "four SWAT share one
  // pose, drive it from the fastest of them" constraint is gone — which is
  // what makes it possible for one agent to fire while another sprints, and
  // for one hostile to die without taking the other six down with it.
  const rigs = new Map(); // agent index -> rig
  cast.figures.forEach((fig, i) => {
    if (fig.role === 'hostage') return; // floor pose; its rig is added on rescue
    rigs.set(i, makeRig(fig));
  });
```

And replace the clip-selection loop at `raid/agents.js:247-254`:

```js
      for (const [i, rig] of rigs) {
        const a = world.agents[i];
        crossfade(rig, a ? directionalClip(a) : 'Idle', dt);
      }
```

Update the hostage rescue branch to match:

```js
      if (!hostageRescued && hostageFigure && orders?.hostageReached) {
        hostageRescued = true;
        hostageFigure.standUp();
        rigs.set(cast.figures.indexOf(hostageFigure), makeRig(hostageFigure));
      }
```

- [ ] **Step 5: Run the existing suite**

Run: `node --test raid/tests/*.test.js`
Expected: 87 pass, 0 fail. Nothing under `raid/sim/` changed, so this only proves nothing was broken by reaching into `cast.js`.

- [ ] **Step 6: Verify in the browser — this is the real test**

Start a server: `python3 -m http.server 8080`, open `http://localhost:8080/raid/?debug`.

Run in the console:

```js
const R = window.__raid;
const skels = new Set(R.cast.figures.map(f => f.skeleton));
console.log('figures', R.cast.figures.length, 'distinct skeletons', skels.size);
// Force one hostile into Death and confirm its siblings do not follow.
const h = R.cast.figures.filter(f => f.role === 'hostile');
h[0].groups.find(g => g.name === 'Death').start(false);
```

Expected: `figures 12 distinct skeletons 12`, and only the first hostile collapses — the other six keep walking. Take a screenshot showing one hostile down among six standing.

- [ ] **Step 7: Commit**

```bash
git add raid/cast.js raid/agents.js
git commit -m "feat(raid): give every figure its own skeleton"
```

---

### Task 2: Weapon loadouts

**Files:**
- Modify: `raid/roles.js:155-165` (hostile assembly), `raid/roles.js:132` (swat), `raid/roles.js:137` (hostage)
- Test: `raid/tests/roles.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: every entry of `mission.spawns.swat` and `mission.spawns.hostiles`, and `mission.spawns.hostage`, gains a `weapon` field: `'gun' | 'melee' | 'none'`. SWAT are always `'gun'`, the hostage is always `'none'`, hostiles are a deterministic mix.

- [ ] **Step 1: Write the failing test**

Add to `raid/tests/roles.test.js`:

```js
test('every figure is issued a weapon, and the hostiles are a mix', () => {
  for (const seed of SEEDS) {
    const mission = assignRoles(generateFloorplan(seed));

    for (const s of mission.spawns.swat) {
      assert.equal(s.weapon, 'gun', `${seed}: a SWAT member is not carrying a gun`);
    }
    assert.equal(mission.spawns.hostage.weapon, 'none');

    const kinds = mission.spawns.hostiles.map((h) => h.weapon);
    assert.ok(kinds.every((k) => k === 'gun' || k === 'melee'),
      `${seed}: a hostile has an unknown weapon: ${JSON.stringify(kinds)}`);
    // Both kinds must actually appear, or the melee half of the feature is
    // unreachable on this seed and the fight is a plain shootout.
    assert.ok(kinds.includes('gun'), `${seed}: no hostile has a gun`);
    assert.ok(kinds.includes('melee'), `${seed}: no hostile has a melee weapon`);
  }
});

test('the two hostage guards are always armed with guns', () => {
  // A melee guard standing over the hostage would charge the squad the moment
  // it entered the room, abandoning the objective it exists to defend. The
  // guards are the two hostiles sharing the hostage's room.
  for (const seed of SEEDS) {
    const mission = assignRoles(generateFloorplan(seed));
    const guards = mission.spawns.hostiles.filter((h) => h.cellId === mission.hostageRoomId);
    assert.equal(guards.length, 2, `${seed}: expected exactly 2 hostage guards`);
    for (const g of guards) {
      assert.equal(g.weapon, 'gun', `${seed}: a hostage guard is carrying a melee weapon`);
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test raid/tests/roles.test.js`
Expected: FAIL — `undefined !== 'gun'`.

- [ ] **Step 3: Implement**

In `raid/roles.js`, change the swat mapping at line 132:

```js
  const swat = swatPoints.map((p) => ({ ...p, facing: inwardFrom(p), cellId: entry.id, weapon: 'gun' }));
```

The hostage at line 137:

```js
  const hostage = { ...hostagePoint, facing: rng.range(0, Math.PI * 2), cellId: hostageRoom.id, weapon: 'none' };
```

And the hostile loop at lines 155-162:

```js
  // Loadouts. The first two assignments are the hostage room's guards and
  // always carry guns — a melee guard would charge the squad on sight and
  // abandon the objective it exists to defend. The rest alternate, which
  // guarantees both kinds appear on every seed (a shootout with no chargers,
  // or chargers with nothing pinning the squad, are both duller and leave
  // half this feature untested) without spending rng draws on it.
  const hostiles = [];
  for (const [i, cell] of assignments.entries()) {
    const [p] = scatter(cell, 1, rng, taken);
    taken.push(p);
    const weapon = i < 2 ? 'gun' : (i % 2 === 0 ? 'gun' : 'melee');
    hostiles.push({ ...p, facing: rng.range(0, Math.PI * 2), cellId: cell.id, weapon });
    if (roles[cell.id] === 'filler') roles[cell.id] = 'guard';
  }
```

With `CAST.hostiles === 7`, indices 0..6 give guns at 0,1,2,4,6 and melee at 3,5 — five guns, two chargers.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test raid/tests/roles.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `node --test raid/tests/*.test.js`
Expected: all pass. `roles.test.js` has a determinism test that must still hold.

- [ ] **Step 6: Commit**

```bash
git add raid/roles.js raid/tests/roles.test.js
git commit -m "feat(raid): issue weapon loadouts at generation"
```

---

### Task 3: Combat module — targets and line of sight

**Files:**
- Create: `raid/sim/combat.js`
- Create: `raid/tests/combat.test.js`
- Modify: `raid/tests/purity.test.js:16-19` (add `sim/combat.js` to `PURE_FILES`)

**Interfaces:**
- Consumes: `hasLineOfSight(grid, a, b, isDoorOpen)` from `raid/sim/path.js`; the agent shape from `world.js` (`id`, `role`, `x`, `z`, `weapon`, `hp`, `alive`, `target`, `captive`).
- Produces:
  - `COMBAT` — frozen constants object.
  - `createCombat({ grid, agents, rng, isDoorOpen, step })` returning `{ step(tick) }`.
  - `isEnemy(a, b)` exported for tests. `canTarget` stays an internal closure — it needs the grid and door state that `createCombat` captures, and it is covered through `step()` by the acquisition tests rather than directly.

- [ ] **Step 1: Write the failing test**

Create `raid/tests/combat.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, createCombat, isEnemy } from '../sim/combat.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { makeRng } from '../rng.js';

// A bare 20x20 room with an optional blocking prop, and agents placed by hand.
// Combat is easier to test on geometry chosen for the test than on a generated
// map where "is there a wall between these two" is itself a question.
const scene = (agents, placements = []) => {
  const plan = {
    seed: 'combat', config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 20, d: 20 },
    cells: [{ id: 0, x: 0, z: 0, w: 20, d: 20 }],
    doors: [], adjacency: {}, walls: [],
  };
  const grid = buildNavGrid(plan, placements);
  const full = agents.map((a, i) => ({
    id: i, role: a.role, weapon: a.weapon ?? 'gun',
    x: a.x, z: a.z, vx: 0, vz: 0, speed: 0, facing: 0,
    hp: a.hp ?? 100, alive: a.alive ?? true, target: -1, chasing: false,
    cooldown: 0, firedAt: -1, hitAt: -1, diedAt: -1, captive: a.captive ?? false,
    goal: null, path: null, pathIndex: 0, wants: 0,
  }));
  const combat = createCombat({
    grid, agents: full, rng: makeRng('combat:test'),
    isDoorOpen: () => true, step: 1 / 60,
  });
  return { grid, agents: full, combat };
};

test('SWAT and hostiles are enemies; same side is not', () => {
  const a = { role: 'swat' }, b = { role: 'hostile' }, c = { role: 'swat' };
  assert.equal(isEnemy(a, b), true);
  assert.equal(isEnemy(b, a), true);
  assert.equal(isEnemy(a, c), false);
  assert.equal(isEnemy(a, a), false);
});

test('an agent acquires the nearest visible enemy', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 9, z: 2 },
    { role: 'hostile', x: 5, z: 2 },
  ]);
  // Scans are staggered, so run a full interval to guarantee everyone scanned.
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 2, 'did not pick the nearer of two visible hostiles');
});

test('a wall between two agents prevents acquisition', () => {
  // A full-height blocking prop across the middle of the room.
  const { agents, combat } = scene(
    [{ role: 'swat', x: 2, z: 10 }, { role: 'hostile', x: 18, z: 10 }],
    [{ x: 10, z: 10, w: 0.5, d: 20 }],
  );
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, -1, 'acquired a target through a wall');
});

test('a target beyond sight range is not acquired', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 1, z: 1 },
    { role: 'hostile', x: 1, z: 1 + COMBAT.sightRange + 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, -1);
});

test('a dead agent neither targets nor is targeted', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 4, z: 2, alive: false },
    { role: 'hostile', x: 6, z: 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 2, 'targeted a corpse instead of the live hostile behind it');
  assert.equal(agents[1].target, -1, 'a dead agent acquired a target');
});

test('a captive hostage is not shot at; a rescued one is', () => {
  const captive = scene([
    { role: 'hostile', x: 2, z: 2 },
    { role: 'hostage', x: 4, z: 2, weapon: 'none', captive: true },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) captive.combat.step(t);
  assert.equal(captive.agents[0].target, -1, 'a hostile shot at its own prisoner');

  const rescued = scene([
    { role: 'hostile', x: 2, z: 2 },
    { role: 'hostage', x: 4, z: 2, weapon: 'none', captive: false },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) rescued.combat.step(t);
  assert.equal(rescued.agents[0].target, 1, 'a hostile ignored the hostage being walked out');
});

test('a target is dropped the tick it becomes invalid, not at the next scan', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 5, z: 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1);
  agents[1].alive = false;
  combat.step(COMBAT.scanInterval);
  assert.equal(agents[0].target, -1, 'kept firing at a corpse until its next scan window');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test raid/tests/combat.test.js`
Expected: FAIL — cannot resolve `../sim/combat.js`.

- [ ] **Step 3: Implement acquisition**

Create `raid/sim/combat.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test raid/tests/combat.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the module to the purity guard**

In `raid/tests/purity.test.js`, extend `PURE_FILES`:

```js
const PURE_FILES = [
  'rng.js', 'floorplan.js', 'roles.js', 'furnish.js',
  'sim/navgrid.js', 'sim/path.js', 'sim/world.js', 'sim/orders.js', 'sim/combat.js',
];
```

Run: `node --test raid/tests/purity.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add raid/sim/combat.js raid/tests/combat.test.js raid/tests/purity.test.js
git commit -m "feat(raid): acquire combat targets over exact line of sight"
```

---

### Task 4: Combat module — firing, striking, damage, death

**Files:**
- Modify: `raid/sim/combat.js` (add attack resolution to `step`)
- Modify: `raid/tests/combat.test.js`

**Interfaces:**
- Consumes: Task 3's `createCombat({ grid, agents, rng, isDoorOpen, step })`.
- Produces: `step(tick)` now mutates `hp`, `alive`, `cooldown`, `firedAt`, `hitAt`, `diedAt`. Exports `hitChance(a, distance)` for tests.

- [ ] **Step 1: Write the failing test**

Append to `raid/tests/combat.test.js`:

```js
import { hitChance } from '../sim/combat.js'; // add to the existing import

test('gun accuracy falls off with distance; melee does not', () => {
  const shooter = { role: 'swat', weapon: 'gun' };
  const point = hitChance(shooter, 0);
  const far = hitChance(shooter, COMBAT.gunRange);
  assert.equal(point, COMBAT.swatAccuracy);
  assert.ok(Math.abs(far - COMBAT.swatAccuracy * 0.5) < 1e-9,
    `at maximum range a shot should land half as often, got ${far}`);
  assert.equal(hitChance({ role: 'hostile', weapon: 'melee' }, 1), COMBAT.meleeAccuracy);
});

test('a gun agent in range whittles its target down and kills it', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 5, z: 2, hp: COMBAT.hostileHp },
  ]);
  let tick = 0;
  while (agents[1].alive && tick < 6000) combat.step(tick++);
  assert.equal(agents[1].alive, false, 'the hostile survived 100 simulated seconds of fire');
  assert.equal(agents[1].hp, 0, 'hp should be clamped to exactly 0 on death, not left negative');
  assert.ok(agents[1].diedAt >= 0);
});

test('a gun never reaches past its range', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 1, z: 1 },
    // Inside sight range, outside gun range.
    { role: 'hostile', x: 1, z: 1 + (COMBAT.gunRange + COMBAT.sightRange) / 2 },
  ]);
  for (let t = 0; t < 3000; t++) combat.step(t);
  assert.ok(agents[0].target >= 0, 'the target should still be seen, just not shootable');
  assert.equal(agents[1].hp, COMBAT.hostileHp, 'took damage from beyond gun range');
});

test('a melee agent cannot strike from across the room', () => {
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 8, z: 2 },
  ]);
  for (let t = 0; t < 3000; t++) combat.step(t);
  assert.equal(agents[0].chasing, true, 'a melee agent with a target should be chasing it');
  assert.equal(agents[1].hp, COMBAT.swatHp, 'was struck from 6m away');
});

test('a melee agent in contact does damage', () => {
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + COMBAT.meleeRange * 0.5, z: 2 },
  ]);
  for (let t = 0; t < 3000 && agents[1].alive; t++) combat.step(t);
  assert.equal(agents[1].alive, false, 'melee in contact range never killed anything');
});

test('nobody shoots through a closed door', () => {
  const plan = {
    seed: 'door-los', config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 12, d: 6 },
    cells: [{ id: 0, x: 0, z: 0, w: 5.5, d: 6 }, { id: 1, x: 6.5, z: 0, w: 5.5, d: 6 }],
    doors: [{ id: 0, x: 6, z: 3, axis: 'z', width: 1 }], adjacency: {}, walls: [],
  };
  const grid = buildNavGrid(plan, []);
  const mk = (id, role, x, z) => ({
    id, role, weapon: 'gun', x, z, vx: 0, vz: 0, speed: 0, facing: 0,
    hp: 100, alive: true, target: -1, chasing: false, cooldown: 0,
    firedAt: -1, hitAt: -1, diedAt: -1, captive: false,
    goal: null, path: null, pathIndex: 0, wants: 0,
  });
  const agents = [mk(0, 'swat', 3, 3), mk(1, 'hostile', 9, 3)];
  const shut = createCombat({ grid, agents, rng: makeRng('door'), isDoorOpen: () => false, step: 1 / 60 });
  for (let t = 0; t < 1200; t++) shut.step(t);
  assert.equal(agents[1].hp, 100, 'a bullet went through a closed door');
  assert.equal(agents[0].target, -1, 'acquired a target through a closed door');
});

test('combat is deterministic for a given seed', () => {
  const run = () => {
    const { agents, combat } = scene([
      { role: 'swat', x: 2, z: 2 },
      { role: 'hostile', x: 6, z: 3 },
      { role: 'hostile', x: 7, z: 2, weapon: 'melee' },
    ]);
    for (let t = 0; t < 2000; t++) combat.step(t);
    return agents.map((a) => `${a.id}:${a.hp}:${a.alive}:${a.target}`).join('|');
  };
  assert.equal(run(), run());
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test raid/tests/combat.test.js`
Expected: FAIL — `hitChance` is not exported; nothing takes damage.

- [ ] **Step 3: Implement attack resolution**

Add to `raid/sim/combat.js`, above `createCombat`:

```js
const accuracyOf = (a) => {
  if (a.weapon === 'melee') return COMBAT.meleeAccuracy;
  return a.role === 'swat' ? COMBAT.swatAccuracy : COMBAT.hostileAccuracy;
};

/**
 * Odds a single attack lands. A gun falls off linearly to half its accuracy at
 * maximum range, so distance is worth something without a shot ever becoming
 * impossible; melee is flat, because at 1.2m there is no falloff worth
 * modelling.
 */
export function hitChance(a, distance) {
  const base = accuracyOf(a);
  if (a.weapon === 'melee') return base;
  return base * (1 - 0.5 * distance / COMBAT.gunRange);
}

export const damageOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeDamage : COMBAT.gunDamage);
export const rangeOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeRange : COMBAT.gunRange);
export const cooldownOf = (a) => (a.weapon === 'melee' ? COMBAT.meleeCooldown : COMBAT.gunCooldown);
```

Add `kill` and `attack` inside `createCombat`, before the returned object:

```js
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
    // One roll per attack, drawn in agent-id order, so a replay is exact.
    if (rng.next() >= hitChance(a, d)) return;
    b.hp -= damageOf(a);
    b.hitAt = tick;
    if (b.hp <= 0) kill(b, tick);
  };
```

Extend the `step` loop's body, after the `cooldown` decrement:

```js
        if (a.target < 0 || a.cooldown > 0) continue;
        const b = agents[a.target];
        const d = distance(a, b);
        if (d > rangeOf(a)) continue;
        attack(a, b, d, tick);
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test raid/tests/combat.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/combat.js raid/tests/combat.test.js
git commit -m "feat(raid): resolve fire, melee strikes, damage and death"
```

---

### Task 5: Wire combat into the world

**Files:**
- Modify: `raid/sim/world.js` (agent fields, tick order, engagement, stall freeze, hash)
- Modify: `raid/tests/world.test.js`

**Interfaces:**
- Consumes: `createCombat`, `COMBAT` from `raid/sim/combat.js`; `spawn.weapon` from Task 2.
- Produces: agents carry `weapon`, `hp`, `alive`, `target`, `chasing`, `cooldown`, `firedAt`, `hitAt`, `diedAt`, `captive`. `world.hash()` includes `hp` and `alive`.

- [ ] **Step 1: Write the failing test**

Append to `raid/tests/world.test.js`:

```js
test('agents spawn alive, armed, and at full health', () => {
  const w = build('combat-spawn');
  for (const a of w.agents) {
    assert.equal(a.alive, true);
    assert.ok(a.hp > 0, `agent ${a.id} spawned with no health`);
    assert.ok(['gun', 'melee', 'none'].includes(a.weapon), `agent ${a.id} weapon is ${a.weapon}`);
  }
  assert.equal(w.agents.find((a) => a.role === 'hostage').captive, true);
});

test('the replay hash covers health, so a diverging fight cannot pass unnoticed', () => {
  const a = build('hash-hp');
  const b = build('hash-hp');
  for (let i = 0; i < 300; i++) { a.tick(); b.tick(); }
  assert.equal(a.hash(), b.hash());

  // Sabotage one agent's health and require the hash to notice.
  a.agents[0].hp -= 1;
  assert.notEqual(a.hash(), b.hash(),
    'hash() ignores hp — a combat divergence would replay as identical');
});

test('a dead agent stops moving and stays put', () => {
  const w = build('dead-still');
  const a = w.agents.find((x) => x.role === 'swat');
  const hostage = w.agents.find((x) => x.role === 'hostage');
  w.setGoal(a.id, { x: hostage.x, z: hostage.z });
  for (let i = 0; i < 120; i++) w.tick();

  a.hp = 0;
  w.tick();
  const at = { x: a.x, z: a.z };
  for (let i = 0; i < 300; i++) w.tick();

  assert.equal(a.alive, false, 'an agent at 0 hp is still alive');
  assert.ok(Math.hypot(a.x - at.x, a.z - at.z) < 1e-9, 'a corpse drifted');
  assert.equal(a.speed, 0);
  assert.equal(a.path, null);
});

test('an agent halted to shoot takes no stall strikes', () => {
  // Regression for the interaction the spec calls out: an agent standing still
  // to fire makes no progress toward its goal, so the goal-stall detector
  // would strike it, replan it, and nudge it into sliding sideways along a
  // wall while shooting. A deliberate combat halt is a wait, not a jam --
  // exactly like waiting at a shut door, which world.js already exempts.
  const w = openRoom([{ x: 2, z: 2 }], 20);
  const a = w.agents[0];
  // Give it something to shoot: a hostile is not in openRoom's cast, so make
  // this agent's own bookkeeping the subject and pin a fake engagement on it.
  assert.ok(w.setGoal(0, { x: 18, z: 18 }));
  for (let i = 0; i < 400; i++) {
    a.target = 0;          // engaged with something
    a.chasing = false;     // a gun agent: halts rather than closes
    w.tick();
  }
  assert.equal(a._goalStrikes, 0,
    'a deliberately halted shooter accumulated stall strikes and will be nudged off its firing position');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test raid/tests/world.test.js`
Expected: FAIL — `a.alive` is undefined.

- [ ] **Step 3: Add the fields and construct combat**

In `raid/sim/world.js`, add the import:

```js
import { createCombat, COMBAT } from './combat.js';
```

In the `add` closure (around `raid/sim/world.js:80`), extend the pushed record. Add after `wants`:

```js
      weapon: spawn.weapon ?? (role === 'hostage' ? 'none' : 'gun'),
      hp: role === 'swat' ? COMBAT.swatHp : role === 'hostage' ? COMBAT.hostageHp : COMBAT.hostileHp,
      alive: true,
      target: -1,
      chasing: false,
      cooldown: 0,
      firedAt: -1,
      hitAt: -1,
      diedAt: -1,
      // The hostage is a prisoner until the squad reaches it. Hostiles do not
      // shoot their own leverage; orders.js clears this at the rescue, which
      // is what makes the "hostage killed" failure condition reachable during
      // the escort without making it a coin flip in the opening seconds.
      captive: role === 'hostage',
```

After the `world` object literal is created, build the combat system:

```js
  const combat = createCombat({
    grid, agents, rng, isDoorOpen, step: SIM.step,
  });
```

- [ ] **Step 4: Run combat inside the tick, before movement**

In `world.tick()`, immediately after the door loop and before `for (const a of agents)`:

```js
    // Before movement, so a decision to stand and fight applies on the tick it
    // is made rather than one tick late.
    combat.step(world.ticks);
```

At the very top of the per-agent loop body, make the dead inert:

```js
    for (const a of agents) {
      a.speed = 0;
      if (!a.alive) { a.vx = 0; a.vz = 0; continue; }
```

- [ ] **Step 5: Halt engaged gun agents and freeze their stall bookkeeping**

Insert directly after the dead check, before the `if (!a.path || ...)` branch:

```js
      // Engaged with a gun: stand and shoot. Movement stops, but the agent
      // still turns to face what it is shooting at.
      //
      // The stall bookkeeping is reset every tick this holds, for the same
      // reason the door-wait branch below resets it: this is a deliberate
      // wait, not a jam. Without this the goal-stall detector counts the
      // firing position as a lack of progress, strikes, replans, and finally
      // nudges the agent sideways along whatever wall it is behind — the
      // recovery machinery actively fighting the behaviour it should ignore.
      if (a.target >= 0 && !a.chasing) {
        a.vx = 0; a.vz = 0;
        const t = agents[a.target];
        const want = Math.atan2(t.x - a.x, t.z - a.z);
        let delta = want - a.facing;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        a.facing += delta * Math.min(1, SIM.turnRate * SIM.step);
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
        a._goalBestDist = Infinity; a._goalCountdown = GOAL_STALL_WINDOW; a._goalStrikes = 0;
        a._nudgeBias = 0; a._nudgeTicks = 0; a._yieldTicks = 0;
        continue;
      }
```

- [ ] **Step 6: Let a chasing melee agent steer at its target**

This replaces a contiguous block: the no-path guard **and** the waypoint/arrival logic that follows it — `raid/sim/world.js:203-219` as the file stands before this task, running from `if (!a.path || a.pathIndex >= a.path.length) {` down to the closing brace of the `if (dist < SIM.arriveRadius)` block. A charging agent has no path of its own, so the guard that returns early on a missing path must not apply to it.

```js
      // A melee agent closing on someone steers at the person, not at the
      // waypoint its orders handed it. It has no path of its own to follow
      // while charging, so the no-path guard must not apply to it.
      const chaseTarget = a.chasing && a.target >= 0 ? agents[a.target] : null;
      if (!chaseTarget && (!a.path || a.pathIndex >= a.path.length)) {
        a.vx = 0; a.vz = 0;
        a._stallX = a.x; a._stallZ = a.z; a._stallCountdown = STALL_WINDOW; a._stallSawWall = false;
        a._goalBestDist = Infinity; a._goalCountdown = GOAL_STALL_WINDOW; a._goalStrikes = 0;
        a._nudgeBias = 0; a._nudgeTicks = 0; a._yieldTicks = 0;
        continue;
      }

      const target = chaseTarget ?? a.path[a.pathIndex];
      const dx = target.x - a.x;
      const dz = target.z - a.z;
      const dist = Math.hypot(dx, dz);

      // A chaser has arrived when it is in striking distance; combat.js does
      // the striking, so there is nothing further to do but hold position.
      if (chaseTarget) {
        if (dist < COMBAT.meleeRange * 0.75) { a.vx = 0; a.vz = 0; continue; }
      } else if (dist < SIM.arriveRadius) {
        a.pathIndex++;
        if (a.pathIndex >= a.path.length) { a.path = null; a.goal = null; a.vx = 0; a.vz = 0; }
        continue;
      }
```

Then guard the goal-stall block below it, which dereferences `a.goal`:

```js
      if (!chaseTarget) {
        const goalDist = Math.hypot(a.x - a.goal.x, a.z - a.goal.z);
        // ... the existing goal-stall body, unchanged ...
      }
```

Finally, exclude the dead from separation. In the separation loop, change:

```js
      for (const other of agents) {
        if (other === a || !other.alive) continue;
```

and in the rival scan inside the goal-stall block:

```js
            for (const other of agents) {
              if (other === a || !other.alive) continue;
```

- [ ] **Step 7: Put health in the hash**

Replace the agent line in `world.hash()`:

```js
      parts.push(`${a.id}:${round(a.x)},${round(a.z)},${round(a.facing)},${round(a.speed)},${a.waitingFor},${a.hp},${a.alive ? 1 : 0}`);
```

- [ ] **Step 8: Run the tests**

Run: `node --test raid/tests/world.test.js`
Expected: PASS.

Run: `node --test raid/tests/*.test.js`
Expected: `dryrun.test.js` and `orders.test.js` may now FAIL — casualties break the arrival checks, which Task 6 fixes. Record which fail; do not paper over them here.

- [ ] **Step 9: Commit**

```bash
git add raid/sim/world.js raid/tests/world.test.js
git commit -m "feat(raid): run combat in the tick and stand agents up to fight"
```

---

### Task 6: Casualties and mission outcome

**Files:**
- Modify: `raid/sim/orders.js`
- Modify: `raid/tests/orders.test.js`, `raid/tests/dryrun.test.js`

**Interfaces:**
- Consumes: `agent.alive`, `agent.captive` from Task 5.
- Produces: `orders.outcome` — `null`, `'success'`, or `'failed'`. `orders.phase` gains `'failed'`. `orders.hostageReached` unchanged.

- [ ] **Step 1: Write the failing test**

Append to `raid/tests/orders.test.js`:

```js
test('a mission with the whole squad dead ends as failed, not hung', () => {
  const plan = generateFloorplan('outcome-wipe');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  for (let i = 0; i < 120; i++) { world.tick(); orders.update(world); }
  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.hp = 0; a.alive = false; }

  let ticks = 0;
  while (orders.outcome === null && ticks < 3000) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.outcome, 'failed', 'a wiped squad never resolved the mission');
  assert.equal(orders.phase, 'failed');
});

test('a dead squad member is not waited on', () => {
  // The advance leg used to require every SWAT member to arrive. A corpse
  // never arrives, so the first death would hang the leg until the watchdog
  // dragged it forward -- turning a casualty into a minutes-long stall.
  const plan = generateFloorplan('outcome-casualty');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  for (let i = 0; i < 60; i++) { world.tick(); orders.update(world); }
  const victim = world.agents.filter((a) => a.role === 'swat')[3];
  victim.hp = 0; victim.alive = false;

  let ticks = 0;
  while (orders.outcome === null && ticks < 14400) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.outcome, 'success',
    'three surviving SWAT could not finish the mission after one casualty');
});

test('the mission fails if the hostage is killed during the escort', () => {
  const plan = generateFloorplan('outcome-hostage');
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const orders = createOrders(plan, mission);

  let ticks = 0;
  while (orders.phase !== 'extract' && ticks < 14400) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.phase, 'extract', 'never reached the escort');

  const hostage = world.agents.find((a) => a.role === 'hostage');
  assert.equal(hostage.captive, false, 'the hostage should stop being a prisoner at the rescue');
  hostage.hp = 0; hostage.alive = false;

  ticks = 0;
  while (orders.outcome === null && ticks < 3000) { world.tick(); orders.update(world); ticks++; }
  assert.equal(orders.outcome, 'failed');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test raid/tests/orders.test.js`
Expected: FAIL — `orders.outcome` is undefined.

- [ ] **Step 3: Implement**

In `raid/sim/orders.js`, add to `state`:

```js
    // null while the mission is live. 'success' only via the extraction check
    // with the hostage alive; 'failed' when there is nobody left to finish or
    // nothing left to rescue. `phase === 'done'` has never been the same
    // question as "did it work" -- this is.
    outcome: null,
```

Expose it on `api` beside `hostageReached`:

```js
    get outcome() { return state.outcome; },
```

At the very top of `update(world)`, replace the two existing lookups and add the terminal check:

```js
    update(world) {
      if (state.outcome !== null) return;

      // Living members only, everywhere. `swat.every(...)` over a corpse never
      // becomes true, so an arrival check that counted the dead would hang the
      // advance until the watchdog dragged it forward.
      const swat = world.agents.filter((a) => a.role === 'swat' && a.alive);
      const hostage = world.agents.find((a) => a.role === 'hostage');

      if (swat.length === 0 || !hostage.alive) {
        state.outcome = 'failed';
        state.phase = 'failed';
        return;
      }
```

In the `rescue` phase, release the hostage from captivity:

```js
      if (state.phase === 'rescue') {
        // No longer leverage: from here the hostage walks out with the squad,
        // and hostiles will shoot at it (see combat.js canTarget).
        hostage.captive = false;
        state.phase = 'extract';
        beginLeg();
        return;
      }
```

In the `extract` phase, set the outcome on success:

```js
        const out = [...swat, hostage].every((a) => Math.hypot(a.x - exit.x, a.z - exit.z) < 3);
        if (out) {
          state.phase = 'done';
          state.outcome = 'success';
        }
```

The patrol loop must also skip the dead — change its filter:

```js
      for (const a of world.agents.filter((x) => x.role === 'hostile' && x.alive)) {
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test raid/tests/orders.test.js`
Expected: PASS.

- [ ] **Step 5: Update the end-to-end test to assert an outcome**

In `raid/tests/dryrun.test.js`, change the loop condition and the assertions. Replace `while (orders.phase !== 'done' && ticks < MAX_TICKS)` with:

```js
      while (orders.outcome === null && ticks < MAX_TICKS) {
```

Replace the two assertions about `phase` and `hostageReached` with:

```js
      // Either side may win — that is the point of a genuine contest. What is
      // never acceptable is a mission that neither finishes nor fails: that is
      // a hang, and it is the thing this test exists to catch.
      assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
        `${seed}: mission never resolved within ${MAX_TICKS / 60} simulated seconds`);

      if (orders.outcome === 'success') {
        assert.ok(orders.hostageReached,
          `${seed}: reported success without the squad ever reaching the hostage room`);
        assert.ok(world.agents.find((a) => a.role === 'hostage').alive,
          `${seed}: reported success with a dead hostage`);
      }
```

Guard the SWAT distance assertion so it only covers survivors:

```js
      for (const a of world.agents.filter((x) => x.role === 'swat' && x.alive)) {
```

Add a suite-level assertion after the room-count loops, collecting outcomes:

```js
  // A combat model where SWAT always win is as broken as one where they always
  // lose, and a suite that only ever observes one outcome is not testing
  // combat at all. This is deliberately about the SET of seeds, not any one
  // of them -- no individual seed is required to go either way.
  assert.ok(outcomes.has('success'), 'no seed produced a successful mission');
```

Declare `const outcomes = new Set()` before the loops and `outcomes.add(orders.outcome)` inside.

- [ ] **Step 6: Run the full suite**

Run: `node --test raid/tests/*.test.js`
Expected: all pass. If `dryrun` reports only failures across every seed, the balance constants in `combat.js` are wrong — tune them in Task 10, where the sweep measures the rate, and leave this failing until then only if the failure is a lopsided win rate rather than a hang.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/orders.js raid/tests/orders.test.js raid/tests/dryrun.test.js
git commit -m "feat(raid): casualties, and a mission that can be lost"
```

---

### Task 7: Combat animation

**Files:**
- Modify: `raid/agents.js`
- Test: manual browser verification (Babylon behaviour)

**Interfaces:**
- Consumes: per-figure `groups` from Task 1; `alive`, `firedAt`, `hitAt`, `diedAt`, `target`, `chasing`, `weapon` from Tasks 4-5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the clip set**

In `raid/agents.js`, replace `CLIP_NAMES`:

```js
const CLIP_NAMES = [
  'Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right',
  'Idle_Gun_Pointing', 'Idle_Gun_Shoot', 'Gun_Shoot', 'Run_Shoot',
  'Sword_Slash', 'HitRecieve', 'Death',
];

// How long, in sim ticks, a one-shot clip keeps being requested after the
// event that triggered it. The sim reports an instant ("fired on tick 812");
// the renderer needs a duration, and these are what turn one into the other.
const FIRE_TICKS = 18;   // ~0.3s of muzzle animation per shot
const FLINCH_TICKS = 24; // ~0.4s of reacting to being hit
```

- [ ] **Step 2: Write the clip chooser**

Add below `directionalClip`:

```js
/**
 * Which clip an agent calls for, combat first. Order matters and is a
 * priority, not a sequence: a dying agent is not also flinching, and an agent
 * that is firing should be seen firing even though it is technically also
 * standing still.
 *
 * `world.ticks` is passed in because the sim records combat events as tick
 * stamps rather than as durations — it has no notion of how long anything
 * should be shown for, which is exactly right for a module that must run
 * headless at 340k ticks/s.
 */
function combatClip(agent, ticks) {
  if (!agent.alive) return 'Death';
  if (agent.hitAt >= 0 && ticks - agent.hitAt < FLINCH_TICKS) return 'HitRecieve';

  const firing = agent.firedAt >= 0 && ticks - agent.firedAt < FIRE_TICKS;
  if (firing && agent.weapon === 'melee') return 'Sword_Slash';
  if (firing) return agent.speed > WALK_MIN ? 'Run_Shoot' : 'Gun_Shoot';

  // Holding a target but between shots: weapon up, not slack at the side.
  if (agent.target >= 0 && agent.weapon === 'gun' && agent.speed < WALK_MIN) {
    return 'Idle_Gun_Pointing';
  }
  return directionalClip(agent);
}
```

- [ ] **Step 3: Hold the dead on their last frame**

`Death` must play once and stop, not loop. In `crossfade`, the `g.start(true, ...)` calls loop unconditionally. Add a helper and use it at both call sites:

```js
  // Death is the one clip that must not loop — a corpse repeatedly collapsing
  // is the kind of thing that reads as a bug from across the room. Playing it
  // non-looping leaves Babylon holding the final frame, which is exactly the
  // pose wanted.
  const startClip = (g, name) => g.start(name !== 'Death', 1.0, g.from, g.to, false);
```

Replace both `g.start(true, 1.0, g.from, g.to, false)` calls in `crossfade` with `startClip(g, n)`.

- [ ] **Step 4: Use it, and stop moving corpses**

In `sync()`, change the clip loop:

```js
      for (const [i, rig] of rigs) {
        const a = world.agents[i];
        crossfade(rig, a ? combatClip(a, world.ticks) : 'Idle', dt);
      }
```

A dead agent's sim position never changes again, so the interpolation loop already leaves it where it fell. No change needed there — but the role marker should stop following a corpse around only in the sense that it will not move either, which is automatic.

- [ ] **Step 5: Verify in the browser**

Serve and open `http://localhost:8080/raid/?debug`. Let the mission run to contact and confirm by eye:

- Hostiles that see the squad raise their weapons rather than standing slack.
- Shots produce a visible firing animation.
- A killed figure collapses **once** and stays down while others keep moving.
- Melee hostiles run at the squad and swing on arrival.

Then check the outcome resolves:

```js
const R = window.__raid;
setInterval(() => console.log(R.orders.phase, R.orders.outcome,
  R.world.agents.map(a => `${a.role[0]}${a.id}:${a.hp}`).join(' ')), 2000);
```

Take a screenshot of a firefight in progress with at least one figure down.

- [ ] **Step 6: Commit**

```bash
git add raid/agents.js
git commit -m "feat(raid): animate firing, melee, flinching and death"
```

---

### Task 8: Visible weapons

**Files:**
- Create: `raid/weapons.js`
- Modify: `raid/cast.js` (attach on spawn)

**Interfaces:**
- Consumes: `figure.skeleton` and `figure.root` from Task 1; `spawn.weapon` from Task 2.
- Produces: `attachWeapon(scene, figure, weapon)` → a disposable mesh parented to the figure's right-hand bone, or `null` for `'none'`.

- [ ] **Step 1: Implement the module**

Create `raid/weapons.js`:

```js
// Weapons in hands.
//
// Each item is authored around its GRIP: the origin sits in the palm and the
// item extends along +Y, the same convention soldier/melee.js established, so
// one attachment transform serves every item and swapping a rifle for a bat
// changes geometry rather than placement.
//
// The bone is found by NAME, not by index. Bone indices differ between the
// pack's models, and an index that happens to be the right hand on Swat.glb
// is an elbow on Punk.glb -- which shows up as a rifle growing out of a
// forearm rather than as an error.

const HAND_BONE = 'Hand.R';

function material(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

function rifle(scene) {
  const body = material(scene, 'weaponBody', '#2b2b30');
  const parts = [];

  const receiver = BABYLON.MeshBuilder.CreateBox('rifleReceiver',
    { width: 0.05, height: 0.30, depth: 0.09 }, scene);
  receiver.position.y = 0.10;
  parts.push(receiver);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('rifleBarrel',
    { diameter: 0.025, height: 0.34, tessellation: 8 }, scene);
  barrel.position.y = 0.36;
  parts.push(barrel);

  const magazine = BABYLON.MeshBuilder.CreateBox('rifleMag',
    { width: 0.035, height: 0.13, depth: 0.05 }, scene);
  magazine.position.set(0, 0.04, -0.06);
  parts.push(magazine);

  const stock = BABYLON.MeshBuilder.CreateBox('rifleStock',
    { width: 0.04, height: 0.16, depth: 0.07 }, scene);
  stock.position.y = -0.10;
  parts.push(stock);

  for (const p of parts) p.material = body;
  const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  merged.name = 'rifle';
  return merged;
}

function bat(scene) {
  const wood = material(scene, 'meleeWood', '#a9793f');
  const parts = [];

  const grip = BABYLON.MeshBuilder.CreateCylinder('batGrip',
    { diameter: 0.032, height: 0.16, tessellation: 8 }, scene);
  grip.position.y = 0.08;
  parts.push(grip);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('batBarrel',
    { diameterTop: 0.062, diameterBottom: 0.038, height: 0.42, tessellation: 8 }, scene);
  barrel.position.y = 0.37;
  parts.push(barrel);

  for (const p of parts) p.material = wood;
  const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  merged.name = 'bat';
  return merged;
}

/**
 * Put the right weapon in the figure's right hand. Returns the mesh so the
 * caller can dispose it, or null when the figure carries nothing.
 */
export function attachWeapon(scene, figure, weapon) {
  if (weapon !== 'gun' && weapon !== 'melee') return null;

  const bone = figure.skeleton?.bones.find((b) => b.name === HAND_BONE);
  if (!bone) {
    throw new Error(`weapons: ${figure.role} has no bone named ${HAND_BONE}`);
  }

  const mesh = weapon === 'gun' ? rifle(scene) : bat(scene);
  mesh.attachToBone(bone, figure.root);
  // A grip is a fist around a shaft, so the item lies across the palm rather
  // than sprouting from it. Values are the soldier/ sandbox's, which were
  // solved against this same rig.
  mesh.rotation = new BABYLON.Vector3(Math.PI / 2, 0, 0);
  mesh.position = new BABYLON.Vector3(0, 0, 0);
  return mesh;
}
```

- [ ] **Step 2: Attach on spawn**

In `raid/cast.js`, import it and give each figure its weapon. In `populate`'s `add`, after the shadow loop:

```js
    const spawnWeapon = spawn.weapon ?? 'none';
    const weaponMesh = attachWeapon(scene, { ...made, role }, spawnWeapon);
    if (weaponMesh) shadows?.addShadowCaster(weaponMesh);
    figures.push({
      root: made.root, skeleton: made.skeleton, groups: made.groups,
      role, entries: made.entries, weapon: spawnWeapon, weaponMesh,
    });
```

And dispose it:

```js
      for (const f of figures) {
        f.weaponMesh?.dispose();
        for (const g of f.groups) g.dispose();
        f.root.dispose(false, true);
      }
```

- [ ] **Step 3: Verify the bone name before trusting it**

The bone name is the one assumption here that would fail loudly but confusingly. Confirm it in the browser console before running the mission:

```js
const R = window.__raid;
console.log(R.cast.figures[0].skeleton.bones.map(b => b.name).filter(n => /hand/i.test(n)));
```

Expected: a list containing `Hand.R`. If the pack names it differently, update `HAND_BONE` to match — do not guess.

- [ ] **Step 4: Verify visually**

Reload and confirm: every SWAT carries a rifle, gun hostiles carry rifles, melee hostiles carry a bat, the hostage carries nothing, and no weapon floats free of a hand while figures run. Screenshot a melee hostile mid-charge with its bat.

- [ ] **Step 5: Commit**

```bash
git add raid/weapons.js raid/cast.js
git commit -m "feat(raid): put rifles and bats in the hands that carry them"
```

---

### Task 9: Show the outcome

**Files:**
- Modify: `raid/main.js`, `raid/index.html`

**Interfaces:**
- Consumes: `orders.outcome` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add a readout element**

In `raid/index.html`, beside the existing stats line, add:

```html
<span id="outcome" class="outcome"></span>
```

- [ ] **Step 2: Update it each frame**

In `raid/main.js`, alongside the existing `statsEl` handling, add:

```js
const outcomeEl = document.getElementById('outcome');
```

and inside the render loop, after `orders.update(world)`:

```js
  // Casualty count while the fight is live, verdict once it is not.
  if (orders.outcome) {
    outcomeEl.textContent = orders.outcome === 'success' ? 'HOSTAGE EXTRACTED' : 'MISSION FAILED';
    outcomeEl.dataset.state = orders.outcome;
  } else {
    const alive = (role) => world.agents.filter((a) => a.role === role && a.alive).length;
    outcomeEl.textContent = `SWAT ${alive('swat')}/4 · HOSTILES ${alive('hostile')}/7`;
    outcomeEl.dataset.state = 'live';
  }
```

Clear it in `regenerate()`, next to the existing teardown:

```js
  outcomeEl.textContent = '';
  delete outcomeEl.dataset.state;
```

- [ ] **Step 3: Style it**

In `raid/index.html`'s stylesheet:

```css
.outcome { margin-left: 1rem; letter-spacing: 0.08em; }
.outcome[data-state="success"] { color: #6fcf7f; }
.outcome[data-state="failed"]  { color: #e06c6c; }
```

- [ ] **Step 4: Verify**

Reload, watch a mission through, and confirm the counter falls as figures die and settles on a verdict. Regenerate and confirm it clears.

- [ ] **Step 5: Commit**

```bash
git add raid/main.js raid/index.html
git commit -m "feat(raid): show the butcher's bill and the verdict"
```

---

### Task 10: Tune, sweep, and close the deferred items

**Files:**
- Modify: `raid/sim/combat.js` (constants only, if the sweep says so)
- Modify: `raid/sim/path.js`, `raid/sim/navgrid.js`, `raid/sim/orders.js` (deferred items)
- Modify: `raid/tests/path.test.js`, `raid/tests/dryrun.test.js`
- Modify: `.superpowers/sdd/` ledger

**Interfaces:**
- Consumes: everything above.
- Produces: a tuned, measured, documented phase.

- [ ] **Step 1: Write the sweep**

Create a throwaway script under the scratchpad (NOT in the repository) that runs 150 missions across room counts 8-12 and reports: outcome split, mean fight duration, shots fired per kill, worst completion, and any hang. Model it on the existing `sweep.mjs` pattern — import `generateFloorplan`, `assignRoles`, `layoutProps`, `createWorld`, `createOrders` by absolute path and drive the loop to `orders.outcome !== null`.

- [ ] **Step 2: Measure and tune**

Run it. The target is a genuine contest, not a fixed number. Adjust only the constants in `COMBAT` — never the tests — until:

- Neither outcome is below roughly 15% of runs.
- No run hangs (all resolve inside `MAX_TICKS`).
- The median mission is not dramatically longer than the 39s pre-combat baseline; a firefight should add time, not multiply it.

Record the before/after numbers. If tuning cannot reach a contest, say so with the numbers rather than forcing it.

- [ ] **Step 3: Confirm the tick budget still holds**

Run: `node --test raid/tests/simbudget.test.js`
Expected: PASS. Combat adds ~22 line-of-sight traversals per tick after staggering. If `a single tick with twelve agents stays inside 2ms` fails, raise `COMBAT.scanInterval` before touching the budget — the budget is the requirement.

- [ ] **Step 4: Close deferred item — findPath start-cell passability**

`findPath` validates only `inBounds` for the start cell, so a start inside geometry emits a waypoint inside a wall. Combat can now push agents into odd positions, so bound it. In `raid/sim/path.js:97`:

```js
  if (!grid.inBounds(start.col, start.row) || !grid.inBounds(goal.col, goal.row)) return null;
  // The START cell must be passable too, not merely in bounds. A start inside
  // geometry used to emit a first waypoint inside a wall; spawns are
  // generator-controlled, so this was unreachable while only the generator
  // placed agents, but anything that can displace an agent mid-mission makes
  // it reachable.
  if (!passable(grid, start.col, start.row, isDoorOpen)) return null;
  if (!passable(grid, goal.col, goal.row, isDoorOpen)) return null;
```

Add to `raid/tests/path.test.js`:

```js
test('a path from inside geometry is refused, not answered with a waypoint in a wall', () => {
  const plan = {
    seed: 'blocked-start', config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 8, d: 8 },
    cells: [{ id: 0, x: 0, z: 0, w: 8, d: 8 }],
    doors: [], adjacency: {}, walls: [],
  };
  const grid = buildNavGrid(plan, [{ x: 4, z: 4, w: 1.5, d: 1.5 }]);
  const inside = { x: 4, z: 4 };
  const cell = grid.worldToCell(inside.x, inside.z);
  assert.equal(grid.isBlocked(cell.col, cell.row), true,
    'the test fixture is wrong — that point is not actually inside the prop, so this proves nothing');
  assert.equal(findPath(grid, inside, { x: 1, z: 1 }, () => true), null);
});
```

- [ ] **Step 5: Close deferred item — dead generality in `carve`**

`carve(rect, pad)` in `raid/sim/navgrid.js:36` is only ever called with `pad = 0`. Remove the parameter and the three `pad` terms in the bounds computation, and update both call sites (`for (const cell of plan.cells) carve(cell);`).

- [ ] **Step 6: Close deferred item — dryrun catches only total no-ops**

`dryrun.test.js`'s `distance > 50` threshold passes even if a subset of agents is frozen. It already checks per-SWAT distance; extend that to hostiles, which patrol and so should all have moved:

```js
      // Aggregate distance is satisfied by a couple of busy patrollers while
      // the rest stand frozen. Every hostile that survived the mission should
      // have covered ground of its own.
      for (const a of world.agents.filter((x) => x.role === 'hostile' && x.alive)) {
        assert.ok(distance.get(a.id) > 1,
          `${seed}: surviving hostile ${a.id} never moved (${distance.get(a.id).toFixed(1)}m)`);
      }
```

- [ ] **Step 7: Run everything**

Run: `node --test raid/tests/*.test.js`
Expected: all pass.

Run five concurrent copies to confirm no wall-clock flakiness returned:

```bash
for i in 1 2 3 4 5; do (node --test raid/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)") & done; wait
```

Expected: `fail 0` five times.

- [ ] **Step 8: Update the ledger**

Append to `.superpowers/sdd/2026-07-30-raid-simulation-core/progress.md` (or a new phase-C ledger): the measured outcome split, tuning changes, the deferred items closed, and anything found and deliberately left.

- [ ] **Step 9: Commit**

```bash
git add raid/sim/path.js raid/sim/navgrid.js raid/sim/combat.js raid/tests/
git commit -m "fix(raid): tune the fight, and close the deferred items around it"
```

---

## Self-Review Notes

**Spec coverage.** Per-figure skeletons → Task 1. Loadouts → Task 2. Acquisition and line of sight, including the staggered scan and the captive-hostage rule → Task 3. Firing, melee, damage, death, the hit-chance formula → Task 4. Engagement halt, chasing, the stall freeze, the hash → Task 5. Casualty bookkeeping, living-only formation slots, outcome → Task 6. Combat clips and holding the dead → Task 7. Weapon geometry → Task 8. HUD → Task 9. Tuning, the sweep, the tick budget, deferred items → Task 10.

**Deliberately not implemented:** ammo and reload, squad tactics, hard body radius — all recorded as out of scope in the spec.

**One spec detail rescoped:** the spec assigns hostiles roughly four guns to three melee. Task 2 produces five guns and two melee, because the two hostage-room guards are pinned to guns — a charger guarding the objective abandons it on sight. The test asserts both kinds appear rather than exact counts.
