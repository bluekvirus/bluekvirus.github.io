// Facial hair catalogue. Parents to the `head` socket; layers proud of the
// skull's lower face like the beard blocks on the item sheet.

import { box, taperedBox } from './prim.js';
import { DIMS } from './body.js';

const S = DIMS.headSize;

/** Short full beard wrapping the jaw. */
export function beardFull({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('beardFront', {
    size: [S * 0.80, S * 0.36, S * 0.16], anchor: [0, 0, -1],
    pos: [0, S * 0.17, S * 0.34], mat: mats.beard, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`beardJaw${s > 0 ? 'L' : 'R'}`, {
      size: [S * 0.14, S * 0.32, S * 0.52], anchor: [0, 0, 0],
      pos: [s * S * 0.40, S * 0.19, S * 0.14], mat: mats.beard, ...g,
    }));
  }
  return meshes;
}

/** Goatee and moustache, chin only. */
export function goatee({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('goateeChin', {
    size: [S * 0.36, S * 0.30, S * 0.14], anchor: [0, 0, -1],
    pos: [0, S * 0.13, S * 0.35], mat: mats.beard, ...g,
  }));
  meshes.push(box('goateeStache', {
    size: [S * 0.52, S * 0.09, S * 0.10], anchor: [0, 0, -1],
    pos: [0, S * 0.30, S * 0.36], mat: mats.beard, ...g,
  }));
  return meshes;
}

/** Long full beard spilling below the chin. */
export function beardLong({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('beardLongFront', {
    size: [S * 0.84, S * 0.42, S * 0.18], anchor: [0, 0, -1],
    pos: [0, S * 0.20, S * 0.33], mat: mats.beard, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`beardLongJaw${s > 0 ? 'L' : 'R'}`, {
      size: [S * 0.16, S * 0.36, S * 0.56], anchor: [0, 0, 0],
      pos: [s * S * 0.42, S * 0.21, S * 0.12], mat: mats.beard, ...g,
    }));
  }
  // Hanging point below the chin.
  meshes.push(taperedBox('beardLongTip', {
    bottom: [S * 0.34, S * 0.12], top: [S * 0.72, S * 0.20], height: S * 0.42,
    anchor: [0, 1, 0], pos: [0, S * 0.06, S * 0.34], mat: mats.beard, ...g,
  }));
  return meshes;
}

export function none() {
  return [];
}

export const FACIAL = { beardFull, goatee, beardLong, none };
