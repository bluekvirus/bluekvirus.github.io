import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { showFallback } from '../../js/router.js';
import { createTerrain } from './terrain.js';
import { createWorm } from './worm.js';
import { createProps } from './props.js';
import { createHarvester } from './harvester.js';
import { createTroops } from './troops.js';
import { createCombatFX } from './combatfx.js';

const FROZEN_TIME = 9; // elapsed seconds shown when prefers-reduced-motion
const CAM_BASE = new THREE.Vector3(...LAYOUT.camBase);
const CAM_TARGET = new THREE.Vector3(...LAYOUT.camTarget);

const state = {
  renderer: null, scene: null, camera: null, composer: null, clock: null,
  rafId: 0, useComposer: true, reduced: false, small: false,
  pointer: { x: 0, y: 0, tx: 0, ty: 0 },
  updaters: [],
  fps: { frames: 0, t: 0, lowSeconds: 0, degraded: 0 }, // degraded: stage counter 0|1|2
};

export async function mount(container) {
  if (!supportsWebGL()) throw new Error('WebGL unavailable');

  state.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  state.small = Math.min(window.innerWidth, window.innerHeight) < 700;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.small ? 1 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopLoop();
    showFallback(document.getElementById('fallback'));
  });

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.horizon, 0.00035);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 8000);
  camera.position.copy(CAM_BASE);

  scene.add(buildSky(), buildStars(), ...buildMoons());

  const sun = new THREE.DirectionalLight(COLORS.sunlight, 3.2);
  sun.position.set(-460, 170, -80);
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
  scene.add(new THREE.HemisphereLight(COLORS.skyZenith, COLORS.dustTan, 0.38));
  scene.add(createTerrain());

  const harvester = createHarvester();
  scene.add(harvester.group);
  state.updaters.push(harvester);

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
  // De-neon: bloom is the fire/heat device only — strength/threshold tuned
  // so just genuinely bright diegetic emissives (muzzle flashes, explosions,
  // engine glow, running lights) halo, nothing else.
  composer.addPass(new UnrealBloomPass(bloomRes, 0.5, 0.55, 0.85));

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
    color: COLORS.starWhite, size: 2, transparent: true, opacity: 0.8, fog: false, sizeAttenuation: false,
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
    CAM_BASE.x + 12 * Math.sin(elapsed * 0.05) + state.pointer.x * 6,
    CAM_BASE.y + 4 * Math.sin(elapsed * 0.083) - state.pointer.y * 4,
    CAM_BASE.z + 8 * Math.cos(elapsed * 0.04),
  );
  state.camera.lookAt(CAM_TARGET);

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
