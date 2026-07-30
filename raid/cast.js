// Loading and placing the twelve figures.
//
// The whole Quaternius pack shares one skeleton — 62 bones, identical names in
// identical order — so a model imported once can be cloned onto fresh skeletons
// for every other figure of that type. Importing twelve GLBs separately would
// download the same few megabytes over and over.

const ASSET_DIR = '../assets/quaternius/';

const MODEL = {
  swat: 'Swat.glb',
  hostile: 'Punk.glb',
  hostage: 'Casual.glb',
};

/** Import one model and keep it as a hidden template to clone from. */
async function loadTemplate(scene, file) {
  const loaded = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, file, scene);

  // Stop the clips the loader auto-starts, and keep only Idle. Twelve figures
  // each carrying 25 animation groups is 300 groups the scene does not need.
  for (const g of loaded.animationGroups) g.stop();

  const root = loaded.meshes.find((m) => m.name === '__root__') ?? loaded.meshes[0];
  root.setEnabled(false);
  return { loaded, root };
}

function place(template, spawn, name, scene) {
  const clone = template.root.clone(name, null);
  clone.setEnabled(true);
  clone.position.set(spawn.x, 0, spawn.z);
  clone.rotation = new BABYLON.Vector3(0, spawn.facing ?? 0, 0);
  return clone;
}

export async function populate(scene, mission, shadows) {
  const templates = {};
  for (const [role, file] of Object.entries(MODEL)) {
    templates[role] = await loadTemplate(scene, file);
  }

  const figures = [];
  const add = (role, spawn, i) => {
    const root = place(templates[role], spawn, `${role}_${i}`, scene);
    for (const m of root.getChildMeshes()) {
      if (m.getTotalVertices() > 0) {
        m.receiveShadows = true;
        shadows?.addShadowCaster(m);
      }
    }
    figures.push({ root, role });
  };

  mission.spawns.swat.forEach((s, i) => add('swat', s, i));
  mission.spawns.hostiles.forEach((s, i) => add('hostile', s, i));
  add('hostage', mission.spawns.hostage, 0);

  return {
    figures,
    dispose() {
      for (const f of figures) f.root.dispose(false, true);
      for (const t of Object.values(templates)) {
        for (const g of t.loaded.animationGroups) g.dispose();
        for (const m of t.loaded.meshes) m.dispose(false, true);
        for (const s of t.loaded.skeletons) s.dispose();
      }
    },
  };
}
