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

const BUILDERS = { bat, knife, pipe };

export const MELEE_ITEMS = [
  { id: 'none', label: 'Empty' },
  { id: 'bat', label: 'Bat' },
  { id: 'knife', label: 'Knife' },
  { id: 'pipe', label: 'Pipe' },
];

/** Clips the melee item should appear for. */
export const MELEE_CLIPS = new Set(['Idle_Sword', 'Sword_Slash']);

// How a held item sits in the right hand.
//
// The shaft runs THROUGH the fist, square to where the fingers point — a bat
// aligned WITH the fingers reads as an extension of the arm, not a grip.
// Verified at a dot of 0.03 against the finger axis while heading forward past
// the knuckles.
//
// Found by sweeping axis-aligned turns and scoring them against the hand's
// measured axes, not by reasoning: the importer leaves the bone bases mirrored,
// so angles authored by hand in that space don't mean what they look like. The
// pack shares one skeleton, so this holds for every character.
const GRIP_BONE = 'Middle1.R';
const GRIP = { rotDeg: [-90, -90, 0] };

// The fist closes between the wrist and the knuckle bone, so the hand's real
// centre is the midpoint of the two — the knuckle alone sits at the far edge of
// the grip and leaves the weapon protruding backwards out of the hand.
const FIST_BLEND = 0.5;

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

  rig.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
    GRIP.rotDeg[0] * DEG, GRIP.rotDeg[1] * DEG, GRIP.rotDeg[2] * DEG,
  );
  // Cancel the importer's mirror so the item isn't rendered inside-out.
  rig.computeWorldMatrix(true);
  if (rig.getWorldMatrix().determinant() < 0) rig.scaling.set(1, -1, 1);
  rig.computeWorldMatrix(true);

  const wristBone = skeleton.bones.find((b) => b.name === 'Wrist.R');

  /**
   * Sit the butt of the item in the middle of the fist.
   *
   * Two steps: shift the geometry along its own axis so its lowest point is the
   * grip origin (items are authored from roughly zero, but a bat's knob dips
   * below it), then move the rig so that origin lands at the fist centre. The
   * rig-local displacement is measured rather than derived — see the note above
   * on this rig's mirrored bone bases.
   */
  const seatInFist = () => {
    if (!parts.length || !wristBone) return;

    let lowest = Infinity;
    for (const m of parts) {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo();
      const b = m.getBoundingInfo().boundingBox;
      lowest = Math.min(lowest, b.minimum.y + m.position.y);
    }
    if (Number.isFinite(lowest)) for (const m of parts) m.position.y -= lowest;

    const wrist = wristBone.getAbsolutePosition(carrier);
    const knuckle = bone.getAbsolutePosition(carrier);
    const target = BABYLON.Vector3.Lerp(wrist, knuckle, FIST_BLEND);

    const base = rig.position.clone();
    rig.computeWorldMatrix(true);
    const p0 = rig.getAbsolutePosition().clone();
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const eps = 0.01;
    const ax = ['x', 'y', 'z'];
    for (let a = 0; a < 3; a++) {
      rig.position.copyFrom(base);
      rig.position[ax[a]] += eps;
      rig.computeWorldMatrix(true);
      const p = rig.getAbsolutePosition();
      J[0][a] = (p.x - p0.x) / eps;
      J[1][a] = (p.y - p0.y) / eps;
      J[2][a] = (p.z - p0.z) / eps;
    }
    rig.position.copyFrom(base);
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
      - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
      + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(J);
    if (Math.abs(D) > 1e-9) {
      const rhs = [target.x - p0.x, target.y - p0.y, target.z - p0.z];
      const sub = (c) => J.map((row, i) => row.map((v, j) => (j === c ? rhs[i] : v)));
      rig.position.set(base.x + det(sub(0)) / D, base.y + det(sub(1)) / D, base.z + det(sub(2)) / D);
    }
    rig.computeWorldMatrix(true);
  };

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
      const build = BUILDERS[next];
      if (build) parts = build(scene, rig);
      seatInFist();
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
