// Lends the pack's pistol to the characters that don't ship one.
//
// Only SWAT and Suit contain pistol geometry, which left the other seven unable
// to use any of the gun clips. But all eleven characters are rigged to the SAME
// skeleton — 62 bones, identical names in identical order, verified across the
// pack — and skin weights index bones by position. So the pistol's weights mean
// the same thing on every character, and a clone bound to another figure's
// skeleton deforms exactly as it does on its owner. No placement to get wrong:
// the mesh is skinned to the hand, so it follows whatever the clip does.

const SOURCE = 'Swat.glb';

let templates = null;

/**
 * Import the pistol once and keep it as a hidden template to clone from.
 * Everything else that arrives with it is discarded.
 */
export async function loadSidearm(scene, dir) {
  if (templates) return templates;

  const loaded = await BABYLON.SceneLoader.ImportMeshAsync('', dir, SOURCE, scene);

  // The file is a whole character. Its clips have to go or the scene ends up
  // holding two of every animation, and the picker lists each one twice.
  for (const g of loaded.animationGroups) g.dispose();

  const keep = loaded.meshes.filter(
    (m) => m.name.startsWith('Pistol') && m.getTotalVertices() > 0,
  );
  for (const m of keep) {
    m.setEnabled(false);
    m.parent = null;
    m.skeleton = null; // detached before its own skeleton goes
  }
  for (const m of loaded.meshes) if (!keep.includes(m)) m.dispose(false, true);
  for (const s of loaded.skeletons) s.dispose();

  templates = keep;
  return templates;
}

/**
 * Clone the template onto a figure, bound to that figure's skeleton.
 * @returns {BABYLON.AbstractMesh[]} the clones, for the caller to dispose with
 *   the figure — they are not part of its import and won't be torn down with it.
 */
export function cloneSidearm(loaded, root) {
  if (!templates?.length) return [];
  const skeleton = loaded.skeletons[0];
  if (!skeleton) return [];

  // Hang the clone where the pistol hangs on the characters that own one: a
  // sibling of the body under `CharacterArmature`. Every node along that chain
  // is identity, but the `__root__` above it carries the importer's handedness
  // flip — parenting to the figure root instead skips it, and the gun lands off
  // the hand entirely.
  const carrier = loaded.meshes.find(
    (m) => m.skeleton === skeleton && m.getTotalVertices() > 0,
  );
  const anchor = carrier?.parent?.parent ?? root;

  return templates.map((t, i) => {
    const c = t.clone(`PistolLoan${i}`, null);
    c.skeleton = skeleton;
    c.parent = anchor;
    c.position.setAll(0);
    c.scaling.setAll(1);
    c.rotationQuaternion = null;
    c.rotation.setAll(0);
    c.setEnabled(true);
    return c;
  });
}
