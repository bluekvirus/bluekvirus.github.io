// Eyewear catalogue. Parents to the `head` socket and positions against the
// shared HEAD landmarks. Contract: eyewear rides ≥ 0.060 proud of the face
// plane, on top of face wraps and balaclavas, so any stack composes.

import { box } from './prim.js';
import { HEAD } from './body.js';

const H = HEAD;

/** Wraparound sunglasses: dark lens bar plus temple arms. */
export function sunglasses({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('shadesLens', {
    size: [H.w * 0.88, 0.036, 0.020], anchor: [0, 0, -1],
    pos: [0, H.eyeY, H.faceZ + 0.042], mat: mats.visor, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`shadesArm${s > 0 ? 'L' : 'R'}`, {
      size: [0.012, 0.016, H.faceZ + 0.055 - (-0.02)], anchor: [0, 0, -1],
      pos: [s * (H.w / 2 + 0.008), H.eyeY, -0.02], mat: mats.gear, ...g,
    }));
  }
  return meshes;
}

/** Bulky goggles with a strap around the skull. */
export function goggles({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('goggleFrame', {
    size: [H.w * 0.80, 0.052, 0.028], anchor: [0, 0, -1],
    pos: [0, H.eyeY + 0.004, H.faceZ + 0.038], mat: mats.gear, ...g,
  }));
  meshes.push(box('goggleLens', {
    size: [H.w * 0.66, 0.034, 0.012], anchor: [0, 0, -1],
    pos: [0, H.eyeY + 0.004, H.faceZ + 0.064], mat: mats.visor, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`goggleStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.012, 0.028, H.faceZ + 0.04 - H.backZ + 0.03], anchor: [0, 0, -1],
      pos: [s * (H.w / 2 + 0.012), H.eyeY + 0.004, H.backZ - 0.028], mat: mats.metalDark, ...g,
    }));
  }
  meshes.push(box('goggleStrapBack', {
    size: [H.w + 0.048, 0.028, 0.012], anchor: [0, 0, 1],
    pos: [0, H.eyeY + 0.004, H.backZ - 0.028], mat: mats.metalDark, ...g,
  }));
  return meshes;
}

export function none() {
  return [];
}

export const EYEWEAR = { sunglasses, goggles, none };
