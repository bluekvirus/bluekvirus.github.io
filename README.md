bluekvirus.github.io
====================

Tim Lauv's homepage — "Arrakis at Dusk": a low-poly Dune world with
cyber-neon accents, rendered in three.js. No build step: static files,
three.js via CDN import-map.

- Themes rotate by ISO weekday (`js/router.js`): Dune on 1,3,5,7;
  Warhammer 40k reserved for 2,4,6 (falls back to Dune until built).
- Force a theme with `?theme=dune`; `?debug` exposes `window.__arrakis`;
  `?nogl=1` previews the static fallback.
- Tests: `node --test` (router, palette, terrain noise).
- Local preview: `python3 -m http.server 8080`.

Spec and plan live in `docs/superpowers/`.
