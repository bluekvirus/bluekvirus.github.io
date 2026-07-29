// The one base body: head, torso, arms, legs, and the joint hierarchy every
// gear item attaches to. There is exactly one body in the project — every
// figure on the sheet is this rig in a different colourway with different
// attachments. This file owns the rig; parts never position themselves in
// world space, they parent to a socket returned from here.

import { box, taperedBox, joint } from './prim.js';

// Proportions (metres), derived from the reference sheet's leftmost figures:
// the figure is ~6.5 heads tall (near-realistic, NOT chibi), head width about
// half the shoulder span, slim tapering limbs, waist just above half height.
export const DIMS = {
  hipY: 0.92, // pelvis joint height off the ground
  hipDrop: 0.10, // leg sockets sit this far below the pelvis joint
  hipX: 0.105,
  thigh: 0.40,
  shin: 0.36,
  footH: 0.115,
  spine: 0.15, // pelvis -> chest joint
  chest: 0.33, // chest joint -> neck
  neck: 0.10, // a real neck, clearly visible between collar and jaw
  shoulderY: 0.27, // above the chest joint
  shoulderX: 0.185, // shoulder joints sit AT the torso's top edge, not outside it
  upperArm: 0.27,
  forearm: 0.24,
};

// Face landmarks, in head-joint space (origin at the base of the head, chin
// level, +Z forward). Headgear, facial hair and eyewear all position against
// THESE, never against private magic numbers — that is what makes arbitrary
// stacks (helmet + shades + beard + scarf) compose without special cases.
export const HEAD = {
  w: 0.22, // width at the temples (the widest point)
  h: 0.275, // chin to crown
  d: 0.24, // face plane to the back of the skull
  faceZ: 0.105, // the flat face plane
  backZ: -0.135, // rear of the skull
  chinY: 0.0,
  jawY: 0.105, // top of the jaw block / cheekbone line
  eyeY: 0.155, // eye strip centre
  browY: 0.187, // brow shelf centre
  hatY: 0.21, // where a hat band naturally sits, just above the brow
  crownY: 0.275,
};

// Default colourway: slot names into the shared material set. A loadout
// overrides any subset — that is how the tan grunt and the dark irregular are
// the same body.
const DEFAULT_COLORS = {
  shirt: 'fatigues',
  shirtDark: 'fatiguesDark',
  sleeves: null, // null -> follow shirt
  sleevesDark: null, // null -> follow shirtDark
  pants: 'fatigues',
  pantsDark: 'fatiguesDark',
  hands: 'gloves',
  boots: 'bootsTan',
};

/**
 * The bare head. Split out so its construction reads as one unit: cranium,
 * jaw, brow shelf shadowing two eyes, nose wedge, ears, all on a real neck.
 */
function buildHead({ scene, mats, head, meshes }) {
  const H = HEAD;
  const g = { scene, parent: head };
  const skin = mats.skin;

  // Cranium: widest at the temples, tapering gently to the crown. The face
  // plane stays vertical; the taper happens at the sides and the back.
  meshes.push(taperedBox('skull', {
    bottom: [H.w, H.d], top: [H.w * 0.86, H.d * 0.88],
    height: H.h - H.jawY, anchor: [0, -1, 0],
    pos: [0, H.jawY, (H.faceZ + H.backZ) / 2],
    shift: [0, -0.012], // crown drifts back: brow overhangs, skull bulges rearward
    mat: skin, ...g,
  }));

  // Jaw: cheekbone line down to a narrower chin. The chin tucks back a touch
  // and the jaw sweeps toward the neck.
  meshes.push(taperedBox('jaw', {
    bottom: [H.w * 0.72, H.d * 0.68], top: [H.w, H.d],
    height: H.jawY, anchor: [0, -1, 0],
    pos: [0, 0, H.faceZ - (H.d * 0.68) / 2 - 0.010],
    shift: [0, (H.faceZ + H.backZ) / 2 - (H.faceZ - (H.d * 0.68) / 2 - 0.010)],
    mat: skin, ...g,
  }));

  // Brow shelf: a skin ledge proud of the face plane, shading the eyes.
  meshes.push(box('brow', {
    size: [H.w * 0.92, 0.045, 0.034], anchor: [0, 0, -1],
    pos: [0, H.browY, H.faceZ - 0.02], mat: skin, ...g,
  }));

  // Two eyes under the brow — dark quads, not a single visor stripe.
  for (const s of [1, -1]) {
    meshes.push(box(`eye${s > 0 ? 'L' : 'R'}`, {
      size: [0.042, 0.030, 0.012], anchor: [0, 0, -1],
      pos: [s * 0.047, H.eyeY, H.faceZ - 0.008], mat: mats.visor, ...g,
    }));
  }

  // Nose: a wedge, wider at the base than the bridge.
  meshes.push(taperedBox('nose', {
    bottom: [0.048, 0.038], top: [0.030, 0.022], height: 0.068,
    anchor: [0, -1, 0], pos: [0, 0.092, H.faceZ + 0.012],
    shift: [0, -0.008], mat: skin, ...g,
  }));

  // Ears: small blocks riding the sides at eye height.
  for (const s of [1, -1]) {
    meshes.push(box(`ear${s > 0 ? 'L' : 'R'}`, {
      size: [0.020, 0.055, 0.042], anchor: [-s, 0, 0],
      pos: [s * (H.w / 2 - 0.004), H.eyeY, -0.012], mat: skin, ...g,
    }));
  }
}

/**
 * Build the body and rig.
 * @param {object} colors - partial colourway, slot names from palette.js
 * @returns {{ root, joints, sockets, meshes }}
 */
export function createBody({ scene, mats, parent, colors }) {
  const D = DIMS;
  const c = { ...DEFAULT_COLORS, ...colors };
  const shirt = mats[c.shirt];
  const shirtDark = mats[c.shirtDark];
  const sleeves = mats[c.sleeves ?? c.shirt];
  const sleevesDark = mats[c.sleevesDark ?? c.shirtDark];
  const pants = mats[c.pants];
  const pantsDark = mats[c.pantsDark];
  const hands = mats[c.hands];
  const boots = mats[c.boots];

  const meshes = [];
  const root = new BABYLON.TransformNode('soldier_root', scene);
  if (parent) root.parent = parent;

  // ---- spine chain ----------------------------------------------------
  const pelvis = joint('j_pelvis', { pos: [0, D.hipY, 0], scene, parent: root });
  const spine = joint('j_spine', { pos: [0, 0, 0], scene, parent: pelvis });
  const chest = joint('j_chest', { pos: [0, D.spine, 0], scene, parent: spine });
  const neck = joint('j_neck', { pos: [0, D.chest, 0], scene, parent: chest });
  const head = joint('j_head', { pos: [0, D.neck, 0], scene, parent: neck });

  // Hips block — anchored at its top so it hangs below the pelvis joint.
  meshes.push(taperedBox('hips', {
    bottom: [0.295, 0.20], top: [0.315, 0.215], height: 0.16,
    anchor: [0, 1, 0], pos: [0, 0.02, 0], mat: pants, scene, parent: pelvis,
  }));

  // Torso — waist to a broader chest; shoulder caps continue the slope outward.
  meshes.push(taperedBox('torso', {
    bottom: [0.30, 0.195], top: [0.375, 0.235], height: D.spine + D.chest,
    anchor: [0, -1, 0], mat: shirt, scene, parent: spine,
  }));
  // Collar: a short shirt-coloured ring around the neck root.
  meshes.push(taperedBox('collar', {
    bottom: [0.17, 0.16], top: [0.145, 0.14], height: 0.05,
    anchor: [0, -1, 0], pos: [0, -0.008, -0.005], mat: shirtDark, scene, parent: neck,
  }));

  // Neck — skin column from the collar up into the jaw.
  meshes.push(box('neck', {
    size: [0.095, D.neck + 0.07, 0.105], anchor: [0, -1, 0],
    pos: [0, -0.035, -0.012], mat: mats.skin, scene, parent: neck,
  }));

  // ---- head (part of the base body — every figure shares this skull) ---
  buildHead({ scene, mats, head, meshes });

  // ---- legs -----------------------------------------------------------
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hip = joint(`j_hip${side}`, { pos: [s * D.hipX, -D.hipDrop, 0], scene, parent: pelvis });
    const knee = joint(`j_knee${side}`, { pos: [0, -D.thigh, 0], scene, parent: hip });
    const ankle = joint(`j_ankle${side}`, { pos: [0, -D.shin, 0], scene, parent: knee });

    meshes.push(taperedBox(`thigh${side}`, {
      bottom: [0.145, 0.16], top: [0.175, 0.19], height: D.thigh,
      anchor: [0, 1, 0], mat: pants, scene, parent: hip,
    }));
    meshes.push(taperedBox(`shin${side}`, {
      bottom: [0.125, 0.135], top: [0.15, 0.165], height: D.shin,
      anchor: [0, 1, 0], mat: pantsDark, scene, parent: knee,
    }));
    // Boot: block foot pushed forward plus a cuff over the shin break.
    meshes.push(box(`boot${side}`, {
      size: [0.165, D.footH, 0.26], anchor: [0, 1, -0.34],
      mat: boots, scene, parent: ankle,
    }));
    meshes.push(box(`bootCuff${side}`, {
      size: [0.15, 0.10, 0.175], anchor: [0, -1, 0], pos: [0, -0.05, 0.005],
      mat: boots, scene, parent: ankle,
    }));
    legs[side] = { hip, knee, ankle };
  }

  // ---- arms -----------------------------------------------------------
  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const shoulder = joint(`j_shoulder${side}`, {
      pos: [s * D.shoulderX, D.shoulderY, 0], scene, parent: chest,
    });
    const elbow = joint(`j_elbow${side}`, { pos: [0, -D.upperArm, 0], scene, parent: shoulder });
    const wrist = joint(`j_wrist${side}`, { pos: [0, -D.forearm, 0], scene, parent: elbow });

    // Shoulder cap: overlaps the torso's top edge and flows down into the
    // arm — wider at the top (deltoid) than where it meets the sleeve.
    meshes.push(taperedBox(`shoulderCap${side}`, {
      bottom: [0.11, 0.145], top: [0.135, 0.175], height: 0.145,
      anchor: [0, 1, 0], pos: [s * -0.012, 0.068, 0],
      shift: [s * -0.03, 0], // cap crown leans inboard, onto the torso
      mat: sleeves, scene, parent: shoulder,
    }));
    meshes.push(taperedBox(`upperArm${side}`, {
      bottom: [0.10, 0.115], top: [0.12, 0.135], height: D.upperArm,
      anchor: [0, 1, 0], mat: sleeves, scene, parent: shoulder,
    }));
    meshes.push(taperedBox(`forearm${side}`, {
      bottom: [0.09, 0.10], top: [0.105, 0.115], height: D.forearm,
      anchor: [0, 1, 0], mat: sleevesDark, scene, parent: elbow,
    }));
    // Mitten hand — no fingers, per the style.
    meshes.push(box(`hand${side}`, {
      size: [0.085, 0.15, 0.11], anchor: [0, 1, 0], pos: [0, 0.02, 0],
      mat: hands, scene, parent: wrist,
    }));
    arms[side] = { shoulder, elbow, wrist };
  }

  // ---- sockets --------------------------------------------------------
  // Attachment points gear parents to. Positions here are the single source of
  // truth for where a category of gear sits, on every figure.
  const sockets = {
    head: joint('s_head', { pos: [0, 0, 0], scene, parent: head }),
    chest: joint('s_chest', { pos: [0, 0.16, 0], scene, parent: chest }),
    back: joint('s_back', { pos: [0, 0.12, -0.13], scene, parent: chest }),
    hips: joint('s_hips', { pos: [0, -0.04, 0], scene, parent: pelvis }),
    handR: joint('s_handR', { pos: [0, -0.10, 0.02], scene, parent: arms.R.wrist }),
    handL: joint('s_handL', { pos: [0, -0.10, 0.02], scene, parent: arms.L.wrist }),
  };

  const joints = {
    root, pelvis, spine, chest, neck, head,
    hipL: legs.L.hip, kneeL: legs.L.knee, ankleL: legs.L.ankle,
    hipR: legs.R.hip, kneeR: legs.R.knee, ankleR: legs.R.ankle,
    shoulderL: arms.L.shoulder, elbowL: arms.L.elbow, wristL: arms.L.wrist,
    shoulderR: arms.R.shoulder, elbowR: arms.R.elbow, wristR: arms.R.wrist,
  };

  return { root, joints, sockets, meshes };
}
