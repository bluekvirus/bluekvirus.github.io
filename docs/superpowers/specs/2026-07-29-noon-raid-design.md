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
**Amended 2026-07-29 after the first implementation attempt.** The original text
specified an isotropic bounding-*sphere* fit at fixed fov. That was proven (twice,
independently) to cap vertical fill at `atan(tan(vHalf)·aspect)/vHalf` ≈ 48% at phone
portrait — a property of the sphere abstraction, with no dependence on which points
are chosen. Hitting a 55% bar under it required tilting the camera nearly overhead,
producing a top-down "war table" with no sky or horizon at *every* aspect. The metric
was satisfied; the shot was destroyed. Revised method below.

- **Camera-space box fit, not a sphere.** Build an orthonormal basis from the view
  direction (`right`, `up`, `forward`), project the focus points onto it, and take
  half-extents `wr` (right), `wu` (up), `wd` (forward). Then
  `distance = max(wr / tan(hHalfFov), wu / tan(vHalfFov)) * MARGIN + wd`.
  This fits the subject's actual silhouette — a wide, shallow strip — instead of the
  much larger sphere that encloses it.
- **The view angle is itself responsive.** `layout.js` holds two directions:
  `viewDirWide` (low three-quarter, horizon and sky visible) used at aspect ≥ 1.4,
  and `viewDirTall` (steeper three-quarter, elevation ~35-45°) used at aspect ≤ 0.55,
  smoothly interpolated between. A tall frame earns its fill from the battlefield's
  *depth* projecting into screen height — not from cropping and not from going
  overhead. **Hard constraint: the horizon must remain visible at every aspect**;
  elevation never exceeds ~45°. The scene has a sky, a sun and a worm on the horizon —
  a framing that hides them is wrong regardless of what it scores.
- **Tiered focus.** `FOCUS.core` (harvester + Harkonnen line + near Fremen positions)
  is always framed. `FOCUS.wide` (far Fremen positions) and `FOCUS.bonus` (worm breach
  apex) are appended only while doing so does not push the core subject below its
  target fill — so a phone shows a tighter slice of the same battle, which is what a
  camera operator would do.
- Camera looks at the core centroid lifted by `wu * lookLift` so the horizon sits in
  the upper third and dead foreground is cropped out.
- Drift/parallax oscillate around the computed base, amplitudes scaled by the fitted
  extent so they stay proportional at every framing.
- **Acceptance (composition, not a single number):** at 21:9, 16:9, 3:2, 4:3, 1:1,
  3:4, 9:16 and 9:19.5 — (a) the harvester and the firing line are unmistakably the
  subject, occupying a substantial share of the frame; (b) the horizon line is visible
  and sits in the upper ~40% of the frame; (c) no empty foreground band deeper than
  ~20% of frame height; (d) nothing in `FOCUS.core` is clipped; (e) the framing reads
  as the *same shot* across aspects, tighter on narrow screens, not a different scene.

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
- **Locomotion — LEGS, not tracks** (corrected 2026-07-29 from a second research pass):
  Dune: Part Two has a distinct **Harkonnen Spice Harvester** design (George Hull, under
  Vermette) that walks on massive legs. SFX supervisor Gerd Netzer: the legs are *"sixty
  feet wide and thirty feet high"*; a pair were built in steel and mounted on two 100-ton
  excavators to simulate the gait. The body is "as big as a soundstage" and the finished
  CG machine is *"three times higher, three times wider, and five times longer"* than the
  practical rig (Paul Lambert). Paul and Chani shelter **behind a leg** during the raid —
  the open shadowed gap beneath the hull is the silhouette's signature and must read
  clearly. Model splayed legs carrying the body high off the sand, not ground-hugging
  track housings.
- **Color — dark Harkonnen structure, sand-scoured** (controller ruling 2026-07-29,
  superseding this spec's original "sand, NOT black"): base the hull on `#7a5230`
  grime / `#3a2e22` undercarriage tones, with `#c7a876` sand and `#e8d9b0` bleach as
  heavy dust-and-scour accumulation on upper surfaces, leading edges and legs. Rationale:
  the request is specifically the Harkonnen machine and no accessible source documents
  this design's actual livery; the earlier "sand, not black" line came from general
  Arrakis-palette doctrine. Target: a menacing dark machine *wearing* the desert —
  neither a clean black box nor a uniformly tan one. Heavy weathering via vertex-color
  variation; no clean surfaces.
- **Harkonnen identity is reinforced by the escorts** (see §4), not carried by the
  harvester's paint alone.
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
