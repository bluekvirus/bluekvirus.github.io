import { createStage } from './stage.js';
import { generateFloorplan } from './floorplan.js';
import { assignRoles } from './roles.js';
import { buildLevel } from './build.js';
import { layoutProps } from './furnish.js';
import { buildProps } from './props.js';
import { populate } from './cast.js';

const canvas = document.getElementById('view');
const engine = new BABYLON.Engine(canvas, true, { antialias: true, stencil: false });
const scene = new BABYLON.Scene(engine);
const stage = createStage({ scene, engine, canvas });

const params = new URLSearchParams(location.search);
const seedInput = document.getElementById('seed');
const roomsInput = document.getElementById('rooms');
const roomsValue = document.getElementById('roomsValue');
const statsEl = document.getElementById('stats');

if (params.get('seed')) seedInput.value = params.get('seed');

let plan = null;
let mission = null;
let level = null;
let props = null;
let cast = null;

function regenerate(seed = seedInput.value) {
  seedInput.value = seed;
  const targetRooms = Number(roomsInput.value);

  // Generation can legitimately throw: assertConnected (floorplan) and the
  // minimum-hostage-depth check (roles) both reject a bad plan by throwing
  // rather than quietly retrying. Do that work BEFORE touching anything on
  // screen, so a throw leaves the previously rendered map (and previous
  // plan/mission) completely alone instead of half-torn-down.
  const started = performance.now();
  let nextPlan, nextMission;
  try {
    nextPlan = generateFloorplan(seed, { targetRooms });
    nextMission = assignRoles(nextPlan);
  } catch (err) {
    console.error(err);
    statsEl.textContent = err.message;
    return;
  }
  plan = nextPlan;
  mission = nextMission;

  // Tear the previous build down first. Rebuilding over the top leaks a whole
  // level's meshes and materials on every click of Regenerate.
  level?.dispose();
  level = buildLevel(scene, plan, mission, stage.shadows);

  props?.dispose();
  props = buildProps(scene, layoutProps(plan, mission), stage.shadows);

  const elapsed = performance.now() - started;

  stage.frameOn(plan.bounds);

  const rooms = plan.cells.filter((c) => c.kind === 'room').length;
  statsEl.textContent =
    `${rooms} rooms · ${plan.doors.length} doors · hostage ${mission.depth[mission.hostageRoomId]} deep · ${elapsed.toFixed(1)}ms`;

  if (params.has('debug')) window.__raid = { scene, engine, stage, plan, mission, cast, regenerate };

  repopulate();
}

// A generation counter, not a boolean: clicking Regenerate twice quickly must
// not leave the first load's figures standing on the second load's map.
let castToken = 0;

async function repopulate() {
  const token = ++castToken;
  // `cast` is deliberately NOT cleared before the await. A second call would
  // then capture null as its "previous" and the original would never be
  // disposed — the winner must dispose whatever is genuinely live when it
  // settles, not a handle captured before it started loading.
  const next = await populate(scene, mission, stage.shadows);
  if (token !== castToken) { next.dispose(); return; }
  cast?.dispose();
  cast = next;
  if (params.has('debug')) window.__raid.cast = cast;
}

document.getElementById('regenerate').addEventListener('click', () => regenerate());
document.getElementById('shuffle').addEventListener('click', () => {
  regenerate(Math.random().toString(36).slice(2, 8));
});
roomsInput.addEventListener('input', () => {
  roomsValue.textContent = roomsInput.value;
  regenerate();
});
seedInput.addEventListener('change', () => regenerate());

regenerate();

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
