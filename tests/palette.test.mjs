import test from 'node:test';
import assert from 'node:assert/strict';
import * as palette from '../themes/dune/palette.js';
const { COLORS } = palette;

test('palette exposes the core spec colors', () => {
  assert.equal(COLORS.sandLit, 0xe8763a);
  assert.equal(COLORS.sandShadow, 0x4a2d5e);
  assert.equal(COLORS.skyZenith, 0x12081f);
  assert.equal(COLORS.horizon, 0xc2452e);
  assert.equal(COLORS.amber, 0xffb347);
  assert.equal(COLORS.starWhite, 0xffffff);
  assert.equal(COLORS.sunlight, 0xffb36b);
  assert.equal(COLORS.moonA, 0x9a9088);
  assert.equal(COLORS.moonB, 0x837490);
  assert.equal(COLORS.hullDark, 0x2b2430);
  assert.equal(COLORS.harkRed, 0xd4353a);
  assert.equal(COLORS.visorRed, 0xff3b30);
  assert.equal(COLORS.stillsuitTan, 0xb59a6a);
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

test('wormHide (v2 purple) is removed by the Task 2 worm rebuild', () => {
  assert.equal('wormHide' in COLORS, false);
  assert.equal(COLORS.wormHide, undefined);
});

// De-neon pass (v3): the cyber-neon mix-in is gone. Light may only come from
// diegetic sources (fire, explosions, engine heat, running lights, dusk sky).
test('neonCyan is removed', () => {
  assert.equal('neonCyan' in COLORS, false);
  assert.equal(COLORS.neonCyan, undefined);
});

test('neonMagenta is removed', () => {
  assert.equal('neonMagenta' in COLORS, false);
  assert.equal(COLORS.neonMagenta, undefined);
});

test('tracerCyan is removed', () => {
  assert.equal('tracerCyan' in COLORS, false);
  assert.equal(COLORS.tracerCyan, undefined);
});

test('fremenEyes is removed', () => {
  assert.equal('fremenEyes' in COLORS, false);
  assert.equal(COLORS.fremenEyes, undefined);
});

test('tracerFremen (pale tracer gold) is added', () => {
  assert.equal(COLORS.tracerFremen, 0xffd9a0);
});

test('wormHideDark is added', () => {
  assert.equal(COLORS.wormHideDark, 0x3a2e28);
});

test('wormHideLit is added', () => {
  assert.equal(COLORS.wormHideLit, 0x6b5344);
});

test('wormMaw is added', () => {
  assert.equal(COLORS.wormMaw, 0x1a0f0d);
});

test('wormTeeth is added', () => {
  assert.equal(COLORS.wormTeeth, 0xcbb89a);
});
