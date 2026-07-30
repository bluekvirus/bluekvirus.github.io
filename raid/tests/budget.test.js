import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';

test('a full generation stays inside the 30ms budget', () => {
  // Warm up first: the first call pays for JIT compilation, which is not what
  // the budget is about.
  for (let i = 0; i < 20; i++) {
    const plan = generateFloorplan(`warm-${i}`);
    layoutProps(plan, assignRoles(plan));
  }

  const timings = [];
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    const plan = generateFloorplan(`budget-${i}`);
    const mission = assignRoles(plan);
    layoutProps(plan, mission);
    timings.push(performance.now() - started);
  }

  timings.sort((a, b) => a - b);
  const worst = timings.at(-1);
  const median = timings[Math.floor(timings.length / 2)];
  assert.ok(worst < 30,
    `worst generation took ${worst.toFixed(1)}ms (median ${median.toFixed(1)}ms), budget is 30ms`);
});

test('every room count in the HUD range generates cleanly', () => {
  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 40; i++) {
      const plan = generateFloorplan(`rooms-${rooms}-${i}`, { targetRooms: rooms });
      const mission = assignRoles(plan);
      layoutProps(plan, mission);
      assert.equal(mission.spawns.swat.length, 4);
    }
  }
});
