// Poses are data: named sets of joint rotations in radians (Euler XYZ).
// Stage 1 needs only `idle`. Later stages add `aim`, `walk`, `reload` here and
// interpolate between them — no geometry changes required.

const d = (deg) => (deg * Math.PI) / 180;

/** Relaxed standing idle: arms hanging with a slight outward flare. */
export const idle = {
  shoulderL: [d(4), 0, d(6)],
  shoulderR: [d(4), 0, d(-6)],
  elbowL: [d(14), 0, d(2)],
  elbowR: [d(14), 0, d(-2)],
  hipL: [d(-2), 0, d(1.5)],
  hipR: [d(-2), 0, d(-1.5)],
  kneeL: [d(3), 0, 0],
  kneeR: [d(3), 0, 0],
  spine: [d(-2), 0, 0],
  chest: [d(2), 0, 0],
  neck: [d(1), 0, 0],
};

export const POSES = { idle };

/** Apply a pose to a joint map. Joints absent from the pose are left at rest. */
export function applyPose(joints, pose) {
  for (const [name, rot] of Object.entries(pose)) {
    const j = joints[name];
    if (!j) continue;
    j.rotation.set(rot[0], rot[1], rot[2]);
  }
}
