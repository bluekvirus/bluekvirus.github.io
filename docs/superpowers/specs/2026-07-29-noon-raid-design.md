# Design v4: "Noon Raid" — Subject-Fit Framing, Arrakis Daylight, Movie Harvester, Living Attrition

**Date:** 2026-07-29
**Supersedes:** v2/v3 dusk palette, the harvester model, the fixed camera framing, and
the static troop roster. Everything else (router, HUD, fallback ladder, module
contracts, pooling discipline, perf budgets, de-neon rule from v3) carries forward.

## Problems this fixes (user-reported)

1. **"Not responsive to screensize."** The resize handler works, but the camera aims
   at a fixed world point with an aspect-lerped fov, so the subject occupies a small
   band of the frame and the empty foreground grows/shrinks arbitrarily with window
   shape. Measured at 1440×760: the bottom ~45% of frame is featureless sand.
2. **Dusk → day.** User wants daylight.
3. **Harvester doesn't read as the film's.** Current model is a dark gunmetal box with
   red accents; the Villeneuve harvester is a sand-colored industrial slab.
4. **Static battle.** Troops never die or arrive; the fight is a loop, not a conflict.

## 1. Subject-fit responsive framing (the real responsiveness fix)

Replace aspect-lerped fov with a **bounding-sphere fit**:

- `layout.js` gains `FOCUS`: a **core** list of world points that MUST always be in
  frame (harvester hull extents, Harkonnen arc, Fremen engagement zone) and a
  **bonus** point (worm horizon apex) framed only when it fits for free.
- On mount and every resize, compute the core points' bounding sphere (center `C`,
  radius `R`), then place the camera along a fixed unit direction `VIEW_DIR` (a low,
  three-quarter angle, from `layout.js`) at distance
  `d = R / sin(min(vFovHalf, hFovHalf)) * MARGIN`, where
  `hFovHalf = atan(tan(vFovHalf) * aspect)`. fov stays a constant 52°; **distance**
  does the adapting, so the subject fills the frame identically at 21:9, 16:9, 4:3,
  and 9:19.5. `MARGIN ≈ 1.12` (tunable).
- Camera looks at `C` lifted slightly (`C.y + R*0.10`) so the horizon sits high and
  dead foreground is cropped out.
- Portrait behavior falls out of the same math (narrow `hFov` → larger `d`); no
  special-casing, no separate calibration constants to drift.
- Drift/parallax continue to oscillate around the computed base, amplitudes scaled
  by `R/1000` so they stay proportional at every framing.
- **Acceptance:** at 21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 9:16 and 9:19.5 the harvester +
  battle line fill ≥55% of frame height with no more than ~15% of frame height as
  empty foreground sand, and nothing important is clipped.

## 2. Harsh Arrakis noon

- **Sun:** near-overhead directional light (elevation ~70°), intensity ~3.6,
  color `#fff4e2`. Short, hard, high-contrast shadows (shadow map unchanged).
- **Sky:** bleached pale gradient — zenith `#8fb8d8`, horizon `#e8dcc2` (dust-washed
  white-gold). Sun disc visible as a small blown-out white disc; **stars and moons
  removed** (daytime).
- **Fog/haze:** heat haze reads as a lighter, denser distance wash —
  `FogExp2(#e0d2b6, 0.00042)`.
- **Sand:** hot pale ochre — lit `#e6c088`, shadow `#9a7550` (violet shadows are gone;
  daylight shadow is warm-grey-brown).
- **Tone/exposure:** ACES filmic retained; `renderer.toneMappingExposure ≈ 0.95` so
  highlights don't clip.
- **Bloom:** threshold raised to ~0.95, strength ~0.35 — in daylight only muzzle
  flashes, explosions and the sun disc may halo. Sand must never bloom.
- **Spice:** reads as a rust/copper glitter bed against pale sand (still amber family,
  slightly deeper so it separates from bright sand).

## 3. Movie-accurate spice harvester

Per production references (Vermette: "inspired by the shape of a tick"; licensed
MENG kit proportions 100×65×27 mm ⇒ **L:W:H ≈ 3.7 : 2.4 : 1**; practical leg rig
60 ft wide × 30 ft tall with characters sheltering beneath):

- **Hull:** long, low, flattened wedge/slab — wider than tall, ≥3.5× longer than
  tall. Blocky industrial "factory laid flat" massing, no organic curves. Beetle/tick
  outline seen from above (widest at mid-body, tapering fore and aft).
- **Track housings:** two massive blocky assemblies flanking the hull, tall and thick
  enough that a soldier standing beside one is dwarfed (soldier ≈ ⅓ housing height).
  This is the single most film-iconic element.
- **Intake:** forward, downward-angled cone/funnel at the nose, visually distinct from
  the flatter rear body; establishes front/back at a glance.
- **Superstructure:** modest raised cab near the front quarter, exhaust stacks and
  vents aft, short sensor mast. (Undocumented in sources — plausible invention,
  kept subordinate to the slab silhouette.)
- **Color — NOT black:** sun-bleached sand/khaki hull `#c7a876`, weathered rust-brown
  panel grime `#7a5230`, bleached dust highlight `#e8d9b0`, dark undercarriage
  `#3a2e22`. Heavy scouring/weathering via vertex-color variation; no clean surfaces.
- **Harkonnen identity moves to the escorts** (see §4) — the films never repaint the
  harvester in Harkonnen black.
- Retains: intake dust plume, running lights (dimmed for daylight), engine heat glow.

## 4. Harkonnen escort ornithopter

Adds the faction read the sand-colored harvester intentionally gives up:

- Small black rotorcraft-silhouette ornithopter (Part Two's variant was modeled on a
  Black Hawk): smooth biomorphic near-black hull `#141414`, pale grey trim `#6e6e6e`,
  short stub wings, twin rotor/wing assemblies with blur discs.
- Behavior: slow patrol orbit above and behind the harvester, banking into turns;
  occasionally strafes the Fremen line (contributes tracers via the existing FX
  system). No landing, no destruction.
- Budget: ≤4 draw calls, ≤4k tris.

## 5. Living attrition (engage → die → reinforce)

- **Casualty model:** the existing tracer system already resolves impacts near a
  target unit. On impact, the target rolls a kill chance (~22% per hit) from a
  **seeded PRNG stream** — variable run to run in feel, never `Math.random()` in a
  per-frame path, and fully frozen under reduced motion.
- **Death:** unit enters `dying` — a ~0.8s fall (pitch onto the sand, slight scatter
  yaw), no ragdoll — then `down`: body lies on the sand for ~20s, then sinks/fades
  over ~3s and is recycled.
- **Reinforcement:** each faction maintains its target strength. A recycled unit
  re-enters as `reinforcing` from off-frame on its own side (Fremen from the eastern
  dunes, Harkonnen from behind the harvester), walking/dashing to an open post before
  resuming normal behavior. Arrival is staggered so lines thin and refill visibly.
- **Balance:** Fremen take losses too; neither side ever wipes out. Live counts stay
  within ±3 of nominal (10 Fremen / 8 Harkonnen).
- **Contract:** `units` entries gain `alive: boolean` and `state: 'advance'|'cover'|
  'fire'|'dying'|'down'|'reinforce'`; combat FX must not fire from non-alive units.
  Troops owns all state; FX reports impacts via a callback (`troops.reportImpact(unitIndex)`).
- **Reduced motion:** frozen frame shows a composed moment including one or two
  fallen bodies; zero new deaths, falls, or arrivals.

## Budgets & constraints (carried forward, revised)

- ≤70 draw calls, ≤170k tris (raised from 60/150k for the ornithopter + bodies).
- Zero per-frame allocations; all new state preallocated (bodies are recycled units,
  not new meshes).
- Colors only in `palette.js`; coordinates only in `layout.js`; no cyan/magenta;
  diegetic light only.
- Fallback ladder, router, HUD, degrade stages unchanged.

## Acceptance

1. Subject fills the frame at all eight tested aspect ratios; no dead-foreground band.
2. Scene reads as harsh daylight — pale sky, hot sand, short hard shadows, no stars/moons.
3. Harvester reads as the film's: long low sand-colored slab, massive track housings,
   nose cone intake; a soldier beside a housing is visibly dwarfed.
4. Black ornithopter patrolling overhead makes the operation read Harkonnen.
5. Over 60s of watching: soldiers visibly fall, bodies accumulate briefly, replacements
   walk in, and both lines persist — the fight looks ongoing, not looped.
6. Reduced motion, degrade stages, fallbacks, and perf budgets all still hold.
