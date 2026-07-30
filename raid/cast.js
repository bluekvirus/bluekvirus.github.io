// Loading and placing the twelve figures.
//
// The whole Quaternius pack shares one skeleton — 62 bones, identical names in
// identical order — so a model imported once can be cloned onto fresh skeletons
// for every other figure of that type. Importing twelve GLBs separately would
// download the same few megabytes over and over.
//
// NOTE: "fresh skeletons" above is aspirational, not what Babylon actually
// does. TransformNode.clone() does not clone the Skeleton of a skinned child
// mesh — every clone of a template keeps pointing at that template's single
// shared Skeleton instance. Verified empirically: cloning a loaded root twice
// leaves scene.skeletons.length unchanged, and both clones' skinned meshes
// resolve to the exact same skeleton object as the original import (and as
// each other). So all 4 SWAT share one Skeleton, all 7 hostiles share
// another, and the 1 hostage has its own — 3 Skeleton instances for 12
// figures, not 12. Posing one figure's skeleton (a later task's job) will
// move every sibling of that role unless that task clones the skeleton
// per-figure first.

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

function place(template, spawn, name) {
  const clone = template.root.clone(name, null);
  clone.setEnabled(true);
  clone.position.set(spawn.x, 0, spawn.z);
  clone.rotation = new BABYLON.Vector3(0, spawn.facing ?? 0, 0);

  // Read the skeleton off the clone's own meshes rather than assuming it
  // matches the template's — see the note above on why that assumption
  // happens to hold today, but this stays correct even if a future model's
  // import shape (or Babylon's clone behaviour) changes.
  const skinned = clone.getChildMeshes().find((m) => m.skeleton);
  return { clone, skeleton: skinned?.skeleton ?? null };
}

export async function populate(scene, mission, shadows) {
  const templates = {};
  try {
    for (const [role, file] of Object.entries(MODEL)) {
      templates[role] = await loadTemplate(scene, file);
    }
  } catch (err) {
    // A later import failing must not strand the earlier ones in the scene
    // with no handle to reach them by — they are disabled, so they would be
    // invisible as well as unreleasable.
    for (const t of Object.values(templates)) {
      for (const g of t.loaded.animationGroups) g.dispose();
      for (const m of t.loaded.meshes) m.dispose(false, true);
      for (const s of t.loaded.skeletons) s.dispose();
    }
    throw err;
  }

  const figures = [];
  const add = (role, spawn, i) => {
    const { clone: root, skeleton } = place(templates[role], spawn, `${role}_${i}`);
    for (const m of root.getChildMeshes()) {
      if (m.getTotalVertices() > 0) {
        m.receiveShadows = true;
        shadows?.addShadowCaster(m);
      }
    }
    figures.push({ root, skeleton, role });
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
