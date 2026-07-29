// Torso rig catalogue. Parents to the `chest` socket. Pouches, magazines and
// straps are separate blocks standing PROUD of the vest slab — the layered-gear
// silhouette is most of the read at this scale.

import { box, taperedBox } from './prim.js';

/** Shared slab helper: the wrap-around carrier body. */
function slab(name, { w = 0.52, h = 0.44, d = 0.40, y = -0.08, mat, scene, parent }) {
  return box(name, {
    size: [w, h, d], anchor: [0, 0, 0], pos: [0, y, 0.005],
    mat, scene, parent,
  });
}

/** Plain light carrier — the tan vest on the base grunt. No pouches. */
export function lightCarrier({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(slab('lcBody', { mat: mats.vestTan, ...g }));
  // Horizontal MOLLE ridges across the front plate.
  for (let i = 0; i < 3; i++) {
    meshes.push(box(`lcRidge${i}`, {
      size: [0.42, 0.045, 0.03], anchor: [0, 0, -1],
      pos: [0, -0.20 + i * 0.11, 0.205], mat: mats.vestTanDark, ...g,
    }));
  }
  for (const s of [1, -1]) {
    meshes.push(box(`lcStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.10, 0.055, 0.34], anchor: [0, -1, 0],
      pos: [s * 0.15, 0.14, 0], mat: mats.vestTanDark, ...g,
    }));
  }
  return meshes;
}

/** Heavy plate carrier — dark navy, magazine pouches, ammunition, radio. */
export function plateCarrier({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(slab('pcBody', { d: 0.42, mat: mats.vestNavy, ...g }));
  // Magazine pouches across the lower front, brass tips showing.
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`pcPouch${i + 1}`, {
      size: [0.13, 0.17, 0.10], anchor: [0, 0, -1],
      pos: [i * 0.15, -0.17, 0.215], mat: mats.vestNavyDark, ...g,
    }));
    meshes.push(box(`pcBrass${i + 1}`, {
      size: [0.09, 0.05, 0.07], anchor: [0, 0, -1],
      pos: [i * 0.15, -0.065, 0.22], mat: mats.brass, ...g,
    }));
  }
  // Admin pouch high on the chest.
  meshes.push(box('pcAdmin', {
    size: [0.17, 0.10, 0.06], anchor: [0, 0, -1],
    pos: [0.055, 0.03, 0.215], mat: mats.vestNavyDark, ...g,
  }));
  // Radio on the left shoulder strap.
  meshes.push(box('pcRadio', {
    size: [0.075, 0.13, 0.07], anchor: [0, 0, -1],
    pos: [-0.165, 0.035, 0.20], mat: mats.gear, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`pcStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.10, 0.055, 0.36], anchor: [0, -1, 0],
      pos: [s * 0.15, 0.14, 0], mat: mats.vestNavyDark, ...g,
    }));
  }
  return meshes;
}

/** Tan chest rig — high pouch row with magazines, worn by the ranger. */
export function chestRig({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('crBase', {
    size: [0.46, 0.26, 0.38], anchor: [0, 0, 0], pos: [0, -0.06, 0.005],
    mat: mats.vestTan, ...g,
  }));
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`crPouch${i + 1}`, {
      size: [0.12, 0.16, 0.10], anchor: [0, 0, -1],
      pos: [i * 0.14, -0.08, 0.195], mat: mats.vestTanDark, ...g,
    }));
    meshes.push(box(`crMag${i + 1}`, {
      size: [0.08, 0.055, 0.06], anchor: [0, 0, -1],
      pos: [i * 0.14, 0.025, 0.20], mat: mats.metalDark, ...g,
    }));
  }
  // Grenade on the right edge.
  meshes.push(box('crGrenade', {
    size: [0.065, 0.10, 0.06], anchor: [0, 0, -1],
    pos: [0.215, -0.02, 0.185], mat: mats.olive, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`crStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.085, 0.05, 0.34], anchor: [0, -1, 0],
      pos: [s * 0.15, 0.075, 0], mat: mats.vestTanDark, ...g,
    }));
  }
  return meshes;
}

/** Ammunition bandolier slung from the right shoulder to the left hip. */
export function bandolier({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  const tilt = 0.62; // radians off vertical
  const strap = box('bandolierStrap', {
    size: [0.11, 0.68, 0.05], anchor: [0, 0, -1],
    pos: [0, -0.05, 0.215], mat: mats.gear, ...g,
  });
  strap.rotation.z = tilt;
  meshes.push(strap);
  // Brass rounds studded along the strap line.
  for (let i = -2; i <= 2; i++) {
    const t = i * 0.125;
    const round = box(`bandolierRound${i + 2}`, {
      size: [0.085, 0.075, 0.05], anchor: [0, 0, -1],
      pos: [-Math.sin(tilt) * t, -0.05 + Math.cos(tilt) * t, 0.245], mat: mats.brass, ...g,
    });
    round.rotation.z = tilt;
    meshes.push(round);
  }
  return meshes;
}

/** Grey-brown fighter vest — plain carrier with strap hardware. */
export function fighterVest({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(slab('fvBody', { w: 0.50, mat: mats.vestBrown, ...g }));
  for (let i = 0; i < 3; i++) {
    meshes.push(box(`fvRidge${i}`, {
      size: [0.40, 0.05, 0.03], anchor: [0, 0, -1],
      pos: [0, -0.20 + i * 0.11, 0.205], mat: mats.vestBrownDark, ...g,
    }));
  }
  for (const s of [1, -1]) {
    meshes.push(box(`fvStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.09, 0.055, 0.36], anchor: [0, -1, 0],
      pos: [s * 0.145, 0.14, 0], mat: mats.gear, ...g,
    }));
    // Buckles where the straps meet the plate.
    meshes.push(box(`fvBuckle${s > 0 ? 'L' : 'R'}`, {
      size: [0.06, 0.06, 0.03], anchor: [0, 0, -1],
      pos: [s * 0.145, 0.10, 0.205], mat: mats.metal, ...g,
    }));
  }
  return meshes;
}

/** Dark harness with a low row of big tan pouches — the shemagh fighter's rig. */
export function harnessRig({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  // Cross straps over the shoulders.
  for (const s of [1, -1]) {
    meshes.push(box(`hrStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.09, 0.055, 0.40], anchor: [0, -1, 0],
      pos: [s * 0.14, 0.13, 0], mat: mats.gear, ...g,
    }));
    meshes.push(box(`hrFront${s > 0 ? 'L' : 'R'}`, {
      size: [0.09, 0.34, 0.04], anchor: [0, -1, -1],
      pos: [s * 0.14, -0.21, 0.155], mat: mats.gear, ...g,
    }));
  }
  // Dark waist plate carrying the pouches.
  meshes.push(box('hrPlate', {
    size: [0.46, 0.24, 0.36], anchor: [0, 0, 0], pos: [0, -0.26, 0.005],
    mat: mats.vestNavyDark, ...g,
  }));
  // Big tan pouches low on the belly.
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`hrPouch${i + 1}`, {
      size: [0.13, 0.20, 0.12], anchor: [0, 0, -1],
      pos: [i * 0.15, -0.26, 0.185], mat: mats.vestTan, ...g,
    }));
    meshes.push(box(`hrFlap${i + 1}`, {
      size: [0.135, 0.06, 0.13], anchor: [0, 0, -1],
      pos: [i * 0.15, -0.175, 0.183], mat: mats.vestTanDark, ...g,
    }));
  }
  return meshes;
}

/** Wired charge rig — dark pouches with det-cord, the militant's vest. */
export function wiredRig({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  for (const s of [1, -1]) {
    meshes.push(box(`wrStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.09, 0.055, 0.40], anchor: [0, -1, 0],
      pos: [s * 0.14, 0.13, 0], mat: mats.gear, ...g,
    }));
  }
  // Chest band the charges hang from.
  meshes.push(box('wrBand', {
    size: [0.50, 0.26, 0.36], anchor: [0, 0, 0], pos: [0, -0.14, 0.005],
    mat: mats.vestNavy, ...g,
  }));
  // Four charge pouches across the front.
  for (let i = 0; i < 4; i++) {
    const x = -0.175 + i * 0.115;
    meshes.push(box(`wrCharge${i}`, {
      size: [0.10, 0.18, 0.09], anchor: [0, 0, -1],
      pos: [x, -0.14, 0.185], mat: mats.vestNavyDark, ...g,
    }));
  }
  // Short red det-cord loops atop each charge.
  for (let i = 0; i < 4; i++) {
    const x = -0.175 + i * 0.115;
    meshes.push(box(`wrWire${i}`, {
      size: [0.05, 0.035, 0.025], anchor: [0, -1, -1],
      pos: [x, -0.05, 0.195], mat: mats.wire, ...g,
    }));
  }
  return meshes;
}

export function none() {
  return [];
}

export const TORSO = {
  lightCarrier, plateCarrier, chestRig, bandolier, fighterVest, harnessRig, wiredRig, none,
};
