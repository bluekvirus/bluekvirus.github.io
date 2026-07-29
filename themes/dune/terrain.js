import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';

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
  // Near-overhead noon sun (matches the DirectionalLight direction in
  // main.js, elevation ~70°) — kept here only to bias the baked vertex tint
  // toward the same facets the real light will hit.
  const sun = new THREE.Vector3(-0.274, 0.944, -0.183).normalize();
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const noiseShade = Math.pow(Math.max(0, n.dot(sun)), 0.75);
    // Noon rebalance: narrower, lighter-based baked range than dusk — real
    // directional + hemisphere light now supplies most of the contrast, so
    // the bake only needs to nudge facets rather than carve deep shadow.
    const tint = 0.55 + 0.25 * noiseShade;
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
