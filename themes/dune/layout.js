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
  // Bounding box explosions are scattered within — coordinates only, FX
  // (timing/pools/rendering) lives in combatfx.js.
  battlefield: { x: [-20, 220], z: [-330, -200] },
  camBase: [60, 55, -60],
  // camTarget.x nudged -30 → -15 (with fov 55 → 58 in main.js) so the Fremen
  // cover field (x ∈ [85, 230]) is mostly in frame instead of ~3/10 waypoints;
  // harvester stays left-of-center per spec.
  camTarget: [-15, 22, -280],
  // Aspect-aware framing (Task 3): at aspect >= wideAspect the wide framing
  // above (camBase/fovWide) is used unchanged. As aspect narrows toward
  // narrowAspect (~phone portrait, e.g. 390x844 = 0.462), main.js's
  // computeFraming() lerps fov toward fovNarrow and scales the camBase→
  // camTarget offset by up to pullbackNarrow, pulling the camera back along
  // its existing look direction so the harvester + firefight + worm horizon
  // stay in frame despite the narrower horizontal FOV. Pure function of
  // aspect only, evaluated on mount/resize — not per frame.
  camFrame: { wideAspect: 1.4, narrowAspect: 0.46, fovWide: 58, fovNarrow: 74, pullbackNarrow: 1.55 },
};
