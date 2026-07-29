// Pure bounding-sphere camera fit. No imports (no three.js) so this loads
// under bare `node --test` — main.js is the only three.js-aware caller.
//
// Replaces the old aspect-lerped-fov approach: fov stays a fixed constant,
// and the camera's DISTANCE from the subject does the adapting, so the
// subject's core points fill the same fraction of the frame at any aspect
// ratio instead of leaving an arbitrary dead band of foreground sand.

function boundingSphere(points) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = points.length;
  cx /= n; cy /= n; cz /= n;
  let R = 0;
  for (const p of points) {
    const d = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
    if (d > R) R = d;
  }
  return { center: [cx, cy, cz], R };
}

// Pure: no three.js types in or out — Node-testable.
// points: [[x,y,z], ...]; returns { distance, center: [x,y,z], lookAt: [x,y,z] }
// (plus `position` and `R`, convenience fields main.js uses to place the
// camera and to scale drift/parallax amplitudes proportionally to framing).
export function fitCamera(points, aspect, { fov, margin, lookLift, viewDir }) {
  const { center, R } = boundingSphere(points);

  const vHalf = (fov / 2) * Math.PI / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const half = Math.min(vHalf, hHalf); // the tighter axis governs distance
  const distance = R / Math.sin(half) * margin;

  const len = Math.hypot(viewDir[0], viewDir[1], viewDir[2]) || 1;
  const position = [
    center[0] + (viewDir[0] / len) * distance,
    center[1] + (viewDir[1] / len) * distance,
    center[2] + (viewDir[2] / len) * distance,
  ];
  const lookAt = [center[0], center[1] + R * lookLift, center[2]];

  return { distance, center, lookAt, position, R };
}
