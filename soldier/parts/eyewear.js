// Eyewear catalogue. Parents to the `head` socket, sits below the brow band.

import { box } from './prim.js';
import { DIMS } from './body.js';

const S = DIMS.headSize;

/** Wraparound sunglasses: dark lens bar plus temple arms. */
export function sunglasses({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('shadesLens', {
    size: [S * 0.82, S * 0.15, S * 0.14], anchor: [0, 0, -1],
    pos: [0, S * 0.47, S * 0.40], mat: mats.visor, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`shadesArm${s > 0 ? 'L' : 'R'}`, {
      size: [S * 0.06, S * 0.07, S * 0.52], anchor: [0, 0, -1],
      pos: [s * S * 0.42, S * 0.47, -S * 0.06], mat: mats.gear, ...g,
    }));
  }
  return meshes;
}

/** Bulky goggles with a strap around the skull. */
export function goggles({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Pushed well proud of the face so they also clear balaclavas and wraps.
  meshes.push(box('goggleFrame', {
    size: [S * 0.74, S * 0.24, S * 0.16], anchor: [0, 0, -1],
    pos: [0, S * 0.52, S * 0.54], mat: mats.gear, ...g,
  }));
  meshes.push(box('goggleLens', {
    size: [S * 0.62, S * 0.14, S * 0.06], anchor: [0, 0, -1],
    pos: [0, S * 0.52, S * 0.68], mat: mats.visor, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`goggleStrap${s > 0 ? 'L' : 'R'}`, {
      size: [S * 0.05, S * 0.12, S * 0.78], anchor: [0, 0, -1],
      pos: [s * S * 0.47, S * 0.55, -S * 0.44], mat: mats.metalDark, ...g,
    }));
  }
  meshes.push(box('goggleStrapBack', {
    size: [S * 0.94, S * 0.12, S * 0.05], anchor: [0, 0, 1],
    pos: [0, S * 0.55, -S * 0.44], mat: mats.metalDark, ...g,
  }));
  return meshes;
}

export function none() {
  return [];
}

export const EYEWEAR = { sunglasses, goggles, none };
