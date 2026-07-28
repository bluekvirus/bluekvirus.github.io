// Pure, deterministic terrain height field. No dependencies (Node-testable).
function fract(x) { return x - Math.floor(x); }
function hash(ix, iz) { return fract(Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123); }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function duneHeight(x, z) {
  // long diagonal swells — the big dune ridges
  let h = 42 * Math.sin(x * 0.0021 + z * 0.0013)
        + 28 * Math.sin(x * 0.0011 - z * 0.0027 + 1.7);
  // mid and fine octaves
  h += 30 * valueNoise(x * 0.004, z * 0.004);
  h += 12 * valueNoise(x * 0.012, z * 0.012);
  h += 4 * valueNoise(x * 0.035, z * 0.035);
  // flatten a corridor around the worksite so the harvester/battle reads
  const d = Math.min(1, Math.hypot(x + 20, z + 270) / 900);
  return h * (0.35 + 0.65 * d);
}
