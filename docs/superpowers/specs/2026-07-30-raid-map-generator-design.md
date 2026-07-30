# Design: Raid — procedural CQB map generator

## Goal

A standalone page that generates a seeded office-floor plan for a hostage-rescue
scenario: a 4-man SWAT squad entering a building held by 7 hostiles with 1
hostage, viewed at 45°. Regenerating from a new seed produces a different,
plausible floor plan every time.

This is phase A of four. It builds the world and places everyone in it. Nothing
moves.

## Scope

**In:**

- Seeded procedural floor plan — rooms, corridors, walls, doors
- Cover props placed by room role
- Mission placement — squad entry, hostile posts, hostage room, extraction point
- Characters standing at their spawn points, drawn from the existing pack, with
  the hostage seated in a chair
- 45° orbit camera, roofless building
- HUD: seed field, regenerate, room-count control, legend

**Out (later phases):**

- Movement and pathfinding (phase B)
- Line of sight, cover scoring, shooting, damage (phase C)
- Squad orders, mutual covering, rescue and extraction logic (phase D)

Anything in the "out" list that turns out to be cheap is still out. The point of
splitting the work is that phase A can be judged on its own.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Site type | Office / embassy interior | The hostage sits in a defensible interior room; doors give natural breach points; rectangular rooms make cover placement and the phase-B nav grid trivial |
| Algorithm | BSP with corridor carving | Connectivity is guaranteed by construction from the split tree, not by search-and-retry |
| View | Orbitable, roofless, 45° default pitch | Whole plan legible at once, which is what squad tactics needs |
| Default size | 8–12 rooms, ~35×35 m, adjustable | Fits on screen at 45° without shrinking operators to specks |
| Cast | 4 SWAT, 7 hostiles, 1 hostage | Set by the user |
| Assets | Shared `assets/quaternius/` at repo root | Two pages need the pack; avoids a second 15 MB copy or reaching into a sibling page's folder |

## Architecture

Eight modules, split so that the part which must be *correct* is separable from
the part which must merely *look right*.

| File | Responsibility |
|---|---|
| `raid/rng.js` | Seeded PRNG (mulberry32) |
| `raid/floorplan.js` | Pure data: BSP → rooms, corridors, walls, doors, adjacency graph |
| `raid/roles.js` | Room roles and mission placement over the plan graph |
| `raid/props.js` | Procedural cover meshes and the hostage's chair |
| `raid/build.js` | Plan data → Babylon meshes |
| `raid/cast.js` | Character loading and placement at spawns |
| `raid/stage.js` | Camera, lights, shadows |
| `raid/main.js` | Wiring and HUD |

### floorplan.js imports nothing from Babylon

This is the load-bearing boundary. `floorplan.js` takes a seed and a config and
returns plain objects — rectangles, edges, door positions, an adjacency list. It
never touches the scene.

The reason is verification. A generator is correct or it isn't, and the
properties that matter (determinism, connectivity, no overlaps, hostage depth)
are all assertable on data. Screenshots can only show that something looks like
a building; they cannot show that every room is reachable. Keeping the generator
pure means its correctness is checked by assertion rather than by eye.

### roles.js works on the graph, not the geometry

Choosing which room holds the hostage is a graph question — greatest door-count
distance from the entry — not a spatial one. Keeping it separate from
`floorplan.js` means the layout algorithm can change without touching mission
placement, and mission rules can change without touching the layout.

### build.js is the only module that knows about meshes

Everything upstream is data. This is what makes it possible to regenerate a plan
and diff it, or to run the generator a thousand times checking invariants,
without a renderer.

## Generation pipeline

1. **Seed → RNG.** Seed is a string; the HUD shows it and accepts it back.
2. **BSP split.** Recursively split the footprint rectangle, alternating axis with
   jitter, until a leaf is below the target room area. Split positions come from
   the seeded RNG, never `Math.random`.
3. **Corridor bands.** At splits above a configured tree depth, reserve a 1.8 m
   band along the split line as corridor rather than assigning it to either
   child. This is what makes the result read as an office with circulation
   instead of a subdivided box.
4. **Rooms.** Leaves shrunk by wall thickness (0.15 m).
5. **Doors.** For each adjacent pair in the split tree, place a door on the shared
   wall segment, offset from corners by at least 0.6 m. Adjacency comes from the
   tree, so every room is connected by construction.
6. **Connectivity check.** Flood-fill the room graph from the entry. This should
   never fail given step 5; if it does, that is a bug, and it throws rather than
   silently regenerating.
7. **Roles.** Entry room on the perimeter. Hostage room is the room with the
   greatest door-count distance from entry, minimum 3. Remaining rooms become
   guard posts or filler.
8. **Cover.** Props per room chosen by role, positioned clear of door swing arcs
   and of each other.
9. **Spawns.** 4 SWAT at the entry, 7 hostiles distributed with weighting toward
   the hostage room and the routes to it, 1 hostage inside the hostage room.
10. **Extraction.** Marker at the entry.

## Presentation

- **Walls** 2.6 m, full height, no ceiling. Merged into one mesh per material.
- **Floors** one plane per room, tinted subtly by role so the objective reads
  without a label.
- **Doors** gaps in the wall run plus a frame.
- **Camera** ArcRotate at 45° pitch by default, orbit and zoom, framed to the
  footprint. Adapted from `soldier/stage.js`.
- **Markers** coloured discs beneath each figure — blue SWAT, red hostile, amber
  hostage, green extraction.
- **Palette** continues the soldier page's muted flat-shaded look.

## The seated hostage

The pack ships 25 clips and none of them is seated — no sit, kneel or crouch —
and it contains no props at all, so there is no chair either. Both are built
here.

The chair is procedural, like the cover props: seat, back, four legs. The seated
pose is hand-authored by setting bone rotations directly — hips and knees to
roughly 90°, arms behind the back — reusing the pose machinery written for
`soldier/reload.js`, which keys quaternion deltas off a base pose. A static pose
is the simpler case of that: set once, no keyframes.

Author the pose first, then size the chair to it. Seat height, depth and back
angle are derived from where the posed figure's thighs and spine actually end up,
rather than authored independently and then reconciled. There is no fixed contact
point to hit, which is what made seating the melee weapons in the fist expensive;
here the geometry is free to move to meet the pose.

## Cast loading

Twelve figures, each a skinned GLB from a pack that shares one skeleton. Load a
small number of distinct models and clone the rest onto their own skeletons, the
approach `soldier/sidearm.js` already uses for the pistol. Figures are static in
this phase, so animation cost is nil — but the draw-call and skinning cost is
the number that will matter in phase C, so the loader is written to make cloning
the normal path rather than a special case.

## Budgets

| Budget | Target |
|---|---|
| Plan generation | < 30 ms |
| Wall/floor draw calls | ≤ 8 (merged per material) |
| Total page weight excluding characters | < 60 KB |
| Frame time with 12 static figures | < 16 ms |

## Verification

Assertable on data, no rendering required:

- **Determinism** — the same seed produces an identical plan, checked by hashing
  the returned structure
- **Connectivity** — every room reachable from the entry
- **No overlaps** — no two room rectangles intersect
- **Hostage depth** — hostage room at least 3 doors from entry
- **Spawn validity** — every spawn point inside its intended room and not inside a
  prop
- **Hostage seating** — the seated figure's feet reach the floor and its hips meet
  the chair seat, measured rather than eyeballed
- **Budget** — generation under 30 ms

Visual review then covers only the question data cannot answer: does it look like
a building, and does a room look like it has space for four operators.

Run the invariants across many seeds, not one. A generator that works on seed 1
and fails on seed 47 is the normal failure mode, and a single-seed check would
miss it.

## Working method

- No build step; plain ES modules; push is deploy
- Babylon.js from the same pinned CDN URL and SRI hash as `soldier/`
- Seeded RNG only — `Math.random` anywhere in generation is a bug, because it
  breaks reproducibility from a seed
- Verify by assertion first, screenshot second
