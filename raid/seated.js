// Laying the hostage on the floor.
//
// This used to hand-author a seated pose (rotating hip/knee bones toward a
// built-to-fit chair). Three rounds of tuning that never converged: the rig's
// left and right leg bones are mirrored, so identical hinge angles put the two
// feet at different world heights, and no local- or world-space rotation
// fix made the silhouette read as sitting rather than perched-and-sprawled.
// Hand-authoring bone angles on this rig is a trap; the pack's own animators
// already solved "how do these bones bend without breaking" for every pose
// they shipped.
//
// The pack ships no seated/kneeling/crouching clip (checked all 24, sampled
// 13 frames each — zero matches on "hips low, head high, feet low"). But
// `Death`'s final frame is a clean animator-made pose: flat on the back, no
// stretching, every bone length intact. Driving the hostage's own copy of
// that clip to its last frame and freezing it there is a body on the floor
// for free, with correct anatomy guaranteed by construction.
//
// The hostage is the sole user of its skeleton (Casual.glb, unlike Swat.glb
// and Punk.glb which are shared by four and seven figures respectively), so
// nothing else moves when this runs.

/** The TransformNode each targeted bone's animation actually drives. Glancing
 * at `scene.animationGroups` alone doesn't tell you which of the 72 groups
 * (24 clips x 3 models) belong to THIS figure — all three models imported
 * their own copy of every clip. Matching by the actual target identity is
 * the only way that can't accidentally reach into a shared skeleton. */
function ownedGroups(figure, scene) {
  const nodes = new Set(figure.skeleton.bones.map((b) => b.getTransformNode?.()).filter(Boolean));
  return scene.animationGroups.filter((g) => g.targetedAnimations.some((ta) => nodes.has(ta.target)));
}

/** Drive `group` to its last frame and read back the pose it leaves on each
 * target node — position, rotation and scale, not the bone. Every bone on
 * this rig is linked to a companion TransformNode, and Skeleton.prepare()
 * re-syncs each bone FROM that node every time it runs, so it's the node's
 * values that need to be captured and later restored, not the bone's. */
function finalPose(group) {
  group.start(false, 1.0, group.from, group.to, false);
  group.goToFrame(group.to);
  const targets = new Set(group.targetedAnimations.map((ta) => ta.target));
  const pose = new Map();
  for (const node of targets) {
    pose.set(node, {
      position: node.position.clone(),
      rotationQuaternion: node.rotationQuaternion ? node.rotationQuaternion.clone() : null,
      scaling: node.scaling.clone(),
    });
  }
  group.stop();
  return pose;
}

export function layHostageOnFloor(figure, scene) {
  const { root, skeleton } = figure;

  const death = ownedGroups(figure, scene).find((g) => g.name === 'Death');
  if (!death) throw new Error('layHostageOnFloor: no Death animation group owned by this figure');

  // Capture each targeted node's pose BEFORE the floor pose overwrites it —
  // this is the bind/idle pose straight off the import, since nothing else
  // has touched this skeleton yet (the hostage is excluded from clip
  // playback for as long as it stays on the floor — see agents.js). Held
  // onto so standUp() below can put it back the moment the hostage is
  // rescued and hand the rig to the normal clip path, instead of leaving it
  // stuck in the floor pose while a clip tries to animate it.
  const restPose = new Map();
  for (const node of new Set(death.targetedAnimations.map((ta) => ta.target))) {
    restPose.set(node, {
      position: node.position.clone(),
      rotationQuaternion: node.rotationQuaternion ? node.rotationQuaternion.clone() : null,
      scaling: node.scaling.clone(),
    });
  }

  // Capture the last frame's pose, then stop the group and write the
  // captured values straight back onto the nodes. A merely-paused group is
  // not enough: anything downstream that later calls
  // `scene.animationGroups.forEach(g => g.stop())` (or restarts a group) must
  // not be able to unstick this pose, and writing the values back onto the
  // nodes themselves — the same nodes Skeleton.prepare() re-syncs bones FROM
  // — is what makes that true.
  const pose = finalPose(death);
  for (const [node, { position, rotationQuaternion, scaling }] of pose) {
    node.position.copyFrom(position);
    if (rotationQuaternion) node.rotationQuaternion = rotationQuaternion;
    node.scaling.copyFrom(scaling);
  }
  root.computeWorldMatrix(true);
  skeleton.prepare(true);
  skeleton.computeAbsoluteMatrices(true);

  // `Death` has root motion baked in: the pose above ends up well away from
  // where the figure was placed, off its spawn marker. Cancel it by
  // measuring how far the hips actually landed from the figure's own origin
  // and shifting the root by the negative of that — not a hardcoded offset,
  // since the clip's root motion has no reason to be the same figure to
  // figure or spawn to spawn.
  const hips = skeleton.bones.find((b) => b.name === 'Hips');
  const hipsWorld = hips.getAbsolutePosition(root);
  root.position.x -= hipsWorld.x - root.position.x;
  root.position.z -= hipsWorld.z - root.position.z;
  root.computeWorldMatrix(true);

  return {
    /** Put the pre-floor-pose values back on every node the floor pose
     * touched, so the hostage's skeleton is a clean slate for whatever clip
     * agents.js starts on it next — called once, the moment orders.js
     * reports the squad reached the hostage. */
    standUp() {
      for (const [node, { position, rotationQuaternion, scaling }] of restPose) {
        node.position.copyFrom(position);
        if (rotationQuaternion) node.rotationQuaternion = rotationQuaternion;
        node.scaling.copyFrom(scaling);
      }
      root.computeWorldMatrix(true);
      skeleton.prepare(true);
      skeleton.computeAbsoluteMatrices(true);
    },
  };
}
