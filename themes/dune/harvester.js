import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// ---- static geometry helpers (build-time only, never called from update()) ----

function box(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.deleteAttribute('uv');
  return geo;
}

function cyl(rt, rb, h, seg = 8) {
  const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
  geo.deleteAttribute('uv');
  return geo;
}

// Box whose forward (+X) top edge is collapsed to the bottom, producing a
// wedge/ramp: full height where it meets the hull (-X side), tapering to a
// low angled edge at the +X tip. Used for the intake scoop maw.
function wedge(d, h, w) {
  const geo = box(d, h, w);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) > 0 && pos.getY(i) > 0) pos.setY(i, -h / 2);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function paint(geo, colorHex) {
  const c = new THREE.Color(colorHex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(pos[0], pos[1], pos[2]);
  return geo;
}

function buildHullGeometry() {
  const parts = [];
  const HULL_DARK = COLORS.hullDark, HARK_RED = COLORS.harkRed;

  // --- treads: skirts + wheels, two side assemblies ---
  const trackZ = 9.4, wheelR = 3.6, wheelThick = 2.8;
  const wheelXs = [-20, -10, 0, 10, 20];
  for (const side of [-1, 1]) {
    const z = side * trackZ;
    for (const x of wheelXs) {
      parts.push(paint(place(cyl(wheelR, wheelR, wheelThick, 10), {
        pos: [x, wheelR, z], rot: [Math.PI / 2, 0, 0],
      }), HULL_DARK));
    }
    parts.push(paint(place(box(44, 3.4, 3.2), { pos: [0, 4.7, z] }), HULL_DARK));
    parts.push(paint(place(box(40, 0.9, 0.6), { pos: [0, 6.4, z] }), HARK_RED)); // skirt trim stripe
  }

  // --- main hull ---
  const hullBottom = 6.4, hullH = 11, hullTop = hullBottom + hullH;
  const hullCx = -4;
  parts.push(paint(place(box(42, hullH, 19), { pos: [hullCx, hullBottom + hullH / 2, 0] }), HULL_DARK));
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(40, 1.8, 0.5), {
      pos: [hullCx, hullBottom + hullH * 0.55, side * 9.6],
    }), HARK_RED)); // hull side stripe
  }

  // --- upper deck / cab ---
  const deckCx = -10, deckBottom = hullTop, deckH = 6, deckTop = deckBottom + deckH;
  parts.push(paint(place(box(18, deckH, 13), { pos: [deckCx, deckBottom + deckH / 2, 0] }), HULL_DARK));
  parts.push(paint(place(box(18.4, 0.6, 13.4), { pos: [deckCx + 8.5, deckTop + 0.3, 0] }), HARK_RED)); // deck front trim, raised proud of deckTop to avoid z-fighting

  // --- front intake scoop ---
  const hullFrontX = hullCx + 21; // hull spans hullCx-21 .. hullCx+21
  const noseD = 10, noseW = 16;
  parts.push(paint(place(wedge(noseD, hullH, noseW), {
    pos: [hullFrontX + noseD / 2, hullBottom + hullH / 2, 0],
  }), HULL_DARK));
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(noseD, 1.6, 0.5), {
      pos: [hullFrontX + noseD / 2, hullBottom + hullH * 0.6, side * (noseW / 2 - 0.3)],
    }), HARK_RED)); // scoop side trim
  }

  // --- exhaust stacks (3, on cab roof) ---
  for (const z of [-4, 0, 4]) {
    parts.push(paint(place(cyl(1.1, 1.4, 7, 8), {
      pos: [deckCx - 4, deckTop + 3.5, z],
    }), HULL_DARK));
  }

  // --- antenna mast (rear cab corner) ---
  const mastBaseY = deckTop, mastH = 8, mastX = deckCx - 7, mastZ = 6;
  parts.push(paint(place(cyl(0.3, 0.35, mastH, 6), {
    pos: [mastX, mastBaseY + mastH / 2, mastZ],
  }), HULL_DARK));

  // --- rear conveyor arm, rising from hull rear-top ---
  const hullRearX = hullCx - 21;
  const armLen = 16, armElev = 0.87, armPhi = Math.PI - armElev;
  const armBase = [hullRearX, hullTop, 0];
  parts.push(paint(place(box(armLen, 2.6, 2.6).translate(armLen / 2, 0, 0), {
    rot: [0, 0, armPhi], pos: armBase,
  }), HULL_DARK));
  // bracing struts either side
  const strutLen = 9, strutPhi = Math.PI - 1.05;
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(strutLen, 1.2, 1.2).translate(strutLen / 2, 0, 0), {
      rot: [0, 0, strutPhi], pos: [hullRearX + 5, hullTop, side * 2.6],
    }), HULL_DARK));
  }
  const armTip = [
    armBase[0] + armLen * Math.cos(armPhi),
    armBase[1] + armLen * Math.sin(armPhi),
    armBase[2],
  ];
  parts.push(paint(place(box(3.4, 3, 5.4), { pos: armTip }), HARK_RED)); // conveyor head

  // --- engine glow housing (dark shroud; glow strip mesh added separately) ---
  parts.push(paint(place(box(9, 1.6, 7), { pos: [hullRearX + 4, 1.3, 0] }), HULL_DARK));
  parts.push(paint(place(box(9.8, 3, 0.4), {
    pos: [hullRearX + 4, hullBottom + hullH * 0.3, 9.7],
  }), HULL_DARK)); // vent housing rim on the visible hull face, frames the glow strip

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();

  return {
    geometry: merged,
    anchors: [
      new THREE.Vector3(hullFrontX + noseD, hullBottom + hullH * 0.5, 0),
      new THREE.Vector3(0, hullBottom + 3, trackZ),
      new THREE.Vector3(deckCx - 4, deckTop + 7, 4),
      new THREE.Vector3(armTip[0], armTip[1], armTip[2]),
      new THREE.Vector3(deckCx + 8, deckTop, 6),
    ],
    scoopMouth: new THREE.Vector3(hullFrontX + noseD - 1, hullBottom + 1.2, 0),
    lightPositions: [
      new THREE.Vector3(hullFrontX + noseD - 0.5, hullBottom + hullH - 0.5, 0),
      new THREE.Vector3(mastX, mastBaseY + mastH + 0.8, mastZ),
    ],
    glowPos: new THREE.Vector3(hullRearX + 4, hullBottom + hullH * 0.3, 10.05),
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
    color: COLORS.dustTan, size: 2.6, transparent: true, opacity: 0.3,
    depthWrite: false,
  }));
  points.frustumCulled = false;

  const SPAWN_RATE = 18; // particles/sec — a wispy trail, not a wall
  const DRAG = 0.85;      // damps all three axes so the plume settles/drifts, doesn't rocket up
  const WIND = { x: 2.2, z: 0.8 }; // steady sideways drift, independent of decaying turbulence
  let spawnAcc = 0, cursor = 0;

  function spawn(i) {
    const j = i * 3;
    positions[j] = source.x + (Math.random() - 0.5) * 1.6;
    positions[j + 1] = source.y + (Math.random() - 0.5) * 0.8;
    positions[j + 2] = source.z + (Math.random() - 0.5) * 1.6;
    velocities[j] = (Math.random() - 0.5) * 2;
    velocities[j + 1] = 3 + Math.random() * 2.2;
    velocities[j + 2] = (Math.random() - 0.5) * 2;
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
  const hullMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.3,
    emissive: new THREE.Color(COLORS.hullDark), emissiveIntensity: 0.45,
  }));
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  group.add(hullMesh);

  // blinking warning lights (phase-offset ~1.3s period, sharp strobe)
  const lightGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const lights = lightPositions.map((p) => {
    const m = new THREE.Mesh(lightGeo, new THREE.MeshStandardMaterial({
      color: COLORS.flashYellow, emissive: COLORS.flashYellow, emissiveIntensity: 0.2,
    }));
    m.position.copy(p);
    m.castShadow = true;
    group.add(m);
    return m;
  });
  const LIGHT_PERIOD = 1.3;
  function blink(elapsed, phase) {
    const t = ((elapsed + phase) % LIGHT_PERIOD + LIGHT_PERIOD) % LIGHT_PERIOD;
    return t < LIGHT_PERIOD * 0.2 ? 3.6 : 0.15;
  }

  // pulsing engine glow strip (mounted flush on the hull's visible side face)
  const glowMesh = new THREE.Mesh(
    box(8.6, 2.6, 0.15),
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

  const { x, z, rotY } = LAYOUT.harvester;
  group.position.set(x, duneHeight(x, z), z);
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
