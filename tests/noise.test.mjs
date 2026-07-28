import test from 'node:test';
import assert from 'node:assert/strict';
import { duneHeight } from '../themes/dune/noise.js';

test('deterministic: same input, same output', () => {
  assert.equal(duneHeight(123.4, -567.8), duneHeight(123.4, -567.8));
});

test('bounded: |height| < 150 across the terrain extent', () => {
  for (let x = -2000; x <= 2000; x += 97) {
    for (let z = -2000; z <= 2000; z += 89) {
      const h = duneHeight(x, z);
      assert.ok(Number.isFinite(h) && Math.abs(h) < 150, `h(${x},${z}) = ${h}`);
    }
  }
});

test('corridor near origin is flatter than the far field', () => {
  let near = 0, far = 0, n = 0;
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * Math.PI * 2;
    near += Math.abs(duneHeight(-20 + Math.cos(a) * 150, -270 + Math.sin(a) * 150));
    far += Math.abs(duneHeight(-20 + Math.cos(a) * 1600, -270 + Math.sin(a) * 1600));
    n++;
  }
  assert.ok(near / n < far / n, `near avg ${near / n} should be < far avg ${far / n}`);
});
