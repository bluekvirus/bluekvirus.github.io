// Hand-authored animation clips, built at runtime on top of poses sampled
// from the imported glTF clips.
//
// The pattern (used here for Reload, reusable for future combat clips):
//   1. Take a source AnimationGroup whose first frame is the pose the new
//      clip must start and end on (here: Idle_Gun's low ready).
//   2. Sample every track of that group at its first frame — that sampled
//      pose is the "base". Keying deltas against a sampled base rather than
//      hardcoded rest values means the clip cannot pop when the user
//      switches between the source clip and this one.
//   3. Author the new clip as per-bone rotation offsets (degrees around the
//      bone's local axes) at a handful of keyframes. Bones without an entry
//      hold the base pose so the whole body is always fully defined.
//
// All quaternion math happens once at build time; playback is plain Babylon
// keyframe interpolation with zero per-frame allocations added by us.

const FPS = 60;
const LAST_FRAME = 132; // 2.2 s at 60 fps
const DEG = Math.PI / 180;

// Keyframes per bone: [frame, degX, degY, degZ] — rotations composed around
// the bone's local X, Y, Z axes on top of the sampled base orientation.
// Axis behaviour was verified empirically on this rig:
//   arms hang along local -Y; right arm: +Z raises forward, +X swings
//   outward; left arm mirrors (-Z forward, -X inward); Y twists the bone.
const RELOAD_TRACKS = {
  // Right arm draws the pistol in to the chest and cants it so the magazine
  // well presents to the left hand, holds through the insert, then settles.
  'UpperArm.R': [
    [0, 0, 0, 0],
    [12, -14, 0, 24],
    [18, -14, 0, 20],
    [62, -14, 0, 20],
    [68, -16, 0, 17],   // dip as the mag is slapped home
    [76, -14, 0, 20],
    [88, -14, 0, 20],
    [108, -3, 0, 4],
    [118, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
  'LowerArm.R': [
    [0, 0, 0, 0],
    [12, -6, 0, 80],
    [18, -6, 0, 74],
    [62, -6, 0, 74],
    [68, -6, 0, 69],
    [76, -6, 0, 74],
    [88, -6, 0, 74],
    [108, -1, 0, 12],
    [118, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
  'Wrist.R': [
    [0, 0, 0, 0],
    [12, -8, 58, 0],    // cant the pistol inboard
    [18, -8, 52, 0],
    [76, -8, 52, 0],
    [88, -6, 42, 0],
    [108, 0, 8, 0],
    [118, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],

  // Left hand: off the weapon, down to the belt for a fresh magazine, up to
  // the mag well, seat it, then back down to the low-ready hang.
  'UpperArm.L': [
    [0, 0, 0, 0],
    [10, 4, 0, -8],     // release outward
    [24, -12, 0, -20],
    [32, -14, 0, -22],  // at the belt
    [40, -14, 0, -22],  // grabbing the magazine
    [56, -42, 0, -29],  // rising to the weapon
    [64, -46, 0, -31],  // contact / slap
    [82, -45, 0, -30],  // seated
    [96, -18, 0, -16],
    [108, -4, 0, -4],
    [118, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
  'LowerArm.L': [
    [0, 0, 0, 0],
    [10, 2, 0, -8],
    [24, -4, 0, -34],
    [32, -4, 0, -38],
    [40, -4, 0, -38],
    [56, -10, 0, -48],
    [64, -12, 0, -58],
    [82, -12, 0, -52],
    [96, -4, 0, -26],
    [108, 0, 0, -6],
    [118, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
  'Wrist.L': [
    [0, 0, 0, 0],
    [24, 0, -18, 0],    // palm turns to carry the magazine
    [40, 0, -18, 0],
    [64, 0, -8, 0],
    [82, 0, -8, 0],
    [108, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],

  // Eyes on the weapon while the hands work.
  'Neck': [
    [0, 0, 0, 0],
    [16, 6, 0, 0],
    [84, 6, 0, 0],
    [104, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
  'Head': [
    [0, 0, 0, 0],
    [16, 12, 0, 0],
    [84, 12, 0, 0],
    [104, 0, 0, 0],
    [LAST_FRAME, 0, 0, 0],
  ],
};

// Left-hand fingers curl around the fetched magazine while it travels from
// the belt to the mag well, then relax as the hand slides off the weapon.
// Curl = negative rotation around each knuckle's local Z (verified on rig).
for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
  for (const joint of [`${finger}2.L`, `${finger}3.L`]) {
    RELOAD_TRACKS[joint] = [
      [0, 0, 0, 0],
      [16, 0, 0, -6],
      [26, 0, 0, -45],  // closing on the magazine
      [60, 0, 0, -45],  // carrying it up
      [70, 0, 0, -15],  // palm opens to slap it home
      [82, 0, 0, -10],
      [104, 0, 0, -3],
      [118, 0, 0, 0],
      [LAST_FRAME, 0, 0, 0],
    ];
  }
}
RELOAD_TRACKS['Thumb2.L'] = [
  [0, 0, 0, 0],
  [16, 0, 0, -3],
  [26, 0, 0, -22],
  [60, 0, 0, -22],
  [70, 0, 0, -8],
  [82, 0, 0, -5],
  [104, 0, 0, 0],
  [LAST_FRAME, 0, 0, 0],
];

/** base (Quaternion) composed with rotations around its local axes. */
function composeDelta(base, degX, degY, degZ) {
  if (!degX && !degY && !degZ) return base.clone();
  let q = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Right(), degX * DEG);
  q = q.multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), degY * DEG));
  q = q.multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), degZ * DEG));
  return base.multiply(q);
}

/**
 * Build the hand-authored Reload clip and register it with the scene.
 *
 * @param {BABYLON.Scene} scene
 * @param {BABYLON.Skeleton} skeleton - the figure's skeleton (kept in the
 *   signature so future clips that need bone lookups share this interface).
 * @param {BABYLON.AnimationGroup} sourceGroup - clip whose first frame is
 *   the pose to start from and return to (Idle_Gun).
 * @returns {BABYLON.AnimationGroup}
 */
export function createReloadClip(scene, skeleton, sourceGroup) {
  const group = new BABYLON.AnimationGroup('Reload', scene);

  for (const ta of sourceGroup.targetedAnimations) {
    const prop = ta.animation.targetProperty;
    const base = ta.animation.evaluate(sourceGroup.from);

    const anim = new BABYLON.Animation(
      `Reload_${ta.target.name}_${prop}`, prop, FPS,
      ta.animation.dataType, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE,
    );

    const track = prop === 'rotationQuaternion' ? RELOAD_TRACKS[ta.target.name] : null;
    const keys = track
      ? track.map(([frame, x, y, z]) => ({ frame, value: composeDelta(base, x, y, z) }))
      : [
          { frame: 0, value: base.clone() },
          { frame: LAST_FRAME, value: base.clone() },
        ];
    anim.setKeys(keys);
    group.addTargetedAnimation(anim, ta.target);
  }

  group.normalize(0, LAST_FRAME);
  return group;
}
