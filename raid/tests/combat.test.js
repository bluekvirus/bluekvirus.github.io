import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT, createCombat, isEnemy, hitChance, evasionOf } from '../sim/combat.js';
import { buildNavGrid } from '../sim/navgrid.js';
import { makeRng } from '../rng.js';
import { SIM } from '../sim/world.js';

// A bare 20x20 room with an optional blocking prop, and agents placed by hand.
// Combat is easier to test on geometry chosen for the test than on a generated
// map where "is there a wall between these two" is itself a question.
//
// `order`, if given, is an array of indices into `agents` describing the
// order in which those same objects are handed to `createCombat` — ids are
// still assigned by original position (so callers keep indexing the returned
// `agents` array by id), but the internal iteration order can be scrambled
// independently, to prove nothing relies on array position matching id.
// `speeds`, if given, overrides `walkSpeed`, the one speed createCombat still
// takes as a constructor parameter (a melee agent's `a.wants` reads it while
// NOT chasing -- see combat.js) -- deliberately distinct from combat.js's own
// default (which mirrors SIM.walkSpeed) so a test asserting on it is proof the
// value actually came from this call's wiring, not a coincidental match with
// whatever combat.js falls back to on its own. There is no equivalent
// `runSpeed` override: a chasing melee agent's speed is `COMBAT.meleeChargeSpeed`,
// read directly rather than injected (see combat.js), so it cannot be
// overridden per-test and every assertion on it below checks that fixed
// constant instead of a test-local stand-in.
const scene = (agents, placements = [], order, speeds) => {
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
    hp: a.hp ?? 100, alive: a.alive ?? true, target: -1, chasing: false, sprinting: false,
    cooldown: 0, firedAt: -1, hitAt: -1, diedAt: -1, captive: a.captive ?? false,
    ammo: a.ammo ?? COMBAT.magazineSize, reloadUntil: a.reloadUntil ?? -1,
    goal: null, path: null, pathIndex: 0, wants: 0,
  }));
  const ordered = order ? order.map((i) => full[i]) : full;
  const combat = createCombat({
    grid, agents: ordered, rng: makeRng('combat:test'),
    isDoorOpen: () => true, step: 1 / 60,
    ...(speeds ?? {}),
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

  // Regression: `acquire()`'s own tie-break above is already order-agnostic
  // (it compares `b.id`, never array position), but `step()` used to resolve
  // a held target back to an object via `agents[a.target]` — indexing the
  // *scrambled* internal array by an id, silently assuming position equals
  // id. Under this exact [2, 1, 0] fixture that resolves id 0 (the target
  // both hostiles want) to whichever hostile happens to sit at position 0
  // internally — id 2 — so id 2 read itself back as its own target (and hit
  // itself for 25 the first time it fired) while id 1 read a fellow hostile
  // back as its target, and the SWAT itself was never actually fired upon by
  // either — invisible to the single assertion above, which never looked at
  // either hostile. Confirmed by direct instrumentation of this exact
  // fixture: under the bug, by t=39, the SWAT sits untouched at 100 hp, id 2
  // has taken one self-inflicted hit (100 -> 75), and both hostiles'
  // `target` are still flapping between 0 and -1 every few ticks (each
  // acquisition immediately invalidated the next tick, since resolving id 0
  // through the scrambled array hands `canTarget` a fellow hostile, and
  // `isEnemy` rejects same-side pairs) rather than settling. Fixed, the same
  // 39 ticks resolve id 0 through `byId` to the actual SWAT every time: both
  // hostiles hold a stable target on it, the SWAT (correctly fired upon by
  // id 1, which it is tied with) has taken its own hit down to 75, and id 2
  // — which the SWAT's tie-break never even targets — is never fired on by
  // anyone and sits untouched at 100.
  for (let t = COMBAT.scanInterval; t < 40; t++) combat.step(t);
  assert.equal(agents[1].target, 0, 'hostile id 1 did not resolve its target to the SWAT');
  assert.equal(agents[2].target, 0, 'hostile id 2 did not resolve its target to the SWAT');
  assert.equal(agents[2].hp, 100,
    'hostile id 2 took damage — nothing should ever fire on it in this fixture, so this is either self-inflicted or friendly fire');
  assert.equal(agents[0].hp, 75, 'the SWAT was never actually fired upon despite both hostiles holding a target on it');
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
    hp: 100, alive: true, target: -1, chasing: false, sprinting: false, cooldown: 0,
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

test('a target beyond chargeRange is acquired and held but not yet chased', () => {
  // Distance between chargeRange and sightRange: seen and held as a target
  // (proving acquisition itself is untouched -- still out to sightRange),
  // but not close enough to break into a charge.
  const dist = (COMBAT.chargeRange + COMBAT.sightRange) / 2;
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + dist, z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1, 'did not acquire a target it can clearly see within sightRange');
  assert.equal(agents[0].chasing, false,
    'started chasing a target from beyond chargeRange -- the gate did nothing');

  // Positive control: walk the same target inside chargeRange and confirm the
  // gate actually opens. Without this half, a chargeRange check that always
  // evaluates to false (e.g. a stray `&& false`) would pass the assertion
  // above for the wrong reason.
  agents[1].x = 2 + (COMBAT.chargeRange - 0.5);
  // scanInterval + 1 is not congruent to agent 0's id mod scanInterval (see
  // the identical reasoning in "a target is dropped the tick it becomes
  // invalid, not at the next scan" above) -- stepping here proves the
  // chasing flag is reevaluated every tick, not only at the next scan.
  combat.step(COMBAT.scanInterval + 1);
  assert.equal(agents[0].chasing, true,
    'still not chasing once the target closed inside chargeRange');
});

test('a chasing melee agent sprints at COMBAT.meleeChargeSpeed; a merely-holding one walks', () => {
  const WALK = 2; // distinct from combat.js's own SIM-mirroring default
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + (COMBAT.chargeRange + 2), z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ], [], undefined, { walkSpeed: WALK });

  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].target, 1, 'setup failed to acquire the target');
  assert.equal(agents[0].chasing, false, 'setup started already chasing -- proves nothing about the walk speed');
  assert.equal(agents[0].wants, WALK,
    'a melee agent holding a distant target (not yet chasing) should move at its patrol (walk) speed');

  // Bring the target inside chargeRange (but still outside the hold
  // threshold, meleeRange * 0.75 = 0.9m) and let the gate open.
  agents[1].x = 2 + (COMBAT.chargeRange - 0.5);
  combat.step(COMBAT.scanInterval + 1);
  assert.equal(agents[0].chasing, true, 'setup failed to enter the chasing state');
  assert.equal(agents[0].sprinting, true,
    'still well outside the meleeRange * 0.75 hold threshold -- should be sprinting');
  // COMBAT.meleeChargeSpeed, not an injected value: there is no constructor
  // override for a chasing melee agent's speed (see combat.js/scene()'s doc
  // comment) -- world.js's own movement math reads this same COMBAT constant
  // directly for a chasing melee agent, and `wants` must agree with it rather
  // than naming a different number nothing actually moves at.
  assert.equal(agents[0].wants, COMBAT.meleeChargeSpeed,
    'a chasing melee agent should move at COMBAT.meleeChargeSpeed, not its patrol speed');

  // And back off out of chargeRange: the sprint should drop away again, not
  // stick from whatever it was on the previous tick.
  agents[1].x = 2 + (COMBAT.chargeRange + 2);
  combat.step(COMBAT.scanInterval + 2);
  assert.equal(agents[0].chasing, false, 'target retreated out of chargeRange but chasing stayed true');
  assert.equal(agents[0].sprinting, false, 'stopped chasing but sprinting stayed true');
  assert.equal(agents[0].wants, WALK,
    'a melee agent that stopped chasing should drop back to its patrol (walk) speed, not keep sprinting');
});

// Task 2 review: `chasing` alone stays true for the WHOLE engagement window,
// closing and holding both, and evasion was found gated on it directly --
// measured, over 200 missions, 67.6% of a chasing melee agent's evaded shots
// landing while it stood still at strike range, not while it was actually
// closing. `sprinting` exists to split that window; this proves the split
// itself happens at the right distance, in the real step() loop (not just in
// the evasionOf mocks above), and that `chasing` survives the hold instead of
// being cleared by it -- movement (world.js) and combat targeting both still
// need `chasing` true for the whole engagement, only evasion narrows to the
// sprint.
test('a melee agent stops sprinting (but keeps chasing) once it holds at strike range', () => {
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + (COMBAT.chargeRange - 0.5), z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].chasing, true, 'setup failed to enter the chasing state');
  assert.equal(agents[0].sprinting, true, 'setup failed to be sprinting while still closing');

  // Move the target to just outside the hold threshold (meleeRange * 0.75):
  // still sprinting.
  agents[1].x = 2 + (COMBAT.meleeRange * 0.75 + 0.05);
  combat.step(COMBAT.scanInterval + 1);
  assert.equal(agents[0].chasing, true, 'still within chargeRange -- should still be chasing');
  assert.equal(agents[0].sprinting, true,
    'just outside the hold threshold -- should still be sprinting');

  // Move the target inside the hold threshold: world.js would now have this
  // agent standing still, swinging (see the `dist < COMBAT.meleeRange * 0.75`
  // branch there) -- chasing must stay true (movement/targeting still treat
  // this as an active charge) but sprinting must drop, since evasionOf must
  // not credit a stationary target.
  agents[1].x = 2 + (COMBAT.meleeRange * 0.75 - 0.05);
  combat.step(COMBAT.scanInterval + 2);
  assert.equal(agents[0].chasing, true,
    'inside the hold threshold but still within chargeRange -- chasing should stay true');
  assert.equal(agents[0].sprinting, false,
    'inside the hold threshold -- should have stopped sprinting even though still chasing');
});

test("createCombat's default walkSpeed still matches SIM", () => {
  // combat.js cannot import world.js (the cycle would fail to resolve — see
  // its header comment) so it hardcodes walkSpeed=1.4 as a fallback default
  // and documents it as mirroring SIM.walkSpeed. Nothing enforces that the
  // two stay in sync — a future change to SIM.walkSpeed with nobody
  // remembering to update the other default would silently ship a melee
  // patrol speed that no longer matches world.js's own, with every other test
  // in this file passing (they all supply explicit `speeds`, which never
  // exercises combat.js's own fallback). This test is the one place that
  // calls `scene()` with no `speeds` override, so it is the one place that
  // would catch that drift. There is no equivalent `runSpeed` default to
  // check: a chasing melee agent's speed is `COMBAT.meleeChargeSpeed`, a
  // frozen constant read directly rather than injected, so it cannot drift
  // from a constructor default that no longer exists.
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2 + (COMBAT.chargeRange - 0.5), z: 2, weapon: 'none', hp: COMBAT.swatHp },
  ]);
  for (let t = 0; t < COMBAT.scanInterval; t++) combat.step(t);
  assert.equal(agents[0].chasing, true, 'setup failed to enter the chasing state');
  assert.equal(agents[0].wants, COMBAT.meleeChargeSpeed,
    "a chasing melee agent's wants no longer matches COMBAT.meleeChargeSpeed");

  agents[1].x = 2 + (COMBAT.chargeRange + 2);
  combat.step(COMBAT.scanInterval + 1);
  assert.equal(agents[0].chasing, false, 'setup failed to drop out of the chasing state');
  assert.equal(agents[0].wants, SIM.walkSpeed,
    "combat.js's default walkSpeed no longer matches SIM.walkSpeed");
});

// `sprinting`, not `chasing`, is what `evasionOf` actually reads (see its doc
// comment): `chasing` spans the whole engagement window, including the
// stationary hold at strike range, and evasion is specified for the sprint
// only. These mocks set `sprinting` directly to exercise `evasionOf`/
// `hitChance` in isolation, without needing a real target to compute it from.
test('a sprinting melee agent is harder to hit than a standing one', () => {
  const charging = { role: 'hostile', weapon: 'melee', sprinting: true };
  const standing = { role: 'hostile', weapon: 'melee', sprinting: false };
  const shooter = { role: 'swat', weapon: 'gun' };

  const vsCharging = hitChance(shooter, 5, charging);
  const vsStanding = hitChance(shooter, 5, standing);

  assert.ok(vsCharging < vsStanding,
    `a charging target (${vsCharging}) should be harder to hit than a standing one (${vsStanding})`);
  assert.ok(Math.abs(vsStanding * (1 - COMBAT.meleeEvasion) - vsCharging) < 1e-9,
    'evasion should scale the hit chance by exactly (1 - meleeEvasion)');
});

test('only an actually-sprinting melee agent evades', () => {
  assert.equal(evasionOf({ role: 'hostile', weapon: 'melee', sprinting: true }), COMBAT.meleeEvasion);
  assert.equal(evasionOf({ role: 'hostile', weapon: 'melee', sprinting: false }), 0);
  assert.equal(evasionOf({ role: 'hostile', weapon: 'gun', sprinting: true }), 0);
  assert.equal(evasionOf({ role: 'swat', weapon: 'gun', sprinting: false }), 0);
  // `chasing: true` alone (the whole engagement window, including the
  // stationary hold at strike range -- see combat.js) must NOT be enough on
  // its own; only `sprinting` gates evasion.
  assert.equal(evasionOf({ role: 'hostile', weapon: 'melee', chasing: true, sprinting: false }), 0,
    'a melee agent holding at strike range (chasing but not sprinting) should not evade');
});

test('hit chance can never go negative or exceed one', () => {
  // hitChance is exported, so an out-of-domain caller must still get a
  // probability. gunRange is 10; the falloff term goes negative past 2x that.
  const shooter = { role: 'swat', weapon: 'gun' };
  const plain = { role: 'hostile', weapon: 'gun', sprinting: false };
  assert.ok(hitChance(shooter, 100, plain) >= 0, 'a very distant shot returned a negative probability');
  assert.ok(hitChance(shooter, 0, plain) <= 1, 'a point-blank shot exceeded certainty');
});

test('a melee hostile carries more health than a gun hostile', () => {
  // It has to cross open ground under fire to do its job; a gun hostile does not.
  assert.ok(COMBAT.meleeHp > COMBAT.hostileHp,
    `meleeHp ${COMBAT.meleeHp} should exceed hostileHp ${COMBAT.hostileHp}`);
});

test('a charging melee agent closes faster than it walks', () => {
  assert.ok(COMBAT.meleeChargeSpeed > SIM.runSpeed,
    `meleeChargeSpeed ${COMBAT.meleeChargeSpeed} should exceed runSpeed ${SIM.runSpeed}`);
});

test('firing spends a round, and an empty magazine triggers a reload', () => {
  const { agents, combat } = scene([
    // Also never dies: the hostile fires back (weapon defaults to 'gun'), and
    // at hostileAccuracy 0.70 against the shooter's default test hp of 100 it
    // kills in ~4 hits — an expected ~270 ticks, well short of the ~480 ticks
    // ten rounds at gunCooldown take to fire. Without this the shooter is
    // reliably dead before its own magazine could ever run dry, and this test
    // would be exercising who wins the firefight rather than ammo/reload.
    { role: 'swat', x: 2, z: 2, hp: 100000 },
    { role: 'hostile', x: 5, z: 2, hp: 100000 },  // never dies, so firing continues
  ]);
  const shooter = agents[0];
  assert.equal(shooter.ammo, COMBAT.magazineSize, 'did not start with a full magazine');

  let tick = 0;
  let sawReload = false;
  let lowest = COMBAT.magazineSize;
  while (tick < 6000 && !sawReload) {
    combat.step(tick++);
    lowest = Math.min(lowest, shooter.ammo);
    if (shooter.reloadUntil > tick) sawReload = true;
  }
  assert.equal(lowest, 0, `magazine never emptied (lowest ${lowest})`);
  assert.ok(sawReload, 'an empty magazine never started a reload');
});

test('a reloading agent cannot fire', () => {
  const { agents, combat } = scene([
    // See the comment on the same fixture in the previous test: the shooter
    // must survive the hostile's return fire long enough to reach a reload.
    { role: 'swat', x: 2, z: 2, hp: 100000 },
    { role: 'hostile', x: 5, z: 2, hp: 100000 },
  ]);
  const shooter = agents[0];
  const target = agents[1];

  let tick = 0;
  while (tick < 6000 && shooter.reloadUntil <= tick) combat.step(tick++);
  assert.ok(shooter.reloadUntil > tick, 'never entered a reload');

  const hpAtReloadStart = target.hp;
  const firedAtReloadStart = shooter.firedAt;
  while (tick < shooter.reloadUntil) combat.step(tick++);

  assert.equal(shooter.firedAt, firedAtReloadStart, 'fired while reloading');
  assert.equal(target.hp, hpAtReloadStart, 'dealt damage while reloading');
});

test('a reload refills the magazine exactly once', () => {
  const { agents, combat } = scene([
    // See the comment on the same fixture above: the shooter must survive the
    // hostile's return fire long enough to reach a reload.
    { role: 'swat', x: 2, z: 2, hp: 100000 },
    { role: 'hostile', x: 5, z: 2, hp: 100000 },
  ]);
  const shooter = agents[0];
  let tick = 0;
  while (tick < 6000 && shooter.reloadUntil <= tick) combat.step(tick++);
  while (tick <= shooter.reloadUntil) combat.step(tick++);
  combat.step(tick++);
  assert.equal(shooter.ammo, COMBAT.magazineSize,
    `magazine holds ${shooter.ammo} after a reload, expected ${COMBAT.magazineSize}`);
});

test('a melee agent has no ammunition and never reloads', () => {
  // Ammo is a gun concept. A melee agent that could be blocked by an empty
  // magazine would silently stop attacking with no visible cause.
  const { agents, combat } = scene([
    { role: 'hostile', x: 2, z: 2, weapon: 'melee' },
    { role: 'swat', x: 2.5, z: 2, hp: 100000 },
  ]);
  for (let t = 0; t < 3000; t++) combat.step(t);
  assert.equal(agents[0].reloadUntil, -1, 'a melee agent entered a reload');
  assert.ok(agents[1].hp < 100000, 'the melee agent stopped attacking');
});
