// Weapons in hands.
//
// Each item is authored around its GRIP: the origin sits in the palm and the
// item extends along +Y, the same convention soldier/melee.js established, so
// one attachment transform serves every item and swapping a rifle for a bat
// changes geometry rather than placement.
//
// The bone is found by NAME, not by index. Bone indices differ between the
// pack's models, and an index that happens to be the right hand on Swat.glb
// is an elbow on Punk.glb -- which shows up as a rifle growing out of a
// forearm rather than as an error.

const HAND_BONE = 'Wrist.R';

function material(scene, name, hex) {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(hex);
  m.specularColor = new BABYLON.Color3(0, 0, 0);
  return m;
}

function rifle(scene) {
  const body = material(scene, 'weaponBody', '#2b2b30');
  const parts = [];

  const receiver = BABYLON.MeshBuilder.CreateBox('rifleReceiver',
    { width: 0.05, height: 0.30, depth: 0.09 }, scene);
  receiver.position.y = 0.10;
  parts.push(receiver);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('rifleBarrel',
    { diameter: 0.025, height: 0.34, tessellation: 8 }, scene);
  barrel.position.y = 0.36;
  parts.push(barrel);

  const magazine = BABYLON.MeshBuilder.CreateBox('rifleMag',
    { width: 0.035, height: 0.13, depth: 0.05 }, scene);
  magazine.position.set(0, 0.04, -0.06);
  parts.push(magazine);

  const stock = BABYLON.MeshBuilder.CreateBox('rifleStock',
    { width: 0.04, height: 0.16, depth: 0.07 }, scene);
  stock.position.y = -0.10;
  parts.push(stock);

  for (const p of parts) p.material = body;
  const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  merged.name = 'rifle';
  return merged;
}

function bat(scene) {
  const wood = material(scene, 'meleeWood', '#a9793f');
  const parts = [];

  const grip = BABYLON.MeshBuilder.CreateCylinder('batGrip',
    { diameter: 0.032, height: 0.16, tessellation: 8 }, scene);
  grip.position.y = 0.08;
  parts.push(grip);

  const barrel = BABYLON.MeshBuilder.CreateCylinder('batBarrel',
    { diameterTop: 0.062, diameterBottom: 0.038, height: 0.42, tessellation: 8 }, scene);
  barrel.position.y = 0.37;
  parts.push(barrel);

  for (const p of parts) p.material = wood;
  const merged = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  merged.name = 'bat';
  return merged;
}

/**
 * Put the right weapon in the figure's right hand. Returns the mesh so the
 * caller can dispose it, or null when the figure carries nothing.
 */
export function attachWeapon(scene, figure, weapon) {
  if (weapon !== 'gun' && weapon !== 'melee') return null;

  const bone = figure.skeleton?.bones.find((b) => b.name === HAND_BONE);
  if (!bone) {
    throw new Error(`weapons: ${figure.role} has no bone named ${HAND_BONE}`);
  }

  const mesh = weapon === 'gun' ? rifle(scene) : bat(scene);
  mesh.attachToBone(bone, figure.root);
  // No rotation offset: `Wrist.R`'s own rest orientation, measured on screen,
  // already has its local +Y running down the forearm toward the fingers —
  // the same direction the arm hangs at idle. The brief's guessed rotation of
  // (PI/2, 0, 0) was tuned for soldier/melee.js's grip bone (`Middle1.R`,
  // a different bone further into the hand with a different rest pose) and
  // sent this item out sideways from the wrist instead of down through the
  // fist, floating clear of the hand. Verified across Idle, Walk, Run and
  // firing/swinging clips with the browser's debug camera before settling
  // here — see task-8-report.md.
  mesh.position = new BABYLON.Vector3(0, 0, 0);
  return mesh;
}
