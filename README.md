bluekvirus.github.io
====================

Tim Lauv's homepage — "Arrakis at Dusk": a low-poly Dune battle diorama
rendered in three.js. A Harkonnen spice harvester works a glittering spice
field at dusk while Fremen warriors skirmish with its Harkonnen escort —
tracers, muzzle flashes, explosions, drifting smoke — and Shai-Hulud breaches
on the horizon. Real-time sun + soft shadows, cyber-neon accents in the
effects. The menu is the HUD overlay (bottom-left nav); there are no
in-scene menus. No build step: static files, three.js via CDN import-map.

- Themes rotate by ISO weekday (`js/router.js`): Dune on 1,3,5,7;
  Warhammer 40k reserved for 2,4,6 (falls back to Dune until built).
- Force a theme with `?theme=dune`; `?debug` exposes `window.__arrakis`;
  `?nogl=1` previews the static fallback.
- Fallback ladder: no-JS / no-WebGL static page, reduced-motion still frame,
  and a two-stage fps watchdog (bloom off → shadows off + FX pools halved).
- Tests: `node --test` (router, palette, terrain noise).
- Local preview: `python3 -m http.server 8080`.

Spec and plan live in `docs/superpowers/`.
