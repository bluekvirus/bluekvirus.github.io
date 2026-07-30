// Cover prop meshes. Built from primitives in the same flat-shaded style as the
// soldier page's melee items, since the character pack ships no props at all.

function flat(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

const HEIGHT = { desk: 0.75, cabinet: 1.35, crate: 0.85, pillar: 2.6 };
const TINT = { desk: '#7d6242', cabinet: '#5a626b', crate: '#8a6a3f', pillar: '#6b7078' };

export function buildProps(scene, placements, shadows) {
  const created = [];
  const materials = [];
  const byKind = new Map();

  for (const p of placements) {
    const box = BABYLON.MeshBuilder.CreateBox(`prop_${p.kind}_${created.length}`,
      { width: p.w, depth: p.d, height: HEIGHT[p.kind] }, scene);
    box.position.set(p.x, HEIGHT[p.kind] / 2, p.z);
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(box);
  }

  // Merge per kind: props share a material within a kind, so one draw call each
  // rather than one per desk.
  for (const [kind, boxes] of byKind) {
    const merged = BABYLON.Mesh.MergeMeshes(boxes, true, true, undefined, false, false);
    merged.name = `props_${kind}`;
    const mat = flat(scene, `propMat_${kind}`, TINT[kind]);
    merged.material = mat;
    merged.receiveShadows = true;
    shadows?.addShadowCaster(merged);
    materials.push(mat);
    created.push(merged);
  }

  return {
    dispose() {
      for (const m of created) m.dispose(false, false);
      for (const m of materials) m.dispose();
    },
  };
}
