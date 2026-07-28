import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// ---- deterministic per-index pseudo-random (NO Math.random at runtime) ----
// Same trick as noise.js's hash(): a sine-based fract hash, seeded by unit
// index + a salt so different constants (phase, duration, ...) don't correlate.
function seedFrac(i, salt) {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }

// ---- static geometry helpers (build-time only, never called from update()) ----

function box(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.deleteAttribute('uv');
  return geo;
}

function cone(r, h, seg = 6) {
  const geo = new THREE.ConeGeometry(r, h, seg);
  geo.deleteAttribute('uv');
  return geo;
}

function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(pos[0], pos[1], pos[2]);
  return geo;
}

// Scales the bottom half (local y < 0) of a centered box inward, producing a
// wide-top/narrow-bottom taper — the Fremen cloak/robe silhouette. Mirrors
// harvester.js's wedge() vertex-nudge technique.
function taperY(geo, factor) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      pos.setX(i, pos.getX(i) * factor);
      pos.setZ(i, pos.getZ(i) * factor);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ---- soldier figures: single merged low-poly humanoid, feet at local y=0, ----
// ---- facing local +X. Two-segment legs (shin + forward-offset thigh) read ----
// ---- as bent knees without any skinning; kneel/run states are conveyed by ----
// ---- per-instance Y-scale + bob at update time, not separate geometry.    ----

// Fremen: hooded/cloaked taper, ~144 tris.
function buildFremenGeometry() {
  const parts = [];
  const legW = 0.55, legD = 0.6, shinH = 0.9, thighH = 0.9, gapZ = 0.32;
  for (const side of [-1, 1]) {
    parts.push(place(box(legW, shinH, legD), { pos: [0, shinH / 2, side * gapZ] }));
    parts.push(place(box(legW * 0.9, thighH, legD * 0.95), { pos: [0.3, shinH + thighH / 2, side * gapZ] }));
  }
  const legsTopY = shinH + thighH; // 1.8

  const torsoH = 1.9, torsoW = 1.7, torsoD = 1.05;
  parts.push(place(taperY(box(torsoW, torsoH, torsoD), 0.6), { pos: [0, legsTopY + torsoH / 2, 0] }));
  const torsoTopY = legsTopY + torsoH; // 3.7

  const capeH = 2.15, capeW = 0.35, capeD = 1.9;
  parts.push(place(taperY(box(capeW, capeH, capeD), 0.55), { pos: [-0.55, legsTopY + capeH / 2 - 0.05, 0] }));

  const armW = 0.32, armH = 1.0, armD = 0.32;
  for (const side of [-1, 1]) {
    parts.push(place(box(armW, armH, armD), { pos: [0.5, legsTopY + torsoH * 0.62, side * 0.6] }));
  }

  const headS = 0.55;
  const headY = torsoTopY + headS / 2 + 0.05;
  parts.push(place(box(headS, headS, headS), { pos: [0.05, headY, 0] }));

  const hoodR = 0.55, hoodH = 1.0;
  parts.push(place(cone(hoodR, hoodH, 6), { pos: [-0.05, headY + 0.35, 0], rot: [0, 0, -0.12] }));

  const packW = 0.5, packH = 0.4, packD = 0.35;
  parts.push(place(box(packW, packH, packD), { pos: [-0.35, legsTopY + 0.3, 0] }));

  const rifleLen = 1.15, rifleT = 0.12;
  const riflePos = [0.75, legsTopY + torsoH * 0.58, 0.45];
  parts.push(place(box(rifleLen, rifleT, rifleT), { pos: riflePos, rot: [0, -0.08, 0.06] }));

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();

  return {
    geometry: merged,
    muzzleY: riflePos[1],
    accentOffset: new THREE.Vector3(0.285, headY, 0), // eye-glow, poking past the head's front face
  };
}

// Harkonnen: bulkier armored shoulders, ~156 tris.
function buildHarkonnenGeometry() {
  const parts = [];
  const legW = 0.7, legD = 0.8, shinH = 1.0, thighH = 1.0, gapZ = 0.4;
  for (const side of [-1, 1]) {
    parts.push(place(box(legW, shinH, legD), { pos: [0, shinH / 2, side * gapZ] }));
    parts.push(place(box(legW * 0.95, thighH, legD * 0.95), { pos: [0.32, shinH + thighH / 2, side * gapZ] }));
  }
  const legsTopY = shinH + thighH; // 2.0

  const torsoH = 2.3, torsoW = 2.1, torsoD = 1.35;
  parts.push(place(box(torsoW, torsoH, torsoD), { pos: [0, legsTopY + torsoH / 2, 0] }));
  const torsoTopY = legsTopY + torsoH; // 4.3

  const padW = 0.9, padH = 0.65, padD = 1.05;
  for (const side of [-1, 1]) {
    parts.push(place(box(padW, padH, padD), {
      pos: [0, torsoTopY - 0.25, side * (torsoD / 2 + padD / 2 - 0.15)],
    }));
  }

  const collarW = 0.65, collarH = 0.3, collarD = 0.95;
  parts.push(place(box(collarW, collarH, collarD), { pos: [0.05, torsoTopY + collarH / 2, 0] }));

  const helmS = 0.85;
  const headY = torsoTopY + collarH + helmS * 0.425 + 0.02;
  parts.push(place(box(helmS, helmS * 0.85, helmS), { pos: [0.05, headY, 0] }));

  const armW = 0.4, armH = 1.15, armD = 0.4;
  for (const side of [-1, 1]) {
    parts.push(place(box(armW, armH, armD), { pos: [0.45, legsTopY + torsoH * 0.6, side * 0.95] }));
  }

  const packW = 0.6, packH = 0.5, packD = 0.4;
  parts.push(place(box(packW, packH, packD), { pos: [-0.5, torsoTopY - 0.6, 0] }));

  const rifleLen = 1.25, rifleT = 0.14;
  const riflePos = [0.8, legsTopY + torsoH * 0.55, 0.55];
  parts.push(place(box(rifleLen, rifleT, rifleT), { pos: riflePos, rot: [0, -0.06, 0.04] }));

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();

  return {
    geometry: merged,
    muzzleY: riflePos[1],
    accentOffset: new THREE.Vector3(0.435, headY, 0), // visor-glow, poking past the helmet's front face
  };
}

// ---- choreography constants ----

const FREMEN_COUNT = 10;
const SHIFT_DUR = 1.0;      // Harkonnen lateral shuffle duration
const KNEEL_SCALE = 0.82;   // Y-scale while kneeling (pivots about feet at y=0)
const RUN_SCALE = 0.92;     // Y-scale while crouch-running between cover
const FIRE_WINDOW = 2.0;    // seconds of firing=true within a Fremen hold
const BOB_AMT = 0.32;       // crouch-run bob height
const BOB_CYCLES = 3;       // bob bounces per dash

// Fixed "face the enemy" targets: Harkonnen aim toward the Fremen cover
// cluster's centroid; Fremen aim toward the Harkonnen arc's center.
const TARGET_FOR_HARK = (() => {
  let x = 0, z = 0;
  for (const [px, pz] of LAYOUT.fremenCover) { x += px; z += pz; }
  return { x: x / LAYOUT.fremenCover.length, z: z / LAYOUT.fremenCover.length };
})();
const TARGET_FOR_FREMEN = { x: LAYOUT.harkArc.cx, z: LAYOUT.harkArc.cz };

// ---- public factory ----

export function createTroops() {
  const group = new THREE.Group();

  const fremenGeo = buildFremenGeometry();
  const harkGeo = buildHarkonnenGeometry();
  const HARK_COUNT = LAYOUT.harkArc.count;

  const fremenMat = new THREE.MeshStandardMaterial({
    color: COLORS.stillsuitTan, flatShading: true, roughness: 0.85,
  });
  const harkMat = new THREE.MeshStandardMaterial({
    color: COLORS.hullDark, flatShading: true, roughness: 0.5, metalness: 0.35,
  });

  const fremenBody = new THREE.InstancedMesh(fremenGeo.geometry, fremenMat, FREMEN_COUNT);
  const harkBody = new THREE.InstancedMesh(harkGeo.geometry, harkMat, HARK_COUNT);
  fremenBody.castShadow = true; fremenBody.receiveShadow = true;
  harkBody.castShadow = true; harkBody.receiveShadow = true;
  fremenBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  harkBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Shared tiny accent geometry (eye-glow / visor-glow): thin along local
  // +X (forward) so it clears the head/helmet's front face instead of being
  // buried inside it, wide along Z for a visor-band/eye-slit read.
  // One InstancedMesh per faction so the whole squad set stays at 4 draw calls.
  const accentGeo = box(0.16, 0.12, 0.4);
  const fremenAccentMat = new THREE.MeshStandardMaterial({
    color: COLORS.fremenEyes, emissive: COLORS.fremenEyes, emissiveIntensity: 1.6,
  });
  const harkAccentMat = new THREE.MeshStandardMaterial({
    color: COLORS.visorRed, emissive: COLORS.visorRed, emissiveIntensity: 1.8,
  });
  const fremenAccent = new THREE.InstancedMesh(accentGeo, fremenAccentMat, FREMEN_COUNT);
  const harkAccent = new THREE.InstancedMesh(accentGeo, harkAccentMat, HARK_COUNT);
  fremenAccent.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  harkAccent.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  group.add(fremenBody, harkBody, fremenAccent, harkAccent);

  const FREMEN_EYE_OFFSET = new THREE.Matrix4().makeTranslation(
    fremenGeo.accentOffset.x, fremenGeo.accentOffset.y, fremenGeo.accentOffset.z,
  );
  const HARK_VISOR_OFFSET = new THREE.Matrix4().makeTranslation(
    harkGeo.accentOffset.x, harkGeo.accentOffset.y, harkGeo.accentOffset.z,
  );

  // units[] is the Task-5 contract: fixed array, Vector3s allocated once,
  // faction/pos/firing/muzzleY mutated in place every frame.
  const units = [];
  const fremenConfigs = [];
  for (let i = 0; i < FREMEN_COUNT; i++) {
    const n = LAYOUT.fremenCover.length;
    const wp = [LAYOUT.fremenCover[i % n], LAYOUT.fremenCover[(i + 3) % n], LAYOUT.fremenCover[(i + 7) % n]];
    const dashDur = 1.0 + seedFrac(i, 1) * 0.4;       // ~1.0-1.4s
    const holdDur = 3 + seedFrac(i, 2) * 2;           // 3-5s
    const fireStart = (holdDur - FIRE_WINDOW) / 2;    // centered fire window
    const phase = seedFrac(i, 3) * 12;                // desync offset
    fremenConfigs.push({ wp, dashDur, holdDur, fireStart, phase });
    units.push({ faction: 'fremen', pos: new THREE.Vector3(), firing: false, muzzleY: fremenGeo.muzzleY });
  }
  const harkConfigs = [];
  for (let i = 0; i < HARK_COUNT; i++) {
    const t = HARK_COUNT > 1 ? i / (HARK_COUNT - 1) : 0;
    const angle = LAYOUT.harkArc.a0 + (LAYOUT.harkArc.a1 - LAYOUT.harkArc.a0) * t;
    const baseX = LAYOUT.harkArc.cx + Math.cos(angle) * LAYOUT.harkArc.r;
    const baseZ = LAYOUT.harkArc.cz + Math.sin(angle) * LAYOUT.harkArc.r;
    const tangentX = -Math.sin(angle), tangentZ = Math.cos(angle);
    const fireDur = 3 + seedFrac(i, 5) * 1;   // 3-4s
    const shiftAmt = 2 + seedFrac(i, 6) * 1;  // 2-3 units
    const phase = seedFrac(i, 7) * 10;
    harkConfigs.push({ baseX, baseZ, tangentX, tangentZ, fireDur, shiftAmt, phase });
    units.push({ faction: 'hark', pos: new THREE.Vector3(), firing: false, muzzleY: harkGeo.muzzleY });
  }

  // reused scratch objects — zero per-frame allocations
  const _euler = new THREE.Euler();
  const _quat = new THREE.Quaternion();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _bodyMat = new THREE.Matrix4();
  const _accentMat = new THREE.Matrix4();

  function composeUnit(unit, x, y, z, yaw, yScale, bodyMesh, accentMesh, offsetMat, index) {
    unit.pos.set(x, y, z);
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _scale.set(1, yScale, 1);
    _bodyMat.compose(unit.pos, _quat, _scale);
    bodyMesh.setMatrixAt(index, _bodyMat);
    _accentMat.copy(_bodyMat).multiply(offsetMat);
    accentMesh.setMatrixAt(index, _accentMat);
  }

  function updateFremenUnit(unit, cfg, elapsed, index, baseMuzzleY) {
    const segLen = cfg.dashDur + cfg.holdDur;
    const loopLen = segLen * cfg.wp.length;
    const tRaw = elapsed + cfg.phase;
    const tt = ((tRaw % loopLen) + loopLen) % loopLen;
    const segIndex = Math.floor(tt / segLen);
    const localT = tt - segIndex * segLen;
    const from = cfg.wp[segIndex];
    const to = cfg.wp[(segIndex + 1) % cfg.wp.length];

    let x, z, yaw, firing = false, yScale, bob = 0;
    if (localT < cfg.dashDur) {
      const s = localT / cfg.dashDur;
      const se = smoothstep(0, 1, s);
      x = lerp(from[0], to[0], se);
      z = lerp(from[1], to[1], se);
      yaw = Math.atan2(to[1] - from[1], to[0] - from[0]);
      bob = Math.abs(Math.sin(s * Math.PI * BOB_CYCLES)) * BOB_AMT;
      yScale = RUN_SCALE;
    } else {
      const holdT = localT - cfg.dashDur;
      x = to[0]; z = to[1];
      firing = holdT >= cfg.fireStart && holdT < cfg.fireStart + FIRE_WINDOW;
      yaw = Math.atan2(TARGET_FOR_FREMEN.z - z, TARGET_FOR_FREMEN.x - x);
      yScale = KNEEL_SCALE;
    }

    const gy = duneHeight(x, z) + bob;
    unit.firing = firing;
    unit.muzzleY = baseMuzzleY * yScale;
    composeUnit(unit, x, gy, z, yaw, yScale, fremenBody, fremenAccent, FREMEN_EYE_OFFSET, index);
  }

  function updateHarkUnit(unit, cfg, elapsed, index, baseMuzzleY) {
    const cycleLen = cfg.fireDur + SHIFT_DUR;
    const tRaw = elapsed + cfg.phase;
    const tt = ((tRaw % cycleLen) + cycleLen) % cycleLen;
    const k = Math.floor(tRaw / cycleLen);
    const evenK = ((k % 2) + 2) % 2 === 0;

    let offset, firing, yScale, dirSign = 1;
    if (tt < cfg.fireDur) {
      offset = evenK ? 0 : cfg.shiftAmt;
      firing = true;
      yScale = KNEEL_SCALE;
    } else {
      const shiftT = tt - cfg.fireDur;
      const s = shiftT / SHIFT_DUR;
      const from = evenK ? 0 : cfg.shiftAmt;
      const to = evenK ? cfg.shiftAmt : 0;
      offset = lerp(from, to, smoothstep(0, 1, s));
      firing = false;
      dirSign = to > from ? 1 : -1;
      // rise mid-shuffle, settle back to kneel by either end
      yScale = lerp(KNEEL_SCALE, 1, Math.sin(Math.PI * s));
    }

    const x = cfg.baseX + cfg.tangentX * offset;
    const z = cfg.baseZ + cfg.tangentZ * offset;
    const yaw = firing
      ? Math.atan2(TARGET_FOR_HARK.z - z, TARGET_FOR_HARK.x - x)
      : Math.atan2(cfg.tangentZ * dirSign, cfg.tangentX * dirSign);

    const gy = duneHeight(x, z);
    unit.firing = firing;
    unit.muzzleY = baseMuzzleY * yScale;
    composeUnit(unit, x, gy, z, yaw, yScale, harkBody, harkAccent, HARK_VISOR_OFFSET, index);
  }

  function update(dt, elapsed) {
    for (let i = 0; i < FREMEN_COUNT; i++) {
      updateFremenUnit(units[i], fremenConfigs[i], elapsed, i, fremenGeo.muzzleY);
    }
    for (let i = 0; i < HARK_COUNT; i++) {
      updateHarkUnit(units[FREMEN_COUNT + i], harkConfigs[i], elapsed, i, harkGeo.muzzleY);
    }
    fremenBody.instanceMatrix.needsUpdate = true;
    harkBody.instanceMatrix.needsUpdate = true;
    fremenAccent.instanceMatrix.needsUpdate = true;
    harkAccent.instanceMatrix.needsUpdate = true;
  }

  // Warm-start so the very first rendered frame (and frozen reduced-motion
  // mode) already shows a fully posed, grounded squad rather than the
  // identity-matrix pose at t=0.
  update(0, 0);

  return { group, update, units };
}
