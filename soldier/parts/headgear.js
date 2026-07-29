// Headgear catalogue. Every item parents to the `head` socket and positions
// against the shared HEAD landmarks from body.js, so any hat fits the one
// skull — and stacks with eyewear/facial hair — without per-combination
// tuning. Items layer OVER the body's skull; none of them replaces it.
//
// Stacking contract (z, from the face plane HEAD.faceZ outward):
//   facial hair sits ≤ 0.030 proud of the face plane,
//   face-covering wraps sit ≥ 0.045 proud (they swallow beards),
//   eyewear sits ≥ 0.060 proud (it rides on top of everything).

import { box, taperedBox, dome, cyl } from './prim.js';
import { HEAD } from './body.js';

const H = HEAD;

/** Modern combat helmet: faceted dome shell over a brow rim, NVG mount stub. */
export function combat({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Shell: a proper faceted dome sitting just above the brow, flared a touch
  // wider than the skull so it reads as worn, not painted on.
  meshes.push(dome('helmetDome', {
    size: [H.w * 1.38, 0.155, H.d * 1.30], cut: 0.52,
    pos: [0, H.hatY - 0.01, -0.018], mat: mats.helmet, ...g,
  }));
  // Rim band under the dome, wrapping the skull above the ears.
  meshes.push(taperedBox('helmetBand', {
    bottom: [H.w * 1.26, H.d * 1.22], top: [H.w * 1.34, H.d * 1.27], height: 0.045,
    anchor: [0, -1, 0], pos: [0, H.hatY - 0.048, -0.018], mat: mats.helmet, ...g,
  }));
  // Brim lip over the brow.
  meshes.push(box('helmetBrim', {
    size: [H.w * 0.92, 0.028, 0.045], anchor: [0, 0, -1],
    pos: [0, H.hatY - 0.028, H.faceZ + 0.008], mat: mats.helmet, ...g,
  }));
  // NVG mount plate on the front of the shell.
  meshes.push(box('helmetMount', {
    size: [0.05, 0.05, 0.03], anchor: [0, 0, -1],
    pos: [0, H.hatY + 0.045, H.faceZ + 0.015], mat: mats.metalDark, ...g,
  }));
  return meshes;
}

/** Patrol cap: short cylinder-ish crown with a flat bill. */
export function cap({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(taperedBox('capCrown', {
    bottom: [H.w * 1.12, H.d * 1.06], top: [H.w * 1.02, H.d * 0.92], height: 0.085,
    anchor: [0, -1, 0], pos: [0, H.hatY - 0.012, -0.012],
    shift: [0, 0.012], mat: mats.olive, ...g,
  }));
  meshes.push(box('capBill', {
    size: [H.w * 0.86, 0.016, 0.09], anchor: [0, 0, -1],
    pos: [0, H.hatY - 0.002, H.faceZ + 0.006], mat: mats.oliveDark, ...g,
  }));
  return meshes;
}

/** Boonie / bush hat: domed crown over a wide down-sloping brim. */
export function boonie({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Brim: a shallow faceted cone — wider at the bottom, so it slopes DOWN
  // and reads as a floppy bush-hat brim, not a flat disc.
  meshes.push(cyl('boonieBrim', {
    dia: H.w * 2.35, diaTop: H.w * 1.45, height: 0.045, tessellation: 10,
    pos: [0, H.hatY + 0.008, -0.008], mat: mats.vestTan, ...g,
  }));
  // Crown: a rounded faceted dome rising out of the brim.
  meshes.push(dome('boonieCrown', {
    size: [H.w * 1.30, 0.115, H.d * 1.22], cut: 0.5,
    pos: [0, H.hatY + 0.016, -0.008], mat: mats.vestTan, ...g,
  }));
  // Hat band around the base of the crown.
  meshes.push(cyl('boonieBand', {
    dia: H.w * 1.34, height: 0.035, tessellation: 10,
    pos: [0, H.hatY + 0.045, -0.008], mat: mats.vestTanDark, ...g,
  }));
  return meshes;
}

/** Red/white checkered shemagh: head wrap, lower-face wrap, neck drape. */
export function shemagh({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Head wrap: covers the skull from just above the brow to the crown,
  // bulkier than the bare head — wound cloth, not a skullcap.
  meshes.push(taperedBox('shemaghCrown', {
    bottom: [H.w * 1.30, H.d * 1.28], top: [H.w * 0.92, H.d * 0.86], height: H.crownY - H.hatY + 0.055,
    anchor: [0, -1, 0], pos: [0, H.hatY - 0.008, -0.014],
    shift: [0, -0.008], mat: mats.shemaghRed, ...g,
  }));
  // Pale band suggesting the checker weave.
  meshes.push(taperedBox('shemaghCheck', {
    bottom: [H.w * 1.32, H.d * 1.30], top: [H.w * 1.24, H.d * 1.18], height: 0.028,
    anchor: [0, -1, 0], pos: [0, H.hatY + 0.026, -0.014], mat: mats.shemaghWhite, ...g,
  }));
  // Lower-face wrap — swallows nose, mouth and any beard beneath it, leaving
  // the eye strip open. Front face sits 0.05 proud of the face plane.
  meshes.push(taperedBox('shemaghFace', {
    bottom: [H.w * 1.16, H.d * 0.94], top: [H.w * 1.24, H.d * 1.24], height: H.eyeY - 0.022,
    anchor: [0, -1, 0], pos: [0, 0.0, 0.012], mat: mats.shemaghRed, ...g,
  }));
  // Neck drape spilling from the jaw over the collar, wider as it falls.
  meshes.push(taperedBox('shemaghDrape', {
    bottom: [H.w * 1.42, H.d * 1.30], top: [H.w * 1.02, H.d * 0.92], height: 0.15,
    anchor: [0, 1, 0], pos: [0, 0.012, 0.008], mat: mats.shemaghRed, ...g,
  }));
  meshes.push(taperedBox('shemaghDrapeCheck', {
    bottom: [H.w * 1.46, H.d * 1.34], top: [H.w * 1.30, H.d * 1.18], height: 0.035,
    anchor: [0, 1, 0], pos: [0, -0.098, 0.008], mat: mats.shemaghWhite, ...g,
  }));
  // Loose tail down the back.
  meshes.push(taperedBox('shemaghTail', {
    bottom: [H.w * 0.42, 0.035], top: [H.w * 0.62, 0.045], height: 0.17,
    anchor: [0, 1, 0], pos: [0, H.hatY - 0.01, H.backZ - 0.02],
    shift: [0, 0.02], mat: mats.shemaghRed, ...g,
  }));
  return meshes;
}

/** Balaclava: full dark cover with an eye slit (worn over the skull). */
export function balaclava({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Head sock: chin to crown, slightly proud of the skull all round.
  meshes.push(taperedBox('balaclavaHead', {
    bottom: [H.w * 1.08, H.d * 1.10], top: [H.w * 0.94, H.d * 0.96], height: H.crownY + 0.02,
    anchor: [0, -1, 0], pos: [0, -0.005, (H.faceZ + H.backZ) / 2 + 0.006],
    shift: [0, -0.010], mat: mats.gear, ...g,
  }));
  // Face panel proud of the face plane (covers nose), with the eye strip open.
  meshes.push(box('balaclavaFace', {
    size: [H.w * 1.02, H.eyeY - 0.02, 0.045], anchor: [0, -1, -1],
    pos: [0, -0.005, H.faceZ - 0.012], mat: mats.gear, ...g,
  }));
  meshes.push(box('balaclavaForehead', {
    size: [H.w * 1.02, H.crownY - H.browY + 0.01, 0.038], anchor: [0, -1, -1],
    pos: [0, H.browY + 0.004, H.faceZ - 0.012], mat: mats.gear, ...g,
  }));
  // Ear covers — the sock hides the ears, no skin pokes through the mask.
  for (const s of [1, -1]) {
    meshes.push(box(`balaclavaEar${s > 0 ? 'L' : 'R'}`, {
      size: [0.026, 0.068, 0.056], anchor: [-s, 0, 0],
      pos: [s * (H.w / 2 - 0.005), H.eyeY, -0.012], mat: mats.gear, ...g,
    }));
  }
  return meshes;
}

/** Long dark hair: swept-back cap, back fall to the neck, side locks. */
export function hair({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Cap hugging the cranium above the brow, swept backward.
  meshes.push(taperedBox('hairCap', {
    bottom: [H.w * 1.14, H.d * 1.12], top: [H.w * 0.94, H.d * 0.92], height: H.crownY - H.hatY + 0.035,
    anchor: [0, -1, 0], pos: [0, H.hatY - 0.006, -0.022],
    shift: [0, -0.014], mat: mats.hair, ...g,
  }));
  // Back fall to the collar.
  meshes.push(taperedBox('hairBack', {
    bottom: [H.w * 0.92, 0.05], top: [H.w * 1.06, 0.075], height: 0.24,
    anchor: [0, 1, 0], pos: [0, H.crownY - 0.04, H.backZ - 0.012],
    shift: [0, 0.02], mat: mats.hair, ...g,
  }));
  // Side locks over the ears.
  for (const s of [1, -1]) {
    meshes.push(taperedBox(`hairSide${s > 0 ? 'L' : 'R'}`, {
      bottom: [0.024, H.d * 0.52], top: [0.034, H.d * 0.62], height: 0.13,
      anchor: [0, 1, 0], pos: [s * (H.w / 2 + 0.012), H.hatY + 0.03, -0.035],
      mat: mats.hair, ...g,
    }));
  }
  return meshes;
}

/** Bare-headed option so `headgear: 'none'` is not a special case downstream. */
export function none() {
  return [];
}

export const HEADGEAR = { combat, cap, boonie, shemagh, balaclava, hair, none };
