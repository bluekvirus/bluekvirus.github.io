# Design: "Arrakis at Dusk" — Rotating-Theme Homepage

**Date:** 2026-07-28
**Repo:** bluekvirus.github.io (GitHub Pages user site, served from `master` root)
**Status:** Approved design, pending implementation plan

## Goal

Replace the current plain-HTML portfolio homepage with a full-viewport 3D art
piece built in three.js: a low-poly Dune world with cyber-neon accents, drawing
on Dune Imperium board-game concepts. Portfolio links survive only as a minimal
HUD overlay and as clickable in-scene faction sigils. The page rotates themes
by day of week; a Warhammer 40k theme will be added later.

## Decisions (from brainstorming)

- **Purpose:** pure art piece; portfolio content reduced to a minimal HUD + in-scene links.
- **Motifs:** desert terrain, sandworm, faction/House iconography, board-game elements — all four.
- **Interactivity:** guided cinematic — autonomous camera drift, damped mouse
  parallax, clickable sigils. No free navigation, no scroll journey.
- **Library:** three.js (d3 rejected — wrong tool for 3D scenes).
- **Tooling:** no build step. Plain ES modules committed to the repo; three.js
  and addons loaded via CDN import-map. Push = deploy.
- **Theme rotation:** ISO weekday (Mon=1 … Sun=7) from the visitor's local
  clock. Days 1,3,5,7 → Dune; days 2,4,6 → Warhammer 40k.
- **W40k fallback:** until the W40k theme is built, every day routes to Dune.
  No public placeholder.

## Architecture

### Theme router

`index.html` contains a small router (`js/router.js`) that:

1. Reads `?theme=<name>` from the URL — if present and registered, use it
   (development/preview override).
2. Otherwise computes ISO weekday (JS `getDay()` mapped so Mon=1 … Sun=7) and
   looks it up in a registry: `{1: 'dune', 2: 'w40k', 3: 'dune', 4: 'w40k',
   5: 'dune', 6: 'w40k', 7: 'dune'}`.
3. If the resolved theme is not yet implemented (w40k), falls back to `dune`.
4. Dynamically imports `themes/<name>/main.js` and calls its exported
   `mount(container)`.

Each theme is a self-contained folder exposing `mount(container)`. Adding the
W40k theme later means adding `themes/w40k/` and marking it implemented in the
registry — no other changes.

### File structure

```
index.html          — shell: import-map, HUD markup, noscript/no-WebGL fallback, router bootstrap
css/main.css        — HUD overlay, fonts, fallback page styling
js/router.js        — weekday → theme registry, dynamic import, mount
themes/dune/
  main.js           — renderer, camera rig, bloom composer, resize, animation loop, raycasting
  terrain.js        — procedural low-poly dune terrain
  worm.js           — segmented sandworm + breach animation
  sigils.js         — 4 faction holograms (the clickable menu)
  props.js          — spice particle fields + resource-token holograms
  palette.js        — shared color constants and link map
```

Dependencies: `three` and `three/addons/` (EffectComposer, RenderPass,
UnrealBloomPass) via CDN import-map pinned to a specific version. No npm, no
bundler, no model/texture asset files — all geometry is procedural.

## Scene composition (theme: dune)

- **Terrain:** one large `PlaneGeometry` displaced by layered pseudo-noise
  (sum of sines / hash noise — no external noise lib) into rolling dunes.
  Flat shading with non-indexed geometry for faceted low-poly look. Vertex
  colors grade from deep orange (lit faces) to violet (shadow). Exponential
  fog fades terrain into the horizon.
- **Sky:** large gradient backdrop (shader on a sphere or scene background +
  fog), faint stars, and Dune's two low-poly moons at different sizes/heights.
- **Sandworm:** ~30 tapered ring segments (cylinder/torus-ring geometry)
  positioned along a `CatmullRomCurve3`. The path animates on a loop: cruise
  beneath the dune line, breach in a slow arc above the surface, dive. Emissive
  cyan rim accents on segment edges. A short-lived particle burst (sand spray)
  triggers at breach and dive points.
- **Spice fields:** a few `Points` clusters on dune faces, amber with cyan
  sparkle, sizes/opacity pulsing gently.
- **Faction sigils:** four holograms floating in a shallow arc above the
  horizon — Emperor, Spacing Guild, Bene Gesserit, Fremen. Each is simple
  procedural geometry / canvas-texture sprite with emissive neon color.
  They are the menu (raycaster on pointer):
  - mouse hover → brighten + show text label; click → open link (see Link map)
  - touch devices → tap opens the link directly (no hover state; labels are
    covered by the HUD nav)
- **Board-game props:** small emissive wireframe tokens — spice, water,
  solari icons — drifting slowly above the terrain as holographic flotsam.
  Decorative only, not interactive.
- **Post-processing:** `EffectComposer` with `RenderPass` +
  `UnrealBloomPass`; bloom is the primary cyber-neon device. Glow must stay
  selective: the bloom threshold is tuned so only emissive elements (sigils,
  worm rims, particles, tokens, moons) exceed it — terrain and sky luminance
  stay below threshold so sand never blooms. If threshold tuning proves too
  fragile, fall back to rendering neon elements on a bloom-only layer.
- **Horizon seam:** fog color and the sky gradient's horizon color are the
  same palette constant, so terrain fades into the sky without a visible seam.
- **Camera:** autonomous slow drift along a gentle looping path aimed at the
  worm/horizon; pointer position adds a small damped parallax offset.

### Palette (in `palette.js`, single source of truth)

| Role | Color |
|---|---|
| Sand, lit faces | `#e8763a` (dusk orange) |
| Sand, shadow faces | `#4a2d5e` (violet) |
| Sky zenith | `#12081f` (deep indigo) |
| Sky horizon / fog | `#c2452e` (ember) |
| Neon primary (worm rims, spice sparkle) | `#00e5ff` (cyan) |
| Neon secondary (sigils, accents) | `#ff2e88` (magenta) |
| Spice / amber (particles, tokens) | `#ffb347` (amber) |

Per-sigil emissive tints may vary within the neon range to keep the four
factions distinguishable, but all colors are defined in `palette.js` only.

### Link map (sigil → destination)

| Sigil | Label | Destination |
|---|---|---|
| Emperor | LinkedIn | https://www.linkedin.com/in/timzhiyuanliu |
| Spacing Guild | Projects | https://github.com/bluekvirus |
| Bene Gesserit | CV | mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :) |
| Fremen | Contact | mailto:bluekvirus@gmail.com |

## Performance budget

Targets: 60 fps on a mid-range laptop, ≥30 fps on a mid-range phone.

- **Geometry:** total scene ≤ ~100k triangles. Terrain is one non-indexed
  plane (~120×120 segments ≈ 28k tris, single draw call). Worm segments share
  one geometry + one material via `InstancedMesh` (per-instance matrix for
  taper/position) — 1 draw call for the whole worm.
- **Draw calls:** ≤ ~40 total. Sigils, moons, and tokens each share materials
  where possible; particle clusters are one `Points` object per cluster.
- **Bloom cost:** the composer's render targets run at a resolution scaled to
  min(devicePixelRatio, 2) on desktop and 1 on small screens; bloom pass
  resolution halved on mobile. This is the single biggest perf lever.
- **Per-frame allocations:** none in the animation loop — reuse `Vector3`/
  `Matrix4` scratch objects; worm path sampled into a preallocated buffer.
- **Adaptive degrade:** if measured fps stays < 25 for a few seconds, halve
  particle counts and disable the bloom pass (emissive materials still read
  as neon, just without halo).
- **Tone mapping:** `ACESFilmicToneMapping` — better dusk color response at
  no meaningful cost.

## HUD overlay (HTML/CSS, outside the canvas)

- Top-left: "Tim Lauv" in a neon-styled type treatment.
- Bottom-left: small text nav duplicating the four sigil links (accessibility
  and mobile ergonomics).
- Bottom-right: copyright line ("© 2012–2026 innobubble.com").
- Nothing else; content stays out of the art.

## Fallbacks & accessibility

- **JS disabled:** `<noscript>` block renders a styled static page with the
  same four links.
- **No WebGL:** detected at mount; the same styled static fallback is shown.
  This block is plain HTML in `index.html`, so the page remains indexable.
- **`prefers-reduced-motion`:** camera drift, worm breaching, and particle
  pulsing are stilled; the scene renders as a static vista. Sigils remain
  clickable.
- **Mobile / small screens:** renderer pixel ratio capped (≤2), particle
  counts reduced, sigils sized for tap targets; HUD nav always available.
- **Page visibility:** animation loop pauses when the tab is hidden.

## Error handling

- Router wraps theme `import()`/`mount()` in try/catch; on failure it reveals
  the static fallback block instead of a blank page.
- WebGL context-loss listener shows the fallback rather than a frozen canvas.

## Testing

- Serve locally (`python3 -m http.server`) and verify with Playwright:
  - page loads with zero console errors;
  - canvas renders non-blank (screenshot pixel check);
  - each sigil click targets the correct URL (assert on link handling);
  - HUD nav links are correct;
  - `?theme=dune` override works; unknown/unbuilt theme falls back to dune;
  - WebGL-unavailable path shows the static fallback.
- Manual pass: framerate feel on laptop + phone, composition, bloom intensity.

## Out of scope

- Warhammer 40k theme (folder + registry slot reserved; built later).
- Any build tooling, analytics, CMS, or content beyond the four links.
- External 3D model or texture assets.
