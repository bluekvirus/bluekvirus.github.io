import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// Film-accurate HARKONNEN spice harvester (Task 3, v4 + legged correction).
// Reference: George Hull design / Vermette production design — the Part Two
// machine WALKS on massive legs (the practical rig was a pair of steel legs
// "sixty feet wide and thirty feet high" on two 100-ton excavators; the CG
// machine is 3x higher, 3x wider, 5x longer than that rig, and characters
// shelter behind/under a leg). Plan view is Vermette's "tick"; proportions
// from the licensed MENG kit, L:W:H = 3.7 : 2.4 : 1.
//
// Colour: a dark industrial Harkonnen machine WEARING the desert — primary
// structure in hullUnder/hullDark, with heavy hullSand dust accumulation on
// upper surfaces, leading edges and the legs, hullBleach sun-scour on the
// hottest patches. Not a clean black box; not a uniform tan one.
//
// Local frame: +X = fore (intake), +Y up, ground at local y ~= 0.
// Overall extents: x -75..+75 (150 long), z +-48.5 (97 wide at the splayed
// feet), main massing to y ~= 44 (thin stacks/mast above) => ~3.7 : 2.4 : 1.
// The slab body rides at y 21 — a clear, walkable, shadowed gap between the
// legs is the silhouette's signature.

// ---- static geometry helpers (build-time only, never called from update()) ----

function box(w, h, d, sx = 1, sy = 1, sz = 1) {
  const geo = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  geo.deleteAttribute('uv');
  return geo;
}

function cyl(rt, rb, h, seg = 8, hseg = 1) {
  const geo = new THREE.CylinderGeometry(rt, rb, h, seg, hseg);
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

// Base coat. tone lerps the part between two palette colors so no two
// panels start from an identical flat tint (the weathering bake below then
// adds per-vertex variation on top).
const _cA = new THREE.Color(), _cB = new THREE.Color();
function paint(geo, hexA, hexB = hexA, tone = 0) {
  _cA.setHex(hexA);
  if (tone > 0) _cA.lerp(_cB.setHex(hexB), tone);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([_cA.r, _cA.g, _cA.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ---- deterministic noise for the weathering bake (build-time only) ----

function fract(x) { return x - Math.floor(x); }
function hash2(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123); }
function smooth(t) { return t * t * (3 - 2 * t); }
// Bilinear value noise (same construction as noise.js, kept local because
// noise.js only exports duneHeight).
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// Weathering bake over the merged hull: run AFTER computeVertexNormals so
// facing information is available. The machine is dark Harkonnen industry
// buried in desert wear:
//  - upward faces accumulate heavy hullSand dust, patchy, with hullBleach
//    sun-scour on the hottest spots;
//  - legs and everything low pick up kicked-up dust coating;
//  - vertical faces carry rust-grime streaks (column-keyed, biased low);
//  - downward faces fall into hullUnder shadow;
//  - fine per-vertex value jitter kills any remaining flat tint.
function bakeWeathering(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = geo.attributes.color;
  const sand = new THREE.Color(COLORS.hullSand);
  const bleach = new THREE.Color(COLORS.hullBleach);
  const grime = new THREE.Color(COLORS.hullGrime);
  const under = new THREE.Color(COLORS.hullUnder);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nor.getY(i);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));

    // heavy dust accumulation on upward faces, patchy at ~8-unit scale
    const patch = vnoise(x * 0.13 + 7.3, z * 0.13 + 2.1);
    c.lerp(sand, clamp01(ny) * (0.3 + 0.5 * patch));

    // sun-scour bleach on the hottest dusted patches
    const patch2 = vnoise(x * 0.21 + 3.7, z * 0.21 + 11.9);
    c.lerp(bleach, clamp01(ny) * patch2 * patch2 * 0.4);

    // kicked-up dust coating low on the legs/feet/underskirts — the legs
    // wear the desert hardest
    const lowDust = clamp01(1 - y / 22);
    const patch3 = vnoise(x * 0.3 + 17.1, y * 0.5 + z * 0.3);
    c.lerp(sand, lowDust * lowDust * (0.3 + 0.45 * patch3));

    // wind-blast dust scour on vertical faces, stronger higher up
    const vert0 = 1 - Math.abs(ny);
    c.lerp(sand, vert0 * (0.12 + 0.38 * patch) * clamp01(y / 40 + 0.35));

    const colId = hash2(Math.floor(x * 0.45), Math.floor(z * 0.45));
    const streak = clamp01((colId - 0.35) * 1.8); // ~2/3 of columns streak
    const vertical = vert0;
    c.lerp(grime, vertical * streak * (0.1 + 0.28 * clamp01(1 - y / 40)));

    // shadowed underbelly
    if (ny < -0.3) c.lerp(under, 0.45 * -ny);

    // fine value jitter so no facet is a flat tint
    const j = 1 + (hash2(x * 3.1 + y * 1.7, z * 2.3 - y * 0.9) - 0.5) * 0.16;
    col.setXYZ(i, clamp01(c.r * j), clamp01(c.g * j), clamp01(c.b * j));
  }
  col.needsUpdate = true;
}

// Piecewise-linear sample of a station array over local x in [x0, x1].
function sample(arr, x, x0, x1) {
  const u = clamp01((x - x0) / (x1 - x0)) * (arr.length - 1);
  const s = Math.min(arr.length - 2, Math.floor(u));
  return arr[s] + (arr[s + 1] - arr[s]) * (u - s);
}

// The tick-shaped main slab, riding high on the legs: a segmented box
// remapped per x-station — widest mid-body tapering fore and aft (plan),
// top sloping down to the low nose (side wedge), belly lifting toward the
// tip. Faceted, blocky — "a factory laid flat", no organic curves.
function buildHullSlab() {
  const X0 = -75, X1 = 55, LEN = X1 - X0, CX = (X0 + X1) / 2;
  //            rear ......................................... nose
  const halfW = [20, 24, 27, 29, 30, 30, 29, 27, 23, 18, 13];
  const yTop  = [36, 37.5, 38.5, 39, 39, 39, 38.5, 37, 34, 31, 28];
  const yBot  = [23, 22, 21.5, 21, 21, 21, 21, 21.5, 22, 23.5, 25];
  const geo = box(LEN, 1, 2, 12, 3, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + CX;
    const t = pos.getY(i) + 0.5; // 0 bottom .. 1 top
    pos.setX(i, x);
    pos.setY(i, sample(yBot, x, X0, X1) + t * (sample(yTop, x, X0, X1) - sample(yBot, x, X0, X1)));
    pos.setZ(i, pos.getZ(i) * 0.5 * sample(halfW, x, X0, X1));
  }
  return geo;
}

// One walking leg: a broad splayed plate (wider than tall, per the practical
// rig), sheared outboard so the foot lands wide of the hull flank.
function buildLegPlate(w, h, thick, splay) {
  const geo = box(w, h, thick, 3, 4, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h; // 0 foot .. 1 hip
    pos.setZ(i, pos.getZ(i) + (1 - t) * splay);
    // taper the plate slightly toward the foot for a set stance
    pos.setX(i, pos.getX(i) * (0.82 + 0.18 * t));
  }
  return geo;
}

function buildHullGeometry() {
  const parts = [];
  const { hullDark, hullUnder, hullGrime, hullSand } = COLORS;

  // --- main tick slab, riding at y 21 ---
  parts.push(paint(buildHullSlab(), hullGrime, hullUnder, 0.45));

  // --- flank sponsons: the heavy side masses the legs hang from ---
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(100, 10, 7, 8, 2, 1), { pos: [-14, 29, side * 30] }), hullGrime, hullUnder, 0.5));
    // sponson leading-edge chamfer strip + panel seams
    parts.push(paint(place(box(100, 1, 7.6), { pos: [-14, 34.2, side * 30] }), hullUnder, hullGrime, 0.3));
    for (const vx of [-52, -20, 12]) {
      parts.push(paint(place(box(0.6, 9, 0.5), { pos: [-14 + vx, 29, side * 33.6] }), hullUnder));
    }
  }

  // --- THE iconic element: six massive splayed walking legs. Each plate is
  // broad (26 wide x ~26 tall) with heavy hip/ankle joints and a wide foot
  // pad bedded into the sand; a 5.4-unit soldier alongside reads ~1/5 of the
  // leg and can stand upright in the shadowed gap under the hull. ---
  const legFeet = [];
  for (const side of [-1, 1]) {
    for (const lx of [-48, -6, 36]) {
      // hip joint block + pivot hub on the sponson underside
      parts.push(paint(place(box(17, 8, 11, 2, 1, 1), { pos: [lx, 26, side * 31] }), hullGrime, hullUnder, 0.55));
      parts.push(paint(place(cyl(3.6, 3.6, 12, 8), {
        rot: [0, 0, Math.PI / 2], pos: [lx, 26, side * 33],
      }), hullUnder, hullGrime, 0.35));
      // the leg plate, splayed outboard: hip z ~ +-31.5 -> foot z ~ +-41.5
      parts.push(paint(place(buildLegPlate(26, 22, 7, side * -10), {
        pos: [lx, 15, side * 41.5],
      }), hullGrime, hullUnder, 0.35));
      // ankle joint + hub
      parts.push(paint(place(box(12, 5, 9, 2, 1, 1), { pos: [lx, 6.5, side * 42] }), hullGrime, hullUnder, 0.55));
      parts.push(paint(place(cyl(2.6, 2.6, 10, 8), {
        rot: [0, 0, Math.PI / 2], pos: [lx, 6.5, side * 42] ,
      }), hullUnder, hullGrime, 0.4));
      // broad foot pad, sunk into the sand (skirt below local y 0)
      parts.push(paint(place(box(30, 5.5, 14, 3, 1, 1), { pos: [lx, 1.2, side * 43] }), hullUnder));
      legFeet.push(new THREE.Vector3(lx, 4, side * 43));
    }
  }

  // --- raised central spine plinth (kept low: subordinate to the slab) ---
  parts.push(paint(place(box(70, 5.5, 34, 8, 1, 4), { pos: [-10, 41.5, 0] }), hullGrime, hullUnder, 0.5));
  parts.push(paint(place(box(56, 1.6, 28, 6, 1, 3), { pos: [-12, 45, 0] }), hullGrime, hullUnder, 0.3));
  // deck vent rows on the spine flanks
  for (const side of [-1, 1]) {
    for (let v = 0; v < 4; v++) {
      parts.push(paint(place(box(9, 3.2, 0.7), { pos: [-34 + v * 16, 41.5, side * 17.2] }), hullUnder));
    }
  }
  // scattered hull-top panel plates (seam/patchwork read from above)
  const plates = [[-52, 38.4, -10, 16, 12], [-28, 39.4, 20, 14, 8], [4, 39.4, -20, 18, 8], [26, 37.3, 8, 12, 8], [-6, 39.4, 3, 20, 12]];
  for (const [px, py, pz, pw, pd] of plates) {
    parts.push(paint(place(box(pw, 0.7, pd, 2, 1, 2), { pos: [px, py, pz] }), hullGrime, hullSand, 0.3));
  }

  // --- blocky stern block + exhaust stacks (aft mass) ---
  parts.push(paint(place(box(26, 8, 32, 3, 2, 3), { pos: [-61, 40, 0] }), hullGrime, hullUnder, 0.5));
  const stackTops = [];
  for (let s = 0; s < 4; s++) {
    const stx = -55 - Math.floor(s / 2) * 11;
    const stz = (s % 2 === 0 ? -1 : 1) * 9;
    parts.push(paint(place(cyl(1.7, 2.1, 11, 8), { pos: [stx, 49.5, stz] }), hullGrime, hullUnder, 0.4));
    parts.push(paint(place(cyl(2.0, 1.8, 1.6, 8), { pos: [stx, 55.6, stz] }), hullDark)); // soot tip
    stackTops.push(new THREE.Vector3(stx, 56.5, stz));
  }
  // stern vent grilles
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(0.8, 5, 10), { pos: [-74.6, 30, side * 8] }), hullUnder));
  }

  // --- cab at the front quarter, on the spine's leading edge (modest;
  // sightline over the intake) ---
  const cabGeo = box(11, 6, 14, 2, 2, 2);
  { // shear the windshield face back
    const p = cabGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) > 5.4) p.setX(i, 5.4 - 3.2 * ((p.getY(i) + 3) / 6));
    }
  }
  parts.push(paint(place(cabGeo, { pos: [19, 47.2, 6] }), hullGrime, hullUnder, 0.45));
  parts.push(paint(place(box(4.2, 2.0, 12.4), { pos: [20.4, 48.4, 6] }), hullDark)); // visor band

  // --- forward intake: downward-angled funnel from the raised nose to the
  // sand (the front/back read) ---
  const TILT = -0.85; // rad below horizontal — steeper now the nose rides high
  const dirX = Math.cos(TILT), dirY = Math.sin(TILT);
  const FUNNEL_LEN = 30;
  const neckX = 55, neckY = 26;
  const fcx = neckX + dirX * FUNNEL_LEN / 2, fcy = neckY + dirY * FUNNEL_LEN / 2;
  const mouthX = neckX + dirX * FUNNEL_LEN, mouthY = neckY + dirY * FUNNEL_LEN; // ~74.8, ~3.5
  // collar mount on the nose deck
  parts.push(paint(place(box(11, 10, 14, 2, 2, 2), { pos: [50, 27, 0] }), hullGrime, hullUnder, 0.4));
  // the funnel itself: narrow at the hull, flaring to the sand
  parts.push(paint(place(cyl(4.2, 9.5, FUNNEL_LEN, 10, 3), {
    rot: [0, 0, TILT - Math.PI / 2], pos: [fcx, fcy, 0],
  }), hullGrime, hullSand, 0.3));
  // heavy mouth ring + dark throat, nosing into the sand it vacuums
  parts.push(paint(place(cyl(10.2, 10.4, 2.6, 10), {
    rot: [0, 0, TILT - Math.PI / 2], pos: [mouthX, mouthY, 0],
  }), hullUnder, hullGrime, 0.3));
  parts.push(paint(place(cyl(9.0, 9.0, 0.6, 10), {
    rot: [0, 0, TILT - Math.PI / 2], pos: [mouthX + dirX * 1.0, mouthY + dirY * 1.0, 0],
  }), hullUnder));
  // twin support struts from the nose belly to the funnel mid
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(15, 1.4, 1.4), {
      rot: [0, 0, -0.7], pos: [61, 17, side * 6],
    }), hullGrime, hullUnder, 0.5));
  }

  // --- short sensor mast behind the cab ---
  parts.push(paint(place(cyl(0.45, 0.6, 13, 6), { pos: [6, 51, 10] }), hullGrime));
  parts.push(paint(place(box(5, 0.8, 0.8), { pos: [6, 55.8, 10] }), hullGrime));

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  bakeWeathering(merged);

  return {
    geometry: merged,
    // spark sites: intake mouth, fore hip joints, a stack top, cab roof
    anchors: [
      new THREE.Vector3(mouthX, mouthY + 2, 0),
      new THREE.Vector3(36, 27, 33),
      new THREE.Vector3(36, 27, -33),
      stackTops[1],
      new THREE.Vector3(19, 51, 6),
    ],
    scoopMouth: new THREE.Vector3(mouthX + 1.5, mouthY - 1.5, 0),
    lightPositions: [
      new THREE.Vector3(6, 57.2, 10),       // mast head
      new THREE.Vector3(22, 51, 6),         // cab roof, over the intake
    ],
    // engine heat vent on the stern block's starboard flank (camera-facing)
    glowPos: new THREE.Vector3(-61, 40, 16.4),
  };
}

// ---- pooled particle systems (worm.js pattern: preallocated, dt-gated, no per-frame alloc) ----

function createPlume(source) {
  const COUNT = 200;
  const positions = new Float32Array(COUNT * 3).fill(-99999);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, COUNT);
  // Normal (not additive) blending: intake dust should read as suspended sand
  // catching the light, not a glowing spark spray competing with the tracers.
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: COLORS.dustTan, size: 3.4, transparent: true, opacity: 0.32,
    depthWrite: false,
  }));
  points.frustumCulled = false;

  const SPAWN_RATE = 26; // particles/sec — scaled up with the bigger intake
  const DRAG = 0.85;      // damps all three axes so the plume settles/drifts, doesn't rocket up
  const WIND = { x: 2.2, z: 0.8 }; // steady sideways drift, independent of decaying turbulence
  let spawnAcc = 0, cursor = 0;

  function spawn(i) {
    const j = i * 3;
    positions[j] = source.x + (Math.random() - 0.5) * 5;
    positions[j + 1] = source.y + (Math.random() - 0.5) * 2;
    positions[j + 2] = source.z + (Math.random() - 0.5) * 7;
    velocities[j] = (Math.random() - 0.5) * 3;
    velocities[j + 1] = 3.5 + Math.random() * 3;
    velocities[j + 2] = (Math.random() - 0.5) * 3;
    life[i] = 1.6 + Math.random() * 1.3;
  }

  function findDead() {
    for (let n = 0; n < COUNT; n++) {
      cursor = (cursor + 1) % COUNT;
      if (life[cursor] <= 0) return cursor;
    }
    return -1;
  }

  function step(dt) {
    spawnAcc += dt * SPAWN_RATE;
    while (spawnAcc >= 1) {
      spawnAcc -= 1;
      const idx = findDead();
      if (idx >= 0) spawn(idx);
    }
    for (let i = 0; i < COUNT; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      const drag = Math.max(0, 1 - DRAG * dt);
      velocities[j] *= drag;
      velocities[j + 1] *= drag;
      velocities[j + 2] *= drag;
      positions[j] += (velocities[j] + WIND.x) * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += (velocities[j + 2] + WIND.z) * dt;
      if (life[i] <= 0) positions[j + 1] = -99999;
    }
    geo.attributes.position.needsUpdate = true;
  }

  // warm-start so the plume already reads as "continuous" on the very first
  // rendered frame (and in frozen reduced-motion mode, where dt is always 0).
  for (let t = 0; t < 3; t += 0.1) step(0.1);

  return {
    points,
    update: step,
    degrade() { geo.setDrawRange(0, Math.floor(COUNT / 2)); },
  };
}

function createSparks() {
  const COUNT = 12;
  const positions = new Float32Array(COUNT * 3).fill(-99999);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: COLORS.flashYellow, size: 3.5, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  points.frustumCulled = false;

  function burst(origin) {
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      positions[j] = origin.x; positions[j + 1] = origin.y; positions[j + 2] = origin.z;
      velocities[j] = (Math.random() - 0.5) * 24;
      velocities[j + 1] = 8 + Math.random() * 14;
      velocities[j + 2] = (Math.random() - 0.5) * 24;
      life[i] = 0.4 + Math.random() * 0.4;
    }
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < COUNT; i++) {
      if (life[i] <= 0) continue;
      dirty = true;
      life[i] -= dt;
      const j = i * 3;
      velocities[j + 1] -= 40 * dt;
      positions[j] += velocities[j] * dt;
      positions[j + 1] += velocities[j + 1] * dt;
      positions[j + 2] += velocities[j + 2] * dt;
      if (life[i] <= 0) positions[j + 1] = -99999;
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return { points, burst, update };
}

// ---- public factory ----

export function createHarvester() {
  const group = new THREE.Group();

  const { geometry, anchors, scoopMouth, lightPositions, glowPos } = buildHullGeometry();
  // Dust-scoured dark metal under a noon sun: high roughness, near-zero
  // metalness, and NO emissive lift — the machine must shade honestly or
  // the weathering bake washes out.
  // Modest warm emissive stands in for bounce light off the bright sand —
  // without it the camera-facing (shadow-side) flank crushes to black at
  // native resolution (same trick the pre-Task-3 hull used, retuned).
  const hullMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.08,
    emissive: new THREE.Color(COLORS.hullUnder), emissiveIntensity: 0.38,
  }));
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  group.add(hullMesh);

  // blinking running lights (phase-offset ~1.3s period), dimmed for daylight
  const lightGeo = new THREE.IcosahedronGeometry(1.2, 0);
  const lights = lightPositions.map((p) => {
    const m = new THREE.Mesh(lightGeo, new THREE.MeshStandardMaterial({
      color: COLORS.flashYellow, emissive: COLORS.flashYellow, emissiveIntensity: 0.15,
    }));
    m.position.copy(p);
    m.castShadow = true;
    group.add(m);
    return m;
  });
  const LIGHT_PERIOD = 1.3;
  function blink(elapsed, phase) {
    const t = ((elapsed + phase) % LIGHT_PERIOD + LIGHT_PERIOD) % LIGHT_PERIOD;
    return t < LIGHT_PERIOD * 0.2 ? 2.2 : 0.1;
  }

  // pulsing engine heat vent (stern flank, camera-facing)
  const glowMesh = new THREE.Mesh(
    box(7, 2.6, 0.4),
    new THREE.MeshStandardMaterial({
      color: COLORS.engineGlow, emissive: COLORS.engineGlow, emissiveIntensity: 1,
    }),
  );
  glowMesh.position.copy(glowPos);
  glowMesh.castShadow = true;
  group.add(glowMesh);

  const plume = createPlume(scoopMouth);
  group.add(plume.points);

  const sparks = createSparks();
  group.add(sparks.points);

  let sparkTimer = 4 + Math.random() * 3;

  // Seat on the terrain: duneHeight at the pad center is the local minimum
  // of the (worksite-flattened) field across the footprint, so with the
  // foot skirts extending below local y=0 every foot beds into the sand
  // rather than floating.
  const { x, z, rotY } = LAYOUT.harvester;
  group.position.set(x, duneHeight(x, z) - 0.5, z);
  group.rotation.y = rotY;

  function update(dt, elapsed) {
    lights[0].material.emissiveIntensity = blink(elapsed, 0);
    lights[1].material.emissiveIntensity = blink(elapsed, LIGHT_PERIOD / 2);
    glowMesh.material.emissiveIntensity = 2.1 + 1.1 * Math.sin(elapsed * 2.1);

    plume.update(dt);
    sparks.update(dt);

    if (dt > 0) {
      sparkTimer -= dt;
      if (sparkTimer <= 0) {
        sparkTimer = 8 + Math.random() * 2.5;
        sparks.burst(anchors[Math.floor(Math.random() * anchors.length)]);
      }
    }
  }

  function degrade() {
    plume.degrade();
  }

  return { group, update, degrade };
}
