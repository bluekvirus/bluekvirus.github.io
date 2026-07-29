// Weapon state: drawn (in the hand) versus holstered (on the right thigh).
//
// The glTF's pistol is skinned to `Middle1.R`, so it is welded into the right
// hand for every clip — the figure would otherwise punch, roll, wave and die
// while still gripping it. This module keeps the skinned pistol for gun clips
// and swaps in an unskinned copy riding the thigh for everything else.

const HOLSTER_BONE = 'UpperLeg.R';

// Clips during which the weapon belongs in the hand. Everything else holsters.
export const GUN_CLIPS = new Set([
  'Idle_Gun',
  'Idle_Gun_Pointing',
  'Idle_Gun_Shoot',
  'Gun_Shoot',
  'Run_Shoot',
  'Reload',
]);

// Offset from the thigh bone's origin (at the hip), in the figure's own space:
// outboard to the right, down the thigh, a touch forward. Authored in world
// units and applied directly — the bone's local basis is scaled and mirrored,
// so offsets expressed there are unreadable and error-prone.
const OFFSET = new BABYLON.Vector3(0.06, -0.18, 0.03);
const TILT_Z = Math.PI * 0.07; // slight cant against the leg

/**
 * @param {BABYLON.Scene} scene
 * @param {object} loaded - the ImportMeshAsync result
 * @returns {{ setDrawn(boolean): void, drawn: boolean, allMeshes: BABYLON.AbstractMesh[] }}
 */
export function createWeapon(scene, loaded) {
  const held = loaded.meshes.filter((m) => m.name.startsWith('Pistol'));
  const skeleton = loaded.skeletons[0];
  const bone = skeleton?.bones.find((b) => b.name === HOLSTER_BONE);
  const carrier = loaded.meshes.find((m) => m.skeleton === skeleton) ?? held[0];

  const holstered = [];
  let rig = null;

  if (bone && carrier && held.length) {
    rig = new BABYLON.TransformNode('holster', scene);
    rig.rotation.z = TILT_Z;

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

    // Follow the thigh bone each frame. Scratch vectors are module-free and
    // reused, so this allocates nothing per frame.
    const bonePos = new BABYLON.Vector3();
    const worldOffset = new BABYLON.Vector3();
    const rot = new BABYLON.Quaternion();

    scene.onBeforeRenderObservable.add(() => {
      if (!rig.isEnabled() || !holstered.length || !holstered[0].isEnabled()) return;
      bone.getAbsolutePositionToRef(carrier, bonePos);
      // Rotate the offset by the figure's own orientation so the holster stays
      // on his right when he turns (matters once figures move on a map).
      const m = carrier.getWorldMatrix();
      m.decompose(undefined, rot, undefined);
      worldOffset.copyFrom(OFFSET);
      worldOffset.rotateByQuaternionToRef(rot, worldOffset);
      rig.position.copyFrom(bonePos).addInPlace(worldOffset);
      rig.rotationQuaternion = null;
      rig.rotation.set(0, 0, TILT_Z);
    });
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
