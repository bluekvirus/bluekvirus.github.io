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
