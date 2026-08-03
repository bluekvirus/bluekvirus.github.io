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

**In:**

- An autonomous squad: no scripted route, no leg sequence
- Building search over a known blueprint with unknown occupants
- Room clearing, stacking on doors, covering fire, falling back when hurt
- A termination guarantee that survives the loss of `orders.js`'s watchdogs
- Ammunition and a reload cycle, with a hand-authored reload clip
- Melee survivability: more health, evasion while charging, a charge speed
- Hard body collision between living agents

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
| `raid/sim/squad.js` | Tactical execution: stack, breach, cover, advance, fall back (see deviation below — stack/breach/cover did not ship) | New |
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
moving (cover): every non-fallen-back member is simply issued its slot point
and moves toward it, all at once, whenever it has moved far enough to be
worth a fresh goal. The plan (`docs/superpowers/plans/`) records this
honestly as a known thin spot, but this spec is the durable, reference
description of what shipped, and until now it named all four mechanics as
delivered. See "Squad tactics" below for the corresponding correction.

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
staging or ordering) and the fall-back rule as described. Treat the three
bulleted items above as the original design intent, not as delivered
behaviour.

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

## Testing

**Coverage is now a measurable win condition, not a nice-to-have.** Measured
today: the squad enters 55% of cells and meets 50% of hostiles. If tactics do
not move those substantially, they did not work, and the test suite should say
so.

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
