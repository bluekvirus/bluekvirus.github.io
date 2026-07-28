# Harvester Battle ("The Spice Must Flow") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dune theme's scene as a high-fidelity low-poly battle diorama — Harkonnen harvester + defenders vs Fremen ambush, worm inbound — with real-time lighting/shadows, per the v2 spec.

**Architecture:** Same shell (router, HUD, fallbacks, updater contract `{update(dt, elapsed, camera), degrade?()}`). Scene modules change: relit terrain, background worm, new harvester/troops/combatfx modules, sigils and tokens removed. A new pure `layout.js` holds all battlefield coordinates.

**Tech Stack:** three.js 0.170.0 (CDN import-map, unchanged), Node built-in test runner, python http.server + Playwright MCP for visual iteration.

**Spec:** `docs/superpowers/specs/2026-07-28-harvester-battle-design.md` — read it first; its Layout, Palette, and Performance sections are normative.

**Plan style note:** Unlike the v1 plan, aesthetic geometry is NOT transcribed verbatim here. Each task gives exact interfaces, coordinates, colors, counts, and behavior, plus **Visual acceptance criteria** the implementer MUST iterate against (serve → screenshot → judge → adjust → repeat, max 5 iterations) before committing. Structural/wiring code IS given exactly and must be followed.

## Global Constraints

- No build step, no npm. three.js pinned 0.170.0. Tests: bare `node --test` (12 currently passing; this plan changes that set — each task states the expected count).
- All colors ONLY from `themes/dune/palette.js`; all battlefield coordinates ONLY from `themes/dune/layout.js` (both pure, Node-importable). No hex or position literals in scene modules.
- No per-frame allocations in any update path; FX use preallocated pools.
- Perf: tris ≤ 150k, draw calls ≤ 60, one shadow-casting light, shadow map 2048 (1024 when `state.small`). Verify via direct `renderer.render` + `renderer.info` (composer resets info — known quirk).
- All FX/motion spawning gated `dt > 0` (reduced-motion stillness).
- Updater contract unchanged: `{update(dt, elapsed, camera), degrade?()}` pushed to `state.updaters`.
- Browser verification: `python3 -m http.server 8080` from repo root (background), Playwright MCP on `http://localhost:8080/?theme=dune&debug`, kill server after. "Console clean" = no errors except the pre-existing favicon 404.
- Commits end with the Co-Authored-By trailer used on this branch.

---

### Task 1: Relight & reframe — palette v2, layout, terrain v2, de-sigil

**Files:**
- Modify: `themes/dune/palette.js` (v2 keys; REMOVE `SIGILS` export)
- Create: `themes/dune/layout.js`
- Modify: `themes/dune/noise.js` (recenter flat corridor to worksite)
- Modify: `themes/dune/terrain.js` (lit material)
- Modify: `themes/dune/main.js` (shadows, hemisphere light, camera, fog; REMOVE sigils/raycast/click/label wiring)
- Delete: `themes/dune/sigils.js`
- Modify: `themes/dune/props.js` (spice bed relocation; REMOVE tokens) — keep `createProps({small})` signature
- Modify: `tests/palette.test.mjs`, `tests/noise.test.mjs`

**Interfaces:**
- Produces `palette.js` COLORS with v2 keys (exact values from spec §Palette): keep `sandLit sandShadow skyZenith horizon neonCyan neonMagenta amber starWhite wormHide moonA moonB`; change `sunlight: 0xffb36b`; add `hullDark 0x2b2430, harkRed 0xd4353a, visorRed 0xff3b30, stillsuitTan 0xb59a6a, fremenEyes 0x35c8ff, tracerCyan 0x66f0ff, flashYellow 0xffd75e, explosionOrange 0xff7a29, smokeGrey 0x6b5f66, dustTan 0xcaa06a, engineGlow 0xff5a3c`; remove `fremenBlue`, `emperorGold`; dim moons: `moonA 0x9a9088, moonB 0x837490`.
- Produces `layout.js` (pure, no imports):

```js
export const LAYOUT = {
  harvester: { x: -40, z: -280, rotY: 0.35 },
  spiceBed: { x: 30, z: -260, rx: 90, rz: 50 },
  farSpice: [{ x: -420, z: -700, rx: 60, rz: 35 }, { x: 380, z: -820, rx: 70, rz: 40 }],
  harkArc: { cx: -10, cz: -265, r: 70, a0: -0.5, a1: 1.1, count: 8 },
  fremenCover: [
    [85, -235], [110, -300], [140, -215], [165, -275],
    [190, -320], [205, -230], [230, -290], [120, -255],
    [175, -245], [215, -260],
  ],
  worm: { cx: -100, cz: -950, r: 500 },
  camBase: [60, 55, -60],
  camTarget: [-30, 22, -280],
};
```

- `noise.js`: corridor term becomes `Math.hypot(x + 20, z + 270) / 900` (worksite apron; same 0.35 floor). Update the noise test's "corridor flatter than far field" sampling center to `(-20, -270)` accordingly.
- `terrain.js`: material → `new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 })`; mesh `receiveShadow = true`. Vertex colors become subtle tint only: lerp sandShadow→sandLit by `0.45 + 0.25 * noiseShade` (keep the baked-sun dot product as `noiseShade` input but compress range) — real light does the shading now.
- `main.js` changes (apply exactly):
  - renderer: `renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;`
  - sun: `DirectionalLight(COLORS.sunlight, 2.2)`, `position.set(-420, 260, -120)`, `castShadow = true`, shadow map size 2048 (1024 if `state.small`), shadow camera ortho box ±320 around `(30, 0, -270)`, `shadow.bias = -0.0005`.
  - replace AmbientLight with `new THREE.HemisphereLight(COLORS.skyZenith, COLORS.dustTan, 0.55)`.
  - fog density `0.00055 → 0.00035`.
  - `CAM_BASE`/`CAM_TARGET` from `LAYOUT.camBase/camTarget`; drift amplitudes 40/6/25 → 12/4/8; parallax 18/10 → 6/4.
  - bloom threshold 0.5 → 0.75, strength 0.85 → 0.7 (lit sand is brighter now; only emissives may bloom).
  - REMOVE: sigils import/wiring, `_raycaster`, `_ndc`, `pick`, `onClick`, click listener, cursor and `#hud-label` logic in `onPointerMove` (keep pointer.tx/ty tracking), `state.interactive`, `state.sigils`.
- `props.js`: spice clusters move to `LAYOUT.spiceBed` + `LAYOUT.farSpice` ellipses (dense bed: 900 particles desktop / 400 small; far patches 250/120 each); tokens removed entirely; `degrade()` still halves draw ranges.
- Tests after this task: router 7 + palette 2 (colors incl. new keys; SIGILS test replaced by an assertion that palette exports no SIGILS and no fremenBlue/emperorGold) + noise 3 = **12 passing**.

- [ ] **Step 1:** Update `tests/palette.test.mjs` + `tests/noise.test.mjs` per above; run bare `node --test` → new assertions FAIL.
- [ ] **Step 2:** Implement palette v2, `layout.js`, noise recenter → tests PASS (12).
- [ ] **Step 3:** Implement terrain/material, main.js relight+reframe+de-sigil, props v2. `git rm themes/dune/sigils.js`.
- [ ] **Step 4:** Visual iteration (serve + Playwright screenshots, up to 5 rounds). **Visual acceptance criteria:** (a) foreground dune facets clearly visible with light/shadow variation (v1 defect fixed); (b) terrain shows a soft real shadow gradient across dune faces; (c) moons visible but NOT blooming into white blobs (v1 defect fixed); (d) horizon seam invisible; (e) spice bed reads as a glittering field right of frame center; (f) console clean. Tuning knobs allowed: sun intensity/position, hemisphere intensity, fog density ±30%, bloom threshold/strength, vertex tint range.
- [ ] **Step 5:** Perf check via debug handle (direct render): calls ≤ 60, tris ≤ 150k. Record numbers in report.
- [ ] **Step 6:** Commit `feat: relight scene with shadows, reframe to worksite, remove sigils`.

---

### Task 2: Harvester

**Files:**
- Create: `themes/dune/harvester.js`
- Modify: `themes/dune/main.js` (wire: `const harvester = createHarvester(); scene.add(harvester.group); state.updaters.push(harvester);` after terrain)

**Interfaces:**
- Produces `createHarvester() → { group, update(dt, elapsed), degrade() }`. Group internally positioned/rotated from `LAYOUT.harvester`, resting on `duneHeight` at that point.
- Consumes COLORS (hullDark, harkRed, engineGlow, dustTan, flashYellow), LAYOUT, `duneHeight`.

**Build requirements (design the geometry yourself — iterate visually):**
- ~60 units long, ~22 wide, ~18 tall. Recognizable spice-harvester silhouette: low wide beveled hull; two tread assemblies (side skirts + ≥4 visible wheel cylinders each); front intake scoop with angled maw; rear conveyor/stack arm rising ~10 units; 2-3 exhaust stacks; small antenna mast. Merge static parts into few geometries (target ≤ 8 draw calls total incl. effects, ≤ 12k tris).
- Harkonnen identity: hullDark body, harkRed accent panels/stripes (separate material or vertex colors).
- All solid parts `castShadow = true`, hull `receiveShadow = true`.
- Life: 2 blinking warning lights (emissive flashYellow, ~1.3s period, phase-offset); engine glow strip (emissive engineGlow, subtle pulse); continuous intake dust plume — preallocated 200-particle pool (dustTan, additive, rising/drifting from the scoop, recycled by lifetime); occasional spark burst at a random hull point every ~9s (reuse plume pool pattern, 12 particles, flashYellow). Spawning gated `dt > 0`. `degrade()` halves plume draw range.
- No allocations in `update` (pooled buffers + scratch objects).

- [ ] **Step 1:** Implement module + wiring.
- [ ] **Step 2:** Visual iteration (≤5 rounds). **Criteria:** (a) instantly reads as a tracked industrial machine, not a box pile — check silhouette from the actual camera; (b) red accents identify faction without dominating; (c) dust plume visible, drifting, not a fog bomb; (d) blinking lights and engine glow visible and blooming gently; (e) grounded — treads contact terrain, shadow anchors it. Knobs: any of its own geometry/materials, plume params.
- [ ] **Step 3:** Bare `node --test` still 12; perf numbers recorded (direct render).
- [ ] **Step 4:** Commit `feat: harkonnen spice harvester with plume and running lights`.

---

### Task 3: Worm to the horizon

**Files:**
- Modify: `themes/dune/worm.js`

**Interfaces:** `createWorm() → { group, update(dt, elapsed) }` unchanged.

**Changes:**
- Path: closed loop from `LAYOUT.worm` (cx, cz, r), heights from `duneHeight` with lifts `[-90, -90, 30, 190, 30, -90, ...]` pattern (single grand breach on the battle-facing segment), `CYCLE 36 → 55`.
- Scale: segment sizes ×2.5 (head ~38). Rim color stays neonCyan but `rings` material gains `transparent: true, opacity: 0.55` (distance dimming).
- NEW dust wake: preallocated 300-particle pool (dustTan) emitted at the surface point above the head while the head is submerged (gate `dt > 0`), giving the classic moving mound trail. Reuse the spray pool pattern; spray burst kept for breach/dive (scaled up ×2).
- Still 3 draw calls (body, rings, particles — merge spray+wake into one pool of 540 if simpler).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Visual iteration (≤5 rounds). **Criteria:** (a) worm reads on the horizon right-of-frame from the default camera during most of the cycle; (b) breach arc fully visible above the dune line, majestic not cartoonish; (c) wake trail visible approaching the battle; (d) does not overlap/collide visually with the harvester. Knobs: path center/radius/lifts, cycle, scale, wake emission.
- [ ] **Step 3:** `node --test` 12; commit `feat: background worm approach with dust wake`.

---

### Task 4: Troops

**Files:**
- Create: `themes/dune/troops.js`
- Modify: `themes/dune/main.js` (wire after harvester; keep reference: `state.troops = troops` for Task 5)

**Interfaces:**
- Produces `createTroops() → { group, update(dt, elapsed), units }` where `units` is a fixed array of `{ faction: 'fremen'|'hark', pos: THREE.Vector3 (live world position, updated in place), firing: boolean (true during fire windows), muzzleY: number }` — Task 5 reads it every frame; array and Vector3s allocated once.
- Consumes COLORS (stillsuitTan, fremenEyes, hullDark, visorRed, harkRed), LAYOUT (harkArc, fremenCover), `duneHeight`.

**Build requirements:**
- Soldier figure: single merged low-poly humanoid (~150-300 tris): legs block/pair, torso, head, shoulder pads or hood, rifle prism. Two variants by proportions is fine; distinct silhouettes preferred (Fremen: hooded/cloaked taper; Harkonnen: bulkier armored shoulders).
- One InstancedMesh per faction (10 Fremen, 8 Harkonnen) + one small shared emissive accent InstancedMesh per faction if needed for eye/visor glow (≤4 draw calls total). castShadow true.
- Harkonnen: posted along `harkArc` (evenly spaced angles a0..a1, radius r around cx,cz), facing east; behavior loop per unit (phase-offset): kneel-fire window (3-4s, `firing=true`) → stand/shift 2-3 units laterally (1s) → repeat.
- Fremen: each unit owns a repeating waypoint cycle over 2-3 of the `fremenCover` points: dash between points (~1.2s, bobbing crouch-run, `firing=false`) → hold cover (3-5s kneel, `firing=true` for a 2s window) → next. Deterministic from `elapsed` + per-unit phase; no randomness at runtime (use unit index-seeded constants).
- Ground-follow: y from `duneHeight(x,z)` each frame; face movement direction / face enemy when firing (yaw only, set via per-instance matrix compose — reuse scratch objects).
- Reduced motion (`dt=0`, frozen elapsed): all units resolve to a static posed frame.

- [ ] **Step 1:** Implement + wire.
- [ ] **Step 2:** Visual iteration (≤5 rounds). **Criteria:** (a) figures read as soldiers at diorama distance (limbs distinguishable, not capsules); (b) factions instantly distinguishable by color AND silhouette; (c) Fremen dashes read as purposeful advance through cover, not teleporting/gliding (bob + speed tuned); (d) Harkonnen arc visibly defends the harvester; (e) units grounded with contact shadows, no floating/clipping into dunes. Knobs: figure geometry, counts ±2, timing constants, cover choreography.
- [ ] **Step 3:** `node --test` 12; perf recorded; commit `feat: fremen and harkonnen troop squads with battle choreography`.

---

### Task 5: Combat FX

**Files:**
- Create: `themes/dune/combatfx.js`
- Modify: `themes/dune/main.js` (wire LAST among updaters: `const fx = createCombatFX(troops.units); ...`)

**Interfaces:**
- Produces `createCombatFX(units) → { group, update(dt, elapsed), degrade() }`.
- Consumes COLORS (tracerCyan, harkRed, flashYellow, explosionOrange, smokeGrey, dustTan), LAYOUT, `duneHeight`, the live `units` array.

**Build requirements (all pooled, preallocated, `dt > 0` gated):**
- **Tracers (pool 24):** short glowing segments (thin additive quads or fat `LineSegments`) that travel muzzle→target over ~0.15s. Source: any unit with `firing=true` fires every 0.4-0.9s (index-seeded cadence); target: a semi-random point near an opposing unit (±3 units spread). Fremen tracers tracerCyan, Harkonnen harkRed.
- **Muzzle flashes (pool 16):** 2-frame emissive sprite at muzzle on each shot.
- **Impact puffs:** small dust kick where tracers land (share explosion puff pool).
- **Explosions:** every ~7s (staggered, index-seeded positions within the battlefield rectangle x∈[−20,220], z∈[−330,−200]): expanding emissive flash sphere (0.25s) + 40-particle smoke puff (smokeGrey, rises/expands/fades over ~4s) + small dustTan ground ring. 3 concurrent max.
- **Wreck smoke:** two persistent thin smoke columns at fixed layout-chosen points near the Harkonnen arc (battle damage), continuously recycling particles.
- `degrade()`: halve all pool draw ranges and double explosion interval.
- Budget: ≤ 8 draw calls for the whole FX system.

- [ ] **Step 1:** Implement + wire.
- [ ] **Step 2:** Visual iteration (≤5 rounds). **Criteria:** (a) firefight is legible — you can tell who shoots whom (tracer direction + colors); (b) rhythm feels like a skirmish (staggered, not strobing laser-show, not dead air > 2s); (c) explosions read with flash→smoke sequence and gentle bloom; (d) smoke columns anchor the "battle damage" story; (e) reduced-motion (`emulateMedia`) yields a still frame with smoke present but frozen, zero new FX. Knobs: cadences, pool sizes within budget, colors' intensity, sizes.
- [ ] **Step 3:** `node --test` 12; perf recorded; commit `feat: combat fx - tracers, flashes, explosions, battle smoke`.

---

### Task 6: Final QA, degrade ladder, README, docs

**Files:**
- Modify: `themes/dune/main.js` (two-stage degrade), `README.md`
- Tuning knobs from any task's list if the full-scene judgment demands it.

- [ ] **Step 1:** Implement two-stage watchdog degrade replacing the single-stage one: stage 1 (3 consecutive s < 25fps): `useComposer = false`; stage 2 (3 more): `renderer.shadowMap.autoUpdate = false; shadowMap.enabled = false;` materials needsUpdate, and call every updater's `degrade()`. Keep `f.degraded` semantics (stage counter).
- [ ] **Step 2:** Bare `node --test` (12). Full Playwright sweep: `/` , `/?theme=dune&debug` (perf assertions via direct render: calls ≤ 60, tris ≤ 150k), `/?theme=zzz`, `/?nogl=1`, resize, 390×844 narrow, reduced-motion via emulateMedia.
- [ ] **Step 3:** Whole-scene visual judgment against the spec's 7 testing criteria (harvester reads as machine; factions distinguishable; tracers legible; shadows anchor; worm on horizon; foreground faceting; no moon bloom) — screenshot at 3 moments (worm submerged approach, worm breach, explosion mid-burst). Tune any task's knobs as needed; re-verify.
- [ ] **Step 4:** README: update the scene description paragraph (harvester battle replaces sigil vista; menu is the HUD nav; note in-scene sigils removed). Keep router/test/preview sections.
- [ ] **Step 5:** Commit `chore: battle scene QA, two-stage degrade, README`.

---

## Plan Self-Review Notes

- Spec coverage: relight/shadows/camera/fog/de-sigil (T1), harvester+plume+lights (T2), worm background+wake (T3), squads+choreography (T4), tracers/flashes/explosions/smoke (T5), two-stage degrade + QA criteria + README (T6). Palette/layout single-source (T1, constraint). Reduced-motion gating restated per FX task.
- Deviation from v1 plan style: aesthetic code is spec+criteria-driven (rationale in header). Structural contracts (interfaces, pools, gating, budgets) are exact.
- Type consistency: `units` array contract defined once (T4) and consumed by name in T5; `createX() → {group, update, degrade?}` uniform; layout keys referenced by exact name throughout.
