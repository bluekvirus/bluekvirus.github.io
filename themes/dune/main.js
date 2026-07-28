import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette.js';
import { showFallback } from '../../js/router.js';
import { createTerrain } from './terrain.js';
import { createWorm } from './worm.js';
import { createSigils } from './sigils.js';
import { createProps } from './props.js';

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
  scene.add(createTerrain());

  const worm = createWorm();
  scene.add(worm.group);
  state.updaters.push(worm);

  const sigils = createSigils();
  scene.add(sigils.group);
  state.updaters.push(sigils);
  state.sigils = sigils;
  state.interactive = sigils.meshes;
  renderer.domElement.addEventListener('click', onClick);

  const props = createProps({ small: state.small });
  scene.add(props.group);
  state.updaters.push(props);

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
  if (!state.sigils) return;
  const m = pick(e);
  state.sigils.setHover(m);
  state.renderer.domElement.style.cursor = m ? 'pointer' : 'default';
  const label = document.getElementById('hud-label');
  label.hidden = !m;
  label.textContent = m ? m.userData.label : '';
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
