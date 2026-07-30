// Seeded randomness. Every generated map must be reproducible from its seed, so
// generation never touches Math.random — a map you cannot regenerate is a map
// you cannot report a bug against.

/** FNV-1a over the seed string, so any text works as a seed. */
export function hashSeed(seed) {
  let h = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for layout jitter. */
export function makeRng(seed) {
  let state = hashSeed(seed);

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (minIncl, maxExcl) => minIncl + Math.floor(next() * (maxExcl - minIncl)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
