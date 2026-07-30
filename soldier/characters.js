// The pack's characters. All share one skeleton and the same 24 clips, so the
// viewer can swap the model without touching animation state.
//
// `armed` marks who carries a firearm. Only SWAT ships one in its mesh; the
// others get a procedural sidearm placed in the same hand. Characters without
// it don't list the gun clips at all — a farmer miming a pistol reads as a bug.
//
// Files are binary .glb rather than the pack's .gltf: the originals embed their
// buffer as base64, which costs ~45% more bytes for identical geometry.

export const CHARACTERS = [
  { id: 'Swat', label: 'SWAT', armed: true },
  { id: 'Punk', label: 'Punk', armed: true },
  { id: 'Suit', label: 'Suit', armed: true },
  { id: 'Adventurer', label: 'Adventurer' },
  { id: 'Worker', label: 'Worker' },
  { id: 'Farmer', label: 'Farmer' },
  { id: 'Hoodie', label: 'Hoodie' },
  { id: 'Casual', label: 'Casual' },
  { id: 'Beach', label: 'Beach' },
];

export const DEFAULT_CHARACTER = 'Swat';

export const byId = (id) => CHARACTERS.find((c) => c.id === id);
