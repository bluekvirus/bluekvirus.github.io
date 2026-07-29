// The display stage: camera rig, studio lighting, miniature base, backdrop.
// Owns everything around the figures; knows nothing about how a figure is built.

/** Round plinth for a single figure, like a tabletop miniature's base. */
function createRoundBase(scene, mats) {
  const top = BABYLON.MeshBuilder.CreateCylinder('baseTop', {
    diameter: 1.5, height: 0.06, tessellation: 24,
  }, scene);
  top.position.y = 0.03;
  top.material = mats.baseTop;
  top.receiveShadows = true;

  const rim = BABYLON.MeshBuilder.CreateCylinder('baseRim', {
    diameterTop: 1.62, diameterBottom: 1.7, height: 0.05, tessellation: 24,
  }, scene);
  rim.position.y = 0.005;
  rim.material = mats.baseRim;
  rim.receiveShadows = true;

  return [top, rim];
}

/** Long plinth for the roster lineup. */
function createLineupBase(scene, mats, width) {
  const top = BABYLON.MeshBuilder.CreateBox('baseTop', {
    width, height: 0.06, depth: 1.7,
  }, scene);
  top.position.y = 0.03;
  top.material = mats.baseTop;
  top.receiveShadows = true;

  const rim = BABYLON.MeshBuilder.CreateBox('baseRim', {
    width: width + 0.2, height: 0.05, depth: 1.95,
  }, scene);
  rim.position.y = 0.005;
  rim.material = mats.baseRim;
  rim.receiveShadows = true;

  return [top, rim];
}

/**
 * @param {object} opts.lineup - when set { width }, frame a whole roster on a
 *   long plinth instead of one figure on a round base.
 */
export function createStage({ scene, engine, canvas, mats, lineup = null }) {
  scene.clearColor = BABYLON.Color4.FromHexString('#20242bff');

  // ---- camera: turntable with drag-orbit and scroll-zoom ----------------
  const camera = new BABYLON.ArcRotateCamera(
    'cam',
    lineup ? BABYLON.Tools.ToRadians(82) : BABYLON.Tools.ToRadians(35),
    BABYLON.Tools.ToRadians(lineup ? 78 : 72),
    lineup ? Math.max(7.4, lineup.width * 1.03) : 5.0,
    new BABYLON.Vector3(0, 0.95, 0), // aim at chest height
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 2.4;
  camera.upperRadiusLimit = lineup ? 16 : 9;
  camera.lowerBetaLimit = BABYLON.Tools.ToRadians(20);
  camera.upperBetaLimit = BABYLON.Tools.ToRadians(100);
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.02;
  camera.inertia = 0.85;
  camera.fov = 0.62;

  // ---- three-point studio lighting --------------------------------------
  const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.55, -1, 0.45), scene);
  key.position = new BABYLON.Vector3(3.2, 5.4, -2.6);
  key.intensity = 1.55;

  const fill = new BABYLON.HemisphericLight('fill', new BABYLON.Vector3(0, 1, 0), scene);
  fill.intensity = 0.55;
  fill.diffuse = BABYLON.Color3.FromHexString('#c8d4e4');
  fill.groundColor = BABYLON.Color3.FromHexString('#4a453d');

  const rim = new BABYLON.DirectionalLight('rim', new BABYLON.Vector3(0.7, -0.35, -1), scene);
  rim.position = new BABYLON.Vector3(-3, 2.6, 4);
  rim.intensity = 0.55;
  rim.diffuse = BABYLON.Color3.FromHexString('#9fb4d0');

  // ---- contact shadow ----------------------------------------------------
  const shadows = new BABYLON.ShadowGenerator(2048, key);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 24;
  shadows.darkness = 0.42;

  const base = lineup
    ? createLineupBase(scene, mats, lineup.width)
    : createRoundBase(scene, mats);

  return { camera, key, fill, rim, shadows, base };
}

/**
 * Sit a figure's feet exactly on the base surface. Poses change how low the
 * boots reach, so this measures the assembled figure rather than trusting the
 * nominal hip height.
 */
export function standOnBase(root, meshes, surfaceY = 0.06) {
  let minY = Infinity;
  for (const m of meshes) {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo();
    minY = Math.min(minY, m.getBoundingInfo().boundingBox.minimumWorld.y);
  }
  if (Number.isFinite(minY)) root.position.y += surfaceY - minY;
  return root.position.y;
}

/** Slow turntable. Paused while the user is dragging, and under reduced motion. */
export function attachTurntable({ scene, camera, canvas }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dragging = false;
  canvas.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });

  if (reduced) return;
  scene.onBeforeRenderObservable.add(() => {
    if (dragging) return;
    camera.alpha += (scene.getEngine().getDeltaTime() / 1000) * 0.18;
  });
}
