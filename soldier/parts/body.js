// The one base body: skull, torso, arms, legs, and the joint hierarchy every
// gear item attaches to. There is exactly one body in the project — every
// figure on the sheet is this rig in a different colourway with different
// attachments. This file owns the rig; parts never position themselves in
// world space, they parent to a socket returned from here.

import { box, taperedBox, joint } from './prim.js';

// Proportions (metres). Deliberately stylised, not anatomical: oversized head,
// chunky tapering limbs, broad shoulders, short neck — the Synty read.
export const DIMS = {
  hipY: 1.01, // pelvis joint height off the ground
  hipDrop: 0.12, // leg sockets sit this far below the pelvis joint
  hipX: 0.12,
  thigh: 0.38,
  shin: 0.36,
  footH: 0.15,
  spine: 0.16, // pelvis -> chest joint
  chest: 0.36, // chest joint -> neck
  neck: 0.04,
  headSize: 0.33, // big relative to body — key to the toy look
  shoulderY: 0.30, // above the chest joint
  shoulderX: 0.31,
  upperArm: 0.30,
  forearm: 0.26,
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
    bottom: [0.36, 0.26], top: [0.42, 0.28], height: 0.18,
    anchor: [0, 1, 0], pos: [0, 0.02, 0], mat: pants, scene, parent: pelvis,
  }));

  // Torso — broadens hard toward the shoulders.
  meshes.push(taperedBox('torso', {
    bottom: [0.42, 0.27], top: [0.54, 0.32], height: D.spine + D.chest,
    anchor: [0, -1, 0], mat: shirt, scene, parent: spine,
  }));

  // Neck stub.
  meshes.push(box('neckStub', {
    size: [0.16, 0.12, 0.16], anchor: [0, -1, 0], pos: [0, -0.04, 0],
    mat: mats.skin, scene, parent: neck,
  }));

  // ---- head (part of the base body — every figure shares this skull) ---
  const S = D.headSize;
  meshes.push(taperedBox('skull', {
    bottom: [S * 0.72, S * 0.76], top: [S, S * 0.92], height: S,
    anchor: [0, -1, 0], mat: mats.skin, scene, parent: head,
  }));
  // Brow band — the stylised heavy eyebrow strip every sheet character has.
  meshes.push(box('browBand', {
    size: [S * 0.86, S * 0.13, 0.035], anchor: [0, 0, -1],
    pos: [0, S * 0.63, S * 0.42], mat: mats.visor, scene, parent: head,
  }));
  // Blunt nose wedge below the brow — shallow enough that face-covering
  // headgear (balaclava, shemagh) swallows it.
  meshes.push(box('nose', {
    size: [S * 0.16, S * 0.20, 0.024], anchor: [0, 0, -1],
    pos: [0, S * 0.42, S * 0.415], mat: mats.skin, scene, parent: head,
  }));

  // ---- legs -----------------------------------------------------------
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hip = joint(`j_hip${side}`, { pos: [s * D.hipX, -D.hipDrop, 0], scene, parent: pelvis });
    const knee = joint(`j_knee${side}`, { pos: [0, -D.thigh, 0], scene, parent: hip });
    const ankle = joint(`j_ankle${side}`, { pos: [0, -D.shin, 0], scene, parent: knee });

    meshes.push(taperedBox(`thigh${side}`, {
      bottom: [0.185, 0.20], top: [0.215, 0.235], height: D.thigh,
      anchor: [0, 1, 0], mat: pants, scene, parent: hip,
    }));
    meshes.push(taperedBox(`shin${side}`, {
      bottom: [0.16, 0.175], top: [0.19, 0.205], height: D.shin,
      anchor: [0, 1, 0], mat: pantsDark, scene, parent: knee,
    }));
    // Boot: chunky block foot pushed forward plus a cuff over the shin break.
    meshes.push(box(`boot${side}`, {
      size: [0.20, D.footH, 0.31], anchor: [0, 1, -0.32],
      mat: boots, scene, parent: ankle,
    }));
    meshes.push(box(`bootCuff${side}`, {
      size: [0.185, 0.11, 0.21], anchor: [0, -1, 0], pos: [0, -0.055, 0.005],
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

    // Shoulder cap sits slightly inboard so the joint doesn't gap when raised.
    meshes.push(box(`shoulderCap${side}`, {
      size: [0.185, 0.16, 0.24], anchor: [0, 1, 0], pos: [s * -0.015, 0.065, 0],
      mat: sleeves, scene, parent: shoulder,
    }));
    meshes.push(taperedBox(`upperArm${side}`, {
      bottom: [0.13, 0.15], top: [0.165, 0.185], height: D.upperArm,
      anchor: [0, 1, 0], mat: sleeves, scene, parent: shoulder,
    }));
    meshes.push(taperedBox(`forearm${side}`, {
      bottom: [0.115, 0.13], top: [0.135, 0.15], height: D.forearm,
      anchor: [0, 1, 0], mat: sleevesDark, scene, parent: elbow,
    }));
    // Mitten hand — no fingers, per the style.
    meshes.push(box(`hand${side}`, {
      size: [0.125, 0.16, 0.15], anchor: [0, 1, 0],
      mat: hands, scene, parent: wrist,
    }));
    arms[side] = { shoulder, elbow, wrist };
  }

  // ---- sockets --------------------------------------------------------
  // Attachment points gear parents to. Positions here are the single source of
  // truth for where a category of gear sits, on every figure.
  const sockets = {
    head: joint('s_head', { pos: [0, 0, 0], scene, parent: head }),
    chest: joint('s_chest', { pos: [0, 0.17, 0], scene, parent: chest }),
    back: joint('s_back', { pos: [0, 0.14, -0.17], scene, parent: chest }),
    hips: joint('s_hips', { pos: [0, -0.04, 0], scene, parent: pelvis }),
    handR: joint('s_handR', { pos: [0, -0.11, 0.02], scene, parent: arms.R.wrist }),
    handL: joint('s_handL', { pos: [0, -0.11, 0.02], scene, parent: arms.L.wrist }),
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
