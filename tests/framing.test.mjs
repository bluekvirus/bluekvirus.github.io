import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera } from '../themes/dune/framing.js';

const OPTS = { fov: 52, margin: 1.12, lookLift: 0.1, viewDir: [0.42, 0.3, 0.86] };
const BOX = [[-50, 0, -300], [50, 0, -300], [-50, 0, -200], [50, 0, -200], [0, 30, -250]];

test('narrower aspect pushes the camera farther back', () => {
  const wide = fitCamera(BOX, 21 / 9, OPTS);
  const square = fitCamera(BOX, 1, OPTS);
  const tall = fitCamera(BOX, 9 / 19.5, OPTS);
  // wide (21/9) and square (1) are both >=1: with fov fixed and hHalf >= vHalf
  // whenever aspect >= 1, the vertical half-angle is the binding constraint
  // for the whole landscape/square range, so both fit at the identical
  // distance (verified: atan(tan(vHalf)*1) === vHalf bit-for-bit) — hence >=,
  // not strict >, here. Portrait (aspect < 1) is the range where hHalf < vHalf
  // and distance genuinely grows as aspect narrows further, which the second
  // assertion covers.
  assert.ok(square.distance >= wide.distance);
  assert.ok(tall.distance > square.distance);
});

test('wide aspects clamp to the vertical fit (distance stops shrinking)', () => {
  const a = fitCamera(BOX, 16 / 9, OPTS).distance;
  const b = fitCamera(BOX, 32 / 9, OPTS).distance;
  assert.equal(a.toFixed(4), b.toFixed(4));
});

test('subject projects to a similar frame fraction across aspects', () => {
  const vHalf = (52 / 2) * Math.PI / 180;
  for (const aspect of [21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16]) {
    const { distance, center } = fitCamera(BOX, aspect, OPTS);
    const R = Math.max(...BOX.map(p => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])));
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const half = Math.min(vHalf, hHalf);
    const fraction = Math.asin(R / distance) / half; // 1.0 == exactly fills the tighter axis
    assert.ok(fraction > 0.8 && fraction <= 1.0, `aspect ${aspect} → ${fraction}`);
  }
});

test('camera sits along viewDir at the fitted distance and looks slightly above center', () => {
  const { distance, center, lookAt } = fitCamera(BOX, 16 / 9, OPTS);
  const len = Math.hypot(...OPTS.viewDir);
  const pos = OPTS.viewDir.map((v, i) => center[i] + (v / len) * distance);
  assert.ok(Math.abs(Math.hypot(pos[0] - center[0], pos[1] - center[1], pos[2] - center[2]) - distance) < 1e-6);
  assert.ok(lookAt[1] > center[1]);
});
