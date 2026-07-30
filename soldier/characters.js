// The pack's characters. All share one skeleton and the same 24 clips, so the
// viewer can swap the model without touching animation state.
//
// Every character can carry a firearm. Only SWAT and Suit ship pistol geometry;
// the rest borrow a clone of it (see `sidearm.js`), which works because the whole
// pack shares one skeleton, so the pistol's skin weights mean the same thing on
// any of them.
//
// Files are binary .glb rather than the pack's .gltf: the originals embed their
// buffer as base64, which costs ~45% more bytes for identical geometry.

export const CHARACTERS = [
  { id: 'Swat', label: 'SWAT', armed: true },
  { id: 'Suit', label: 'Suit', armed: true },
  { id: 'Punk', label: 'Punk', armed: true },
  { id: 'Adventurer', label: 'Adventurer', armed: true },
  { id: 'Worker', label: 'Worker', armed: true },
  { id: 'Farmer', label: 'Farmer', armed: true },
  { id: 'Hoodie', label: 'Hoodie', armed: true },
  { id: 'Casual', label: 'Casual', armed: true },
  { id: 'Beach', label: 'Beach', armed: true },
];

export const DEFAULT_CHARACTER = 'Swat';

export const byId = (id) => CHARACTERS.find((c) => c.id === id);
