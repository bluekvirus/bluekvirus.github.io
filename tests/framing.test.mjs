import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera, fitFocus, viewDirForAspect, selectFocusPoints } from '../themes/dune/framing.js';
import { FOCUS } from '../themes/dune/layout.js';

const OPTS = { fov: 52, margin: 1.0, lookLift: 0.4, viewDir: [0.42, 0.3, 0.86] };
// Wide, flat battlefield strip — the shape the box fit exists for.
const BOX = [[-150, 0, -60], [150, 0, -60], [-150, 0, 60], [150, 0, 60], [0, 30, 0]];

const vHalfOf = (fov) => (fov / 2) * Math.PI / 180;

// --- minimal projection helpers (mirror three.js lookAt semantics) ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
function cameraBasis(pos, lookAt) {
  const z = norm(sub(pos, lookAt));
  const x = norm(cross([0, 1, 0], z));
  return { x, y: cross(z, x), z };
}
function toNdc(p, pos, basis, vHalf, aspect) {
  const d = sub(p, pos);
  const depth = -dot(d, basis.z);
  return { x: dot(d, basis.x) / depth / (Math.tan(vHalf) * aspect), y: dot(d, basis.y) / depth / Math.tan(vHalf), depth };
}

test('narrower aspect never brings the camera closer', () => {
  const aspects = [21 / 9, 16 / 9, 1, 3 / 4, 9 / 19.5];
  const d = aspects.map((a) => fitCamera(BOX, a, OPTS).distance);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1], `${aspects[i]} vs ${aspects[i - 1]}`);
  assert.ok(d[d.length - 1] > d[0]); // phone portrait is strictly farther than 21:9
});

test('very wide aspects clamp to the vertical fit (distance stops shrinking)', () => {
  // For this point set + view direction, the vertical extent becomes the
  // binding constraint past aspect ~3.9 (wr/wu = 3.88); beyond that,
  // widening the frame further cannot bring the camera closer.
  const a = fitCamera(BOX, 5, OPTS).distance;
  const b = fitCamera(BOX, 9, OPTS).distance;
  assert.equal(a.toFixed(4), b.toFixed(4));
});

test('camera sits along viewDir at the fitted distance and looks above center', () => {
  const { distance, center, lookAt, position } = fitCamera(BOX, 16 / 9, OPTS);
  const dir = norm(OPTS.viewDir);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(position[i] - (center[i] + dir[i] * distance)) < 1e-9);
  }
  assert.ok(lookAt[1] > center[1]);
  assert.equal(lookAt[0], center[0]);
  assert.equal(lookAt[2], center[2]);
});

test('box fit beats the old sphere fit for a wide-flat point set', () => {
  // The sphere fit's distance for the same points/fov/aspect/margin: the
  // isotropic bound R/sin(min(vHalf, hHalf)) * margin. The box fit must sit
  // strictly closer because the subject is a wide shallow strip, not a ball.
  const aspect = 16 / 9;
  const vHalf = vHalfOf(OPTS.fov);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const cx = BOX.reduce((s, p) => s + p[0], 0) / BOX.length;
  const cy = BOX.reduce((s, p) => s + p[1], 0) / BOX.length;
  const cz = BOX.reduce((s, p) => s + p[2], 0) / BOX.length;
  const R = Math.max(...BOX.map((p) => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)));
  const sphereDistance = R / Math.sin(Math.min(vHalf, hHalf)) * OPTS.margin;
  const { distance } = fitCamera(BOX, aspect, OPTS);
  assert.ok(distance < sphereDistance, `box ${distance} vs sphere ${sphereDistance}`);
});

test('viewDirForAspect: elevation never exceeds 45 degrees at any aspect', () => {
  for (let aspect = 0.3; aspect <= 3.0; aspect += 0.05) {
    const dir = viewDirForAspect(aspect, FOCUS);
    assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-9, 'unit length');
    const elevation = Math.asin(dir[1]) * 180 / Math.PI;
    assert.ok(elevation <= 45, `aspect ${aspect.toFixed(2)} -> elevation ${elevation.toFixed(1)}`);
    assert.ok(elevation > 0, 'camera stays above the ground plane');
  }
});

test('viewDirForAspect: anchors at the tall/wide directions, blends between', () => {
  const tall = viewDirForAspect(0.4, FOCUS);
  const wide = viewDirForAspect(2.0, FOCUS);
  const mid = viewDirForAspect(0.9, FOCUS);
  const nTall = norm(FOCUS.viewDirTall);
  const nWide = norm(FOCUS.viewDirWide);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(tall[i] - nTall[i]) < 1e-9);
    assert.ok(Math.abs(wide[i] - nWide[i]) < 1e-9);
  }
  // Elevation between the anchors, strictly (tall is steeper than wide).
  assert.ok(mid[1] < tall[1] && mid[1] > wide[1]);
});

test('selectFocusPoints: wide tier only at aspect >= 1, bonus never fed to the fit', () => {
  const portrait = selectFocusPoints(FOCUS, 0.75);
  const landscape = selectFocusPoints(FOCUS, 1.5);
  assert.equal(portrait.length, FOCUS.core.length);
  assert.equal(landscape.length, FOCUS.core.length + FOCUS.wide.length);
  assert.ok(!portrait.includes(FOCUS.bonus) && !landscape.includes(FOCUS.bonus));
});

test('horizon-targeted aim pins the horizon at the requested frame fraction', () => {
  const horizonFrac = 0.32;
  const fit = fitCamera(BOX, 16 / 9, { ...OPTS, horizonFrac });
  const basis = cameraBasis(fit.position, fit.lookAt);
  const fwd = basis.z.map((c) => -c);
  const hdir = norm([fwd[0], 0, fwd[2]]); // world-horizontal along the view
  const vHalf = vHalfOf(OPTS.fov);
  const horizNdcY = dot(hdir, basis.y) / dot(hdir, fwd) / Math.tan(vHalf);
  assert.ok(Math.abs(horizNdcY - (1 - 2 * horizonFrac)) < 1e-9);
});

test('fitFocus: at all 8 tested viewports, no focus point clips and the horizon sits in the upper ~40%', () => {
  const viewports = [[1920, 820], [1440, 760], [1280, 800], [1024, 768], [900, 900], [768, 1024], [430, 932], [360, 780]];
  const vHalf = vHalfOf(FOCUS.fov);
  for (const [w, h] of viewports) {
    const aspect = w / h;
    const fit = fitFocus(FOCUS, aspect);
    const basis = cameraBasis(fit.position, fit.lookAt);
    for (const p of selectFocusPoints(FOCUS, aspect)) {
      const n = toNdc(p, fit.position, basis, vHalf, aspect);
      assert.ok(n.depth > 0, `${w}x${h}: point behind camera`);
      assert.ok(Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1, `${w}x${h}: [${p}] clipped (${n.x.toFixed(2)}, ${n.y.toFixed(2)})`);
    }
    const fwd = basis.z.map((c) => -c);
    const hdir = norm([fwd[0], 0, fwd[2]]);
    const horizNdcY = dot(hdir, basis.y) / dot(hdir, fwd) / Math.tan(vHalf);
    const fromTop = (1 - horizNdcY) / 2;
    assert.ok(horizNdcY < 1, `${w}x${h}: horizon not visible`);
    assert.ok(fromTop <= 0.42, `${w}x${h}: horizon at ${(fromTop * 100).toFixed(0)}% from top`);
  }
});
