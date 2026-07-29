import * as THREE from 'three';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// ---- deterministic per-index pseudo-random (NO Math.random anywhere) ----
// Same sine-hash trick as noise.js's hash() / troops.js's seedFrac(), so
// tracer cadence/targets/explosion sites are reproducible from (index, salt).
function seedFrac(i, salt) {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

// ---- tunables (within task-5 brief's pools/budget) ----
const TRACER_POOL = 24;
const TRACER_DURATION = 0.15;   // muzzle -> target travel time
const TRACER_TRAIL_WORLD = 16;  // world-unit length of the glowing streak

const FLASH_POOL = 16;
const FLASH_LIFE = 0.07; // ~2 frames at 60fps, rounded up for visibility

const EXPLOSION_SLOTS = 3;      // <= 3 concurrent
const EXPLOSION_INTERVAL = 7;   // seconds, per slot, staggered
const EXPLOSION_SMOKE_PER = 40; // per-explosion smoke puff count
const EXPLOSION_SMOKE_TOTAL = EXPLOSION_SLOTS * EXPLOSION_SMOKE_PER; // 120
const EXPLOSION_FLASH_DUR = 0.25;
const EXPLOSION_RING_DUR = 1.1;
const SMOKE_LIFE = 4.0;
// sourced from layout.js — coordinates only live there
const BATTLEFIELD_X = LAYOUT.battlefield.x;
const BATTLEFIELD_Z = LAYOUT.battlefield.z;

const IMPACT_COUNT = 48;   // shared "explosion puff pool" slice for tracer landings
const IMPACT_PER_HIT = 2;  // troops.js's firing duty-cycle is high (often 8-14/18 units
const IMPACT_LIFE = 0.18;  // firing at once) -> kept tiny/brief so hits read as quick
                            // kicks, not a saturated blown-out dust cloud (see round 1).

const WRECK_PER_COL = 40;
const WRECK_TOTAL = WRECK_PER_COL * 2; // two persistent columns
const WRECK_SPAWN_RATE = 4.5; // particles/sec per column — thin wisp, not a
const WRECK_LIFE = 2.6;       // solid additive-overlapped bar (see round 2)

// One shared Points buffer, sub-sliced (mirrors worm.js's SPRAY/WAKE split).
// Order is deliberate, NOT arbitrary: degrade() truncates this buffer's draw
// range from the tail, so the most essential content sits first and the
// heaviest/least essential sits last, making the halved range still read
// correctly instead of just chopping off whatever happened to be at the end.
// [0, WRECK_START+WRECK_TOTAL) two persistent wreck-smoke ring buffers —
//   the "battle damage" columns are a brief requirement and must survive a
//   degrade() halving intact.
// [DUST_START, DUST_START+IMPACT_COUNT) tracer-impact dust ring buffer —
//   secondary but still visible; mostly survives a halving.
// [SMOKE_START, PUFF_TOTAL) explosion smoke (block-per-slot) — heaviest
//   (120 of 248 slots) and least essential to keep every particle of; first
//   to be sacrificed when the range is halved (explosions still read via
//   their flash+ring InstancedMeshes, which are untouched by this degrade).
const WRECK_START = 0;
const DUST_START = WRECK_START + WRECK_TOTAL;
const SMOKE_START = DUST_START + IMPACT_COUNT;
const PUFF_TOTAL = SMOKE_START + EXPLOSION_SMOKE_TOTAL;

// ---- pooled: tracers (LineSegments, 1 draw call) ----

function createTracers() {
  const positions = new Float32Array(TRACER_POOL * 2 * 3).fill(-99999);
  const colors = new Float32Array(TRACER_POOL * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, TRACER_POOL * 2);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  lines.frustumCulled = false;

  const srcX = new Float32Array(TRACER_POOL), srcY = new Float32Array(TRACER_POOL), srcZ = new Float32Array(TRACER_POOL);
  const dstX = new Float32Array(TRACER_POOL), dstY = new Float32Array(TRACER_POOL), dstZ = new Float32Array(TRACER_POOL);
  const startTime = new Float32Array(TRACER_POOL).fill(-999);
  const trailFrac = new Float32Array(TRACER_POOL);
  const active = new Uint8Array(TRACER_POOL);
  const impacted = new Uint8Array(TRACER_POOL);
  let cursor = 0;
  const _color = new THREE.Color();

  function spawn(sx, sy, sz, tx, ty, tz, elapsed, colorHex) {
    const slot = cursor;
    cursor = (cursor + 1) % TRACER_POOL;
    srcX[slot] = sx; srcY[slot] = sy; srcZ[slot] = sz;
    dstX[slot] = tx; dstY[slot] = ty; dstZ[slot] = tz;
    startTime[slot] = elapsed;
    active[slot] = 1;
    impacted[slot] = 0;
    const dist = Math.hypot(tx - sx, ty - sy, tz - sz) || 1;
    trailFrac[slot] = Math.min(0.45, Math.max(0.06, TRACER_TRAIL_WORLD / dist));
    _color.set(colorHex);
    const j = slot * 2 * 3;
    colors[j] = _color.r; colors[j + 1] = _color.g; colors[j + 2] = _color.b;
    colors[j + 3] = _color.r; colors[j + 4] = _color.g; colors[j + 5] = _color.b;
    geo.attributes.color.needsUpdate = true;
    return slot;
  }

  // update() is purely a function of elapsed: idempotent under a frozen
  // elapsed (reduced motion), so it's safe to run unconditionally every
  // frame — only *new* shots are dt>0-gated by the caller (spawn()).
  function update(elapsed, onImpact) {
    let dirty = false;
    for (let i = 0; i < TRACER_POOL; i++) {
      if (!active[i]) continue;
      dirty = true;
      const t = (elapsed - startTime[i]) / TRACER_DURATION;
      if (t >= 1) {
        if (!impacted[i]) {
          impacted[i] = 1;
          onImpact(dstX[i], dstZ[i]);
        }
        active[i] = 0;
        const j = i * 2 * 3;
        positions[j] = positions[j + 1] = positions[j + 2] = -99999;
        positions[j + 3] = positions[j + 4] = positions[j + 5] = -99999;
        continue;
      }
      const head = clamp01(t);
      const tail = clamp01(t - trailFrac[i]);
      const j = i * 2 * 3;
      positions[j] = lerp(srcX[i], dstX[i], tail);
      positions[j + 1] = lerp(srcY[i], dstY[i], tail);
      positions[j + 2] = lerp(srcZ[i], dstZ[i], tail);
      positions[j + 3] = lerp(srcX[i], dstX[i], head);
      positions[j + 4] = lerp(srcY[i], dstY[i], head);
      positions[j + 5] = lerp(srcZ[i], dstZ[i], head);
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return {
    lines, spawn, update,
    degrade() { geo.setDrawRange(0, Math.max(1, Math.floor(TRACER_POOL / 2)) * 2); },
  };
}

// ---- pooled: muzzle flashes (Points, 1 draw call) ----

function createFlashes() {
  const positions = new Float32Array(FLASH_POOL * 3).fill(-99999);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, FLASH_POOL);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: COLORS.flashYellow, size: 3.5, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  points.frustumCulled = false;

  const posX = new Float32Array(FLASH_POOL), posY = new Float32Array(FLASH_POOL), posZ = new Float32Array(FLASH_POOL);
  const startTime = new Float32Array(FLASH_POOL).fill(-999);
  let cursor = 0;

  function spawn(x, y, z, elapsed) {
    const slot = cursor;
    cursor = (cursor + 1) % FLASH_POOL;
    posX[slot] = x; posY[slot] = y; posZ[slot] = z;
    startTime[slot] = elapsed;
  }

  function update(elapsed) {
    let dirty = false;
    for (let i = 0; i < FLASH_POOL; i++) {
      const t = elapsed - startTime[i];
      const j = i * 3;
      if (t >= 0 && t < FLASH_LIFE) {
        positions[j] = posX[i]; positions[j + 1] = posY[i]; positions[j + 2] = posZ[i];
      } else {
        positions[j] = positions[j + 1] = positions[j + 2] = -99999;
      }
      dirty = true;
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return {
    points, spawn, update,
    degrade() { geo.setDrawRange(0, Math.floor(FLASH_POOL / 2)); },
  };
}

// ---- pooled: shared smoke/dust (Points, 1 draw call) ----
// One buffer, three reserved slices, ordered essential-first (see the
// WRECK_START/DUST_START/SMOKE_START block below for why): wreck-column
// smoke (2 ring buffers), tracer-impact dust (ring buffer), explosion smoke
// (block-per-slot).

function createPuffs() {
  const positions = new Float32Array(PUFF_TOTAL * 3).fill(-99999);
  const colors = new Float32Array(PUFF_TOTAL * 3);
  const velocities = new Float32Array(PUFF_TOTAL * 3);
  const life = new Float32Array(PUFF_TOTAL);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, PUFF_TOTAL);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 4, vertexColors: true, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  points.frustumCulled = false;

  const _color = new THREE.Color();
  function setColor(idx, hex) {
    _color.set(hex);
    const j = idx * 3;
    colors[j] = _color.r; colors[j + 1] = _color.g; colors[j + 2] = _color.b;
  }

  function spawnSmokeBlock(slot, x, y, z, seedBase) {
    const block = SMOKE_START + slot * EXPLOSION_SMOKE_PER;
    for (let k = 0; k < EXPLOSION_SMOKE_PER; k++) {
      const idx = block + k;
      const a = seedFrac(seedBase + k, 61) * Math.PI * 2;
      const r = seedFrac(seedBase + k, 62) * 4;
      positions[idx * 3] = x + Math.cos(a) * r;
      positions[idx * 3 + 1] = y + seedFrac(seedBase + k, 63) * 2;
      positions[idx * 3 + 2] = z + Math.sin(a) * r;
      const outward = 2.5 + seedFrac(seedBase + k, 64) * 3.5;
      velocities[idx * 3] = Math.cos(a) * outward;
      velocities[idx * 3 + 1] = 4 + seedFrac(seedBase + k, 65) * 5;
      velocities[idx * 3 + 2] = Math.sin(a) * outward;
      life[idx] = SMOKE_LIFE * (0.7 + seedFrac(seedBase + k, 66) * 0.5);
      setColor(idx, COLORS.smokeGrey);
    }
  }

  let impactCursor = 0;
  function spawnImpactDust(x, z, seedBase) {
    const gy = duneHeight(x, z);
    for (let k = 0; k < IMPACT_PER_HIT; k++) {
      const idx = DUST_START + impactCursor;
      impactCursor = (impactCursor + 1) % IMPACT_COUNT;
      const a = seedFrac(seedBase + k, 67) * Math.PI * 2;
      const r = seedFrac(seedBase + k, 68) * 1.2;
      positions[idx * 3] = x + Math.cos(a) * r;
      positions[idx * 3 + 1] = gy + 0.3;
      positions[idx * 3 + 2] = z + Math.sin(a) * r;
      const outward = 1.5 + seedFrac(seedBase + k, 69) * 2.5;
      velocities[idx * 3] = Math.cos(a) * outward;
      velocities[idx * 3 + 1] = 1.5 + seedFrac(seedBase + k, 70) * 2;
      velocities[idx * 3 + 2] = Math.sin(a) * outward;
      life[idx] = IMPACT_LIFE * (0.7 + seedFrac(seedBase + k, 71) * 0.6);
      setColor(idx, COLORS.dustTan);
    }
  }

  const wreckCursor = [0, 0];
  const wreckAccum = [0, 0];
  const wreckOrigin = LAYOUT.wrecks.map(([x, z]) => new THREE.Vector3(x, duneHeight(x, z) + 1.5, z));

  function stepWreckSpawn(dt) {
    for (let col = 0; col < 2; col++) {
      wreckAccum[col] += dt * WRECK_SPAWN_RATE;
      const origin = wreckOrigin[col];
      while (wreckAccum[col] >= 1) {
        wreckAccum[col] -= 1;
        const idx = WRECK_START + col * WRECK_PER_COL + wreckCursor[col];
        wreckCursor[col] = (wreckCursor[col] + 1) % WRECK_PER_COL;
        const seedBase = col * 5000 + wreckCursor[col];
        positions[idx * 3] = origin.x + (seedFrac(seedBase, 72) - 0.5) * 1.4;
        positions[idx * 3 + 1] = origin.y + seedFrac(seedBase, 73) * 0.8;
        positions[idx * 3 + 2] = origin.z + (seedFrac(seedBase, 74) - 0.5) * 1.4;
        // wider lateral drift so the column fans out with height instead of
        // stacking additively into one solid vertical bar (see round 2 fix).
        velocities[idx * 3] = (seedFrac(seedBase, 75) - 0.5) * 2.6 + 1.0;
        velocities[idx * 3 + 1] = 1.8 + seedFrac(seedBase, 76) * 1.4;
        velocities[idx * 3 + 2] = (seedFrac(seedBase, 77) - 0.5) * 2.6;
        life[idx] = WRECK_LIFE * (0.75 + seedFrac(seedBase, 78) * 0.4);
        setColor(idx, COLORS.smokeGrey);
      }
    }
  }

  function integrate(dt) {
    for (let i = 0; i < PUFF_TOTAL; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      if (i < DUST_START) {
        // wreck column: gentle rise + steady drift, thins out (no gravity)
        velocities[j] *= 0.99; velocities[j + 1] *= 0.995; velocities[j + 2] *= 0.99;
      } else if (i < SMOKE_START) {
        // impact dust: quick outward kick, gravity-settled
        velocities[j + 1] -= 5 * dt;
      } else {
        // explosion smoke: buoyant rise, drag-expand, settles slowly
        velocities[j] *= 0.97; velocities[j + 2] *= 0.97;
        velocities[j + 1] *= 0.985;
      }
      positions[j] += velocities[j] * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += velocities[j + 2] * dt;
      if (life[i] <= 0) positions[j + 1] = -99999;
    }
    geo.attributes.color.needsUpdate = true;
    geo.attributes.position.needsUpdate = true;
  }

  // Warm-start the two persistent wreck columns so the very first rendered
  // frame — and the frozen reduced-motion frame — already shows continuous
  // rising smoke rather than empty slots (harvester.js plume pattern).
  for (let t = 0; t < 4; t += 0.1) { stepWreckSpawn(0.1); integrate(0.1); }

  return {
    points, spawnSmokeBlock, spawnImpactDust, stepWreckSpawn, integrate,
    degrade() { geo.setDrawRange(0, Math.floor(PUFF_TOTAL / 2)); },
  };
}

// ---- pooled: explosion flash spheres + ground rings (2 InstancedMeshes) ----

function createExplosionShells() {
  const flashGeo = new THREE.IcosahedronGeometry(1, 1);
  const flashMat = new THREE.MeshBasicMaterial({
    color: COLORS.sunDisc, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flashMesh = new THREE.InstancedMesh(flashGeo, flashMat, EXPLOSION_SLOTS);
  flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flashMesh.frustumCulled = false;

  const ringGeo = new THREE.RingGeometry(0.7, 1, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: COLORS.sunDisc, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, EXPLOSION_SLOTS);
  ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ringMesh.frustumCulled = false;

  const originX = new Float32Array(EXPLOSION_SLOTS);
  const originY = new Float32Array(EXPLOSION_SLOTS);
  const originZ = new Float32Array(EXPLOSION_SLOTS);
  const startTime = new Float32Array(EXPLOSION_SLOTS).fill(-999);

  const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scale = new THREE.Vector3();
  const _mat = new THREE.Matrix4(), _color = new THREE.Color();
  // Single shared "parked" matrix (offscreen, zero-scale) — built once here
  // and reused by setMatrixAt below, never re-composed per frame/instance.
  const PARKED_MAT = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -99999, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 0)
  );

  // park every instance offscreen with zero scale + black color at creation
  for (let i = 0; i < EXPLOSION_SLOTS; i++) {
    flashMesh.setMatrixAt(i, PARKED_MAT);
    ringMesh.setMatrixAt(i, PARKED_MAT);
    flashMesh.setColorAt(i, new THREE.Color(0, 0, 0));
    ringMesh.setColorAt(i, new THREE.Color(0, 0, 0));
  }
  flashMesh.instanceMatrix.needsUpdate = true;
  ringMesh.instanceMatrix.needsUpdate = true;
  flashMesh.instanceColor.needsUpdate = true;
  ringMesh.instanceColor.needsUpdate = true;

  function trigger(slot, x, y, z, elapsed) {
    originX[slot] = x; originY[slot] = y; originZ[slot] = z;
    startTime[slot] = elapsed;
  }

  function update(elapsed) {
    for (let i = 0; i < EXPLOSION_SLOTS; i++) {
      const t = elapsed - startTime[i];

      const ft = t / EXPLOSION_FLASH_DUR;
      if (ft >= 0 && ft < 1) {
        const env = Math.sin(Math.PI * clamp01(ft)); // grow then shrink
        const s = 1 + env * 5.5; // a fireball a couple soldier-heights across, not a hill
        _pos.set(originX[i], originY[i] + 2.5, originZ[i]);
        _scale.setScalar(s);
        _mat.compose(_pos, _quat, _scale);
        flashMesh.setMatrixAt(i, _mat);
        _color.set(COLORS.explosionOrange).multiplyScalar(0.9 + env * 2.6);
        flashMesh.setColorAt(i, _color);
      } else {
        flashMesh.setMatrixAt(i, PARKED_MAT);
      }

      const rt = t / EXPLOSION_RING_DUR;
      if (rt >= 0 && rt < 1) {
        const s = 2 + smoothstep(0, 1, rt) * 11;
        _pos.set(originX[i], originY[i] + 0.3, originZ[i]);
        _scale.setScalar(s);
        _mat.compose(_pos, _quat, _scale);
        ringMesh.setMatrixAt(i, _mat);
        _color.set(COLORS.dustTan).multiplyScalar(Math.max(0, 1 - rt));
        ringMesh.setColorAt(i, _color);
      } else {
        ringMesh.setMatrixAt(i, PARKED_MAT);
      }
    }
    flashMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    flashMesh.instanceColor.needsUpdate = true;
    ringMesh.instanceColor.needsUpdate = true;
  }

  return { flashMesh, ringMesh, trigger, update };
}

// ---- public factory ----

export function createCombatFX(units) {
  const group = new THREE.Group();

  const tracers = createTracers();
  const flashes = createFlashes();
  const puffs = createPuffs();
  const shells = createExplosionShells();
  group.add(tracers.lines, flashes.points, puffs.points, shells.flashMesh, shells.ringMesh);

  // Faction rosters, resolved once from the live units array (order-agnostic
  // — doesn't assume the 10-Fremen/8-Harkonnen split, just reads `faction`).
  const fremenIdx = [];
  const harkIdx = [];
  units.forEach((u, i) => (u.faction === 'fremen' ? fremenIdx : harkIdx).push(i));

  // Per-unit shot cadence (0.4-0.9s, index-seeded), tracked as an elapsed-
  // boundary counter (like troops.js's phase system) so it's fully
  // deterministic from `elapsed` alone — stable/idempotent when frozen.
  const cadence = units.map((_, i) => 0.4 + seedFrac(i, 111) * 0.5);
  const shotPhase = units.map((_, i) => seedFrac(i, 112) * cadence[i]);
  const lastShotK = units.map((_, i) => Math.floor((0 - shotPhase[i]) / cadence[i]));
  const shotCount = new Array(units.length).fill(0);

  function fireShot(shooterIdx, elapsed) {
    const unit = units[shooterIdx];
    const opposing = unit.faction === 'fremen' ? harkIdx : fremenIdx;
    if (opposing.length === 0) return;
    const seedBase = shooterIdx * 733 + shotCount[shooterIdx];
    shotCount[shooterIdx]++;
    const targetSlot = opposing[Math.floor(seedFrac(seedBase, 81) * opposing.length)];
    const target = units[targetSlot];
    const dx = (seedFrac(seedBase, 82) - 0.5) * 6; // +-3 spread
    const dz = (seedFrac(seedBase, 83) - 0.5) * 6;

    const sx = unit.pos.x, sy = unit.pos.y + unit.muzzleY, sz = unit.pos.z;
    const tx = target.pos.x + dx, tz = target.pos.z + dz;
    const ty = target.pos.y + target.muzzleY;
    const color = unit.faction === 'fremen' ? COLORS.tracerFremen : COLORS.harkRed;

    tracers.spawn(sx, sy, sz, tx, ty, tz, elapsed, color);
    flashes.spawn(sx, sy, sz, elapsed);
  }

  // Explosion trigger timers: 3 slots, phase-staggered across the interval
  // so they don't all pop at once; primed at elapsed=0 to avoid a jarring
  // simultaneous first-frame burst.
  let explosionInterval = EXPLOSION_INTERVAL;
  const explosionPhase = [];
  const explosionLastK = [];
  for (let s = 0; s < EXPLOSION_SLOTS; s++) {
    explosionPhase.push((s * EXPLOSION_INTERVAL) / EXPLOSION_SLOTS + seedFrac(s, 91) * 1.5);
    explosionLastK.push(Math.floor((0 - explosionPhase[s]) / EXPLOSION_INTERVAL));
  }
  const explosionTriggerCount = [0, 0, 0];

  // Allocated once (not per-frame): tracers.update() needs an impact callback,
  // but a fresh arrow function every frame would violate the zero-per-frame-
  // allocation rule the rest of this file (and worm.js/harvester.js) follow.
  let impactSeed = 0;
  function onTracerImpact(x, z) {
    puffs.spawnImpactDust(x, z, impactSeed++);
  }

  function triggerExplosion(slot, elapsed) {
    const seedBase = slot * 4001 + explosionTriggerCount[slot];
    explosionTriggerCount[slot]++;
    const x = BATTLEFIELD_X[0] + seedFrac(seedBase, 21) * (BATTLEFIELD_X[1] - BATTLEFIELD_X[0]);
    const z = BATTLEFIELD_Z[0] + seedFrac(seedBase, 22) * (BATTLEFIELD_Z[1] - BATTLEFIELD_Z[0]);
    const y = duneHeight(x, z);
    puffs.spawnSmokeBlock(slot, x, y, z, seedBase);
    shells.trigger(slot, x, y, z, elapsed);
  }

  function update(dt, elapsed) {
    if (dt > 0) {
      for (let i = 0; i < units.length; i++) {
        const k = Math.floor((elapsed - shotPhase[i]) / cadence[i]);
        if (k !== lastShotK[i]) {
          lastShotK[i] = k;
          if (units[i].firing) fireShot(i, elapsed);
        }
      }
      for (let s = 0; s < EXPLOSION_SLOTS; s++) {
        const k = Math.floor((elapsed - explosionPhase[s]) / explosionInterval);
        if (k !== explosionLastK[s]) {
          explosionLastK[s] = k;
          triggerExplosion(s, elapsed);
        }
      }
      puffs.stepWreckSpawn(dt);
    }

    tracers.update(elapsed, onTracerImpact);
    flashes.update(elapsed);
    shells.update(elapsed);
    puffs.integrate(dt);
  }

  function degrade() {
    tracers.degrade();
    flashes.degrade();
    puffs.degrade();
    explosionInterval *= 2;
  }

  return { group, update, degrade };
}
