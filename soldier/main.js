import { createMaterials } from './palette.js';
import { createStage, standOnBase, attachTurntable } from './stage.js';
import { createSoldier, CATEGORIES } from './soldier.js';
import { LOADOUTS, ROSTER } from './loadouts.js';

const canvas = document.getElementById('view');
const engine = new BABYLON.Engine(canvas, true, { antialias: true, stencil: false });
const scene = new BABYLON.Scene(engine);
const mats = createMaterials(scene);

const params = new URLSearchParams(location.search);

// URL synonyms for the catalogue categories, so gear can be composed straight
// from the address bar: ?head=shemagh&eyewear=sunglasses&torso=bandolier&back=rpg
const PARAM_ALIASES = {
  headgear: ['headgear', 'head', 'helmet', 'hat'],
  facial: ['facial', 'face', 'beard'],
  eyewear: ['eyewear', 'glasses'],
  torso: ['torso', 'vest', 'rig'],
  back: ['back', 'pack'],
  weapon: ['weapon'],
};

/** Build a loadout from the URL: a named one, ad-hoc composition, or null (lineup). */
function loadoutFromParams() {
  const named = LOADOUTS[params.get('loadout')] ?? null;
  const loadout = named ? { ...named } : { body: 'regular', pose: 'idle' };

  let composed = false;
  for (const category of Object.keys(CATEGORIES)) {
    for (const alias of PARAM_ALIASES[category]) {
      const value = params.get(alias);
      if (value !== null) {
        loadout[category] = value;
        composed = true;
        break;
      }
    }
  }
  if (params.get('body')) {
    loadout.body = params.get('body');
    composed = true;
  }
  if (params.get('pose')) loadout.pose = params.get('pose');

  return (named || composed) ? loadout : null;
}

const SURFACE_Y = 0.06; // plinth top
const SPACING = 1.15; // lineup shoulder room

function addFigure(loadout, x = 0) {
  const soldier = createSoldier({ scene, mats, loadout });
  soldier.root.position.x = x;
  for (const m of soldier.meshes) {
    // Flat-shaded facets are the whole look — Babylon needs this per mesh.
    m.convertToFlatShadedMesh();
    stage.shadows.addShadowCaster(m);
    m.receiveShadows = true;
  }
  standOnBase(soldier.root, soldier.meshes, SURFACE_Y);
  return soldier;
}

const single = loadoutFromParams();
const stage = createStage({
  scene, engine, canvas, mats,
  lineup: single ? null : { width: ROSTER.length * SPACING + 0.9 },
});

const soldiers = [];
if (single) {
  soldiers.push(addFigure(single));
} else {
  for (const [i, name] of ROSTER.entries()) {
    // Negative spacing: the camera sits on +Z, so +X is screen-left.
    soldiers.push(addFigure(LOADOUTS[name], ((ROSTER.length - 1) / 2 - i) * SPACING));
  }
}

if (params.has('debug')) {
  window.__soldier = { scene, engine, stage, soldiers, soldier: soldiers[0] };
}

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
// The lineup stays put for side-by-side judging; a lone figure slowly turns.
if (single) attachTurntable({ scene, camera: stage.camera, canvas });
