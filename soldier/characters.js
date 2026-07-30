// The pack's characters. All share one skeleton and the same 24 clips, so the
// viewer can swap the model without touching animation state.
//
// Files are binary .glb rather than the pack's .gltf: the originals embed their
// buffer as base64, which costs ~45% more bytes over the wire for identical
// geometry.

export const CHARACTERS = [
  { id: 'Swat', label: 'SWAT', armed: true },
  { id: 'Adventurer', label: 'Adventurer' },
  { id: 'Spacesuit', label: 'Spacesuit' },
  { id: 'Punk', label: 'Punk' },
  { id: 'Worker', label: 'Worker' },
  { id: 'Farmer', label: 'Farmer' },
  { id: 'Hoodie', label: 'Hoodie' },
  { id: 'Casual', label: 'Casual' },
  { id: 'Suit', label: 'Suit' },
  { id: 'Beach', label: 'Beach' },
  { id: 'King', label: 'King' },
];

export const DEFAULT_CHARACTER = 'Swat';

export const byId = (id) => CHARACTERS.find((c) => c.id === id);
