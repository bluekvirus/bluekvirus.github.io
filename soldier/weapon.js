// Weapon state: drawn (in the hand) versus holstered (on the right thigh).
//
// The glTF's pistol is skinned to `Middle1.R`, so it is welded into the right
// hand for every clip — the figure would otherwise punch, roll, wave and die
// while still gripping it. This module keeps the skinned pistol for gun clips
// and swaps in an unskinned copy riding the thigh for everything else.
//
// The holster rig is attached with `attachToBone`, so it tracks the skeleton
// through every clip — walk swing, rolls, deaths — with no per-frame JS. The
// importer leaves the bone bases scaled and mirrored, so the rig-local numbers
// below were solved numerically against the rig rather than reasoned out;
// hand-authored offsets in this space land the pistol in the chest or above
// the head, which is exactly what earlier attempts did.

const HOLSTER_BONE = 'UpperLeg.R';
const DEG = Math.PI / 180;

// Clips during which the weapon belongs in the hand. Everything else holsters.
export const GUN_CLIPS = new Set([
  'Idle_Gun',
  'Idle_Gun_Pointing',
  'Idle_Gun_Shoot',
  'Gun_Shoot',
  'Run_Shoot',
  'Reload',
]);

// Pistol flat against the outer right thigh, muzzle down, slight forward cant.
const HOLSTER = { pos: [-0.0257, 0.0802, -0.0929], rot: [3.5, -174.3, 80.4] };

function rigOnBone(scene, name, skeleton, boneName, carrier, t) {
  const bone = skeleton.bones.find((b) => b.name === boneName);
  if (!bone) return null;
  const rig = new BABYLON.TransformNode(name, scene);
  rig.attachToBone(bone, carrier);
  rig.position.fromArray(t.pos);
  rig.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
    t.rot[0] * DEG,
    t.rot[1] * DEG,
    t.rot[2] * DEG,
  );
  return rig;
}

/**
 * @param {BABYLON.Scene} scene
 * @param {object} loaded - the ImportMeshAsync result
 * @returns {{ setDrawn(boolean): void, drawn: boolean, allMeshes: BABYLON.AbstractMesh[] }}
 */
export function createWeapon(scene, loaded) {
  const skeleton = loaded.skeletons[0];
  const held = loaded.meshes.filter((m) => m.name.startsWith('Pistol'));
  const carrier = loaded.meshes.find((m) => m.skeleton === skeleton) ?? held[0];

  const holstered = [];
  const rig = skeleton && carrier
    ? rigOnBone(scene, 'holster', skeleton, HOLSTER_BONE, carrier, HOLSTER)
    : null;

  if (rig) {
    for (const src of held) {
      const copy = src.clone(`${src.name}_holstered`, rig);
      if (!copy) continue;
      copy.skeleton = null; // positioned by the rig node, not by the skeleton
      copy.parent = rig;
      copy.rotationQuaternion = null;
      copy.rotation.setAll(0);
      copy.scaling.setAll(1);
      copy.isPickable = false;
      // The source vertices live in bind-pose space (out at the hand), so an
      // unskinned clone carries that translation baked in. Shift each copy so
      // its own centre sits on the rig node's origin.
      copy.position.setAll(0);
      copy.computeWorldMatrix(true);
      copy.refreshBoundingInfo();
      const c = copy.getBoundingInfo().boundingBox.center;
      copy.position.set(-c.x, -c.y, -c.z);
      holstered.push(copy);
    }
  }

  const api = {
    drawn: true,
    setDrawn(drawn) {
      if (api.drawn === drawn) return;
      api.drawn = drawn;
      for (const m of held) m.setEnabled(drawn);
      for (const m of holstered) m.setEnabled(!drawn);
    },
    /** Meshes a shadow generator should track, whichever state is active. */
    allMeshes: [...held, ...holstered],
  };

  api.setDrawn(false); // start holstered; the caller picks a clip next
  return api;
}
