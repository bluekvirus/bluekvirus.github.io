// Facial hair catalogue. Parents to the `head` socket and positions against
// the shared HEAD landmarks. Contract: facial hair stays within 0.030 of the
// face plane so face-covering headgear (shemagh, balaclava) swallows it.

import { box, taperedBox } from './prim.js';
import { HEAD } from './body.js';

const H = HEAD;

/** Short full beard wrapping the jaw and chin, up to the sideburns. */
export function beardFull({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Muzzle block: chin up to just under the nose, proud of the jaw.
  meshes.push(taperedBox('beardFront', {
    bottom: [H.w * 0.68, H.d * 0.66], top: [H.w * 1.04, H.d * 0.92], height: 0.095,
    anchor: [0, -1, 0], pos: [0, -0.012, 0.020],
    shift: [0, -0.008], mat: mats.beard, ...g,
  }));
  // Sideburns up the cheeks to the ears — centred ON the skull surface so
  // they stay within the face-wrap contract width.
  for (const s of [1, -1]) {
    meshes.push(box(`beardBurn${s > 0 ? 'L' : 'R'}`, {
      size: [0.020, 0.085, H.d * 0.42], anchor: [0, -1, 0],
      pos: [s * (H.w / 2 + 0.002), 0.055, 0.028], mat: mats.beard, ...g,
    }));
  }
  return meshes;
}

/** Goatee and moustache, chin only. */
export function goatee({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Chin tuft wrapping under the chin, clearly separated from the moustache.
  meshes.push(taperedBox('goateeChin', {
    bottom: [0.052, 0.040], top: [0.066, 0.052], height: 0.052,
    anchor: [0, -1, 0], pos: [0, -0.014, H.faceZ - 0.030], mat: mats.beard, ...g,
  }));
  meshes.push(box('goateeStache', {
    size: [0.095, 0.018, 0.016], anchor: [0, 0, -1],
    pos: [0, 0.080, H.faceZ - 0.002], mat: mats.beard, ...g,
  }));
  return meshes;
}

/** Long full beard spilling below the chin. */
export function beardLong({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Full muzzle wrap, like beardFull but heavier.
  meshes.push(taperedBox('beardLongFront', {
    bottom: [H.w * 0.74, H.d * 0.72], top: [H.w * 1.06, H.d * 0.94], height: 0.10,
    anchor: [0, -1, 0], pos: [0, -0.008, 0.020],
    shift: [0, -0.008], mat: mats.beard, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`beardLongBurn${s > 0 ? 'L' : 'R'}`, {
      size: [0.022, 0.09, H.d * 0.46], anchor: [0, -1, 0],
      pos: [s * (H.w / 2 + 0.002), 0.055, 0.026], mat: mats.beard, ...g,
    }));
  }
  // Hanging point below the chin, tapering as it falls.
  meshes.push(taperedBox('beardLongTip', {
    bottom: [0.065, 0.030], top: [0.135, 0.055], height: 0.14,
    anchor: [0, 1, 0], pos: [0, -0.005, H.faceZ - 0.045],
    shift: [0, 0.012], mat: mats.beard, ...g,
  }));
  return meshes;
}

export function none() {
  return [];
}

export const FACIAL = { beardFull, goatee, beardLong, none };
