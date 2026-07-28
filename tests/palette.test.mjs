import test from 'node:test';
import assert from 'node:assert/strict';
import * as palette from '../themes/dune/palette.js';
const { COLORS } = palette;

test('palette exposes the spec colors', () => {
  assert.equal(COLORS.sandLit, 0xe8763a);
  assert.equal(COLORS.sandShadow, 0x4a2d5e);
  assert.equal(COLORS.skyZenith, 0x12081f);
  assert.equal(COLORS.horizon, 0xc2452e);
  assert.equal(COLORS.neonCyan, 0x00e5ff);
  assert.equal(COLORS.neonMagenta, 0xff2e88);
  assert.equal(COLORS.amber, 0xffb347);
  assert.equal(COLORS.starWhite, 0xffffff);
  assert.equal(COLORS.wormHide, 0x3b2a52);
  assert.equal(COLORS.sunlight, 0xffb36b);
  assert.equal(COLORS.moonA, 0x9a9088);
  assert.equal(COLORS.moonB, 0x837490);
  assert.equal(COLORS.hullDark, 0x2b2430);
  assert.equal(COLORS.harkRed, 0xd4353a);
  assert.equal(COLORS.visorRed, 0xff3b30);
  assert.equal(COLORS.stillsuitTan, 0xb59a6a);
  assert.equal(COLORS.fremenEyes, 0x35c8ff);
  assert.equal(COLORS.tracerCyan, 0x66f0ff);
  assert.equal(COLORS.flashYellow, 0xffd75e);
  assert.equal(COLORS.explosionOrange, 0xff7a29);
  assert.equal(COLORS.smokeGrey, 0x6b5f66);
  assert.equal(COLORS.dustTan, 0xcaa06a);
  assert.equal(COLORS.engineGlow, 0xff5a3c);
});

test('sigil layer is fully removed from the palette', () => {
  assert.equal('SIGILS' in palette, false);
  assert.equal(palette.SIGILS, undefined);
  assert.equal(COLORS.fremenBlue, undefined);
  assert.equal(COLORS.emperorGold, undefined);
});
