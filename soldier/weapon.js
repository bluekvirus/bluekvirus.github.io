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

// Clips during which the weapon belongs in the hand. Everything else holsters.
export const GUN_CLIPS = new Set([
  'Idle_Gun',
  'Idle_Gun_Pointing',
  'Idle_Gun_Shoot',
  'Gun_Shoot',
  'Run_Shoot',
  'Reload',
]);

// Where the holstered pistol should end up, expressed in WORLD terms relative
// to the thigh bone (which sits at the hip): outboard past the leg surface,
// down the thigh, slightly rearward. World units are readable; the bone-local
// numbers that produce them are not, so they are derived below rather than
// written here.
const HOLSTER_OFFSET = new BABYLON.Vector3(0.114, -0.205, -0.053);

// The weapon's own axes, measured from its geometry: X is the barrel (0.252
// long), Y is the flat of the slide (0.065 thick), Z runs grip-to-slide
// (0.179). A holstered sidearm points the barrel down and lays the flat
// against the leg, which is exactly the basis built in orientHolster().
const BARREL_WORLD = new BABYLON.Vector3(0, -0.965, -0.262); // down, slight rearward cant
const FLAT_WORLD = new BABYLON.Vector3(1, 0, 0); // outboard, so the slide lies on the thigh

function rigOnBone(scene, name, skeleton, boneName, carrier) {
  const bone = skeleton.bones.find((b) => b.name === boneName);
  if (!bone) return null;
  const rig = new BABYLON.TransformNode(name, scene);
  rig.attachToBone(bone, carrier);
  rig.rotationQuaternion = BABYLON.Quaternion.Identity();
  return rig;
}

/**
 * Point the weapon correctly, then slide it onto the thigh.
 *
 * Both steps are computed at setup rather than hardcoded. The glTF importer
 * leaves the bone bases scaled and mirrored, so values authored by hand in
 * that space are meaningless — successive guesses put this pistol at knee
 * height, in the chest, above the head, and half-sunk into the leg. Deriving
 * from the bone's actual transform is the only reliable route.
 */
function seatOnThigh(rig, bone, carrier, meshes) {
  // 0. Cancel the mirror. This bone chain arrives with determinant −1 (scaling
  //    y = −1). That matters for more than tidiness: `decompose()` cannot
  //    return a valid rotation from a mirrored matrix, and no pure rotation can
  //    map a mirrored frame onto an unmirrored basis at all — so the flip must
  //    be undone before any orientation maths is meaningful. Cancelling it also
  //    renders the pistol the right way round rather than as its mirror image.
  rig.rotationQuaternion = BABYLON.Quaternion.Identity();
  rig.scaling.setAll(1);
  rig.computeWorldMatrix(true);
  if (rig.getWorldMatrix().determinant() < 0) {
    rig.scaling.set(1, -1, 1);
    rig.computeWorldMatrix(true);
  }

  // 1. Orientation. With identity local rotation the rig carries whatever the
  //    bone imposes; measure that, then cancel it out of the wanted basis.
  const boneRot = new BABYLON.Quaternion();
  rig.getWorldMatrix().decompose(undefined, boneRot, undefined);

  const x = BARREL_WORLD.clone().normalize();
  const z = BABYLON.Vector3.Cross(x, FLAT_WORLD).normalize();
  const y = BABYLON.Vector3.Cross(z, x).normalize();
  const basis = new BABYLON.Matrix();
  BABYLON.Matrix.FromXYZAxesToRef(x, y, z, basis);
  const want = new BABYLON.Quaternion();
  basis.decompose(undefined, want, undefined);
  rig.rotationQuaternion = BABYLON.Quaternion.Inverse(boneRot).multiply(want);
  rig.computeWorldMatrix(true);

  // 2. Position. Convert the wanted world displacement into rig-local space by
  //    undoing the bone's rotation and scale.
  const centre = () => {
    let mn = null;
    let mx = null;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo();
      const b = m.getBoundingInfo().boundingBox;
      mn = mn ? BABYLON.Vector3.Minimize(mn, b.minimumWorld) : b.minimumWorld.clone();
      mx = mx ? BABYLON.Vector3.Maximize(mx, b.maximumWorld) : b.maximumWorld.clone();
    }
    return mn.add(mx).scale(0.5);
  };

  // 2. Position. Rather than trust `decompose()` to convert a world offset into
  //    this bone's local space — it does not, on a chain the importer has
  //    scaled and mirrored — measure the local→world map directly: nudge each
  //    local axis, see where the weapon actually goes, and solve the resulting
  //    3×3 for the displacement we want. One pass lands within a millimetre.
  const target = bone.getAbsolutePosition(carrier).add(HOLSTER_OFFSET);
  const base = rig.position.clone();
  const p0 = centre();

  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // columns: response to +eps on x/y/z
  const eps = 0.01;
  const axes = ['x', 'y', 'z'];
  for (let a = 0; a < 3; a++) {
    rig.position.copyFrom(base);
    rig.position[axes[a]] += eps;
    rig.computeWorldMatrix(true);
    const p = centre();
    J[0][a] = (p.x - p0.x) / eps;
    J[1][a] = (p.y - p0.y) / eps;
    J[2][a] = (p.z - p0.z) / eps;
  }
  rig.position.copyFrom(base);

  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(J);
  if (Math.abs(D) > 1e-9) {
    const rhs = [target.x - p0.x, target.y - p0.y, target.z - p0.z];
    const swap = (col) => J.map((row, i) => row.map((v, j) => (j === col ? rhs[i] : v)));
    rig.position.set(
      base.x + det3(swap(0)) / D,
      base.y + det3(swap(1)) / D,
      base.z + det3(swap(2)) / D,
    );
  }
  rig.computeWorldMatrix(true);
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

  const bone = skeleton?.bones.find((b) => b.name === HOLSTER_BONE);
  const holstered = [];
  const rig = skeleton && carrier
    ? rigOnBone(scene, 'holster', skeleton, HOLSTER_BONE, carrier)
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
    if (bone && holstered.length) seatOnThigh(rig, bone, carrier, holstered);
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
