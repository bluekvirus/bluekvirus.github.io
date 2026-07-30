// The seated hostage.
//
// The pack ships 25 clips and none of them is seated, and it contains no props
// at all — so both the pose and the chair are built here.
//
// The pose is authored first and the chair is then sized to it. Sizing the chair
// independently and trying to make the figure meet it is the same trap as
// seating a weapon in a fist: it creates a fixed contact point that has to be
// hit exactly. Measuring the posed figure instead leaves the geometry free to
// move to wherever the pose actually ended up.
//
// Two rig quirks (measured in the browser while building this, not documented
// anywhere) make "just rotate some bones" insufficient on its own:
//
// 1. Every bone on this rig is linked to a companion TransformNode, and
//    Skeleton.prepare() re-syncs each bone FROM its linked node every time it
//    runs. Rotating a bone directly (as a first pass at this file did) holds
//    for exactly one frame: the next prepare() overwrites it from the node,
//    which never moved. The node itself is the thing to rotate.
// 2. Foot.L / Foot.R are parented to Root, not to LowerLeg. Bending the knee
//    therefore does nothing to them — they stay planted at the standing foot
//    position while the shin swings up and away, stretching the calf mesh
//    into a ski shape. They are re-attached to the shin by hand below. (PT.L
//    / PT.R look like toe bones from the name but sit ~0.6m from the foot in
//    the bind pose — an IK pole target, not a mesh joint — so they are left
//    alone.)

const DEG = Math.PI / 180;

// Rotations applied to the base (standing) pose, in each bone's own space.
// UpperLeg/LowerLeg were tuned by measuring the posed figure in the browser,
// not copied from a first guess: the brief's starting angles (-88 / 82) swing
// the thigh fully horizontal, which asks the shin to reach further than its
// own length to get back to the fixed floor-level foot — see task-11-report.md.
// -62 / 5 keeps the reach within the shin's length so the re-attached foot
// lands close to where the shin actually ends, instead of merely close to the
// floor.
const POSE = {
  'UpperLeg.L': [-62, 0, 0],
  'UpperLeg.R': [-62, 0, 0],
  'LowerLeg.L': [5, 0, 0],
  'LowerLeg.R': [5, 0, 0],
  'Foot.L': [8, 0, 0],
  'Foot.R': [8, 0, 0],
  'UpperArm.L': [12, 0, -22],
  'UpperArm.R': [12, 0, 22],
  'LowerArm.L': [-38, 0, 0],
  'LowerArm.R': [-38, 0, 0],
  'Torso': [6, 0, 0],
};

// How far the whole pelvis drops to bring the hips down to a plausible seat
// height. Applied to Body, not Hips: UpperLeg.L/R are parented to Body as a
// SIBLING of Hips, not a descendant of it, so translating Hips would lower
// the spine while leaving the legs attached at standing height. Body is the
// shared ancestor of both, so moving it drags hips, spine and legs down
// together while the (separately re-attached) feet stay near the floor.
const BODY_DROP = 0.38;

/** The TransformNode a bone's world transform is actually read from — see
 * note 1 above. Rotating the bone itself does not survive the next prepare(). */
function boneNode(bone) {
  return bone.getTransformNode() ?? bone;
}

/** `absolutePos` (in `mesh` space) expressed in `bone`'s local, parent-relative
 * space — the space its position property is defined in. Bone.getAbsolutePosition
 * inverted, in other words; Bone.getLocalPositionFromAbsolute does NOT do this
 * (it expresses the point in the bone's OWN rotated frame, which is a different
 * thing, and was confirmed empirically to give the wrong answer here). */
function worldToBoneLocal(absolutePos, bone, mesh) {
  const parent = bone.getParent();
  const parentAbsolute = parent ? parent.getAbsoluteMatrix().clone() : BABYLON.Matrix.Identity();
  const parentInMesh = parentAbsolute.multiply(mesh.getWorldMatrix());
  return BABYLON.Vector3.TransformCoordinates(absolutePos, BABYLON.Matrix.Invert(parentInMesh));
}

export function seatFigure(root, skeleton) {
  // Measured in Task 10: cloning a root does NOT clone the skeleton, so the
  // twelve figures share only three instances — one per model. Posing a SWAT
  // would move all four of them.
  //
  // This is safe ONLY because the hostage is the sole user of Casual.glb and so
  // owns its skeleton outright. Give any other role that model and this function
  // will pose them too. If that ever changes, clone the skeleton for the hostage
  // before posing rather than dropping this pose.
  const byName = (name) => skeleton.bones.find((b) => b.name === name);

  // Capture, in the bind pose, where each foot sits relative to its shin —
  // rotated into the shin's OWN local frame so the offset can be re-applied
  // after the shin rotates (see rig quirk 2 above).
  const legs = ['L', 'R'].map((side) => {
    const lowerLeg = byName(`LowerLeg.${side}`);
    const foot = byName(`Foot.${side}`);
    if (!lowerLeg || !foot) return null;
    const lowerLegPos = lowerLeg.getAbsolutePosition(root).clone();
    const lowerLegRot = lowerLeg.getRotationQuaternion(BABYLON.Space.WORLD, root).clone();
    const footOffset = foot.getAbsolutePosition(root).subtract(lowerLegPos);
    footOffset.rotateByQuaternionToRef(BABYLON.Quaternion.Inverse(lowerLegRot), footOffset);
    return { lowerLeg, foot, footOffset };
  }).filter(Boolean);

  const body = byName('Body');
  if (body) boneNode(body).position.y -= BODY_DROP;

  for (const [name, [x, y, z]] of Object.entries(POSE)) {
    const bone = byName(name);
    if (!bone) continue;
    const node = boneNode(bone);
    const turn = BABYLON.Quaternion.FromEulerAngles(x * DEG, y * DEG, z * DEG);
    const current = node.rotationQuaternion
      ?? BABYLON.Quaternion.FromEulerVector(node.rotation ?? BABYLON.Vector3.Zero());
    node.rotationQuaternion = current.multiply(turn);
  }

  // `force = true` on both calls: without it, each is a no-op once this
  // skeleton has already been prepared for the current render — Skeleton
  // .prepare() caches by render id, and computeAbsoluteMatrices() has its own
  // dirty flag. Both would otherwise silently skip the recompute needed to
  // read back correct positions below.
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  // Drag each foot back to its shin, which has since rotated out from under it.
  for (const leg of legs) {
    const newLowerLegPos = leg.lowerLeg.getAbsolutePosition(root);
    const newLowerLegRot = leg.lowerLeg.getRotationQuaternion(BABYLON.Space.WORLD, root);
    const offset = leg.footOffset.clone();
    offset.rotateByQuaternionToRef(newLowerLegRot, offset);
    const footTarget = newLowerLegPos.add(offset);
    boneNode(leg.foot).position.copyFrom(worldToBoneLocal(footTarget, leg.foot, root));
  }
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  // Measure where the pose actually put things, and size the chair from that.
  const hips = byName('Hips');
  const hipY = hips ? hips.getAbsolutePosition(root).y : 0.48;
  const footY = legs.length
    ? Math.min(...legs.map((leg) => leg.foot.getAbsolutePosition(root).y))
    : 0.1;

  // Seat depth from how far forward the (bent) thigh actually reaches, not a
  // number picked independently of the pose.
  const upperLeg = byName('UpperLeg.L');
  const lowerLeg = byName('LowerLeg.L');
  let reach = 0.4;
  if (upperLeg && lowerLeg) {
    const u = upperLeg.getAbsolutePosition(root);
    const l = lowerLeg.getAbsolutePosition(root);
    reach = Math.hypot(u.x - l.x, u.z - l.z);
  }

  return {
    hipY,
    footY,
    seatHeight: Math.max(0.30, hipY - 0.06),
    seatDepth: Math.min(0.52, Math.max(0.38, reach + 0.10)),
  };
}

export function buildChair(scene, metrics, spawn) {
  const created = [];
  const mat = new BABYLON.StandardMaterial('chairMat', scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString('#6a5238');
  mat.specularColor = new BABYLON.Color3(0, 0, 0);

  // Built at the origin, in the chair's own local frame, and only moved to
  // `spawn` at the very end. MergeMeshes bakes each source box's absolute
  // position into its vertices, so a chair built directly at `spawn` and then
  // given `merged.rotation.y = facing` would swing around world (0,0,0)
  // instead of around itself — for any room away from the map's origin, a
  // multi-metre displacement. Measured while building this file: a chair at
  // spawn (-13.6, -10.3) with facing 0.22 rad landed at (-15.5, -7.2).
  // Rotating in local space first and translating after avoids that.
  const seat = BABYLON.MeshBuilder.CreateBox('chairSeat',
    { width: 0.46, depth: metrics.seatDepth, height: 0.06 }, scene);
  seat.position.set(0, metrics.seatHeight, 0);
  created.push(seat);

  const back = BABYLON.MeshBuilder.CreateBox('chairBack',
    { width: 0.46, depth: 0.06, height: 0.52 }, scene);
  back.position.set(0, metrics.seatHeight + 0.29, -metrics.seatDepth / 2 + 0.03);
  created.push(back);

  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) {
    const leg = BABYLON.MeshBuilder.CreateBox('chairLeg',
      { width: 0.05, depth: 0.05, height: metrics.seatHeight }, scene);
    leg.position.set(dx, metrics.seatHeight / 2, dz);
    created.push(leg);
  }

  const merged = BABYLON.Mesh.MergeMeshes(created, true, true, undefined, false, false);
  merged.name = 'chair';
  merged.material = mat;
  merged.rotation.y = spawn.facing ?? 0;
  merged.position.set(spawn.x, 0, spawn.z);

  return { dispose() { merged.dispose(false, false); mat.dispose(); } };
}
