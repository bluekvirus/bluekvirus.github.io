import { createStage } from './stage.js';
import { generateFloorplan } from './floorplan.js';
import { assignRoles } from './roles.js';
import { buildLevel } from './build.js';
import { layoutProps } from './furnish.js';
import { buildProps } from './props.js';
import { populate } from './cast.js';
import { createWorld, SIM } from './sim/world.js';
import { createOrders } from './sim/orders.js';
import { bindDoors } from './doors.js';
import { bindAgents } from './agents.js';

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
let world = null;
let orders = null;
let agentBinding = null;
let doorBinding = null;

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

  const placements = layoutProps(plan, mission);
  props?.dispose();
  props = buildProps(scene, placements, stage.shadows);

  // The agent binding reads `cast`, which loads asynchronously (see
  // repopulate below) — it can only be torn down here, never rebuilt, so it
  // never goes on interpolating a world that is about to be replaced. It is
  // recreated once the matching cast has actually settled.
  agentBinding?.dispose();
  agentBinding = null;
  doorBinding?.dispose();
  world = createWorld(plan, mission, placements);
  orders = createOrders(plan, mission);
  doorBinding = bindDoors(scene, world, level.doorLeaves);
  accumulator = 0;

  const elapsed = performance.now() - started;

  stage.frameOn(plan.bounds);

  const rooms = plan.cells.filter((c) => c.kind === 'room').length;
  statsEl.textContent =
    `${rooms} rooms · ${plan.doors.length} doors · hostage ${mission.depth[mission.hostageRoomId]} deep · ${elapsed.toFixed(1)}ms`;

  if (params.has('debug')) window.__raid = { scene, engine, stage, plan, mission, cast, world, orders, sim: SIM, regenerate };

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
  // Only the winning load ever reaches here, so `world` is guaranteed to be
  // the generation this cast belongs to — a superseded call already bailed
  // out above without touching the binding.
  agentBinding?.dispose();
  agentBinding = bindAgents(scene, world, cast, orders, level.agentDiscs);
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

const playPauseBtn = document.getElementById('playPause');
const speedInput = document.getElementById('speed');
const speedValueEl = document.getElementById('speedValue');

const SPEEDS = [0.5, 1, 2, 4];
let running = true;
let accumulator = 0;
let lastFrame = performance.now();

playPauseBtn.addEventListener('click', () => {
  running = !running;
  playPauseBtn.textContent = running ? 'Pause' : 'Play';
});

document.getElementById('stepOnce').addEventListener('click', () => {
  if (!world) return;
  agentBinding?.snapshot();
  world.tick();
  orders.update(world);
  // Land exactly on the new state (alpha = 1) instead of the interpolated
  // midpoint the accumulator would otherwise leave behind, so one Step click
  // is visibly one whole tick rather than a fraction of one.
  accumulator = SIM.step;
});

speedInput.addEventListener('input', () => {
  speedValueEl.textContent = `${SPEEDS[Number(speedInput.value)]}×`;
});

function advance(dt) {
  accumulator += dt;
  let steps = 0;
  // Cap the catch-up. Without this, a backgrounded tab returns with seconds of
  // accumulated time and the simulation freezes the page trying to run it all.
  while (accumulator >= SIM.step && steps < 8) {
    agentBinding?.snapshot();
    world.tick();
    orders.update(world);
    accumulator -= SIM.step;
    steps++;
  }
  // If the cap above was what stopped the loop, there can still be a whole
  // step or more banked. sync()'s alpha (agents.js) is documented as 0..1 —
  // a 0.25s frame at 4x speed leaves ~0.87s banked here, which would hand
  // sync() alpha ~52 and extrapolate figures more than a metre past their
  // real targets for several frames. The sim is already as far behind as
  // this frame is willing to make it catch up, so dropping the remainder is
  // correct: replaying it would only take more ticks away from later frames
  // and make the stutter worse, not better.
  if (accumulator >= SIM.step) accumulator = 0;
}

regenerate();

engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (running && world) advance(dt * SPEEDS[Number(speedInput.value)]);
  agentBinding?.sync(world ? accumulator / SIM.step : 0, dt);
  doorBinding?.sync();
  scene.render();
});
window.addEventListener('resize', () => engine.resize());
