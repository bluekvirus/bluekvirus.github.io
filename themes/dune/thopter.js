import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';

// Harkonnen escort ornithopter (Task 4, v4 §4). Reference: the Part Two
// harvester-raid escort variant was modeled on a Black Hawk helicopter —
// heavier, more rotorcraft-like than the insect-winged thopters elsewhere in
// the films. Harkonnen design language (dossier): smooth, undulating,
// biomorphic "melted black plastic" (Vermette's literal inspiration was
// black septic tanks) — value-only black/grey, NO saturated color, NO
// spiky-evil clichés ("don't design the bad guys' ship like they're bad
// guys"). This is deliberately the stylistic opposite of harvester.js: that
// hull is flat-shaded, faceted, blocky and heavily weathered ("factory laid
// flat"); this hull is smooth-shaded, unweathered, biomorphic.
//
// Local frame: +Z = fore (nose), +Y up, origin at the fuselage center.
// Twin rotor assemblies (spec wording: "twin rotor/wing assemblies") are
// mounted in tandem along the dorsal spine, Chinook-style — fore over the
// cabin, aft over the tail root — plus separate short stub wings at the
// flanks for the weapon-pylon read. (Round 1 tried wingtip-mounted rotor
// nacelles instead; at any zoom that read as spindly drone/insect legs, not
// a heavy rotorcraft, so it was replaced with this tandem mount.) Each disc
// is its own drawable so it can spin about its own hub — a single merged
// mesh cannot spin around two independent pivots.

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

// Piecewise-linear sample of a station array over u in [0, 1].
function sample(arr, u) {
  const t = THREE.MathUtils.clamp(u, 0, 1) * (arr.length - 1);
  const s = Math.min(arr.length - 2, Math.floor(t));
  return arr[s] + (arr[s + 1] - arr[s]) * (t - s);
}

// A smooth-shaded body-of-revolution fuselage: a unit sphere whose every
// y-slice (the elongation axis, pre-rotate) is re-radiused per a station
// profile (independent width/height radii -> a flattened insect-thorax
// cross-section, not a circular tube), then rotated so the elongation axis
// becomes local +Z (fore/aft), matching worm.js's Z-forward convention.
// Smooth (not flat) shading is the deliberate stylistic opposite of the
// harvester's faceted "factory laid flat" panels — this reads as molded
// plastic, not riveted industry.
function buildFuselage() {
  const geo = new THREE.SphereGeometry(1, 24, 16);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  // t: 0 tail .. 1 nose. A slender gunship taper (NOT the harvester's
  // bulbous tick) — long and lean, tapering to a fine nose point and a
  // blunter tail shoulder (the tail boom continues the taper past this
  // point as a separate part). Round 2: leaner/longer than the first pass,
  // which read as a bulbous insect body rather than a rotorcraft fuselage.
  const radiusX = [0.12, 0.95, 1.65, 2.05, 2.15, 1.95, 1.35, 0.10]; // width
  const radiusY = [0.15, 0.75, 1.25, 1.55, 1.55, 1.35, 0.85, 0.10]; // height (flatter)
  const SCALE_X = 3.6, SCALE_Y = 2.9, HALF_LEN = 21;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y + 1) / 2;
    const rx = sample(radiusX, t) * SCALE_X;
    const ry = sample(radiusY, t) * SCALE_Y;
    const rNatural = Math.hypot(x, z);
    if (rNatural > 1e-5) {
      pos.setX(i, (x / rNatural) * rx);
      pos.setZ(i, (z / rNatural) * ry);
    } else {
      pos.setX(i, 0);
      pos.setZ(i, 0);
    }
    pos.setY(i, y * HALF_LEN);
  }
  geo.rotateX(Math.PI / 2); // elongation (Y) -> forward (+Z); old Z -> vertical
  // Flatten the belly slightly (rounder canopy top, flatter chin/gun-pod
  // seat) — a cheap asymmetry pass so the hull isn't a perfect lens.
  const p2 = geo.attributes.position;
  for (let i = 0; i < p2.count; i++) {
    const yv = p2.getY(i);
    if (yv < 0) p2.setY(i, yv * 0.72);
  }
  geo.computeVertexNormals();
  return { geo, halfLen: HALF_LEN };
}

// Subtle normal-based shading bake: NOT a weathering pass (this craft is
// pristine, unweathered Harkonnen plastic, the deliberate opposite of the
// sun-scoured harvester) — just faint ambient-occlusion-style darkening on
// the belly and a faint sheen on the topside so flat-tinted panels read as
// curved rather than washed out under the near-overhead sun.
function bakeShade(geo) {
  const nor = geo.attributes.normal;
  const col = geo.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const ny = nor.getY(i);
    if (ny < -0.2) c.multiplyScalar(0.74);
    else if (ny > 0.4) c.lerp(_cA.setRGB(1, 1, 1), 0.02 * ny);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// ---- hull (fuselage + tail boom/fin + stub wings + pylons/hubs + gun pod) ----

function buildHull() {
  const { hullDark, hullTrim } = COLORS;
  const parts = [];

  const { geo: fuselage, halfLen } = buildFuselage();
  parts.push(paint(fuselage, hullDark));

  // Nose cap: a small flush grey cone right at the point of the nose (a
  // sensor/glass nub) — flush with the taper, not a protruding spike.
  parts.push(paint(place(cyl(0.15, 1.0, 1.6, 8), {
    rot: [Math.PI / 2, 0, 0], pos: [0, 0, halfLen + 0.5],
  }), hullTrim, hullDark, 0.35));

  // Canopy/visor bump: a small flattened dome on the top-front, grey trim —
  // the cockpit glass read.
  const visorGeo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  visorGeo.deleteAttribute('uv');
  visorGeo.scale(2.2, 1.2, 3.0);
  parts.push(paint(place(visorGeo, { pos: [0, 2.4, 11] }), hullTrim, hullDark, 0.25));

  // Ventral chin gun pod (the muzzle anchor lives here, see MUZZLE_LOCAL
  // below) — a Black-Hawk-style chin-mounted turret, seated flush against
  // the belly (round 2: was a disconnected floating ball, now overlaps the
  // hull surface so it visually merges rather than dangles).
  parts.push(paint(place(cyl(1.1, 1.3, 2.6, 8), {
    rot: [Math.PI / 2, 0, 0], pos: [0, -3.4, 14.5],
  }), hullDark, hullTrim, 0.2));
  parts.push(paint(place(box(0.9, 0.9, 2.4), { pos: [0, -4.2, 16.5] }), hullTrim, hullDark, 0.4));

  // Tail boom: tapering cylinder continuing the fuselage taper aft, ending
  // in a swept vertical fin. Thickened from round 1 so it reads at
  // in-scene distance instead of disappearing into the shadowed underside.
  const boomLen = 19;
  parts.push(paint(place(cyl(0.55, 1.05, boomLen, 8), {
    rot: [Math.PI / 2, 0, 0], pos: [0, -0.2, -halfLen - boomLen / 2 + 1.5],
  }), hullDark));
  const finGeo = box(0.7, 7.5, 5.0, 1, 2, 2);
  { // sweep the fin aft as it rises (biomorphic curve, not a hard blade)
    const fp = finGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const u = (fp.getY(i) + 3.75) / 7.5;
      fp.setZ(i, fp.getZ(i) - u * u * 3.0);
    }
  }
  parts.push(paint(place(finGeo, { pos: [0, 3.0, -halfLen - boomLen + 1.5] }), hullDark, hullTrim, 0.15));
  // small ventral fin/skid stub under the tail boom tip (never lands, but
  // reads as structure rather than a bare rod end)
  parts.push(paint(place(box(0.7, 1.8, 1.8), { pos: [0, -1.8, -halfLen - boomLen + 1.5] }), hullDark));

  // Short stub wings (weapon-pylon read, NOT rotor-bearing) at the flanks,
  // mid-fuselage.
  for (const side of [-1, 1]) {
    parts.push(paint(place(box(4.6, 1.1, 2.6, 1, 1, 1), {
      pos: [side * 6.4, -0.6, 1],
    }), hullDark, hullTrim, 0.2));
  }

  // Twin tandem rotor assemblies mounted along the dorsal spine: fore rotor
  // over the cabin, aft rotor over the tail root, each on a short mast
  // rising from the spine (see file header for why tandem, not wingtip).
  const hubPositions = [];
  for (const rz of [9, -8]) {
    const mastH = 4.6;
    const baseY = 2.6; // seats the mast root into the dorsal ridge
    parts.push(paint(place(cyl(0.4, 0.55, mastH, 6), {
      pos: [0, baseY + mastH / 2, rz],
    }), hullDark, hullTrim, 0.3));
    parts.push(paint(place(cyl(1.3, 1.05, 1.3, 8), {
      pos: [0, baseY + mastH + 0.65, rz],
    }), hullTrim, hullDark, 0.35));
    hubPositions.push(new THREE.Vector3(0, baseY + mastH + 1.3, rz));
  }

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  bakeShade(merged);

  return { geometry: merged, hubPositions };
}

// ---- rotor blur discs (each its own drawable so it can spin about its own
// hub, independent of the other) ----

// Convert a THREE.Color and alpha value to an rgba() CSS string, sourcing all
// colors from the palette to maintain a single source of truth.
function rgba(color, alpha) {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildRotorTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2;

  // Radial gradient: dark hull color fading to transparent (from palette).
  const darkColor = new THREE.Color(COLORS.hullDark);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, rgba(darkColor, 0.55));
  grad.addColorStop(0.55, rgba(darkColor, 0.4));
  grad.addColorStop(0.85, rgba(darkColor, 0.22));
  grad.addColorStop(1, rgba(darkColor, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // faint blade-blur streaks so the disc doesn't read as a flat uniform
  // wash — three soft bright wedges, evenly spaced. These blend with multiply,
  // so white acts as no-op (peak brightness) and grey darkens.
  ctx.globalCompositeOperation = 'multiply';
  const bladeWhite = new THREE.Color(COLORS.rotorBladeWhite);
  const bladeMid = new THREE.Color(COLORS.hullTrim);
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    const wedge = ctx.createLinearGradient(0, 0, r, 0);
    wedge.addColorStop(0, rgba(bladeWhite, 1));
    wedge.addColorStop(0.5, rgba(bladeMid, 1));
    wedge.addColorStop(1, rgba(bladeWhite, 1));
    ctx.fillStyle = wedge;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -0.14, 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRotorDisc(texture, radius) {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(Math.PI / 2); // lie flat (normal +Y)
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
}

// ---- strafing-run tracer FX (self-owned: see thopter.js/main.js wiring
// notes — the escort's own chin gun during its strafing run; combatfx.js
// (Task 5) may separately read `muzzle`/`strafing` for impact FX on the
// Fremen line without needing to duplicate this cannon-fire read). ----

function createStrafeFX() {
  const POOL = 8;
  const positions = new Float32Array(POOL * 2 * 3).fill(-99999);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: COLORS.harkRed, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  lines.frustumCulled = false;
  const life = new Float32Array(POOL);
  let cursor = 0;

  function spawn(origin, dir) {
    cursor = (cursor + 1) % POOL;
    const j = cursor * 6;
    positions[j] = origin.x; positions[j + 1] = origin.y; positions[j + 2] = origin.z;
    positions[j + 3] = origin.x + dir.x * 24;
    positions[j + 4] = origin.y + dir.y * 24;
    positions[j + 5] = origin.z + dir.z * 24;
    life[cursor] = 0.16;
    geo.attributes.position.needsUpdate = true;
  }

  function update(dt) {
    let dirty = false;
    for (let i = 0; i < POOL; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      dirty = true;
      if (life[i] <= 0) {
        const j = i * 6;
        positions[j + 1] = -99999;
        positions[j + 4] = -99999;
      }
    }
    if (dirty) geo.attributes.position.needsUpdate = true;
  }

  return { lines, spawn, update };
}

// ---- patrol path: elliptical orbit around/behind the harvester, blended
// with a periodic strafing dive toward the Fremen line. Purely a function
// of `elapsed` (like worm.js's spline sampling) so it freezes for free under
// reduced motion (main.js passes a frozen constant `elapsed` in that mode);
// `dt` is used only for the secondary tracer-spawn cadence below. ----

const T = LAYOUT.thopter;

function smoothstep(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const _orbitP = new THREE.Vector3();
function orbitPos(e, out) {
  const a = (e / T.cycle) * Math.PI * 2;
  const altPhase = (e / (T.cycle * 1.35)) * Math.PI * 2;
  const midY = (T.altMin + T.altMax) / 2, ampY = (T.altMax - T.altMin) / 2;
  out.set(T.cx + Math.cos(a) * T.rx, midY + Math.sin(altPhase) * ampY, T.cz + Math.sin(a) * T.rz);
  return out;
}

function strafeHump(u) { return Math.sin(Math.PI * THREE.MathUtils.clamp(u, 0, 1)); }

function strafePos(u, out) {
  const f = strafeHump(u);
  const midY = (T.altMin + T.altMax) / 2;
  out.set(
    THREE.MathUtils.lerp(T.cx, T.strafeTarget.x, f),
    THREE.MathUtils.lerp(midY, T.strafeAlt, f),
    THREE.MathUtils.lerp(T.cz, T.strafeTarget.z, f),
  );
  return out;
}

// Blend weight/phase of the strafe dive at time e: 0 outside the window,
// ramping to 1 over strafeBlend seconds at each edge, held at 1 in the
// middle. `strafing` is true across the held-at-1 core (matches the
// contract: true "during which" the run happens, not during the blend).
function strafeWindow(e) {
  const period = T.strafeInterval;
  const p = ((e % period) + period) % period;
  const w0 = T.strafeWindowStart, dur = T.strafeDuration, blend = T.strafeBlend;
  if (p < w0 || p > w0 + dur) return { w: 0, u: 0, strafing: false };
  const local = p - w0;
  const rise = smoothstep(local, 0, blend);
  const fall = 1 - smoothstep(local, dur - blend, dur);
  const w = Math.min(rise, fall);
  return { w, u: local / dur, strafing: w > 0.5 };
}

const _strafeP = new THREE.Vector3();
function computePos(e, out) {
  orbitPos(e, _orbitP);
  const sw = strafeWindow(e);
  if (sw.w <= 0) return out.copy(_orbitP);
  strafePos(sw.u, _strafeP);
  return out.copy(_orbitP).lerp(_strafeP, sw.w);
}

// ---- orientation: forward via finite difference of computePos, banking
// into turns via the yaw rate between two neighbouring samples. ----

const EPS = 0.05;
const MAX_BANK = 0.55; // ~31 deg
const BANK_GAIN = 3.2;

const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _fwdA = new THREE.Vector3(), _fwdB = new THREE.Vector3(), _forward = new THREE.Vector3();
const Y_UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _quatBase = new THREE.Quaternion(), _quatBank = new THREE.Quaternion();

function heading(v) { return Math.atan2(v.x, v.z); }
function wrapAngle(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

function frameQuat(forward, bank, out) {
  _right.crossVectors(Y_UP, forward);
  if (_right.lengthSq() < 1e-6) {
    out.setFromUnitVectors(Z_AXIS, forward);
    return out;
  }
  _right.normalize();
  _up.crossVectors(forward, _right);
  _basis.makeBasis(_right, _up, forward);
  _quatBase.setFromRotationMatrix(_basis);
  _quatBank.setFromAxisAngle(Z_AXIS, bank);
  return out.copy(_quatBase).multiply(_quatBank);
}

// Local-space anchor of the chin gun pod (see buildHull) — the live world
// muzzle position is derived from this each frame via group.matrixWorld.
const MUZZLE_LOCAL = new THREE.Vector3(0, -4.6, 17);
const _fireDirLocal = new THREE.Vector3(0.0, -0.55, 1.0).normalize();
const _fireDirWorld = new THREE.Vector3();

// ---- public factory ----

export function createThopter() {
  const group = new THREE.Group();

  const { geometry, hubPositions } = buildHull();
  const hullMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: false, roughness: 0.85, metalness: 0.08,
  }));
  hullMesh.castShadow = true;
  group.add(hullMesh);

  const rotorTex = buildRotorTexture();
  const discs = hubPositions.map((p, i) => {
    const disc = buildRotorDisc(rotorTex, 8.5);
    disc.position.copy(p);
    disc.frustumCulled = false;
    group.add(disc);
    return { mesh: disc, dir: i === 0 ? 1 : -1 };
  });

  const strafeFX = createStrafeFX();
  group.add(strafeFX.lines);

  let fireTimer = 0;
  const ROTOR_SPEED = 26; // rad/s

  const api = {
    group,
    muzzle: new THREE.Vector3(),
    strafing: false,
    update(dt, elapsed) {
      computePos(elapsed, _p1);
      computePos(elapsed - EPS, _p0);
      computePos(elapsed + EPS, _p2);
      _fwdA.subVectors(_p1, _p0).normalize();
      _fwdB.subVectors(_p2, _p1).normalize();
      _forward.subVectors(_p2, _p0);
      if (_forward.lengthSq() < 1e-8) _forward.set(0, 0, 1); else _forward.normalize();

      const yawRate = wrapAngle(heading(_fwdB) - heading(_fwdA)) / EPS;
      const bank = THREE.MathUtils.clamp(-yawRate * BANK_GAIN, -MAX_BANK, MAX_BANK);

      group.position.copy(_p1);
      frameQuat(_forward, bank, group.quaternion);
      group.updateMatrixWorld(true);

      api.muzzle.copy(MUZZLE_LOCAL).applyMatrix4(group.matrixWorld);

      const strafing = strafeWindow(elapsed).strafing;
      api.strafing = strafing;

      for (const d of discs) d.mesh.rotation.y += d.dir * ROTOR_SPEED * dt;

      if (dt > 0) {
        if (strafing) {
          fireTimer -= dt;
          if (fireTimer <= 0) {
            fireTimer = 0.07;
            _fireDirWorld.copy(_fireDirLocal).transformDirection(group.matrixWorld);
            strafeFX.spawn(api.muzzle, _fireDirWorld);
          }
        } else {
          fireTimer = 0;
        }
      }
      strafeFX.update(dt);
    },
  };

  return api;
}
