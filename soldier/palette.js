// Single source of truth for every colour and material in the figures.
// Synty POLYGON-style: flat, unlit-looking solid panels, muted military tones.
// A faction recolour is an edit here and nowhere else.

export const COLORS = {
  // -- uniforms ------------------------------------------------------------
  fatigues: '#b7a47d', // tan uniform (grunt, militant shirt, shemagh trousers)
  fatiguesDark: '#9d8a64', // shaded tan panels (sleeve/trouser breaks)
  greyFatigues: '#a7a8a1', // grey-blue operator fatigues
  greyFatiguesDark: '#8d8e86',
  camo: '#98995f', // ranger olive/green camo
  camoDark: '#7d7e4e',
  olive: '#7c8148', // shemagh fighter's olive shirt
  oliveDark: '#666a3b',
  darkShirt: '#4d4d55', // irregular base fighter's shirt
  darkShirtDark: '#3f3f46',
  darkPants: '#585962', // irregulars' dark trousers
  darkPantsDark: '#484951',

  // -- gear ----------------------------------------------------------------
  vestTan: '#b1996d', // light carrier / chest rig tan
  vestTanDark: '#93805c', // tan pouch bodies
  vestNavy: '#40444f', // operator's heavy plate carrier
  vestNavyDark: '#343841',
  vestBrown: '#867a66', // irregular fighter's grey-brown vest
  vestBrownDark: '#6b6151',
  gear: '#3b3d3a', // straps, holsters, dark webbing
  brass: '#bb9254', // ammunition, bandolier rounds
  wire: '#c8402f', // det-cord wires on the militant rig

  // -- body ----------------------------------------------------------------
  bootsTan: '#7d6a4c', // regulars' brown boots
  bootsDark: '#3e3d43', // irregulars' dark boots
  gloves: '#3f3a33', // mitten hands / fingerless gloves
  skin: '#e2b68f', // face, neck, bare hands
  hair: '#332f35', // long dark hair
  beard: '#3b332c', // facial hair

  // -- headgear / hardware ---------------------------------------------------
  helmet: '#484b52', // combat helmet shell
  visor: '#26292d', // brow band, sunglasses lenses
  shemaghRed: '#a84f45', // checkered scarf, dominant red
  shemaghWhite: '#d9d1c0', // checkered scarf, pale squares
  metal: '#5a5d61', // weapon receiver, buckles
  metalDark: '#3a3c3f', // barrel, dark hardware
  wood: '#8a5f3c', // weapon furniture (RPG grips)

  // -- stage -----------------------------------------------------------------
  baseTop: '#43474d', // miniature plinth top (kept dark: it is a stand, not a subject)
  baseRim: '#33363b', // plinth rim
};

// Named material slots. Every part asks for one of these by name rather than
// creating its own material, so draw-call batching stays possible and recolours
// are centralised.
export const SLOTS = Object.keys(COLORS);

/**
 * Build the shared material set once per scene.
 * @returns {Record<string, BABYLON.StandardMaterial>} keyed by slot name
 */
export function createMaterials(scene) {
  const mats = {};
  for (const slot of SLOTS) {
    const m = new BABYLON.StandardMaterial(`mat_${slot}`, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(COLORS[slot]);
    // Flat, toy-like surfaces: no shine, no specular hotspots.
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    // A touch of self-lit colour keeps shadowed facets from going muddy black,
    // the way flat-shaded stylised assets are usually presented.
    m.emissiveColor = BABYLON.Color3.FromHexString(COLORS[slot]).scale(0.12);
    m.freeze();
    mats[slot] = m;
  }
  return mats;
}
