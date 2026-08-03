import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';
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
