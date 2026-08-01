import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, createCombat, isEnemy, hitChance } from '../sim/combat.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { makeRng } from '../rng.js';

// A bare 20x20 room with an optional blocking prop, and agents placed by hand.
// Combat is easier to test on geometry chosen for the test than on a generated
// map where "is there a wall between these two" is itself a question.
//
// `order`, if given, is an array of indices into `agents` describing the
// order in which those same objects are handed to `createCombat` — ids are
// still assigned by original position (so callers keep indexing the returned
// `agents` array by id), but the internal iteration order can be scrambled
// independently, to prove nothing relies on array position matching id.
const scene = (agents, placements = [], order) => {
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
  const ordered = order ? order.map((i) => full[i]) : full;
  const combat = createCombat({
    grid, agents: ordered, rng: makeRng('combat:test'),
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
  // Distance 8 — comfortably inside COMBAT.sightRange (12) — so the wall
  // itself, not the range check, is what has to stop acquisition.
  const positions = [{ role: 'swat', x: 2, z: 10 }, { role: 'hostile', x: 10, z: 10 }];
  // A full-height blocking prop across the middle of the room, between them.
  const wall = [{ x: 6, z: 10, w: 0.5, d: 20 }];

  const blocked = scene(positions, wall);
  for (let t = 0; t < COMBAT.scanInterval; t++) blocked.combat.step(t);
  assert.equal(blocked.agents[0].target, -1, 'acquired a target through a wall');

  // Positive control: identical positions, no wall. Without this half, a test
  // that never puts the target in line of sight in the first place (e.g. an
  // out-of-range fixture) would pass for the wrong reason — deleting the
  // `hasLineOfSight` call from `canTarget` entirely must NOT leave this test
  // green.
  const clear = scene(positions, []);
  for (let t = 0; t < COMBAT.scanInterval; t++) clear.combat.step(t);
  assert.equal(clear.agents[0].target, 1, 'failed to acquire a clearly visible enemy with no wall present');
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

test('a target already held on a hostage is dropped the instant it is recaptured', () => {
  // The captive rule is checked on acquisition AND every tick thereafter; the
  // realistic case is a hostile that already holds the (rescued) hostage as
  // its target when the hostage is recaptured mid-mission.
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2 },
    { role: 'hostage', x: 4, z: 2, weapon: 'none', captive: false },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1, 'did not acquire the rescued hostage as a target');

  agents[1].captive = true;
  // scanInterval + 1 is NOT congruent to the shooter's id (0) mod scanInterval
  // — see the tick choice below for why that matters.
  const nonScanTick = COMBAT.scanInterval + 1;
  combat.step(nonScanTick);
  assert.equal(agents[0].target, -1, 'kept targeting the hostage after it was recaptured');
});

test('a target is dropped the tick it becomes invalid, not at the next scan', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 5, z: 2 },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1);
  agents[1].alive = false;
  // scanInterval (6) is congruent to the shooter's id (0) mod scanInterval —
  // it is agent 0's own next scan tick, so stepping there cannot distinguish
  // "dropped every tick" from "dropped only on the next scan window", which
  // is exactly the bug this test exists to catch. scanInterval + 1 is NOT
  // congruent (1 !== 0 mod 6), so only a per-tick check can pass here.
  const nonScanTick = COMBAT.scanInterval + 1;
  combat.step(nonScanTick);
  assert.equal(agents[0].target, -1, 'kept firing at a corpse until its next scan window');
});

test('ties break on the lower id even when the agents array is not in ascending id order', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },      // id 0, the shooter
    { role: 'hostile', x: 5, z: 2 },   // id 1, distance 3
    { role: 'hostile', x: 2, z: 5 },   // id 2, distance 3 — an exact tie with id 1
  ], [], [2, 1, 0]); // handed to createCombat in DESCENDING id order
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1, 'did not break the distance tie on the lower id');
});

test('gun accuracy falls off with distance; melee does not', () => {
  const shooter = { role: 'swat', weapon: 'gun' };
  const point = hitChance(shooter, 0);
  const far = hitChance(shooter, COMBAT.gunRange);
  assert.equal(point, COMBAT.swatAccuracy);
  assert.ok(Math.abs(far - COMBAT.swatAccuracy * 0.5) < 1e-9,
    `at maximum range a shot should land half as often, got ${far}`);
  assert.equal(hitChance({ role: 'hostile', weapon: 'melee' }, 1), COMBAT.meleeAccuracy);
});

test('a gun agent in range whittles its target down and kills it', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
    { role: 'hostile', x: 5, z: 2, hp: COMBAT.hostileHp },
  ]);
  let tick = 0;
  while (agents[1].alive && tick < 6000) combat.step(tick++);
  assert.equal(agents[1].alive, false, 'the hostile survived 100 simulated seconds of fire');
  assert.equal(agents[1].hp, 0, 'hp should be clamped to exactly 0 on death, not left negative');
  assert.ok(agents[1].diedAt >= 0);
});

test('a gun never reaches past its range', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 1, z: 1 },
    // Inside sight range, outside gun range.
    { role: 'hostile', x: 1, z: 1 + (COMBAT.gunRange + COMBAT.sightRange) / 2, hp: COMBAT.hostileHp },
  ]);
  for (let t = 0; t < 3000; t++) combat.step(t);
  assert.ok(agents[0].target >= 0, 'the target should still be seen, just not shootable');
  assert.equal(agents[1].hp, COMBAT.hostileHp, 'took damage from beyond gun range');
});

test('a melee agent cannot strike from across the room', () => {
  // The swat is unarmed here on purpose: at distance 6 it sits comfortably
  // inside COMBAT.gunRange (10), so if it carried a gun it would shoot back
  // and could kill the hostile outright, which would make `chasing` false
  // for an unrelated reason (a dead agent chases nothing) and the test would
  // pass without ever exercising the melee-range check it's named for.
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 8, z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ]);
  for (let t = 0; t < 3000; t++) combat.step(t);
  assert.equal(agents[0].chasing, true, 'a melee agent with a target should be chasing it');
  assert.equal(agents[1].hp, COMBAT.swatHp, 'was struck from 6m away');
});

test('a melee agent in contact does damage', () => {
  // Unarmed swat again: distance 0.6 is inside gunRange too, so an armed swat
  // could shoot the hostile dead first and the loop would exit with the
  // hostile — not the swat — at 0 hp, proving nothing about melee.
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + COMBAT.meleeRange * 0.5, z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ]);
  for (let t = 0; t < 3000 && agents[1].alive; t++) combat.step(t);
  assert.equal(agents[1].alive, false, 'melee in contact range never killed anything');
});

test('nobody shoots through a closed door', () => {
  const plan = {
    seed: 'door-los', config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 12, d: 6 },
    cells: [{ id: 0, x: 0, z: 0, w: 5.5, d: 6 }, { id: 1, x: 6.5, z: 0, w: 5.5, d: 6 }],
    doors: [{ id: 0, x: 6, z: 3, axis: 'z', width: 1 }], adjacency: {}, walls: [],
  };
  const grid = buildNavGrid(plan, []);
  const mk = (id, role, x, z) => ({
    id, role, weapon: 'gun', x, z, vx: 0, vz: 0, speed: 0, facing: 0,
    hp: 100, alive: true, target: -1, chasing: false, cooldown: 0,
    firedAt: -1, hitAt: -1, diedAt: -1, captive: false,
    goal: null, path: null, pathIndex: 0, wants: 0,
  });
  const agents = [mk(0, 'swat', 3, 3), mk(1, 'hostile', 9, 3)];
  const shut = createCombat({ grid, agents, rng: makeRng('door'), isDoorOpen: () => false, step: 1 / 60 });
  for (let t = 0; t < 1200; t++) shut.step(t);
  assert.equal(agents[1].hp, 100, 'a bullet went through a closed door');
  assert.equal(agents[0].target, -1, 'acquired a target through a closed door');
});

test('combat is deterministic for a given seed', () => {
  const run = () => {
    const { agents, combat } = scene([
      { role: 'swat', x: 2, z: 2 },
      { role: 'hostile', x: 6, z: 3 },
      { role: 'hostile', x: 7, z: 2, weapon: 'melee' },
    ]);
    for (let t = 0; t < 2000; t++) combat.step(t);
    return agents.map((a) => `${a.id}:${a.hp}:${a.alive}:${a.target}`).join('|');
  };
  assert.equal(run(), run());
});
