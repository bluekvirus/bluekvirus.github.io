// A reload animation, hand-authored.
//
// The Quaternius pack ships no Reload clip — verified across all 24 clips in
// all ten GLBs — which is why reload was dropped from phase C. This adapts the
// keyframed approach from `archive/rifle-wip`'s soldier/rifle-clips.js, which
// solved the same problem for the soldier sandbox: the right hand brings the
// weapon to the chest and cants it so the mag well presents to the left hand,
// which strips the magazine, fetches a fresh one at the belt, seats it, and
// racks the bolt.
//
// Bones are looked up BY NAME, never by index. Indices differ between this
// pack's models — an index that is a hand on one is an elbow on another — and
// raid/weapons.js already found the hand bone is `Wrist.R`, not the `Hand.R`
// an earlier brief assumed.
//
// The archived clip and this one are the same rig: the soldier sandbox loaded
// Swat.gltf and welded its rifle to `Wrist.R` (soldier/weapon.js's GRIP_BONE),
// exactly as raid/weapons.js does. So the archived poses are reused as
// authored rather than re-solved — they were tuned by eye against a rifle
// hanging off this bone on these arms.

import { COMBAT } from './sim/combat.js';
import { SIM } from './sim/world.js';

const FPS = 60;
const DEG = Math.PI / 180;

// The clip whose FIRST FRAME is the pose this clip starts from, holds the
// untouched body at, and returns to. Sampling a real pose off the rig — rather
// than keying absolute rotations or deltas from the bind pose — is the whole
// trick borrowed from soldier/clips.js: a clip authored as offsets from a
// sampled pose cannot pop, because frame 0 IS that pose, bit for bit.
//
// `Idle_Gun` is present in all 24-clip GLBs in this pack (checked on Swat,
// Punk and Casual, the three raid actually loads) but is deliberately NOT in
// agents.js's CLIP_NAMES — nothing selects it. It is used here purely as a
// pose source, which is also what the archived soldier main.js did with it.
const SOURCE_CLIP = 'Idle_Gun';

// The sim owns how long a reload takes; this clip is sized to it, derived
// rather than hardcoded so the two cannot drift. COMBAT.reloadTime (1.8s) over
// SIM.step (1/60s) is 108 ticks, and every clip in this pack runs at 60fps, so
// 108 ticks is 108 frames. The archived Rifle_Reload ran 168 frames; its
// schedule below is compressed to fit, keeping every phase rather than
// truncating the tail, because a clip that outran the sim's window would be
// cut off mid-rack and one that undershot it would loop.
const LAST_FRAME = Math.round(COMBAT.reloadTime / SIM.step);

/** A pose that reuses another, overriding a handful of bones. */
const vary = (pose, changes) => ({ ...pose, ...changes });

// Axis behaviour, verified on this rig by the archived work and unchanged
// here: arms hang along local -Y; the right arm's +Z raises forward and +X
// swings outward; the left arm mirrors both; Y twists the bone; finger curl is
// negative around each knuckle's local Z.

const GRIP_L = {}; // left hand wrapped around the foregrip
for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
  GRIP_L[`${finger}2.L`] = [0, 0, -45];
  GRIP_L[`${finger}3.L`] = [0, 0, -40];
}
GRIP_L['Thumb2.L'] = [0, 0, -18];

const OPEN_L = {}; // hand off the weapon, fingers relaxed
for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
  OPEN_L[`${finger}2.L`] = [0, 0, -18];
  OPEN_L[`${finger}3.L`] = [0, 0, -15];
}
OPEN_L['Thumb2.L'] = [0, 0, -6];

// Low ready: bladed stance, right hand on the pistol grip at the chest, left
// palm cupping the handguard, muzzle forward-down across the body. The pose
// the reload leaves from and comes home to.
const CARRY = {
  Chest: [0, -22, 0],
  'UpperArm.R': [-36, 0, 0],
  'LowerArm.R': [-16.5, 0, 51],
  'Wrist.R': [0, 12, 0],
  'Shoulder.L': [-14, 0, 13.5],
  'UpperArm.L': [8, 0, -57.5],
  'LowerArm.L': [15, 0, 9.25],
  'Wrist.L': [-45, -12, 0],
  ...GRIP_L,
};

// The right arm's contribution for the whole working section: the rifle stays
// at the chest, canted inboard so the mag well presents to the left hand.
const R_CANT = {
  'UpperArm.R': [-33, 0, 4],
  'LowerArm.R': [-14, 0, 55],
  'Wrist.R': [0, 30, 0],
};

// Eyes down on the weapon while the hands work. The archived RIFLE reload left
// the head alone; soldier/reload.js's pistol reload dipped it (Neck 6, Head 12)
// and called it out as the thing that sells the motion. Kept here at a little
// under those amplitudes: raid's camera is much further out than the sandbox's,
// so the dip is a readability cue at range rather than a detail shot.
const LOOK_DOWN = { Neck: [4, 0, 0], Head: [8, 0, 0] };

const MAGWELL = vary(CARRY, {
  ...R_CANT,
  ...LOOK_DOWN,
  'UpperArm.L': [2, 0, -50],
  'LowerArm.L': [8, 0, 4],
  'Wrist.L': [-25, -12, 0],
});
const BELT = vary(CARRY, {
  ...R_CANT,
  ...OPEN_L,
  ...LOOK_DOWN,
  'UpperArm.L': [-12, 0, -8],
  'LowerArm.L': [4, 0, -14],
  'Wrist.L': [-10, -8, 0],
});
const MAG_SEAT = vary(MAGWELL, {
  'LowerArm.L': [12, 0, 8],
  'Wrist.L': [-32, -12, 0],
});
const CHARGE = vary(CARRY, {
  ...R_CANT,
  ...LOOK_DOWN,
  'UpperArm.L': [-42, 0, -68],
  'LowerArm.L': [-4, 0, -14],
  'Wrist.L': [-35, -12, 0],
});
const CHARGE_PULL = vary(CHARGE, {
  'UpperArm.L': [-34, 0, -58],
  'LowerArm.L': [2, 0, -6],
});

// [frame, pose] waypoints over LAST_FRAME. Frame numbers are the archived
// 168-frame schedule scaled by 108/168 and rounded, so the phases keep their
// relative weight: a long reach and a long return, a fast slap, a fast rack.
const SCHEDULE = [
  [0, CARRY],
  [10, MAGWELL],      // hands meet, mag released
  [22, BELT],         // spent mag away, reach the pouch
  [32, BELT],         // grab the fresh magazine
  [45, MAGWELL],      // bring it up
  [50, MAG_SEAT],     // slap it home
  [59, MAGWELL],
  [72, CHARGE],       // hand over the charging handle
  [78, CHARGE_PULL],  // rack
  [84, CHARGE],
  [LAST_FRAME, CARRY],
];

// Every bone any waypoint above touches. All nineteen are present on Swat.glb,
// Punk.glb and Casual.glb — the three models raid loads — checked against each
// GLB's own skin joint list, not assumed from one of them.
const REQUIRED_BONES = [...new Set(SCHEDULE.flatMap(([, pose]) => Object.keys(pose)))];

/** Per-bone [frame, degX, degY, degZ] tracks, expanded from the schedule. */
function tracksFromSchedule(schedule) {
  const tracks = {};
  for (const name of REQUIRED_BONES) {
    tracks[name] = schedule.map(([frame, pose]) => [frame, ...(pose[name] ?? [0, 0, 0])]);
  }
  return tracks;
}

const TRACKS = tracksFromSchedule(SCHEDULE);

/** base (Quaternion) composed with rotations around its local axes. */
function composeDelta(base, degX, degY, degZ) {
  if (!degX && !degY && !degZ) return base.clone();
  let q = BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Right(), degX * DEG);
  q = q.multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Up(), degY * DEG));
  q = q.multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Vector3.Forward(), degZ * DEG));
  return base.multiply(q);
}

/**
 * This figure's OWN `Idle_Gun` group.
 *
 * Every figure owns a private skeleton and a private set of animation groups
 * (see cast.js), so `scene.animationGroups` holds twelve groups all named
 * `Idle_Gun` and picking by name alone would sample somebody else's arms. The
 * right one is the one whose animations target this skeleton. Targets are
 * matched by IDENTITY against both the bones and their linked transform nodes:
 * the glTF loader gives every bone a linked TransformNode and points the
 * imported clips at THAT, not at the Bone, so a set of bones alone would match
 * nothing. Read through `bone.getTransformNode()` — Babylon 9.18.1's Bone has
 * no `linkedTransformNode` property at all (checked on the running rig; the
 * field behind the accessor is private), and an animation aimed at the Bone
 * while the rig is driven through its transform node would be overwritten
 * every frame.
 */
function sourceGroupFor(skeleton, scene) {
  const mine = new Set();
  for (const bone of skeleton.bones) {
    mine.add(bone);
    const node = bone.getTransformNode?.();
    if (node) mine.add(node);
  }
  return scene.animationGroups.find((g) => (
    g.name === SOURCE_CLIP && g.targetedAnimations.some((ta) => mine.has(ta.target))
  )) ?? null;
}

/**
 * Build this figure's `Rifle_Reload` clip.
 *
 * @param {BABYLON.Skeleton} skeleton - the figure's own skeleton.
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.AnimationGroup|null} null when the rig cannot support the
 *   clip, in which case the figure simply has no reload animation.
 */
export function buildReloadClip(skeleton, scene) {
  const bones = {};
  for (const name of REQUIRED_BONES) {
    const bone = skeleton?.bones.find((b) => b.name === name);
    // Degrade to "no reload animation" rather than throw. Every figure builds
    // its own clip, so a throw here would take the whole cast down at load —
    // and a rig without this bone is a content problem, not a crash.
    if (!bone) return null;
    bones[name] = bone;
  }

  // Same reasoning for a missing pose source: without `Idle_Gun` there is no
  // pose to key offsets against, and inventing one from the bind pose would
  // put the figure in a T-pose for 1.8 seconds.
  const source = sourceGroupFor(skeleton, scene);
  if (!source) return null;

  // Tracks are matched to the source clip's targets by OBJECT IDENTITY, not by
  // comparing `ta.target.name` to a bone name. cast.js instantiates each figure
  // through a naming callback, and that callback renames transform nodes as
  // well as meshes — the node behind `UpperArm.R` comes back as
  // `swat_0_UpperArm.R` on the instance, while the Bone keeps its plain name.
  // A name comparison would therefore match on the template and silently match
  // nothing on the twelve figures that actually get rendered.
  const trackByTarget = new Map();
  for (const [name, bone] of Object.entries(bones)) {
    trackByTarget.set(bone, TRACKS[name]);
    const node = bone.getTransformNode?.();
    if (node) trackByTarget.set(node, TRACKS[name]);
  }

  const group = new BABYLON.AnimationGroup('Rifle_Reload', scene);

  // Rebuild EVERY track the source clip has, not only the nineteen authored
  // bones. agents.js cross-fades one clip in and stops the rest, so whatever
  // this group does not drive keeps the last value some other clip wrote —
  // legs frozen mid-stride while the arms work. Copying the source's frame-0
  // value for the untouched bones costs nothing at playback and leaves the
  // figure fully posed: standing at low ready from the waist down.
  for (const ta of source.targetedAnimations) {
    const prop = ta.animation.targetProperty;
    const base = ta.animation.evaluate(source.from);

    const anim = new BABYLON.Animation(
      `Rifle_Reload_${ta.target.name}_${prop}`, prop, FPS,
      ta.animation.dataType, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE,
    );

    const track = prop === 'rotationQuaternion' ? trackByTarget.get(ta.target) : null;
    anim.setKeys(track
      ? track.map(([frame, x, y, z]) => ({ frame, value: composeDelta(base, x, y, z) }))
      : [
          { frame: 0, value: base.clone ? base.clone() : base },
          { frame: LAST_FRAME, value: base.clone ? base.clone() : base },
        ]);
    group.addTargetedAnimation(anim, ta.target);
  }

  group.normalize(0, LAST_FRAME);
  return group;
}
