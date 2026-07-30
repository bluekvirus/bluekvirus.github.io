// Hand-held melee items for the pack's sword clips (`Idle_Sword`,
// `Sword_Slash`), which pose the right hand for a grip but ship no weapon.
//
// Each item is authored around its GRIP: the origin sits in the palm and the
// item extends along +Y. That single convention lets one attachment transform
// serve every item — swapping a knife for a bat changes geometry, not placement.

const DEG = Math.PI / 180;

function mat(scene, name, hex, opts = {}) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = opts.spec
    ? BABYLON.Color3.FromHexString(opts.spec)
    : new BABYLON.Color3(0, 0, 0);
  if (opts.specPower) m.specularPower = opts.specPower;
  return m;
}

/** Baseball bat: long tapered barrel off a thin grip, with a knob. */
function bat(scene, root) {
  const wood = mat(scene, 'meleeWood', '#a9793f');
  const tape = mat(scene, 'meleeTape', '#3a3a40');
  const parts = [];

  const knob = BABYLON.MeshBuilder.CreateCylinder('batKnob',
    { diameterTop: 0.052, diameterBottom: 0.052, height: 0.022, tessellation: 8 }, scene);
  knob.position.y = -0.01;
  knob.material = wood;
  parts.push(knob);

  const grip = BABYLON.MeshBuilder.CreateCylinder('batGrip',
    { diameterTop: 0.042, diameterBottom: 0.038, height: 0.20, tessellation: 8 }, scene);
  grip.position.y = 0.10;
  grip.material = tape;
  parts.push(grip);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('batBarrel',
    { diameterTop: 0.075, diameterBottom: 0.044, height: 0.46, tessellation: 10 }, scene);
  barrel.position.y = 0.43;
  barrel.material = wood;
  parts.push(barrel);

  const cap = BABYLON.MeshBuilder.CreateCylinder('batCap',
    { diameterTop: 0.070, diameterBottom: 0.075, height: 0.02, tessellation: 10 }, scene);
  cap.position.y = 0.665;
  cap.material = wood;
  parts.push(cap);

  for (const p of parts) p.parent = root;
  return parts;
}

/** Combat knife: short wrapped handle, guard, tapering blade. */
function knife(scene, root) {
  const steel = mat(scene, 'meleeSteel', '#b9c0c8', { spec: '#6e7681', specPower: 48 });
  const dark = mat(scene, 'meleeDark', '#26262b');
  const parts = [];

  const handle = BABYLON.MeshBuilder.CreateCylinder('knifeGrip',
    { diameterTop: 0.030, diameterBottom: 0.034, height: 0.11, tessellation: 8 }, scene);
  handle.position.y = 0.055;
  handle.material = dark;
  parts.push(handle);

  const guard = BABYLON.MeshBuilder.CreateBox('knifeGuard',
    { width: 0.075, height: 0.014, depth: 0.026 }, scene);
  guard.position.y = 0.118;
  guard.material = steel;
  parts.push(guard);

  // Blade: a flattened box tapering to a point.
  const blade = BABYLON.MeshBuilder.CreateCylinder('knifeBlade',
    { diameterTop: 0.006, diameterBottom: 0.040, height: 0.20, tessellation: 4 }, scene);
  blade.position.y = 0.228;
  blade.scaling.z = 0.32; // flatten into a blade rather than a spike
  blade.material = steel;
  parts.push(blade);

  for (const p of parts) p.parent = root;
  return parts;
}

/** Steel pipe: plain tube with a coupling collar and a taped end. */
function pipe(scene, root) {
  const steel = mat(scene, 'meleePipe', '#7d838b', { spec: '#565c64', specPower: 32 });
  const rust = mat(scene, 'meleeRust', '#6b4f3a');
  const parts = [];

  const grip = BABYLON.MeshBuilder.CreateCylinder('pipeGrip',
    { diameter: 0.046, height: 0.16, tessellation: 10 }, scene);
  grip.position.y = 0.08;
  grip.material = rust;
  parts.push(grip);

  const shaft = BABYLON.MeshBuilder.CreateCylinder('pipeShaft',
    { diameter: 0.044, height: 0.40, tessellation: 10 }, scene);
  shaft.position.y = 0.36;
  shaft.material = steel;
  parts.push(shaft);

  const collar = BABYLON.MeshBuilder.CreateCylinder('pipeCollar',
    { diameter: 0.058, height: 0.05, tessellation: 10 }, scene);
  collar.position.y = 0.545;
  collar.material = steel;
  parts.push(collar);

  for (const p of parts) p.parent = root;
  return parts;
}

/** Compact sidearm, for characters whose mesh doesn't ship one. */
function pistol(scene, root) {
  const dark = mat(scene, 'holdPistolDark', '#2a2c31');
  const steel = mat(scene, 'holdPistolSteel', '#4a4e55', { spec: '#6e7681', specPower: 40 });
  const parts = [];

  // Authored around the same grip origin as the melee items: the butt sits in
  // the palm and the weapon runs along +Y, so it reuses the solved transform.
  const butt = BABYLON.MeshBuilder.CreateBox('pistolGrip',
    { width: 0.032, height: 0.105, depth: 0.052 }, scene);
  butt.position.set(0, 0.035, -0.012);
  butt.rotation.x = -12 * DEG;
  butt.material = dark;
  parts.push(butt);

  const frame = BABYLON.MeshBuilder.CreateBox('pistolFrame',
    { width: 0.030, height: 0.055, depth: 0.150 }, scene);
  frame.position.set(0, 0.108, 0.040);
  frame.material = steel;
  parts.push(frame);

  const slide = BABYLON.MeshBuilder.CreateBox('pistolSlide',
    { width: 0.028, height: 0.026, depth: 0.070 }, scene);
  slide.position.set(0, 0.140, 0.070);
  slide.material = dark;
  parts.push(slide);

  for (const p of parts) p.parent = root;
  return parts;
}

const BUILDERS = { bat, knife, pipe, pistol };

export const MELEE_ITEMS = [
  { id: 'none', label: 'Empty' },
  { id: 'bat', label: 'Bat' },
  { id: 'knife', label: 'Knife' },
  { id: 'pipe', label: 'Pipe' },
];

/** Clips the melee item should appear for. */
export const MELEE_CLIPS = new Set(['Idle_Sword', 'Sword_Slash']);

// How a held item sits in the right hand. Two transforms, because a pistol and
// a bat are gripped differently:
//
//   MELEE — the shaft runs THROUGH the fist, perpendicular to the direction the
//     fingers point. Verified: the shaft's dot with the finger axis is 0.03,
//     i.e. square to it, while heading forward past the knuckles.
//   GUN — the barrel points where the fist points, so the weapon aims down the
//     arm rather than out of the top of the hand. Scores 0.998 against the aim
//     axis, matching how SWAT's and Suit's built-in pistols sit.
//
// Both were found by sweeping axis-aligned turns and scoring them against the
// hand's own axes, not by reasoning: the importer leaves the bone bases
// mirrored, so angles authored by hand in that space mean nothing. The pack
// shares one skeleton, so these hold for every character.
const GRIP_BONE = 'Middle1.R';
const GRIP_MELEE = { pos: [0, 0, 0], rotDeg: [-90, -90, 0] };
const GRIP_GUN = { pos: [0, 0, 0], rotDeg: [-90, -90, -90] };
const GRIP_FOR = (kind) => (kind === 'pistol' ? GRIP_GUN : GRIP_MELEE);

/**
 * Build the melee rig. One node on the hand; items are created into it on
 * demand and disposed when swapped, so only the selected item exists.
 */
export function createMelee(scene, loaded) {
  const skeleton = loaded.skeletons[0];
  const bone = skeleton?.bones.find((b) => b.name === GRIP_BONE);
  const carrier = loaded.meshes.find((m) => m.skeleton === skeleton);
  if (!bone || !carrier) return null;

  const rig = new BABYLON.TransformNode('heldItemRig', scene);
  rig.attachToBone(bone, carrier);

  const applyGrip = (kind) => {
    const g = GRIP_FOR(kind);
    rig.position.fromArray(g.pos);
    rig.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
      g.rotDeg[0] * DEG, g.rotDeg[1] * DEG, g.rotDeg[2] * DEG,
    );
    // Cancel the importer's mirror so the item isn't rendered inside-out.
    rig.scaling.setAll(1);
    rig.computeWorldMatrix(true);
    if (rig.getWorldMatrix().determinant() < 0) rig.scaling.set(1, -1, 1);
    rig.computeWorldMatrix(true);
  };
  applyGrip('bat');

  let kind = 'none';
  let parts = [];

  const api = {
    rig,
    get kind() { return kind; },
    get meshes() { return parts; },
    /** Swap the held item. `none` clears it. */
    setItem(next) {
      if (next === kind) return;
      for (const p of parts) p.dispose();
      parts = [];
      kind = next;
      applyGrip(next);
      const build = BUILDERS[next];
      if (build) parts = build(scene, rig);
      api.setVisible(api.visible);
    },
    visible: false,
    setVisible(on) {
      api.visible = on;
      for (const p of parts) p.setEnabled(on);
    },
    dispose() {
      for (const p of parts) p.dispose();
      parts = [];
      rig.dispose();
    },
  };

  return api;
}
