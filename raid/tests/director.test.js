import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createDirector, MISSION_LIMIT } from '../sim/director.js';

const build = (seed, rooms = 10) => {
  const plan = generateFloorplan(seed, { targetRooms: rooms });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, director: createDirector(plan, mission) };
};

test('a fresh director is searching with no result', () => {
  const { director } = build('fresh');
  assert.equal(director.phase, 'search');
  assert.equal(director.result, null);
  assert.equal(director.reason, null);
  assert.equal(director.hostageReached, false);
});

test('the objective names a real cell to clear', () => {
  const { plan, world, director } = build('objective');
  director.update(world);
  const o = director.objective;
  assert.equal(o.kind, 'clear');
  const cell = plan.cells.find((c) => c.id === o.cellId);
  assert.ok(cell, 'objective cell is not in the plan');
  assert.ok(Number.isFinite(o.point.x) && Number.isFinite(o.point.z));
  // Task 3's squad routes on `objective.point` and ignores `cellId` -- a
  // point that names a real room while sitting somewhere else entirely
  // (the front door, say) would pass the two assertions above while sending
  // the squad nowhere near the room it claims to be clearing. Pin the point
  // to the cell's own centre, which is what `centreOf` in director.js
  // actually computes.
  const centreX = cell.x + cell.w / 2;
  const centreZ = cell.z + cell.d / 2;
  assert.ok(Math.hypot(o.point.x - centreX, o.point.z - centreZ) < 1,
    `objective.point (${o.point.x}, ${o.point.z}) is not near cell ${o.cellId}'s centre (${centreX}, ${centreZ})`);
});

test('a wiped squad fails as squad-lost, not as a timeout', () => {
  const { world, director } = build('wipe');
  for (let i = 0; i < 60; i++) director.update(world);
  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.hp = 0; a.alive = false; }
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'squad-lost');
});

test('a dead hostage fails as hostage-killed', () => {
  const { world, director } = build('hostage-dead');
  for (let i = 0; i < 60; i++) director.update(world);
  const hostage = world.agents.find((a) => a.role === 'hostage');
  hostage.hp = 0; hostage.alive = false;
  let ticks = 0;
  while (director.result === null && ticks < 3000) { world.tick(); director.update(world); ticks++; }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'hostage-killed');
});

test('the mission clock fails as timeout and cannot be outrun', () => {
  // Freeze every agent so nothing can ever progress. Without a clock this
  // would run forever -- which is exactly the guarantee orders.js's leg
  // watchdogs used to provide and which this replaces.
  const { world, director } = build('timeout');
  const frozen = world.agents.map((a) => ({ x: a.x, z: a.z }));
  let ticks = 0;
  while (director.result === null && ticks < MISSION_LIMIT + 600) {
    world.tick();
    world.agents.forEach((a, i) => { a.x = frozen[i].x; a.z = frozen[i].z; });
    director.update(world);
    ticks++;
  }
  assert.equal(director.result, 'failed');
  assert.equal(director.reason, 'timeout');
  assert.ok(ticks <= MISSION_LIMIT + 1,
    `the clock let the mission run ${ticks} ticks past its ${MISSION_LIMIT} limit`);
});

test('visited grows as the squad enters cells and never shrinks', () => {
  const { world, director } = build('visited');
  // Nothing gives squad members goals at this stage (Task 3 does); set one
  // manually here so members actually move and can be observed entering cells.
  for (const a of world.agents.filter((x) => x.role === 'swat')) {
    const other = world.agents.find((x) => x.role === 'hostage');
    world.setGoal(a.id, { x: other.x, z: other.z });
  }
  let previous = 0;
  for (let i = 0; i < 1200; i++) {
    world.tick(); director.update(world);
    assert.ok(director.visited.size >= previous, 'visited shrank');
    previous = director.visited.size;
  }
  assert.ok(director.visited.size >= 1, 'the squad never registered entering any cell');
});

// The "stay in their own room" half is migrated from orders.test.js's
// "hostiles move but stay in their own room". Patrol moved wholesale out of
// orders.js into director.js at the cutover, and a patrol that wanders a
// hostile out of its assigned room is a different defect from one that never
// moves it at all — the old test checked both every tick, and dropping the
// containment half would have retired a guarantee rather than migrated it.
test('hostiles still patrol, and stay in their own room while doing it', () => {
  const { plan, mission, world, director } = build('patrol');
  const byId = new Map(plan.cells.map((c) => [c.id, c]));
  const homes = new Map(world.agents.filter((a) => a.role === 'hostile')
    .map((a, i) => [a.id, byId.get(mission.spawns.hostiles[i].cellId)]));
  const start = world.agents.filter((a) => a.role === 'hostile').map((a) => ({ id: a.id, x: a.x, z: a.z }));
  // 2400 ticks, matching the reach orders.test.js's version had. The director
  // test around it ran 900, and shortening a migrated guarantee by 62% in the
  // one step whose whole purpose is "migration must not weaken" bought nothing
  // -- it passes identically at 2400.
  for (let i = 0; i < 2400; i++) {
    world.tick(); director.update(world);
    for (const a of world.agents.filter((x) => x.role === 'hostile')) {
      const home = homes.get(a.id);
      assert.ok(a.x >= home.x - 0.5 && a.x <= home.x + home.w + 0.5
        && a.z >= home.z - 0.5 && a.z <= home.z + home.d + 0.5,
        `hostile ${a.id} left its room at tick ${i}`);
    }
  }
  const moved = world.agents
    .filter((a) => a.role === 'hostile' && a.alive)
    .filter((a) => {
      const s = start.find((p) => p.id === a.id);
      return Math.hypot(a.x - s.x, a.z - s.z) > 0.5;
    });
  assert.ok(moved.length >= 2, `only ${moved.length} hostiles moved — patrol did not survive the move out of orders.js`);
});

test('the director is deterministic', () => {
  const a = build('determinism');
  const b = build('determinism');
  for (let i = 0; i < 900; i++) {
    a.world.tick(); a.director.update(a.world);
    b.world.tick(); b.director.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.director.phase, b.director.phase);
});

// Regression, migrated from dryrun.test.js at Task 2 review.
//
// `nextRoom` deliberately never returns the cell the squad is already
// standing in (see search.js). The director marks a cell visited only once a
// member has come within RESCUE_SIGHT (4m) of its CENTRE, and room diagonals
// run far past that. Those two rules combined can let the search declare
// itself exhausted while the squad is standing INSIDE the one remaining
// unsearched cell, just not close enough to its centre yet: `nextRoom`
// correctly reports "nowhere else to go" (it never offers `from`), and the
// naive reading of that — "every cell is visited" — is wrong, because the
// cell the squad occupies was never actually checked off. The fix at
// director.js:239 (`if (state.targetCell === -1 && !state.visited.has(from))
// state.targetCell = from;`) re-targets that cell instead of concluding the
// search is over.
//
// First caught on seed `widestall-11-14` at tick 2186 (see git history for
// the incident) and guarded there for a while, but a fixed seed only
// exercises this by the accident of its floorplan and combat outcome. A
// Task-2 combat retune produced a replacement seed that LOOKED right (a squad
// member sat in the last unvisited cell, off-centre, for over a hundred
// ticks) but never actually forced `nextRoom` to return -1 while `from` was
// unvisited, so deleting line 239 left that seed's mission byte-identical —
// an unguarded regression test that read as green. Two combat tasks in a row
// stranding the same fixed-seed test, and Tasks 3-5 are all combat tasks too,
// is what moved this here: hand-building the exact state the exhaustion
// branch needs is immune to every future retune, because it never runs a
// fight at all.
test('the search re-targets its own cell when it is the only one left unvisited', () => {
  const { plan, mission, world, director } = build('search-exhaustion', 10);
  const hostage = world.agents.find((a) => a.role === 'hostage');

  // Any cell other than the hostage's own room: placing the squad in the
  // hostage's room would trip the `seen` (RESCUE_SIGHT-to-the-hostage) branch
  // ahead of the exhaustion check this test targets, and this test needs
  // that check to NOT fire so the exhaustion path is the one under test.
  const cell = plan.cells.find((c) => c.id !== mission.hostageRoomId);
  assert.ok(cell, 'test setup: this plan has no cell other than the hostage room');

  // Every SWAT member stands well inside `cell`, near a corner rather than
  // its centre — inside the room (so it is genuinely "the cell the squad
  // occupies"), but far enough from the centre that `markVisited` has NOT
  // already marked it (director.js's RESCUE_SIGHT gate) when `update` runs.
  // That gap between "standing in it" and "seen into it" is exactly what
  // director.js:239 exists to close.
  const centre = { x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 };
  const px = cell.x + 0.5;
  const pz = cell.z + 0.5;
  const distToCentre = Math.hypot(px - centre.x, pz - centre.z);
  assert.ok(distToCentre > 4,
    `test setup: (${px}, ${pz}) is only ${distToCentre.toFixed(2)}m from cell ${cell.id}'s centre, needs to clear RESCUE_SIGHT (4m)`);
  const distToHostage = Math.hypot(px - hostage.x, pz - hostage.z);
  assert.ok(distToHostage >= 4,
    'test setup: the synthetic squad position is within RESCUE_SIGHT of the hostage');

  for (const a of world.agents.filter((x) => x.role === 'swat')) { a.x = px; a.z = pz; }

  // Every OTHER cell is already "searched" — `cell` (the one the squad is
  // standing in) is the sole exception. `director.visited` is a live Set
  // reference, not a copy, so mutating it here reaches into the director's
  // real state exactly as if the squad had genuinely swept everywhere else.
  for (const c of plan.cells) if (c.id !== cell.id) director.visited.add(c.id);

  director.update(world);

  assert.equal(director.phase, 'search',
    'the director gave up and switched to extract with an unsearched cell still under its feet');
  assert.equal(director.objective.cellId, cell.id,
    `the director should re-target its own cell (${cell.id}) rather than decide the search is over (got cellId ${director.objective.cellId})`);
});
