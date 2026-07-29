// A figure is described by a plain config over the ONE base body. A new figure
// is a new entry here, not new code; a squad is a list of these. The six named
// loadouts reproduce the character sheet; anything else can be composed from
// the same catalogue via URL parameters (see main.js).

// Body colourways: which palette slots dress the shared rig. The sheet's two
// "base" figures are the same body wearing `regular` vs `irregular`.
export const COLORWAYS = {
  regular: {
    shirt: 'fatigues', shirtDark: 'fatiguesDark',
    pants: 'fatigues', pantsDark: 'fatiguesDark',
    hands: 'skin', boots: 'bootsTan',
  },
  operator: {
    shirt: 'greyFatigues', shirtDark: 'greyFatiguesDark',
    pants: 'greyFatigues', pantsDark: 'greyFatiguesDark',
    hands: 'skin', boots: 'bootsDark',
  },
  ranger: {
    shirt: 'camo', shirtDark: 'camoDark',
    pants: 'camo', pantsDark: 'camoDark',
    hands: 'skin', boots: 'bootsTan',
  },
  irregular: {
    shirt: 'darkShirt', shirtDark: 'darkShirtDark',
    pants: 'darkPants', pantsDark: 'darkPantsDark',
    hands: 'gloves', boots: 'bootsDark',
  },
  insurgent: {
    shirt: 'olive', shirtDark: 'oliveDark',
    pants: 'fatigues', pantsDark: 'fatiguesDark',
    hands: 'gloves', boots: 'bootsDark',
  },
  militant: {
    shirt: 'fatigues', shirtDark: 'fatiguesDark',
    sleeves: 'skin', sleevesDark: 'skin', // sleeveless shirt, bare arms
    pants: 'darkPants', pantsDark: 'darkPantsDark',
    hands: 'skin', boots: 'bootsDark',
  },
};

export const LOADOUTS = {
  // -- top row: regular military -------------------------------------------
  grunt: {
    body: 'regular',
    torso: 'lightCarrier',
    pose: 'idle',
  },
  operator: {
    body: 'operator',
    headgear: 'combat',
    eyewear: 'sunglasses',
    facial: 'beardFull',
    torso: 'plateCarrier',
    pose: 'idle',
  },
  ranger: {
    body: 'ranger',
    headgear: 'boonie',
    eyewear: 'sunglasses',
    facial: 'goatee',
    torso: 'chestRig,bandolier',
    pose: 'idle',
  },

  // -- bottom row: irregular fighters ---------------------------------------
  fighter: {
    body: 'irregular',
    torso: 'fighterVest',
    pose: 'idle',
  },
  shemagh: {
    body: 'insurgent',
    headgear: 'shemagh',
    torso: 'harnessRig',
    back: 'rpg',
    pose: 'idle',
  },
  militant: {
    body: 'militant',
    headgear: 'hair',
    facial: 'beardLong',
    torso: 'wiredRig',
    pose: 'idle',
  },
};

// Sheet order, left to right: top row then bottom row.
export const ROSTER = ['grunt', 'operator', 'ranger', 'fighter', 'shemagh', 'militant'];
