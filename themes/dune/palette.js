// Single source of truth for every color and link in the dune theme.
export const COLORS = {
  sandLit: 0xe6c088,
  sandShadow: 0x9a7550,
  skyZenith: 0x8fb8d8,
  horizon: 0xe8dcc2,
  hazeWash: 0xe0d2b6,
  sunDisc: 0xfffdf5,
  amber: 0xd98f3a,
  wormHideDark: 0x4a3a30,
  wormHideLit: 0x7d6350,
  wormMaw: 0x1a0f0d,
  wormTeeth: 0xcbb89a,
  sunlight: 0xfff4e2,
  hullDark: 0x2b2430,
  harkRed: 0xd4353a,
  // Task 4: cold metallic trim for the Harkonnen escort ornithopter — the
  // dossier's "cold metallic trim #6E6E6E", distinct from smokeGrey's
  // purple-tinted explosion smoke. Value-only grey, no saturated tint.
  hullTrim: 0x6e6e6e,
  // Task 3: the film harvester is sun-bleached sand/khaki, NOT Harkonnen
  // black (hullDark/harkRed stay for the troops and the escort ornithopter).
  hullSand: 0xc7a876,
  hullGrime: 0x7a5230,
  hullBleach: 0xe8d9b0,
  hullUnder: 0x3a2e22,
  visorRed: 0xff3b30,
  stillsuitTan: 0xb59a6a,
  tracerFremen: 0xffd9a0,
  flashYellow: 0xffd75e,
  explosionOrange: 0xff7a29,
  smokeGrey: 0x6b5f66,
  dustTan: 0xcaa06a,
  engineGlow: 0xff5a3c,
  // Task 4: pure white for rotor blade highlights in the thopter texture.
  // Used in the blade-streak gradient to create bright highlights that stand
  // out under the multiply blend mode — pure white (255,255,255) has no effect
  // when multiplied and serves as the peak of the blade-brightness curve.
  rotorBladeWhite: 0xffffff,
};
