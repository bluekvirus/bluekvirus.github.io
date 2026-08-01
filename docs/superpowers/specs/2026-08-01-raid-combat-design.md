# Design: Raid — combat

## Goal

Make the raid a fight. Hostiles engage the SWAT squad with guns and melee
weapons, both sides take damage and die, and the mission can now be lost.

This is phase C of the raid work. Phase A generates the world, phase B moves
everyone through it, and this phase gives them something to do when they meet.
Phase D still replaces the decision layer wholesale.

## Scope

**In:**

- Per-figure skeletons, so twelve figures can animate independently
- Weapon loadouts assigned at generation: every SWAT a gun, hostiles split
  between guns and melee weapons
- Target acquisition over exact line of sight, with closed doors stopping
  bullets
- Firing, melee strikes, damage, death
- A reflex engagement rule: an agent that sees an enemy stops and fights
- A real mission outcome — `success` or `failed` — replacing "reached the last
  phase"
- Visible weapons in the hands that carry them
- Combat clips: pointing, firing, striking, taking a hit, dying

**Out:**

- Ammunition and reloading. The phase B spec listed these under phase C, and
  they are dropped deliberately — see Decisions.
- Squad tactics: covering fire, room clearing, stacking on doors, falling back.
  Still phase D. `orders.js` gains bookkeeping, not judgement.
- Hard body collision between agents. See Decisions.
- Any machine learning.

## The prerequisite nobody can skip

`raid/cast.js` loads one GLB per role and clones it. Babylon's
`TransformNode.clone()` does not clone the `Skeleton` of a skinned child mesh,
so **all four SWAT share one skeleton and all seven hostiles share another** —
three skeleton instances for twelve figures. `raid/agents.js` is built around
that constraint: it keeps one rig per *skeleton*, not per figure, and drives it
from a single representative agent.

That is survivable while everyone in a group is doing the same thing. Combat
ends it:

- One hostile dies and all seven collapse into the `Death` pose.
- One SWAT fires while another sprints — impossible; they share a pose.
- A melee hostile swings and every other hostile swings with it.

`cast.js:8-18` already records this as a debt owed to "a later task". This is
that task. Per-figure animation is a prerequisite for phase C, not a
nice-to-have, and it lands first.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Per-figure rigs | `AssetContainer.instantiateModelsToScene()` | Babylon's supported path to independent skeletons and animation groups per instance. The alternative — keeping shared skeletons and swapping dead figures for statically posed meshes — buys nothing and cannot solve "one shoots while another runs" at all |
| Where combat lives | New pure `raid/sim/combat.js` | `world.js` is already 537 lines. Combat is a separable concern with a narrow interface: it reads agents and the grid, and writes damage |
| Line of sight | Reuse `hasLineOfSight` from `path.js` unchanged | It was made an exact cell traversal specifically for this. `path.js:169` says so: "in a later phase, ranged line of sight (a bad approval there is a bullet passing through a wall)" |
| Engagement | Per-agent reflex, `orders.js` keeps its scripted route | Keeps the phase C/D boundary exactly where the phase B spec drew it. Squad-level judgement stays phase D's job |
| Hit resolution | Seeded roll from the existing `${plan.seed}:sim` stream | Determinism is the test oracle and the RL contract. A fight that cannot be replayed cannot be debugged |
| Mission outcome | Explicit `success` / `failed`, tests assert only that it resolves | Either side can plausibly win. Gating a win *rate* would make balance constants load-bearing on the suite; the rate is measured and reported instead |
| Ammo and reload | Dropped | The Quaternius pack ships no `Reload` clip — verified across all 24 clips in all ten GLBs. The chosen loadout model produces melee from weapon assignment, not from dry magazines, so reloading would be a hand-authored pose for a mechanic nothing depends on |
| Body radius | Not added; soft separation stays the model | Melee argues against it: chargers must reach ~1m, soft separation already permits that, and hard bodies would both obstruct melee and make the never-exercised deadlock-recovery paths live for the first time. This closes the open ledger item with a decision rather than code |

## Architecture

The pure/browser split holds. Combat is pure.

**Pure — no Babylon, no DOM, runs under Node:**

| File | Responsibility | Change |
|---|---|---|
| `raid/roles.js` | Assigns weapon loadouts alongside spawns | Modified |
| `raid/sim/combat.js` | Target acquisition, firing, striking, damage, death | New |
| `raid/sim/world.js` | Owns `hp`/`alive`/`weapon` on the agent record; calls `combat.step()`; suspends movement for engaged agents | Modified |
| `raid/sim/orders.js` | Bookkeeping for casualties and mission outcome | Modified |
| `raid/sim/path.js` | Line of sight | Unchanged |
| `raid/sim/navgrid.js` | Walkable grid | Unchanged |

**Browser:**

| File | Responsibility | Change |
|---|---|---|
| `raid/cast.js` | Per-figure skeletons via `AssetContainer` | Rewritten |
| `raid/agents.js` | One rig per figure; combat clip selection | Modified |
| `raid/weapons.js` | Rifle and melee geometry attached to the hand bone | New |
| `raid/main.js` | Wiring; HUD shows the outcome | Modified |

### Data model

Added to each agent record in `world.js`:

```
weapon    'gun' | 'melee' | 'none'   from roles.js; the hostage is 'none'
hp        number, counts down to 0
alive     boolean
target    agent id, or -1
chasing   boolean — combat is driving this agent's movement, not its path
cooldown  seconds remaining before the next attack may be made
firedAt   tick of the most recent attack, for the firing clip
hitAt     tick of the most recent damage taken, for the flinch clip
diedAt    tick of death, or -1
```

`firedAt`, `hitAt` and `diedAt` are tick counts; the renderer converts to
seconds against `SIM.step`. `chasing` is how combat moves a melee agent without
combat needing to know about paths: `world.js` steers a chasing agent straight
at `target` and skips its normal waypoint following for that tick.

`world.hash()` gains `hp` and `alive`. Without them the replay test would keep
passing while combat diverged — the existing hash covers position and facing
only.

### Target acquisition

An agent may hold a target if it is alive, within `sightRange`, and has line of
sight. The target is dropped the moment any of those stops being true, and a
new one is acquired on the next scan.

Scans are **staggered**: with `SCAN_INTERVAL = 6`, each agent rescans on ticks
where `tick % 6 === id % 6`, rather than every agent every tick. Twelve agents
scanning all eleven others every tick is 132 grid traversals per tick against a
2ms budget; staggering divides that by six at a cost of at most 0.1s of
reaction delay. The existing `orders.js` `setGoal` stagger exists for exactly
the same reason and sets the precedent.

An agent still **drops** an invalid target immediately, on any tick — only
acquisition is staggered. Continuing to shoot at something already dead or
behind a wall until the next scan window would be visible and wrong.

Who may be targeted:

- SWAT target any living hostile.
- Hostiles target any living SWAT, and the hostage **only once it is standing**
  — that is, after rescue, when it is escorting out. A prisoner lying on the
  floor is not shot at; a hostage being walked out is. This makes the
  "hostage killed" failure condition genuinely reachable without letting the
  mission be lost in the first two seconds.

### Engagement

A living agent with a target:

- **Gun**: stops moving, turns to face the target, fires whenever `cooldown`
  reaches zero and the target is within `gunRange`.
- **Melee**: steers directly at the target, ignoring its orders path, and
  strikes whenever `cooldown` reaches zero and the target is within
  `meleeRange`.

An agent with no target follows its orders path exactly as it does today.

**Combat must freeze the stall bookkeeping.** An agent halted to shoot makes no
progress toward its goal; after `GOAL_STALL_WINDOW` ticks it takes a strike,
replans, and then gets nudged — so it slides sideways along a wall while
firing. `world.js` already has the right pattern for this: the door-wait branch
resets the stall window so a legitimate wait is never read as a jam. Deliberate
combat halts take the same treatment.

### Damage and death

A resolved attack rolls once against a hit chance and applies damage. On `hp`
reaching zero: `alive` becomes false, `path`, `goal`, `target` and `chasing`
are cleared, velocity goes to zero, and the agent stops being a candidate for
anyone else's target, for separation, and for steering.

A corpse does not block movement. There is no body radius (see Decisions), so
the living walk over the dead. Recorded here so it reads as a decision rather
than an oversight.

Starting constants — deliberately a starting point, tuned by measurement during
implementation and reported by the sweep, never asserted:

```
sightRange     12 m
gunRange       10 m
meleeRange     1.2 m
gunCooldown    0.8 s        meleeCooldown  1.1 s
gunDamage      25           meleeDamage    35
swatHp         120          hostileHp      80        hostageHp  60
swatAccuracy   0.80         hostileAccuracy 0.55     meleeAccuracy 0.75
```

Gun hit chance is `accuracy * (1 - 0.5 * distance / gunRange)`, so a shot at
the edge of range lands half as often as one at point-blank. Melee uses
`meleeAccuracy` flat — at 1.2m there is no falloff worth modelling.

The hostage is deliberately frail: it is an unarmoured civilian being walked
through a firefight, and a failure condition nobody can ever trigger is not a
failure condition.

Four trained shooters against seven scattered patrollers should be a contest,
not a formality in either direction.

### Mission outcome

`orders.js` gains `outcome`: `null` while the mission runs, then `'success'` or
`'failed'`. It fails when every SWAT is dead, or when the hostage is dead. It
succeeds on the existing extraction condition, with the hostage alive.

Two changes are forced, and both are bookkeeping rather than tactics:

- Arrival checks (`allThere`, the extraction check) must consider **living**
  squad members only. `swat.every(...)` over a corpse never becomes true, so
  the first death would hang the advance forever. Formation slots are likewise
  allocated over the living, so a casualty closes the gap rather than leaving
  the survivors standing around an empty spot.
- A `failed` outcome is terminal and stops the phase machine.

The existing leg watchdog stays exactly as it is. It now has less to do —
a squad member who cannot arrive because it is dead is filtered out rather than
waited on — but it remains the guard for a living straggler that cannot reach
its point.

## Render binding

`agents.js` keeps one rig per figure instead of one per skeleton, and picks a
clip per agent by priority:

| Condition | Clip |
|---|---|
| Dead | `Death`, played once and held on its last frame |
| Damaged within the last `HitRecieve`'s own length (0.567s) | `HitRecieve` |
| Firing this moment, gun, moving | `Gun_Shoot` (0.600s) |
| Firing this moment, gun, stationary | `Idle_Gun_Shoot` (0.667s) |
| Has a target, gun, between shots | `Idle_Gun_Pointing` |
| Striking this moment, melee | `Sword_Slash` (1.033s) |
| Moving | `Walk` / `Run` / directional, as today |
| Otherwise | `Idle` |

"This moment" is not a fixed guessed window — each firing/striking/flinch
clip stays selected for exactly its own real length, read at runtime off the
loaded `AnimationGroup` (`(to - from) / fps`, converted to sim ticks) rather
than a hand-picked constant, so it plays out in full instead of being cut
short and blended back to idle mid-motion. A gun agent's velocity is forced
to exactly 0 by `sim/world.js` the instant it is in range with a valid
target (chasing — closing distance while still moving — is melee-only), so
stationary is the ordinary firing case for a gun and moving is the rare one;
`Idle_Gun_Shoot` therefore carries the common case, matching how often each
clip actually gets seen, not just which one sounds more dramatic.

All twenty-four clips exist identically in every GLB in the pack — verified,
not assumed. `Run_Shoot` (0.833s) is one of the twenty-four but is not in the
table above: nothing in this design ever calls for "firing while advancing",
since a gun agent cannot be both moving and firing under the rule above, so
it is intentionally never selected. Holding a dead figure on its last `Death`
frame reuses the technique `seated.js` already uses for the hostage's floor
pose.

`weapons.js` attaches geometry to the hand bone: a rifle for gun carriers, and
one of the melee items for melee hostiles. The `soldier/` sandbox has already
solved the grip conventions (origin in the palm, item extending along +Y) in
`soldier/weapon.js` and `soldier/melee.js`, including the trap that the
importer's mirrored bone space makes a naive un-mirroring slide the weapon out
of the hand. That knowledge is adapted here; the `rifle-wip` branch is a source
to read, not something to merge.

## Testing

**Pure, under `node --test`:**

- Same seed replays identically, with `hp` and `alive` in the hash
- No hit ever resolves without line of sight at the moment of resolution
- No hit ever resolves through a closed door
- No gun hit beyond `gunRange`; no melee hit beyond `meleeRange`
- A dead agent never moves, never fires, and is never targeted
- Damage accumulates to death exactly — no overkill wrap, no resurrection
- An agent halted for combat accumulates no stall strikes (regression for the
  interaction described above)
- Mission outcome is always decided within the tick ceiling, on every room
  count — never hangs
- Both outcomes are reachable across the seed set. A combat model where SWAT
  always win is as broken as one where they always lose, and a test that only
  ever sees one outcome is not testing combat

**Measured and reported, not asserted:** the SWAT win rate across a sweep, the
mean fight duration, and shots fired per kill.

**Budget:** the existing per-tick budget of 2ms still holds with combat live.

**Browser:** twelve figures animate independently — the check that the whole
prerequisite exists for. One hostile dying must leave the other six standing.

## Risks

The skeleton rework is the dangerous change. It replaces the creation path for
every figure, and both the hostage floor pose and the role-marker tracking hang
off that path. It lands as its own task, verified on its own — all twelve
figures animating independently, the hostage still lying correctly, markers
still following — before any combat code is written on top of it.
