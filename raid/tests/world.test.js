import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld, SIM } from '../sim/world.js';

const SEEDS = Array.from({ length: 100 }, (_, i) => `world-${i}`);
const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return createWorld(plan, mission, layoutProps(plan, mission));
};

test('the world starts with the full cast on walkable ground', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const w = build(seed);
    assert.equal(w.agents.length, 12, `${seed}: wrong agent count`);
    assert.equal(w.agents.filter((a) => a.role === 'swat').length, 4);
    assert.equal(w.agents.filter((a) => a.role === 'hostile').length, 7);
    assert.equal(w.agents.filter((a) => a.role === 'hostage').length, 1);
    for (const a of w.agents) {
      const c = w.grid.worldToCell(a.x, a.z);
      assert.equal(w.grid.isBlocked(c.col, c.row), false, `${seed}: agent starts blocked`);
    }
  }
});

test('the same seed replays identically', () => {
  const a = build('replay');
  const b = build('replay');
  for (let i = 0; i < 600; i++) { a.tick(); b.tick(); }
  assert.equal(a.hash(), b.hash());
});

test('agents never end a tick inside a blocked cell', () => {
  for (const seed of SEEDS.slice(0, 30)) {
    const w = build(seed);
    const hostage = w.agents.find((a) => a.role === 'hostage');
    // Send everyone toward the hostage so they actually traverse the
    // building. (An earlier version of this test aimed at
    // { x: -w.grid.originX, z: -w.grid.originZ }, which resolves to a cell
    // one past the grid's valid range — setGoal failed for every agent, no
    // one ever moved, and the assertion below could not have failed no
    // matter what tick() did. Asserting setGoal's return value is what
    // keeps that from happening silently again.)
    for (const a of w.agents) {
      const ok = w.setGoal(a.id, { x: hostage.x, z: hostage.z });
      assert.ok(ok, `${seed}: setGoal failed for agent ${a.id}`);
    }
    for (let i = 0; i < 900; i++) {
      w.tick();
      for (const a of w.agents) {
        const c = w.grid.worldToCell(a.x, a.z);
        assert.equal(w.grid.isBlocked(c.col, c.row), false,
          `${seed}: agent ${a.id} walked into geometry at tick ${i}`);
      }
    }
  }
});

test('no agent is ever inside a closed door', () => {
  for (const seed of SEEDS.slice(0, 30)) {
    const w = build(seed);
    const hostage = w.agents.find((a) => a.role === 'hostage');
    for (const a of w.agents.filter((x) => x.role === 'swat')) {
      w.setGoal(a.id, { x: hostage.x, z: hostage.z });
    }
    for (let i = 0; i < 3600; i++) {
      w.tick();
      for (const a of w.agents) {
        const c = w.grid.worldToCell(a.x, a.z);
        const id = w.grid.doorAt(c.col, c.row);
        assert.ok(id < 0 || w.doors[id].state === 'open',
          `${seed}: agent ${a.id} inside door ${id} while it is ${id >= 0 ? w.doors[id].state : 'n/a'} at tick ${i}`);
      }
    }
  }
});

test('an agent given a reachable goal arrives', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const w = build(seed);
    const a = w.agents.find((x) => x.role === 'swat');
    const hostage = w.agents.find((x) => x.role === 'hostage');
    // This test predates combat and checks path-following/arrival mechanics,
    // not survival: it sends a single SWAT alone across the whole level,
    // with none of the squad's usual covering fire. Now that combat.step()
    // runs every tick (Task 5), that lone walk draws fire from any hostile
    // with line of sight — measured, it kills the agent before arrival on 35
    // of these 40 seeds, which is a confound unrelated to what this test
    // checks. Neutralize the hostiles so the arrival check keeps measuring
    // reachability, exactly as it did before combat existed.
    for (const h of w.agents) if (h.role === 'hostile') h.alive = false;
    w.setGoal(a.id, { x: hostage.x, z: hostage.z });
    let arrived = false;
    for (let i = 0; i < 3600 && !arrived; i++) {
      w.tick();
      arrived = Math.hypot(a.x - hostage.x, a.z - hostage.z) < 1.2;
    }
    assert.ok(arrived, `${seed}: agent never reached the hostage in 60 simulated seconds`);
  }
});

test('a tick advances time by exactly the fixed step', () => {
  const w = build('time');
  w.tick();
  assert.equal(w.time, SIM.step);
  assert.equal(w.ticks, 1);
});

test('agents keep apart', () => {
  const w = build('separation');
  const target = w.agents.find((a) => a.role === 'hostage');
  for (const a of w.agents.filter((x) => x.role === 'swat')) {
    w.setGoal(a.id, { x: target.x, z: target.z });
  }
  for (let i = 0; i < 1800; i++) w.tick();
  const swat = w.agents.filter((a) => a.role === 'swat');
  for (let i = 0; i < swat.length; i++) {
    for (let j = i + 1; j < swat.length; j++) {
      const gap = Math.hypot(swat[i].x - swat[j].x, swat[i].z - swat[j].z);
      assert.ok(gap > 0.3, `agents ${i} and ${j} ended up ${gap.toFixed(2)}m apart`);
    }
  }
});

test('SIM constants are frozen', () => {
  assert.throws(() => { SIM.step = 1; });
});

// A bare open room with agents dropped into it at given points. The stall and
// recovery machinery below is driven directly rather than coaxed out of a
// generated map: measured across 790,368 agent-ticks of real missions the
// right-of-way yield fired zero times and the nudge fourteen, so waiting for a
// seed to produce one is not a test strategy. Every branch these exercise is
// live code that has already been the root cause of three separate hangs on
// this branch, and until now only one of them had a regression test.
const openRoom = (points, span = 12) => {
  const plan = {
    seed: 'stall-machinery',
    config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: span, d: span },
    cells: [{ id: 0, x: 0, z: 0, w: span, d: span }],
    doors: [],
    adjacency: {},
    walls: [],
  };
  const mission = {
    spawns: {
      swat: points.map((p) => ({ ...p, facing: 0, cellId: 0 })),
      hostiles: [],
      hostage: { x: 1, z: span - 1, facing: 0, cellId: 0 },
      extraction: { x: 1, z: span - 1 },
    },
  };
  return createWorld(plan, mission, []);
};

// Hold agents exactly where they are, whatever they try to do. This is the
// one situation the goal-stall detector exists for and the hardest to arrange
// honestly: agents are dimensionless points to the collision code, so two of
// them will slide through each other (measured: 0.054m apart inside a
// 0.25m-wide tube) rather than deadlock the way the machinery assumes.
const pin = (world, ticks, onTick) => {
  const held = world.agents.map((a) => ({ x: a.x, z: a.z }));
  for (let i = 1; i <= ticks; i++) {
    world.tick();
    world.agents.forEach((a, j) => { a.x = held[j].x; a.z = held[j].z; });
    if (onTick) onTick(i);
  }
};

test('a frozen agent accumulates strikes on a fixed cadence', () => {
  const w = openRoom([{ x: 2, z: 2 }]);
  const a = w.agents[0];
  assert.ok(w.setGoal(0, { x: 10, z: 10 }), 'setGoal should succeed on an empty room');

  const strikes = [];
  let last = 0;
  pin(w, 400, (tick) => {
    if (a._goalStrikes !== last) { strikes.push(tick); last = a._goalStrikes; }
  });

  assert.ok(a._goalStrikes >= 4,
    `a permanently stuck agent only reached ${a._goalStrikes} strikes in 400 ticks — the detector stopped counting`);
  // One per window, rather than a burst that then gives up.
  const gaps = strikes.slice(1).map((t, i) => t - strikes[i]);
  assert.ok(gaps.every((g) => g === gaps[0]),
    `strikes did not accrue on a fixed cadence: ${JSON.stringify(strikes)}`);
});

test('an agent merely oscillating still accumulates strikes — the best-distance ratchet never slips', () => {
  // The live-lock that a frozen agent cannot expose. Re-arming the baseline to
  // the CURRENT distance rather than the best ever reached lets an agent drift
  // 10cm away and back and have the return trip count as fresh progress,
  // zeroing the strike count every time. Nothing is stuck — the agent moves
  // the whole while, so no "stuck" signal fires — and one agent and the
  // hostage traded centimetres for 9,000 ticks with the detector reporting
  // progress throughout. A frozen agent's distance is constant, so re-arming
  // to "current" and to "best" agree exactly and the bug hides; it only shows
  // up under movement, which is why this test moves the agent.
  const w = openRoom([{ x: 2, z: 2 }]);
  const a = w.agents[0];
  const goal = { x: 10, z: 10 };
  assert.ok(w.setGoal(0, goal));

  const base = { x: a.x, z: a.z };
  const span = Math.hypot(goal.x - base.x, goal.z - base.z);
  const ux = (goal.x - base.x) / span;
  const uz = (goal.z - base.z) / span;
  const AMPLITUDE = 0.1; // comfortably over GOAL_STALL_EPS (0.02)

  let best = Infinity;
  let slipped = 0;
  for (let i = 1; i <= 600; i++) {
    w.tick();
    const swing = i % 2 === 0 ? AMPLITUDE : 0;
    a.x = base.x + ux * swing;
    a.z = base.z + uz * swing;
    if (a._goalBestDist > best + 1e-9) slipped++;
    best = Math.min(best, a._goalBestDist);
  }

  assert.equal(slipped, 0,
    'the best-distance baseline rose while the goal was unchanged — the ratchet slipped, so oscillation reads as progress');
  assert.ok(a._goalStrikes >= 4,
    `an oscillating agent reached only ${a._goalStrikes} strikes in 600 ticks — the detector is blind to live-lock again`);
});

test('the tie-breaking nudge is a bounded impulse that expires and escalates', () => {
  const w = openRoom([{ x: 2, z: 2 }]);
  const a = w.agents[0];
  w.setGoal(0, { x: 10, z: 10 });

  // Regression for fix round 4, whose root cause was the round-3 recovery
  // itself: left standing, a bias this size replaces the goal direction
  // outright and the agent slides along a wall forever at a healthy speed —
  // a live-lock every "is it stuck" signal reports as a moving agent, with the
  // escalation pinning the bias at its cap so the recovery becomes the thing
  // preventing recovery. It must therefore be an impulse: arrive, expire,
  // and come back harder only if the stand-off survived it.
  const bursts = [];
  let current = null;
  pin(w, 600, () => {
    if (a._nudgeTicks > 0 && !current) current = { bias: Math.abs(a._nudgeBias), ticks: [] };
    if (current) current.ticks.push(a._nudgeTicks);
    if (current && a._nudgeTicks === 0) { bursts.push(current); current = null; }
  });

  assert.ok(bursts.length >= 2, `expected repeated nudge bursts, saw ${bursts.length}`);
  for (const burst of bursts) {
    assert.ok(burst.ticks.length < 60,
      `a nudge burst ran for ${burst.ticks.length} ticks — it is a standing bias again, not an impulse`);
    assert.equal(burst.ticks.at(-1), 0, 'a nudge burst did not end with the counter cleared');
    // Non-increasing, by at most one a tick. Not strictly one a tick: the
    // impulse is spent on ticks the agent actually steers, and a tick spent
    // arriving at a waypoint returns early before the nudge is applied, so the
    // counter legitimately holds for a tick there. What matters is that it
    // only ever goes down, which is what makes the impulse bounded.
    const counting = burst.ticks.slice(0, -1);
    assert.ok(counting.every((t, i) => i === 0 || t === counting[i - 1] || t === counting[i - 1] - 1),
      `a nudge burst did not count down monotonically: ${JSON.stringify(burst.ticks)}`);
  }
  assert.ok(bursts.at(-1).bias > bursts[0].bias,
    `the nudge did not escalate across bursts (${bursts[0].bias} then ${bursts.at(-1).bias}) — a persistent deadlock needs an answer that keeps growing`);
  assert.equal(a._nudgeBias, 0, 'the bias outlived its impulse');
});

test('right of way in a stand-off goes to the lowest id, and only one side gives way', () => {
  // Two agents jammed against each other inside separation range, both
  // getting nowhere. Exactly one has to retreat: nudging both aside only
  // decides which of them misses the opening, so the rule must be
  // asymmetric and derived from nothing but ids, or a seed stops replaying.
  const w = openRoom([{ x: 5, z: 5 }, { x: 5.3, z: 5 }]);
  const [a, b] = w.agents;
  w.setGoal(0, { x: 10, z: 10 });
  w.setGoal(1, { x: 10, z: 10 });

  let aEverYielded = false;
  let bYieldedTo = -1;
  let aMaxNudge = 0;
  let bMaxNudge = 0;
  pin(w, 400, () => {
    if (a._yieldTicks > 0) aEverYielded = true;
    if (b._yieldTicks > 0) bYieldedTo = b._yieldTo;
    aMaxNudge = Math.max(aMaxNudge, Math.abs(a._nudgeBias));
    bMaxNudge = Math.max(bMaxNudge, Math.abs(b._nudgeBias));
  });

  assert.equal(bYieldedTo, 0, 'the higher id did not give way to the lower id');
  assert.equal(aEverYielded, false, 'the lower id gave way too — both sides retreating solves nothing');
  assert.ok(aMaxNudge > 0, 'the agent with right of way never got a nudge to break the tie with');
  assert.equal(bMaxNudge, 0, 'the yielding agent was nudged as well as backing off; it should do one or the other');
});

test('a replan keeps a short raw lead and smooths the rest of the route', () => {
  // replan() used to return the raw grid route entire and never re-smooth, so
  // an agent that jammed once ran the whole rest of its journey as a
  // cell-by-cell staircase: 17.4% of all agent-ticks across 100 missions, at a
  // measurably reduced speed. The raw stepping is what gets an agent out of
  // the jam it is actually in, so the lead stays raw — but only the lead.
  const w = openRoom([{ x: 2, z: 2 }], 24);
  const a = w.agents[0];
  w.setGoal(0, { x: 22, z: 22 });

  const before = a.path;
  const held = { x: a.x, z: a.z };
  for (let i = 0; i < 200 && a.path === before; i++) { w.tick(); a.x = held.x; a.z = held.z; }
  assert.notEqual(a.path, before, 'the stall never triggered a replan, so this test proves nothing');

  // The raw route across this room is ~81 single-cell waypoints. Anything near
  // that means the smoothing pass was dropped again.
  assert.ok(a.path.length <= 12,
    `replan produced ${a.path.length} waypoints — that is the raw grid staircase, not a smoothed route`);

  const segment = (i) => Math.hypot(a.path[i].x - a.path[i - 1].x, a.path[i].z - a.path[i - 1].z);
  const cellDiagonal = w.grid.cell * Math.SQRT2 + 1e-6;
  for (let i = 1; i <= 3; i++) {
    assert.ok(segment(i) <= cellDiagonal,
      `waypoint ${i} is ${segment(i).toFixed(3)}m from the last — the raw lead that gets an agent out of a jam was smoothed away`);
  }
  assert.ok(segment(4) > 1,
    'the route past the raw lead was not smoothed at all');
});

test('agents spawn alive, armed, and at full health', () => {
  const w = build('combat-spawn');
  for (const a of w.agents) {
    assert.equal(a.alive, true);
    assert.ok(a.hp > 0, `agent ${a.id} spawned with no health`);
    assert.ok(['gun', 'melee', 'none'].includes(a.weapon), `agent ${a.id} weapon is ${a.weapon}`);
  }
  assert.equal(w.agents.find((a) => a.role === 'hostage').captive, true);
});

test('the replay hash covers health, so a diverging fight cannot pass unnoticed', () => {
  const a = build('hash-hp');
  const b = build('hash-hp');
  for (let i = 0; i < 300; i++) { a.tick(); b.tick(); }
  assert.equal(a.hash(), b.hash());

  // Sabotage one agent's health and require the hash to notice.
  a.agents[0].hp -= 1;
  assert.notEqual(a.hash(), b.hash(),
    'hash() ignores hp — a combat divergence would replay as identical');
});

test('a dead agent stops moving and stays put', () => {
  const w = build('dead-still');
  const a = w.agents.find((x) => x.role === 'swat');
  const hostage = w.agents.find((x) => x.role === 'hostage');
  w.setGoal(a.id, { x: hostage.x, z: hostage.z });
  for (let i = 0; i < 120; i++) w.tick();

  a.hp = 0;
  w.tick();
  const at = { x: a.x, z: a.z };
  for (let i = 0; i < 300; i++) w.tick();

  assert.equal(a.alive, false, 'an agent at 0 hp is still alive');
  assert.ok(Math.hypot(a.x - at.x, a.z - at.z) < 1e-9, 'a corpse drifted');
  assert.equal(a.speed, 0);
  assert.equal(a.path, null);
});

test('an agent halted to shoot takes no stall strikes', () => {
  // Regression for the interaction the spec calls out: an agent standing still
  // to fire makes no progress toward its goal, so the goal-stall detector
  // would strike it, replan it, and nudge it into sliding sideways along a
  // wall while shooting. A deliberate combat halt is a wait, not a jam --
  // exactly like waiting at a shut door, which world.js already exempts.
  const w = openRoom([{ x: 2, z: 2 }], 20);
  const a = w.agents[0];
  // Give it something to shoot: a hostile is not in openRoom's cast, so make
  // this agent's own bookkeeping the subject and pin a fake engagement on it.
  assert.ok(w.setGoal(0, { x: 18, z: 18 }));
  for (let i = 0; i < 400; i++) {
    a.target = 0;          // engaged with something
    a.chasing = false;     // a gun agent: halts rather than closes
    w.tick();
  }
  assert.equal(a._goalStrikes, 0,
    'a deliberately halted shooter accumulated stall strikes and will be nudged off its firing position');
});

test('a wall-corner jam still recovers via replan even with a closed door further along the same segment', () => {
  // Regression for fix round 2: door detection used to scan the WHOLE
  // segment from an agent's position to its next waypoint
  // (`firstBlockingDoor`), so a closed door metres away on a long smoothed
  // segment could be "found" and misreported as what was stopping an agent
  // that was actually jammed at a wall corner right in front of it. Worse,
  // finding that door reset the stall countdown every tick, so the stall
  // detector's replan() never got a chance to run — the agent froze in the
  // pocket forever, misclassified as waiting on a door it was nowhere near.
  //
  // Reproducing that shape from a generated seed is impractical (pathfinding
  // naturally routes around a wall corner rather than aiming straight at
  // one), so this builds a small hand-made grid instead: two full-length
  // walls meeting at a right angle seal one corner of an open room into a
  // pocket with no way out, and a door is tagged well past that corner, on
  // the straight line from the pocket to a far "goal" on the other side.
  // The agent's path is set directly to that far goal — simulating exactly
  // the kind of long, straight, single-waypoint segment smoothPath
  // produces — so it drives straight at the sealed corner.
  const plan = {
    seed: 'corner-jam-regression',
    config: { wallThickness: 0.1 },
    bounds: { x: 0, z: 0, w: 6, d: 6 },
    cells: [{ x: 0, z: 0, w: 6, d: 6 }],
    doors: [{ id: 0, x: 4.5, z: 4.5, axis: 'x', width: 1 }],
    adjacency: {},
    walls: [],
  };
  const placements = [
    // Full-height vertical wall at x in [3, 3.25].
    { x: 3.125, z: 3, w: 0.25, d: 6 },
    // Full-width horizontal wall at z in [3, 3.25].
    { x: 3, z: 3.125, w: 6, d: 0.25 },
  ];
  const mission = {
    spawns: {
      swat: [{ x: 2.9, z: 2.9, facing: 0, cellId: 0 }],
      hostiles: [],
      hostage: { x: 0.5, z: 0.5, facing: 0, cellId: 0 },
      extraction: { x: 0.5, z: 0.5 },
    },
  };

  const w = createWorld(plan, mission, placements);
  const a = w.agents[0];

  // Force the exact pathological state directly rather than hope
  // pathfinding produces it: a single waypoint far across the sealed
  // corner. The straight line from the agent to it passes through door 0's
  // tagged region (around x/z 4.0-5.0), well past the corner at x/z
  // 3.0-3.25 that is what actually traps the agent.
  a.goal = { x: 5.5, z: 5.5 };
  a.path = [{ x: 5.5, z: 5.5 }];
  a.pathIndex = 0;
  const originalPath = a.path;

  let everMisreportedWaitingOnDoor = false;
  let maxX = a.x;
  for (let i = 0; i < 150; i++) {
    w.tick();
    if (a.waitingFor === 0) everMisreportedWaitingOnDoor = true;
    if (a.x > maxX) maxX = a.x;
  }

  assert.equal(everMisreportedWaitingOnDoor, false,
    'agent was reported as waiting on the door 1.5m+ away instead of stalled at the wall corner right in front of it');
  assert.ok(maxX < 3.3,
    `agent escaped the sealed pocket (reached x=${maxX.toFixed(3)}) — the corner was not actually trapping it, so this test proves nothing`);
  assert.notEqual(a.path, originalPath,
    'the stall never triggered replan() — the agent is frozen, having mistaken the distant door for what is jamming it');
});
