import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette.js';
import { FOCUS, SUN_DIR } from './layout.js';
import { fitFocus } from './framing.js';
import { showFallback } from '../../js/router.js';
import { createTerrain } from './terrain.js';
import { createWorm } from './worm.js';
import { createProps } from './props.js';
import { createHarvester } from './harvester.js';
import { createThopter } from './thopter.js';
import { createTroops } from './troops.js';
import { createCombatFX } from './combatfx.js';

const FROZEN_TIME = 9; // elapsed seconds shown when prefers-reduced-motion

const state = {
  renderer: null, scene: null, camera: null, composer: null, clock: null,
  rafId: 0, useComposer: true, reduced: false, small: false,
  // Subject-fit camera base (position) + look-at target the per-frame
  // drift/parallax oscillates around (see tick()). Recomputed in
  // applyFraming() on mount and on every resize (incl. orientation change)
  // — never touched per frame. FOCUS.bonus (the worm) is deliberately never
  // fed into the fit: the core subject fit is never sacrificed to keep the
  // worm in frame — it's framed only when it happens to fall inside the
  // core-derived frustum for free.
  camBase: new THREE.Vector3(),
  camLookAt: new THREE.Vector3(),
  // wr/1000 from the fitted camera-space box (wr = the binding horizontal
  // half-extent) — drift/parallax amplitudes in tick() are multiplied by
  // this so they stay proportional to the subject size/framing instead of a
  // fixed absolute magnitude.
  driftScale: 1,
  pointer: { x: 0, y: 0, tx: 0, ty: 0 },
  updaters: [],
  fps: { frames: 0, t: 0, lowSeconds: 0, degraded: 0 }, // degraded: stage counter 0|1|2
};

// Camera-space box-fit framing (Task 1, v4 amended): fov is fixed
// (FOCUS.fov); fitFocus() picks the aspect-appropriate focus tiers and view
// direction (viewDirWide at landscape, viewDirTall at portrait, smoothstep
// between — horizon visible at every aspect), box-fits them, and pins the
// horizon in the upper band of the frame. Applies the result to the live
// camera + state.camBase/camLookAt/driftScale. Called at mount and on every
// resize/orientation-change so framing stays live-responsive — never in
// tick(), so this is zero per-frame cost.
function applyFraming(w, h) {
  const aspect = w / h;
  const fit = fitFocus(FOCUS, aspect);
  state.camera.aspect = aspect;
  state.camera.fov = FOCUS.fov;
  state.camera.updateProjectionMatrix();
  state.camBase.set(fit.position[0], fit.position[1], fit.position[2]);
  state.camLookAt.set(fit.lookAt[0], fit.lookAt[1], fit.lookAt[2]);
  state.driftScale = fit.wr / 1000;
}

export async function mount(container) {
  if (!supportsWebGL()) throw new Error('WebGL unavailable');

  state.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Mount-time only: pixel ratio, bloom resolution and particle counts below
  // are sized once from the viewport at load and do not react to later
  // resize/orientation-change (that would mean re-provisioning GPU resources
  // on every rotate). Framing (fov/camera base), by contrast, IS live via
  // applyFraming()/onResize() below — that's the responsive requirement.
  state.small = Math.min(window.innerWidth, window.innerHeight) < 700;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.small ? 1 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Noon exposure: kept just under 1 so the near-overhead sun's highlights
  // (sand, sun disc) don't clip to flat white.
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopLoop();
    showFallback(document.getElementById('fallback'));
  });

  const scene = new THREE.Scene();
  // Daylight heat haze: a lighter, denser distance wash than the dusk fog it
  // replaces (still just a wash — sand itself never blooms).
  scene.fog = new THREE.FogExp2(COLORS.hazeWash, 0.00042);

  const camera = new THREE.PerspectiveCamera(FOCUS.fov, window.innerWidth / window.innerHeight, 0.1, 8000);
  state.camera = camera;
  applyFraming(window.innerWidth, window.innerHeight);
  camera.position.copy(state.camBase);

  // Night elements (stars, both moons) are deleted outright for noon; only
  // the bleached sky dome and a small blown-out sun disc remain.
  scene.add(buildSky(), buildSunDisc());

  // Harsh noon sun, lowered to ~55° elevation (fix round 1: 70° left only a
  // few pixels of contact shadow under troops/harvester at native
  // resolution). Position and direction both derive from the single
  // SUN_DIR source in layout.js — see its comment for why.
  const sun = new THREE.DirectionalLight(COLORS.sunlight, 3.6);
  sun.position.set(...SUN_DIR);
  sun.castShadow = true;
  const shadowSize = state.small ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -320;
  sun.shadow.camera.right = 320;
  sun.shadow.camera.top = 320;
  sun.shadow.camera.bottom = -320;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 1000;
  sun.shadow.bias = -0.0005;
  sun.target.position.set(30, 0, -270);
  scene.add(sun, sun.target);
  // Lowered from 0.75 (fix round 1): the raised hemisphere light was one of
  // two compounding causes flattening the terrain's low-poly faceted look
  // (see terrain.js for the other — the narrowed vertex-tint span). 0.55
  // still reads as bright midday fill without washing out real directional
  // shading on the dune facets.
  scene.add(new THREE.HemisphereLight(COLORS.skyZenith, COLORS.sandLit, 0.55));
  scene.add(createTerrain());

  const harvester = createHarvester();
  scene.add(harvester.group);
  state.updaters.push(harvester);

  // Harkonnen escort ornithopter (Task 4): the black rotorcraft is what
  // makes the operation read Harkonnen at a glance — the harvester itself
  // is deliberately sand-colored, not black (see harvester.js). Kept as
  // state.thopter so a later task (combat FX / living attrition) can read
  // its live `muzzle`/`strafing` without re-deriving them.
  const thopter = createThopter();
  scene.add(thopter.group);
  state.updaters.push(thopter);
  state.thopter = thopter;

  const troops = createTroops();
  scene.add(troops.group);
  state.updaters.push(troops);
  state.troops = troops;

  const worm = createWorm();
  scene.add(worm.group);
  state.updaters.push(worm);

  const props = createProps({ small: state.small });
  scene.add(props.group);
  state.updaters.push(props);

  const fx = createCombatFX(troops.units);
  scene.add(fx.group);
  state.updaters.push(fx);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomRes = new THREE.Vector2(window.innerWidth, window.innerHeight)
    .multiplyScalar(state.small ? 0.5 : 1);
  // De-neon + noon: bloom is the fire/heat/sun-disc device only —
  // strength/threshold raised so bright bleached sand (which fills far more
  // of the frame at noon than at dusk) never blooms; only muzzle flashes,
  // explosions, engine glow and the sun disc are hot enough to halo.
  composer.addPass(new UnrealBloomPass(bloomRes, 0.35, 0.55, 0.95));

  Object.assign(state, { renderer, scene, camera, composer, clock: new THREE.Clock() });

  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));

  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__arrakis = state;
    // QA hook: advance the degrade ladder to stage n without waiting out the fps watchdog.
    state.forceDegrade = (n) => {
      while (state.fps.degraded < n && state.fps.degraded < 2) {
        state.fps.degraded++;
        if (state.fps.degraded === 1) applyDegradeStage1();
        else applyDegradeStage2();
      }
    };
  }
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

// Small blown-out sun disc, billboarded (THREE.Sprite auto-faces the camera
// in its shader, so this costs zero per-frame JS) and placed along the same
// direction as the sun DirectionalLight above, just inside the sky dome
// radius (3500). The soft radial-gradient texture is built once here at
// mount and never touched again — no per-frame allocation.
function buildSunDisc() {
  const dir = new THREE.Vector3(...SUN_DIR).normalize();
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const core = new THREE.Color(COLORS.sunDisc);
  const edge = new THREE.Color(COLORS.sunlight);
  const rgba = (c, a) => `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, rgba(core, 1));
  grad.addColorStop(0.45, rgba(edge, 0.6));
  grad.addColorStop(1, rgba(edge, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, fog: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.position.copy(dir).multiplyScalar(3000);
  sprite.scale.set(260, 260, 1);
  sprite.frustumCulled = false;
  return sprite;
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  applyFraming(w, h); // re-frame live, incl. orientation change (swapped w/h)
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
  const ds = state.driftScale;
  state.camera.position.set(
    state.camBase.x + 12 * ds * Math.sin(elapsed * 0.05) + state.pointer.x * 6 * ds,
    state.camBase.y + 4 * ds * Math.sin(elapsed * 0.083) - state.pointer.y * 4 * ds,
    state.camBase.z + 8 * ds * Math.cos(elapsed * 0.04),
  );
  state.camera.lookAt(state.camLookAt);

  for (const u of state.updaters) u.update(edt, elapsed, state.camera);

  watchFps(dt);
  if (state.useComposer) state.composer.render();
  else state.renderer.render(state.scene, state.camera);
}

// Two-stage watchdog: each stage trips after 3 *consecutive* seconds < 25 fps,
// then the counter resets so stage 2 needs 3 more consecutive low seconds.
function watchFps(dt) {
  const f = state.fps;
  if (f.degraded >= 2) return;
  f.frames++;
  f.t += dt;
  if (f.t < 1) return;
  const fps = f.frames / f.t;
  f.frames = 0;
  f.t = 0;
  f.lowSeconds = fps < 25 ? f.lowSeconds + 1 : 0;
  if (f.lowSeconds < 3) return;
  f.lowSeconds = 0;
  f.degraded++;
  if (f.degraded === 1) applyDegradeStage1();
  else applyDegradeStage2();
}

function applyDegradeStage1() {
  state.useComposer = false; // bloom off; emissives (fire/flashes/engine glow) still read, just without halo
}

function applyDegradeStage2() {
  state.renderer.shadowMap.enabled = false;
  state.renderer.shadowMap.autoUpdate = false;
  // Materials compiled with shadow-map code must recompile for the toggle to
  // take effect (one-time traversal, not per-frame).
  state.scene.traverse((obj) => {
    if (obj.material) obj.material.needsUpdate = true;
  });
  for (const u of state.updaters) u.degrade && u.degrade(); // FX pools halved
}
