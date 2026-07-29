// Torso rig catalogue. Parents to the `chest` socket. Pouches, magazines and
// straps are separate blocks standing PROUD of the vest slab — the layered-gear
// silhouette is most of the read at this scale.
//
// The torso under these is 0.375 wide and 0.235 deep at the chest; slabs run
// ~0.43 wide / ~0.31 deep so a worn vest reads as a layer, not a crate.

import { box, taperedBox } from './prim.js';

/** Shared slab helper: the wrap-around carrier body. */
function slab(name, { w = 0.43, h = 0.42, d = 0.31, y = -0.10, mat, scene, parent }) {
  return box(name, {
    size: [w, h, d], anchor: [0, 0, 0], pos: [0, y, 0.004],
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
      size: [0.34, 0.04, 0.024], anchor: [0, 0, -1],
      pos: [0, -0.21 + i * 0.10, 0.160], mat: mats.vestTanDark, ...g,
    }));
  }
  for (const s of [1, -1]) {
    meshes.push(box(`lcStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.085, 0.05, 0.28], anchor: [0, -1, 0],
      pos: [s * 0.12, 0.11, 0], mat: mats.vestTanDark, ...g,
    }));
  }
  return meshes;
}

/** Heavy plate carrier — dark navy, magazine pouches, ammunition, radio. */
export function plateCarrier({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(slab('pcBody', { d: 0.33, mat: mats.vestNavy, ...g }));
  // Magazine pouches across the lower front, brass tips showing.
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`pcPouch${i + 1}`, {
      size: [0.105, 0.14, 0.08], anchor: [0, 0, -1],
      pos: [i * 0.12, -0.185, 0.170], mat: mats.vestNavyDark, ...g,
    }));
    meshes.push(box(`pcBrass${i + 1}`, {
      size: [0.07, 0.04, 0.055], anchor: [0, 0, -1],
      pos: [i * 0.12, -0.10, 0.174], mat: mats.brass, ...g,
    }));
  }
  // Admin pouch high on the chest.
  meshes.push(box('pcAdmin', {
    size: [0.14, 0.085, 0.05], anchor: [0, 0, -1],
    pos: [0.045, -0.01, 0.170], mat: mats.vestNavyDark, ...g,
  }));
  // Radio on the left shoulder strap.
  meshes.push(box('pcRadio', {
    size: [0.06, 0.105, 0.055], anchor: [0, 0, -1],
    pos: [-0.135, -0.005, 0.160], mat: mats.gear, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`pcStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.085, 0.05, 0.29], anchor: [0, -1, 0],
      pos: [s * 0.12, 0.11, 0], mat: mats.vestNavyDark, ...g,
    }));
  }
  return meshes;
}

/** Tan chest rig — high pouch row with magazines, worn by the ranger. */
export function chestRig({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };
  meshes.push(box('crBase', {
    size: [0.38, 0.22, 0.30], anchor: [0, 0, 0], pos: [0, -0.07, 0.004],
    mat: mats.vestTan, ...g,
  }));
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`crPouch${i + 1}`, {
      size: [0.095, 0.13, 0.08], anchor: [0, 0, -1],
      pos: [i * 0.115, -0.085, 0.155], mat: mats.vestTanDark, ...g,
    }));
    meshes.push(box(`crMag${i + 1}`, {
      size: [0.065, 0.045, 0.05], anchor: [0, 0, -1],
      pos: [i * 0.115, 0.0, 0.158], mat: mats.metalDark, ...g,
    }));
  }
  // Grenade on the right edge.
  meshes.push(box('crGrenade', {
    size: [0.052, 0.08, 0.05], anchor: [0, 0, -1],
    pos: [0.175, -0.045, 0.148], mat: mats.olive, ...g,
  }));
  for (const s of [1, -1]) {
    meshes.push(box(`crStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.07, 0.045, 0.28], anchor: [0, -1, 0],
      pos: [s * 0.12, 0.045, 0], mat: mats.vestTanDark, ...g,
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
    size: [0.09, 0.58, 0.04], anchor: [0, 0, -1],
    pos: [0, -0.06, 0.168], mat: mats.gear, ...g,
  });
  strap.rotation.z = tilt;
  meshes.push(strap);
  // Brass rounds studded along the strap line.
  for (let i = -2; i <= 2; i++) {
    const t = i * 0.105;
    const round = box(`bandolierRound${i + 2}`, {
      size: [0.07, 0.06, 0.04], anchor: [0, 0, -1],
      pos: [-Math.sin(tilt) * t, -0.06 + Math.cos(tilt) * t, 0.192], mat: mats.brass, ...g,
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
  meshes.push(slab('fvBody', { w: 0.42, mat: mats.vestBrown, ...g }));
  for (let i = 0; i < 3; i++) {
    meshes.push(box(`fvRidge${i}`, {
      size: [0.32, 0.045, 0.024], anchor: [0, 0, -1],
      pos: [0, -0.21 + i * 0.10, 0.160], mat: mats.vestBrownDark, ...g,
    }));
  }
  for (const s of [1, -1]) {
    meshes.push(box(`fvStrap${s > 0 ? 'L' : 'R'}`, {
      size: [0.075, 0.05, 0.29], anchor: [0, -1, 0],
      pos: [s * 0.115, 0.11, 0], mat: mats.gear, ...g,
    }));
    // Buckles where the straps meet the plate.
    meshes.push(box(`fvBuckle${s > 0 ? 'L' : 'R'}`, {
      size: [0.05, 0.05, 0.024], anchor: [0, 0, -1],
      pos: [s * 0.115, 0.07, 0.160], mat: mats.metal, ...g,
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
      size: [0.075, 0.05, 0.31], anchor: [0, -1, 0],
      pos: [s * 0.11, 0.10, 0], mat: mats.gear, ...g,
    }));
    meshes.push(box(`hrFront${s > 0 ? 'L' : 'R'}`, {
      size: [0.075, 0.30, 0.032], anchor: [0, -1, -1],
      pos: [s * 0.11, -0.22, 0.118], mat: mats.gear, ...g,
    }));
  }
  // Dark waist plate carrying the pouches.
  meshes.push(box('hrPlate', {
    size: [0.38, 0.20, 0.28], anchor: [0, 0, 0], pos: [0, -0.25, 0.004],
    mat: mats.vestNavyDark, ...g,
  }));
  // Big tan pouches low on the belly.
  for (let i = -1; i <= 1; i++) {
    meshes.push(box(`hrPouch${i + 1}`, {
      size: [0.105, 0.16, 0.095], anchor: [0, 0, -1],
      pos: [i * 0.12, -0.25, 0.145], mat: mats.vestTan, ...g,
    }));
    meshes.push(box(`hrFlap${i + 1}`, {
      size: [0.11, 0.05, 0.10], anchor: [0, 0, -1],
      pos: [i * 0.12, -0.18, 0.143], mat: mats.vestTanDark, ...g,
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
      size: [0.075, 0.05, 0.31], anchor: [0, -1, 0],
      pos: [s * 0.11, 0.10, 0], mat: mats.gear, ...g,
    }));
  }
  // Chest band the charges hang from.
  meshes.push(box('wrBand', {
    size: [0.41, 0.22, 0.28], anchor: [0, 0, 0], pos: [0, -0.13, 0.004],
    mat: mats.vestNavy, ...g,
  }));
  // Four charge pouches across the front.
  for (let i = 0; i < 4; i++) {
    const x = -0.14 + i * 0.093;
    meshes.push(box(`wrCharge${i}`, {
      size: [0.08, 0.15, 0.07], anchor: [0, 0, -1],
      pos: [x, -0.13, 0.145], mat: mats.vestNavyDark, ...g,
    }));
  }
  // Short red det-cord loops atop each charge.
  for (let i = 0; i < 4; i++) {
    const x = -0.14 + i * 0.093;
    meshes.push(box(`wrWire${i}`, {
      size: [0.04, 0.03, 0.02], anchor: [0, -1, -1],
      pos: [x, -0.055, 0.152], mat: mats.wire, ...g,
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
