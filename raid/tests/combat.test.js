import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, createCombat, isEnemy } from '../sim/combat.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { makeRng } from '../rng.js';

// A bare 20x20 room with an optional blocking prop, and agents placed by hand.
// Combat is easier to test on geometry chosen for the test than on a generated
// map where "is there a wall between these two" is itself a question.
const scene = (agents, placements = []) => {
  const plan = {
    seed: 'combat', config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 20, d: 20 },
    cells: [{ id: 0, x: 0, z: 0, w: 20, d: 20 }],
    doors: [], adjacency: {}, walls: [],
  };
  const grid = buildNavGrid(plan, placements);
  const full = agents.map((a, i) => ({
    id: i, role: a.role, weapon: a.weapon ?? 'gun',
    x: a.x, z: a.z, vx: 0, vz: 0, speed: 0, facing: 0,
    hp: a.hp ?? 100, alive: a.alive ?? true, target: -1, chasing: false,
    cooldown: 0, firedAt: -1, hitAt: -1, diedAt: -1, captive: a.captive ?? false,
    goal: null, path: null, pathIndex: 0, wants: 0,
  }));
  const combat = createCombat({
    grid, agents: full, rng: makeRng('combat:test'),
    isDoorOpen: () => true, step: 1 / 60,
  });
  return { grid, agents: full, combat };
};

test('SWAT and hostiles are enemies; same side is not', () => {
  const a = { role: 'swat' }, b = { role: 'hostile' }, c = { role: 'swat' };
  assert.equal(isEnemy(a, b), true);
  assert.equal(isEnemy(b, a), true);
  assert.equal(isEnemy(a, c), false);
  assert.equal(isEnemy(a, a), false);
});

test('an agent acquires the nearest visible enemy', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 9, z: 2 },
    { role: 'hostile', x: 5, z: 2 },
  ]);
  // Scans are staggered, so run a full interval to guarantee everyone scanned.
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 2, 'did not pick the nearer of two visible hostiles');
});

test('a wall between two agents prevents acquisition', () => {
  // A full-height blocking prop across the middle of the room.
  const { agents, combat } = scene(
    [{ role: 'swat', x: 2, z: 10 }, { role: 'hostile', x: 18, z: 10 }],
    [{ x: 10, z: 10, w: 0.5, d: 20 }],
  );
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, -1, 'acquired a target through a wall');
});

test('a target beyond sight range is not acquired', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 1, z: 1 },
    { role: 'hostile', x: 1, z: 1 + COMBAT.sightRange + 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, -1);
});

test('a dead agent neither targets nor is targeted', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 4, z: 2, alive: false },
    { role: 'hostile', x: 6, z: 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 2, 'targeted a corpse instead of the live hostile behind it');
  assert.equal(agents[1].target, -1, 'a dead agent acquired a target');
});

test('a captive hostage is not shot at; a rescued one is', () => {
  const captive = scene([
    { role: 'hostile', x: 2, z: 2 },
    { role: 'hostage', x: 4, z: 2, weapon: 'none', captive: true },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) captive.combat.step(t);
  assert.equal(captive.agents[0].target, -1, 'a hostile shot at its own prisoner');

  const rescued = scene([
    { role: 'hostile', x: 2, z: 2 },
    { role: 'hostage', x: 4, z: 2, weapon: 'none', captive: false },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) rescued.combat.step(t);
  assert.equal(rescued.agents[0].target, 1, 'a hostile ignored the hostage being walked out');
});

test('a target is dropped the tick it becomes invalid, not at the next scan', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 5, z: 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1);
  agents[1].alive = false;
  combat.step(COMBAT.scanInterval);
  assert.equal(agents[0].target, -1, 'kept firing at a corpse until its next scan window');
});
