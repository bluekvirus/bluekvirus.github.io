// Camera and lighting for the raid view.
//
// The building is drawn without a ceiling and viewed from 45 degrees: high
// enough that every room reads at once, shallow enough that walls still give the
// interior a sense of depth. Orbiting is allowed but the default pitch is fixed
// at 45 because that is the angle the layout is tuned to read at.

const PITCH_45 = Math.PI / 4;

export function createStage({ scene, engine, canvas }) {
  scene.clearColor = BABYLON.Color4.FromHexString('#191d24ff');

  const camera = new BABYLON.ArcRotateCamera(
    'raidCam', -Math.PI / 2, PITCH_45, 60, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerBetaLimit = 0.15;
  camera.upperBetaLimit = Math.PI / 2 - 0.02; // never below the floor plane
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 140;
  camera.wheelDeltaPercentage = 0.02;
  camera.panningSensibility = 60;

  const key = new BABYLON.DirectionalLight('key', new BABYLON.Vector3(-0.55, -1, 0.4), scene);
  key.position = new BABYLON.Vector3(30, 60, -25);
  key.intensity = 1.15;

  const fill = new BABYLON.HemisphericLight('fill', new BABYLON.Vector3(0, 1, 0), scene);
  fill.intensity = 0.55;
  fill.diffuse = BABYLON.Color3.FromHexString('#9fb0c4');
  fill.groundColor = BABYLON.Color3.FromHexString('#2b3038');

  const shadows = new BABYLON.ShadowGenerator(2048, key);
  shadows.usePercentageCloserFiltering = true;
  shadows.bias = 0.008;

  /** Point at a footprint and pull back far enough to hold it all in frame. */
  const frameOn = (bounds) => {
    const centre = new BABYLON.Vector3(bounds.x + bounds.w / 2, 0, bounds.z + bounds.d / 2);
    camera.setTarget(centre);
    const span = Math.max(bounds.w, bounds.d);
    const fov = camera.fov || 0.8;
    // Trigonometric fit with headroom, so a bigger footprint is not clipped.
    camera.radius = (span / 2) / Math.tan(fov / 2) * 1.15;
    camera.beta = PITCH_45;
    key.position = new BABYLON.Vector3(centre.x + span * 0.6, span * 1.6, centre.z - span * 0.5);
  };

  return { camera, shadows, frameOn };
}
