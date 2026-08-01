import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';

// CPU time, not wall clock — the same correction already applied to every
// budget in simbudget.test.js, which this test was simply missed out of.
// `node --test` runs the test files concurrently, so a wall-clock stopwatch
// measures how much of the CPU the scheduler happened to hand this process,
// not how fast the code is. Left on wall clock, this test read a worst sample
// of 45-73ms against a 30ms budget on all five of five concurrent runs while
// its own median stayed at 2.6ms — a pure contention artefact, and the kind of
// failure that teaches people to ignore the suite.
const cpuMs = (start) => {
  const u = process.cpuUsage(start);
  return (u.user + u.system) / 1000;
};

test('a full generation stays inside the 30ms budget', () => {
  // Warm up first: the first call pays for JIT compilation, which is not what
  // the budget is about.
  for (let i = 0; i < 20; i++) {
    const plan = generateFloorplan(`warm-${i}`);
    layoutProps(plan, assignRoles(plan));
  }

  const timings = [];
  for (let i = 0; i < 100; i++) {
    const started = process.cpuUsage();
    const plan = generateFloorplan(`budget-${i}`);
    const mission = assignRoles(plan);
    layoutProps(plan, mission);
    timings.push(cpuMs(started));
  }

  timings.sort((a, b) => a - b);
  const worst = timings.at(-1);
  const median = timings[Math.floor(timings.length / 2)];
  assert.ok(worst < 30,
    `worst generation took ${worst.toFixed(1)}ms CPU (median ${median.toFixed(1)}ms), budget is 30ms`);
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
