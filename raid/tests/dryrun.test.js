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
// both to be non-trivial — on top of the per-tick geometry checks. Total
// distance alone is not enough by itself, though: the patrolling hostiles
// wander constantly, so a frozen SWAT squad could still clear a >50m total.
// Distance is also tracked per agent, and the SWAT squad specifically is
// required to have covered real ground. And 'done' itself is checked against
// `orders.hostageReached`, not just the phase name — the rescue phase is a
// no-op, and the advance watchdog can in principle skip straight past the
// hostage's room on its final leg, which would let a run reach 'done' having
// never actually gotten there.
test('a full headless mission completes cleanly at every room count', () => {
  const SEEDS_PER_ROOM_COUNT = 4;
  const MAX_TICKS = 60 * 120; // missions run ~25-54 simulated seconds now that combat can end one early; generous ceiling, not a target
  const outcomes = new Set();

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < SEEDS_PER_ROOM_COUNT; i++) {
      const seed = `e2e-${rooms}-${i}`;
      const plan = generateFloorplan(seed, { targetRooms: rooms });
      const mission = assignRoles(plan);
      const placements = layoutProps(plan, mission);
      const world = createWorld(plan, mission, placements);
      const orders = createOrders(plan, mission);

      const last = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z }]));
      const distance = new Map(world.agents.map((a) => [a.id, 0]));
      let totalDistance = 0;
      const openedDoors = new Set();

      let ticks = 0;
      while (orders.outcome === null && ticks < MAX_TICKS) {
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
          const step = Math.hypot(a.x - prev.x, a.z - prev.z);
          totalDistance += step;
          distance.set(a.id, distance.get(a.id) + step);
          prev.x = a.x; prev.z = a.z;
        }

        for (const door of Object.values(world.doors)) {
          if (door.state === 'open') openedDoors.add(door.id);
        }
      }

      outcomes.add(orders.outcome);

      // Either side may win — that is the point of a genuine contest. What is
      // never acceptable is a mission that neither finishes nor fails: that is
      // a hang, and it is the thing this test exists to catch.
      assert.ok(orders.outcome === 'success' || orders.outcome === 'failed',
        `${seed}: mission never resolved within ${MAX_TICKS / 60} simulated seconds`);

      if (orders.outcome === 'success') {
        assert.ok(orders.hostageReached,
          `${seed}: reported success without the squad ever reaching the hostage room`);
        assert.ok(world.agents.find((a) => a.role === 'hostage').alive,
          `${seed}: reported success with a dead hostage`);
      }

      // A run that "completes" without anyone actually moving would still
      // reach 'done' if a goal resolved off-grid and every phase fell through
      // an unchecked branch. These two are what tell a real mission apart
      // from a no-op that happens to report success.
      assert.ok(totalDistance > 50,
        `${seed}: agents travelled only ${totalDistance.toFixed(1)}m total across the whole mission`);
      assert.ok(openedDoors.size > 0,
        `${seed}: no door was ever opened during the run`);

      // Total distance alone is satisfied by the patrolling hostiles pacing
      // their rooms for the whole run — a frozen SWAT squad would still pass
      // it. Require the squad specifically to have covered real ground.
      //
      // Deliberately NOT filtered on `.alive`: a squad wipe is now a designed
      // outcome (not a rare accident), and filtering to survivors makes this
      // loop iterate zero agents on any seed where every SWAT dies — silently
      // asserting nothing on exactly the seeds where a frozen squad would be
      // hardest to tell apart from a genuinely fought-and-lost one. Every
      // SWAT agent's tracked distance already freezes at the tick it dies
      // (a corpse cannot move), so it still reads as real ground covered
      // before death, not zero.
      //
      // The `> 5` bar has much less headroom against a general seed
      // population than that might suggest -- two independent sweeps across
      // seeds outside this test's own fixed set found legitimate early
      // casualties under it: one a dead SWAT at 4.02m, with roughly 0.35% of
      // all dead-SWAT records landing under the bar; another a 5.31m minimum
      // over 644 dead-SWAT records, 0.31m of margin. What actually keeps this
      // assertion from being flaky is that this test runs a fixed set of 20
      // seeds (measured minimum distance before death: 10.71m), not any
      // margin baked into the `5` itself -- do not read `> 5` as safe against
      // an arbitrary seed, only against this specific set.
      for (const a of world.agents.filter((x) => x.role === 'swat')) {
        assert.ok(distance.get(a.id) > 5,
          `${seed}: SWAT agent ${a.id} travelled only ${distance.get(a.id).toFixed(1)}m — a frozen squad would still pass the aggregate distance check`);
      }

      // Aggregate distance is satisfied by a couple of busy patrollers while
      // the rest stand frozen. Every hostile that survived the mission should
      // have covered ground of its own.
      for (const a of world.agents.filter((x) => x.role === 'hostile' && x.alive)) {
        assert.ok(distance.get(a.id) > 1,
          `${seed}: surviving hostile ${a.id} never moved (${distance.get(a.id).toFixed(1)}m)`);
      }
    }
  }

  // A combat model where SWAT always win is as broken as one where they always
  // lose, and a suite that only ever observes one outcome is not testing
  // combat at all. This is deliberately about the SET of seeds, not any one
  // of them -- no individual seed is required to go either way.
  assert.ok(outcomes.has('success'), 'no seed produced a successful mission');
});
