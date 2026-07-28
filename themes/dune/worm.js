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
