# Design: Poly Soldier — a modular low-poly figure in Babylon.js

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan

## Goal

A standalone page showing a single low-poly soldier standing centred on a small
base, presented like a tabletop miniature. The figure is built procedurally in
Babylon.js from a **modular parts library**, so that helmets, heads, vests, packs
and weapons are interchangeable and a second figure is a config rather than new
code.

Style target: the Synty POLYGON Military Pack look (reference images held locally
in `refs/`, gitignored as third-party promotional art). Chunky faceted forms,
flat shading, solid untextured colour panels, a smooth visor-like face with no
facial detail, slightly oversized head, blocky boots and mitten hands.

## Scope

**In:** one soldier, one base, studio lighting, neutral backdrop, turntable camera
with drag-orbit and scroll-zoom, and the parts/socket/loadout architecture that
makes the figure modular.

**Out:** any scene or environment, multiple figures, animation beyond the camera
turntable, navigation or site chrome, changes to the existing `index.html`.

## Decisions

- **Procedural, not imported assets.** The refs are style inspiration only; no
  Synty files are used, so there is no licence question and every dimension stays
  tweakable in code.
- **Standalone page.** Lives under `soldier/`; the existing portfolio `index.html`
  is untouched.
- **No build step.** Babylon.js from its CDN, plain ES modules, consistent with how
  this repo already deploys (push = deploy on GitHub Pages).

## Architecture

```
soldier/
  index.html        shell: canvas, Babylon CDN script, module bootstrap
  main.js           creates engine + scene, starts the render loop
  stage.js          camera rig, three-point lighting, ground shadow, backdrop, base
  soldier.js        assembles a figure from a loadout config
  loadouts.js       named loadout configs (the first figure is one entry)
  palette.js        colour constants and the shared material set
  parts/
    body.js         torso, arms, legs, hands, boots + the socket definitions
    heads.js        head variants (bare, bearded, masked)
    helmets.js      helmet variants
    vests.js        chest rigs / plate carriers with pouches
    packs.js        backpacks and back-mounted gear
    weapons.js      rifle variants
```

### Parts are independent factories

Every part is a function that returns geometry and knows nothing about the figure
assembling it — no part positions itself in world space or references another
part. Adding a helmet means adding one function to `helmets.js`.

### Sockets, not hardcoded positions

`body.js` exposes named attachment points as Babylon `TransformNode`s: `head`,
`back`, `chest`, `hips`, `handR`, `handL`. Parts attach by parenting to a socket,
so any helmet fits any head and any weapon fits the hand without per-combination
tuning. Socket positions are the single source of truth for where things sit.

### Loadout config drives assembly

A figure is described by a plain object — which body, head, helmet, vest, pack,
weapon and colourway. `soldier.js` reads it and assembles. A second soldier is a
new entry in `loadouts.js`; a squad is a list.

### Shared material slots

A small named set — fatigues, vest, gear, boots, skin, metal, wood — defined once
in `palette.js` and shared by every part, rather than each part creating its own.
A faction recolour is a palette edit, and sharing keeps draw calls low.

### Repeats instance

Where the same part appears more than once (now: nothing; later: a squad), it
renders as Babylon instances of one geometry rather than duplicated meshes.

## Presentation

- Soldier centred on a small round base, like a miniature's plinth.
- Three-point studio lighting (key, fill, rim) plus a soft contact shadow
  anchoring the figure to the base.
- Clean neutral gradient backdrop — no environment, no scenery.
- Camera slowly turntables; drag to orbit, scroll to zoom (Babylon
  `ArcRotateCamera`, damped, with sensible zoom limits).
- Flat/faceted shading throughout — the low-poly facets must read clearly.

### Articulated joint hierarchy (added 2026-07-29 — the figure must animate)

The end goal is soldiers that fight on a tactical map: moving, shooting, reloading,
close-quarter combat. That makes the figure an **articulated rig from the start**,
not a merged static mesh.

Because the style is blocky and rigid, this needs **no skinning and no bones** —
each limb segment is its own mesh parented to a joint `TransformNode`, and
animation is joint rotation. A `Blockbench`-style rigid hierarchy:

```
root
└ pelvis ── hips ── thighL/R ── shinL/R ── footL/R
   └ spine ── chest ── (socket: chest, back)
        ├ neck ── head (socket: head)
        ├ shoulderL ── upperArmL ── forearmL ── handL (socket)
        └ shoulderR ── upperArmR ── forearmR ── handR (socket)
```

Consequences:
- Parts attach to joints, so sockets and the rig are the same mechanism.
- Poses and animations are data: named joint-rotation sets, interpolated over time.
  A pose library (`idle`, `aim`, `walk`, `reload`) sits in its own module.
- Merging geometry is limited to *within* a joint (e.g. all of a vest's pouches),
  never across joints, so articulation survives.

## Roadmap (user-defined build order)

Each stage renders and is reviewed before the next begins.

1. **Single soldier** — the rigged figure standing in a neutral idle on its base.
2. **Soldier holding a gun** — weapon in the hand socket, arms posed to grip it,
   both hands correctly placed on the weapon.
3. **Move with gun** — a walk/advance cycle driven by joint rotation, weapon held.
4. **Shoot and reload** — firing pose with recoil and muzzle flash; a reload
   sequence (magazine out, in, charging handle).

Only after stage 4 do we add more figures, factions or a map.

## Budgets

Roughly 1-3k triangles for the figure. Merged only within joints, so expect on the
order of 15-25 meshes rather than a handful — articulation costs draw calls and
that is the correct trade here. This is a single-figure display page; the budget
exists to keep the modular structure honest, not because the hardware is stressed.

## Verification

- The page loads with no console errors and renders the figure.
- Visual check against the refs: proportions read as Synty-style (oversized head,
  chunky limbs, visor face), colours are flat and untextured, facets are visible.
- Swapping one loadout field (e.g. a different helmet) changes the figure without
  touching `soldier.js` — proving the modularity is real, not nominal.
- Resizing the window keeps the figure centred and correctly framed.

## Working method

Build the minimum that renders a figure, then **show a screenshot and iterate on
proportions and colour together** before adding parts variety or polish. The
previous project in this repo was over-built in isolation and discarded; this one
checks the look early and often.
