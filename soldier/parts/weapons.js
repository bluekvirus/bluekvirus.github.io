// Hand-held weapons. A weapon is authored around its GRIP ORIGIN: the origin
// sits where the firing hand wraps the pistol grip, so parenting it to a hand
// socket needs no per-weapon offset. Each weapon also reports a `foregrip`
// point (where the support hand goes) and a `muzzle` point (for flashes later).

import { box, taperedBox } from './prim.js';

/** Standard carbine. Returns { meshes, foregrip, muzzle } in weapon-local space. */
export function carbine({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };

  // Receiver — the spine of the weapon, running forward (+Z) from the grip.
  meshes.push(box('wpnReceiver', {
    size: [0.055, 0.10, 0.42], anchor: [0, 0, 0], pos: [0, 0.10, 0.05],
    mat: mats.metal, ...g,
  }));
  // Pistol grip — hangs below the origin, angled back.
  meshes.push(box('wpnGrip', {
    size: [0.05, 0.14, 0.07], anchor: [0, 1, 0], pos: [0, 0.06, -0.03],
    mat: mats.metalDark, ...g,
  }));
  // Magazine — forward of the grip, canted.
  meshes.push(box('wpnMag', {
    size: [0.045, 0.17, 0.075], anchor: [0, 1, 0], pos: [0, 0.06, 0.10],
    mat: mats.metalDark, ...g,
  }));
  // Handguard.
  meshes.push(box('wpnHandguard', {
    size: [0.06, 0.075, 0.26], anchor: [0, 0, 0], pos: [0, 0.10, 0.36],
    mat: mats.metalDark, ...g,
  }));
  // Barrel.
  meshes.push(box('wpnBarrel', {
    size: [0.028, 0.028, 0.16], anchor: [0, 0, 0], pos: [0, 0.10, 0.56],
    mat: mats.metalDark, ...g,
  }));
  // Stock — behind the grip.
  meshes.push(box('wpnStock', {
    size: [0.05, 0.115, 0.24], anchor: [0, 0, 1], pos: [0, 0.105, -0.06],
    mat: mats.metal, ...g,
  }));
  // Optic on top.
  meshes.push(box('wpnOptic', {
    size: [0.04, 0.055, 0.11], anchor: [0, -1, 0], pos: [0, 0.15, 0.16],
    mat: mats.metalDark, ...g,
  }));

  return {
    meshes,
    // Where the support hand grips, in weapon-local space.
    foregrip: new BABYLON.Vector3(0, 0.06, 0.34),
    // Where a muzzle flash spawns (stage 4).
    muzzle: new BABYLON.Vector3(0, 0.10, 0.64),
  };
}

/** RPG launcher, held. Same grip-origin convention as the carbine. */
export function rpg({ scene, mats, socket }) {
  const meshes = [];
  const g = { scene, parent: socket };

  // Launch tube along +Z, shouldered behind the grip.
  meshes.push(box('rpgTube', {
    size: [0.085, 0.085, 0.85], anchor: [0, 0, 0], pos: [0, 0.12, 0.08],
    mat: mats.gear, ...g,
  }));
  // Rear blast flare.
  const flare = taperedBox('rpgFlareHeld', {
    bottom: [0.15, 0.15], top: [0.09, 0.09], height: 0.14,
    anchor: [0, 1, 0], pos: [0, 0.12, -0.34], mat: mats.metalDark, ...g,
  });
  flare.rotation.x = -Math.PI / 2;
  meshes.push(flare);
  // Warhead cone on the muzzle.
  const head = taperedBox('rpgWarhead', {
    bottom: [0.15, 0.15], top: [0.02, 0.02], height: 0.30,
    anchor: [0, -1, 0], pos: [0, 0.12, 0.51], mat: mats.metalDark, ...g,
  });
  head.rotation.x = Math.PI / 2;
  meshes.push(head);
  // Pistol grip below the origin, wood foregrip further out.
  meshes.push(box('rpgGrip', {
    size: [0.05, 0.14, 0.07], anchor: [0, 1, 0], pos: [0, 0.07, -0.02],
    mat: mats.wood, ...g,
  }));
  meshes.push(box('rpgForegrip', {
    size: [0.05, 0.13, 0.07], anchor: [0, 1, 0], pos: [0, 0.07, 0.18],
    mat: mats.wood, ...g,
  }));

  return {
    meshes,
    foregrip: new BABYLON.Vector3(0, 0.07, 0.18),
    muzzle: new BABYLON.Vector3(0, 0.12, 0.66),
  };
}

export const WEAPONS = { carbine, rpg };
