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
// Four rig quirks (measured in the browser while building this, not
// documented anywhere) make "just rotate some bones" insufficient on its own:
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
// 3. UpperLeg.L/R's LOCAL axes are tilted relative to the body (their bind
//    rotationQuaternion is far from identity). Rotating the thigh about its
//    own local X only, given that tilt, swings the knee out sideways instead
//    of forward, and on the right leg backwards as well as sideways: the
//    hostage read as doing the side splits, not sitting (measured:
//    footSeparation 1.56m, hipToKnee.R.forward negative). No local-axis angle
//    fixes this — the tilt is baked into the bind pose and any pure local-X
//    rotation inherits it.
// 4. The obvious fix for #3 — hinge about the figure's WORLD-space lateral
//    axis instead of the bone's local axis — runs into a second problem: the
//    figure's clone root has `scaling.z === -1` (a mirror baked in, almost
//    certainly this pack's glTF-to-Babylon handedness conversion). Any
//    technique that recovers a rotation by DECOMPOSING a matrix built through
//    that mirrored root (`Bone.rotate(..., Space.WORLD, mesh)`, and even
//    `Bone.getRotationQuaternion(Space.WORLD, mesh)`, whose
//    `_scalingDeterminant` correction is keyed to the BONE's own scale, not
//    the MESH's) comes back with unpredictable sign flips — measured
//    directly: the same hinge angle, sign, and axis produced a correct pose
//    at one spawn facing and a backwards one at another. Positions, by
//    contrast, are never ambiguous: `Bone.getAbsolutePosition(mesh)` reflects
//    exactly what is rendered, mirror included, because the renderer needs
//    that same position to draw the mesh in the right place. So the pose
//    below never decomposes a rotation out of a mirrored matrix — it hinges a
//    plain WORLD-space vector (bindpose thigh/shin direction) with a plain
//    rotation matrix, then solves each bone's LOCAL rotation by aiming it at
//    the resulting target position (`aimBoneAt`), which only ever needs
//    positions and the already-reliable position-space `worldToBoneLocal`.
//    Verified facing-independent by construction, and re-confirmed by testing
//    three unrelated spawn facings (0.22, 2.14, -1.7 rad) side by side.

const DEG = Math.PI / 180;

// Local-space rotations for bones whose local axis happens to point where
// you'd expect when perturbed — arms, torso, and the foot's own small tilt.
// The legs are NOT here; see rig quirks 3–4 above.
const POSE = {
  'Foot.L': [8, 0, 0],
  'Foot.R': [8, 0, 0],
  'UpperArm.L': [12, 0, -22],
  'UpperArm.R': [12, 0, 22],
  'LowerArm.L': [-38, 0, 0],
  'LowerArm.R': [-38, 0, 0],
  'Torso': [6, 0, 0],
};

// Thigh and shin hinge angles, about the figure's world-space lateral axis
// (perpendicular to its facing direction), applied as plain vector rotations
// — see rig quirk 4 above for why. Tuned by measuring the posed figure
// against fix round 1's acceptance criteria (both thighs going forward not
// sideways, both shins dropping into the sagittal plane, feet within a
// hand's width of each other, hips landing on the seat, feet on the floor).
// -90 puts the thigh fully horizontal, matching a natural seated silhouette;
// 105 folds the shin back down far enough that the re-attached foot lands
// near the floor rather than well above or below it.
const THIGH_HINGE_DEG = -90;
const SHIN_HINGE_DEG = 105;

// How far the whole pelvis drops to bring the hips down to a plausible seat
// height. Applied to Body, not Hips: UpperLeg.L/R are parented to Body as a
// SIBLING of Hips, not a descendant of it, so translating Hips would lower
// the spine while leaving the legs attached at standing height. Body is the
// shared ancestor of both, so moving it drags hips, spine and legs down
// together while the (separately re-attached) feet stay near the floor.
const BODY_DROP = 0.20;

/** The TransformNode a bone's world transform is actually read from — see
 * rig quirk 1 above. Rotating the bone itself does not survive the next
 * prepare(). */
function boneNode(bone) {
  return bone.getTransformNode() ?? bone;
}

/** `absolutePos` (in `mesh` space) expressed in `bone`'s local, parent-relative
 * space — the space its position property is defined in. Bone.getAbsolutePosition
 * inverted, in other words; Bone.getLocalPositionFromAbsolute does NOT do this
 * (it expresses the point in the bone's OWN rotated frame, which is a different
 * thing, and was confirmed empirically to give the wrong answer here). This is
 * matrix-based, not a rotation decomposition, so — unlike the quaternion route
 * described in rig quirk 4 — the root's mirror scale cannot corrupt it. */
function worldToBoneLocal(absolutePos, bone, mesh) {
  const parent = bone.getParent();
  const parentAbsolute = parent ? parent.getAbsoluteMatrix().clone() : BABYLON.Matrix.Identity();
  const parentInMesh = parentAbsolute.multiply(mesh.getWorldMatrix());
  return BABYLON.Vector3.TransformCoordinates(absolutePos, BABYLON.Matrix.Invert(parentInMesh));
}

/** Rotate `bone` about its own position (never translating it) so that the
 * fixed reference direction `v1` — expressed in `bone`'s PARENT's local,
 * un-rotated-by-`bone` frame, exactly the frame `bone.position` itself lives
 * in — ends up pointing at `targetAbsPos` instead. For a bone with a real
 * child, `v1` is simply that child's `.position`; for a leaf bone (no bone
 * child — see rig quirk 2), `v1` is whatever fixed bind-pose direction the
 * caller wants to steer (here, the shin's reach toward the ankle). Solved via
 * a shortest-arc quaternion between two plain vectors — no matrix
 * decomposition anywhere, so rig quirk 4 cannot apply. */
function aimBoneAt(bone, v1, targetAbsPos, mesh) {
  const targetInParentFrame = worldToBoneLocal(targetAbsPos, bone, mesh);
  const v2 = targetInParentFrame.subtract(bone.position);
  const from = v1.clone().normalize();
  const to = v2.normalize();
  const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(from, to)));
  const angle = Math.acos(dot);
  let axis = BABYLON.Vector3.Cross(from, to);
  if (axis.length() < 1e-6) axis = new BABYLON.Vector3(1, 0, 0); // bind already points at target
  else axis.normalize();
  boneNode(bone).rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
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

  // Force a fresh world matrix before reading any bind-pose position below.
  // A just-cloned TransformNode's world matrix is not guaranteed current
  // until the next render pass computes it — reading positions through a
  // stale one silently corrupts every measurement that follows, and this was
  // mistaken for a facing-dependent rig quirk before being tracked down.
  root.computeWorldMatrix(true);
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  const facing = root.rotation.y;
  const lateralAxis = new BABYLON.Vector3(Math.cos(facing), 0, -Math.sin(facing));

  // Capture, purely from bind-pose POSITIONS (never a decomposed rotation —
  // see rig quirk 4), each leg's thigh and shin reach vectors, plus where the
  // foot sits relative to the shin.
  const legs = ['L', 'R'].map((side) => {
    const upperLeg = byName(`UpperLeg.${side}`);
    const lowerLeg = byName(`LowerLeg.${side}`);
    const foot = byName(`Foot.${side}`);
    if (!upperLeg || !lowerLeg || !foot) return null;
    const bindThighVec = lowerLeg.getAbsolutePosition(root).subtract(upperLeg.getAbsolutePosition(root));
    const bindShinVec = foot.getAbsolutePosition(root).subtract(lowerLeg.getAbsolutePosition(root));
    // The shin has no bone child (rig quirk 2), so aimBoneAt's reference
    // direction is built by hand: the bind foot position, expressed in the
    // shin's PARENT frame — the same frame lowerLeg.position lives in.
    const shinAimFrom = worldToBoneLocal(foot.getAbsolutePosition(root), lowerLeg, root)
      .subtract(lowerLeg.position);
    return { upperLeg, lowerLeg, foot, bindThighVec, bindShinVec, shinAimFrom };
  }).filter(Boolean);

  const body = byName('Body');
  if (body) boneNode(body).position.y -= BODY_DROP;
  root.computeWorldMatrix(true);
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  // Thigh: aim UpperLeg so its real child (LowerLeg) lands where the bind
  // thigh vector ends up after a plain rotation about the lateral axis.
  const thighTurn = BABYLON.Matrix.RotationAxis(lateralAxis, THIGH_HINGE_DEG * DEG);
  for (const leg of legs) {
    const newVec = BABYLON.Vector3.TransformNormal(leg.bindThighVec, thighTurn);
    const target = leg.upperLeg.getAbsolutePosition(root).add(newVec);
    aimBoneAt(leg.upperLeg, leg.lowerLeg.position, target, root);
  }
  root.computeWorldMatrix(true);
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  // Shin: rotations about a common fixed axis commute, so the shin's total
  // world-space turn from bind is exactly (thigh + shin) about that same
  // lateral axis — not an approximation. Foot is dragged straight to the
  // same target position (no rotation solve needed for it).
  const totalTurn = BABYLON.Matrix.RotationAxis(lateralAxis, (THIGH_HINGE_DEG + SHIN_HINGE_DEG) * DEG);
  for (const leg of legs) {
    const newVec = BABYLON.Vector3.TransformNormal(leg.bindShinVec, totalTurn);
    const target = leg.lowerLeg.getAbsolutePosition(root).add(newVec);
    aimBoneAt(leg.lowerLeg, leg.shinAimFrom, target, root);
    boneNode(leg.foot).position.copyFrom(worldToBoneLocal(target, leg.foot, root));
  }

  // Arms, torso, and the foot's own small tilt: local-space rotations are
  // fine here — see rig quirk 3, which is specific to the legs.
  for (const [name, [x, y, z]] of Object.entries(POSE)) {
    const bone = byName(name);
    if (!bone) continue;
    const node = boneNode(bone);
    const turn = BABYLON.Quaternion.FromEulerAngles(x * DEG, y * DEG, z * DEG);
    const current = node.rotationQuaternion
      ?? BABYLON.Quaternion.FromEulerVector(node.rotation ?? BABYLON.Vector3.Zero());
    node.rotationQuaternion = current.multiply(turn);
  }

  // `force = true`: without it, both calls are no-ops once this skeleton has
  // already been prepared for the current render — Skeleton.prepare() caches
  // by render id, and computeAbsoluteMatrices() has its own dirty flag. Both
  // would otherwise silently skip the recompute needed to read back correct
  // positions below.
  root.computeWorldMatrix(true);
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
