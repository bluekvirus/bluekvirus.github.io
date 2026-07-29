// Pure world-space layout for the battle diorama. No imports, no side effects.
export const LAYOUT = {
  harvester: { x: -40, z: -280, rotY: 0.35 },
  spiceBed: { x: 65, z: -258, rx: 45, rz: 38 },
  farSpice: [{ x: -420, z: -700, rx: 60, rz: 35 }, { x: 380, z: -820, rx: 70, rz: 40 }],
  harkArc: { cx: -10, cz: -265, r: 70, a0: -0.5, a1: 1.1, count: 8 },
  fremenCover: [
    [85, -235], [110, -300], [140, -215], [165, -275],
    [190, -320], [205, -230], [230, -290], [120, -255],
    [175, -245], [215, -260],
  ],
  worm: { cx: -100, cz: -950, r: 500 },
  // Two wrecked-vehicle smoke-column sites flanking the Harkonnen arc's
  // ends (battle-damage story) — coordinates only, FX lives in combatfx.js.
  wrecks: [[58, -316], [17, -184]],
  camBase: [60, 55, -60],
  camTarget: [-30, 22, -280],
};
