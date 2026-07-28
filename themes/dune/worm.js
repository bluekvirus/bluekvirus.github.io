import * as THREE from 'three';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

const SEG_COUNT = 30;
const SPACING = 0.014; // curve-parameter gap between segments
const CYCLE = 55;      // seconds per full path loop — slow, distant approach
const HEAD_SCALE = 37.5; // ~38, x2.5 of the original v1 head scale (15)

const SPRAY_COUNT = 240; // breach/dive burst (amber)
const WAKE_COUNT = 300;  // continuous submerged dust trail (dustTan)
const PARTICLE_COUNT = SPRAY_COUNT + WAKE_COUNT; // 540, one draw call

const WAKE_INTERVAL = 0.08; // seconds between wake-trail emissions
const WAKE_LIFE = 4.5;      // seconds a wake puff stays visible

const _pos = new THREE.Vector3(), _tan = new THREE.Vector3();
const _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _color = new THREE.Color();
const _surface = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function wrap(t) { return ((t % 1) + 1) % 1; }

// Mostly submerged loop with a single grand breach on the battle-facing near
// segment (i === 3, the point of the loop closest to the harvester/battle).
const LIFTS = [-90, -90, 25, 130, 25, -90, -90, -90, -90, -90, -90, -90];

function buildPath() {
  const { cx, cz, r } = LAYOUT.worm;
  const n = LIFTS.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r * 0.7;
    pts.push(new THREE.Vector3(x, duneHeight(x, z) + LIFTS[i], z));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// Merged particle pool: [0, SPRAY_COUNT) breach/dive bursts, the rest a
// continuously-emitted submerged dust wake. One geometry, one draw call.
function createTrail() {
  const positions = new Float32Array(PARTICLE_COUNT * 3).fill(-99999);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  const life = new Float32Array(PARTICLE_COUNT);

  _color.set(COLORS.amber);
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const j = i * 3;
    colors[j] = _color.r; colors[j + 1] = _color.g; colors[j + 2] = _color.b;
  }
  _color.set(COLORS.dustTan);
  for (let i = SPRAY_COUNT; i < PARTICLE_COUNT; i++) {
    const j = i * 3;
    colors[j] = _color.r; colors[j + 1] = _color.g; colors[j + 2] = _color.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 5, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;

  function burst(origin) {
    for (let i = 0; i < SPRAY_COUNT; i++) {
      const j = i * 3;
      positions[j] = origin.x; positions[j + 1] = origin.y; positions[j + 2] = origin.z;
      velocities[j] = (Math.random() - 0.5) * 180;
      velocities[j + 1] = 120 + Math.random() * 180;
      velocities[j + 2] = (Math.random() - 0.5) * 180;
      life[i] = 1.2 + Math.random() * 0.8;
    }
  }

  let wakeCursor = 0;
  let wakeAccum = 0;

  function emitWake(origin, dt) {
    wakeAccum += dt;
    while (wakeAccum >= WAKE_INTERVAL) {
      wakeAccum -= WAKE_INTERVAL;
      const idx = SPRAY_COUNT + wakeCursor;
      const j = idx * 3;
      positions[j] = origin.x + (Math.random() - 0.5) * 10;
      positions[j + 1] = origin.y + Math.random() * 2;
      positions[j + 2] = origin.z + (Math.random() - 0.5) * 10;
      velocities[j] = (Math.random() - 0.5) * 4;
      velocities[j + 1] = 2 + Math.random() * 3;
      velocities[j + 2] = (Math.random() - 0.5) * 4;
      life[idx] = WAKE_LIFE * (0.7 + Math.random() * 0.3);
      wakeCursor = (wakeCursor + 1) % WAKE_COUNT;
    }
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (life[i] <= 0) continue;
      dirty = true;
      life[i] -= dt;
      const j = i * 3;
      if (i < SPRAY_COUNT) velocities[j + 1] -= 160 * dt; // gravity on spray only
      else velocities[j + 1] *= 0.98; // wake settles gently, no hard gravity
      positions[j] += velocities[j] * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += velocities[j + 2] * dt;
      if (life[i] <= 0) positions[j + 1] = -99999;
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return { points, burst, emitWake, update };
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
    new THREE.MeshBasicMaterial({ color: COLORS.neonCyan, transparent: true, opacity: 0.55 }),
    SEG_COUNT,
  );
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const trail = createTrail();
  group.add(body, rings, trail.points);

  let wasAbove = false;

  function update(dt, elapsed) {
    const head = wrap(elapsed / CYCLE);
    for (let i = 0; i < SEG_COUNT; i++) {
      const t = wrap(head - i * SPACING);
      curve.getPointAt(t, _pos);
      curve.getTangentAt(t, _tan);
      _quat.setFromUnitVectors(Z_AXIS, _tan);
      const s = HEAD_SCALE * (1 - (i / SEG_COUNT) * 0.75); // head ~38 → tail ~9.5
      _scale.setScalar(s);
      _mat.compose(_pos, _quat, _scale);
      body.setMatrixAt(i, _mat);
      _scale.multiplyScalar(1.12);
      _mat.compose(_pos, _quat, _scale);
      rings.setMatrixAt(i, _mat);
      if (i === 0 && dt > 0) {
        const surfaceY = duneHeight(_pos.x, _pos.z);
        const above = _pos.y > surfaceY + 8;
        if (above !== wasAbove) trail.burst(_pos);
        if (!above) {
          _surface.set(_pos.x, surfaceY + 1, _pos.z);
          trail.emitWake(_surface, dt);
        }
        wasAbove = above;
      }
    }
    body.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    trail.update(dt);
  }

  return { group, update };
}
