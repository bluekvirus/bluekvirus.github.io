import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';
import { createDirector, MISSION_LIMIT } from '../sim/director.js';
import { createSquad, SQUAD } from '../sim/squad.js';

const build = (seed, rooms = 10) => {
  const plan = generateFloorplan(seed, { targetRooms: rooms });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, squad: createSquad(plan) };
};

const objectiveFor = (plan, cellId, kind = 'clear') => {
  const c = plan.cells.find((x) => x.id === cellId);
  return { kind, cellId, point: { x: c.x + c.w / 2, z: c.z + c.d / 2 } };
};

test('every living member is given a goal', () => {
  const { plan, mission, world, squad } = build('goals');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  for (let i = 0; i < 30; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const swat = world.agents.filter((a) => a.role === 'swat' && a.alive);
  assert.ok(swat.every((a) => a.goal !== null || a.path !== null),
    'a living squad member has no goal at all');
});

test('a dead member is never given a goal', () => {
  const { plan, mission, world, squad } = build('dead-goal');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const victim = world.agents.find((a) => a.role === 'swat');
  victim.hp = 0; victim.alive = false;
  for (let i = 0; i < 60; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  assert.equal(victim.path, null, 'a corpse was issued a path');
  assert.equal(victim.goal, null);
});

test('members converge on the objective cell', () => {
  const { plan, mission, world, squad } = build('converge');
  const target = plan.cells.find((c) => c.id !== mission.entryId && c.kind === 'room').id;
  const cell = plan.cells.find((c) => c.id === target);
  const centre = { x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 };
  const before = Math.min(...world.agents.filter((a) => a.role === 'swat')
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  for (let i = 0; i < 2400; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const after = Math.min(...world.agents.filter((a) => a.role === 'swat' && a.alive)
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  assert.ok(after < before - 1,
    `nearest member went from ${before.toFixed(1)}m to ${after.toFixed(1)}m — the squad did not advance`);
});

test('a badly hurt member falls back instead of advancing', () => {
  const { plan, mission, world, squad } = build('fallback');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const cell = plan.cells.find((c) => c.id === target);
  const centre = { x: cell.x + cell.w / 2, z: cell.z + cell.d / 2 };
  const hurt = world.agents.find((a) => a.role === 'swat');
  const healthy = world.agents.filter((a) => a.role === 'swat' && a.id !== hurt.id);
  hurt.hp = 1;
  for (let i = 0; i < 1800; i++) { world.tick(); squad.update(world, objectiveFor(plan, target)); }
  const hurtDist = Math.hypot(hurt.x - centre.x, hurt.z - centre.z);
  const bestHealthy = Math.min(...healthy.filter((a) => a.alive)
    .map((a) => Math.hypot(a.x - centre.x, a.z - centre.z)));
  assert.ok(hurtDist > bestHealthy,
    `the wounded member (${hurtDist.toFixed(1)}m) is no further from the objective than the healthiest (${bestHealthy.toFixed(1)}m)`);
  // A corpse frozen mid-approach can ALSO end up further from the objective
  // than a healthy member that fully arrived, which would satisfy the
  // assertion above for the wrong reason — the fix never ran, the agent just
  // died before getting there. hp=1 pulled toward the fight (no fallback)
  // dies to the first hit; pulled clear of it (real fallback), it survives
  // this seed's whole run. Surviving is therefore direct evidence the
  // fallback logic — not a lucky corpse position — is what kept it back.
  assert.equal(hurt.alive, true,
    'the wounded member did not survive to fall back — it advanced into the fight and was killed');
});

test('SQUAD constants are frozen', () => {
  assert.throws(() => { SQUAD.fallbackHealth = 1; });
});

test('the squad is deterministic', () => {
  const a = build('determinism');
  const b = build('determinism');
  const t = a.plan.cells.find((c) => c.id !== a.mission.entryId).id;
  for (let i = 0; i < 900; i++) {
    a.world.tick(); a.squad.update(a.world, objectiveFor(a.plan, t));
    b.world.tick(); b.squad.update(b.world, objectiveFor(b.plan, t));
  }
  assert.equal(a.world.hash(), b.world.hash());
});

// --- Findings (a) and (b) from Task 2's reviews, verified directly. ---

test('an objective centred on a blocked cell still gets the squad moving', () => {
  const { plan, mission, world, squad } = build('blocked-centre');
  const target = plan.cells.find((c) => c.id !== mission.entryId && c.kind === 'room').id;
  const objective = objectiveFor(plan, target);

  // Force the objective's exact cell centre — AND the whole ring each
  // member's slotPoint spreads out to (SQUAD.spread = 1.1m) — to be blocked
  // navgrid cells. Blocking only the single centre cell is not enough to
  // exercise the fallback: every member's actual destination sits 1.1m off
  // that centre, so it lands in a different, unblocked cell almost by
  // construction and the fallback is never called on to do anything. A 2m
  // blocked disc comfortably covers that whole spread, so every member's
  // slot point — not just the shared centre — is genuinely unreachable
  // without a walkable-point fallback stepping outside it.
  //
  // This is the scenario measured across 200 director plans (129 of 2400
  // cell centres, 48% of plans affected): without a fallback, world.setGoal
  // returns false for every one of these points on every tick and the squad
  // never gets a path at all.
  const centreCell = world.grid.worldToCell(objective.point.x, objective.point.z);
  const radius = 2.0;
  const spanCells = Math.ceil(radius / world.grid.cell) + 1;
  for (let dr = -spanCells; dr <= spanCells; dr++) {
    for (let dc = -spanCells; dc <= spanCells; dc++) {
      const col = centreCell.col + dc;
      const row = centreCell.row + dr;
      if (!world.grid.inBounds(col, row)) continue;
      const cellCentre = world.grid.cellToWorld(col, row);
      if (Math.hypot(cellCentre.x - objective.point.x, cellCentre.z - objective.point.z) <= radius) {
        world.grid.blocked[world.grid.index(col, row)] = 1;
      }
    }
  }
  assert.ok(world.grid.isBlocked(centreCell.col, centreCell.row), 'test setup: cell was not actually blocked');
  assert.ok(radius > SQUAD.spread, 'test setup: blocked disc does not cover the slot spread');

  for (let i = 0; i < 120; i++) { world.tick(); squad.update(world, objective); }

  const swat = world.agents.filter((a) => a.role === 'swat' && a.alive);
  assert.ok(swat.every((a) => a.path !== null),
    'a squad member was never routed once its destination cell centre was blocked');
});

test('the squad runs while clearing and walks while escorting', () => {
  const { plan, mission, world, squad } = build('speed');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;

  world.tick();
  squad.update(world, objectiveFor(plan, target, 'clear'));
  const swatRunning = world.agents.filter((a) => a.role === 'swat' && a.alive);
  assert.ok(swatRunning.every((a) => a.wants === SIM.runSpeed),
    'a squad member did not run while clearing');

  world.tick();
  squad.update(world, objectiveFor(plan, target, 'extract'));
  const swatWalking = world.agents.filter((a) => a.role === 'swat' && a.alive);
  assert.ok(swatWalking.every((a) => a.wants === SIM.walkSpeed),
    'a squad member did not slow to a walk while escorting');
});

// --- Integration: director + squad driven together to a real resolution. ---
//
// All eight tests above hand-build the objective and never run the director
// itself, which is exactly why the fallback-during-extract deadlock (a hurt
// member walking away from the exit forever, so the director's
// [...swat, hostage].every(within EXTRACT_RADIUS) check can never pass) was
// invisible to this file: nothing ever drove a mission all the way to
// 'extract' with a damaged member aboard. 'squad-int-2' is a fixed,
// deterministic seed on which a member takes damage during the run and the
// mission used to time out under the pre-fix fallback rule (confirmed by
// direct measurement against the pre-fix squad.js — see task-3-report.md).
test('a mission with a damaged member does not time out', () => {
  const plan = generateFloorplan('squad-int-2', { targetRooms: 10 });
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  const director = createDirector(plan, mission);
  const squad = createSquad(plan);

  let ticks = 0;
  let anyDamaged = false;
  const ceiling = MISSION_LIMIT + 100; // safety margin only; the director's
  // own clock (MISSION_LIMIT) is what actually ends a genuinely hung run.
  while (director.result === null && ticks < ceiling) {
    world.tick();
    director.update(world);
    squad.update(world, director.objective);
    if (world.agents.some((a) => a.role === 'swat' && a.alive && a.hp < a.hpMax)) anyDamaged = true;
    ticks++;
  }

  assert.ok(anyDamaged, 'test setup: no squad member ever took damage on this seed');
  assert.notEqual(director.result, null, 'the mission never resolved at all within the safety margin');
  assert.ok(!(director.result === 'failed' && director.reason === 'timeout'),
    `the mission timed out with a damaged member aboard (${ticks} ticks) — a hurt member likely stranded the squad`);
});

// --- The fallback rule cannot strand the mission. ---

test('a badly hurt member does not fall back while extracting', () => {
  const { plan, mission, world, squad } = build('extract-no-fallback');
  const exit = mission.spawns.extraction;
  const objective = { kind: 'extract', cellId: mission.entryId, point: exit };

  const hurt = world.agents.find((a) => a.role === 'swat');
  const healthy = world.agents.filter((a) => a.role === 'swat' && a.id !== hurt.id);

  const before = Math.hypot(hurt.x - exit.x, hurt.z - exit.z);
  for (let i = 0; i < 1200; i++) {
    world.tick();
    // Force it below the fallback threshold every tick, isolating this
    // check from whatever combat happens to do to its hp on this seed.
    if (hurt.alive) hurt.hp = 5;
    squad.update(world, objective);
  }
  const after = Math.hypot(hurt.x - exit.x, hurt.z - exit.z);

  assert.ok(hurt.hp <= hurt.hpMax * SQUAD.fallbackHealth, 'test setup: member was not actually hurt');
  assert.ok(after < before - 1,
    `a hurt member (${before.toFixed(1)}m -> ${after.toFixed(1)}m) did not advance toward extraction`);
  // Not merely "did not get further away" — genuinely converging alongside
  // the rest of the squad, the same distance a healthy member closes.
  const healthyAfter = Math.min(...healthy.filter((a) => a.alive)
    .map((a) => Math.hypot(a.x - exit.x, a.z - exit.z)));
  assert.ok(after < healthyAfter + 3,
    `the hurt member (${after.toFixed(1)}m) fell far behind the healthy members (${healthyAfter.toFixed(1)}m) during extraction`);
});

test('a hurt member rejoins the advance once its fallback window expires', () => {
  const { plan, mission, world, squad } = build('fallback-window');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const objective = objectiveFor(plan, target);

  const hurt = world.agents.find((a) => a.role === 'swat');
  // Force it below threshold for the whole run, isolating the bounded-window
  // mechanic from combat variance the same way the test above does.
  for (let i = 0; i < SQUAD.fallbackTicks - 1; i++) {
    world.tick();
    if (hurt.alive) hurt.hp = 5;
    squad.update(world, objective);
  }
  // Still comfortably inside the window: should be holding well clear of the
  // objective, not converging on it, exactly like the six-test suite above
  // already establishes for a member that never rejoins.
  const stillFallenBack = Math.hypot(hurt.x - objective.point.x, hurt.z - objective.point.z);

  const before = Math.hypot(hurt.x - objective.point.x, hurt.z - objective.point.z);
  for (let i = 0; i < 1200; i++) {
    world.tick();
    if (hurt.alive) hurt.hp = 5;
    squad.update(world, objective);
  }
  const after = Math.hypot(hurt.x - objective.point.x, hurt.z - objective.point.z);

  assert.ok(stillFallenBack > 3, 'test setup: member was not actually holding back before the window expired');
  assert.ok(after < before - 1,
    `a member still at hp=5 did not resume advancing once its fallback window expired (${before.toFixed(1)}m -> ${after.toFixed(1)}m)`);
});

test('two members below the fallback threshold get distinct rear positions', () => {
  const { plan, mission, world, squad } = build('fallback-spread');
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const objective = objectiveFor(plan, target);

  const swat = world.agents.filter((a) => a.role === 'swat');
  swat[0].hp = 5;
  swat[1].hp = 5;

  for (let i = 0; i < 60; i++) { world.tick(); squad.update(world, objective); }

  assert.ok(swat[0].goal && swat[1].goal, 'test setup: both hurt members need a goal to compare');
  const d = Math.hypot(swat[0].goal.x - swat[1].goal.x, swat[0].goal.z - swat[1].goal.z);
  assert.ok(d > 0.5,
    `two hurt members were issued the same rear point (${d.toFixed(3)}m apart) — the fallback branch collapsed the slot spread`);
});

// --- Re-issuing is throttled: at most one setGoal per tick, and an arrived
// member is not re-issued forever. ---

test('at most one setGoal call is issued per tick', () => {
  const { plan, mission, world, squad } = build('one-per-tick', 12);
  const target = plan.cells.find((c) => c.id !== mission.entryId).id;
  const objective = objectiveFor(plan, target);

  const originalSetGoal = world.setGoal;
  let callsThisTick = 0;
  let maxPerTick = 0;
  world.setGoal = (id, point) => { callsThisTick++; return originalSetGoal(id, point); };

  for (let i = 0; i < 200; i++) {
    callsThisTick = 0;
    world.tick();
    squad.update(world, objective);
    maxPerTick = Math.max(maxPerTick, callsThisTick);
  }
  assert.ok(maxPerTick <= 1, `${maxPerTick} setGoal calls landed in a single tick — issuing is not staggered`);
});

test('an arrived member is not re-issued a fresh goal every tick', () => {
  const { plan, mission, world, squad } = build('settle');
  const target = plan.cells.find((c) => c.id !== mission.entryId && c.kind === 'room').id;
  const objective = objectiveFor(plan, target);

  // Long enough for every member to actually arrive and settle at its slot
  // point (see the "members converge" test above for the same order of
  // magnitude).
  for (let i = 0; i < 2400; i++) { world.tick(); squad.update(world, objective); }

  const originalSetGoal = world.setGoal;
  let calls = 0;
  world.setGoal = (id, point) => { calls++; return originalSetGoal(id, point); };
  for (let i = 0; i < 300; i++) { world.tick(); squad.update(world, objective); }

  assert.ok(calls <= 1,
    `${calls} setGoal calls over 300 ticks with a settled squad and an unchanged objective — reissuing is not throttled on arrival`);
});
