import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

// The whole point of a pure simulation: run the entire mission, on every room
// count the HUD offers, without a renderer — and assert nothing went wrong at
// any tick, which no amount of watching the screen could establish.
//
// Two tests elsewhere in this project were caught asserting nothing: one
// drove agents toward a goal that resolved outside the grid, so nobody ever
// moved; another measured a quantity that stayed correct while the real
// defect went unmeasured in a run that had gone quietly wrong. A dry run
// that reaches 'done' because nothing happened must fail here too, so this
// test also totals distance travelled and counts doors opened, and requires
// both to be non-trivial — on top of the per-tick geometry checks.
test('a full headless mission completes cleanly at every room count', () => {
  const SEEDS_PER_ROOM_COUNT = 4;
  const MAX_TICKS = 60 * 120; // missions run ~77-87 simulated seconds; generous ceiling, not a target

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < SEEDS_PER_ROOM_COUNT; i++) {
      const seed = `e2e-${rooms}-${i}`;
      const plan = generateFloorplan(seed, { targetRooms: rooms });
      const mission = assignRoles(plan);
      const placements = layoutProps(plan, mission);
      const world = createWorld(plan, mission, placements);
      const orders = createOrders(plan, mission);

      const last = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z }]));
      let totalDistance = 0;
      const openedDoors = new Set();

      let ticks = 0;
      while (orders.phase !== 'done' && ticks < MAX_TICKS) {
        world.tick();
        orders.update(world);
        ticks++;

        for (const a of world.agents) {
          assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z),
            `${seed}: agent ${a.id} position went non-finite at tick ${ticks}`);

          const c = world.grid.worldToCell(a.x, a.z);
          assert.equal(world.grid.isBlocked(c.col, c.row), false,
            `${seed}: agent ${a.id} inside geometry at tick ${ticks}`);

          const doorId = world.grid.doorAt(c.col, c.row);
          if (doorId !== -1) {
            assert.equal(world.doors[doorId].state, 'open',
              `${seed}: agent ${a.id} inside door ${doorId} while it is ${world.doors[doorId].state} at tick ${ticks}`);
          }

          const prev = last.get(a.id);
          totalDistance += Math.hypot(a.x - prev.x, a.z - prev.z);
          prev.x = a.x; prev.z = a.z;
        }

        for (const door of Object.values(world.doors)) {
          if (door.state === 'open') openedDoors.add(door.id);
        }
      }

      assert.equal(orders.phase, 'done', `${seed}: did not finish within ${MAX_TICKS / 60} simulated seconds`);

      // A run that "completes" without anyone actually moving would still
      // reach 'done' if a goal resolved off-grid and every phase fell through
      // an unchecked branch. These two are what tell a real mission apart
      // from a no-op that happens to report success.
      assert.ok(totalDistance > 50,
        `${seed}: agents travelled only ${totalDistance.toFixed(1)}m total across the whole mission`);
      assert.ok(openedDoors.size > 0,
        `${seed}: no door was ever opened during the run`);
    }
  }
});
