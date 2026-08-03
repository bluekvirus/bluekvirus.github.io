# Raid Phase D, Plan B: Melee, Ammunition and Bodies

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melee attackers survive long enough to matter, rifles run dry and reload, and agents stop walking through each other.

**Architecture:** Three self-contained changes to the existing pure simulation, in ascending order of risk. Evasion and melee stats are constants plus one term in `hitChance`. Ammunition is one field and a cooldown. Hard body collision is a constraint inside `world.js`'s existing integrate-then-verify-and-slide movement step, and lands last because it makes deadlock-recovery paths live for the first time.

**Tech Stack:** Vanilla ES modules, Babylon.js 9.18.1 from CDN, Node's built-in test runner, no dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-08-01-raid-phase-d-design.md`

**This is Plan B of two.** Plan A delivered the autonomous squad and is merged. This plan delivers the spec's remaining three subsystems plus final tuning.

## Global Constraints

- No build step. Plain ES modules loaded directly by the browser; push is deploy. No dependency, no bundler.
- Everything under `raid/sim/` plus `raid/rng.js`, `raid/floorplan.js`, `raid/roles.js`, `raid/furnish.js` is PURE. No `BABYLON`, `window`, `document`, `performance`, `location`, or `Math.random`. `raid/tests/purity.test.js` enforces it.
- `raid/sim/combat.js` MUST NOT import `raid/sim/world.js` — world imports combat, and the cycle breaks under Node.
- Seeded RNG only, and **no rng draw may be added, removed, or reordered** except where a task explicitly introduces one. Every hit roll is one `rng.next()` inside `attack()`.
- Determinism: same seed and tick count must produce an identical `world.hash()`. **Any new simulation state must be added to `world.hash()`** or the replay test passes while the simulation diverges — this exact gap was caught in phase C for `hp`/`alive`.
- Nothing may splice, sort, or filter-in-place `world.agents`. `combat.js` resolves targets through a `byId` Map built at construction; `world.js` pushes with `id: agents.length` and never reorders. Build new arrays with `.filter()`.
- Run the suite with `node --test raid/tests/*.test.js` from the repository root. It is **155 tests** and all pass at the start of this plan.
- The per-tick budget in `raid/tests/simbudget.test.js` is the requirement, not a target. If a change breaks it, make the change cheaper — do not widen the budget.

## Current constants, verified against the tree

```
COMBAT   sightRange 12   gunRange 10      meleeRange 1.2   chargeRange 10
         gunCooldown 0.8 meleeCooldown 1.1
         gunDamage 25    meleeDamage 35
         swatHp 75       hostileHp 80     hostageHp 40
         swatAccuracy 0.80  hostileAccuracy 0.70  meleeAccuracy 0.75
         scanInterval 6
SQUAD    fallbackHealth 0.35  spread 1.1  fallbackDistance 4.0
         fallbackTicks 3600   reissueDistance 1.5
SIM      step 1/60  walkSpeed 1.4  runSpeed 3.2  arriveRadius 0.28
         separation 0.75  separationForce 1.6  turnRate 8
MISSION_LIMIT 12000   (dryrun MAX_TICKS 15600)
```

`accuracyOf()` routes a melee agent to `meleeAccuracy` regardless of role, so `hostileAccuracy` is a **gun-hostiles-only** lever and cannot affect melee.

## Baseline to beat, measured on merged `master`

Two independent 150-mission families, rooms 8-12:

```
coverage 78.1% / 78.7%      hostile encounter 68.3% / 67.3%
timeouts 0 / 0              mean SWAT lost 1.72 / 1.68
ticks    median ~2750  p90 ~5950  p99 ~7100  max 7847
outcome  extracted 69/63   hostage-killed 45/45   squad-lost 36/42
```

Every task below reports against these. A change that moves them must say so.

---

### Task 1: Resolve the fallback rule

`SQUAD.fallbackHealth` pulls a hurt member back. Plan A's final review measured it costing **8.5 points of mission success** (extracted 45.0% with it, 53.5% without), 62% more squad wipes, and 29% longer missions — which loads `MISSION_LIMIT`, the only anti-hang bound. Its own test cannot distinguish it from its absence.

This lands first because every later task tunes against the squad's survival rate, and tuning against a rule that is about to be removed wastes the work.

**Files:**
- Modify: `raid/sim/squad.js`
- Modify: `raid/tests/squad.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: either `SQUAD.fallbackHealth` removed along with the fallback branch, or the rule retained with a test that genuinely guards it. Later tasks read the resulting mission-success rate as their baseline.

- [ ] **Step 1: Reproduce the measurement**

Write a sweep in the scratchpad (NOT the repository) that runs at least 300 missions across rooms 8-12 twice: once as shipped, once with `SQUAD.fallbackHealth` set to `0` so the branch never fires. Report for each: outcome split by reason, mean ticks, mean SWAT survivors, coverage, and timeouts.

Confirm or refute the 45.0% / 53.5% figures. If they do not reproduce, say so with your numbers and stop before changing anything.

- [ ] **Step 2: Fix the test that cannot fail**

`raid/tests/squad.test.js`'s `a badly hurt member falls back instead of advancing` passes with the entire mechanism deleted — verified by forcing `const eligible = false;` in `raid/sim/squad.js`. Its sibling was strengthened in Plan A's final wave; this one was not.

Whatever you decide in Step 3, this test must either be made to bite or be removed with the rule. Do not leave a test whose name claims behaviour it cannot detect.

- [ ] **Step 3: Decide, with the numbers**

**Default recommendation: remove the rule.** It costs measurable mission success, its stated purpose ("the others keep going, and it rejoins once it is no longer the most exposed") was never built — there is no rejoin, only a 3600-tick timer — and nothing depends on it. Removal means deleting the fallback branch, `fallbackHealth`, `fallbackDistance`, `fallbackTicks`, the `fallbackTicksLeft`/`fallbackSpent` maps and their cleanup, and the tests that exercise them.

Keep it only if your Step 1 numbers contradict the review's. If you keep it, it needs a test that reddens when `eligible` is forced false.

State which you chose and why in your report. This is a design decision the owner may overturn at review, so make the reasoning legible.

- [ ] **Step 4: Verify**

Run: `node --test raid/tests/*.test.js`
Expected: green. Report the new count and account for any removed tests.

Re-run your Step 1 sweep against the committed state and report the outcome split, so later tasks have an accurate baseline.

- [ ] **Step 5: Commit**

```bash
git add raid/sim/squad.js raid/tests/squad.test.js
git commit -m "fix(raid): resolve the squad fallback rule against measurement"
```

---

### Task 2: Melee survivability

Melee hostiles charge and die. Give them health, a charge speed, and evasion while sprinting, so they reach contact often enough to matter.

**Files:**
- Modify: `raid/sim/combat.js`
- Modify: `raid/tests/combat.test.js`

**Interfaces:**
- Consumes: Task 1's resulting mission-success baseline.
- Produces: `COMBAT.meleeHp`, `COMBAT.meleeEvasion`, `COMBAT.meleeChargeSpeed`; `hitChance(a, distance, target)` gains a third parameter; `evasionOf(agent)` exported for tests.

- [ ] **Step 1: Write the failing tests**

Append to `raid/tests/combat.test.js`. The `scene()` helper already exists in that file and builds a bare 20x20 room with hand-placed agents.

```js
test('a sprinting melee agent is harder to hit than a standing one', () => {
  const charging = { role: 'hostile', weapon: 'melee', chasing: true };
  const standing = { role: 'hostile', weapon: 'melee', chasing: false };
  const shooter = { role: 'swat', weapon: 'gun' };

  const vsCharging = hitChance(shooter, 5, charging);
  const vsStanding = hitChance(shooter, 5, standing);

  assert.ok(vsCharging < vsStanding,
    `a charging target (${vsCharging}) should be harder to hit than a standing one (${vsStanding})`);
  assert.ok(Math.abs(vsStanding * (1 - COMBAT.meleeEvasion) - vsCharging) < 1e-9,
    'evasion should scale the hit chance by exactly (1 - meleeEvasion)');
});

test('only a charging melee agent evades', () => {
  assert.equal(evasionOf({ role: 'hostile', weapon: 'melee', chasing: true }), COMBAT.meleeEvasion);
  assert.equal(evasionOf({ role: 'hostile', weapon: 'melee', chasing: false }), 0);
  assert.equal(evasionOf({ role: 'hostile', weapon: 'gun', chasing: true }), 0);
  assert.equal(evasionOf({ role: 'swat', weapon: 'gun', chasing: false }), 0);
});

test('hit chance can never go negative or exceed one', () => {
  // hitChance is exported, so an out-of-domain caller must still get a
  // probability. gunRange is 10; the falloff term goes negative past 2x that.
  const shooter = { role: 'swat', weapon: 'gun' };
  const plain = { role: 'hostile', weapon: 'gun', chasing: false };
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
```

Add `evasionOf` and `SIM` to that file's imports (`SIM` comes from `../sim/world.js`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/combat.test.js`
Expected: FAIL — `evasionOf` is not exported and the new constants do not exist.

- [ ] **Step 3: Implement**

Add to `COMBAT` in `raid/sim/combat.js`:

```js
  // A melee hostile must cross open ground under four rifles to do its job,
  // which a gun hostile never has to. These three constants exist to make that
  // crossing survivable often enough for melee to be a real threat rather than
  // a decoration. All three are starting points, tuned by measurement in the
  // final task of this plan.
  meleeHp: 160,
  // Applied ONLY while chasing. Tying it to the sprint makes it "hard to hit a
  // fast mover" rather than an arbitrary dodge stat, and confines it to exactly
  // the exposure window it exists to fix.
  meleeEvasion: 0.35,
  meleeChargeSpeed: 4.0,
```

Add the exported helper, next to `accuracyOf`:

```js
/**
 * How much of an attacker's hit chance this target evades. Zero for everyone
 * except a melee agent that is currently closing — a stationary melee agent
 * is no harder to hit than anyone else, and a gun agent never evades at all.
 */
export function evasionOf(target) {
  if (!target || target.weapon !== 'melee' || !target.chasing) return 0;
  return COMBAT.meleeEvasion;
}
```

Change `hitChance` to take the target and clamp:

```js
export function hitChance(a, distance, target) {
  const base = accuracyOf(a);
  const falloff = a.weapon === 'melee' ? 1 : (1 - 0.5 * distance / COMBAT.gunRange);
  const chance = base * falloff * (1 - evasionOf(target));
  // Clamped because this is exported: the falloff term goes negative past
  // twice gunRange, which step() never reaches but a direct caller can.
  return Math.min(1, Math.max(0, chance));
}
```

Update the single call site inside `attack()` to pass the target: `if (rng.next() >= hitChance(a, d, b)) return;`

Give melee hostiles their health where agents are built, in `raid/sim/world.js`'s `add` closure. The `hp` and `hpMax` lines currently read role only; they must now read weapon too:

```js
      hp: role === 'swat' ? COMBAT.swatHp
        : role === 'hostage' ? COMBAT.hostageHp
        : (spawn.weapon === 'melee' ? COMBAT.meleeHp : COMBAT.hostileHp),
      hpMax: role === 'swat' ? COMBAT.swatHp
        : role === 'hostage' ? COMBAT.hostageHp
        : (spawn.weapon === 'melee' ? COMBAT.meleeHp : COMBAT.hostileHp),
```

Keep the two expressions identical, as they are today — a drift between starting health and maximum health would silently break the fallback threshold if Task 1 retained it.

Give the charge its speed in `raid/sim/world.js`, where a chasing agent's movement speed is read. Find the line that reads `const speed = a.wants;` and make a chasing melee agent use the charge speed instead:

```js
      // A charging melee agent sprints faster than anyone runs: the whole
      // point is to spend less time in the open. Everyone else moves at the
      // speed their orders set.
      const speed = (a.chasing && a.weapon === 'melee') ? COMBAT.meleeChargeSpeed : a.wants;
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test raid/tests/combat.test.js`
Expected: PASS.

Run: `node --test raid/tests/*.test.js`
Expected: green. Some `world.test.js` replay hashes may shift because melee hostiles now have different health — that is expected and correct. Report any test that changed behaviour and why.

- [ ] **Step 5: Sabotage-verify**

For each new test, break the line it covers and confirm that test — and ideally only that test — goes red:
- Make `evasionOf` return `0` unconditionally.
- Drop the `(1 - evasionOf(target))` term from `hitChance`.
- Remove the clamp.
- Set `meleeHp` equal to `hostileHp`.

Restore after each and confirm green. Report what you saw.

- [ ] **Step 6: Measure**

Run a sweep of at least 300 missions and report: what fraction of melee hostiles ever land a swing, what fraction of missions see one, and the outcome split. Compare against the plan's stated baseline. Do not tune yet — Task 5 does that with everything in place.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/combat.js raid/sim/world.js raid/tests/combat.test.js
git commit -m "feat(raid): melee chargers get health, speed and evasion"
```

---

### Task 3: Ammunition and reload (simulation)

**Files:**
- Modify: `raid/sim/combat.js`, `raid/sim/world.js`
- Modify: `raid/tests/combat.test.js`, `raid/tests/world.test.js`

**Interfaces:**
- Consumes: `hitChance(a, distance, target)` from Task 2.
- Produces: `COMBAT.magazineSize`, `COMBAT.reloadTime`; agents gain `ammo` and `reloadUntil`; `world.hash()` covers `ammo`.

- [ ] **Step 1: Write the failing tests**

Append to `raid/tests/combat.test.js`:

```js
test('firing spends a round, and an empty magazine triggers a reload', () => {
  const { agents, combat } = scene([
    { role: 'swat', x: 2, z: 2 },
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
    { role: 'swat', x: 2, z: 2 },
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
    { role: 'swat', x: 2, z: 2 },
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
```

Append to `raid/tests/world.test.js`:

```js
test('the replay hash covers ammunition', () => {
  const a = build('hash-ammo');
  const b = build('hash-ammo');
  for (let i = 0; i < 300; i++) { a.tick(); b.tick(); }
  assert.equal(a.hash(), b.hash());

  a.agents[0].ammo -= 1;
  assert.notEqual(a.hash(), b.hash(),
    'hash() ignores ammo — a diverging reload cycle would replay as identical');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/combat.test.js raid/tests/world.test.js`
Expected: FAIL — `COMBAT.magazineSize` is undefined and `ammo` does not exist.

- [ ] **Step 3: Implement**

Add to `COMBAT`:

```js
  // Ten rounds, not thirty. SWAT fire roughly a dozen shots each per mission
  // now that clearing has doubled contacts, so a conventional magazine would
  // never empty and reload would be dead code — the same failure as phase C's
  // meleeDamage and sightRange, both of which shipped inert and were reverted.
  // A finite count of SPARE magazines is deliberately not modelled: no
  // plausible number could ever be exhausted, so the count and the
  // out-of-ammo fallback it would gate are unreachable before they are written.
  magazineSize: 10,
  reloadTime: 1.8,
```

Add to the agent record in `raid/sim/world.js`'s `add` closure:

```js
      // Gun agents only. A melee agent's ammo stays at the magazine size and
      // is never read, so it can never be blocked by an empty one.
      ammo: COMBAT.magazineSize,
      // Tick at which a reload completes, or -1 when not reloading.
      reloadUntil: -1,
```

In `combat.js`'s `step()` loop, gate firing and drive the reload. Immediately before the existing `if (a.target < 0 || a.cooldown > 0) continue;`:

```js
        // A reload in progress blocks firing but not movement or targeting.
        if (a.reloadUntil > tick) continue;
        if (a.reloadUntil >= 0 && a.reloadUntil <= tick) {
          a.reloadUntil = -1;
          a.ammo = COMBAT.magazineSize;
        }
        // An empty magazine starts one. Melee never reaches this — it does not
        // spend ammo, so its count never falls.
        if (a.weapon === 'gun' && a.ammo <= 0) {
          a.reloadUntil = tick + Math.round(COMBAT.reloadTime / step);
          continue;
        }
```

In `attack()`, spend the round — before the hit roll, so a miss costs ammunition exactly as a hit does:

```js
    if (a.weapon === 'gun') a.ammo -= 1;
```

Extend `world.hash()` to include `ammo`, appended to the existing per-agent field list.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test raid/tests/combat.test.js raid/tests/world.test.js`
Expected: PASS.

Run: `node --test raid/tests/*.test.js`
Expected: green.

- [ ] **Step 5: Sabotage-verify**

Break each and confirm the named test goes red: remove the `a.ammo -= 1`; remove the `reloadUntil > tick` guard; make the reload refill to `0`; remove `ammo` from `hash()`. Restore each. Report what you saw.

- [ ] **Step 6: Measure whether reload is real**

This is the acceptance criterion the spec sets: **reload must actually occur in a substantial fraction of missions**, or the mechanic is decoration.

Sweep at least 300 missions and report: the fraction of missions in which at least one reload occurs, the mean reloads per SWAT member per mission, and the outcome split against the baseline. If reload fires rarely, say so plainly — the sizing changes in Task 5, or the feature is reported as not delivered.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/combat.js raid/sim/world.js raid/tests/combat.test.js raid/tests/world.test.js
git commit -m "feat(raid): magazines run dry and get reloaded"
```

---

### Task 4: Hard body collision

Last, and the most likely to destabilise movement: it makes the yield, nudge and right-of-way machinery reachable for the first time. That machinery is correct and tested but has never fired in a real mission.

**Files:**
- Modify: `raid/sim/world.js`
- Modify: `raid/tests/world.test.js`

**Interfaces:**
- Consumes: `COMBAT.meleeRange` (1.2) and `SIM.separation` (0.75).
- Produces: `SIM.bodyRadius`; living agents can no longer overlap.

- [ ] **Step 1: Write the failing tests**

Append to `raid/tests/world.test.js`. `openRoom` already exists in that file.

```js
test('the body radius sits inside every distance that depends on it', () => {
  // Three orderings, all load-bearing, all cheap to assert and expensive to
  // discover by debugging:
  //   2*bodyRadius < meleeRange*0.75  -- where a charger actually stops. If
  //     collision blocked before that point, chargers would freeze just
  //     outside their own strike distance and melee would break SILENTLY,
  //     since they would still look like they were closing.
  //   2*bodyRadius < separation       -- soft steering resolves crowding
  //     before the hard constraint ever engages.
  assert.ok(SIM.bodyRadius * 2 < COMBAT.meleeRange * 0.75,
    `bodies (${SIM.bodyRadius * 2}m apart) block before a charger's stop distance (${COMBAT.meleeRange * 0.75}m)`);
  assert.ok(SIM.bodyRadius * 2 < SIM.separation,
    `hard collision (${SIM.bodyRadius * 2}m) engages before soft separation (${SIM.separation}m)`);
});

test('two living agents never overlap', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const w = build(seed);
    const hostage = w.agents.find((a) => a.role === 'hostage');
    for (const a of w.agents) w.setGoal(a.id, { x: hostage.x, z: hostage.z });
    for (let i = 0; i < 1800; i++) {
      w.tick();
      const live = w.agents.filter((a) => a.alive);
      for (let x = 0; x < live.length; x++) {
        for (let y = x + 1; y < live.length; y++) {
          const gap = Math.hypot(live[x].x - live[y].x, live[x].z - live[y].z);
          assert.ok(gap >= SIM.bodyRadius * 2 - 1e-6,
            `${seed}: agents ${live[x].id} and ${live[y].id} overlapped at ${gap.toFixed(3)}m on tick ${i}`);
        }
      }
    }
  }
});

test('a corpse does not block the living', () => {
  // Bodies do not pile up in doorways. Deliberate: a dead agent that blocked
  // movement could seal a corridor with nothing able to clear it.
  const w = openRoom([{ x: 5, z: 5 }, { x: 5.6, z: 5 }]);
  const [walker, corpse] = w.agents;
  corpse.hp = 0;
  w.tick();
  assert.equal(corpse.alive, false, 'the fixture did not actually kill it');

  assert.ok(w.setGoal(walker.id, { x: 9, z: 5 }));
  for (let i = 0; i < 900; i++) w.tick();
  assert.ok(walker.x > 7,
    `the walker stopped at x=${walker.x.toFixed(2)} — a corpse blocked it`);
});

test('a melee charger can still reach striking distance', () => {
  // The ordering test above proves the constants allow it; this proves the
  // movement code actually delivers it.
  const w = openRoom([{ x: 2, z: 5 }, { x: 9, z: 5 }], 16);
  const [chaser, mark] = w.agents;
  chaser.role = 'hostile'; chaser.weapon = 'melee';
  mark.role = 'swat'; mark.weapon = 'none'; mark.hp = 100000;
  chaser.chasing = true; chaser.target = mark.id;
  let closest = Infinity;
  for (let i = 0; i < 1800; i++) {
    w.tick();
    closest = Math.min(closest, Math.hypot(chaser.x - mark.x, chaser.z - mark.z));
  }
  assert.ok(closest <= COMBAT.meleeRange,
    `the charger never got within melee range — closest ${closest.toFixed(2)}m vs ${COMBAT.meleeRange}m`);
});
```

Add `COMBAT` to that file's imports if it is not already there.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test raid/tests/world.test.js`
Expected: FAIL — `SIM.bodyRadius` is undefined.

- [ ] **Step 3: Implement**

Add to `SIM` in `raid/sim/world.js`:

```js
  // Living agents cannot close within twice this. 0.25 is chosen against three
  // existing distances, all asserted in world.test.js: it must stay under
  // meleeRange*0.75 (0.90) so a charger can still reach its own strike
  // distance, and under SIM.separation (0.75) so the soft steering force gets
  // to resolve ordinary crowding before the hard constraint engages.
  bodyRadius: 0.25,
```

Add the body check alongside the existing geometry check. `world.js` already integrates then verifies then slides per axis, using a `refusalAt(x, z)` helper — the body test slots into the same shape. Add a helper beside it:

```js
  // Is (x, z) inside another LIVING agent's body? Corpses are excluded
  // deliberately: a dead agent that blocked movement could seal a corridor
  // with nothing able to clear it.
  const bodyBlocked = (self, x, z) => {
    const min = SIM.bodyRadius * 2;
    for (const other of agents) {
      if (other === self || !other.alive) continue;
      if (Math.hypot(x - other.x, z - other.z) < min) return true;
    }
    return false;
  };
```

Then fold it into the three refusal checks. `raid/sim/world.js:549-551` currently reads exactly:

```js
      const primary = refusalAt(nx, nz);
      const slideX = primary.blocked ? refusalAt(nx, a.z) : null;
      const slideZ = (slideX && slideX.blocked) ? refusalAt(a.x, nz) : null;
```

Replace it with a wrapper that adds the body test while preserving the short-circuiting exactly:

```js
      // A body refuses a step the same way a wall does, so it slides the same
      // way too. `doorId` stays -1 on a body refusal, which matters: the
      // door-opening trigger and the stall classifier below both inspect
      // these three refusals, and a body must not be mistaken for a shut door
      // — that would try to open a door that is not there, and would reset
      // the stall window on a genuine jam.
      const refusalWithBodies = (x, z) => {
        const r = refusalAt(x, z);
        if (r.blocked) return r;
        return bodyBlocked(a, x, z) ? { blocked: true, doorId: -1 } : r;
      };

      const primary = refusalWithBodies(nx, nz);
      const slideX = primary.blocked ? refusalWithBodies(nx, a.z) : null;
      const slideZ = (slideX && slideX.blocked) ? refusalWithBodies(a.x, nz) : null;
```

Nothing downstream changes: `world.js:579-580`'s commit step and the `refusedByDoor` classification below both read these same three values and are already written against the `{ blocked, doorId }` shape.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test raid/tests/world.test.js`
Expected: PASS.

Run: `node --test raid/tests/*.test.js`
Expected: green. **Expect trouble here.** This is the task that makes the deadlock-recovery machinery live. If missions start timing out, that is the finding, not a nuisance — report the rate, the seeds, and what the stuck agents are doing (`_goalStrikes`, `_nudgeTicks`, `_yieldTicks`) before changing anything.

- [ ] **Step 5: Sabotage-verify**

Remove the `!other.alive` skip and confirm the corpse test goes red. Remove the body check from the primary refusal and confirm the overlap test goes red. Set `bodyRadius` to `0.5` and confirm the ordering test goes red. Restore each.

- [ ] **Step 6: Measure the deadlock risk explicitly**

Sweep at least 300 missions and report: timeouts, the worst still-run for any agent, how many times the yield fired, how many times the nudge fired, and the maximum `_goalStrikes` reached. Compare against the baseline, where the yield fired zero times.

If timeouts appear, they must be fixed before this task closes — `MISSION_LIMIT` is the only anti-hang bound and a collision-induced deadlock is exactly what it cannot distinguish from a slow mission.

- [ ] **Step 7: Commit**

```bash
git add raid/sim/world.js raid/tests/world.test.js
git commit -m "feat(raid): agents have bodies"
```

---

### Task 5: The reload clip, and the HUD

The renderer side. `agents.js` already selects clips by priority; reload joins that chain.

**Files:**
- Create: `raid/reload-clip.js`
- Modify: `raid/agents.js`, `raid/main.js`

**Interfaces:**
- Consumes: `agent.reloadUntil` from Task 3; `world.ticks`.
- Produces: `buildReloadClip(skeleton, scene)` → a Babylon `AnimationGroup` named `Rifle_Reload`, or `null` if the rig lacks the bones it needs.

- [ ] **Step 1: Read the source material**

The Quaternius pack ships **no** `Reload` clip — verified across all 24 clips in all ten GLBs, which is why reload was dropped from phase C. A hand-authored one exists on the archived branch:

```bash
git show archive/rifle-wip:soldier/rifle-clips.js
```

It authors `Rifle_Reload` as keyframed bone rotations: the right hand brings the rifle to the chest and cants it so the mag well presents to the left hand, which strips the magazine, fetches a fresh one at the belt, seats it, then racks the bolt. `soldier/reload.js` on `master` documents the same technique for a pistol and calls it "reusable for future combat clips".

Read both before writing anything. Adapt rather than reinvent — and note in your report which bone names the archived version uses and whether they exist on this project's rig, since `raid/weapons.js` found the hand bone is `Wrist.R`, not `Hand.R` as an earlier brief assumed.

- [ ] **Step 2: Build the clip**

Create `raid/reload-clip.js` with this shape. The keyframe bodies are yours to author from the archived source read in Step 1 — I am deliberately not inventing rotation values I have not seen on this rig, because a fabricated pose would look wrong and be blamed on the wiring.

```js
// A reload animation, hand-authored.
//
// The Quaternius pack ships no Reload clip — verified across all 24 clips in
// all ten GLBs — which is why reload was dropped from phase C. This adapts the
// keyframed approach from `archive/rifle-wip`'s soldier/rifle-clips.js, which
// solved the same problem for the soldier sandbox: the right hand brings the
// weapon to the chest and cants it so the mag well presents to the left hand,
// which strips the magazine, fetches a fresh one at the belt, seats it, and
// racks the bolt.
//
// Bones are looked up BY NAME, never by index. Indices differ between this
// pack's models — an index that is a hand on one is an elbow on another — and
// raid/weapons.js already found the hand bone is `Wrist.R`, not the `Hand.R`
// an earlier brief assumed.

const REQUIRED_BONES = [/* names you confirm in Step 1 */];

export function buildReloadClip(skeleton, scene) {
  const bones = {};
  for (const name of REQUIRED_BONES) {
    const bone = skeleton.bones.find((b) => b.name === name);
    // Degrade to "no reload animation" rather than throw. Every figure builds
    // its own clip, so a throw here would take the whole cast down at load —
    // and a rig without this bone is a content problem, not a crash.
    if (!bone) return null;
    bones[name] = bone;
  }

  const group = new BABYLON.AnimationGroup('Rifle_Reload', scene);
  // ... per-bone Animation objects, keyframed from the archived source ...
  return group;
}
```

The group must be named exactly `Rifle_Reload` — `agents.js` selects clips by name.

- [ ] **Step 3: Wire it into the clip chain**

In `raid/agents.js`, add `'Rifle_Reload'` to `CLIP_NAMES`, build the clip per figure alongside the pack's own groups, and add this branch to `combatClip`. It sits **below** death and flinch and **above** firing and pointing — an agent hit mid-reload should flinch, and one reloading should not read as aiming:

```js
  // The simulation owns how long a reload takes; the animation tracks it
  // rather than the reverse. Driving this from the clip's own length would
  // let the two drift apart, and the sim's duration is the one that decides
  // when the agent can shoot again.
  if (agent.reloadUntil > ticks) return 'Rifle_Reload';
```

Place it immediately after the `HitRecieve` branch and before the firing branch. Note `buildReloadClip` can return `null`; `makeRig`'s existing `groups.find(...)` already tolerates a missing clip, and `crossfade` guards `if (!g) continue`, so a figure without one falls through to the next branch rather than freezing.

- [ ] **Step 4: Show it in the HUD**

In `raid/main.js`'s live readout, which currently shows survivors and cleared cells, add the reloading count so the mechanic is visible without opening the console:

```js
    const reloading = world.agents.filter((a) => a.alive && a.reloadUntil > world.ticks).length;
    outcomeEl.textContent =
      `SWAT ${alive('swat')}/${CAST.swat} · HOSTILES ${alive('hostile')}/${CAST.hostiles}`
      + ` · ${director.visited.size}/${plan.cells.length} CLEARED`
      + (reloading > 0 ? ` · ${reloading} RELOADING` : '');
```

- [ ] **Step 5: Verify in the browser**

There is no Node harness for Babylon; this is the only evidence and it is mandatory. Serve with `python3 -m http.server 8080` and open `http://localhost:8080/raid/?debug` with the Playwright MCP tools; kill the server after.

**The browser profile caches `raid/*.js` aggressively — disable and clear the cache via CDP (`Network.setCacheDisabled`, `Network.clearBrowserCache`) and hard-reload before trusting any measurement.** A `favicon.ico` 404 is pre-existing; any other console error is yours.

Confirm: a SWAT member visibly reloads mid-firefight; the animation runs for the sim's reload duration rather than snapping; a figure hit while reloading flinches rather than continuing; and the HUD count moves. Screenshot a reload in progress.

Run: `node --test raid/tests/*.test.js` — green; `raid/sim/**` must be untouched by this task.

- [ ] **Step 6: Commit**

```bash
git add raid/reload-clip.js raid/agents.js raid/main.js
git commit -m "feat(raid): show the reload"
```

---

### Task 6: Tune, measure, and close the spec

**Files:**
- Modify: `raid/sim/combat.js`, `raid/sim/world.js` (constants only, if measurement demands)
- Modify: `docs/superpowers/specs/2026-08-01-raid-phase-d-design.md`

- [ ] **Step 1: Sweep everything**

In the scratchpad, NOT the repository. At least 300 missions across rooms 8-12, on seed families none of the earlier tasks used. Report:

- Outcome split by reason, and timeouts
- Cell coverage and hostile encounter rate, against the plan's stated baseline
- Melee: fraction of melee hostiles that ever swing, fraction of missions with a swing, and the fate breakdown (ever swung / acquired-then-died / never acquired). Plan A measured **~68% never acquire a target at all** — that is a placement ceiling, not an exposure one, so report it separately rather than folding it into a single rate.
- Reload: fraction of missions with at least one reload, mean reloads per SWAT member
- Collision: yield fires, nudge fires, max `_goalStrikes`, worst still-run
- Tick distribution: median, p90, p95, p99, max, and the margin against `MISSION_LIMIT` 12000

- [ ] **Step 2: Tune only constants, and only where measurement demands**

Never a test. If a target is missed, that is a defect to investigate, not a threshold to move.

The specific things to check:
- If reload fires in only a small fraction of missions, `magazineSize` is too large — the spec's acceptance criterion is that it genuinely occurs.
- If melee engagement did not improve materially over Plan A's ~15%, report the fate breakdown and say whether the remaining gap is exposure (fixable here) or placement (not).
- If `MISSION_LIMIT`'s margin has fallen below roughly 1.3x, say so with the tail — collision and slower melee chargers both push missions longer, and it is the only anti-hang bound.

Report before and after for anything you move.

- [ ] **Step 3: Confirm the budget**

Run: `node --test raid/tests/simbudget.test.js`
Expected: PASS. Body collision adds an O(n²) check over twelve agents per movement step. If the per-tick budget fails, make the check cheaper — the budget is the requirement.

- [ ] **Step 4: Close the spec**

`docs/superpowers/specs/2026-08-01-raid-phase-d-design.md` still describes all four subsystems as pending, and two of its planning lists still describe stack/breach/cover as shipped when only slot-spread convergence and fallback exist (Plan A corrected the descriptive sections but not the Scope list or the Build order).

Update it to record what actually shipped across both plans, with the measured numbers. The spec is the durable artefact; a reader should be able to trust it without reading two plans and a ledger.

- [ ] **Step 5: Full verification**

Run: `node --test raid/tests/*.test.js` plus five concurrent runs:

```bash
for i in 1 2 3 4 5; do (node --test raid/tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)") & done; wait
```

Expected: `fail 0` five times.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(raid): tune the combat systems, and close the phase D spec"
```

---

## Self-Review Notes

**Spec coverage.** Melee survivability (evasion, health, charge speed) → Task 2. Ammunition and reload, simulation → Task 3; the hand-authored clip → Task 5. Hard body collision → Task 4. Final tuning and the spec's acceptance criteria → Task 6. The spec's `hitChance` formula, the "no finite spare magazines" decision, and the three-way distance ordering are all carried into the tasks that implement them.

**Added beyond the spec, and why.** Task 1 resolves the squad fallback rule. It is not in the spec, but Plan A's final review measured it costing 8.5 points of mission success with a test that cannot detect its absence, and every task here tunes against the squad's survival rate. Leaving it unresolved would mean tuning against a moving baseline.

**Ordering deviates from the spec's build order** — the spec lists melee, then ammo, then collision. This plan inserts Task 1 first for the reason above, and moves the reload clip to Task 5 so all three simulation changes land and are measurable before the renderer work begins. Collision stays last, as the spec requires.

**Known risk.** Task 4 is the one likely to fail. It makes the yield, nudge and right-of-way machinery reachable for the first time in this project's history — machinery that fired zero times across 790,000 agent-ticks in phase C and whose only coverage is synthetic. Its Step 4 says plainly to expect trouble and to report rather than paper over it, and Step 6 requires the deadlock measurement explicitly.
