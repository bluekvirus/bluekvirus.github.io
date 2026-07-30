# Raid Map Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone `raid/` page that generates a seeded office floor plan for a hostage-rescue scenario — 4 SWAT, 7 hostiles, 1 seated hostage — rendered roofless at a 45° view.

**Architecture:** Pure data modules (`rng`, `floorplan`, `roles`, `furnish`) generate and place everything with no Babylon import, so correctness is asserted with Node's built-in test runner across hundreds of seeds. Babylon modules (`build`, `props`, `cast`, `seated`, `stage`) turn that data into meshes. `main.js` wires them to a HUD.

**Tech Stack:** Vanilla ES modules, Babylon.js 9.18.1 from CDN, Node's built-in test runner (`node --test`), no dependencies, no build step.

## Global Constraints

- No build step. Plain ES modules loaded directly by the browser; push is deploy.
- Babylon.js 9.18.1 from `https://cdn.jsdelivr.net/npm/babylonjs@9.18.1/babylon.js` with the same `integrity` and `crossorigin` attributes already used in `soldier/index.html`. Copy them verbatim; do not invent a new hash.
- Seeded RNG only. `Math.random()` anywhere in generation is a defect — it breaks reproducibility from a seed.
- `rng.js`, `floorplan.js`, `roles.js` and `furnish.js` MUST NOT import Babylon or reference `window`, `document` or `BABYLON`. They run under Node.
- Coordinates: `x`/`z` are the **minimum corner** of a rectangle, `w` spans x, `d` spans z. Ground is `y = 0`. Units are metres.
- Default footprint 35 × 35 m. Default target 10 cells of kind `room` (spec range 8–12), adjustable from the HUD.
- Cast is exactly 4 SWAT, 7 hostiles, 1 hostage.
- Wall height 2.6 m, wall thickness 0.15 m, corridor width 1.8 m, door width 1.0 m, door corner margin 0.6 m.
- Camera defaults to 45° pitch (`beta = Math.PI / 4`).
- Invariant tests run across at least 200 seeds, never a single seed.
- Generation budget: `generateFloorplan` + `assignRoles` + `layoutProps` under 30 ms combined.
- Every task ends with a commit whose message explains *why*, following the repo's existing commit style.

---

## File Structure

| File | Pure? | Responsibility |
|---|---|---|
| `package.json` | — | `{"type":"module","private":true}` so Node treats `.js` as ESM |
| `assets/quaternius/**` | — | Character pack, relocated from `soldier/assets/` |
| `raid/rng.js` | yes | Seeded PRNG |
| `raid/floorplan.js` | yes | BSP split, corridors, adjacency, doors, wall segments |
| `raid/roles.js` | yes | Room roles, spawn points, extraction |
| `raid/furnish.js` | yes | Cover prop placement |
| `raid/props.js` | no | Prop and chair meshes |
| `raid/build.js` | no | Floors, walls, doors, markers |
| `raid/cast.js` | no | Character loading and placement |
| `raid/seated.js` | no | Seated hostage pose, chair sized to it |
| `raid/stage.js` | no | Camera, lights, shadows |
| `raid/main.js` | no | Wiring and HUD |
| `raid/tests/*.test.js` | — | Node tests for the pure modules |

---

### Task 1: Test harness and asset relocation

Both pages will need the character pack, so it moves to the repo root. This task also establishes the Node test harness everything later depends on.

**Files:**
- Create: `package.json`
- Move: `soldier/assets/` → `assets/`
- Modify: `soldier/main.js` (the `ASSET_DIR` constant)
- Create: `raid/tests/harness.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `node --test` runs from the repo root and discovers `raid/tests/*.test.js`; character GLBs live at `assets/quaternius/<Name>.glb`

- [ ] **Step 1: Create the root package.json**

Node treats `.js` as CommonJS unless told otherwise, which would break `import` in the pure modules. This file is inert for GitHub Pages.

```json
{
  "name": "bluekvirus-github-io",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: Write a harness test that proves the runner works**

Create `raid/tests/harness.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('character pack lives at the shared root path', () => {
  assert.ok(existsSync('assets/quaternius/Swat.glb'), 'Swat.glb should be under assets/quaternius/');
  assert.ok(existsSync('assets/quaternius/LICENSE.txt'), 'the CC0 licence must travel with the assets');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test`
Expected: FAIL — `assets/quaternius/Swat.glb` does not exist yet.

- [ ] **Step 4: Move the assets**

```bash
git mv soldier/assets assets
```

Result: `assets/quaternius/Swat.glb`, `assets/quaternius/LICENSE.txt`, and the other GLBs.

- [ ] **Step 5: Point the soldier page at the new location**

In `soldier/main.js`, change the constant:

```js
const ASSET_DIR = '../assets/quaternius/';
```

`soldier/sidearm.js` receives its directory as a parameter from `main.js` (`loadSidearm(scene, ASSET_DIR)`), so it needs no change. Verify that by reading the call site before moving on.

- [ ] **Step 6: Run the test and confirm it passes**

Run: `node --test`
Expected: PASS, 1 test.

- [ ] **Step 7: Confirm the soldier page still works**

Serve the repo root (`python3 -m http.server 8080`) and open
`http://localhost:8080/soldier/?debug&character=Swat&clip=Idle_Gun`.

Check in the browser console:

```js
window.__soldier.figure.weapon.meshes.length   // 3 — the pistol still loads
window.__soldier.scene.animationGroups.length  // 25
```

Both must hold. A 404 on the GLB shows as "model failed to load" in the HUD.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: share the character pack between pages

Two pages need the Quaternius pack now, so it moves from soldier/assets to
assets/ at the root rather than being copied or reached into from a sibling
page. Adds package.json with type:module so Node treats the .js sources as
ES modules, which is what lets the generator's pure modules be tested with
the built-in test runner and no dependencies."
```

---

### Task 2: Seeded RNG

**Files:**
- Create: `raid/rng.js`
- Create: `raid/tests/rng.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `hashSeed(seed: string): number` — 32-bit unsigned
  - `makeRng(seed: string): Rng` where `Rng = { next(): number, range(min: number, max: number): number, int(minIncl: number, maxExcl: number): number, pick<T>(items: T[]): T }`
  - `next()` returns `[0, 1)`; `range` returns `[min, max)`; `int` returns an integer in `[minIncl, maxExcl)`

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/rng.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, hashSeed } from '../rng.js';

test('the same seed replays the same sequence', () => {
  const a = makeRng('alpha');
  const b = makeRng('alpha');
  const left = Array.from({ length: 50 }, () => a.next());
  const right = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(left, right);
});

test('different seeds diverge', () => {
  const a = Array.from({ length: 20 }, (_, i) => makeRng('alpha').next() + i);
  const b = Array.from({ length: 20 }, (_, i) => makeRng('beta').next() + i);
  assert.notDeepEqual(a, b);
});

test('next stays in [0, 1)', () => {
  const rng = makeRng('bounds');
  for (let i = 0; i < 10000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() returned ${v}`);
  }
});

test('int stays in range and reaches both ends', () => {
  const rng = makeRng('ints');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(3, 7);
    assert.ok(Number.isInteger(v), `${v} is not an integer`);
    assert.ok(v >= 3 && v < 7, `${v} out of range`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('range respects its bounds', () => {
  const rng = makeRng('range');
  for (let i = 0; i < 5000; i++) {
    const v = rng.range(-2, 5);
    assert.ok(v >= -2 && v < 5, `${v} out of range`);
  }
});

test('pick returns a member of the array', () => {
  const rng = makeRng('pick');
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 200; i++) assert.ok(items.includes(rng.pick(items)));
});

test('hashSeed is stable and unsigned', () => {
  assert.equal(hashSeed('alpha'), hashSeed('alpha'));
  assert.notEqual(hashSeed('alpha'), hashSeed('beta'));
  assert.ok(hashSeed('alpha') >= 0);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../rng.js`.

- [ ] **Step 3: Implement**

Create `raid/rng.js`:

```js
// Seeded randomness. Every generated map must be reproducible from its seed, so
// generation never touches Math.random — a map you cannot regenerate is a map
// you cannot report a bug against.

/** FNV-1a over the seed string, so any text works as a seed. */
export function hashSeed(seed) {
  let h = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for layout jitter. */
export function makeRng(seed) {
  let state = hashSeed(seed);

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (minIncl, maxExcl) => minIncl + Math.floor(next() * (maxExcl - minIncl)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
```

- [ ] **Step 4: Run and confirm green**

Run: `node --test`
Expected: PASS, 8 tests total (7 here plus the harness test).

- [ ] **Step 5: Commit**

```bash
git add package.json raid/rng.js raid/tests/rng.test.js
git commit -m "feat: seeded RNG for map generation

mulberry32 over an FNV-1a hash of the seed string, so any text is a valid
seed and a given seed always replays the same map. Generation never calls
Math.random: a layout you cannot reproduce from its seed is one you cannot
file a bug against or verify a fix for."
```

---

### Task 3: BSP split into rooms and corridors

**Files:**
- Create: `raid/floorplan.js`
- Create: `raid/tests/floorplan.test.js`

**Interfaces:**
- Consumes: `makeRng` from `raid/rng.js`
- Produces:
  - `FLOORPLAN_DEFAULTS` — frozen config object
  - `generateFloorplan(seed: string, overrides?: object): Plan`
  - `Plan = { seed, config, bounds: Rect, cells: Cell[] }` at this stage
  - `Rect = { x: number, z: number, w: number, d: number }`
  - `Cell = Rect & { id: number, kind: 'room' | 'corridor' }`
  - Later tasks add `adjacency`, `doors` and `walls` to `Plan`

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/floorplan.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan, FLOORPLAN_DEFAULTS } from '../floorplan.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;

test('the same seed produces an identical plan', () => {
  const a = generateFloorplan('repeat');
  const b = generateFloorplan('repeat');
  assert.deepEqual(a.cells, b.cells);
});

test('different seeds produce different plans', () => {
  const a = JSON.stringify(generateFloorplan('one').cells);
  const b = JSON.stringify(generateFloorplan('two').cells);
  assert.notEqual(a, b);
});

test('room count lands in the spec range on every seed', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const rooms = plan.cells.filter((c) => c.kind === 'room').length;
    assert.ok(rooms >= 8 && rooms <= 12, `${seed} produced ${rooms} rooms`);
  }
});

test('no two cells overlap', () => {
  for (const seed of SEEDS) {
    const { cells } = generateFloorplan(seed);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        assert.ok(!overlaps(cells[i], cells[j]),
          `${seed}: cell ${cells[i].id} overlaps ${cells[j].id}`);
      }
    }
  }
});

test('every cell sits inside the footprint', () => {
  for (const seed of SEEDS) {
    const { cells, bounds } = generateFloorplan(seed);
    for (const c of cells) {
      assert.ok(c.x >= bounds.x - 1e-9 && c.z >= bounds.z - 1e-9
        && c.x + c.w <= bounds.x + bounds.w + 1e-9
        && c.z + c.d <= bounds.z + bounds.d + 1e-9,
        `${seed}: cell ${c.id} escapes the footprint`);
    }
  }
});

test('no room is thinner than the minimum side', () => {
  for (const seed of SEEDS) {
    const { cells, config } = generateFloorplan(seed);
    for (const c of cells.filter((x) => x.kind === 'room')) {
      assert.ok(Math.min(c.w, c.d) >= config.minRoomSide - 1e-9,
        `${seed}: room ${c.id} is ${Math.min(c.w, c.d).toFixed(2)}m thin`);
    }
  }
});

test('corridors are produced and are the configured width', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { cells, config } = generateFloorplan(seed);
    const corridors = cells.filter((c) => c.kind === 'corridor');
    assert.ok(corridors.length > 0, `${seed} produced no corridor`);
    for (const c of corridors) {
      assert.ok(Math.abs(Math.min(c.w, c.d) - config.corridorWidth) < 1e-9,
        `${seed}: corridor ${c.id} is ${Math.min(c.w, c.d)}m wide`);
    }
  }
});

test('overrides are honoured', () => {
  const plan = generateFloorplan('override', { width: 20, depth: 20 });
  assert.equal(plan.bounds.w, 20);
  assert.equal(plan.bounds.d, 20);
});

test('defaults are frozen so a caller cannot corrupt later generations', () => {
  assert.throws(() => { FLOORPLAN_DEFAULTS.width = 1; });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../floorplan.js`.

- [ ] **Step 3: Implement the splitter**

Create `raid/floorplan.js`:

```js
// Floor plan generation. Pure data — this module never imports Babylon and never
// touches the DOM, so the properties that decide whether a map is usable
// (determinism, no overlaps, connectivity, room sizes) can be asserted directly
// over hundreds of seeds instead of judged from a screenshot.

import { makeRng } from './rng.js';

export const FLOORPLAN_DEFAULTS = Object.freeze({
  width: 35,
  depth: 35,
  targetRooms: 10,
  minRoomSide: 3.2,
  corridorWidth: 1.8,
  corridorSplits: 2,   // how many of the earliest splits become corridors
  wallThickness: 0.15,
  doorWidth: 1.0,
  doorMargin: 0.6,
  splitJitter: 0.16,   // how far off centre a split may land, as a fraction
});

/**
 * Can this rectangle be split along `axis` leaving both halves usable?
 * A split consumes the corridor band when one is carved, so the test has to
 * account for it — otherwise the splitter produces slivers too thin to hold a
 * door, and the connectivity check fails much later with a confusing symptom.
 */
function canSplit(rect, axis, band, cfg) {
  const span = axis === 'x' ? rect.w : rect.d;
  return span >= cfg.minRoomSide * 2 + band;
}

export function generateFloorplan(seed, overrides = {}) {
  const config = { ...FLOORPLAN_DEFAULTS, ...overrides };
  const rng = makeRng(seed);

  const bounds = { x: -config.width / 2, z: -config.depth / 2, w: config.width, d: config.depth };
  const corridors = [];

  // Leaves are split largest-first until the room target is met. Taking the
  // largest each time keeps rooms comparable in size; splitting at random
  // leaves one cavernous room beside a row of cupboards.
  let leaves = [{ ...bounds }];
  let splits = 0;

  while (leaves.length < config.targetRooms) {
    const band = splits < config.corridorSplits ? config.corridorWidth : 0;

    const candidates = leaves.filter(
      (r) => canSplit(r, 'x', band, config) || canSplit(r, 'z', band, config),
    );
    if (!candidates.length) break;

    candidates.sort((a, b) => b.w * b.d - a.w * a.d);
    const target = candidates[0];

    const canX = canSplit(target, 'x', band, config);
    const canZ = canSplit(target, 'z', band, config);
    // Cut across the longer side so rooms tend towards square.
    const axis = canX && canZ ? (target.w >= target.d ? 'x' : 'z') : (canX ? 'x' : 'z');

    const span = axis === 'x' ? target.w : target.d;
    const origin = axis === 'x' ? target.x : target.z;
    const usable = span - band;
    const lo = config.minRoomSide;
    const hi = usable - config.minRoomSide;
    const mid = usable / 2;
    const jitter = usable * config.splitJitter;
    const cut = Math.min(hi, Math.max(lo, rng.range(mid - jitter, mid + jitter)));

    const first = axis === 'x'
      ? { x: target.x, z: target.z, w: cut, d: target.d }
      : { x: target.x, z: target.z, w: target.w, d: cut };
    const second = axis === 'x'
      ? { x: origin + cut + band, z: target.z, w: usable - cut, d: target.d }
      : { x: target.x, z: origin + cut + band, w: target.w, d: usable - cut };

    if (band > 0) {
      corridors.push(axis === 'x'
        ? { x: origin + cut, z: target.z, w: band, d: target.d }
        : { x: target.x, z: origin + cut, w: target.w, d: band });
    }

    leaves = leaves.filter((r) => r !== target).concat([first, second]);
    splits++;
  }

  const cells = [
    ...leaves.map((r) => ({ ...r, kind: 'room' })),
    ...corridors.map((r) => ({ ...r, kind: 'corridor' })),
  ].map((c, id) => ({ id, ...c }));

  return { seed, config, bounds, cells };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS. If `room count lands in the spec range` fails at the low end, the splitter ran out of splittable leaves — reduce `minRoomSide` or raise `width`/`depth`, and note which in the commit message. Do not widen the assertion to make it pass; the range is a spec requirement.

- [ ] **Step 5: Commit**

```bash
git add raid/floorplan.js raid/tests/floorplan.test.js
git commit -m "feat: BSP floor plan splitter

Splits the footprint largest-leaf-first until the room target is met, which
keeps rooms comparable in size — splitting a random leaf each time leaves
one cavernous room beside a row of cupboards. The earliest splits reserve a
corridor band instead of butting the halves together, which is what makes
the result read as an office with circulation rather than a subdivided box.

Asserted over 200 seeds: room count in the 8-12 spec range, no overlapping
cells, nothing escaping the footprint, and no room thinner than the minimum
side. The thinness check matters more than it looks — a sliver room cannot
hold a door, and that surfaces much later as a confusing connectivity
failure."
```

---

### Task 4: Adjacency, doors and connectivity

**Files:**
- Modify: `raid/floorplan.js`
- Modify: `raid/tests/floorplan.test.js`

**Interfaces:**
- Consumes: `Plan` from Task 3
- Produces: `Plan` additionally carrying
  - `adjacency: { [cellId: number]: number[] }`
  - `doors: Door[]` where `Door = { id: number, a: number, b: number, x: number, z: number, axis: 'x' | 'z', width: number }`
  - `axis` is the direction the **opening runs along**: an `axis: 'x'` door sits in a wall that spans x, so people pass through it moving in z
  - `x`/`z` are the door's **centre**, not a corner — unlike `Rect`

- [ ] **Step 1: Add the failing tests**

Append to `raid/tests/floorplan.test.js`:

```js
test('every cell is reachable from cell 0', () => {
  for (const seed of SEEDS) {
    const { cells, adjacency } = generateFloorplan(seed);
    const seen = new Set([cells[0].id]);
    const queue = [cells[0].id];
    while (queue.length) {
      for (const n of adjacency[queue.pop()] ?? []) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    assert.equal(seen.size, cells.length,
      `${seed}: ${cells.length - seen.size} of ${cells.length} cells unreachable`);
  }
});

test('adjacency is symmetric', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { cells, adjacency } = generateFloorplan(seed);
    for (const c of cells) {
      for (const n of adjacency[c.id]) {
        assert.ok(adjacency[n].includes(c.id), `${seed}: ${c.id}->${n} not mirrored`);
      }
    }
  }
});

test('each door joins two cells that really touch', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { cells, doors } = generateFloorplan(seed);
    const byId = new Map(cells.map((c) => [c.id, c]));
    for (const door of doors) {
      const a = byId.get(door.a);
      const b = byId.get(door.b);
      const touching = door.axis === 'x'
        ? Math.abs((a.z + a.d) - b.z) < 1e-6 || Math.abs((b.z + b.d) - a.z) < 1e-6
        : Math.abs((a.x + a.w) - b.x) < 1e-6 || Math.abs((b.x + b.w) - a.x) < 1e-6;
      assert.ok(touching, `${seed}: door ${door.id} joins cells that do not share an edge`);
    }
  }
});

test('doors keep clear of corners', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { cells, doors, config } = generateFloorplan(seed);
    const byId = new Map(cells.map((c) => [c.id, c]));
    const clearance = config.doorWidth / 2 + config.doorMargin;
    for (const door of doors) {
      for (const cell of [byId.get(door.a), byId.get(door.b)]) {
        if (door.axis === 'x') {
          assert.ok(door.x >= cell.x + clearance - 1e-6 && door.x <= cell.x + cell.w - clearance + 1e-6,
            `${seed}: door ${door.id} is too near a corner of cell ${cell.id}`);
        } else {
          assert.ok(door.z >= cell.z + clearance - 1e-6 && door.z <= cell.z + cell.d - clearance + 1e-6,
            `${seed}: door ${door.id} is too near a corner of cell ${cell.id}`);
        }
      }
    }
  }
});

test('there is exactly one door per adjacent pair', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { doors, adjacency } = generateFloorplan(seed);
    const pairs = new Set(doors.map((d) => `${Math.min(d.a, d.b)}-${Math.max(d.a, d.b)}`));
    assert.equal(pairs.size, doors.length, `${seed}: duplicate door between a pair`);
    const edges = Object.entries(adjacency)
      .flatMap(([a, ns]) => ns.map((b) => `${Math.min(+a, b)}-${Math.max(+a, b)}`));
    assert.equal(new Set(edges).size, doors.length, `${seed}: adjacency and doors disagree`);
  }
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — `adjacency` and `doors` are undefined.

- [ ] **Step 3: Implement adjacency and doors**

Add to `raid/floorplan.js`, above `generateFloorplan`:

```js
/**
 * How far two cells overlap along the shared edge, and where that overlap sits.
 * Returns null when they do not touch, or touch too briefly to fit a door.
 *
 * Adjacency is measured geometrically rather than read off the BSP tree: once a
 * corridor band is carved between two children they are no longer neighbours,
 * and cells on opposite sides of a corridor must not get a door through it.
 */
function sharedEdge(a, b, cfg) {
  const need = cfg.doorWidth + cfg.doorMargin * 2;
  const near = 1e-6;

  const touchZ = Math.abs((a.z + a.d) - b.z) < near || Math.abs((b.z + b.d) - a.z) < near;
  if (touchZ) {
    const lo = Math.max(a.x, b.x);
    const hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo >= need) {
      return { axis: 'x', lo, hi, at: Math.abs((a.z + a.d) - b.z) < near ? a.z + a.d : b.z + b.d };
    }
  }

  const touchX = Math.abs((a.x + a.w) - b.x) < near || Math.abs((b.x + b.w) - a.x) < near;
  if (touchX) {
    const lo = Math.max(a.z, b.z);
    const hi = Math.min(a.z + a.d, b.z + b.d);
    if (hi - lo >= need) {
      return { axis: 'z', lo, hi, at: Math.abs((a.x + a.w) - b.x) < near ? a.x + a.w : b.x + b.w };
    }
  }

  return null;
}
```

Then replace the `return` at the end of `generateFloorplan` with:

```js
  const adjacency = Object.fromEntries(cells.map((c) => [c.id, []]));
  const doors = [];

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const edge = sharedEdge(cells[i], cells[j], config);
      if (!edge) continue;

      adjacency[cells[i].id].push(cells[j].id);
      adjacency[cells[j].id].push(cells[i].id);

      // Centre the door on the shared span, then pull it inside the corner
      // clearance at both ends. `sharedEdge` guarantees the span is wide enough
      // for that to be possible.
      const clearance = config.doorWidth / 2 + config.doorMargin;
      const centre = Math.min(edge.hi - clearance, Math.max(edge.lo + clearance, (edge.lo + edge.hi) / 2));

      doors.push({
        id: doors.length,
        a: cells[i].id,
        b: cells[j].id,
        axis: edge.axis,
        width: config.doorWidth,
        x: edge.axis === 'x' ? centre : edge.at,
        z: edge.axis === 'x' ? edge.at : centre,
      });
    }
  }

  const plan = { seed, config, bounds, cells, adjacency, doors };
  assertConnected(plan);
  return plan;
```

And add the connectivity guard:

```js
/**
 * Every cell must be reachable. BSP tiles the footprint with no gaps, so a
 * disconnected plan means the splitter produced a cell too thin along a shared
 * edge to take a door. That is a bug in the split rules, not an unlucky seed, so
 * it throws rather than quietly regenerating and hiding the cause.
 */
function assertConnected(plan) {
  const seen = new Set([plan.cells[0].id]);
  const queue = [plan.cells[0].id];
  while (queue.length) {
    for (const n of plan.adjacency[queue.pop()]) {
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  if (seen.size !== plan.cells.length) {
    const lost = plan.cells.filter((c) => !seen.has(c.id)).map((c) => c.id);
    throw new Error(`floorplan "${plan.seed}": cells ${lost.join(', ')} unreachable`);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS. A thrown "cells unreachable" error on some seed means `minRoomSide` is too close to `doorWidth + 2 * doorMargin` — a room can be created that is too narrow to take a door on its short edge. Raise `minRoomSide` above `doorWidth + doorMargin * 2` (currently 2.2) and re-run.

- [ ] **Step 5: Commit**

```bash
git add raid/floorplan.js raid/tests/floorplan.test.js
git commit -m "feat: geometric adjacency, doors and a connectivity guard

Adjacency is measured from the rectangles rather than read off the BSP
tree. Once a corridor band is carved between two children they are no
longer neighbours, and a tree-derived door would open through the corridor
into the room beyond it.

Connectivity throws instead of regenerating. BSP tiles the footprint with
no gaps, so an unreachable cell means the splitter made something too thin
along a shared edge to take a door — a rule to fix, not a seed to discard.
Silently retrying would have hidden exactly the bug worth finding.

Verified over 200 seeds: every cell reachable, adjacency symmetric, one
door per adjacent pair, and no door within its clearance of a corner."
```

---

### Task 5: Wall segments

**Files:**
- Modify: `raid/floorplan.js`
- Modify: `raid/tests/floorplan.test.js`

**Interfaces:**
- Consumes: `Plan` from Task 4
- Produces: `Plan` additionally carrying `walls: Wall[]` where `Wall = Rect & { height: number }`; walls are axis-aligned boxes at `y = 0` extending up by `height`

- [ ] **Step 1: Add the failing tests**

Append to `raid/tests/floorplan.test.js`:

```js
test('no wall crosses a door opening', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { walls, doors, config } = generateFloorplan(seed);
    for (const door of doors) {
      const half = config.doorWidth / 2 - 1e-3;
      const box = door.axis === 'x'
        ? { x: door.x - half, z: door.z - 1e-3, w: half * 2, d: 2e-3 }
        : { x: door.x - 1e-3, z: door.z - half, w: 2e-3, d: half * 2 };
      for (const w of walls) {
        const hit = w.x < box.x + box.w && box.x < w.x + w.w
          && w.z < box.z + box.d && box.z < w.z + w.d;
        assert.ok(!hit, `${seed}: wall blocks door ${door.id}`);
      }
    }
  }
});

test('walls are the configured thickness and height', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const { walls, config } = generateFloorplan(seed);
    assert.ok(walls.length > 0, `${seed} produced no walls`);
    for (const w of walls) {
      assert.equal(w.height, config.wallHeight);
      assert.ok(Math.abs(Math.min(w.w, w.d) - config.wallThickness) < 1e-6,
        `${seed}: wall is ${Math.min(w.w, w.d)}m thick`);
    }
  }
});

test('the footprint perimeter is enclosed', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const { walls, bounds } = generateFloorplan(seed);
    const near = 0.05;
    const onEdge = (test) => walls.some(test);
    assert.ok(onEdge((w) => Math.abs(w.z - bounds.z) < near), `${seed}: no north wall`);
    assert.ok(onEdge((w) => Math.abs((w.z + w.d) - (bounds.z + bounds.d)) < near), `${seed}: no south wall`);
    assert.ok(onEdge((w) => Math.abs(w.x - bounds.x) < near), `${seed}: no west wall`);
    assert.ok(onEdge((w) => Math.abs((w.x + w.w) - (bounds.x + bounds.w)) < near), `${seed}: no east wall`);
  }
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — `walls` is undefined and `config.wallHeight` does not exist.

- [ ] **Step 3: Implement**

Add `wallHeight: 2.6` to `FLOORPLAN_DEFAULTS`.

Add above `generateFloorplan`:

```js
/**
 * One cell edge becomes one or more wall segments, broken around any doors on it.
 *
 * Walls are built per edge and deduplicated by position, because two cells share
 * an edge and would otherwise each build the same wall — doubling the geometry
 * and leaving z-fighting along every interior partition.
 */
function buildWalls(cells, doors, cfg) {
  const t = cfg.wallThickness;
  const half = t / 2;
  const segments = [];
  const seen = new Set();

  const push = (x, z, w, d) => {
    const key = `${x.toFixed(3)}:${z.toFixed(3)}:${w.toFixed(3)}:${d.toFixed(3)}`;
    if (seen.has(key)) return;
    seen.add(key);
    segments.push({ x, z, w, d, height: cfg.wallHeight });
  };

  for (const cell of cells) {
    const edges = [
      { axis: 'x', at: cell.z, lo: cell.x, hi: cell.x + cell.w },
      { axis: 'x', at: cell.z + cell.d, lo: cell.x, hi: cell.x + cell.w },
      { axis: 'z', at: cell.x, lo: cell.z, hi: cell.z + cell.d },
      { axis: 'z', at: cell.x + cell.w, lo: cell.z, hi: cell.z + cell.d },
    ];

    for (const edge of edges) {
      // Every door sitting on this exact edge line punches a gap in it.
      const gaps = doors
        .filter((dr) => dr.axis === edge.axis
          && Math.abs((edge.axis === 'x' ? dr.z : dr.x) - edge.at) < 1e-6)
        .map((dr) => {
          const centre = edge.axis === 'x' ? dr.x : dr.z;
          return [centre - dr.width / 2, centre + dr.width / 2];
        })
        .filter(([lo, hi]) => hi > edge.lo && lo < edge.hi)
        .sort((a, b) => a[0] - b[0]);

      let cursor = edge.lo;
      for (const [lo, hi] of gaps) {
        if (lo > cursor) {
          if (edge.axis === 'x') push(cursor, edge.at - half, lo - cursor, t);
          else push(edge.at - half, cursor, t, lo - cursor);
        }
        cursor = Math.max(cursor, hi);
      }
      if (cursor < edge.hi) {
        if (edge.axis === 'x') push(cursor, edge.at - half, edge.hi - cursor, t);
        else push(edge.at - half, cursor, t, edge.hi - cursor);
      }
    }
  }

  return segments;
}
```

Then in `generateFloorplan`, before `assertConnected`:

```js
  const walls = buildWalls(cells, doors, config);
  const plan = { seed, config, bounds, cells, adjacency, doors, walls };
```

(replacing the previous `const plan = ...` line).

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raid/floorplan.js raid/tests/floorplan.test.js
git commit -m "feat: wall segments broken around doors

Each cell edge becomes wall segments split around any door on that line,
so a doorway is a real gap rather than a wall with a door drawn on it.

Segments are deduplicated by position: two cells share an edge and would
otherwise each emit the same wall, doubling the geometry and z-fighting
along every interior partition.

Asserted over 50 seeds that no wall overlaps a door opening, that the
perimeter is closed on all four sides, and that thickness and height match
config."
```

---

### Task 6: Room roles and mission placement

**Files:**
- Create: `raid/roles.js`
- Create: `raid/tests/roles.test.js`

**Interfaces:**
- Consumes: `Plan` from Task 5, `makeRng` from `raid/rng.js`
- Produces:
  - `CAST = Object.freeze({ swat: 4, hostiles: 7, hostage: 1 })`
  - `assignRoles(plan: Plan): Mission`
  - `Mission = { entryId, hostageRoomId, depth: { [cellId]: number }, roles: { [cellId]: Role }, spawns: Spawns }`
  - `Role = 'entry' | 'hostage' | 'guard' | 'filler' | 'corridor'`
  - `Spawns = { swat: Spawn[], hostiles: Spawn[], hostage: Spawn, extraction: { x, z } }`
  - `Spawn = { x: number, z: number, facing: number, cellId: number }` — `facing` is radians about y

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/roles.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles, CAST } from '../roles.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `mission-${i}`);
const inside = (p, cell) =>
  p.x >= cell.x && p.x <= cell.x + cell.w && p.z >= cell.z && p.z <= cell.z + cell.d;

test('the same plan always yields the same mission', () => {
  const plan = generateFloorplan('stable');
  assert.deepEqual(assignRoles(plan), assignRoles(plan));
});

test('the cast is exactly 4 SWAT, 7 hostiles and 1 hostage', () => {
  for (const seed of SEEDS) {
    const { spawns } = assignRoles(generateFloorplan(seed));
    assert.equal(spawns.swat.length, CAST.swat, `${seed}: wrong SWAT count`);
    assert.equal(spawns.hostiles.length, CAST.hostiles, `${seed}: wrong hostile count`);
    assert.ok(spawns.hostage, `${seed}: no hostage`);
  }
});

test('the hostage room is at least 3 doors from the entry', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    assert.ok(m.depth[m.hostageRoomId] >= 3,
      `${seed}: hostage only ${m.depth[m.hostageRoomId]} doors deep`);
  }
});

test('the entry room touches the perimeter', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    const cell = plan.cells.find((c) => c.id === m.entryId);
    const b = plan.bounds;
    const near = 1e-6;
    const onEdge = Math.abs(cell.x - b.x) < near
      || Math.abs(cell.z - b.z) < near
      || Math.abs((cell.x + cell.w) - (b.x + b.w)) < near
      || Math.abs((cell.z + cell.d) - (b.z + b.d)) < near;
    assert.ok(onEdge, `${seed}: entry cell ${cell.id} is not on the perimeter`);
  }
});

test('every spawn sits inside the cell it claims', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const byId = new Map(plan.cells.map((c) => [c.id, c]));
    const { spawns } = assignRoles(plan);
    for (const s of [...spawns.swat, ...spawns.hostiles, spawns.hostage]) {
      assert.ok(inside(s, byId.get(s.cellId)),
        `${seed}: spawn at ${s.x.toFixed(1)},${s.z.toFixed(1)} escapes cell ${s.cellId}`);
    }
  }
});

test('the hostage is in the hostage room and guarded', () => {
  for (const seed of SEEDS) {
    const plan = generateFloorplan(seed);
    const m = assignRoles(plan);
    assert.equal(m.spawns.hostage.cellId, m.hostageRoomId,
      `${seed}: hostage is not in the hostage room`);
    const guards = m.spawns.hostiles.filter((h) => h.cellId === m.hostageRoomId).length;
    assert.ok(guards >= 1, `${seed}: hostage room has no guard`);
  }
});

test('no two spawns land on top of each other', () => {
  for (const seed of SEEDS) {
    const { spawns } = assignRoles(generateFloorplan(seed));
    const all = [...spawns.swat, ...spawns.hostiles, spawns.hostage];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const gap = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
        assert.ok(gap >= 0.55, `${seed}: spawns ${i} and ${j} are ${gap.toFixed(2)}m apart`);
      }
    }
  }
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../roles.js`.

- [ ] **Step 3: Implement**

Create `raid/roles.js`:

```js
// Mission placement: which room is the objective, and where everyone starts.
//
// This is a graph problem, not a geometric one — the hostage belongs as many
// doors from the entry as possible, regardless of how far that is in metres.
// Keeping it out of floorplan.js means the layout algorithm and the mission
// rules can each change without disturbing the other.

import { makeRng } from './rng.js';

export const CAST = Object.freeze({ swat: 4, hostiles: 7, hostage: 1 });

const MIN_HOSTAGE_DEPTH = 3;
const SPAWN_GAP = 0.7;      // metres between figures, comfortably over the 0.55 test floor
const WALL_CLEARANCE = 0.9; // keep figures off the walls

/** Breadth-first door count from `startId` to every reachable cell. */
function doorDepth(plan, startId) {
  const depth = { [startId]: 0 };
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const n of plan.adjacency[current]) {
      if (depth[n] === undefined) {
        depth[n] = depth[current] + 1;
        queue.push(n);
      }
    }
  }
  return depth;
}

const touchesPerimeter = (cell, b) => {
  const near = 1e-6;
  return Math.abs(cell.x - b.x) < near
    || Math.abs(cell.z - b.z) < near
    || Math.abs((cell.x + cell.w) - (b.x + b.w)) < near
    || Math.abs((cell.z + cell.d) - (b.z + b.d)) < near;
};

/**
 * Scatter `count` points inside a cell, no two closer than SPAWN_GAP.
 *
 * Rejection sampling with a bounded attempt count, then a relaxed fallback: a
 * small room genuinely cannot hold seven people at arm's length, and failing to
 * place a figure at all is worse than placing two a little close.
 */
function scatter(cell, count, rng, taken) {
  const points = [];
  const minX = cell.x + WALL_CLEARANCE;
  const maxX = cell.x + cell.w - WALL_CLEARANCE;
  const minZ = cell.z + WALL_CLEARANCE;
  const maxZ = cell.z + cell.d - WALL_CLEARANCE;

  for (let i = 0; i < count; i++) {
    let best = null;
    let bestGap = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = {
        x: maxX > minX ? rng.range(minX, maxX) : cell.x + cell.w / 2,
        z: maxZ > minZ ? rng.range(minZ, maxZ) : cell.z + cell.d / 2,
      };
      const gap = [...taken, ...points].reduce(
        (m, q) => Math.min(m, Math.hypot(p.x - q.x, p.z - q.z)), Infinity);
      if (gap >= SPAWN_GAP) { best = p; break; }
      if (gap > bestGap) { bestGap = gap; best = p; }
    }
    points.push(best);
  }
  return points;
}

export function assignRoles(plan) {
  // Seeded from the plan so a given map always yields the same mission, and so
  // this never consumes the floorplan's own RNG stream.
  const rng = makeRng(`${plan.seed}:mission`);
  const rooms = plan.cells.filter((c) => c.kind === 'room');

  // Entry: a perimeter room, preferring smaller ones — a lobby, not the
  // ballroom. Ties broken by id so the choice is deterministic.
  const perimeter = rooms
    .filter((c) => touchesPerimeter(c, plan.bounds))
    .sort((a, b) => (a.w * a.d) - (b.w * b.d) || a.id - b.id);
  const entry = perimeter[0] ?? rooms[0];

  const depth = doorDepth(plan, entry.id);

  // Hostage: deepest room by door count, ties broken by id.
  const hostageRoom = rooms
    .filter((c) => c.id !== entry.id)
    .sort((a, b) => (depth[b.id] ?? -1) - (depth[a.id] ?? -1) || a.id - b.id)[0];

  if ((depth[hostageRoom.id] ?? 0) < MIN_HOSTAGE_DEPTH) {
    throw new Error(
      `floorplan "${plan.seed}": deepest room is only ${depth[hostageRoom.id]} doors from entry, `
      + `need ${MIN_HOSTAGE_DEPTH} — the splitter is producing too shallow a plan`);
  }

  const roles = {};
  for (const c of plan.cells) roles[c.id] = c.kind === 'corridor' ? 'corridor' : 'filler';
  roles[entry.id] = 'entry';
  roles[hostageRoom.id] = 'hostage';

  const taken = [];

  // SWAT stack up in the entry room, facing into the building.
  const swatPoints = scatter(entry, CAST.swat, rng, taken);
  taken.push(...swatPoints);
  const inwardFrom = (p) => Math.atan2(-p.x, -p.z); // face the footprint centre
  const swat = swatPoints.map((p) => ({ ...p, facing: inwardFrom(p), cellId: entry.id }));

  // The hostage sits in the middle of the objective room.
  const hostagePoint = { x: hostageRoom.x + hostageRoom.w / 2, z: hostageRoom.z + hostageRoom.d / 2 };
  taken.push(hostagePoint);
  const hostage = { ...hostagePoint, facing: rng.range(0, Math.PI * 2), cellId: hostageRoom.id };

  // Hostiles: two guarding the hostage, the rest spread over the deeper rooms so
  // the squad meets resistance on the way in rather than all at the objective.
  const guardable = rooms
    .filter((c) => c.id !== entry.id)
    .sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0) || a.id - b.id);

  const assignments = [hostageRoom, hostageRoom];
  let cursor = 0;
  while (assignments.length < CAST.hostiles) {
    assignments.push(guardable[cursor % guardable.length]);
    cursor++;
  }

  const hostiles = [];
  for (const cell of assignments) {
    const [p] = scatter(cell, 1, rng, taken);
    taken.push(p);
    hostiles.push({ ...p, facing: rng.range(0, Math.PI * 2), cellId: cell.id });
    if (roles[cell.id] === 'filler') roles[cell.id] = 'guard';
  }

  const extraction = { x: entry.x + entry.w / 2, z: entry.z + entry.d / 2 };

  return {
    entryId: entry.id,
    hostageRoomId: hostageRoom.id,
    depth,
    roles,
    spawns: { swat, hostiles, hostage, extraction },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

If the "at least 3 doors" assertion throws for some seed, the plan is too shallow — raise `targetRooms` or lower `corridorSplits` so the graph is less star-shaped, and record which in the commit. Do not lower `MIN_HOSTAGE_DEPTH`; it is a spec requirement.

- [ ] **Step 5: Commit**

```bash
git add raid/roles.js raid/tests/roles.test.js
git commit -m "feat: room roles and mission placement

Chooses the entry and hostage rooms and places the cast. Depth is measured
in doors rather than metres, because what makes a hostage room defensible
is how many rooms must be cleared to reach it, not how far away it is.

Entry prefers a small perimeter room — a lobby rather than a ballroom — and
hostiles are weighted toward the deeper rooms so the squad meets resistance
on the way in instead of all at once at the objective.

Spawn scattering falls back to a relaxed spacing after bounded rejection
sampling: a small room genuinely cannot hold seven figures at arm's length,
and placing two a little close beats failing to place one at all.

Asserted over 200 seeds: exact cast counts, hostage at least 3 doors deep,
entry on the perimeter, every spawn inside its own cell, and no two figures
closer than 0.55m."
```

---

### Task 7: Page shell, stage and HUD

**Files:**
- Create: `raid/index.html`
- Create: `raid/stage.js`
- Create: `raid/main.js`

**Interfaces:**
- Consumes: `generateFloorplan`, `assignRoles`
- Produces:
  - `createStage({ scene, engine, canvas }): { camera, shadows, frameOn(bounds) }`
  - `frameOn(bounds: Rect)` points the camera at a footprint and pulls back to fit it
  - `window.__raid = { scene, engine, stage, plan, mission, regenerate(seed?) }` when `?debug` is present

- [ ] **Step 1: Create the page shell**

Create `raid/index.html`. Copy the two `<script src>` tags **verbatim** from `soldier/index.html`, including their `integrity` and `crossorigin` attributes.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raid — procedural CQB map</title>
<meta name="description" content="Seeded procedural office floor plans for a hostage-rescue scenario, in Babylon.js.">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #191d24;
    font-family: "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif; }
  #view { width: 100%; height: 100%; display: block; outline: none; touch-action: none; }

  #hud { position: fixed; left: 0; right: 0; bottom: 0; padding: 14px 18px 16px; pointer-events: none; }
  #controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; pointer-events: auto; }
  #controls label { font: 600 11px/1 inherit; letter-spacing: .08em;
    text-transform: uppercase; color: #7c8593; }
  #seed { background: rgba(255,255,255,.06); color: #dfe5ec;
    border: 1px solid rgba(255,255,255,.12); border-radius: 4px;
    padding: 6px 9px; font: 500 12px/1 ui-monospace, Menlo, monospace; width: 150px; }
  #rooms { width: 120px; }
  button { cursor: pointer; background: rgba(255,255,255,.06); color: #b8c0cc;
    border: 1px solid rgba(255,255,255,.12); border-radius: 4px;
    padding: 7px 13px; font: 600 11px/1 inherit; letter-spacing: .09em; text-transform: uppercase; }
  button:hover { background: rgba(255,255,255,.13); color: #eef2f7; }

  #legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px;
    font: 500 11px/1 inherit; letter-spacing: .06em; color: #7c8593; }
  #legend span { display: flex; align-items: center; gap: 6px; }
  #legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  #meta { margin-top: 8px; font: 500 11px/1.5 inherit; letter-spacing: .1em;
    text-transform: uppercase; color: #6d7581; }
</style>
</head>
<body>
<canvas id="view" touch-action="none"></canvas>
<div id="hud">
  <div id="controls">
    <label for="seed">Seed</label>
    <input id="seed" value="alpha" spellcheck="false">
    <label for="rooms">Rooms <span id="roomsValue">10</span></label>
    <input id="rooms" type="range" min="8" max="12" step="1" value="10">
    <button id="regenerate">Regenerate</button>
    <button id="shuffle">Random seed</button>
  </div>
  <div id="legend">
    <span><i style="background:#4d7ea8"></i>SWAT</span>
    <span><i style="background:#b4453c"></i>Hostile</span>
    <span><i style="background:#d59b3c"></i>Hostage</span>
    <span><i style="background:#5c9455"></i>Extraction</span>
  </div>
  <div id="meta">drag to orbit, scroll to zoom · <span id="stats">generating…</span></div>
</div>

<script
  src="https://cdn.jsdelivr.net/npm/babylonjs@9.18.1/babylon.js"
  integrity="sha384-PHVMLQIlVKtLXOC0vSJTdGPLWru+b8vwe3YKDjM39sdPGcM7RPIdRh39jYC2zkGY"
  crossorigin="anonymous"
  referrerpolicy="no-referrer"></script>
<script
  src="https://cdn.jsdelivr.net/npm/babylonjs-loaders@9.18.1/babylonjs.loaders.min.js"
  integrity="sha384-GSL/0d8hiK3bjSwbNqgp6VOVwgKRlhm0l6pXNOdFkPjS5YrRhHHy/03bN8DbJ9bq"
  crossorigin="anonymous"
  referrerpolicy="no-referrer"></script>
<script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the stage**

Create `raid/stage.js`:

```js
// Camera and lighting for the raid view.
//
// The building is drawn without a ceiling and viewed from 45 degrees: high
// enough that every room reads at once, shallow enough that walls still give the
// interior a sense of depth. Orbiting is allowed but the default pitch is fixed
// at 45 because that is the angle the layout is tuned to read at.

const PITCH_45 = Math.PI / 4;

export function createStage({ scene, engine, canvas }) {
  scene.clearColor = BABYLON.Color4.FromHexString('#191d24ff');

  const camera = new BABYLON.ArcRotateCamera(
    'raidCam', -Math.PI / 2, PITCH_45, 60, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerBetaLimit = 0.15;
  camera.upperBetaLimit = Math.PI / 2 - 0.02; // never below the floor plane
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 140;
  camera.wheelDeltaPercentage = 0.02;
  camera.panningSensibility = 60;

  const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.55, -1, 0.4), scene);
  key.position = new BABYLON.Vector3(30, 60, -25);
  key.intensity = 1.15;

  const fill = new BABYLON.HemisphericLight('fill', new BABYLON.Vector3(0, 1, 0), scene);
  fill.intensity = 0.55;
  fill.diffuse = BABYLON.Color3.FromHexString('#9fb0c4');
  fill.groundColor = BABYLON.Color3.FromHexString('#2b3038');

  const shadows = new BABYLON.ShadowGenerator(2048, key);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.008;

  /** Point at a footprint and pull back far enough to hold it all in frame. */
  const frameOn = (bounds) => {
    const centre = new BABYLON.Vector3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
    camera.setTarget(centre);
    const span = Math.max(bounds.w, bounds.d);
    const fov = camera.fov || 0.8;
    // Trigonometric fit with headroom, so a bigger footprint is not clipped.
    camera.radius = (span / 2) / Math.tan(fov / 2) * 1.15;
    camera.beta = PITCH_45;
    key.position = new BABYLON.Vector3(centre.x + span * 0.6, span * 1.6, centre.z - span * 0.5);
  };

  return { camera, shadows, frameOn };
}
```

- [ ] **Step 3: Create main.js with generation wired to the HUD**

Create `raid/main.js`:

```js
import { createStage } from './stage.js';
import { generateFloorplan } from './floorplan.js';
import { assignRoles } from './roles.js';

const canvas = document.getElementById('view');
const engine = new BABYLON.Engine(canvas, true, { antialias: true, stencil: false });
const scene = new BABYLON.Scene(engine);
const stage = createStage({ scene, engine, canvas });

const params = new URLSearchParams(location.search);
const seedInput = document.getElementById('seed');
const roomsInput = document.getElementById('rooms');
const roomsValue = document.getElementById('roomsValue');
const statsEl = document.getElementById('stats');

if (params.get('seed')) seedInput.value = params.get('seed');

let plan = null;
let mission = null;

function regenerate(seed = seedInput.value) {
  seedInput.value = seed;
  const targetRooms = Number(roomsInput.value);

  const started = performance.now();
  plan = generateFloorplan(seed, { targetRooms });
  mission = assignRoles(plan);
  const elapsed = performance.now() - started;

  stage.frameOn(plan.bounds);

  const rooms = plan.cells.filter((c) => c.kind === 'room').length;
  statsEl.textContent =
    `${rooms} rooms · ${plan.doors.length} doors · hostage ${mission.depth[mission.hostageRoomId]} deep · ${elapsed.toFixed(1)}ms`;

  if (params.has('debug')) window.__raid = { scene, engine, stage, plan, mission, regenerate };
}

document.getElementById('regenerate').addEventListener('click', () => regenerate());
document.getElementById('shuffle').addEventListener('click', () => {
  regenerate(Math.random().toString(36).slice(2, 8));
});
roomsInput.addEventListener('input', () => {
  roomsValue.textContent = roomsInput.value;
  regenerate();
});
seedInput.addEventListener('change', () => regenerate());

regenerate();

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
```

Note: the `Math.random()` in the shuffle button is fine — it picks a *seed*, it is not used during generation. Generation itself must stay seeded.

- [ ] **Step 4: Verify in the browser**

Serve the repo root and open `http://localhost:8080/raid/?debug`.

Expected: an empty dark scene (no geometry yet — that is Task 8) with the HUD showing something like `10 rooms · 14 doors · hostage 4 deep · 0.4ms`. Console must be free of errors.

Check in the console:

```js
__raid.plan.cells.length      // > 10
__raid.mission.spawns.swat.length  // 4
__raid.stage.camera.beta      // ~0.785 (45 degrees)
```

- [ ] **Step 5: Commit**

```bash
git add raid/index.html raid/stage.js raid/main.js
git commit -m "feat: raid page shell, 45 degree stage and HUD

Generates a plan and mission on load and on every HUD change, with no
geometry yet. The stats line reports room and door counts, hostage depth
and generation time, so the generator can be exercised before anything is
drawn.

Camera defaults to a 45 degree pitch and is clamped above the floor plane;
frameOn fits the footprint trigonometrically so a larger plan is not
clipped. Orbit is allowed but the default angle is fixed, because that is
the angle the layout is tuned to read at.

The shuffle button uses Math.random to pick a seed string, which is not a
generation call — generation itself stays fully seeded."
```

---

### Task 8: Build floors, walls, doors and markers

**Files:**
- Create: `raid/build.js`
- Modify: `raid/main.js`

**Interfaces:**
- Consumes: `Plan`, `Mission`
- Produces: `buildLevel(scene, plan, mission, shadows): { dispose(): void, meshes: BABYLON.Mesh[] }`

- [ ] **Step 1: Implement the builder**

Create `raid/build.js`:

```js
// Turns plan data into meshes. This is the only module that knows what a mesh is;
// everything upstream is plain data, which is what lets the generator be tested
// without a renderer.

const ROLE_TINT = {
  entry: '#3f4a55',
  hostage: '#4a4038',
  guard: '#383f47',
  filler: '#343a42',
  corridor: '#2c3138',
};

const MARKER_TINT = {
  swat: '#4d7ea8',
  hostile: '#b4453c',
  hostage: '#d59b3c',
  extraction: '#5c9455',
};

function flat(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

export function buildLevel(scene, plan, mission, shadows) {
  const created = [];
  const materials = [];

  // Floors, one merged mesh per role so the objective room reads by tint alone
  // without a label, while keeping the draw call count down.
  const byRole = new Map();
  for (const cell of plan.cells) {
    const role = mission.roles[cell.id] ?? 'filler';
    const tile = BABYLON.MeshBuilder.CreateBox(`floor_${cell.id}`,
      { width: cell.w, depth: cell.d, height: 0.08 }, scene);
    tile.position.set(cell.x + cell.w / 2, -0.04, cell.z + cell.d / 2);
    tile.receiveShadows = true;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(tile);
  }

  for (const [role, tiles] of byRole) {
    const merged = BABYLON.Mesh.MergeMeshes(tiles, true, true, undefined, false, false);
    merged.name = `floors_${role}`;
    const mat = flat(scene, `floorMat_${role}`, ROLE_TINT[role] ?? ROLE_TINT.filler);
    merged.material = mat;
    merged.receiveShadows = true;
    materials.push(mat);
    created.push(merged);
  }

  // Walls, all one mesh. There are typically 60-plus segments and they share a
  // material, so merging turns the whole building into a single draw call.
  const wallBoxes = plan.walls.map((w, i) => {
    const box = BABYLON.MeshBuilder.CreateBox(`wall_${i}`,
      { width: w.w, depth: w.d, height: w.height }, scene);
    box.position.set(w.x + w.w / 2, w.height / 2, w.z + w.d / 2);
    return box;
  });
  if (wallBoxes.length) {
    const walls = BABYLON.Mesh.MergeMeshes(wallBoxes, true, true, undefined, false, false);
    walls.name = 'walls';
    const mat = flat(scene, 'wallMat', '#6b7078');
    walls.material = mat;
    walls.receiveShadows = true;
    shadows?.addShadowCaster(walls);
    materials.push(mat);
    created.push(walls);
  }

  // Door frames: a lintel over each opening, so a doorway reads as a doorway
  // rather than as a hole where the wall forgot to be.
  const frames = plan.doors.map((door, i) => {
    const t = plan.config.wallThickness;
    const lintel = BABYLON.MeshBuilder.CreateBox(`door_${i}`, {
      width: door.axis === 'x' ? door.width : t,
      depth: door.axis === 'x' ? t : door.width,
      height: 0.35,
    }, scene);
    lintel.position.set(door.x, plan.config.wallHeight - 0.175, door.z);
    return lintel;
  });
  if (frames.length) {
    const merged = BABYLON.Mesh.MergeMeshes(frames, true, true, undefined, false, false);
    merged.name = 'doorFrames';
    const mat = flat(scene, 'doorMat', '#575c64');
    merged.material = mat;
    materials.push(mat);
    created.push(merged);
  }

  // Spawn markers: a disc under each figure, plus the extraction point.
  const discs = [];
  const addDisc = (p, kind, radius) => {
    const disc = BABYLON.MeshBuilder.CreateCylinder(`marker_${kind}_${discs.length}`,
      { diameter: radius * 2, height: 0.02, tessellation: 18 }, scene);
    disc.position.set(p.x, 0.012, p.z);
    disc.material = flat(scene, `markerMat_${kind}_${discs.length}`, MARKER_TINT[kind]);
    materials.push(disc.material);
    discs.push(disc);
    created.push(disc);
  };

  for (const s of mission.spawns.swat) addDisc(s, 'swat', 0.42);
  for (const s of mission.spawns.hostiles) addDisc(s, 'hostile', 0.42);
  addDisc(mission.spawns.hostage, 'hostage', 0.5);
  addDisc(mission.spawns.extraction, 'extraction', 0.9);

  return {
    meshes: created,
    dispose() {
      for (const m of created) m.dispose(false, false);
      for (const m of materials) m.dispose();
    },
  };
}
```

- [ ] **Step 2: Wire it into main.js**

In `raid/main.js`, add the import:

```js
import { buildLevel } from './build.js';
```

Add a module-level handle beside `plan` and `mission`:

```js
let level = null;
```

Inside `regenerate`, after `mission = assignRoles(plan);` and before `stage.frameOn(...)`:

```js
  // Tear the previous build down first. Rebuilding over the top leaks a whole
  // level's meshes and materials on every click of Regenerate.
  level?.dispose();
  level = buildLevel(scene, plan, mission, stage.shadows);
```

- [ ] **Step 3: Verify in the browser**

Open `http://localhost:8080/raid/?debug`. A roofless building should be visible at 45°, with tinted floors, walls broken by doorways, and coloured discs.

Check the draw-call budget and that regenerating does not leak:

```js
__raid.scene.getActiveMeshes().length     // should be well under 20
const before = __raid.scene.meshes.length;
__raid.regenerate('leak-check');
__raid.scene.meshes.length === before      // true — no growth across rebuilds
```

Regenerate several times with different seeds and confirm the plan visibly changes and no errors appear.

- [ ] **Step 4: Commit**

```bash
git add raid/build.js raid/main.js
git commit -m "feat: build floors, walls, doorways and spawn markers

Floors merge per role so the objective room reads by tint alone without a
label; walls merge into a single mesh, since there are typically 60-plus
segments sharing one material and merging turns the whole building into one
draw call. Door openings get a lintel so a doorway reads as a doorway
rather than as a hole where the wall forgot to be.

Rebuilds dispose the previous level first — without that, every click of
Regenerate leaks an entire level's meshes and materials."
```

---

### Task 9: Cover props

**Files:**
- Create: `raid/furnish.js`
- Create: `raid/props.js`
- Create: `raid/tests/furnish.test.js`
- Modify: `raid/main.js`

**Interfaces:**
- Consumes: `Plan`, `Mission`
- Produces:
  - `layoutProps(plan: Plan, mission: Mission): Placement[]` (pure, in `furnish.js`)
  - `Placement = { kind: 'desk' | 'cabinet' | 'crate' | 'pillar', x: number, z: number, rotation: number, w: number, d: number, cellId: number }`
  - `buildProps(scene, placements, shadows): { dispose(): void }` (Babylon, in `props.js`)

- [ ] **Step 1: Write the failing tests**

Create `raid/tests/furnish.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `props-${i}`);

const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return { plan, mission, props: layoutProps(plan, mission) };
};

test('placement is deterministic', () => {
  assert.deepEqual(build('same').props, build('same').props);
});

test('every prop stays inside its cell', () => {
  for (const seed of SEEDS) {
    const { plan, props } = build(seed);
    const byId = new Map(plan.cells.map((c) => [c.id, c]));
    for (const p of props) {
      const cell = byId.get(p.cellId);
      assert.ok(p.x - p.w / 2 >= cell.x - 1e-6 && p.x + p.w / 2 <= cell.x + cell.w + 1e-6
        && p.z - p.d / 2 >= cell.z - 1e-6 && p.z + p.d / 2 <= cell.z + cell.d + 1e-6,
        `${seed}: prop in cell ${p.cellId} pokes through a wall`);
    }
  }
});

test('no prop blocks a doorway', () => {
  for (const seed of SEEDS) {
    const { plan, props } = build(seed);
    for (const door of plan.doors) {
      for (const p of props) {
        const gap = Math.hypot(p.x - door.x, p.z - door.z);
        assert.ok(gap >= 1.2, `${seed}: prop sits ${gap.toFixed(2)}m from door ${door.id}`);
      }
    }
  }
});

test('props do not overlap each other', () => {
  for (const seed of SEEDS) {
    const { props } = build(seed);
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i];
        const b = props[j];
        const hit = Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;
        assert.ok(!hit, `${seed}: props ${i} and ${j} overlap`);
      }
    }
  }
});

test('no prop lands on a spawn point', () => {
  for (const seed of SEEDS) {
    const { mission, props } = build(seed);
    const figures = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
    for (const f of figures) {
      for (const p of props) {
        const hit = Math.abs(f.x - p.x) * 2 < p.w + 0.6 && Math.abs(f.z - p.z) * 2 < p.d + 0.6;
        assert.ok(!hit, `${seed}: a prop is on top of a figure`);
      }
    }
  }
});

test('rooms actually get furnished', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { props } = build(seed);
    assert.ok(props.length >= 6, `${seed}: only ${props.length} props placed`);
  }
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test`
Expected: FAIL — cannot find module `../furnish.js`.

- [ ] **Step 3: Implement the placement**

Create `raid/furnish.js`:

```js
// Where the cover goes. Pure data, so "does a desk block a doorway" is an
// assertion rather than something spotted in a screenshot after the fact.

import { makeRng } from './rng.js';

const CATALOGUE = {
  desk:    { w: 1.6, d: 0.8 },
  cabinet: { w: 1.0, d: 0.5 },
  crate:   { w: 0.9, d: 0.9 },
  pillar:  { w: 0.6, d: 0.6 },
};

const DOOR_CLEARANCE = 1.35;  // keeps props off doorways, over the 1.2 test floor
const FIGURE_CLEARANCE = 0.8; // keeps props off spawned figures
const WALL_CLEARANCE = 0.35;

const BY_ROLE = {
  entry:    ['cabinet', 'pillar'],
  hostage:  ['desk', 'crate', 'cabinet'],
  guard:    ['desk', 'cabinet', 'crate'],
  filler:   ['desk', 'cabinet', 'crate', 'pillar'],
  corridor: ['cabinet'],
};

const TARGET_PER_ROLE = { entry: 2, hostage: 3, guard: 3, filler: 3, corridor: 1 };

export function layoutProps(plan, mission) {
  const rng = makeRng(`${plan.seed}:props`);
  const figures = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
  const placed = [];

  for (const cell of plan.cells) {
    const role = mission.roles[cell.id] ?? 'filler';
    const kinds = BY_ROLE[role] ?? BY_ROLE.filler;
    const want = TARGET_PER_ROLE[role] ?? 2;

    for (let i = 0; i < want; i++) {
      const kind = rng.pick(kinds);
      const size = CATALOGUE[kind];
      // Half the time a rectangular prop is turned to lie along the other axis.
      const turned = rng.next() < 0.5;
      const w = turned ? size.d : size.w;
      const d = turned ? size.w : size.d;

      const minX = cell.x + WALL_CLEARANCE + w / 2;
      const maxX = cell.x + cell.w - WALL_CLEARANCE - w / 2;
      const minZ = cell.z + WALL_CLEARANCE + d / 2;
      const maxZ = cell.z + cell.d - WALL_CLEARANCE - d / 2;
      if (maxX <= minX || maxZ <= minZ) continue; // cell too small for this prop

      // Rejection sampling. A prop that cannot find a clear spot is simply not
      // placed — an empty corner is fine, a desk across a doorway is not.
      for (let attempt = 0; attempt < 24; attempt++) {
        const x = rng.range(minX, maxX);
        const z = rng.range(minZ, maxZ);

        const nearDoor = plan.doors.some(
          (dr) => Math.hypot(x - dr.x, z - dr.z) < DOOR_CLEARANCE);
        if (nearDoor) continue;

        const onFigure = figures.some(
          (f) => Math.abs(f.x - x) * 2 < w + FIGURE_CLEARANCE
              && Math.abs(f.z - z) * 2 < d + FIGURE_CLEARANCE);
        if (onFigure) continue;

        const onProp = placed.some(
          (p) => Math.abs(p.x - x) * 2 < p.w + w && Math.abs(p.z - z) * 2 < p.d + d);
        if (onProp) continue;

        placed.push({ kind, x, z, w, d, rotation: turned ? Math.PI / 2 : 0, cellId: cell.id });
        break;
      }
    }
  }

  return placed;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Implement the prop meshes**

Create `raid/props.js`:

```js
// Cover prop meshes. Built from primitives in the same flat-shaded style as the
// soldier page's melee items, since the character pack ships no props at all.

function flat(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

const HEIGHT = { desk: 0.75, cabinet: 1.35, crate: 0.85, pillar: 2.6 };
const TINT = { desk: '#7d6242', cabinet: '#5a626b', crate: '#8a6a3f', pillar: '#6b7078' };

export function buildProps(scene, placements, shadows) {
  const created = [];
  const materials = [];
  const byKind = new Map();

  for (const p of placements) {
    const box = BABYLON.MeshBuilder.CreateBox(`prop_${p.kind}_${created.length}`,
      { width: p.w, depth: p.d, height: HEIGHT[p.kind] }, scene);
    box.position.set(p.x, HEIGHT[p.kind] / 2, p.z);
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(box);
  }

  // Merge per kind: props share a material within a kind, so one draw call each
  // rather than one per desk.
  for (const [kind, boxes] of byKind) {
    const merged = BABYLON.Mesh.MergeMeshes(boxes, true, true, undefined, false, false);
    merged.name = `props_${kind}`;
    const mat = flat(scene, `propMat_${kind}`, TINT[kind]);
    merged.material = mat;
    merged.receiveShadows = true;
    shadows?.addShadowCaster(merged);
    materials.push(mat);
    created.push(merged);
  }

  return {
    dispose() {
      for (const m of created) m.dispose(false, false);
      for (const m of materials) m.dispose();
    },
  };
}
```

- [ ] **Step 6: Wire into main.js**

Add imports:

```js
import { layoutProps } from './furnish.js';
import { buildProps } from './props.js';
```

Add a handle beside `level`:

```js
let props = null;
```

In `regenerate`, after the `level = buildLevel(...)` line:

```js
  props?.dispose();
  props = buildProps(scene, layoutProps(plan, mission), stage.shadows);
```

- [ ] **Step 7: Verify in the browser**

Open `http://localhost:8080/raid/?debug`. Rooms should now contain desks, cabinets, crates and pillars, none of them across a doorway. Regenerate a few times.

- [ ] **Step 8: Commit**

```bash
git add raid/furnish.js raid/props.js raid/tests/furnish.test.js raid/main.js
git commit -m "feat: cover props placed clear of doors, figures and each other

Placement is pure data in furnish.js, so 'does a desk block a doorway' is
an assertion over 200 seeds rather than something noticed in a screenshot
later. A prop that cannot find a clear spot after bounded rejection
sampling is simply not placed — an empty corner is fine, a desk across a
doorway is not.

Meshes merge per kind so a roomful of desks costs one draw call rather than
one each."
```

---

### Task 10: The cast

**Files:**
- Create: `raid/cast.js`
- Modify: `raid/main.js`

**Interfaces:**
- Consumes: `Mission`, character GLBs at `../assets/quaternius/`
- Produces: `populate(scene, mission, shadows): Promise<{ dispose(): void, figures: Figure[] }>` where `Figure = { root: BABYLON.TransformNode, skeleton: BABYLON.Skeleton, role: 'swat' | 'hostile' | 'hostage' }`

- [ ] **Step 1: Implement the loader**

Create `raid/cast.js`:

```js
// Loading and placing the twelve figures.
//
// The whole Quaternius pack shares one skeleton — 62 bones, identical names in
// identical order — so a model imported once can be cloned onto fresh skeletons
// for every other figure of that type. Importing twelve GLBs separately would
// download the same few megabytes over and over.

const ASSET_DIR = '../assets/quaternius/';

const MODEL = {
  swat: 'Swat.glb',
  hostile: 'Punk.glb',
  hostage: 'Casual.glb',
};

/** Import one model and keep it as a hidden template to clone from. */
async function loadTemplate(scene, file) {
  const loaded = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, file, scene);

  // Stop the clips the loader auto-starts, and keep only Idle. Twelve figures
  // each carrying 25 animation groups is 300 groups the scene does not need.
  for (const g of loaded.animationGroups) g.stop();

  const root = loaded.meshes.find((m) => m.name === '__root__') ?? loaded.meshes[0];
  root.setEnabled(false);
  return { loaded, root };
}

function place(template, spawn, name, scene) {
  const clone = template.root.clone(name, null);
  clone.setEnabled(true);
  clone.position.set(spawn.x, 0, spawn.z);
  clone.rotation = new BABYLON.Vector3(0, spawn.facing ?? 0, 0);
  return clone;
}

export async function populate(scene, mission, shadows) {
  const templates = {};
  for (const [role, file] of Object.entries(MODEL)) {
    templates[role] = await loadTemplate(scene, file);
  }

  const figures = [];
  const add = (role, spawn, i) => {
    const root = place(templates[role], spawn, `${role}_${i}`, scene);
    for (const m of root.getChildMeshes()) {
      if (m.getTotalVertices() > 0) {
        m.receiveShadows = true;
        shadows?.addShadowCaster(m);
      }
    }
    figures.push({ root, role });
  };

  mission.spawns.swat.forEach((s, i) => add('swat', s, i));
  mission.spawns.hostiles.forEach((s, i) => add('hostile', s, i));
  add('hostage', mission.spawns.hostage, 0);

  return {
    figures,
    dispose() {
      for (const f of figures) f.root.dispose(false, true);
      for (const t of Object.values(templates)) {
        for (const g of t.loaded.animationGroups) g.dispose();
        for (const m of t.loaded.meshes) m.dispose(false, true);
        for (const s of t.loaded.skeletons) s.dispose();
      }
    },
  };
}
```

- [ ] **Step 2: Wire into main.js**

Add the import:

```js
import { populate } from './cast.js';
```

Add a handle:

```js
let cast = null;
```

Because loading is async while `regenerate` is synchronous, add a separate function below `regenerate` and call it at the end of `regenerate`:

```js
// A generation counter, not a boolean: clicking Regenerate twice quickly must
// not leave the first load's figures standing on the second load's map.
let castToken = 0;

async function repopulate() {
  const token = ++castToken;
  const previous = cast;
  cast = null;
  const next = await populate(scene, mission, stage.shadows);
  if (token !== castToken) { next.dispose(); return; }
  previous?.dispose();
  cast = next;
}
```

Call `repopulate();` as the last line of `regenerate()`, and add `cast` to the `window.__raid` debug object.

- [ ] **Step 3: Verify in the browser**

Open `http://localhost:8080/raid/?debug`. Four SWAT should stand in the entry room, seven hostiles spread through the building, and one civilian in the objective room, each on its coloured disc.

Check placement and that repeated regeneration does not accumulate figures:

```js
__raid.cast.figures.length     // 12
const before = __raid.scene.meshes.length;
__raid.regenerate('cast-leak');
await new Promise(r => setTimeout(r, 2500));
__raid.scene.meshes.length === before   // true
```

- [ ] **Step 4: Commit**

```bash
git add raid/cast.js raid/main.js
git commit -m "feat: place the twelve figures on the map

Loads one model per role and clones it, rather than importing twelve GLBs
and downloading the same few megabytes repeatedly — the pack shares one
skeleton, so cloning is safe.

Repopulation is guarded by a generation counter rather than a boolean:
clicking Regenerate twice in quick succession would otherwise leave the
first load's figures standing on the second load's map."
```

---

### Task 11: The seated hostage

**Files:**
- Create: `raid/seated.js`
- Modify: `raid/cast.js`

**Interfaces:**
- Consumes: a loaded hostage figure and its skeleton
- Produces:
  - `seatFigure(root: BABYLON.TransformNode, skeleton: BABYLON.Skeleton): SeatMetrics`
  - `SeatMetrics = { seatHeight: number, seatDepth: number, hipY: number, footY: number }`
  - `buildChair(scene, metrics: SeatMetrics, spawn): { dispose(): void }`

- [ ] **Step 1: Implement the pose**

The pack has no seated clip, so the pose is set directly on the bones. Create `raid/seated.js`:

```js
// The seated hostage.
//
// The pack ships 25 clips and none of them is seated, and it contains no props
// at all — so both the pose and the chair are built here.
//
// The pose is authored first and the chair is then sized to it. Sizing the chair
// independently and trying to make the figure meet it is the same trap as
// seating a weapon in a fist: it creates a fixed contact point that has to be
// hit exactly. Measuring the posed figure instead leaves the geometry free to
// move to wherever the pose actually ended up.

const DEG = Math.PI / 180;

// Rotations applied to the base pose, in the bone's own space.
const POSE = {
  'UpperLeg.L': [-88, 0, 0],
  'UpperLeg.R': [-88, 0, 0],
  'LowerLeg.L': [82, 0, 0],
  'LowerLeg.R': [82, 0, 0],
  'Foot.L': [8, 0, 0],
  'Foot.R': [8, 0, 0],
  'UpperArm.L': [12, 0, -22],
  'UpperArm.R': [12, 0, 22],
  'LowerArm.L': [-38, 0, 0],
  'LowerArm.R': [-38, 0, 0],
  'Torso': [6, 0, 0],
};

export function seatFigure(root, skeleton) {
  for (const [name, [x, y, z]] of Object.entries(POSE)) {
    const bone = skeleton.bones.find((b) => b.name === name);
    if (!bone) continue;
    const turn = BABYLON.Quaternion.FromEulerAngles(x * DEG, y * DEG, z * DEG);
    const current = bone.rotationQuaternion
      ?? BABYLON.Quaternion.FromEulerVector(bone.rotation ?? BABYLON.Vector3.Zero());
    bone.setRotationQuaternion(current.multiply(turn), BABYLON.Space.LOCAL);
  }
  skeleton.prepare();

  // Measure where the pose actually put things, and size the chair from that.
  const hips = skeleton.bones.find((b) => b.name === 'Hips');
  const foot = skeleton.bones.find((b) => b.name === 'Foot.L');
  const hipY = hips ? hips.getAbsolutePosition(root).y : 0.9;
  const footY = foot ? foot.getAbsolutePosition(root).y : 0.1;

  return {
    hipY,
    footY,
    seatHeight: Math.max(0.30, hipY - 0.06),
    seatDepth: 0.46,
  };
}

export function buildChair(scene, metrics, spawn) {
  const created = [];
  const mat = new BABYLON.StandardMaterial('chairMat', scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString('#6a5238');
  mat.specularColor = new BABYLON.Color3(0, 0, 0);

  const seat = BABYLON.MeshBuilder.CreateBox('chairSeat',
    { width: 0.46, depth: metrics.seatDepth, height: 0.06 }, scene);
  seat.position.set(spawn.x, metrics.seatHeight, spawn.z);
  created.push(seat);

  const back = BABYLON.MeshBuilder.CreateBox('chairBack',
    { width: 0.46, depth: 0.06, height: 0.52 }, scene);
  back.position.set(spawn.x, metrics.seatHeight + 0.29, spawn.z - metrics.seatDepth / 2 + 0.03);
  created.push(back);

  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    const leg = BABYLON.MeshBuilder.CreateBox('chairLeg',
      { width: 0.05, depth: 0.05, height: metrics.seatHeight }, scene);
    leg.position.set(spawn.x + dx, metrics.seatHeight / 2, spawn.z + dz);
    created.push(leg);
  }

  const merged = BABYLON.Mesh.MergeMeshes(created, true, true, undefined, false, false);
  merged.name = 'chair';
  merged.material = mat;
  merged.rotation.y = spawn.facing ?? 0;

  return { dispose() { merged.dispose(false, false); mat.dispose(); } };
}
```

- [ ] **Step 2: Seat the hostage in cast.js**

Add the import at the top of `raid/cast.js`:

```js
import { seatFigure, buildChair } from './seated.js';
```

`place()` currently returns only the clone; the hostage also needs its skeleton. Change `add` so the hostage is handled separately — after `add('hostage', mission.spawns.hostage, 0);`, insert:

```js
  // The hostage is posed rather than left standing, and the chair is sized to
  // where the pose actually put the hips and feet.
  const seatedFigure = figures[figures.length - 1];
  const hostageSkeleton = scene.skeletons[scene.skeletons.length - 1];
  const metrics = seatFigure(seatedFigure.root, hostageSkeleton);
  const chair = buildChair(scene, metrics, mission.spawns.hostage);
```

Return `chair` from `populate` and dispose it alongside the figures.

- [ ] **Step 3: Verify in the browser and measure the fit**

Open `http://localhost:8080/raid/?debug` and orbit down to the hostage room.

The pose must be checked by measurement, not by eye — the same lesson as the melee grip, where a screenshot from one angle looked right and was not:

```js
const f = __raid.cast.figures.find(x => x.role === 'hostage');
const sk = __raid.scene.skeletons.at(-1);
const foot = sk.bones.find(b => b.name === 'Foot.L').getAbsolutePosition(f.root);
foot.y   // must be >= -0.05 and <= 0.25 — feet on or just above the floor, not through it
```

If the feet sink below the floor, increase `seatHeight`; if the figure floats, decrease it. Adjust the numbers in `POSE` until the knees read as bent and the figure sits *in* the chair rather than on or through it. Check from at least two orbit angles.

- [ ] **Step 4: Commit**

```bash
git add raid/seated.js raid/cast.js
git commit -m "feat: seat the hostage in a chair sized to the pose

The pack has no seated clip and no props, so both the pose and the chair
are built here. Bone rotations are applied over the base pose directly; a
static pose needs no keyframes.

The chair is sized from the posed figure's measured hip and foot heights
rather than authored to fixed dimensions. Authoring it independently would
recreate the fixed-contact-point problem that made seating melee weapons in
the fist expensive — measuring the pose instead lets the geometry move to
meet the figure."
```

---

### Task 12: Invariant sweep and budgets

**Files:**
- Create: `raid/tests/budget.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: a timing guard and documentation

- [ ] **Step 1: Write the budget test**

Create `raid/tests/budget.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';

test('a full generation stays inside the 30ms budget', () => {
  // Warm up first: the first call pays for JIT compilation, which is not what
  // the budget is about.
  for (let i = 0; i < 20; i++) {
    const plan = generateFloorplan(`warm-${i}`);
    layoutProps(plan, assignRoles(plan));
  }

  const timings = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    const plan = generateFloorplan(`budget-${i}`);
    const mission = assignRoles(plan);
    layoutProps(plan, mission);
    timings.push(performance.now() - started);
  }

  timings.sort((a, b) => a - b);
  const worst = timings.at(-1);
  const median = timings[Math.floor(timings.length / 2)];
  assert.ok(worst < 30,
    `worst generation took ${worst.toFixed(1)}ms (median ${median.toFixed(1)}ms), budget is 30ms`);
});

test('every room count in the HUD range generates cleanly', () => {
  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 40; i++) {
      const plan = generateFloorplan(`rooms-${rooms}-${i}`, { targetRooms: rooms });
      const mission = assignRoles(plan);
      layoutProps(plan, mission);
      assert.equal(mission.spawns.swat.length, 4);
    }
  }
});
```

- [ ] **Step 2: Run the whole suite**

Run: `node --test`
Expected: PASS, all files.

If the budget test fails, the likely cause is the O(n²) adjacency scan in `generateFloorplan` combined with the O(n²) prop overlap check. With ~15 cells and ~30 props that is trivial; if it is not, profile before optimising.

- [ ] **Step 3: Document the page**

Add to `README.md`:

```markdown
## raid/ — procedural CQB map generator

Seeded office floor plans for a hostage-rescue scenario: 4 SWAT, 7 hostiles and
1 hostage placed on a generated building, viewed roofless at 45°.

Open `raid/` and use the HUD to set a seed, change the room count, or shuffle.
The same seed always produces the same map.

Generation is pure data — `rng.js`, `floorplan.js`, `roles.js` and `furnish.js`
import nothing from Babylon and run under Node:

    node --test

The suite asserts determinism, connectivity, room sizes, door clearances, spawn
placement and the generation budget across 200 seeds.
```

- [ ] **Step 4: Commit**

```bash
git add raid/tests/budget.test.js README.md
git commit -m "test: generation budget and full room-count sweep

Times 100 generations after a warm-up, since the first call pays for JIT
compilation and that is not what the 30ms budget is measuring. Also sweeps
every room count the HUD offers, because a range control that only works at
its default is a bug waiting for the first person who moves the slider."
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Seeded floor plan, rooms/corridors/walls/doors | 3, 4, 5 |
| Cover props by room role | 9 |
| Mission placement: entry, hostiles, hostage, extraction | 6 |
| Characters at spawn points | 10 |
| Hostage seated in a chair | 11 |
| 45° orbit camera, roofless | 7 |
| HUD: seed, regenerate, room count, legend | 7 |
| Shared `assets/quaternius/` | 1 |
| Determinism, connectivity, no overlaps, hostage depth | 3, 4, 6 |
| Generation under 30 ms | 12 |
| Draw calls ≤ 8 | 8 (verified in browser) |
| Never `Math.random` in generation | Global constraints; the only call is the seed shuffle button, called out in Task 7 |

**Type consistency:** `Rect` uses `{x, z, w, d}` as minimum corner throughout. `Door` uses `x`/`z` as *centre*, which is called out explicitly in Task 4's interface block because it differs from `Rect`. `Cell.kind` is `'room' | 'corridor'`; `Mission.roles` values are `'entry' | 'hostage' | 'guard' | 'filler' | 'corridor'` — different vocabularies, intentionally, and both are defined where introduced.

**Known gaps carried forward deliberately:**

- Draw-call and frame-time budgets are checked in the browser, not by an automated test. Wiring a headless render budget check is disproportionate for phase A.
- `POSE` angles in Task 11 are a starting point requiring visual iteration; the task says so and gives a measurable pass condition (foot height) rather than pretending the numbers are final.
