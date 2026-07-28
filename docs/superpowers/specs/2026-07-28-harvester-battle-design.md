# Design v2: "The Spice Must Flow" — Harvester Battle Scene

**Date:** 2026-07-28
**Supersedes:** scene-composition sections of `2026-07-28-dune-homepage-design.md`.
All v1 architecture NOT listed under "What changes" carries forward unchanged:
theme router & registry, HUD overlay, no-build-step tooling, fallback ladder
(no-JS / no-WebGL / reduced-motion / context-loss / fps-degrade /
visibility-pause), palette-single-source rule, Node test approach.

## Goal

Replace the v1 vista (flat-feeling, baked-shaded, sigil-cluttered) with a
high-fidelity low-poly battle diorama: a Harkonnen spice harvester working a
spice field at dusk, Harkonnen troopers defending it against Fremen warriors
ambushing from the dunes, while Shai-Hulud closes in from the deep desert.
Continuous, choreographed combat: tracers, muzzle flashes, explosions, smoke,
dust. Cyber-neon lives in the effects (tracers, glows, spice, worm rims), not
in floating UI.

## Decisions (from user)

- **Fidelity:** keep the faceted low-poly style but with real-time lighting —
  directional sun with PCF-soft shadow mapping, hemisphere fill, materials
  that respond to light (flat-shaded MeshStandardMaterial), atmosphere/dust.
  No textures/PBR maps; geometry + lighting do the work.
- **Composition:** battle + worm inbound (the classic tableau).
- **Animation:** looping firefight — timed, deterministic loops; no AI.
- **Menu:** HUD-only. In-scene sigil holograms are REMOVED, along with the
  raycaster/click/hover machinery and `#hud-label` usage. The bottom-left HUD
  nav is the sole menu. (Keep the `#hud-label` element in HTML; unused.)

## What changes vs v1 (by module)

- `themes/dune/main.js` — renderer: `shadowMap.enabled`, PCFSoftShadowMap;
  sun DirectionalLight (warm, low-west) with shadow camera fitted to the
  battle zone (~500 world units), casts shadows; HemisphereLight (dusk sky ↔
  sand bounce) replaces AmbientLight; fog density reduced ~35% so foreground
  facets and shadows read; camera reframed onto the harvester; sigil wiring,
  raycaster, `pick/onClick`, cursor, and label code removed. Bloom stays
  (threshold retuned so lit sand never blooms; only emissives do).
- `themes/dune/terrain.js` — same `duneHeight` field, but material becomes
  flat-shaded `MeshStandardMaterial` with vertex-color *tinting* only (subtle
  warm/cool variation, no baked sun); real light provides shading;
  `receiveShadow = true`. A flatter "worksite" apron is carved around the
  harvester position (same corridor trick, recentered).
- `themes/dune/worm.js` — becomes the background threat: path recentered deep
  (z ≈ −900), scale ×2.5, slower cycle, cruising TOWARD the battle with a dune
  dust-wake particle trail; breach arc kept but distant/majestic. Cyan rims
  stay (dimmer — it's far away).
- `themes/dune/sigils.js` — DELETED (with its tests if any).
- `themes/dune/props.js` — spice field becomes one dense elliptical glitter
  bed around/ahead of the harvester (plus 1-2 far patches); resource-token
  wireframes REMOVED (they read as clutter at this fidelity).
- NEW `themes/dune/harvester.js` — procedural Harkonnen harvester (~60 units
  long): beveled hull, tread assemblies with wheels, intake scoop, conveyor
  arm, exhaust stacks, antenna, blinking warning lights (emissive), engine
  glow, continuous intake dust plume (particles), occasional impact sparks.
  Dark gunmetal hull, Harkonnen red accents. Casts/receives shadows.
- NEW `themes/dune/troops.js` — two squads of low-poly soldiers (~10 Fremen,
  ~8 Harkonnen), each soldier a merged multi-primitive figure (~150-300 tris),
  one InstancedMesh per faction. Fremen: stillsuit tan, cyan eye-glow accent,
  advancing/dashing between dune cover points from the east. Harkonnen: dark
  armor, red visor accent, holding an arc around the harvester. Loop per unit:
  dash (crouch-run bob) → take cover (kneel) → fire window. Deterministic
  per-unit phase offsets.
- NEW `themes/dune/combatfx.js` — the firefight FX system, preallocated pools:
  tracers (additive glowing line segments Fremen-cyan / Harkonnen-red, drawn
  between firing unit muzzles and opposing positions with spread), muzzle
  flashes (brief emissive sprites), explosions (flash + expanding smoke puff
  cluster + short screen-space-free dust ring) on a ~7s stagger at
  semi-random battlefield points, drifting smoke columns from two wreck spots.
  All spawning gated by `dt > 0` (reduced-motion ⇒ still scene, no FX).

## Layout (world units)

- Harvester at `(-40, ground, -280)`, facing the spice bed to its east.
- Spice bed: ellipse ~180×100 centered `(30, ground, -260)`.
- Harkonnen line: arc radius ~70 east/southeast of the harvester.
- Fremen approach: from east dunes, cover waypoints spanning x ∈ [80, 220],
  z ∈ [−320, −200].
- Worm: closed loop centered `(-100, −, −950)`, headed battleward on the
  near segment; visible above the horizon from camera.
- Camera: `CAM_BASE (60, 55, -60)`, `CAM_TARGET (-30, 22, -280)` — low, close
  diorama framing with harvester left-of-center, firefight mid-frame, worm on
  the horizon right. Same drift + damped mouse parallax as v1, smaller
  amplitudes (±12 position, ±6 parallax).

## Palette additions (all in `palette.js`; v1 keys retained unless noted)

hullDark `#2b2430` · harkRed `#d4353a` · visorRed `#ff3b30` · stillsuitTan
`#b59a6a` · fremenEyes `#35c8ff` (replaces fremenBlue usage) · tracerCyan
`#66f0ff` · flashYellow `#ffd75e` (reuse emperorGold value, rename ok) ·
explosionOrange `#ff7a29` · smokeGrey `#6b5f66` · dustTan `#caa06a` ·
engineGlow `#ff5a3c`. Sunlight becomes `#ffb36b` (softer, higher intensity
with shadows). Moons dimmed ~30% so they never bloom into blobs (v1 defect).

## Performance budget (revised)

60 fps mid laptop / 30 fps mid phone still target. Tris ≤ 150k; draw calls
≤ 60. One 2048px shadow map (1024 on small screens), single shadow-casting
light, shadow camera tight on the battle zone. Troops: 1 InstancedMesh per
faction. FX pools preallocated (tracers 24, flashes 16, explosion puffs 3×40,
plume 200, wake 300); zero per-frame allocations rule carries forward.
Adaptive degrade order: bloom off → shadows off → FX pool halved.

## Reduced motion / fallbacks

Unchanged ladder. Frozen `elapsed` picks a composed moment (worm above
horizon, troops in cover, plume/smoke present but static); `dt=0` suppresses
all FX spawning and movement.

## Testing

Node tests: router/palette/noise as before (palette test updated for new
keys; sigils test references removed). Browser QA (Playwright): console
clean, renderer budget assertions via direct render, screenshots judged
against: (1) harvester reads as machine at first glance, (2) two factions
distinguishable by silhouette+color, (3) tracers visible but not laser-show,
(4) shadows visibly anchor units to ground, (5) worm reads on horizon,
(6) foreground terrain shows faceting (v1 defect fixed), (7) moons don't
bloom (v1 defect fixed).

## Out of scope

W40k theme; sound; pathfinding/AI; unit deaths/ragdoll; user camera control.
