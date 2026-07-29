# Design v3: Cinematic Refinement — De-Neon + Film-Style Shai-Hulud

**Date:** 2026-07-28
**Supersedes:** the neon/cyber styling of v2 (`2026-07-28-harvester-battle-design.md`)
and its worm model. Everything else in v2 (scene composition, lighting,
modules, budgets, fallback ladder, router/HUD architecture) carries forward.

## Decisions (from user)

- **Drop the cyber-neon mix-in entirely.** Light may come only from diegetic
  sources: fire, explosions, engine heat, machine running lights, the ember
  dusk sky. No cyan/magenta anywhere.
- **Rebuild the sandworm as a film-style Shai-Hulud:** continuous massive
  cylindrical body of overlapping plated segments (no gaps/beads), rocky
  ridged hide in dark earth tones, round maw ringed with baleen-like teeth
  that gapes during the breach.

## De-neon changes (by surface)

- **Palette (`palette.js`):** REMOVE `neonCyan`, `neonMagenta`, `tracerCyan`,
  `fremenEyes`. ADD `tracerFremen 0xffd9a0` (pale tracer gold),
  `wormHideDark 0x3a2e28`, `wormHideLit 0x6b5344`, `wormMaw 0x1a0f0d`,
  `wormTeeth 0xcbb89a`. `harkRed` stays (Harkonnen identity + their tracer
  color). `visorRed` stays but is used DIM (equipment light, diegetic).
  Update the palette test (assert removals + additions).
- **Spice field (`props.js`):** all-amber glitter (drop the 20% cyan
  particles; small warm variation within amber is fine).
- **Troops (`troops.js`):** Fremen emissive eye accent removed (stealth —
  no glow; keep a non-emissive darker hood face patch if useful for reads).
  Harkonnen visor accent kept but dimmed to a faint equipment-light red.
- **Combat FX (`combatfx.js`):** Fremen tracers `tracerFremen` pale gold;
  Harkonnen tracers stay `harkRed`. Legibility comes from direction, origin,
  and warm-vs-red tint. Flashes/explosions unchanged (fire is diegetic).
- **HUD (`css/main.css`):** restyle from neon cyan/magenta to sand/ember —
  name in `#ffb347` amber with a soft warm shadow, nav links pale sand
  `#e8d5b5` hovering to amber, no colored glow shadows. Fallback page links
  match.
- **Bloom (`main.js`):** stays, as the fire/heat device only — strength
  lowered toward ~0.5, threshold raised toward ~0.85 (tuning knobs) so only
  genuinely bright emissives (flashes, explosions, engine glow, running
  lights) halo. Nothing else may bloom.

## New worm model (film-style Shai-Hulud)

Rebuild `worm.js` rendering (path/cycle/wake/spray logic from v2 carries
forward, tuned as needed):

- **Body:** ~40 overlapping tapered ring-plate segments along the spline —
  each a low-poly (10-14 side) conical frustum with a slight raised leading
  lip, placed tightly (overlap ≥ 40% of segment length) so the body reads as
  one continuous plated tube, never beads. Radius profile: broad head
  (~radius 34-40) holding through the fore-body, tapering over the last
  third to a blunt tail. One InstancedMesh; flat-shaded MeshStandardMaterial;
  vertex or per-instance color grading `wormHideDark`→`wormHideLit` (dusty
  top, dark underside acceptable via two-tone instance colors or baked
  vertex colors).
- **Maw:** forward-facing round mouth — dark interior cone (`wormMaw`) ringed
  by 2 concentric rings of ~48 small baleen teeth (instanced thin cones,
  `wormTeeth`). The maw GAPES during the breach: teeth rings and outer lip
  scale/flare open around the breach apex (driven from the existing cycle
  phase), closed while cruising/submerged.
- **Silhouette motion:** subtle body undulation (small per-segment lateral
  offset by phase) so the breach arc feels alive, not rigid.
- **No emissive anywhere on the worm.** No rings, no rim glow.
- **Draw calls:** ≤4 (body instanced, teeth instanced, maw mesh, particle
  pool). Dust wake + spray particles carry over (amber/dustTan — natural).
- **Budget:** worm ≤ 25k tris; scene budgets unchanged (≤60 calls/≤150k).

## Acceptance (added to v2's criteria)

1. Zero cyan/magenta pixels in any frame (spot-check screenshots).
2. Only fire/heat/light sources halo under bloom.
3. Worm body reads as ONE continuous plated creature at all cycle points —
   no visible gaps or sphere-beads, cruising or breaching.
4. Breach shows the gaping tooth-ringed maw silhouetted against the sky.
5. HUD reads as warm/cinematic, consistent with the scene.

## Out of scope

Unchanged from v2 (no sound, no AI, no W40k). No layout/choreography changes
beyond what the worm model needs.
