# Arrakis at Dusk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-HTML homepage of bluekvirus.github.io with a full-viewport low-poly Dune world in three.js (cyber-neon accents), routed by a day-of-week theme switcher (Dune on ISO weekdays 1,3,5,7; Warhammer 40k reserved for 2,4,6).

**Architecture:** A no-build static site. `index.html` hosts an import-map, a minimal HUD overlay, and a static fallback block. `js/router.js` resolves the day's theme and dynamically imports `themes/<name>/main.js`, calling its `mount(container)`. The dune theme is composed of focused modules (noise, terrain, worm, sigils, props, palette) orchestrated by `main.js` (renderer, camera rig, bloom, interaction, adaptive degrade).

**Tech Stack:** three.js 0.170.0 via CDN import-map (`EffectComposer`, `RenderPass`, `UnrealBloomPass` addons). Node's built-in test runner (`node --test`) for pure logic. Python `http.server` + Playwright (MCP browser tools or manual) for browser verification. No npm, no bundler.

**Spec:** `docs/superpowers/specs/2026-07-28-dune-homepage-design.md` — read it before starting.

## Global Constraints

- **No build step.** No `package.json`, no npm installs. Files are served as committed.
- **three.js pinned to `0.170.0`** via jsdelivr import-map. Never float the version.
- **All colors and link data live in `themes/dune/palette.js`** — no hex literals in other theme modules.
- **Node-testable modules must not import `three`**: `js/router.js`, `themes/dune/palette.js`, `themes/dune/noise.js` stay dependency-free.
- **No per-frame allocations** in any `update()`/`tick()` path — reuse module-level scratch `Vector3`/`Quaternion`/`Matrix4` objects.
- **Performance budget:** ≤ ~40 draw calls, ≤ 100k triangles, pixel ratio capped at 2 (1 on small screens), bloom render targets halved on small screens.
- **Theme registry:** `{1:'dune',2:'w40k',3:'dune',4:'w40k',5:'dune',6:'w40k',7:'dune'}` (ISO weekday, Mon=1…Sun=7, visitor-local time). Only `dune` is implemented; anything unimplemented resolves to `dune`.
- **Exact links:** LinkedIn `https://www.linkedin.com/in/timzhiyuanliu` · Projects `https://github.com/bluekvirus` · CV `mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)` · Contact `mailto:bluekvirus@gmail.com`.
- **Browser verification** (used by several tasks): run `python3 -m http.server 8080` from the repo root in the background, then open `http://localhost:8080/?theme=dune` with the Playwright MCP tools (`browser_navigate`, `browser_console_messages`, `browser_take_screenshot`, `browser_evaluate`). "Console clean" means no `error`-level messages.

---

### Task 1: Static shell — HTML, CSS, HUD, fallback

**Files:**
- Modify: `index.html` (full replacement of current content)
- Create: `css/main.css`

**Interfaces:**
- Produces: DOM contract used by all later tasks — `#scene` (canvas container), `#hud`, `#hud-label`, `#fallback`. CSS classes `#fallback.visible` and `body.fallback` reveal the fallback.
- Note: the router `<script type="module">` bootstrap is **not** added here (Task 2 adds it, once `js/router.js` exists) — this keeps the page console-clean at every commit.

- [ ] **Step 1: Replace `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tim Lauv — Arrakis at Dusk</title>
<meta name="description" content="Tim Lauv's portfolio — a low-poly Dune world with cyber-neon accents, rendered in three.js.">
<link rel="stylesheet" href="css/main.css">
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<div id="scene" aria-hidden="true"></div>

<div id="hud">
  <header id="hud-name">TIM LAUV</header>
  <div id="hud-label" hidden></div>
  <nav id="hud-nav" aria-label="Site links">
    <a href="https://www.linkedin.com/in/timzhiyuanliu">LinkedIn</a>
    <a href="https://github.com/bluekvirus">Projects</a>
    <a href="mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)">CV</a>
    <a href="mailto:bluekvirus@gmail.com">Contact</a>
  </nav>
  <footer id="hud-copy">© 2012–2026 innobubble.com</footer>
</div>

<div id="fallback">
  <h1>Tim Lauv</h1>
  <p>This page is normally a 3D dune world — you are viewing the quiet version.</p>
  <ul>
    <li><a href="https://www.linkedin.com/in/timzhiyuanliu">LinkedIn profile</a></li>
    <li><a href="https://github.com/bluekvirus">Open-source projects</a></li>
    <li><a href="mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)">CV (on request)</a></li>
    <li><a href="mailto:bluekvirus@gmail.com">bluekvirus (at) gmail (dot) com</a></li>
  </ul>
  <p>© 2012–2026 innobubble.com</p>
</div>
<noscript><style>#fallback{display:block}#hud{display:none}body{overflow:auto}</style></noscript>
</body>
</html>
```

- [ ] **Step 2: Create `css/main.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  height: 100%; overflow: hidden;
  background: #12081f; color: #eee;
  font-family: "Avenir Next", Avenir, "Segoe UI", Helvetica, sans-serif;
}
body.fallback { overflow: auto; }

#scene { position: fixed; inset: 0; }
#scene canvas { display: block; }

#hud { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
#hud a { pointer-events: auto; }
#hud-name {
  position: absolute; top: 24px; left: 28px;
  font-size: 20px; letter-spacing: 0.4em; color: #ffb347;
  text-shadow: 0 0 8px rgba(255,46,136,.8), 0 0 24px rgba(0,229,255,.5);
}
#hud-nav { position: absolute; bottom: 24px; left: 28px; display: flex; gap: 18px; }
#hud-nav a {
  color: #00e5ff; text-decoration: none; font-size: 13px;
  letter-spacing: .15em; text-transform: uppercase;
  text-shadow: 0 0 6px rgba(0,229,255,.7);
}
#hud-nav a:hover { color: #ff2e88; text-shadow: 0 0 8px rgba(255,46,136,.9); }
#hud-copy { position: absolute; bottom: 24px; right: 28px; font-size: 11px; color: rgba(238,238,238,.5); }
#hud-label {
  position: absolute; top: 46%; left: 50%; transform: translate(-50%, -50%);
  font-size: 14px; letter-spacing: .3em; color: #fff;
  text-shadow: 0 0 10px rgba(255,46,136,.9);
}

#fallback { display: none; padding: 64px 32px; max-width: 640px; margin: 0 auto; }
#fallback.visible { display: block; }
#fallback h1 { color: #ffb347; margin-bottom: 12px; }
#fallback ul { list-style: none; margin: 16px 0; }
#fallback li { margin: 8px 0; }
#fallback a { color: #00e5ff; }

@media (max-width: 600px) {
  #hud-name { font-size: 16px; top: 18px; left: 18px; }
  #hud-nav { left: 18px; bottom: 18px; gap: 12px; flex-wrap: wrap; }
  #hud-copy { right: 18px; bottom: 56px; }
}
```

- [ ] **Step 3: Verify in browser**

Run: `python3 -m http.server 8080` (background, repo root), open `http://localhost:8080/`.
Expected: dark indigo page, neon "TIM LAUV" top-left, 4 nav links bottom-left, copyright bottom-right, console clean. Fallback block not visible.

- [ ] **Step 4: Commit**

```bash
git add index.html css/main.css
git commit -m "feat: static shell with HUD overlay and no-JS fallback"
```

---

### Task 2: Theme router (TDD)

**Files:**
- Create: `js/router.js`
- Create: `tests/router.test.mjs`
- Modify: `index.html` (add bootstrap script before `</body>`)

**Interfaces:**
- Produces: `resolveTheme({date, search, byWeekday?, implemented?}) → string`; `isoWeekday(date) → 1..7`; `boot(container, fallbackEl)` (dynamic-imports `themes/<name>/main.js`, calls `mount(container)`, shows fallback on any failure); `showFallback(fallbackEl)` (also used by Task 3 on WebGL context loss).
- Consumes: DOM contract from Task 1.

- [ ] **Step 1: Write the failing test `tests/router.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, isoWeekday, THEME_BY_WEEKDAY } from '../js/router.js';

// Local-time constructors — July 27 2026 is a Monday.
const MON = new Date(2026, 6, 27), TUE = new Date(2026, 6, 28), WED = new Date(2026, 6, 29),
      THU = new Date(2026, 6, 30), FRI = new Date(2026, 6, 31), SAT = new Date(2026, 7, 1),
      SUN = new Date(2026, 7, 2);
const BOTH = new Set(['dune', 'w40k']);

test('isoWeekday maps Mon..Sun to 1..7', () => {
  assert.equal(isoWeekday(MON), 1);
  assert.equal(isoWeekday(SAT), 6);
  assert.equal(isoWeekday(SUN), 7);
});

test('registry: dune on 1,3,5,7 and w40k on 2,4,6', () => {
  assert.deepEqual(THEME_BY_WEEKDAY, { 1: 'dune', 2: 'w40k', 3: 'dune', 4: 'w40k', 5: 'dune', 6: 'w40k', 7: 'dune' });
});

test('dune days resolve to dune', () => {
  for (const d of [MON, WED, FRI, SUN]) {
    assert.equal(resolveTheme({ date: d, search: '' }), 'dune');
  }
});

test('w40k days resolve to w40k once implemented', () => {
  for (const d of [TUE, THU, SAT]) {
    assert.equal(resolveTheme({ date: d, search: '', implemented: BOTH }), 'w40k');
  }
});

test('unimplemented theme falls back to dune', () => {
  assert.equal(resolveTheme({ date: TUE, search: '' }), 'dune');
});

test('?theme= override wins when implemented', () => {
  assert.equal(resolveTheme({ date: TUE, search: '?theme=dune', implemented: BOTH }), 'dune');
});

test('unknown ?theme= override is ignored', () => {
  assert.equal(resolveTheme({ date: MON, search: '?theme=zzz' }), 'dune');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — cannot find module `../js/router.js`.

- [ ] **Step 3: Implement `js/router.js`**

```js
export const THEME_BY_WEEKDAY = { 1: 'dune', 2: 'w40k', 3: 'dune', 4: 'w40k', 5: 'dune', 6: 'w40k', 7: 'dune' };
export const IMPLEMENTED = new Set(['dune']);
const DEFAULT_THEME = 'dune';

export function isoWeekday(date) {
  const d = date.getDay(); // Sun=0..Sat=6
  return d === 0 ? 7 : d;
}

export function resolveTheme({ date, search, byWeekday = THEME_BY_WEEKDAY, implemented = IMPLEMENTED }) {
  const forced = new URLSearchParams(search).get('theme');
  if (forced && implemented.has(forced)) return forced;
  const theme = byWeekday[isoWeekday(date)];
  return implemented.has(theme) ? theme : DEFAULT_THEME;
}

export function showFallback(fallbackEl) {
  fallbackEl.classList.add('visible');
  document.body.classList.add('fallback');
  const hud = document.getElementById('hud');
  const scene = document.getElementById('scene');
  if (hud) hud.style.display = 'none';
  if (scene) scene.style.display = 'none';
}

export async function boot(container, fallbackEl) {
  try {
    const theme = resolveTheme({ date: new Date(), search: window.location.search });
    const mod = await import(`../themes/${theme}/main.js`);
    await mod.mount(container);
  } catch (err) {
    console.warn('[router] theme mount failed, showing fallback:', err);
    showFallback(fallbackEl);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/`
Expected: all tests PASS.

- [ ] **Step 5: Wire the bootstrap into `index.html`** — insert before `</body>`:

```html
<script type="module">
  import { boot } from './js/router.js';
  boot(document.getElementById('scene'), document.getElementById('fallback'));
</script>
```

- [ ] **Step 6: Verify fallback path in browser**

Open `http://localhost:8080/`. `themes/dune/main.js` does not exist yet, so `boot` must catch the failed import and reveal `#fallback` (styled links page, HUD hidden). Console: one `warn`, no uncaught errors.

- [ ] **Step 7: Commit**

```bash
git add js/router.js tests/router.test.mjs index.html
git commit -m "feat: day-of-week theme router with fallback and tests"
```

---

### Task 3: Dune theme scaffold — renderer, sky, camera rig, bloom

**Files:**
- Create: `themes/dune/palette.js`
- Create: `themes/dune/main.js`
- Create: `tests/palette.test.mjs`

**Interfaces:**
- Consumes: `showFallback` from `js/router.js`; DOM contract from Task 1.
- Produces: `mount(container)` (throws if WebGL unavailable — router shows fallback); `state.updaters` convention — later tasks push `{ update(dt, elapsed, camera), degrade?() }` objects; `state.interactive` array of raycastable meshes (Task 6 fills it); `COLORS` and `SIGILS` from `palette.js`. Debug handle `window.__arrakis = state` when `?debug` is present. `?nogl` forces the no-WebGL path.

- [ ] **Step 1: Write the failing test `tests/palette.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, SIGILS } from '../themes/dune/palette.js';

test('palette exposes the spec colors', () => {
  assert.equal(COLORS.sandLit, 0xe8763a);
  assert.equal(COLORS.sandShadow, 0x4a2d5e);
  assert.equal(COLORS.skyZenith, 0x12081f);
  assert.equal(COLORS.horizon, 0xc2452e);
  assert.equal(COLORS.neonCyan, 0x00e5ff);
  assert.equal(COLORS.neonMagenta, 0xff2e88);
  assert.equal(COLORS.amber, 0xffb347);
});

test('sigil link map matches the spec', () => {
  assert.deepEqual(SIGILS.map(s => [s.id, s.label, s.url]), [
    ['emperor', 'LINKEDIN', 'https://www.linkedin.com/in/timzhiyuanliu'],
    ['guild', 'PROJECTS', 'https://github.com/bluekvirus'],
    ['bene', 'CV', 'mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)'],
    ['fremen', 'CONTACT', 'mailto:bluekvirus@gmail.com'],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: palette tests FAIL (module missing); router tests still PASS.

- [ ] **Step 3: Implement `themes/dune/palette.js`**

```js
// Single source of truth for every color and link in the dune theme.
export const COLORS = {
  sandLit: 0xe8763a,
  sandShadow: 0x4a2d5e,
  skyZenith: 0x12081f,
  horizon: 0xc2452e,
  neonCyan: 0x00e5ff,
  neonMagenta: 0xff2e88,
  amber: 0xffb347,
  fremenBlue: 0x4d9fff,
  emperorGold: 0xffd75e,
  wormHide: 0x3b2a52,
  moonA: 0xd8c9b8,
  moonB: 0xb9a6c9,
  sunlight: 0xffa050,
};

export const SIGILS = [
  { id: 'emperor', label: 'LINKEDIN', color: COLORS.emperorGold, url: 'https://www.linkedin.com/in/timzhiyuanliu' },
  { id: 'guild', label: 'PROJECTS', color: COLORS.neonCyan, url: 'https://github.com/bluekvirus' },
  { id: 'bene', label: 'CV', color: COLORS.neonMagenta, url: 'mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)' },
  { id: 'fremen', label: 'CONTACT', color: COLORS.fremenBlue, url: 'mailto:bluekvirus@gmail.com' },
];
```

- [ ] **Step 4: Run tests to verify they pass** — `node --test tests/` → all PASS.

- [ ] **Step 5: Implement `themes/dune/main.js`**

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette.js';
import { showFallback } from '../../js/router.js';

const FROZEN_TIME = 9; // elapsed seconds shown when prefers-reduced-motion
const CAM_BASE = new THREE.Vector3(0, 90, 260);
const CAM_TARGET = new THREE.Vector3(0, 70, -500);

const state = {
  renderer: null, scene: null, camera: null, composer: null, clock: null,
  rafId: 0, useComposer: true, reduced: false, small: false,
  pointer: { x: 0, y: 0, tx: 0, ty: 0 },
  updaters: [], interactive: [], sigils: null,
  fps: { frames: 0, t: 0, lowSeconds: 0, degraded: false },
};

export async function mount(container) {
  if (!supportsWebGL()) throw new Error('WebGL unavailable');

  state.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  state.small = Math.min(window.innerWidth, window.innerHeight) < 700;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.small ? 1 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopLoop();
    showFallback(document.getElementById('fallback'));
  });

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.horizon, 0.00055);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 8000);
  camera.position.copy(CAM_BASE);

  scene.add(buildSky(), buildStars(), ...buildMoons());
  const sun = new THREE.DirectionalLight(COLORS.sunlight, 1.4);
  sun.position.set(-600, 220, -400);
  scene.add(sun, new THREE.AmbientLight(COLORS.sandShadow, 0.9));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomRes = new THREE.Vector2(window.innerWidth, window.innerHeight)
    .multiplyScalar(state.small ? 0.5 : 1);
  composer.addPass(new UnrealBloomPass(bloomRes, 0.85, 0.55, 0.5));

  Object.assign(state, { renderer, scene, camera, composer, clock: new THREE.Clock() });

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));

  if (new URLSearchParams(window.location.search).has('debug')) window.__arrakis = state;
  startLoop();
}

function supportsWebGL() {
  if (new URLSearchParams(window.location.search).has('nogl')) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(COLORS.skyZenith) },
      bottom: { value: new THREE.Color(COLORS.horizon) },
    },
    vertexShader: `varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPos; uniform vec3 top; uniform vec3 bottom;
      void main() {
        float h = clamp(pow(max(normalize(vPos).y, 0.0), 0.6), 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, h), 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(3500, 24, 16), mat);
}

function buildStars() {
  const N = 600;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 150 + Math.random() * 2600;
    const r = Math.sqrt(Math.max(0, 3200 * 3200 - y * y));
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 2, transparent: true, opacity: 0.8, fog: false, sizeAttenuation: false,
  }));
}

function buildMoons() {
  const a = new THREE.Mesh(new THREE.IcosahedronGeometry(60, 1), new THREE.MeshBasicMaterial({ color: COLORS.moonA, fog: false }));
  a.position.set(900, 700, -2600);
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(36, 1), new THREE.MeshBasicMaterial({ color: COLORS.moonB, fog: false }));
  b.position.set(-1200, 420, -2800);
  return [a, b];
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
  state.composer.setSize(w, h);
}

function onPointerMove(e) {
  state.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
  state.pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
}

function startLoop() {
  if (state.rafId) return;
  state.clock.getDelta(); // flush time accumulated while hidden
  state.rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
}

function tick() {
  state.rafId = requestAnimationFrame(tick);
  const dt = state.clock.getDelta();
  const edt = state.reduced ? 0 : dt;
  const elapsed = state.reduced ? FROZEN_TIME : state.clock.elapsedTime;

  state.pointer.x += (state.pointer.tx - state.pointer.x) * 0.05;
  state.pointer.y += (state.pointer.ty - state.pointer.y) * 0.05;
  state.camera.position.set(
    CAM_BASE.x + 40 * Math.sin(elapsed * 0.05) + state.pointer.x * 18,
    CAM_BASE.y + 6 * Math.sin(elapsed * 0.083) - state.pointer.y * 10,
    CAM_BASE.z + 25 * Math.cos(elapsed * 0.04),
  );
  state.camera.lookAt(CAM_TARGET);

  for (const u of state.updaters) u.update(edt, elapsed, state.camera);

  watchFps(dt);
  if (state.useComposer) state.composer.render();
  else state.renderer.render(state.scene, state.camera);
}

function watchFps(dt) {
  const f = state.fps;
  if (f.degraded) return;
  f.frames++;
  f.t += dt;
  if (f.t < 1) return;
  const fps = f.frames / f.t;
  f.frames = 0;
  f.t = 0;
  f.lowSeconds = fps < 25 ? f.lowSeconds + 1 : 0;
  if (f.lowSeconds >= 3) {
    f.degraded = true;
    state.useComposer = false; // emissives still read as neon, just without halo
    for (const u of state.updaters) u.degrade && u.degrade();
  }
}
```

- [ ] **Step 6: Verify in browser**

Open `http://localhost:8080/?theme=dune`:
- gradient dusk sky (ember horizon → indigo zenith), stars, two pale moons; console clean.
- camera drifts slowly; moving the mouse shifts the view subtly.

Open `http://localhost:8080/?nogl=1`: static fallback shown, HUD hidden.

- [ ] **Step 7: Commit**

```bash
git add themes/dune/palette.js themes/dune/main.js tests/palette.test.mjs
git commit -m "feat: dune theme scaffold - renderer, dusk sky, camera rig, bloom"
```

---

### Task 4: Terrain — noise + low-poly dunes (TDD on noise)

**Files:**
- Create: `themes/dune/noise.js` (pure math — no three import, Node-testable)
- Create: `themes/dune/terrain.js`
- Create: `tests/noise.test.mjs`
- Modify: `themes/dune/main.js` (add terrain to scene)

**Interfaces:**
- Produces: `duneHeight(x, z) → number` (world-space terrain height; consumed by Tasks 5 and 7); `createTerrain() → THREE.Mesh`.
- Consumes: `COLORS` from `palette.js`.

- [ ] **Step 1: Write the failing test `tests/noise.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { duneHeight } from '../themes/dune/noise.js';

test('deterministic: same input, same output', () => {
  assert.equal(duneHeight(123.4, -567.8), duneHeight(123.4, -567.8));
});

test('bounded: |height| < 150 across the terrain extent', () => {
  for (let x = -2000; x <= 2000; x += 97) {
    for (let z = -2000; z <= 2000; z += 89) {
      const h = duneHeight(x, z);
      assert.ok(Number.isFinite(h) && Math.abs(h) < 150, `h(${x},${z}) = ${h}`);
    }
  }
});

test('corridor near origin is flatter than the far field', () => {
  let near = 0, far = 0, n = 0;
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2;
    near += Math.abs(duneHeight(Math.cos(a) * 150, -250 + Math.sin(a) * 150));
    far += Math.abs(duneHeight(Math.cos(a) * 1600, -250 + Math.sin(a) * 1600));
    n++;
  }
  assert.ok(near / n < far / n, `near avg ${near / n} should be < far avg ${far / n}`);
});
```

- [ ] **Step 2: Run test to verify it fails** — `node --test tests/` → noise tests FAIL (module missing).

- [ ] **Step 3: Implement `themes/dune/noise.js`**

```js
// Pure, deterministic terrain height field. No dependencies (Node-testable).
function fract(x) { return x - Math.floor(x); }
function hash(ix, iz) { return fract(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123); }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function duneHeight(x, z) {
  // long diagonal swells — the big dune ridges
  let h = 42 * Math.sin(x * 0.0021 + z * 0.0013)
        + 28 * Math.sin(x * 0.0011 - z * 0.0027 + 1.7);
  // mid and fine octaves
  h += 30 * valueNoise(x * 0.004, z * 0.004);
  h += 12 * valueNoise(x * 0.012, z * 0.012);
  h += 4 * valueNoise(x * 0.035, z * 0.035);
  // flatten a corridor around the worm/sigil zone so the composition reads
  const d = Math.min(1, Math.hypot(x, z + 250) / 900);
  return h * (0.35 + 0.65 * d);
}
```

- [ ] **Step 4: Run tests to verify they pass** — `node --test tests/` → all PASS.

- [ ] **Step 5: Implement `themes/dune/terrain.js`**

```js
import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';

const SIZE = 4000;
const SEGMENTS = 128; // 128x128x2 = ~33k triangles, within the 100k budget

export function createTerrain() {
  let geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, duneHeight(p.getX(i), p.getZ(i)));

  // Non-indexed + per-face colors = faceted low-poly shading, unlit (never blooms).
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const lit = new THREE.Color(COLORS.sandLit), shadow = new THREE.Color(COLORS.sandShadow);
  const sun = new THREE.Vector3(-0.55, 0.5, 0.35).normalize();
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const shade = Math.pow(Math.max(0, n.dot(sun)), 0.75);
    c.copy(shadow).lerp(lit, shade);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}
```

- [ ] **Step 6: Wire into `main.js`** — add the import and, in `mount` right after the lights are added:

```js
import { createTerrain } from './terrain.js';   // top of file
scene.add(createTerrain());                     // in mount(), after scene.add(sun, ...)
```

- [ ] **Step 7: Verify in browser**

Open `http://localhost:8080/?theme=dune`: faceted orange/violet dunes rolling to an ember horizon with no visible seam between fog and sky; console clean. Screenshot for the record.

- [ ] **Step 8: Commit**

```bash
git add themes/dune/noise.js themes/dune/terrain.js tests/noise.test.mjs themes/dune/main.js
git commit -m "feat: procedural low-poly dune terrain with baked dusk shading"
```

---

### Task 5: Sandworm — instanced segments, breach cycle, sand spray

**Files:**
- Create: `themes/dune/worm.js`
- Modify: `themes/dune/main.js` (add worm, register updater)

**Interfaces:**
- Produces: `createWorm() → { group: THREE.Group, update(dt, elapsed) }`.
- Consumes: `duneHeight` from `noise.js`, `COLORS` from `palette.js`, updater convention from Task 3 (frozen `elapsed`/zero `dt` under reduced motion stills the worm).

- [ ] **Step 1: Implement `themes/dune/worm.js`**

```js
import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';

const SEG_COUNT = 30;
const SPACING = 0.014; // curve-parameter gap between segments
const CYCLE = 36;      // seconds per full path loop

const _pos = new THREE.Vector3(), _tan = new THREE.Vector3();
const _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function wrap(t) { return ((t % 1) + 1) % 1; }

function buildPath() {
  const cx = 0, cz = -600, r = 420, n = 12;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r * 0.7;
    // mostly underground; one arc breaches high above the dunes
    const lift = i === 3 ? 150 : (i === 2 || i === 4) ? 40 : -70;
    pts.push(new THREE.Vector3(x, duneHeight(x, z) + lift, z));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

function createSpray() {
  const COUNT = 240;
  const positions = new Float32Array(COUNT * 3).fill(-99999);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: COLORS.amber, size: 5, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;

  function burst(origin) {
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      positions[j] = origin.x; positions[j + 1] = origin.y; positions[j + 2] = origin.z;
      velocities[j] = (Math.random() - 0.5) * 90;
      velocities[j + 1] = 60 + Math.random() * 90;
      velocities[j + 2] = (Math.random() - 0.5) * 90;
      life[i] = 1.2 + Math.random() * 0.8;
    }
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] <= 0) continue;
      dirty = true;
      life[i] -= dt;
      const j = i * 3;
      velocities[j + 1] -= 160 * dt; // gravity
      positions[j] += velocities[j] * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += velocities[j + 2] * dt;
      if (life[i] <= 0) positions[j + 1] = -99999;
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return { points, burst, update };
}

export function createWorm() {
  const curve = buildPath();
  const group = new THREE.Group();

  const body = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: COLORS.wormHide, flatShading: true, roughness: 0.9 }),
    SEG_COUNT,
  );
  const rings = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.06, 6, 14),
    new THREE.MeshBasicMaterial({ color: COLORS.neonCyan }),
    SEG_COUNT,
  );
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const spray = createSpray();
  group.add(body, rings, spray.points);

  let wasAbove = false;

  function update(dt, elapsed) {
    const head = wrap(elapsed / CYCLE);
    for (let i = 0; i < SEG_COUNT; i++) {
      const t = wrap(head - i * SPACING);
      curve.getPointAt(t, _pos);
      curve.getTangentAt(t, _tan);
      _quat.setFromUnitVectors(Z_AXIS, _tan);
      const s = 15 * (1 - (i / SEG_COUNT) * 0.75); // head 15 → tail ~3.8
      _scale.setScalar(s);
      _mat.compose(_pos, _quat, _scale);
      body.setMatrixAt(i, _mat);
      _scale.multiplyScalar(1.12);
      _mat.compose(_pos, _quat, _scale);
      rings.setMatrixAt(i, _mat);
      if (i === 0 && dt > 0) {
        const above = _pos.y > duneHeight(_pos.x, _pos.z) + 8;
        if (above !== wasAbove) spray.burst(_pos);
        wasAbove = above;
      }
    }
    body.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    spray.update(dt);
  }

  return { group, update };
}
```

- [ ] **Step 2: Wire into `main.js`** — add the import; in `mount`, after the terrain line:

```js
import { createWorm } from './worm.js';   // top of file
const worm = createWorm();                // in mount()
scene.add(worm.group);
state.updaters.push(worm);
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:8080/?theme=dune` and watch one full cycle (~36 s): the worm cruises under the dune line, breaches in a slow arc with cyan ring glow, amber spray bursts on surfacing and diving. Console clean. If the breach happens off-camera, adjust `buildPath`'s `cz`/`r` so the arc (control point `i === 3`) sits in view of `CAM_TARGET` (0, 70, -500).

- [ ] **Step 4: Commit**

```bash
git add themes/dune/worm.js themes/dune/main.js
git commit -m "feat: instanced sandworm with breach cycle and sand spray"
```

---

### Task 6: Faction sigils — holograms, raycast hover, click-through

**Files:**
- Create: `themes/dune/sigils.js`
- Modify: `themes/dune/main.js` (add sigils, raycasting, HUD label, click handling)

**Interfaces:**
- Produces: `createSigils() → { group, meshes, setHover(mesh|null), update(dt, elapsed, camera) }`; each mesh's `userData = { url, label, baseY, hovered }`.
- Consumes: `SIGILS` from `palette.js`; `state.interactive` from Task 3; `#hud-label` element from Task 1.

- [ ] **Step 1: Implement `themes/dune/sigils.js`**

```js
import * as THREE from 'three';
import { SIGILS } from './palette.js';

function drawGlyph(id, colorHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  g.strokeStyle = col; g.lineWidth = 9; g.lineCap = 'round';
  g.shadowColor = col; g.shadowBlur = 22;
  g.translate(128, 128);
  if (id === 'emperor') {        // stacked chevrons — the throne
    for (const y of [-30, 0, 30]) {
      g.beginPath(); g.moveTo(-60, y + 30); g.lineTo(0, y - 20); g.lineTo(60, y + 30); g.stroke();
    }
  } else if (id === 'guild') {   // circle + orbit — folded space
    g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(0, 0, 84, 26, -0.5, 0, Math.PI * 2); g.stroke();
  } else if (id === 'bene') {    // twin crescents — the sisterhood
    g.beginPath(); g.arc(10, 0, 60, Math.PI * 0.35, Math.PI * 1.65); g.stroke();
    g.beginPath(); g.arc(34, 0, 40, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
  } else {                       // fremen — dune waves
    g.beginPath(); g.moveTo(-70, 30); g.quadraticCurveTo(-20, -10, 30, 30);
    g.quadraticCurveTo(60, 50, 78, 36); g.stroke();
    g.beginPath(); g.moveTo(-40, -20); g.quadraticCurveTo(10, -70, 62, -34); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export function createSigils() {
  const group = new THREE.Group();
  const meshes = [];
  const xs = [-280, -95, 95, 280];
  SIGILS.forEach((s, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({
        map: drawGlyph(s.id, s.color), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(xs[i], 170 + (i % 2) * 22, -700);
    mesh.userData = { url: s.url, label: s.label, baseY: mesh.position.y, hovered: false };
    group.add(mesh);
    meshes.push(mesh);
  });

  return {
    group, meshes,
    setHover(target) { for (const m of meshes) m.userData.hovered = m === target; },
    update(dt, elapsed, camera) {
      meshes.forEach((m, i) => {
        m.position.y = m.userData.baseY + 4 * Math.sin(elapsed * 0.5 + i * 1.3);
        m.quaternion.copy(camera.quaternion); // billboard
        const target = m.userData.hovered ? 1.2 : 1;
        m.scale.x += (target - m.scale.x) * 0.12;
        m.scale.y = m.scale.x;
        m.material.opacity += ((m.userData.hovered ? 1 : 0.85) - m.material.opacity) * 0.12;
      });
    },
  };
}
```

- [ ] **Step 2: Wire into `main.js`.** Add the import; in `mount`, after the worm lines:

```js
import { createSigils } from './sigils.js';   // top of file

const sigils = createSigils();                // in mount()
scene.add(sigils.group);
state.updaters.push(sigils);
state.sigils = sigils;
state.interactive = sigils.meshes;
renderer.domElement.addEventListener('click', onClick);
```

Add module-level raycasting helpers and handlers (near `onPointerMove`):

```js
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function pick(e) {
  if (!state.interactive.length) return null;
  _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  _raycaster.setFromCamera(_ndc, state.camera);
  const hit = _raycaster.intersectObjects(state.interactive)[0];
  return hit ? hit.object : null;
}

function onClick(e) {
  const m = pick(e);
  if (!m) return;
  const url = m.userData.url;
  if (url.startsWith('mailto:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}
```

Extend `onPointerMove` to drive hover state, cursor, and the HUD label:

```js
function onPointerMove(e) {
  state.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
  state.pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  if (!state.sigils) return;
  const m = pick(e);
  state.sigils.setHover(m);
  state.renderer.domElement.style.cursor = m ? 'pointer' : 'default';
  const label = document.getElementById('hud-label');
  label.hidden = !m;
  label.textContent = m ? m.userData.label : '';
}
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:8080/?theme=dune&debug`:
- four neon glyphs float above the horizon, bobbing gently;
- hovering one brightens/enlarges it, shows its label mid-screen, and sets the pointer cursor;
- `browser_evaluate`: `window.__arrakis.interactive.map(m => m.userData.url)` returns the four spec URLs in order (LinkedIn, GitHub, CV mailto, contact mailto);
- console clean.

- [ ] **Step 4: Commit**

```bash
git add themes/dune/sigils.js themes/dune/main.js
git commit -m "feat: clickable faction sigil holograms with hover labels"
```

---

### Task 7: Props — spice particle fields and resource tokens

**Files:**
- Create: `themes/dune/props.js`
- Modify: `themes/dune/main.js` (add props, register updater)

**Interfaces:**
- Produces: `createProps({ small }) → { group, update(dt, elapsed), degrade() }` — `degrade()` halves each cluster's draw range (called by the fps watchdog from Task 3).
- Consumes: `duneHeight` from `noise.js`, `COLORS` from `palette.js`, `state.small` from Task 3.

- [ ] **Step 1: Implement `themes/dune/props.js`**

```js
import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';

const CLUSTERS = [[-380, -420], [240, -520], [-60, -300], [460, -720]];

export function createProps({ small = false } = {}) {
  const group = new THREE.Group();
  const pointsList = [];
  const perCluster = small ? 180 : 400;
  const amber = new THREE.Color(COLORS.amber), cyan = new THREE.Color(COLORS.neonCyan);

  for (const [cx, cz] of CLUSTERS) {
    const pos = new Float32Array(perCluster * 3);
    const col = new Float32Array(perCluster * 3);
    for (let i = 0; i < perCluster; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 70;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos.set([x, duneHeight(x, z) + 2 + Math.random() * 5, z], i * 3);
      const c = Math.random() < 0.8 ? amber : cyan;
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3.5, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(pts);
    pointsList.push(pts);
  }

  // Board-game resource tokens: spice / water / solari as drifting wireframes.
  const tokens = [
    new THREE.Mesh(new THREE.TetrahedronGeometry(9), new THREE.MeshBasicMaterial({ color: COLORS.amber, wireframe: true })),
    new THREE.Mesh(new THREE.OctahedronGeometry(8), new THREE.MeshBasicMaterial({ color: COLORS.fremenBlue, wireframe: true })),
    new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 2, 12), new THREE.MeshBasicMaterial({ color: COLORS.emperorGold, wireframe: true })),
  ];
  tokens.forEach((t, i) => {
    t.position.set(-140 + i * 140, 120, -420);
    group.add(t);
  });

  return {
    group,
    update(dt, elapsed) {
      pointsList.forEach((p, i) => { p.material.opacity = 0.65 + 0.3 * Math.sin(elapsed * 2 + i); });
      tokens.forEach((t, i) => {
        t.rotation.y += dt * 0.4;
        t.rotation.x += dt * 0.15;
        t.position.y = 120 + 8 * Math.sin(elapsed * 0.7 + i * 2);
      });
    },
    degrade() {
      for (const p of pointsList) p.geometry.setDrawRange(0, Math.floor(perCluster / 2));
    },
  };
}
```

- [ ] **Step 2: Wire into `main.js`** — add the import; in `mount`, after the sigil lines:

```js
import { createProps } from './props.js';       // top of file
const props = createProps({ small: state.small }); // in mount()
scene.add(props.group);
state.updaters.push(props);
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:8080/?theme=dune`: amber/cyan spice glitter pulsing on the dune faces; three wireframe tokens drifting and rotating above the terrain. Console clean.

- [ ] **Step 4: Commit**

```bash
git add themes/dune/props.js themes/dune/main.js
git commit -m "feat: spice particle fields and holographic resource tokens"
```

---

### Task 8: Final QA sweep, tuning, README

**Files:**
- Modify: `README.md`
- Modify (tuning only, if needed): `themes/dune/main.js`, `themes/dune/worm.js`

**Interfaces:**
- Consumes: everything. Produces: the verified, documented final state.

- [ ] **Step 1: Run the full Node suite**

Run: `node --test tests/`
Expected: router + palette + noise tests all PASS.

- [ ] **Step 2: Full Playwright sweep** (server running, viewport ~1280×800)

1. `http://localhost:8080/` → renders the dune scene (today may be any weekday; w40k days fall back to dune). Console clean.
2. `http://localhost:8080/?theme=dune&debug` → `browser_evaluate` `window.__arrakis.interactive.map(m => m.userData.url)` equals the four spec URLs; `window.__arrakis.renderer.info.render.calls` ≤ 40 and `window.__arrakis.renderer.info.render.triangles` ≤ 100000.
3. `http://localhost:8080/?theme=zzz` → still mounts dune (override ignored).
4. `http://localhost:8080/?nogl=1` → static fallback visible, HUD hidden, console has the router warn only.
5. Screenshot the main scene at two moments (worm underground / worm breaching) and inspect composition: horizon seam invisible, sigils legible, terrain not blooming.
6. Resize the browser window → canvas follows, no distortion.

- [ ] **Step 3: Composition & bloom tuning pass**

Judge the screenshots against the spec's effect goals; adjust only these knobs, then re-screenshot:
- bloom: `UnrealBloomPass(res, strength, radius, threshold)` in `main.js` — raise `threshold` toward 0.6 if sand/sky bloom, raise `strength` toward 1.1 if neon feels flat;
- fog density `0.00055` in `main.js` — lower if the worm zone is too hazy;
- worm path `cz`/`r`/`lift` in `worm.js` — keep the breach arc inside the camera frame.

- [ ] **Step 4: Manual spot-checks** (report results, don't block on perfection)

- Narrow viewport (~iPhone size via browser resize): HUD wraps, sigils still tappable-size, pixel ratio 1 path.
- OS reduced-motion enabled (macOS: System Settings → Accessibility → Display → Reduce motion), reload: static vista, sigil hover still works.

- [ ] **Step 5: Replace `README.md`**

```markdown
bluekvirus.github.io
====================

Tim Lauv's homepage — "Arrakis at Dusk": a low-poly Dune world with
cyber-neon accents, rendered in three.js. No build step: static files,
three.js via CDN import-map.

- Themes rotate by ISO weekday (`js/router.js`): Dune on 1,3,5,7;
  Warhammer 40k reserved for 2,4,6 (falls back to Dune until built).
- Force a theme with `?theme=dune`; `?debug` exposes `window.__arrakis`;
  `?nogl=1` previews the static fallback.
- Tests: `node --test tests/` (router, palette, terrain noise).
- Local preview: `python3 -m http.server 8080`.

Spec and plan live in `docs/superpowers/`.
```

- [ ] **Step 6: Commit**

```bash
git add README.md themes/dune/main.js themes/dune/worm.js
git commit -m "chore: final QA sweep, bloom tuning, README refresh"
```

---

## Plan Self-Review Notes

- **Spec coverage:** rotation registry + override + fallback (Task 2); sky/moons/stars/fog/tone-mapping/camera/parallax/bloom/reduced-motion/visibility-pause/adaptive-degrade/context-loss (Task 3); terrain + palette + seam (Tasks 3–4); worm + spray (Task 5); sigils + link map + hover/click + HUD label (Task 6); spice + tokens (Task 7); perf budget assertions + mobile + README (Task 8). No-JS/no-WebGL fallback (Tasks 1–3).
- **Deviation from spec (intentional):** the pure height field lives in `noise.js` (spec listed it inside `terrain.js`) so Node tests can import it without three.js. `?nogl` and `?debug` are tiny test affordances beyond the spec.
- **Type consistency:** updater contract is `update(dt, elapsed, camera)` everywhere; worm/props receive `dt = 0` and frozen `elapsed` under reduced motion (worm guards spray with `dt > 0`).
