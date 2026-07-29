import test from 'node:test';
import assert from 'node:assert/strict';
import * as palette from '../themes/dune/palette.js';
const { COLORS } = palette;

test('palette exposes the core spec colors (Task 2: harsh Arrakis noon)', () => {
  assert.equal(COLORS.sandLit, 0xe6c088);
  assert.equal(COLORS.sandShadow, 0x9a7550);
  assert.equal(COLORS.skyZenith, 0x8fb8d8);
  assert.equal(COLORS.horizon, 0xe8dcc2);
  assert.equal(COLORS.amber, 0xd98f3a);
  assert.equal(COLORS.sunlight, 0xfff4e2);
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

test('wormHideDark is added, then lightened for daylight (Task 2)', () => {
  assert.equal(COLORS.wormHideDark, 0x4a3a30);
});

test('wormHideLit is added, then lightened for daylight (Task 2)', () => {
  assert.equal(COLORS.wormHideLit, 0x7d6350);
});

test('wormMaw is added', () => {
  assert.equal(COLORS.wormMaw, 0x1a0f0d);
});

test('wormTeeth is added', () => {
  assert.equal(COLORS.wormTeeth, 0xcbb89a);
});

// Task 2: dusk -> harsh Arrakis noon. Night elements are deleted outright;
// sand/sky/sun retune toward a bleached midday palette; the worm hide may
// lighten slightly since real (daylight) light now does more of the work.
test('moonA (night element) is removed for daylight', () => {
  assert.equal('moonA' in COLORS, false);
  assert.equal(COLORS.moonA, undefined);
});

test('moonB (night element) is removed for daylight', () => {
  assert.equal('moonB' in COLORS, false);
  assert.equal(COLORS.moonB, undefined);
});

test('starWhite (night element) is removed for daylight', () => {
  assert.equal('starWhite' in COLORS, false);
  assert.equal(COLORS.starWhite, undefined);
});

test('hazeWash is added for the daylight heat-haze fog', () => {
  assert.equal(COLORS.hazeWash, 0xe0d2b6);
});

test('sunDisc is added for the sun billboard', () => {
  assert.equal(COLORS.sunDisc, 0xfffdf5);
});

// Task 3: film-accurate harvester hull tones. Per the recorded v4 ruling the hull
// is DARK Harkonnen structure (hullGrime/hullUnder base) carrying heavy sand scour
// (hullSand/hullBleach) on upper surfaces, leading edges and legs — a menacing
// machine wearing the desert, neither a clean black box nor a uniformly tan one.
test('hullSand (harvester khaki base) is added', () => {
  assert.equal(COLORS.hullSand, 0xc7a876);
});

test('hullGrime (rust-brown streaking/panel grime) is added', () => {
  assert.equal(COLORS.hullGrime, 0x7a5230);
});

test('hullBleach (sun-scoured highlight) is added', () => {
  assert.equal(COLORS.hullBleach, 0xe8d9b0);
});

test('hullUnder (dark undercarriage/track shadow) is added', () => {
  assert.equal(COLORS.hullUnder, 0x3a2e22);
});

test('hullDark and harkRed remain for troops and the escort ornithopter', () => {
  assert.equal(COLORS.hullDark, 0x2b2430);
  assert.equal(COLORS.harkRed, 0xd4353a);
});

// Task 4: Harkonnen escort ornithopter — cold metallic trim, value-only.
test('hullTrim (cold metallic trim for the escort ornithopter) is added', () => {
  assert.equal(COLORS.hullTrim, 0x6e6e6e);
});

test('rotorBladeWhite (rotor blade texture highlights) is added', () => {
  assert.equal(COLORS.rotorBladeWhite, 0xffffff);
});
