// Render-boundary conversion from the simulation's `facing` value to the
// `rotation.y` a spawned figure's root needs so the MODEL actually turns to
// face the way it is moving.
//
// `world.js` computes `facing` as `atan2(vx, vz)` purely as sim geometry —
// the angle of the direction of travel — and knows nothing about meshes or
// which way any given model's own forward axis points. Everything about the
// model lives on this side of the boundary, in the renderer, which is why
// the conversion belongs here rather than in `raid/sim/**`: changing what
// `facing` itself means would touch a pure, replay-hashed module for a
// concern (which way a mesh is authored to face) that module cannot even
// observe.
//
// The Quaternius rig's own forward axis was established by direct
// measurement, not by eye and not by re-deriving `rotation.y` from
// `atan2(vx, vz)` again — that second check is exactly what looked clean
// while this bug was present, since it just restates the same (wrong)
// assumption the renderer already made. Concretely: pin a figure's
// `rotation.y` to 0 and render it from a camera at +Z looking back toward
// the origin, and the figure's BACK is what faces the camera — the model's
// own front points along world -Z at rotation.y = 0. (Babylon's glTF
// importer also bakes a -1 scale onto local Z on these roots, converting
// glTF's right-handed export to Babylon's left-handed convention; that
// scale is already folded into the -Z conclusion above, since it was
// reached by rendering the actual figure, not by reasoning about the scale
// in the abstract.)
//
// Setting `rotation.y = facing` directly therefore aims the model's front
// exactly opposite the direction of travel — every figure moonwalks, its
// walk cycle playing forward while it travels backward. Adding PI is the
// fix: rotating the model's front (-Z) by `facing + PI` lands it on the
// same world direction that rotating its back (+Z) by `facing` alone would
// have — i.e. squarely along the direction of travel. This holds for every
// figure and every facing value alike, so it is applied once here rather
// than duplicated at each of the two call sites (initial spawn placement in
// cast.js, per-frame sync in agents.js) that need it.
export function facingToRotationY(facing) {
  return facing + Math.PI;
}
