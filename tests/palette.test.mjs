import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, SIGILS } from '../themes/dune/palette.js';

test('palette exposes the spec colors', () => {
  assert.equal(COLORS.sandLit, 0xe8763a);
  assert.equal(COLORS.sandShadow, 0x4a2d5e);
  assert.equal(COLORS.skyZenith, 0x12081f);
  assert.equal(COLORS.horizon, 0xc2452e);
  assert.equal(COLORS.neonCyan, 0x00e5ff);
  assert.equal(COLORS.neonMagenta, 0xff2e88);
  assert.equal(COLORS.amber, 0xffb347);
});

test('sigil link map matches the spec', () => {
  assert.deepEqual(SIGILS.map(s => [s.id, s.label, s.url]), [
    ['emperor', 'LINKEDIN', 'https://www.linkedin.com/in/timzhiyuanliu'],
    ['guild', 'PROJECTS', 'https://github.com/bluekvirus'],
    ['bene', 'CV', 'mailto:bluekvirus@gmail.com?subject=Hi, I need a copy of your CV :)'],
    ['fremen', 'CONTACT', 'mailto:bluekvirus@gmail.com'],
  ]);
});
