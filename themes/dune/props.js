import * as THREE from 'three';
import { COLORS } from './palette.js';
import { duneHeight } from './noise.js';

const CLUSTERS = [[-380, -420], [240, -520], [-60, -300], [460, -720]];

export function createProps({ small = false } = {}) {
  const group = new THREE.Group();
  const pointsList = [];
  const perCluster = small ? 180 : 400;
  const amber = new THREE.Color(COLORS.amber), cyan = new THREE.Color(COLORS.neonCyan);

  for (const [cx, cz] of CLUSTERS) {
    const pos = new Float32Array(perCluster * 3);
    const col = new Float32Array(perCluster * 3);
    for (let i = 0; i < perCluster; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 70;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pos.set([x, duneHeight(x, z) + 2 + Math.random() * 5, z], i * 3);
      const c = Math.random() < 0.8 ? amber : cyan;
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3.5, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(pts);
    pointsList.push(pts);
  }

  // Board-game resource tokens: spice / water / solari as drifting wireframes.
  const tokens = [
    new THREE.Mesh(new THREE.TetrahedronGeometry(9), new THREE.MeshBasicMaterial({ color: COLORS.amber, wireframe: true })),
    new THREE.Mesh(new THREE.OctahedronGeometry(8), new THREE.MeshBasicMaterial({ color: COLORS.fremenBlue, wireframe: true })),
    new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 2, 12), new THREE.MeshBasicMaterial({ color: COLORS.emperorGold, wireframe: true })),
  ];
  tokens.forEach((t, i) => {
    t.position.set(-140 + i * 140, 120, -420);
    group.add(t);
  });

  return {
    group,
    update(dt, elapsed) {
      pointsList.forEach((p, i) => { p.material.opacity = 0.65 + 0.3 * Math.sin(elapsed * 2 + i); });
      tokens.forEach((t, i) => {
        t.rotation.y += dt * 0.4;
        t.rotation.x += dt * 0.15;
        t.position.y = 120 + 8 * Math.sin(elapsed * 0.7 + i * 2);
      });
    },
    degrade() {
      for (const p of pointsList) p.geometry.setDrawRange(0, Math.floor(perCluster / 2));
    },
  };
}
