// The pack's characters. All share one skeleton and the same 24 clips, so the
// viewer can swap the model without touching animation state.
//
// `armed` marks who carries a firearm. Checked against every model in the pack:
// only SWAT and Suit ship a pistol mesh — the rest have no weapon geometry at
// all. Rather than hand the others a stand-in weapon, they simply don't list
// the gun clips; a character miming a pistol he isn't holding reads as a bug.
//
// Files are binary .glb rather than the pack's .gltf: the originals embed their
// buffer as base64, which costs ~45% more bytes for identical geometry.

export const CHARACTERS = [
  { id: 'Swat', label: 'SWAT', armed: true },
  { id: 'Suit', label: 'Suit', armed: true },
  { id: 'Punk', label: 'Punk' },
  { id: 'Adventurer', label: 'Adventurer' },
  { id: 'Worker', label: 'Worker' },
  { id: 'Farmer', label: 'Farmer' },
  { id: 'Hoodie', label: 'Hoodie' },
  { id: 'Casual', label: 'Casual' },
  { id: 'Beach', label: 'Beach' },
];

export const DEFAULT_CHARACTER = 'Swat';

export const byId = (id) => CHARACTERS.find((c) => c.id === id);
