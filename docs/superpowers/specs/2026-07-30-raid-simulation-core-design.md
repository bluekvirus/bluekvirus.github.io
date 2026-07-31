# Design: Raid — simulation core and render binding

## Goal

Make the raid scene move. A deterministic, headless simulation drives twelve
agents through the generated building — pathfinding around furniture, opening
doors, walking and running — and the renderer binds that simulation to the
existing figures with speed-driven, cross-faded animation.

This is phase B of the raid work. Phase A generates the world and places
everyone in it; this phase makes them act. Combat and tactical decision-making
are phases C and D.

## Scope

**In:**

- Navigation grid derived from the floor plan and props
- A* pathfinding with path smoothing
- Fixed-step deterministic simulation: agents, doors, tick loop
- Doors as simulation state, opened by agents, animated by the renderer
- Agent steering and mutual separation
- Render binding: position, facing, and speed-driven clip selection with blending
- A scripted mission dry run — squad advances to the hostage room and escorts
  back to extraction; hostiles patrol their rooms
- HUD time controls: play/pause, single step, speed multiplier

**Out (later phases):**

- Line of sight, firing, ammo, reload, damage, death (phase C)
- Squad orders, covering fire, room clearing, real rescue logic (phase D)
- Any machine learning. This phase makes RL *possible* later; it does not
  attempt it.

The dry run is scaffolding. It exists so the movement machinery can be judged
before behaviour is layered on, and phase D replaces the decisions while keeping
everything underneath.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Navigation | Uniform grid + A*, ~0.25 m cells | Props are handled with no special case — a desk is simply blocked cells. A grid is also the natural observation format if RL happens later |
| High-level routing | Existing room/door graph from phase A | Already built and correct; answers "which room next" while the grid answers "how do I walk there" |
| Simulation step | Fixed 60 Hz, decoupled from render | Determinism is the test oracle, the reproducibility guarantee, and the RL environment contract at once |
| Render smoothness | Interpolate between the last two sim states | Motion stays smooth regardless of frame rate, without making the sim frame-dependent |
| Animation | Speed-driven clips, cross-faded | Babylon blends animation groups natively — no bone maths, which is the part of this rig that has repeatedly gone wrong |
| Doors | Simulation state, renderer reacts | The sim must be able to run headless with no meshes at all |
| Dry-run behaviour | Scripted advance and patrol | Exercises the machinery without pre-empting phase D's decisions |

## Architecture

The pure/browser split from phase A extends into the simulation. This is the
load-bearing decision of the whole phase.

**Pure — no Babylon, no DOM, runs under Node:**

| File | Responsibility |
|---|---|
| `raid/sim/navgrid.js` | Floor plan + props → walkable grid, with door cells marked conditional |
| `raid/sim/path.js` | A* over the grid, plus string-pull smoothing |
| `raid/sim/world.js` | Simulation state and `tick(dt)`: agents, doors, steering |
| `raid/sim/orders.js` | The dry-run behaviour that issues goals to agents |

**Browser:**

| File | Responsibility |
|---|---|
| `raid/agents.js` | Binds sim agents to figures: position, facing, clip selection and blending |
| `raid/doors.js` | Swings door meshes when their sim state changes |
| `raid/main.js` | Wiring, time controls (modified) |

### Why the simulation must not import Babylon

Three separate things depend on it, and they are worth stating individually
because any one of them alone would justify the constraint:

1. **Testability.** "Does an agent ever walk through a wall" is a property of
   thousands of ticks across hundreds of seeds. That is a Node assertion, not
   something to look for in a screenshot — a lesson this project has now learned
   expensively more than once.
2. **Reproducibility.** A bug in agent behaviour is only fixable if it can be
   replayed. Seed plus tick count must reproduce the exact state.
3. **Reinforcement learning, if it ever happens.** RL needs an environment that
   steps thousands of times per second with no renderer attached. Build the sim
   inside the render loop and RL is permanently off the table; build it pure and
   it stays available at no extra cost.

### Determinism contract

- Fixed timestep of 1/60 s. The renderer may run at any frame rate.
- All randomness from the seeded RNG, derived as `` `${plan.seed}:sim` `` so the
  simulation never consumes the generator's stream.
- No `Math.random`, no `Date.now`, no reliance on iteration order of objects
  keyed by anything but integers.
- `world.hash()` returns a stable digest of agent positions, velocities, goals
  and door states. Two runs of the same seed for the same tick count must produce
  identical digests.

## Navigation

**Grid.** The footprint rasterises at 0.25 m — about 19,600 cells for the default
35 × 35 m plan. A cell is blocked if it intersects a wall segment or a prop
footprint. Cells inside a door opening are marked `door` with the door's id
rather than blocked, so pathing can route through them at a cost that reflects
whether the door is currently open.

Agents have radius, so the grid is eroded by that radius when built. Otherwise
paths hug walls and figures visibly clip corners.

**Pathfinding.** A* with an octile heuristic, 8-connected, forbidding diagonal
moves that cut a blocked corner. The raw grid path is then string-pulled: walk
the path and drop any waypoint whose removal still leaves an unobstructed
straight line. That converts staircase paths into the diagonal runs a person
would actually walk.

**Steering.** Agents move toward the next waypoint at their current speed, with a
separation force so they do not stack in doorways. Separation is capped so it can
never push an agent through a wall — a wall check runs after integration, and a
move that would end inside a blocked cell is clamped rather than applied.

## Doors

A door is `closed`, `opening`, or `open`. An agent whose path crosses a closed
door stops in front of it, triggers the opening, and waits. The door takes ~0.4 s
to open, after which its cells become freely passable.

The renderer watches for state changes and swings the door mesh; the pack's
`Interact` clip plays on the opening agent. Nothing about the door's behaviour
depends on the renderer existing.

## Animation binding

Each frame the renderer reads each agent's interpolated position and speed:

- Below a walk threshold: `Idle`
- Between walk and run thresholds: `Walk`
- Above: `Run`

Clip changes cross-fade over ~0.15 s using Babylon's animation-group blending.
Facing follows the velocity direction, damped so agents turn rather than snap.

Twelve figures now animate rather than standing still, so this is where per-frame
cost arrives — hence the budget below.

## The mission dry run

Scripted, and deliberately simple:

- **Squad:** advance along the room graph from the entry to the hostage room,
  one room at a time, waiting for all four to arrive before moving on. On
  reaching the hostage, escort back to extraction.
- **Hostiles:** patrol within their assigned room, pausing at random intervals.
- **Hostage:** stays where it is.

Phase D replaces `orders.js` wholesale. Nothing else should need to change when
it does — that is the test of whether this boundary is drawn correctly.

## HUD additions

Play/pause, single-step one tick, and a speed control (0.5× / 1× / 2× / 4×).
Single-step is how a misbehaving agent gets diagnosed; the speed control is how a
two-minute dry run gets watched in thirty seconds.

## Budgets

| Budget | Target |
|---|---|
| Simulation tick, 12 agents | < 2 ms |
| Grid build per generated map | < 20 ms |
| Path query | < 3 ms |
| Headless throughput in Node | > 1,000 ticks/second |
| Frame time with 12 animated figures | < 16 ms |

The headless throughput number is the one that makes the RL claim honest. If the
simulation cannot step a thousand times a second without a renderer, then
reinforcement learning was never realistic here, and it is better to discover
that in this phase than after building toward it.

## Verification

Assertable in Node, across at least 200 seeds:

- **Determinism** — same seed and tick count produce an identical `world.hash()`
- **No wall crossing** — no agent's position is ever inside a blocked cell, checked
  every tick over a full dry run
- **Paths are valid** — every segment of a smoothed path has line of sight along
  the grid
- **Progress** — every agent reaches its goal within a tick budget; no agent stalls
- **Doors** — an agent whose route crosses a closed door opens it, and the door
  reaches `open` before the agent passes through
- **Separation** — no two agents occupy the same cell at rest
- **Throughput** — the headless ticks/second budget

Browser review covers only what data cannot answer: does the movement read as
walking rather than sliding, and do clip transitions blend without popping.

## What this does and does not commit to regarding RL

It commits to a simulation that could serve as an RL environment: deterministic,
headless, fast, with a grid observation space already in the right shape.

It does not commit to doing RL. When the time comes, the cheaper option should be
tried first — tuning scripted AI weights with an evolutionary search in the same
headless simulation. That produces learned behaviour without reward shaping,
without credit assignment across twelve agents, and without a training
dependency. Full RL only if that proves insufficient.

## Working method

- No build step; plain ES modules; push is deploy
- `raid/sim/**` imports nothing from Babylon and touches no browser globals; the
  existing `raid/tests/purity.test.js` is extended to cover these files
- Seeded RNG only
- Verify by assertion first, screenshot second
