import * as THREE from 'three';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// --- Body: overlapping tapered ring-plates along the spline -----------------
const SEG_COUNT = 40;
const SPACING = 0.0075;  // curve-param gap between plate centers (~20.5 world units)
const SEG_LEN = 37;      // world length of each plate → overlap ≈ 1 - 20.5/37 ≈ 45% (spec ≥40%)
const CYCLE = 55;        // seconds per full path loop — slow, distant approach
const HEAD_RADIUS = 36;  // spec: broad head ~34-40
const RADIAL_SEGS = 12;  // low-poly faceted hide (spec: 10-14 sides)
const UNDULATE_AMP = 5;  // subtle lateral body wave (world units)

// --- Maw: dark throat cone ringed by two rows of baleen teeth ---------------
const MAW_RADIUS = 28;   // matches the head plate's front lip opening (0.78 * 36)
const MAW_DEPTH = 46;
const TOOTH_RINGS = [
  // [count, ringRadius, length, baseWidth, zOffset]
  [26, 25, 17, 3.2, 1],
  [22, 18, 13, 2.5, -4],
];
const TOOTH_COUNT = TOOTH_RINGS.reduce((n, r) => n + r[0], 0); // 48

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
const _side = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _frame = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const UP = new THREE.Vector3(0, 1, 0);

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

// One ring-plate: a low-poly conical frustum (lathe) whose leading lip rides
// proud of the plate ahead of it. Local +Z is the direction of travel; the
// front rim (0.78) tucks deep inside the plate ahead, the lip peak (1.00 at
// z ≈ 0) sits exactly where the plate emerges from under its neighbour, and
// the rear closes to a blunt cap (hidden inside the body everywhere except
// the tail, where it gives the blunt tail-end for free).
//
// Overlap math: plate centers sit ~20.5 world units apart, each plate is 37
// long → front tip reaches 2 units PAST the center of the plate ahead; the
// visible band of every plate is z ∈ [-0.5, +0.05] of its length, so the lip
// ridge at z = +0.02 is always exposed and the seam never opens — even at
// the breach apex, where consecutive plates pitch ~8° apart (outside-of-bend
// separation ≈ radius × Δθ ≈ 36 × 0.14 ≈ 5 world units, absorbed by the
// ~16-unit overlap).
function buildPlateGeometry() {
  const profile = [
    [0.84, 0.50],  // front rim — tucked inside the plate ahead
    [0.93, 0.28],
    [1.00, 0.02],  // raised leading lip (the visible plate ridge)
    [0.93, -0.10], // valley behind the lip
    [0.97, -0.26], // body swell
    [0.90, -0.46],
    [0.68, -0.50], // blunt rear shoulder (kept tight so bends never flash it)
    [0.00, -0.50], // rear cap center
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(profile, RADIAL_SEGS);
  geo.rotateX(Math.PI / 2); // lathe axis Y → Z; front (+profile.y) → +Z

  // Baked vertex colors: dusty lit top → dark underside (wormHideDark→Lit).
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(COLORS.wormHideDark);
  const lit = new THREE.Color(COLORS.wormHideLit);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const radial = Math.hypot(x, y);
    const up = radial > 1e-4 ? y / radial : 0;
    _color.lerpColors(dark, lit, THREE.MathUtils.smoothstep(up, -0.85, 0.9));
    // Keep the rear cap subdued: in the tail taper each plate's cap ring
    // peeks out behind the smaller plate that follows, and a sunlit cap
    // reads as a glossy disc otherwise.
    if (z < -0.48) _color.lerp(dark, 0.7);
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Broad head holding through the fore-body, tapering over the last third to
// a blunt tail (36 → ~16).
function plateRadius(u) {
  return HEAD_RADIUS * (1 - 0.55 * THREE.MathUtils.smoothstep(u, 0.6, 1));
}

// Deterministic per-plate brightness variation (grey multiplier over the
// baked palette vertex colors) so the hide reads weathered, not uniform.
function plateShade(i) {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  return 0.72 + 0.18 * (h - Math.floor(h));
}

// Roll-stable orientation: forward = tangent, local +Y held toward world-up
// so the baked dusty-top/dark-underside vertex grade stays upright and
// adjacent plates never twist against each other. Falls back to the minimal
// rotation if the tangent goes near-vertical.
function frameQuat(tangent, out) {
  _side.crossVectors(UP, tangent);
  if (_side.lengthSq() < 1e-6) return out.setFromUnitVectors(Z_AXIS, tangent);
  _side.normalize();
  _up.crossVectors(tangent, _side);
  _frame.makeBasis(_side, _up, tangent);
  return out.setFromRotationMatrix(_frame);
}

// Forward-facing round mouth: dark interior throat cone ringed by two
// concentric instanced rows of thin baleen-teeth cones. setGape(0..1) swings
// the teeth from converged-shut across the aperture to flared open.
function createMaw() {
  const group = new THREE.Group();

  const throatGeo = new THREE.ConeGeometry(1, 1, 14, 1, true);
  throatGeo.rotateX(-Math.PI / 2);      // apex → -Z (into the body), open base → +Z
  throatGeo.translate(0, 0, -0.5);      // base ring at z = 0
  const throat = new THREE.Mesh(throatGeo, new THREE.MeshStandardMaterial({
    color: COLORS.wormMaw, flatShading: true, roughness: 1, metalness: 0,
    side: THREE.DoubleSide,
  }));
  throat.scale.set(MAW_RADIUS, MAW_RADIUS, MAW_DEPTH);
  throat.frustumCulled = false;

  const toothGeo = new THREE.ConeGeometry(1, 1, 5);
  toothGeo.translate(0, 0.5, 0); // base at origin, tip at +Y
  const teeth = new THREE.InstancedMesh(toothGeo, new THREE.MeshStandardMaterial({
    color: COLORS.wormTeeth, flatShading: true, roughness: 0.8, metalness: 0,
  }), TOOTH_COUNT);
  teeth.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  teeth.frustumCulled = false;

  // Precomputed per-tooth ring parameters (no per-frame allocation).
  const cosA = new Float32Array(TOOTH_COUNT), sinA = new Float32Array(TOOTH_COUNT);
  const ringR = new Float32Array(TOOTH_COUNT), ringZ = new Float32Array(TOOTH_COUNT);
  const len = new Float32Array(TOOTH_COUNT), width = new Float32Array(TOOTH_COUNT);
  let k = 0;
  for (const [count, radius, length, base, z] of TOOTH_RINGS) {
    for (let i = 0; i < count; i++, k++) {
      const a = (i / count) * Math.PI * 2 + (k % 2) * 0.06; // slight stagger
      cosA[k] = Math.cos(a);
      sinA[k] = Math.sin(a);
      ringR[k] = radius;
      ringZ[k] = z;
      len[k] = length * (0.85 + 0.3 * ((i * 7) % 5) / 5); // uneven baleen lengths
      width[k] = base;
    }
  }

  function setGape(g) {
    // Inward lean: shut teeth converge hard across the mouth (lean 1.35),
    // gaped teeth flare outward past radial (-0.4).
    const lean = THREE.MathUtils.lerp(1.35, -0.4, g);
    const reach = THREE.MathUtils.lerp(0.85, 1.0, g); // shut teeth tuck slightly in
    for (let i = 0; i < TOOTH_COUNT; i++) {
      _pos.set(cosA[i] * ringR[i] * reach, sinA[i] * ringR[i] * reach, ringZ[i]);
      _dir.set(-cosA[i] * lean, -sinA[i] * lean, 1).normalize();
      _quat.setFromUnitVectors(Y_AXIS, _dir);
      _scale.set(width[i], len[i], width[i]);
      _mat.compose(_pos, _quat, _scale);
      teeth.setMatrixAt(i, _mat);
    }
    teeth.instanceMatrix.needsUpdate = true;
  }

  setGape(0);
  group.add(throat, teeth);
  return { group, setGape };
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

  // Draw calls: body (1) + teeth (1) + throat (1) + particles (1) = 4.
  const body = new THREE.InstancedMesh(
    buildPlateGeometry(),
    new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
    }),
    SEG_COUNT,
  );
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = false; // instances span ~850 world units of moving spline
  for (let i = 0; i < SEG_COUNT; i++) {
    body.setColorAt(i, _color.setScalar(plateShade(i)));
  }
  body.instanceColor.needsUpdate = true;

  const maw = createMaw();
  const trail = createTrail();
  group.add(body, maw.group, trail.points);

  let wasAbove = false;
  let gape = 0;
  let lastToothGape = -1;

  function update(dt, elapsed) {
    const head = wrap(elapsed / CYCLE);
    for (let i = 0; i < SEG_COUNT; i++) {
      const t = wrap(head - i * SPACING);
      curve.getPointAt(t, _pos);
      curve.getTangentAt(t, _tan);

      // Subtle phase-offset lateral undulation (fades to zero at the head so
      // the maw stays seated on the leading plate).
      _side.crossVectors(_tan, UP);
      if (_side.lengthSq() > 1e-6) {
        _side.normalize();
        const amp = UNDULATE_AMP * Math.min(1, i / 4);
        _pos.addScaledVector(_side, Math.sin(i * 0.65 - elapsed * 1.8) * amp);
      }

      frameQuat(_tan, _quat);
      const r = plateRadius(i / (SEG_COUNT - 1));
      const flare = i === 0 ? 1 + 0.12 * gape : 1; // outer lip flares with the gape
      _scale.set(r * flare, r * flare, SEG_LEN);
      _mat.compose(_pos, _quat, _scale);
      body.setMatrixAt(i, _mat);

      if (i === 0) {
        const surfaceY = duneHeight(_pos.x, _pos.z);
        const above = _pos.y > surfaceY + 8;
        // Gape opens as the head clears the sand and is fully agape well
        // before the breach apex (~130 up), sealing shut on the dive.
        const gapeTarget = THREE.MathUtils.clamp((_pos.y - surfaceY - 10) / 55, 0, 1);
        if (dt > 0) {
          gape += (gapeTarget - gape) * Math.min(1, dt * 2.5);
          if (above !== wasAbove) trail.burst(_pos);
          if (!above) {
            _surface.set(_pos.x, surfaceY + 1, _pos.z);
            trail.emitWake(_surface, dt);
          }
          wasAbove = above;
        } else {
          gape = gapeTarget; // reduced-motion: pose directly, no smoothing
        }
        maw.group.position.copy(_pos).addScaledVector(_tan, SEG_LEN * (0.28 + 0.14 * gape));
        maw.group.quaternion.copy(_quat);
        const lip = 1 + 0.18 * gape;
        maw.group.scale.set(lip, lip, 1);
        if (Math.abs(gape - lastToothGape) > 0.002) {
          maw.setGape(gape);
          lastToothGape = gape;
        }
      }
    }
    body.instanceMatrix.needsUpdate = true;
    trail.update(dt);
  }

  return { group, update };
}
