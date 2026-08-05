# Design: Raid — phase D

## Goal

Give the squad a mind of its own. The scripted route is deleted: the team is
handed a blueprint and an objective, and works out the rest — which room to
clear next, how to enter it, who covers, when to pull back. Around that,
three supporting systems: finite ammunition, bodies that cannot walk through
each other, and melee attackers that survive long enough to matter.

Phase A generates the world, B moves everyone through it, C makes them fight.
This phase makes them decide.

## Scope

**In** — as scoped, annotated with what was actually delivered. The phase is
closed; see "What shipped, and what it measures" at the end of this document
for the end-state numbers.

- An autonomous squad: no scripted route, no leg sequence — **shipped**
- Building search over a known blueprint with unknown occupants — **shipped**
- Room clearing, stacking on doors, covering fire, falling back when hurt —
  **shipped in part, and this line is the one to distrust.** Only "room
  clearing" exists, and only as even slot spread around the target cell's
  centre. Stack, breach and cover were never built. Fall-back *was* built, in
  Plan A, and then **deleted** in Plan B after a paired measurement found it
  costing extraction rather than buying it (see Squad tactics below).
- A termination guarantee that survives the loss of `orders.js`'s watchdogs —
  **shipped**, as `MISSION_LIMIT` plus search monotonicity
- Ammunition and a reload cycle, with a hand-authored reload clip — **shipped**
- Melee survivability: more health, evasion while charging, a charge speed —
  **shipped**, with the evasion gate narrowed from `chasing` to `sprinting`
- Hard body collision between living agents — **shipped**, at the cost of five
  right-of-way mechanisms this spec never anticipated needing

**Out:**

- Fog of war. The squad knows the blueprint from the start (see Decisions).
- Hostile tactics. Hostiles keep phase C's reflex behaviour and their existing
  room patrol; only the squad gains a mind. Note that the patrol loop
  currently lives inside `orders.js` and must be relocated before that file is
  deleted — see Architecture.
- Any machine learning. This phase makes the environment more RL-shaped; it
  does not attempt RL.
- Networked or multi-squad play.

## The thing autonomy breaks

Every anti-hang guarantee on the branch lives in `orders.js`: `LEG_TIMEOUT`,
`LEG_MAX_REISSUES`, the reissue-exhaustion escape, the deliberate absence of
an escape in the extract phase. Phase C's own history is a warning here —
four separate stall classes were found and closed, and three of them were
only bounded because a watchdog eventually dragged the mission forward.

Deleting `orders.js` deletes all of it. **A replacement termination guarantee
is not a detail of this phase; it is a precondition for it**, and it lands in
the first task rather than the last.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Squad autonomy | Full — `orders.js` deleted | The phase B spec always reserved "real rescue logic" for phase D, and a squad that decides is the closest this project gets to the RL environment it kept on the table |
| Intel | Blueprint known, occupants unknown | A real team has building plans. It makes search a provably-terminating problem over a finite room set, and puts the tactical interest in ordering and clearing rather than in mapping. Fog of war is a much larger build and is explicitly deferred |
| Termination | Search completeness **and** a mission clock | Completeness alone is not enough: an agent stuck short of a room would hang forever. The clock is the backstop that turns "never finishes" into a bounded, observable failure |
| Outcome shape | `{ result, reason }` | `failed` alone cannot distinguish a wiped squad from a timeout, and a test that cannot tell them apart cannot catch a regression that swaps one for the other |
| Evasion | A multiplier on the attacker's hit chance, active only while sprinting | Fits the existing `hitChance` model with one term. Tying it to sprinting makes it "hard to hit a fast mover" rather than an arbitrary dodge stat, and it applies exactly during the exposure window it exists to fix |
| Ammo sizing | Small magazines, ~10 rounds | Measured: SWAT fire ~6 shots each per mission today, ~12 once clearing doubles contacts. A 30-round magazine would never empty and reload would be dead code — the same failure as phase C's `meleeDamage` and `sightRange`, both of which shipped inert and were reverted |
| Collision last | Body radius is the final task | It makes the yield/nudge/right-of-way machinery live for the first time — machinery that fired zero times across 790,000 agent-ticks in phase C — and it fights melee if the radius creeps up |

## Architecture

The pure/browser split holds. All new simulation modules are pure.

**Pure — no Babylon, no DOM, runs under Node:**

| File | Responsibility | Change |
|---|---|---|
| `raid/sim/director.js` | Objective state machine, outcome, mission clock, and hostile patrol | New |
| `raid/sim/search.js` | Next room to clear, given the graph and what has been visited | New |
| `raid/sim/squad.js` | Tactical execution — as shipped, even slot spread around the objective and nothing else (see the deviation below: stack/breach/cover never shipped, and fall back was built then deleted) | New |
| `raid/sim/orders.js` | — | **Deleted** |
| `raid/sim/combat.js` | Ammo, reload, evasion, melee stat block | Modified |
| `raid/sim/world.js` | Body radius, weapon-specific movement speeds | Modified |
| `raid/sim/path.js`, `navgrid.js` | Unchanged |

**Browser:**

| File | Responsibility | Change |
|---|---|---|
| `raid/reload-clip.js` | Hand-authored `Rifle_Reload`, adapted from `archive/rifle-wip` | New |
| `raid/agents.js` | Reload clip in the priority chain | Modified |
| `raid/main.js` | Wiring; HUD shows the outcome reason | Modified |

`search.js` is deliberately separate from `squad.js`: "which room next" is a
graph question with no notion of agents, and it should be testable without
constructing a world.

`director.js` (shipped under that name, not `mission.js` — see below) is the
top-level director — it ticks everything that is not the squad's tactical
brain, which includes the hostile patrol loop relocated out of `orders.js`.
That relocation is a lift-and-shift, not a rewrite: hostiles keep the
behaviour and the seeded `${plan.seed}:orders` stream they have today,
renamed to `${plan.seed}:mission`. Because renaming the stream changes every
hostile's patrol draws, replay hashes shift for every seed — expected, and
not a regression.

**Deviation from this spec:** the module shipped as `raid/sim/director.js`,
not `raid/sim/mission.js`. `mission` was already taken — it is the name this
codebase uses for `assignRoles()`'s return value (entry/hostage room ids,
spawns, door-depth map), which every module in this table already takes as a
parameter named `mission`. A factory called `createMission(plan, mission)`
returning a differently-meaning `mission` object would collide with that name
in every call site and every reader's head, for no benefit `director.js`
does not already deliver equally well. The seeded RNG stream above keeps the
name `${plan.seed}:mission` regardless — it is a string key with no import to
collide, so the rename pressure that forced the file's name never applied
to it.

**Deviation from this spec:** `squad.js` shipped without stack, breach, or
cover. What it actually does is even spread — each living member is placed
on its own fixed slot point around either the objective (advancing) or a rear
anchor (falling back), by `slotPoint(point, slot, total)` — plus the fall-back
rule described under Squad tactics below. There is no door-side staging
before entry (stack), no ordered first-member-in sequencing (breach), and no
hold-and-face-the-contact behaviour for members who are not the one currently
moving (cover): every member is simply issued its slot point and moves toward
it, all at once, whenever it has moved far enough to be worth a fresh goal.
The plan (`docs/superpowers/plans/`) records this honestly as a known thin
spot, but this spec is the durable, reference description of what shipped, and
until now it named all four mechanics as delivered. Plan B then removed the
fourth, fall back, on a paired measurement — so as of phase close `squad.js`
is slot spread and a per-tick `wants` speed, and nothing else. See "Squad
tactics" below for both corrections.

**Existing tests that import `orders.js` must be migrated, not deleted.**
`raid/tests/orders.test.js` and `raid/tests/dryrun.test.js` between them hold
the branch's anti-hang, casualty-bookkeeping and end-to-end guarantees, and
several were written to catch specific defects that cost multiple fix rounds
to find. Each assertion needs a home against the new modules before
`orders.js` goes. Assertions that are genuinely about scripted legs — the leg
watchdog, reissue exhaustion — retire with the mechanism, and that retirement
should be listed explicitly rather than happening by deletion.

### Mission state and termination

```
phase    'search' | 'rescue' | 'extract' | 'done'
result   null | 'success' | 'failed'
reason   null | 'extracted' | 'squad-lost' | 'hostage-killed' | 'timeout'
```

Two independent guarantees:

1. **Search completeness.** The blueprint is finite and each room enters the
   visited set at most once, so the sweep cannot cycle.
2. **`MISSION_LIMIT` ticks.** Exceeded → `failed` / `timeout`. This is the
   backstop for everything completeness does not cover: an agent that cannot
   reach a room, a squad pinned in a firefight, a pathological map.

`MISSION_LIMIT` starts at **10,800 ticks (180 simulated seconds)** and is
confirmed or moved by measurement. The reasoning: phase C measured a 41s
median and a ~67s worst case, and this phase makes missions longer by adding a
building sweep, so the ceiling must clear a healthy swept run with real margin
while staying under the 400s harness ceiling that would mask a hang. Record
the measured worst healthy completion alongside the final value; if it lands
within 2x of the limit, the limit is too tight.

**Shipped at 12,000 ticks (200s)**, having gone 6,000 → 9,600 → 12,000, each
raise following a measurement rather than a guess. The 10,800 above was never
the shipped value and, worse, it sat *above* the dry-run harness's tick
ceiling of the day, so a genuine clock `timeout` would have been laundered
into "the mission never resolved" — the one verdict the constant exists to
make observable. The invariant that came out of that is now load-bearing:
**`MISSION_LIMIT` must sit below any headless harness's own loop bound.**
`dryrun.test.js`'s `MAX_TICKS` is held at 15,600, 1.3x above the clock, and
moves with it.

12,000 was sized against an uncapped 2,500-mission sweep (median 2,688, p90
5,921, p99 7,544, max 8,619) and the all-time worst run ever observed for this
squad, 8,757 ticks — a margin of 1.370x. The tail then collapsed when the
fall-back rule was removed and has stayed collapsed: over **68,000 missions**
measured across phase close and its review, median **2,343**, p90 3,292, p95
3,622, p99 4,267, and p99.9 **4,814** on healthy runs.

**Do not read that margin as slack. `MISSION_LIMIT` is not a backstop against
a hang class that no longer exists — it is the sole terminator of one that
still does.**

Seed **`RVX-11-133`** (11 rooms) does not terminate. It is reported as
`failed` / `timeout` only because this clock fires at 12,000; run against a
copy of the tree with the clock raised to **200,000 it still has not
resolved**, with `_goalStrikes` ratcheting monotonically to 2,074 and nudges
to 2,078. The cause is not body collision. In the extract phase the last
living SWAT is pinned at `x = 9.0023` bit-identically for the entire run,
oscillating in `z` between 7.11 and 7.47, with no living agent within 20m and
no prop within 3m. Its `pathIndex` has advanced past the corner waypoints that
routed it round a wall, so it steers straight at its goal through the geometry
the route was shaped to avoid — the corner-cut failure the `arriveReach`
comment in `world.js` warns about for the body-relaxation case, happening here
on the plain `arriveRadius` path. The hostage is already at the extraction
point; only that one wedged member prevents a success.

Rate is roughly **1 in 40,000 missions**, which is why a 28,000-mission sweep
reported "zero hangs" in good faith and was wrong. Two properties this
document claims elsewhere are weaker than they read because of it:

- **"A mission always resolves"** is true only in the sense the clock makes it
  true. Remove or raise `MISSION_LIMIT` and this seed runs forever.
- **The oscillation guarantee does not cover this.** `dryrun.test.js`'s
  still-run tracker reads **25** on this mission, because the agent oscillates
  rather than freezes — precisely the class that file's header names ("an
  agent that only oscillates must score as badly as one standing perfectly
  still"), and which is covered only synthetically. `timeout` reachability is
  likewise covered only synthetically, by spinning the clock.

So the constant is deliberately **not lowered**, and the reasoning is the
opposite of "cheap headroom": lowering it would convert healthy long missions
into timeouts *without touching the hang it exists to bound*, and it would
drag `dryrun.test.js`'s `MAX_TICKS` down in lockstep. The margin to reason
from is the one over **healthy** completions — about **2.5x** (12,000 /
4,814 at p99.9) — not a margin over a population that includes a mission with
no finish line at all.

### Search

`nextRoom(graph, visited, from)` returns the nearest unvisited room by door-graph
distance from the squad's current room, ties broken by room id for determinism.
A room becomes **visited** the moment a squad member is inside it, and never
reverts. That monotonicity is the whole completeness argument, so search must
key on nothing else. In particular it must not key on "cleared of hostiles":
a hostile the squad cannot kill, or one that wanders in behind them, would
leave a room permanently unvisited and send the sweep round forever.

Whether a room currently holds a living hostile is a question the tactical
layer asks on demand, computed from agent positions. It is not stored state
and there is no `cleared` flag to keep in sync.

The hostage is found by sight, not by lookup — the squad has no idea where it
is until a member sees it. Search ends the moment it does.

### Squad tactics

Per-member roles assigned each tick from a single squad state, never randomly:

- **Stack.** Before entering an unvisited room, members gather at the door on
  the near side rather than filing through as they arrive.
- **Breach.** One member enters first; the others follow once it is inside.
- **Cover.** While one member moves, the others hold position facing the
  contact direction and do not advance.
- **Fall back.** A member below a health threshold retreats toward the squad's
  rear and stops advancing until it is no longer the most exposed (bounded in
  time, not by hp — see `squad.js` for why).

These are unit assignments derived from squad state, not scripted sequences.

**Did not ship — see the deviation note under Architecture above.** Stack,
breach, and cover as described above were never built. What shipped is even
slot spread around the objective (a standing-in for "advance" with no
staging or ordering). Treat the four bulleted items above as the original
design intent, not as delivered behaviour.

**Fall back shipped, and was then removed.** Plan A built it as described.
Plan B's first task deleted it, and it is not in the tree. The reason is
measured, not aesthetic: a paired, same-seed comparison of the two committed
states over **900 seeds** (three fresh 300-mission families) gave a McNemar
χ² of **19.1, p ≈ 1e-5** — **107** seeds that lost with the rule present won
without it, against **51** the other way, pooling to about **+6.2 points of
extraction** for removing it. Squad wipes and mission length improved
alongside, with zero timeouts in every configuration, so none of the rule's
cost came back as fewer hangs. The rule's own stated purpose above — "until it
is no longer the most exposed" — was never built either: there was no rejoin
condition, only a fixed timer, and a hurt member pulling itself out is one
fewer gun on the firefight that is actually killing the squad. The naive
unpaired deltas were noisier and family-dependent (+9.0 / +9.7 during
development, +8.0 / +6.0 / +4.7 on the paired families); the McNemar figure is
the one to quote.

### Ammo and reload

One field: `ammo`, rounds in the current magazine. Firing decrements it; at
zero the agent reloads for `reloadTime` seconds, during which it cannot fire.
Spare magazines are unlimited.

Starting values: `magazineSize` 10, `reloadTime` 1.8s.

**A finite spare-magazine count is deliberately not modelled, and neither is
running dry.** SWAT fire ~6 shots each per mission today and ~12 once clearing
doubles contacts; any plausible spare count — three magazines is thirty rounds
— can never be exhausted, so the count and the out-of-ammo melee fallback it
would gate are provably dead code before a line is written. Phase C shipped
three such constants and a reviewer had to find and revert them. One field is
enough to make reload real.

**Acceptance criterion: reload must actually occur in a substantial fraction
of missions.** If measurement shows it firing rarely, the magazine size
changes or the feature is reported as not delivered. It must not ship as
decoration.

**Shipped at `magazineSize` 10 and `reloadTime` 1.8s, both untouched by
tuning. Criterion met.** Measured at phase close over 10,000 fresh missions
(two disjoint 5,000-mission families, which agree to within half a point on
every figure):

Every row is **SWAT-scoped**, like the two rows that name SWAT explicitly:
gun-armed hostiles reload too, and counting them raises the first row to 74.5%
against 73.5% SWAT-only. The squad is what the magazine was sized for, so the
squad is what these measure.

| | measured (SWAT only) |
|---|---|
| Missions with at least one reload | **73.8% / 74.3%** |
| Reloads per mission | 1.56 / 1.59 |
| Reloads per SWAT member per mission | 0.390 / 0.398 |
| Shots fired per SWAT member per mission | **8.30 / 8.35** |

**Read the sizing honestly: this constant is marginal by construction.**
Demand is ~8.3 shots per member against a magazine of 10 — *below* the
threshold, not comfortably above it — so most members never empty a magazine
at all and the ~74% comes from above-average encounters. That makes the reload
rate highly sensitive to `magazineSize`, in both directions. It is not
decoration (three quarters of missions contain one, and the shipped 8.3 is
also well clear of the 30-round magazine that would have made it dead code),
but a future change that shortens missions or thins the hostile population
could push it toward inert, and the number to re-check is this one.

The spec's own pre-build estimates were "~6 today, ~12 once clearing doubles
contacts". The first was low and the second high; the truth landed between
them at 8.3-8.5, close enough that the 10-round decision survives, and an
earlier draft's "roughly a dozen" is withdrawn.

Cost of the feature, paired on 400 same-seed missions across both trees:
extraction **46.5% → 43.5%**, McNemar **p ≈ 0.10 — not significant at
n=400**. Do not quote a cross-family figure for this; the paired one is the
measurement. The mechanism behind whatever cost is real is known and still
open: `world.js`'s gun-halt branch has no reload awareness, so a SWAT member
that empties a magazine while holding a firing position stands motionless for
the full ~1.85s.

**One field became two.** `world.hash()` covers `ammo` *and* `reloadUntil`,
not `ammo` alone as specified below under Testing. Measured over 652,466
snapshots, `ammo === 0` occurs 5,262 times while reloading and 96 times while
not, so `ammo` alone cannot reconstruct reload state and a diverging reload
would replay as identical.

### Evasion and melee survivability

```
hitChance = accuracy × falloff × (1 − target.evasion)
```

`evasion` is 0 for every agent except a melee agent that is currently
`chasing`, which gets `meleeEvasion`. Starting values: `meleeHp` 160,
`meleeEvasion` 0.35, `meleeChargeSpeed` 4.0.

Rationale for the magnitude: crossing 10m at 3.2 m/s takes ~3.1s, which is
~15 shot opportunities against four rifles at `gunCooldown` 0.8s. At a
mid-range hit chance around 0.35 that is ~5 hits, or 125 damage against 80 hp
— dead well before contact. Evasion at 0.35 cuts that to ~3.4 hits, and 160 hp
survives it. All three numbers are tuned by measurement, not asserted.

**Shipped at exactly those three values — none of them moved.** What did move
is the gate. **`evasion` keys on `sprinting`, not `chasing`**, where
`sprinting = chasing && distance >= meleeRange * 0.75`. `chasing` spans the
whole engagement window, including the back half in which the charger has
arrived at strike distance and `world.js` is holding it perfectly still:
measured, **67.6%** of a chasing melee agent's evaded shots were landing
during that stationary hold rather than during the approach the stat was
specified for. Under the shipped gate, **98.1%** of evaded shots are against a
genuinely moving target. The two-line paragraph above this one is the design
intent; `sprinting` is the delivered behaviour, and the sentence naming
`chasing` is wrong.

One consequential side effect: `hitChance` gained a `target` parameter and a
`[0, 1]` clamp (it previously clamped at 0 only, so the linear gun falloff
could return a negative "probability" past 2x `gunRange`).

`hostileAccuracy` was retuned **0.75 → 0.70** as part of this, and is the only
constant in the phase moved purely to buy back mission failure rate. It
governs gun-armed hostiles only — `accuracyOf` routes melee to
`meleeAccuracy` unconditionally — so it cannot touch a charger's own hit
chance; it works by hostiles losing more of their own gunfights. Raising
`swatAccuracy` instead was tried and reverted: this lever does strictly better
at the same failure rate.

**Measured result — this is the subsystem that delivered most.** Melee
hostiles that ever land a hit went from **26.8% / 29.0%** before the change to
**55.0% / 56.7%** after (paired families, n=300 each, 600 chargers per
family); missions containing at least one landed melee hit went **46-48% →
77%**. Re-measured at phase close with collision also live, over 2,000 fresh
missions and 4,000 chargers: **56.0% ever land a hit**, **60.0% ever swing**,
**78.4% of missions contain a landed hit**, per-swing land rate 75.7%. Melee
is a real threat rather than a decoration, and this is the claim the phase
most clearly made good on.

The purchase price was **8.7-10.7 points of extraction** for ~28 points of
engagement. An un-gated first version bought 3 more points of engagement for
14-15 points of extraction, which is what motivated finding the `sprinting`
gate rather than accepting the trade.

**Where the remaining gap is, and why it is not fixable here.** Of 10,000
chargers measured at phase close, **38.0% never acquire a target at all** — no
SWAT member ever came within `sightRange` with line of sight before the
mission ended. Conditional on ever acquiring one, **98.1% go on to swing**. So
essentially the entire residual is *placement*: hostiles the squad never
reaches, in rooms it never sweeps or reaches only after resolving elsewhere.
No survivability constant can move it; only a change to hostile placement,
hostile mobility between rooms, or the squad's coverage could. This is worth
stating plainly because it bounds what any future melee tuning can achieve:
the ceiling on "chargers that swing" is about 62% at current placement.

### Hard body collision

Living agents get `bodyRadius` 0.25m, so two bodies cannot close within 0.5m.
Three existing distances have to stay ordered, and the ordering is
load-bearing enough to assert as a test rather than trust:

```
2 * bodyRadius (0.50)  <  meleeRange * 0.75 (0.90)  <  meleeRange (1.20)
                       and  2 * bodyRadius  <  SIM.separation (0.75)
```

The middle term is where a charging melee agent actually stops (`world.js`
holds a chaser at three quarters of melee range), so if hard collision blocked
before that point, chargers would freeze just outside their own strike
distance and melee would break entirely — silently, since they would still
look like they were closing. Soft separation acting at 0.75m before hard
collision at 0.50m is also deliberate: the existing steering force gets to
resolve most crowding before the hard constraint ever engages.

Enforced with the same integrate-then-verify-and-slide pattern `world.js`
already uses for walls: propose the step, reject it if it lands inside another
living agent, then retry each axis independently. Corpses do not block, as
decided in phase C.

This is the task most likely to destabilise movement, because it makes the
yield, nudge and right-of-way machinery reachable for the first time. Those
paths are correct and tested but have never run in a real mission.

**Shipped at `bodyRadius` 0.25, and this prediction was correct — it was the
most expensive task in the phase.** The machinery was *not* correct: making it
reachable exposed five distinct deadlock classes, every one of which had to be
closed before the radius could ship, and none of which the yield/nudge/id
rules as designed could resolve.

1. **An axis slide cannot get past a circle.** At a diagonal contact both
   world-axis slides still move the agent inward, so it stops dead at touching
   distance. Measured: zero displacement for 662 consecutive ticks, strikes
   ratcheting 37 → 124. Closed by a fourth fallback, a **contact-tangent
   slide** (the desired direction with its component along the contact normal
   removed), plus an `id % 2` tie-break for the exactly-head-on case where the
   projection is degenerate.
2. **Nobody can yield to an agent that wants nothing.** The captive hostage
   takes the no-orders branch every tick and so resets its own bookkeeping,
   which disqualified it from ever being a stand-off partner. 779 still ticks.
   Closed by a **parked right-of-way** rule, and by testing rivals on actual
   `speed` rather than on strike count.
3. **The nearest-blocker id rule cannot settle a cluster.** In a knot of three
   or four touching agents, every member's *nearest* neighbour can outrank it,
   so all of them nudge and none yields. Four SWAT held bit-identical
   positions for **11,185 consecutive ticks**. Closed by settling right of way
   against **the whole contact set**, not the nearest blocker.
4. **Right of way held by an agent that cannot use it.** Deferring to a senior
   neighbour that is itself sealed in is deferring forever. 11,069 still
   ticks. Closed by a **last-resort tier** at three strikes.
5. **`setGoal` re-arming the stall ratchet.** `squad.js` re-issues an
   objective roughly every 60 ticks against a 90-tick detection window, so a
   wedged agent was handed a clean bill of health before it could ever accrue
   a strike — neither the nudge nor the yield could fire at all. Closed by
   carrying the ratchet across a re-issue: `setGoal` re-measures the agent's
   recorded best distance against the new destination instead of discarding
   it, which leaves a repeated goal unchanged and a genuinely new one cleared.

None of those five are in this spec, and the last one is a *behaviour* change
to a shared function, not merely a new mechanism. That is the honest scope
report for this section: the spec asked for integrate-then-verify-and-slide,
and integrate-then-verify-and-slide alone deadlocks.

Measured cost, paired on identical seeds, 4,000 missions per radius:

| `bodyRadius` | extraction | worst still-run |
|---|---|---|
| 0 (inert) | 37.98% | 85 |
| 0.15 | 33.65% | 290 |
| 0.20 | 32.38% | 402 |
| **0.25 (shipped)** | **29.55%** | 295 |
| 0.30 | 27.10% | 381 |

Extraction is **strictly monotone in the radius, about 3 points per 0.05m,
with no cliff** — so there is no "safe" radius the shipped value overshot, and
0.25 costs roughly **8.4 points** against bodies being inert. The cost is
**mortality under congestion, not residual jamming**: mean mission length is
unchanged across radii (2,352 vs 2,362 ticks at 0 and 0.25), while mean SWAT
lost rises 2.23 → 2.62 of 4. Agents that cannot walk through each other bunch
up in doorways and die there.

The still-run column is **not** a reliable function of the radius and should
not be read as one: at 4,000 missions a radius it is not even monotone, being
set by events rare enough that a four-figure sample resolves their order as
noise. Over 16,000 missions at the shipped 0.25, the worst is 403 ticks and
nothing reaches 491. Overlap is exactly 0.000m — the hard constraint itself
never leaks.

The three constant relationships above are asserted in `world.test.js`, and
`arriveReach` had to be added so a waypoint that lands inside a living body is
still reachable: arriving means getting as close as the body allows, which is
a relaxation of up to `arriveRadius + 2 * bodyRadius` = 0.78m on a final
waypoint. That is smaller than every tolerance downstream of it
(`SQUAD.reissueDistance` 1.5m, extraction radius 3m); tightening either below
0.78m has to revisit it.

## Build order

1. Mission state, outcome and the clock — the termination guarantee first
2. `search.js` and autonomous navigation; `orders.js` deleted
3. Squad tactics: stack, breach, cover, fall back
4. Melee survivability: evasion, health, charge speed
5. Ammo and reload, sim then render clip
6. Hard body collision
7. Measure and tune

Tactics precede melee because clearing roughly doubles the population melee
stats apply to; tuning melee first would tune against a denominator that is
about to change. Collision is last for the reason given above.

**What the build order actually became.** The phase shipped as two plans, and
step 3 above is the step that did not happen as written — the same correction
as in Scope, repeated here because this list is the other place a reader will
look and take at face value.

- **Plan A** (`docs/superpowers/plans/2026-08-01-raid-phase-d-a-autonomous-squad.md`)
  delivered steps 1 and 2, plus the *only* part of step 3 that exists: even
  slot spread, and a fall-back rule. Stack, breach and cover were never built.
- **Plan B** (`docs/superpowers/plans/2026-08-03-raid-phase-d-b-combat-systems.md`)
  delivered steps 4, 5, 6 and 7, and opened with an extra task that is not in
  this list at all: **deleting** Plan A's fall-back rule, on the measurement
  recorded under Squad tactics. It was put first deliberately, so that
  everything after it tuned against a fixed squad-survival baseline rather
  than a moving one.
- Within Plan B the order is 4, 5 (simulation), 6, then 5 (the render clip)
  and 7. The clip moved behind collision so that all three *simulation*
  changes landed, and were measurable together, before any renderer work
  began. Collision stayed last, as this spec requires.

## Testing

**Coverage is now a measurable win condition, not a nice-to-have.** Measured
today: the squad enters 55% of cells and meets 50% of hostiles. If tactics do
not move those substantially, they did not work, and the test suite should say
so.

**Outcome: they moved, and the suite does say so.** Re-measuring the scripted
route this phase deleted, under the same marking rule and on the same 1,000
fresh seeds, gives 52.5% coverage and 48.1% hostile encounter; the autonomous
squad gave 77.0% and 65.7%. `dryrun.test.js` gates the coverage half of that
at an aggregate 0.7 floor — a bar the scripted route could not have passed in
either aggregate or per-seed form. At phase close, with all four subsystems
live, the figures settle at **73.1% coverage and 58.2% hostile encounter**;
see the closing section for why both gave back a few points.

Pure, under `node --test`:

- `search.js` visits every reachable room, never repeats one, and is
  deterministic for a given graph
- A mission always resolves with a reason, on every room count, within
  `MISSION_LIMIT` — the anti-hang guarantee, and the direct replacement for
  the watchdog tests being deleted with `orders.js`
- Every distinct `reason` is reachable across a seed set; a reason that never
  occurs is untested code
- No two living agents ever overlap once collision lands
- `bodyRadius * 2 < meleeRange`, asserted as a constant relationship
- Reload occurs in a substantial fraction of missions
- A reloading agent cannot fire until the reload completes
- Determinism: same seed and tick count, identical `world.hash()` — which must
  grow to cover `ammo`, or a diverging fight replays as identical

Measured and reported, not gated: map coverage, hostile encounter rate, melee
engagement rate, mission outcome split, reload frequency, and worst-case
completion.

**Every number in this spec is a starting point.** Phase C shipped three
constants that measurement later proved inert, and they had to be found by a
reviewer and reverted. Any constant introduced here that cannot be shown to
change an outcome should be removed rather than kept.

**All eight test obligations above shipped and pass** — but read the second
one narrowly. "A mission always resolves within `MISSION_LIMIT`" is satisfied
*by* `MISSION_LIMIT`, on at least one seed that would otherwise never resolve
at all (see Mission state and termination). The suite cannot currently tell
those two cases apart, and the two obligations that would — end-to-end
oscillation detection, and a `timeout` earned by a real mission rather than by
spinning the clock — are the phase's clearest coverage gap.

Two further notes on how:
`world.hash()` covers `ammo` *and* `reloadUntil`, for the reason given under
Ammo and reload; and the collision task's own coverage grew the suite from 162
to 177 tests, which is where most of the phase's test growth landed. The suite
is **177 tests, 0 failures**, stable across five concurrent runs.

Two of these obligations were harder to keep honest than to write, and both
failures are worth carrying forward:

- **A fixed seed cannot guard a behaviour in a system whose every combat
  constant is being retuned.** Three end-to-end tests were stranded by the
  melee retune. Re-seeding one of them produced a replacement that *looked*
  right and guarded nothing — deleting the line it existed to protect left
  that seed's mission byte-identical. The fix that held was to remove the
  dependency instead: neutralise the hostiles so the test exercises search and
  escort rather than a coin flip, or rebuild the state by hand in a unit test.
- **A test threshold is not a tuning knob.** A missed target is a defect to
  investigate. This was crossed once in the phase — a still-run bar was raised
  rather than met — and caught in review. The bar that finally shipped is
  split explicitly into a derived part (the recovery machinery's own cycle
  time) and a measured-headroom part, in those words, so that a future reader
  can tell which half is arithmetic and which half is a sample.

## Risks

- **Body radius may deadlock.** The yield, nudge and right-of-way machinery is
  correct and tested but has never fired in a real mission. Expect this task
  to surface stalls; that is why it is last.
- **Scope.** Four subsystems in one spec, at the owner's explicit direction and
  against a recommendation to split them — roughly four times the surface of
  phase C, which took ten tasks and twenty-six commits. The build order is what
  keeps it sequenceable. If the plan outgrows one document, split it at a
  numbered boundary, never mid-subsystem.

Termination and `world.hash()` coverage are the other two ways this phase
could go wrong, and both are stated where they are acted on rather than
repeated here.

**How the risks landed.** Both fired. Body radius deadlocked, in five distinct
ways rather than one, and the machinery this section calls "correct and
tested" was neither once it was actually reachable — see Hard body collision.
Scope did outgrow one document, and was split at a numbered boundary as this
section requires: Plan A (autonomy, search, the clock) and Plan B (the three
combat systems, plus the fall-back deletion and this closeout).

---

## What shipped, and what it measures

This section is the phase's end state. It exists so that this document can be
read on its own, without the two plans and the progress ledger.

### Final constants

| Constant | Spec | Shipped | Moved by |
|---|---|---|---|
| `MISSION_LIMIT` | 10,800 | **12,000** | measurement, twice |
| `magazineSize` | 10 | **10** | — |
| `reloadTime` | 1.8s | **1.8s** | — |
| `meleeHp` | 160 | **160** | — |
| `meleeEvasion` | 0.35 | **0.35** | — |
| `meleeChargeSpeed` | 4.0 | **4.0** | — |
| `bodyRadius` | 0.25 | **0.25** | — |
| `hostileAccuracy` | 0.75 (phase C) | **0.70** | melee retune |
| `chargeRange` | — | **10** | melee sweep |

Every starting value in this spec survived measurement except `MISSION_LIMIT`.
The two constants that did move are recorded above rather than left implicit,
because the phase's own rule is that a constant which cannot be shown to
change an outcome should be removed: all nine can.

The final tuning pass moved **nothing**. Its three trigger conditions —
reload firing rarely, melee engagement not improving, `MISSION_LIMIT` margin
falling under ~1.3x — all measured comfortably clear, and the discipline that
a missed target is a defect rather than a threshold cuts both ways: an unmet
target is not a licence to move a constant either.

### Final measured end state

Over **10,000 fresh missions** across room counts 8-12, on two disjoint
5,000-mission seed families that agree to within half a point on every figure
below (a further 18,000 missions were run for the radius comparison and the
melee and recovery probes; 28,000 in total):

**Rates are stable; tail figures are sample maxima and are labelled as such.**
Every rate below reproduced within noise on an independent 40,000-mission
re-measure across five further families. The tail rows did not, and the
distinction matters more than the numbers do: a rate converges at n=10,000, a
maximum only ever reports the largest thing that particular sample happened to
contain. Read every "worst" and "max" here as "the worst seen in n missions",
never as a bound.

| | measured | n |
|---|---|---|
| Extraction (`success` / `extracted`) | **29.6% / 29.7%** | 10,000 |
| `squad-lost` | 44.3% / 44.3% | 10,000 |
| `hostage-killed` | 26.1% / 26.0% | 10,000 |
| Mean SWAT lost | 2.64 / 2.63 of 4 | 10,000 |
| Cell coverage | 73.1% / 73.2% | 10,000 |
| Hostile encounter rate | 58.2% / 58.4% | 10,000 |
| Melee chargers that ever swing | 60.8% / 60.6% (56.0% land a hit) | 10,000 |
| Missions with a melee swing | 82.3% / 82.0% | 10,000 |
| Missions with a reload (SWAT only) | 73.8% / 74.3% | 10,000 |
| Right-of-way yields | 0.86 / 0.81 per mission | 10,000 |
| Tie-break nudges | 0.72 / 0.70 per mission | 10,000 |
| Mission ticks | median 2,343, p90 3,292, p95 3,622, p99 4,267 | 68,000 |
| `timeout` | **1 known**, `RVX-11-133` — see Mission state and termination | 68,000 |
| Unresolved / non-terminating | **1 known**, the same seed, ~1 in 40,000 | 68,000 |
| *Sample max*: mission ticks (healthy) | 5,154 at n=28,000; **p99.9 4,814** at n=68,000 | 68,000 |
| *Sample max*: worst still-run | 403 at n=16,000; **831** at n=40,000 (5 >=440, 3 >=491, 0 >=913) | 56,000 |

The last three rows previously read `timeout | 0`, `unresolved | 0` and
`worst still-run | 403`, presented as end-state properties. All three were
contradicted by the larger sample. That is the failure mode this table now
guards against by construction: **the still-run maximum doubled between
n=16,000 and n=40,000, and no amount of further sampling would make it a
property.**

### The cost, stated plainly

**Extraction fell from 45.9% at the end of Plan A to 29.6% at phase close.**
No single change did that, and the spec should not leave a reader to guess:

| step | extraction | how measured |
|---|---|---|
| End of Plan A | 45.9% | n=1,000 |
| Fall-back rule deleted | ~54% *(unpaired; the paired delta is +6.2, so 52.1 is the like-for-like endpoint — the two bases differ and the column does not sum through this row)* | +6.2 paired, p ≈ 1e-5, n=900 |
| Melee survivability | 40-43% | −8.7 to −10.7, n=300 x2 |
| Ammo and reload | −3.0 | paired, p ≈ 0.10 at n=400 — not significant |
| Hard body collision | −8.4 | paired, n=4,000 per radius |
| Phase close | **29.6%** | n=10,000 |

Two of those are worth being precise about. The reload cost is **not
statistically established** — it is the honest paired estimate, and at n=400
it could be zero. The collision cost is the largest single item in the phase
and is **mortality, not jamming**: mission length is unchanged across radii,
while SWAT deaths rise. Coverage (77.0% → 73.1%) and hostile encounter (65.7%
→ 58.2%) fell for the same reason and are downstream of it — a squad that dies
sooner sweeps less of the building.

This is a deliberate trade, not a regression that went unnoticed: each of
those three subsystems was measured, reviewed and accepted on its own before
the next landed. Whether a **29.6% extraction rate is the right difficulty**
is a design question this phase does not settle, and the one thing a future
phase should decide first. What the model is not is degenerate — every
outcome occurs at double-digit rates, and the spec's own test ("a combat model
where SWAT always win is as broken as one where they always lose") is met.

### Known-open, carried out of the phase

- **A non-terminating stall exists: seed `RVX-11-133`.** The headline item, and
  the only one that is a correctness bug rather than a rough edge. A lone SWAT
  member cuts a corner past its own route's waypoints in the extract phase and
  oscillates against the wall forever; `MISSION_LIMIT` is the only thing that
  ends the mission. Full diagnosis under Mission state and termination. Rate
  ~1 in 40,000. Two consequences for whoever picks this up: it is a
  **path-following** defect, not a collision one (no other agent is within
  20m), and it is **invisible to every stall signal the project has**, because
  the agent moves the whole time.
- **The oscillation guarantee has no end-to-end coverage.** `dryrun.test.js`
  asserts that an oscillating agent scores as badly as a frozen one, and the
  seed above shows the tracker reading 25 on a mission that never terminates.
  The property is real but is only exercised synthetically. Same for `timeout`
  reachability, which is tested by spinning the clock rather than by a mission
  that earns one.
- **A reloading shooter stands still.** `world.js`'s gun-halt branch has no
  reload awareness, so a SWAT member that empties a magazine while holding a
  firing position is motionless for the full ~1.85s. This is the mechanism
  behind the reload extraction cost, and closing it is the cheapest available
  way to buy some of it back.
- **`setGoal` resets none of the five recovery timers.** Deliberate — carrying
  the stall ratchet across a re-issue is what closed deadlock class 5 — but it
  means a genuinely re-tasked agent can carry a live yield or nudge into a new
  destination. Measured: of 137,406 `setGoal` calls over 2,000 missions, 85
  (0.06%) land while a yield is live and 50 (0.04%) while a nudge is. Missions
  where it happens have a *lower* worst still-run (197 vs 338) and a *higher*
  extraction rate (39.1% vs 29.9%) than those where it does not — **but that
  comparison is a selection effect, not evidence of no cost, and should not be
  cited as though it were.** A carry requires a live recovery timer AND a
  genuine re-task, which is likelier in a long, mobile, still-winnable mission
  than in one where the squad is already dead; the two groups are not
  comparable populations. What the numbers do support is a bound on *exposure*
  — 0.06% of goal issues, 0.16% of live agent-ticks spent yielding at all —
  and that is the whole basis for leaving it alone. Establishing that the
  carry is harmless would need a paired A/B against a tree that clears the
  timers, which was not run.
- **A one-tick window mismatch between sim and renderer.** `combat.js` treats
  the tick equal to `reloadUntil` as still reloading; `agents.js` treats it as
  finished. Recorded, harmless at 60fps, not changed.
- **An interrupted reload restarts rather than resumes**, so a reload that
  takes a hit never reaches the magazine-rack phase of the clip before its
  108-frame window closes.
- **Melee engagement is placement-bound at about 62%.** See Evasion and melee
  survivability. No constant in this spec can move it.
