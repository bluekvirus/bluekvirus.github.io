bluekvirus.github.io
====================

Tim Lauv's homepage — "Noon Raid": a low-poly Dune battle diorama rendered
in three.js. Under a harsh Arrakis noon — bleached sky, hot pale sand,
short hard shadows from a high sun — a Harkonnen spice-harvesting operation
is caught in a Fremen ambush. The film's legged harvester (a dark,
sand-scoured industrial slab walking on six massive legs) works a
glittering spice bed while a black escort ornithopter patrols overhead and
strafes the Fremen line. The firefight is a real conflict, not a loop:
soldiers on both sides fall to tracer fire (seeded PRNG, never
`Math.random()` per frame), bodies lie on the sand before the desert takes
them, and replacements walk in from each side's own edge of the world —
Fremen from the eastern dunes, Harkonnen from behind the harvester. A
film-style Shai-Hulud (one continuous plated body, gaping tooth-ringed maw)
cruises in on the horizon and breaches once per pass. Every light is
diegetic (sun, muzzle flash, explosion, engine glow, spice glitter) — no
neon.

The camera is subject-fit responsive: a camera-space box fit over tiered
focus points re-frames the scene live on every resize/orientation change,
so the harvester and its battle line stay the unmistakable subject from
ultrawide monitors down to phone portrait — phones frame a tighter slice of
the same shot, with the horizon always in frame. The menu is the warm HUD
overlay (bottom-left nav); there are no in-scene menus. No build step:
static files, three.js via CDN import-map.

- Themes rotate by ISO weekday (`js/router.js`): Dune on 1,3,5,7;
  Warhammer 40k reserved for 2,4,6 (falls back to Dune until built).
- Force a theme with `?theme=dune` (unknown names fall back to Dune);
  `?debug` exposes `window.__arrakis`; `?nogl=1` previews the static
  fallback.
- Fallback ladder: no-JS / no-WebGL static page, reduced-motion still frame
  (a composed moment, casualties included, fully frozen), and a two-stage
  fps watchdog (bloom off → shadows off + FX pools halved).
- Tests: bare `node --test` (router, palette, layout, framing, terrain
  noise, troop attrition).
- Local preview: `python3 -m http.server 8080`.

Spec and plan live in `docs/superpowers/`.
