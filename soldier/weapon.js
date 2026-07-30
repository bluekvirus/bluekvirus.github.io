// Weapon visibility.
//
// The glTF pistol is skinned to `Middle1.R`, so the rig welds it into the right
// hand for every clip — without this the figure would punch, roll, wave and die
// while still gripping it. Gun clips show it; everything else hides it.
//
// (An earlier version holstered the pistol on the thigh instead. It worked, but
// the placement fought this rig's mirrored bone bases for far longer than the
// detail was worth. Hiding it is what the scene actually needs.)

export const GUN_CLIPS = new Set([
  'Idle_Gun',
  'Idle_Gun_Pointing',
  'Idle_Gun_Shoot',
  'Gun_Shoot',
  'Run_Shoot',
  'Reload',
]);

/**
 * @param {object} loaded - the ImportMeshAsync result
 * @returns {{ setDrawn(boolean): void, drawn: boolean, meshes: BABYLON.AbstractMesh[] }}
 */
export function createWeapon(loaded, loaned = []) {
  // Either the character's own pistol, or a clone lent to it by `sidearm.js`.
  // Only the loaned ones are ours to dispose; the native meshes belong to the
  // figure's import and are torn down with it.
  const held = [...loaded.meshes.filter((m) => m.name.startsWith('Pistol')), ...loaned];

  const api = {
    drawn: true,
    setDrawn(drawn) {
      if (api.drawn === drawn) return;
      api.drawn = drawn;
      for (const m of held) m.setEnabled(drawn);
    },
    meshes: held,
    dispose() {
      for (const m of loaned) m.dispose(false, false);
    },
  };

  api.setDrawn(false); // start empty-handed; the caller picks a clip next
  return api;
}
