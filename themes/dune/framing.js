// Pure camera-space BOX fit + aspect-responsive view direction. No imports
// (no three.js) so this loads under bare `node --test` — main.js is the only
// three.js-aware caller.
//
// v4 amendment: replaces the earlier bounding-SPHERE fit. The sphere fit was
// proven (twice, independently) to cap portrait vertical fill at
// atan(tan(vHalf)*aspect)/vHalf regardless of which points are chosen — a
// property of the sphere abstraction itself. Fitting the subject's actual
// camera-space silhouette (a wide, shallow strip) instead of the much larger
// sphere that encloses it removes that ceiling, and lets the view direction
// stay shallow enough that the horizon and sky remain in frame at EVERY
// aspect (elevation never exceeds ~45 degrees).

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Shared aspect blend: 0 at aspect <= 0.55 (phone portrait), 1 at
// aspect >= 1.4 (landscape), smoothstep between.
function aspectBlend(aspect) {
  const t0 = 0.55, t1 = 1.4;
  let t = (aspect - t0) / (t1 - t0);
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

// Smoothstep-interpolated view direction: FOCUS.viewDirWide (low
// three-quarter, horizon + sky clearly visible) at aspect >= 1.4,
// FOCUS.viewDirTall (steeper three-quarter — a tall frame earns fill from
// battlefield DEPTH projecting into screen height, not from going overhead)
// at aspect <= 0.55, smoothly blended and re-normalized in between. Pure and
// exported so tests can assert elevation <= 45 deg across the whole aspect
// range.
export function viewDirForAspect(aspect, { viewDirWide, viewDirTall }) {
  const t = aspectBlend(aspect);
  return norm3([
    viewDirTall[0] + (viewDirWide[0] - viewDirTall[0]) * t,
    viewDirTall[1] + (viewDirWide[1] - viewDirTall[1]) * t,
    viewDirTall[2] + (viewDirWide[2] - viewDirTall[2]) * t,
  ]);
}

// Tiered focus selection (pure, testable). Rule — the simplest that produced
// good framing in visual iteration: FOCUS.core (harvester + Harkonnen arc)
// is always framed; FOCUS.near (the near Fremen posts) is appended at
// aspect >= 0.7, and FOCUS.wide (the far Fremen positions) only at
// aspect >= 1.0 — so landscape frames the whole engagement line, tablets
// keep the close firefight, and phone portrait frames the machine and its
// escort line tightly (what a camera operator would do; Fremen fire arrives
// from off-frame). FOCUS.bonus (worm breach apex, ~300 units past the
// battle) is NEVER fed into the fit — including it would more than double
// the forward extent and shove the subject into the distance; it is framed
// only when it falls inside the core-derived frustum for free.
export function selectFocusPoints(focus, aspect) {
  let pts = focus.core;
  if (aspect >= 0.7) pts = pts.concat(focus.near);
  if (aspect >= 1.0) pts = pts.concat(focus.wide);
  return pts;
}

// Camera-space box fit. points: [[x,y,z], ...]; aspect: w/h.
// Returns { distance, center, lookAt, position, wr, wu, wd }:
//   wr/wu/wd — half-extents of the point set along camera right/up/forward
//   (main.js scales drift/parallax by wr, the binding horizontal extent).
// Basis: forward = normalize(-viewDir) (camera sits at center + viewDir*d and
// looks back toward center), right = normalize(worldUp x forward),
// up = forward x right.
// distance = max(wr/tan(hHalf), wu/tan(vHalf)) * margin + wd — the subject's
// actual silhouette governs, per axis, and the forward half-depth is added so
// the NEAREST silhouette plane (not the centroid) sits at the fitting
// distance.
// lookAt = center + [0, lift, 0]: lifting the aim tilts the camera up, which
// drops the horizon from above the frame into the upper band and crops dead
// foreground sand off the bottom. The lift is horizon-targeted when
// opts.horizonFrac is given (preferred): it is derived analytically so the
// true horizon sits at exactly `horizonFrac` of the frame height from the
// top — the composition goal the spec states ("horizon in the upper third,
// dead foreground cropped") — because the world-unit lift a given horizon
// position needs scales with the fitted distance, which no constant
// `wu * lookLift` can track across aspects. Fallback when horizonFrac is
// absent: the plain lift = wu * lookLift.
export function fitCamera(points, aspect, { fov, margin, viewDir, horizonFrac, lookLift = 0 }) {
  // Centroid.
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = points.length;
  cx /= n; cy /= n; cz /= n;

  // Orthonormal camera basis from the view direction.
  const dir = norm3(viewDir);
  const fwd = [-dir[0], -dir[1], -dir[2]];
  const right = norm3([fwd[2], 0, -fwd[0]]); // worldUp x fwd, worldUp = [0,1,0]
  const up = [
    fwd[1] * right[2] - fwd[2] * right[1],
    fwd[2] * right[0] - fwd[0] * right[2],
    fwd[0] * right[1] - fwd[1] * right[0],
  ];

  // Half-extents of the points (relative to centroid) in camera space.
  let wr = 0, wu = 0, wd = 0;
  for (const p of points) {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    const r = Math.abs(dx * right[0] + dy * right[1] + dz * right[2]);
    const u = Math.abs(dx * up[0] + dy * up[1] + dz * up[2]);
    const d = Math.abs(dx * fwd[0] + dy * fwd[1] + dz * fwd[2]);
    if (r > wr) wr = r;
    if (u > wu) wu = u;
    if (d > wd) wd = d;
  }

  const vHalf = (fov / 2) * Math.PI / 180;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const distance = Math.max(wr / Math.tan(hHalf), wu / Math.tan(vHalf)) * margin + wd;

  const center = [cx, cy, cz];
  const position = [
    cx + dir[0] * distance,
    cy + dir[1] * distance,
    cz + dir[2] * distance,
  ];

  let lift;
  if (horizonFrac != null) {
    // Aim pitch that puts the horizon at `horizonFrac` of frame height from
    // the top: NDC y of the horizon is (1 - 2*horizonFrac); a camera pitched
    // down by phi shows the horizon at ndcY = tan(phi)/tan(vHalf).
    const phi = Math.atan(Math.tan(vHalf) * (1 - 2 * horizonFrac));
    const dv = dir[1] * distance;                        // camera height over center
    const dh = Math.hypot(dir[0], dir[2]) * distance;    // horizontal standoff
    lift = Math.max(0, dv - dh * Math.tan(phi));         // never aim below center
  } else {
    lift = wu * lookLift;
  }
  const lookAt = [cx, cy + lift, cz];

  return { distance, center, lookAt, position, wr, wu, wd };
}

// One-call convenience used by main.js: selects the focus tiers, blends the
// view direction and margin for the aspect, and runs the box fit.
export function fitFocus(focus, aspect) {
  const viewDir = viewDirForAspect(aspect, focus);
  const t = aspectBlend(aspect);
  const margin = focus.marginTall + (focus.marginWide - focus.marginTall) * t;
  const horizonFrac = focus.horizonFracTall + (focus.horizonFracWide - focus.horizonFracTall) * t;
  const points = selectFocusPoints(focus, aspect);
  return fitCamera(points, aspect, { fov: focus.fov, margin, viewDir, horizonFrac });
}
