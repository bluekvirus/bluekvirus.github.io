// Turns plan data into meshes. This is the only module that knows what a mesh is;
// everything upstream is plain data, which is what lets the generator be tested
// without a renderer.

const ROLE_TINT = {
  entry: '#3f4a55',
  hostage: '#4a4038',
  guard: '#383f47',
  filler: '#343a42',
  corridor: '#2c3138',
};

const MARKER_TINT = {
  swat: '#4d7ea8',
  hostile: '#b4453c',
  hostage: '#d59b3c',
  extraction: '#5c9455',
};

function flat(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

export function buildLevel(scene, plan, mission, shadows) {
  const created = [];
  const materials = [];

  // Floors, one merged mesh per role so the objective room reads by tint alone
  // without a label, while keeping the draw call count down.
  const byRole = new Map();
  for (const cell of plan.cells) {
    const role = mission.roles[cell.id] ?? 'filler';
    const tile = BABYLON.MeshBuilder.CreateBox(`floor_${cell.id}`,
      { width: cell.w, depth: cell.d, height: 0.08 }, scene);
    tile.position.set(cell.x + cell.w / 2, -0.04, cell.z + cell.d / 2);
    tile.receiveShadows = true;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(tile);
  }

  for (const [role, tiles] of byRole) {
    const merged = BABYLON.Mesh.MergeMeshes(tiles, true, true, undefined, false, false);
    merged.name = `floors_${role}`;
    const mat = flat(scene, `floorMat_${role}`, ROLE_TINT[role] ?? ROLE_TINT.filler);
    merged.material = mat;
    merged.receiveShadows = true;
    materials.push(mat);
    created.push(merged);
  }

  // Walls, all one mesh. There are typically 60-plus segments and they share a
  // material, so merging turns the whole building into a single draw call.
  const wallBoxes = plan.walls.map((w, i) => {
    const box = BABYLON.MeshBuilder.CreateBox(`wall_${i}`,
      { width: w.w, depth: w.d, height: w.height }, scene);
    box.position.set(w.x + w.w / 2, w.height / 2, w.z + w.d / 2);
    return box;
  });
  if (wallBoxes.length) {
    const walls = BABYLON.Mesh.MergeMeshes(wallBoxes, true, true, undefined, false, false);
    walls.name = 'walls';
    const mat = flat(scene, 'wallMat', '#6b7078');
    walls.material = mat;
    walls.receiveShadows = true;
    shadows?.addShadowCaster(walls);
    materials.push(mat);
    created.push(walls);
  }

  // Door frames: a lintel over each opening, so a doorway reads as a doorway
  // rather than as a hole where the wall forgot to be. Doors also get a leaf
  // (the swinging panel) below the lintel; unlike the lintels, leaves are NOT
  // merged, because Task 8 rotates each one independently to track its own
  // simulation door state.
  const doorLeaves = [];
  if (plan.doors.length) {
    const t = plan.config.wallThickness;
    const doorMat = flat(scene, 'doorMat', '#575c64');
    materials.push(doorMat);

    const frames = plan.doors.map((door, i) => {
      const lintel = BABYLON.MeshBuilder.CreateBox(`door_${i}`, {
        width: door.axis === 'x' ? door.width : t,
        depth: door.axis === 'x' ? t : door.width,
        height: 0.35,
      }, scene);
      lintel.position.set(door.x, plan.config.wallHeight - 0.175, door.z);
      return lintel;
    });
    const merged = BABYLON.Mesh.MergeMeshes(frames, true, true, undefined, false, false);
    merged.name = 'doorFrames';
    merged.material = doorMat;
    created.push(merged);

    for (const door of plan.doors) {
      const leaf = BABYLON.MeshBuilder.CreateBox(`doorLeaf_${door.id}`, {
        width: door.axis === 'x' ? door.width : 0.06,
        depth: door.axis === 'x' ? 0.06 : door.width,
        height: 2.2,
      }, scene);
      // MeshBuilder centres the box on the origin, which would pivot it
      // through the middle of the doorway when rotated. Bake the hinge
      // offset into the vertex data instead, so the mesh's own local origin
      // sits at one edge of the opening and rotating it about that origin
      // swings it like a real hinge.
      const half = door.width / 2;
      const hingeOffset = door.axis === 'x'
        ? new BABYLON.Vector3(half, 0, 0)
        : new BABYLON.Vector3(0, 0, half);
      leaf.bakeTransformIntoVertices(
        BABYLON.Matrix.Translation(hingeOffset.x, hingeOffset.y, hingeOffset.z));
      leaf.position.set(door.x - hingeOffset.x, 1.1, door.z - hingeOffset.z);
      leaf.material = doorMat;
      created.push(leaf);
      doorLeaves.push(leaf);
    }
  }

  // Spawn markers: a disc under each figure, plus the extraction point.
  const discs = [];
  const addDisc = (p, kind, radius) => {
    const disc = BABYLON.MeshBuilder.CreateCylinder(`marker_${kind}_${discs.length}`,
      { diameter: radius * 2, height: 0.02, tessellation: 18 }, scene);
    disc.position.set(p.x, 0.012, p.z);
    disc.material = flat(scene, `markerMat_${kind}_${discs.length}`, MARKER_TINT[kind]);
    materials.push(disc.material);
    discs.push(disc);
    created.push(disc);
  };

  for (const s of mission.spawns.swat) addDisc(s, 'swat', 0.42);
  for (const s of mission.spawns.hostiles) addDisc(s, 'hostile', 0.42);
  addDisc(mission.spawns.hostage, 'hostage', 0.5);
  addDisc(mission.spawns.extraction, 'extraction', 0.9);

  return {
    meshes: created,
    doorLeaves,
    dispose() {
      for (const m of created) m.dispose(false, false);
      for (const m of materials) m.dispose();
    },
  };
}
