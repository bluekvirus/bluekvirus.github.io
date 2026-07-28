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

  // Non-indexed + per-face colors = faceted low-poly shading, unlit (never blooms).
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const lit = new THREE.Color(COLORS.sandLit), shadow = new THREE.Color(COLORS.sandShadow);
  const sun = new THREE.Vector3(-0.55, 0.5, 0.35).normalize();
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const shade = Math.pow(Math.max(0, n.dot(sun)), 0.75);
    c.copy(shadow).lerp(lit, shade);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}
