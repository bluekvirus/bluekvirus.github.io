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
  // Task 4: Harkonnen escort ornithopter patrol. An elliptical orbit centered
  // behind/around the harvester (harvester {x:-40,z:-280}) so the escort
  // reads as guarding it rather than wandering — the ellipse spans roughly
  // x -150..+10, z -350..-240, encompassing the harvester itself. Altitude
  // is an absolute world-Y cruise band well above the ~62-unit-tall
  // harvester superstructure (Task 3's stack tops sit at y~62). Every
  // strafeInterval seconds the thopter peels off toward strafeTarget (a
  // point on the mid Fremen line, averaged from the near fremenCover
  // cluster above) for strafeDuration seconds, blended in/out over
  // strafeBlend seconds so the hand-off between orbit and dive is seamless
  // (see thopter.js strafeWindow/computePos).
  thopter: {
    cx: -70, cz: -295, rx: 80, rz: 55,
    altMin: 95, altMax: 132, cycle: 30,
    strafeInterval: 20, strafeWindowStart: 6, strafeDuration: 5, strafeBlend: 1.3,
    strafeTarget: { x: 155, z: -262 }, strafeAlt: 45,
  },
  // Two wrecked-vehicle smoke-column sites flanking the Harkonnen arc's
  // ends (battle-damage story) — coordinates only, FX lives in combatfx.js.
  wrecks: [[58, -316], [17, -184]],
  // Task 5: reinforcement entry routes (coordinates only — the attrition
  // state machine lives in troops.js). Each faction gets an ordered list of
  // [x, z] waypoints a recycled unit spawns at / walks through before
  // chasing its own post:
  //  - Fremen re-enter from the eastern dunes, beyond the cover line
  //    (fremenCover reaches x=230, +<=20 de-confliction offsets), so the
  //    walk-in starts at/off the right frame edge and is visibly a walk.
  //  - Harkonnen re-enter from behind the harvester: the spawn point sits
  //    in the hull's screen shadow (its sight line passes through the slab,
  //    so the unit appears already occluded rather than popping onto open
  //    sand), then the route swings west of the stern (-110,-254) and along
  //    the NORTH flank to a rally point off the arc's north end. Waypoints
  //    keep >=10 units clear of every leg foot pad (feet at local
  //    (+-43, {-48,-6,36}) => world (-70,-223) (-31,-238) (9,-252) north /
  //    (-100,-304) (-60,-318) (-21,-333) south) — a direct stern->south-post
  //    line would pass under the hull between the legs.
  reinforce: {
    fremen: [[320, -262]],
    hark: [[-180, -340], [-160, -215], [-5, -205]],
  },
  // Bounding box explosions are scattered within — coordinates only, FX
  // (timing/pools/rendering) lives in combatfx.js.
  battlefield: { x: [-20, 220], z: [-330, -200] },
};

// Subject-fit responsive framing (Task 1, v4 — amended). framing.js's
// fitCamera() does a camera-space BOX fit over the selected FOCUS tiers
// (see framing.js selectFocusPoints): distance — not fov — adapts to aspect,
// and the VIEW DIRECTION itself is aspect-responsive (viewDirWide at
// landscape, viewDirTall at phone portrait, smoothstep-blended between; see
// framing.js viewDirForAspect). Hard constraint honored by both directions:
// elevation stays well under 45°, so the horizon and sky are visible at
// every aspect. main.js recomputes framing on mount/resize only.
export const FOCUS = {
  // Literal world points (derived from harvester/harkArc/fremenCover above —
  // kept as explicit literals so layout.js stays the single coordinate
  // source; y = duneHeight(x,z) + soldier headroom for troop positions).
  //
  // core — always framed: harvester hull extents, Harkonnen arc, and the
  // NEAR Fremen positions (x <= 150).
  core: [
    // harvester hull extents (Task 3 film-accurate legged rebuild: 150 long
    // x ~100 wide at the splayed feet x ~44 tall massing, slab riding at 21
    // on six legs; local +X fore; harvester {x:-40,z:-280,rotY:0.35} rotated
    // into world, ground y ~= 5.8 at the pad)
    [31, 9, -306],    // nose / intake funnel mouth (fore, at the sand)
    [-110, 44, -254], // stern block top (aft)
    [-100, 62, -268], // exhaust stack tops (aft-top)
    [-63, 8, -325],   // port mid-leg foot pad (outer edge)
    [-28, 8, -231],   // starboard mid-leg foot pad (outer edge)
    [-31, 63, -273],  // sensor mast head
    // Harkonnen arc end posts + center (harkArc: cx:-10,cz:-265,r:70)
    [51, 9, -299],
    [22, 12, -203],
    [57, 11, -244],
    // Near Fremen cover posts (fremenCover entries with x <= 150)
    [85, 17, -235],
    [110, 17, -300],
    [140, 22, -215],
    [120, 19, -255],
  ],
  // wide — far Fremen positions (fremenCover x > 150); appended to the fit
  // only at aspect >= 1.0 (framing.js selectFocusPoints), so landscape shows
  // the full engagement line and portrait shows a tighter slice of the same
  // battle.
  wide: [
    [165, 21, -275],
    [190, 20, -320],
    [205, 27, -230],
    [230, 27, -290],
    [175, 24, -245],
    [215, 26, -260],
  ],
  // Worm breach apex (worm {cx:-100,cz:-950,r:500}, breach segment i=3 at
  // angle π/2, lift +130) — bonus, NEVER fed into the fit (it would more
  // than double the forward extent); framed only when it fits for free.
  bonus: [-100, 123, -600],
  // Aspect-responsive view directions (subject -> camera), blended by
  // framing.js viewDirForAspect(). Both keep the horizon in frame:
  //  - viewDirWide: low three-quarter (elevation ~17°) for aspect >= 1.4 —
  //    sky, horizon and worm silhouette clearly visible above the battle.
  //  - viewDirTall: steeper three-quarter (elevation ~35°) for aspect <=
  //    0.55 — battlefield depth projects into screen height for portrait
  //    fill, but stays far below overhead: horizon still in frame.
  viewDirWide: [0.42, 0.30, 0.86],
  // Tall elevation ~27°: steeper than wide (17°) so battlefield depth
  // projects into portrait screen height, but shallow enough that the near
  // Fremen posts clear the bottom edge once the horizon is pinned in the
  // upper band (numerically: at elev >= ~30° the nearest post hangs below
  // the frame bottom at every tested lift — verified in the fit simulator).
  viewDirTall: [0.34, 0.42, 0.74],
  fov: 52,
  // Fit margin, aspect-blended (framing.js fitFocus): slightly tight (<1) at
  // landscape — the box fit is conservative there because the battlefield's
  // far edge projects smaller than the centroid-plane estimate — but >=1 at
  // portrait where the near-right Fremen post would otherwise graze the
  // frame edge.
  marginWide: 0.88,
  marginTall: 1.04,
  // Horizon-targeted aim (framing.js fitCamera): the camera's lookAt is
  // lifted above the subject centroid by exactly the amount that puts the
  // true horizon at this fraction of frame height from the top — horizon in
  // the upper band, dead foreground cropped, at EVERY aspect. Blended:
  // landscape sits the horizon a touch lower to crop its deeper foreground.
  horizonFracWide: 0.38,
  horizonFracTall: 0.30,
};

// Single source of truth for the world-space sun direction (fix round 1,
// Task 2 review). Previously this same "near-overhead noon sun" vector was
// hand-duplicated in three places — main.js's DirectionalLight position,
// main.js's buildSunDisc() placement, and terrain.js's hand-normalized
// vertex-tint bake vector — which meant changing the sun angle required
// editing three unrelated numbers in two files and kept drifting out of
// sync (main.js used (-180,620,-120) while terrain.js used a differently-
// rounded normalized copy). layout.js is the coordinates single-source for
// the rest of the scene, so this lives here too: it's a world-space
// direction like everything else in this file.
//
// This is a raw (unnormalized) position-style vector, same convention the
// old duplicated copies used — consumers do `new THREE.Vector3(...SUN_DIR)`
// and `.normalize()` themselves before deriving a light position (scaled by
// their own distance), a disc placement, or a shading vector, so editing
// these three numbers alone moves the sun everywhere it appears.
//
// Elevation lowered from ~70-71deg (the v4 spec's starting value) to ~55deg
// per fix-round-1 review: at 70 deg troop/harvester contact shadows were only
// a few pixels at native resolution and the scene lost its grounding; 55 deg
// still reads as unambiguous harsh midday while restoring shadow anchoring.
// Horizontal (x,z) direction unchanged from the original -180,-120 azimuth —
// only the elevation (y) was lowered: atan2(309, hypot(180,120)) ~= 55.0deg.
export const SUN_DIR = [-180, 309, -120];
