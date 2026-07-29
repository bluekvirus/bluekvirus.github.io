import { createStage, attachTurntable, standOnBase } from './stage.js';

const MODEL = { dir: './assets/quaternius/', file: 'Swat.gltf' };

// The roadmap's stages map onto the pack's animation set. This order is the
// order the picker lists them in; anything in the file not named here is
// appended afterwards so nothing is hidden.
const STAGES = [
  { label: 'Idle', clip: 'Idle' },
  { label: 'Hold gun', clip: 'Idle_Gun' },
  { label: 'Aim', clip: 'Idle_Gun_Pointing' },
  { label: 'Walk', clip: 'Walk' },
  { label: 'Run', clip: 'Run' },
  { label: 'Run + fire', clip: 'Run_Shoot' },
  { label: 'Shoot', clip: 'Gun_Shoot' },
  { label: 'Punch', clip: 'Punch_Right' },
  { label: 'Kick', clip: 'Kick_Right' },
  { label: 'Roll', clip: 'Roll' },
  { label: 'Take hit', clip: 'HitRecieve' },
  { label: 'Death', clip: 'Death' },
];

const canvas = document.getElementById('view');
const engine = new BABYLON.Engine(canvas, true, { antialias: true, stencil: false });
const scene = new BABYLON.Scene(engine);

const stage = createStage({ scene, engine, canvas });
const params = new URLSearchParams(location.search);

let current = null; // active AnimationGroup

function play(name) {
  const group = scene.animationGroups.find((g) => g.name === name);
  if (!group) return false;
  if (current && current !== group) current.stop();
  group.start(true, 1.0, group.from, group.to, false);
  current = group;
  return true;
}

function addButton(bar, label, clip, extra = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.clip = clip;
  if (extra) b.className = 'extra';
  b.addEventListener('click', () => {
    play(clip);
    for (const el of bar.children) el.classList.toggle('on', el === b);
  });
  bar.appendChild(b);
  return b;
}

BABYLON.SceneLoader.ImportMeshAsync('', MODEL.dir, MODEL.file, scene)
  .then((result) => {
    // The loader auto-starts clips; take control before anything is visible.
    for (const g of scene.animationGroups) g.stop();

    const root = new BABYLON.TransformNode('figure', scene);
    const drawable = result.meshes.filter((m) => m.getTotalVertices() > 0);
    for (const m of result.meshes) {
      if (!m.parent) m.parent = root;
      m.receiveShadows = true;
    }
    for (const m of drawable) stage.shadows.addShadowCaster(m);

    standOnBase(root, drawable, 0.06);

    const bar = document.getElementById('clips');
    const mapped = new Set();
    for (const s of STAGES) {
      if (scene.animationGroups.some((g) => g.name === s.clip)) {
        addButton(bar, s.label, s.clip);
        mapped.add(s.clip);
      }
    }
    for (const g of scene.animationGroups) {
      if (!mapped.has(g.name)) addButton(bar, g.name.replace(/_/g, ' '), g.name, true);
    }

    const wanted = params.get('clip');
    const first = wanted && scene.animationGroups.some((g) => g.name === wanted) ? wanted : 'Idle';
    play(first);
    const match = [...bar.children].find((b) => b.dataset.clip === first);
    if (match) match.classList.add('on');

    document.getElementById('count').textContent =
      `${scene.animationGroups.length} animations · CC0 Quaternius`;

    if (params.has('debug')) window.__soldier = { scene, engine, stage, root, result };
  })
  .catch((err) => {
    console.error('[soldier] model load failed:', err);
    document.getElementById('count').textContent = 'model failed to load';
  });

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
attachTurntable({ scene, camera: stage.camera, canvas });
