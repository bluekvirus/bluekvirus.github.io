// Headgear catalogue. Every item parents to the `head` socket and is sized
// against DIMS.headSize, so any hat fits any figure without per-combination
// tuning. Items layer OVER the body's skull; none of them replaces it.

import { box, taperedBox } from './prim.js';
import { DIMS } from './body.js';

const S = DIMS.headSize;

/** Modern combat helmet: domed two-tier shell, brow brim, NVG mount stub. */
export function combat({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Lower band wraps the skull just above the brow, flaring at the ears.
  meshes.push(taperedBox('helmetBand', {
    bottom: [S * 1.14, S * 1.10], top: [S * 1.24, S * 1.18], height: S * 0.26,
    anchor: [0, -1, 0], pos: [0, S * 0.58, -S * 0.04], mat: mats.helmet, ...g,
  }));
  // Tall dome tapering hard toward a small crown — the domed read.
  meshes.push(taperedBox('helmetDome', {
    bottom: [S * 1.24, S * 1.18], top: [S * 0.68, S * 0.62], height: S * 0.50,
    anchor: [0, -1, 0], pos: [0, S * 0.84, -S * 0.04], mat: mats.helmet, ...g,
  }));
  // Brim lip over the brow.
  meshes.push(box('helmetBrim', {
    size: [S * 1.04, S * 0.11, S * 0.18], anchor: [0, 0, -1],
    pos: [0, S * 0.64, S * 0.50], mat: mats.helmet, ...g,
  }));
  // NVG mount plate on the front.
  meshes.push(box('helmetMount', {
    size: [S * 0.22, S * 0.20, S * 0.10], anchor: [0, 0, -1],
    pos: [0, S * 0.94, S * 0.44], mat: mats.metalDark, ...g,
  }));
  return meshes;
}

/** Patrol cap: short cylinder-ish crown with a flat bill. */
export function cap({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(taperedBox('capCrown', {
    bottom: [S * 1.08, S * 1.00], top: [S * 0.96, S * 0.88], height: S * 0.34,
    anchor: [0, -1, 0], pos: [0, S * 0.70, 0], mat: mats.olive, ...g,
  }));
  meshes.push(box('capBill', {
    size: [S * 0.82, S * 0.06, S * 0.42], anchor: [0, 0, -1],
    pos: [0, S * 0.74, S * 0.48], mat: mats.oliveDark, ...g,
  }));
  return meshes;
}

/** Wide-brimmed boonie / bush hat. */
export function boonie({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(taperedBox('boonieBrim', {
    bottom: [S * 1.50, S * 1.42], top: [S * 1.72, S * 1.62], height: S * 0.10,
    anchor: [0, -1, 0], pos: [0, S * 0.66, 0], mat: mats.vestTan, ...g,
  }));
  meshes.push(taperedBox('boonieCrown', {
    bottom: [S * 1.02, S * 0.94], top: [S * 0.74, S * 0.66], height: S * 0.46,
    anchor: [0, -1, 0], pos: [0, S * 0.74, 0], mat: mats.vestTan, ...g,
  }));
  meshes.push(box('boonieBandTrim', {
    size: [S * 1.06, S * 0.10, S * 0.99], anchor: [0, -1, 0],
    pos: [0, S * 0.76, 0], mat: mats.vestTanDark, ...g,
  }));
  return meshes;
}

/** Red/white checkered shemagh: crown wrap, lower-face wrap, neck drape. */
export function shemagh({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Crown wrap above the brow.
  meshes.push(taperedBox('shemaghCrown', {
    bottom: [S * 1.14, S * 1.10], top: [S * 0.88, S * 0.80], height: S * 0.52,
    anchor: [0, -1, 0], pos: [0, S * 0.72, 0], mat: mats.shemaghRed, ...g,
  }));
  // Thin pale bands suggesting the checker weave — accents, not stripes.
  meshes.push(box('shemaghCheckLow', {
    size: [S * 1.15, S * 0.07, S * 1.11], anchor: [0, -1, 0],
    pos: [0, S * 0.80, 0], mat: mats.shemaghWhite, ...g,
  }));
  meshes.push(box('shemaghCheckHigh', {
    size: [S * 0.99, S * 0.06, S * 0.93], anchor: [0, -1, 0],
    pos: [0, S * 1.04, 0], mat: mats.shemaghWhite, ...g,
  }));
  // Lower-face wrap — swallows nose and mouth, leaves the eye strip open.
  meshes.push(box('shemaghFace', {
    size: [S * 0.98, S * 0.40, S * 1.06], anchor: [0, 0, 0],
    pos: [0, S * 0.22, S * 0.02], mat: mats.shemaghRed, ...g,
  }));
  // Neck drape spilling over the collar and chest.
  meshes.push(taperedBox('shemaghDrape', {
    bottom: [S * 1.30, S * 1.10], top: [S * 0.72, S * 0.66], height: S * 0.52,
    anchor: [0, 1, 0], pos: [0, S * 0.06, S * 0.04], mat: mats.shemaghRed, ...g,
  }));
  meshes.push(box('shemaghDrapeCheck', {
    size: [S * 1.19, S * 0.07, S * 1.01], anchor: [0, 1, 0],
    pos: [0, -S * 0.28, S * 0.04], mat: mats.shemaghWhite, ...g,
  }));
  // Loose tail down the back.
  meshes.push(box('shemaghTail', {
    size: [S * 0.52, S * 0.62, S * 0.14], anchor: [0, 1, 0],
    pos: [0, S * 0.40, -S * 0.62], mat: mats.shemaghRed, ...g,
  }));
  return meshes;
}

/** Balaclava: full dark cover with a skin eye strip (worn over the skull). */
export function balaclava({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(taperedBox('balaclava', {
    bottom: [S * 0.86, S * 1.00], top: [S * 1.10, S * 1.06], height: S * 1.10,
    anchor: [0, -1, 0], pos: [0, -S * 0.02, 0], mat: mats.gear, ...g,
  }));
  meshes.push(box('balaclavaEyes', {
    size: [S * 0.60, S * 0.15, 0.03], anchor: [0, 0, -1],
    pos: [0, S * 0.55, S * 0.53], mat: mats.skin, ...g,
  }));
  return meshes;
}

/** Long dark hair: middle-parted cap, back fall to the neck, side locks. */
export function hair({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(taperedBox('hairCap', {
    bottom: [S * 1.10, S * 1.10], top: [S * 0.84, S * 0.78], height: S * 0.42,
    anchor: [0, -1, 0], pos: [0, S * 0.70, -S * 0.04], mat: mats.hair, ...g,
  }));
  meshes.push(box('hairBack', {
    size: [S * 1.04, S * 0.92, S * 0.24], anchor: [0, 1, 0],
    pos: [0, S * 1.02, -S * 0.44], mat: mats.hair, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`hairSide${s > 0 ? 'L' : 'R'}`, {
      size: [S * 0.16, S * 0.72, S * 0.72], anchor: [0, 1, 0],
      pos: [s * S * 0.55, S * 0.86, -S * 0.12], mat: mats.hair, ...g,
    }));
  }
  return meshes;
}

/** Bare-headed option so `headgear: 'none'` is not a special case downstream. */
export function none() {
  return [];
}

export const HEADGEAR = { combat, cap, boonie, shemagh, balaclava, hair, none };
