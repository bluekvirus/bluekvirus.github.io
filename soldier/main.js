import { createStage, attachTurntable, standOnBase } from './stage.js';
import { createReloadClip } from './reload.js';
import { createWeapon, GUN_CLIPS } from './weapon.js';
import { CHARACTERS, DEFAULT_CHARACTER, byId } from './characters.js';
import { createMelee, MELEE_ITEMS, MELEE_CLIPS } from './melee.js';

const ASSET_DIR = './assets/quaternius/';

// The roadmap's stages map onto the pack's animation set. This order is the
// order the picker lists them in; anything in the file not named here is
// appended afterwards so nothing is hidden.
const STAGES = [
  { label: 'Idle', clip: 'Idle' },
  { label: 'Hold gun', clip: 'Idle_Gun' },
  { label: 'Aim', clip: 'Idle_Gun_Pointing' },
  { label: 'Reload', clip: 'Reload' },
  { label: 'Walk', clip: 'Walk' },
  { label: 'Run', clip: 'Run' },
  { label: 'Run + fire', clip: 'Run_Shoot' },
  { label: 'Shoot', clip: 'Gun_Shoot' },
  { label: 'Punch', clip: 'Punch_Right' },
  { label: 'Kick', clip: 'Kick_Right' },
  { label: 'Roll', clip: 'Roll' },
  { label: 'Take hit', clip: 'HitRecieve' },
  { label: 'Death', clip: 'Death' },
  { label: 'Melee ready', clip: 'Idle_Sword' },
  { label: 'Slash', clip: 'Sword_Slash' },
];

const canvas = document.getElementById('view');
const engine = new BABYLON.Engine(canvas, true, { antialias: true, stencil: false });
const scene = new BABYLON.Scene(engine);

const stage = createStage({ scene, engine, canvas });
const params = new URLSearchParams(location.search);

const clipBar = document.getElementById('clips');
const castBar = document.getElementById('cast');
const gearBar = document.getElementById('gear');
const countEl = document.getElementById('count');

// Everything belonging to the character currently on the plinth. Swapping
// characters disposes this wholesale, so no animation or mesh state leaks
// between them.
let figure = null;
let current = null; // active AnimationGroup
let wantedClip = params.get('clip') || 'Idle';
let meleeKind = params.get('melee') || 'bat';

function play(name) {
  const group = scene.animationGroups.find((g) => g.name === name);
  if (!group) return false;
  if (current && current !== group) current.stop();
  group.start(true, 1.0, group.from, group.to, false);
  current = group;
  wantedClip = name;
  // Hands follow the clip: pistol for gun clips, melee item for sword clips.
  const wantGun = GUN_CLIPS.has(name) && !!figure?.meta.armed;
  const wantMelee = MELEE_CLIPS.has(name);
  figure?.weapon.setDrawn(wantGun && figure.weapon.meshes.length > 0);
  // Characters whose mesh ships no pistol borrow the procedural one, held in
  // the same hand rig as the melee items.
  if (figure?.melee) {
    const needsStandIn = wantGun && figure.weapon.meshes.length === 0;
    figure.melee.setItem(needsStandIn ? 'pistol' : (wantMelee ? meleeKind : figure.melee.kind));
    figure.melee.setVisible(needsStandIn || wantMelee);
  }
  for (const el of clipBar.children) el.classList.toggle('on', el.dataset.clip === name);
  return true;
}

function addClipButton(label, clip, extra = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.clip = clip;
  if (extra) b.className = 'extra';
  b.addEventListener('click', () => play(clip));
  clipBar.appendChild(b);
}

// Gun clips are listed only for characters who carry a firearm — a farmer
// miming a pistol he doesn't hold reads as a bug, not a feature.
const isGunClip = (name) => GUN_CLIPS.has(name) || /gun|shoot/i.test(name);

function buildClipBar() {
  clipBar.textContent = '';
  const armed = !!figure?.meta.armed;
  const allowed = (name) => armed || !isGunClip(name);
  const mapped = new Set();
  for (const s of STAGES) {
    if (!allowed(s.clip)) continue;
    if (scene.animationGroups.some((g) => g.name === s.clip)) {
      addClipButton(s.label, s.clip);
      mapped.add(s.clip);
    }
  }
  for (const g of scene.animationGroups) {
    if (!mapped.has(g.name) && allowed(g.name)) {
      addClipButton(g.name.replace(/_/g, ' '), g.name, true);
    }
  }
}

// Tear the current figure down completely. This runs BEFORE the next import,
// not after: disposing every animation group in the scene once the new model
// has already registered its own would take the incoming clips with it.
function disposeFigure() {
  if (!figure) return;
  for (const g of scene.animationGroups.slice()) g.dispose();
  for (const m of figure.loaded.meshes.slice()) m.dispose(false, true);
  for (const s of figure.loaded.skeletons.slice()) s.dispose();
  figure.melee?.dispose();
  figure.root.dispose();
  figure = null;
  current = null;
}

let loadToken = 0;

async function loadCharacter(id) {
  const meta = byId(id) ?? byId(DEFAULT_CHARACTER);
  const token = ++loadToken;
  countEl.textContent = `loading ${meta.label}…`;
  for (const el of castBar.children) el.classList.toggle('on', el.dataset.char === meta.id);

  disposeFigure();
  const loaded = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, `${meta.id}.glb`, scene);
  // A newer click won the race while this file was downloading.
  if (token !== loadToken) {
    for (const g of loaded.animationGroups) g.dispose();
    for (const m of loaded.meshes) m.dispose(false, true);
    return;
  }

  // The loader auto-starts clips; take control before anything is visible.
  for (const g of scene.animationGroups) g.stop();

  const idleGun = scene.animationGroups.find((g) => g.name === 'Idle_Gun');
  if (idleGun) createReloadClip(scene, loaded.skeletons[0], idleGun);

  const root = new BABYLON.TransformNode(`figure_${meta.id}`, scene);
  const drawable = loaded.meshes.filter((m) => m.getTotalVertices() > 0);
  for (const m of loaded.meshes) {
    if (!m.parent) m.parent = root;
    m.receiveShadows = true;
  }
  for (const m of drawable) stage.shadows.addShadowCaster(m);

  const weapon = createWeapon(loaded);
  const melee = createMelee(scene, loaded);
  melee?.setItem(meleeKind);
  // Measure without the pistol so a drawn weapon held at arm's length can't
  // drag the figure off the plinth.
  standOnBase(root, drawable.filter((m) => !m.name.startsWith('Pistol')), 0.06);

  figure = { meta, loaded, root, weapon, melee };

  buildClipBar();
  const playable = (n) => scene.animationGroups.some((g) => g.name === n)
    && (meta.armed || !isGunClip(n));
  play(playable(wantedClip) ? wantedClip : 'Idle');

  countEl.textContent = `${meta.label} · ${scene.animationGroups.length} animations · CC0 Quaternius`;
  if (params.has('debug')) window.__soldier = { scene, engine, stage, figure, play, loadCharacter };
}

for (const item of MELEE_ITEMS) {
  const b = document.createElement('button');
  b.textContent = item.label;
  b.dataset.melee = item.id;
  b.addEventListener('click', () => {
    meleeKind = item.id;
    figure?.melee?.setItem(item.id);
    for (const el of gearBar.children) el.classList.toggle('on', el.dataset.melee === item.id);
    // Jump to a melee clip so the change is actually visible.
    if (!MELEE_CLIPS.has(wantedClip)) play('Idle_Sword');
  });
  if (item.id === meleeKind) b.classList.add('on');
  gearBar.appendChild(b);
}

for (const c of CHARACTERS) {
  const b = document.createElement('button');
  b.textContent = c.label;
  b.dataset.char = c.id;
  b.addEventListener('click', () => {
    if (figure?.meta.id !== c.id) loadCharacter(c.id).catch(reportFailure);
  });
  castBar.appendChild(b);
}

function reportFailure(err) {
  console.error('[soldier] load failed:', err);
  countEl.textContent = 'model failed to load';
}

loadCharacter(params.get('character') || DEFAULT_CHARACTER).catch(reportFailure);

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
attachTurntable({ scene, camera: stage.camera, canvas });
