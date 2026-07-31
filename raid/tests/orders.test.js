import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { createWorld } from '../sim/world.js';
import { createOrders } from '../sim/orders.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => `orders-${i}`);
const build = (seed, overrides) => {
  const plan = generateFloorplan(seed, overrides);
  const mission = assignRoles(plan);
  const world = createWorld(plan, mission, layoutProps(plan, mission));
  return { plan, mission, world, orders: createOrders(plan, mission) };
};

test('the squad reaches the hostage and then extraction', () => {
  for (const seed of SEEDS) {
    const { mission, world, orders } = build(seed);
    let ticks = 0;
    while (orders.phase !== 'done' && ticks < 60 * 180) { world.tick(); orders.update(world); ticks++; }
    assert.equal(orders.phase, 'done', `${seed}: dry run did not finish within 180 simulated seconds`);
    const lead = world.agents.find((a) => a.role === 'swat');
    const gap = Math.hypot(lead.x - mission.spawns.extraction.x, lead.z - mission.spawns.extraction.z);
    assert.ok(gap < 3, `${seed}: squad finished ${gap.toFixed(1)}m from extraction`);
  }
});

test('the run is deterministic', () => {
  const a = build('det');
  const b = build('det');
  for (let i = 0; i < 1200; i++) {
    a.world.tick(); a.orders.update(a.world);
    b.world.tick(); b.orders.update(b.world);
  }
  assert.equal(a.world.hash(), b.world.hash());
  assert.equal(a.orders.phase, b.orders.phase);
});

test('doors along the route actually get opened', () => {
  const { world, orders } = build('doors');
  for (let i = 0; i < 60 * 90; i++) { world.tick(); orders.update(world); }
  const opened = Object.values(world.doors).filter((d) => d.state === 'open').length;
  assert.ok(opened > 0, 'the squad crossed the building without opening a single door');
});

test('hostiles move but stay in their own room', () => {
  const { plan, mission, world, orders } = build('patrol');
  const byId = new Map(plan.cells.map((c) => [c.id, c]));
  const homes = new Map(world.agents.filter((a) => a.role === 'hostile')
    .map((a, i) => [a.id, byId.get(mission.spawns.hostiles[i].cellId)]));
  let moved = 0;
  const startX = new Map(world.agents.map((a) => [a.id, a.x]));
  for (let i = 0; i < 60 * 40; i++) {
    world.tick(); orders.update(world);
    for (const a of world.agents.filter((x) => x.role === 'hostile')) {
      const home = homes.get(a.id);
      assert.ok(a.x >= home.x - 0.5 && a.x <= home.x + home.w + 0.5
        && a.z >= home.z - 0.5 && a.z <= home.z + home.d + 0.5,
        `hostile ${a.id} left its room`);
    }
  }
  for (const a of world.agents.filter((x) => x.role === 'hostile')) {
    if (Math.abs(a.x - startX.get(a.id)) > 0.3) moved++;
  }
  assert.ok(moved > 0, 'no hostile moved at all');
});

test('the hostage stays put until rescued', () => {
  const { world, orders } = build('hostage');
  const h = world.agents.find((a) => a.role === 'hostage');
  const x0 = h.x;
  const z0 = h.z;
  for (let i = 0; i < 60 * 20; i++) { world.tick(); orders.update(world); }
  assert.ok(Math.hypot(h.x - x0, h.z - z0) < 0.1, 'the hostage wandered off');
});

// Regression: seed `dry-10-8` with `{ targetRooms: 10 }` used to freeze one
// SWAT agent 18m from extraction forever. Several agents converging on the
// exact same extraction/advance coordinate let a goal-pull vector and a
// separation-push vector cancel to exactly zero (or land the step back on
// the agent's own already-open cell), which the old stall detector could
// never see as evidence — it only ever looked for a wall or a door refusing
// the move. A different seed family from `orders-N` on purpose: those seeds
// all passed throughout, which is exactly why one family was not enough to
// catch this.
test('a scripted dry run never leaves an agent frozen short of its goal', () => {
  const MAX_TICKS = 60 * 240;
  let worstTicks = 0;
  let worstSeed = null;
  let maxStillRun = 0;

  for (let rooms = 8; rooms <= 12; rooms++) {
    for (let i = 0; i < 10; i++) {
      const seed = `dry-${rooms}-${i}`;
      const { world, orders } = build(seed, { targetRooms: rooms });
      const still = new Map(world.agents.map((a) => [a.id, { x: a.x, z: a.z, run: 0 }]));
      let ticks = 0;
      while (orders.phase !== 'done' && ticks < MAX_TICKS) {
        world.tick();
        orders.update(world);
        ticks++;
        for (const a of world.agents) {
          const s = still.get(a.id);
          if (a.path && Math.hypot(a.x - s.x, a.z - s.z) < 1e-9) s.run++;
          else s.run = 0;
          s.x = a.x; s.z = a.z;
          if (s.run > maxStillRun) maxStillRun = s.run;
        }
      }
      assert.equal(orders.phase, 'done',
        `${seed} (rooms=${rooms}): dry run did not finish within ${MAX_TICKS / 60} simulated seconds`);
      if (ticks > worstTicks) { worstTicks = ticks; worstSeed = seed; }
    }
  }

  // A generous ceiling on how long even the worst of the 50 runs may take,
  // and on how long any single agent may hold a path while displacing
  // nothing at all — comfortably above the ~25 ticks a legitimate door wait
  // takes, so a door is never what trips this.
  assert.ok(worstTicks < MAX_TICKS,
    `worst run (${worstSeed}) used the entire ${MAX_TICKS / 60}s budget`);
  assert.ok(maxStillRun < 60,
    `an agent held a path with zero displacement for ${maxStillRun} consecutive ticks`);
});

test('replaying the previously-frozen seed reproduces the same run', () => {
  const run = () => {
    const { world, orders } = build('dry-10-8', { targetRooms: 10 });
    for (let i = 0; i < 60 * 240 && orders.phase !== 'done'; i++) { world.tick(); orders.update(world); }
    return { hash: world.hash(), phase: orders.phase };
  };
  const a = run();
  const b = run();
  assert.equal(a.phase, 'done');
  assert.equal(a.hash, b.hash);
  assert.equal(a.phase, b.phase);
});
