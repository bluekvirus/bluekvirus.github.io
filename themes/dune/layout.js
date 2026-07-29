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
};

// Subject-fit responsive framing (Task 1, v4). Replaces the old aspect-lerped
// fov/camBase/camTarget/camFrame constants above: fov is now a fixed constant
// and framing.js's fitCamera() computes a bounding sphere over FOCUS.core so
// distance — not fov — adapts to aspect, filling the frame identically at
// any window shape. main.js calls fitCamera(FOCUS.core, aspect, FOCUS) on
// mount/resize. FOCUS.bonus (worm breach apex) is NEVER fed into the fit —
// the core subject fit is never enlarged/sacrificed to include it; it's
// framed only when it happens to fall inside the core-derived frustum for
// free (see main.js's applyFraming()).
export const FOCUS = {
  // Literal world points (derived from harvester/harkArc/fremenCover above —
  // kept as explicit literals so layout.js stays the single coordinate
  // source; see task-1-report.md for the derivation).
  core: [
    // harvester hull extents (harvester {x:-40,z:-280,rotY:0.35} rotated) +
    // top (mast)
    [-15, 6, -289],   // nose / intake tip (fore)
    [-64, 6, -271],   // rear hull (aft)
    [-73, 36, -268],  // rear conveyor-arm apex (aft-top)
    [-48, 6, -291],   // port track housing
    [-39, 6, -266],   // starboard track housing
    [-48, 38, -271],  // antenna mast top
    // Harkonnen arc end posts + center (harkArc: cx:-10,cz:-265,r:70)
    [51, 9, -299],
    [22, 12, -203],
    [57, 11, -244],
    // Fremen engagement zone corners (bounding box of fremenCover above)
    [85, 14, -215],
    [230, 22, -320],
    [85, 13, -320],
    [230, 27, -215],
  ],
  // Worm breach apex (worm {cx:-100,cz:-950,r:500}, breach segment i=3 at
  // angle π/2, lift +130) — bonus, framed only if it fits for free.
  bonus: [-100, 123, -600],
  // View direction, subject to camera (tuned during Task 1 visual
  // iteration). Steep, near-overhead "war-table" angle. Trade-off (documented in
  // task-1-report.md): with FOCUS.core spanning ~300 world units in X
  // (harvester to the farthest Fremen post) but only ~38 in Y, no viewDir
  // shallow enough to show sky (tilt < vFov/2 = 26°) can reach anywhere near
  // the ≥55%-frame-height fill target — that requires tilt ~70-80°, which
  // puts the horizon entirely above the frustum's top edge. This value
  // clears the ≥55% fill / ≤15% empty-foreground bar at 6 of 8 tested
  // aspects; the two narrowest phone portraits (430x932, 360x780) are
  // mathematically capped at ~48.75% fill (proof: at fov=52 the achievable
  // ceiling at aspect a<1 is atan(tan(26°)·a)/26°, independent of viewDir
  // or FOCUS.core) — well short of 55% no matter how this is tuned.
  viewDir: [0.18, 0.95, 0.03],
  fov: 52,
  margin: 1.02,
  lookLift: 0.05,
};
