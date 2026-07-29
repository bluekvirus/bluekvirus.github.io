import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';
import { SUN_DIR } from './layout.js';

const SIZE = 4000;
const SEGMENTS = 128; // 128x128x2 = ~33k triangles, within the 100k budget

export function createTerrain() {
  let geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, duneHeight(p.getX(i), p.getZ(i)));

  // Non-indexed + per-face colors = faceted low-poly look; real lighting shades it now,
  // so vertex color is a subtle warm/cool tint only (compressed range).
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const lit = new THREE.Color(COLORS.sandLit), shadow = new THREE.Color(COLORS.sandShadow);
  // Sun direction for the vertex-tint bake now derives from the single
  // SUN_DIR source in layout.js (fix round 1) instead of a hand-normalized
  // copy that had drifted out of sync with the real DirectionalLight in
  // main.js — see layout.js's SUN_DIR comment.
  const sun = new THREE.Vector3(...SUN_DIR).normalize();
  // Near the battle (the "flatten a corridor around the worksite" term in
  // noise.js, so the harvester/troops read clearly against the ground)
  // adjacent-face normals only differ by a few hundredths in their dot with
  // a near-overhead sun (measured: raw N.sun across the whole terrain sits
  // in ~0.61-0.94, most mass in 0.70-0.90 — a narrow band near the top of
  // [0,1]). A plain pow() on that narrow band (the pre-fix code used
  // pow(x,0.75), which further COMPRESSES contrast for x near 1) barely
  // moves the needle. Contrast-stretching the measured band to fill 0..1
  // before mapping to the tint span amplifies the real per-facet variance
  // that's actually there instead of leaving it squeezed into a sliver of
  // the output range.
  const shadeMin = 0.65, shadeMax = 0.92;
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const raw = n.dot(sun);
    const noiseShade = Math.min(1, Math.max(0, (raw - shadeMin) / (shadeMax - shadeMin)));
    // Faceting fix (fix round 1): the prior noon rebalance (0.55 + 0.25*n,
    // span 0.55-0.80) narrowed and lightened the baked range so much that,
    // combined with the raised 0.75 hemisphere light (see main.js), the
    // dunes read as a smooth flat plane instead of the faceted low-poly
    // look that's a core identity of this scene. Widened back beyond the
    // former dusk span (0.35 + 0.35*n) — the contrast-stretch above means
    // this span is now applied to real per-facet variance, not a compressed
    // sliver of it — while keeping a brighter floor than dusk so the scene
    // still reads as bright midday, not dusk-dark.
    const tint = 0.45 + 0.4 * noiseShade;
    c.copy(shadow).lerp(lit, tint);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
  }));
  mesh.receiveShadow = true;
  return mesh;
}
