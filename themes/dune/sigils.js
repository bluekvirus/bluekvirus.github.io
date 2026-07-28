import * as THREE from 'three';
import { SIGILS } from './palette.js';

function drawGlyph(id, colorHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  g.strokeStyle = col; g.lineWidth = 9; g.lineCap = 'round';
  g.shadowColor = col; g.shadowBlur = 22;
  g.translate(128, 128);
  if (id === 'emperor') {        // stacked chevrons — the throne
    for (const y of [-30, 0, 30]) {
      g.beginPath(); g.moveTo(-60, y + 30); g.lineTo(0, y - 20); g.lineTo(60, y + 30); g.stroke();
    }
  } else if (id === 'guild') {   // circle + orbit — folded space
    g.beginPath(); g.arc(0, 0, 46, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(0, 0, 84, 26, -0.5, 0, Math.PI * 2); g.stroke();
  } else if (id === 'bene') {    // twin crescents — the sisterhood
    g.beginPath(); g.arc(10, 0, 60, Math.PI * 0.35, Math.PI * 1.65); g.stroke();
    g.beginPath(); g.arc(34, 0, 40, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
  } else {                       // fremen — dune waves
    g.beginPath(); g.moveTo(-70, 30); g.quadraticCurveTo(-20, -10, 30, 30);
    g.quadraticCurveTo(60, 50, 78, 36); g.stroke();
    g.beginPath(); g.moveTo(-40, -20); g.quadraticCurveTo(10, -70, 62, -34); g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export function createSigils() {
  const group = new THREE.Group();
  const meshes = [];
  const xs = [-280, -95, 95, 280];
  SIGILS.forEach((s, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({
        map: drawGlyph(s.id, s.color), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(xs[i], 170 + (i % 2) * 22, -700);
    mesh.userData = { url: s.url, label: s.label, baseY: mesh.position.y, hovered: false };
    group.add(mesh);
    meshes.push(mesh);
  });

  return {
    group, meshes,
    setHover(target) { for (const m of meshes) m.userData.hovered = m === target; },
    update(dt, elapsed, camera) {
      meshes.forEach((m, i) => {
        m.position.y = m.userData.baseY + 4 * Math.sin(elapsed * 0.5 + i * 1.3);
        m.quaternion.copy(camera.quaternion); // billboard
        const target = m.userData.hovered ? 1.2 : 1;
        m.scale.x += (target - m.scale.x) * 0.12;
        m.scale.y = m.scale.x;
        m.material.opacity += ((m.userData.hovered ? 1 : 0.85) - m.material.opacity) * 0.12;
      });
    },
  };
}
