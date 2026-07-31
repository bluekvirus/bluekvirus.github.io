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
