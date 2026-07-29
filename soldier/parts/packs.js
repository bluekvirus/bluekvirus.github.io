// Back-mounted gear catalogue. Parents to the `back` socket (-Z is outward).

import { box, taperedBox } from './prim.js';

/** Compact assault pack. */
export function assault({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('packBody', {
    size: [0.36, 0.42, 0.20], anchor: [0, 0, 1], pos: [0, -0.04, -0.04],
    mat: mats.vestTan, ...g,
  }));
  meshes.push(box('packLid', {
    size: [0.34, 0.12, 0.18], anchor: [0, 0, 1], pos: [0, 0.14, -0.05],
    mat: mats.vestTanDark, ...g,
  }));
  meshes.push(box('packPocket', {
    size: [0.24, 0.16, 0.06], anchor: [0, 0, 1], pos: [0, -0.10, -0.24],
    mat: mats.vestTanDark, ...g,
  }));
  // Rolled mat lashed across the bottom.
  meshes.push(box('packRoll', {
    size: [0.40, 0.11, 0.12], anchor: [0, 0, 1], pos: [0, -0.26, -0.06],
    mat: mats.gear, ...g,
  }));
  return meshes;
}

/** Bedroll lashed across the lower back. */
export function bedroll({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('bedroll', {
    size: [0.48, 0.15, 0.15], anchor: [0, 0, 1], pos: [0, -0.20, -0.04],
    mat: mats.vestBrown, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`bedrollStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.05, 0.17, 0.17], anchor: [0, 0, 1], pos: [s * 0.14, -0.20, -0.03],
      mat: mats.gear, ...g,
    }));
  }
  return meshes;
}

/** RPG launcher slung diagonally with two dart rockets over the shoulder. */
export function rpg({ scene, mats, socket }) {
  const meshes = [];
  // A holder node gives the whole sling one tilt without per-mesh math.
  const sling = new BABYLON.TransformNode('rpgSling', scene);
  sling.parent = socket;
  // Lean back (away from the head) and cant across the spine. Babylon is
  // left-handed: negative x-rotation tips +Y toward -Z.
  sling.position.set(0.05, 0.24, -0.13);
  sling.rotation.set(-0.14, 0, -0.38);
  const g = { scene, parent: sling };

  // Carry board strapped to the back.
  meshes.push(box('rpgBoard', {
    size: [0.26, 0.34, 0.06], anchor: [0, 0, 1], pos: [0.05, -0.06, 0.02],
    mat: mats.gear, ...g,
  }));

  // Two dart rockets, staggered so both warheads clear the head.
  for (const [i, x] of [-0.02, 0.15].entries()) {
    const yo = i * -0.12;
    meshes.push(box(`rocketShaft${i}`, {
      size: [0.06, 0.70, 0.06], anchor: [0, 0, 0], pos: [x, yo, 0],
      mat: mats.olive, ...g,
    }));
    meshes.push(taperedBox(`rocketHead${i}`, {
      bottom: [0.15, 0.15], top: [0.02, 0.02], height: 0.32,
      anchor: [0, -1, 0], pos: [x, 0.35 + yo, 0], mat: mats.metalDark, ...g,
    }));
    meshes.push(box(`rocketCollar${i}`, {
      size: [0.09, 0.07, 0.09], anchor: [0, 0, 0], pos: [x, 0.32 + yo, 0],
      mat: mats.metalDark, ...g,
    }));
    meshes.push(box(`rocketFinA${i}`, {
      size: [0.19, 0.11, 0.02], anchor: [0, 0, 0], pos: [x, -0.31 + yo, 0],
      mat: mats.metalDark, ...g,
    }));
    meshes.push(box(`rocketFinB${i}`, {
      size: [0.02, 0.11, 0.19], anchor: [0, 0, 0], pos: [x, -0.31 + yo, 0],
      mat: mats.metalDark, ...g,
    }));
  }
  return meshes;
}

export function none() {
  return [];
}

export const BACK = { assault, bedroll, rpg, none };
