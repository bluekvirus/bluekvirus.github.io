import * as THREE from 'three';
import { COLORS } from './palette.js';
import { LAYOUT } from './layout.js';
import { duneHeight } from './noise.js';

// Elliptical glitter beds: the dense worksite bed plus a couple of far patches.
const BEDS = [
  { x: LAYOUT.spiceBed.x, z: LAYOUT.spiceBed.z, rx: LAYOUT.spiceBed.rx, rz: LAYOUT.spiceBed.rz, dense: true },
  ...LAYOUT.farSpice.map((s) => ({ x: s.x, z: s.z, rx: s.rx, rz: s.rz, dense: false })),
];

export function createProps({ small = false } = {}) {
  const group = new THREE.Group();
  const pointsList = [];
  const denseCount = small ? 260 : 550;
  const farCount = small ? 120 : 250;
  const amber = new THREE.Color(COLORS.amber), cyan = new THREE.Color(COLORS.neonCyan);

  for (const bed of BEDS) {
    const count = bed.dense ? denseCount : farCount;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      const x = bed.x + Math.cos(a) * bed.rx * r, z = bed.z + Math.sin(a) * bed.rz * r;
      // Hug the ground (0.3–1.5 units up): spice is glitter ON the sand, not a
      // floating cloud — the old 2–7 unit band read as a volumetric fireball.
      pos.set([x, duneHeight(x, z) + 0.3 + Math.random() * 1.2, z], i * 3);
      const c = Math.random() < 0.8 ? amber : cyan;
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // The worksite bed is ~200 units from camera, so per-point screen size is
    // large; small size + low opacity keep the additive sum subtle.
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: bed.dense ? 1.1 : 2.2, vertexColors: true, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(pts);
    pointsList.push({ pts, count });
  }

  return {
    group,
    update(dt, elapsed) {
      pointsList.forEach(({ pts }, i) => { pts.material.opacity = 0.38 + 0.14 * Math.sin(elapsed * 2 + i); });
    },
    degrade() {
      for (const { pts, count } of pointsList) pts.geometry.setDrawRange(0, Math.floor(count / 2));
    },
  };
}
