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

// Which bones the drawn hand hangs off, and how much of a vertex's weight has to
// land on them before it counts as hand rather than forearm.
const GRIP_BONES = /^(Wrist|Thumb|Index|Middle|Ring|Pinky)\d*\.R$/;
const GRIP_WEIGHT = 0.6;

// Where the item sits relative to the measured hand centre, in the grip bone's
// units (~1.26 per metre, so 0.01 is a little under 8mm).
//
// The hand's centre of mass is not its gripping point: the palm and the finger
// ROOTS — which all sit back at `Middle1.R`, the wrist end — pull the centroid
// towards the knuckle, leaving the item held by the very tip of its butt. This
// nudges it out to where the fingers actually close.
//
// The axes are measured, not assumed. `alongShaft` runs down the item itself —
// the bone's x axis, verified at a dot of -1 against the bat's own long axis —
// so NEGATIVE slides the item towards its tip and leaves more butt behind the
// hand. That is what puts the fist around the middle of the handle instead of
// clamped on its very end. `alongFingers` runs from the wrist out to the
// fingertips, reading as down the arm on screen at ~290px per unit against a
// fist only 33px long, so small numbers move a lot. `throughPalm` crosses from
// the back of the hand towards the curled fingers.
const GRIP_OFFSET = { alongShaft: -0.03, alongFingers: 0.013, throughPalm: 0 };

/**
 * Where the closed fingers are actually drawn, in world space, for the pose on
 * screen — the middle of the tunnel a handle passes through.
 *
 * Not derivable from the bone joints: `Wrist.R` and `Middle1.R` are 2.8cm apart
 * and BOTH sit ~12cm above the rendered fist, so any blend of the two lands up
 * at the forearm. The only honest answer is the geometry.
 */
function handCentre(skeleton, meshes) {
  const hand = new Set();
  skeleton.bones.forEach((b, i) => { if (GRIP_BONES.test(b.name)) hand.add(i); });
  if (!hand.size) return null;

  // Build the skinning matrices from the bones directly rather than reading
  // `getTransformMatrices`. That buffer is only refreshed for meshes Babylon
  // actually renders, and `prepare()` early-returns unless the skeleton is
  // flagged dirty — so a freshly imported figure hands back the BIND pose, which
  // measures an open hand and seats the item out past the fingertips. Whether
  // that happened depended on frame timing, so the same build placed the item in
  // two different spots run to run. Bone matrices are always current.
  const bones = skeleton.bones.map(
    (b) => b.getInvertedAbsoluteTransform().multiply(b.getFinalMatrix()),
  );
  const blend = BABYLON.Matrix.FromValues(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  const sum = new BABYLON.Vector3(0, 0, 0);
  let n = 0;

  // Every mesh sharing the skeleton, not just one. The pack splits each figure
  // into a primitive per material, and the hand does not reliably land in the
  // first of them — on the Farmer it sits in the fourth, while the first holds a
  // 30-vertex scrap of sleeve. Measuring whichever came first put that character's
  // grip point in a different place from everyone else's.
  for (const mesh of meshes) {
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const idx = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesIndicesKind);
    const wts = mesh.getVerticesData(BABYLON.VertexBuffer.MatricesWeightsKind);
    if (!pos || !idx || !wts) continue;
    const world = mesh.getWorldMatrix();

    for (let v = 0; v < pos.length / 3; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (hand.has(idx[v * 4 + k])) w += wts[v * 4 + k];
      if (w < GRIP_WEIGHT) continue;

      // Linear blend skinning, the same sum the GPU performs.
      for (let e = 0; e < 16; e++) blend.m[e] = 0;
      for (let k = 0; k < 4; k++) {
        const bw = wts[v * 4 + k];
        if (!bw) continue;
        const src = bones[idx[v * 4 + k]].m;
        for (let e = 0; e < 16; e++) blend.m[e] += src[e] * bw;
      }
      blend.markAsUpdated();
      const local = new BABYLON.Vector3(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      sum.addInPlace(BABYLON.Vector3.TransformCoordinates(
        BABYLON.Vector3.TransformCoordinates(local, blend), world));
      n++;
    }
  }
  return n ? sum.scale(1 / n) : null;
}

/**
 * Build the melee rig. One node on the hand; items are created into it on
 * demand and disposed when swapped, so only the selected item exists.
 */
export function createMelee(scene, loaded) {
  const skeleton = loaded.skeletons[0];
  const bone = skeleton?.bones.find((b) => b.name === GRIP_BONE);
  // All the meshes carrying vertices, not just any node bound to the skeleton —
  // `handCentre` reads their skin weights, and the hand may live in any of them.
  //
  // The pistol is excluded: it is skinned to the hand bones too, so on the two
  // characters that carry one it counted as hand geometry and pulled the grip
  // point out towards the barrel, seating their melee items differently from
  // everyone else's.
  const skinned = loaded.meshes.filter(
    (m) => m.skeleton === skeleton
      && m.getTotalVertices() > 0
      && !m.name.startsWith('Pistol'),
  );
  const carrier = skinned[0];
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

  /**
   * Sit the butt of the item in the middle of the fist.
   *
   * Two steps: shift the geometry along its own axis so its lowest point is the
   * grip origin (items are authored from roughly zero, but a bat's knob dips
   * below it), then move the rig so that origin lands on the measured hand
   * centre. The rig-local displacement is measured rather than derived — see the
   * note above on this rig's mirrored bone bases.
   */
  const seatInFist = (measured) => {
    if (!parts.length) return;

    let lowest = Infinity;
    for (const m of parts) {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo();
      const b = m.getBoundingInfo().boundingBox;
      lowest = Math.min(lowest, b.minimum.y + m.position.y);
    }
    if (Number.isFinite(lowest)) for (const m of parts) m.position.y -= lowest;

    const target = measured ?? handCentre(skeleton, skinned);
    if (!target) return;

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
    // Out from the hand's centre of mass to where the fingers close on it.
    rig.position.x += GRIP_OFFSET.alongShaft;
    rig.position.y += GRIP_OFFSET.alongFingers;
    rig.position.z += GRIP_OFFSET.throughPalm;
    rig.computeWorldMatrix(true);
  };

  let kind = 'none';
  let parts = [];
  // Seating is deferred to the first time the item is shown. Measuring at build
  // time would read the bind pose — fingers straight, hand centre out at the
  // fingertips — instead of the closed fist the melee clips actually pose.
  let seated = false;

  /**
   * Seat once the clip is actually driving the skeleton, keeping the item hidden
   * until then rather than showing it in the wrong place for a frame.
   *
   * Starting an AnimationGroup does not pose the bones — that happens on a later
   * frame, and exactly which one varies, so a fixed wait seated against the bind
   * pose on some loads and the real pose on others. Instead, wait for the
   * measurement to hold still: once posed it is steady to well under a
   * millimetre, while the bind-to-posed jump is thirty times that. The bind pose
   * is stable too, so stability alone would not tell them apart — hence also
   * requiring a few frames to have gone by first.
   */
  const seatWhenPosed = () => {
    for (const p of parts) p.setEnabled(false);
    let prev = null;
    let frames = 0;
    const obs = scene.onAfterRenderObservable.add(() => {
      const stop = () => scene.onAfterRenderObservable.remove(obs);
      if (!api.visible || seated) return stop();
      const centre = handCentre(skeleton, skinned);
      if (!centre) return stop();
      frames++;
      if (frames > 2 && prev && BABYLON.Vector3.Distance(prev, centre) < 0.001) {
        seatInFist(centre);
        seated = true;
        for (const p of parts) p.setEnabled(true);
        return stop();
      }
      prev = centre;
    });
  };

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
      seated = false;
      api.setVisible(api.visible);
    },
    visible: false,
    setVisible(on) {
      api.visible = on;
      if (on && !seated) { seatWhenPosed(); return; }
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
