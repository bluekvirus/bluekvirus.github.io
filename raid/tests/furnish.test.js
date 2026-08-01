import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';
import { buildNavGrid } from '../sim/navgrid.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `props-${i}`);

// Sizes of every separate walkable region, largest first. 4-connected, because
// that is exactly the reachability findPath offers: its diagonals are legal
// only when both orthogonal neighbours they squeeze between are open, so every
// legal diagonal decomposes into two orthogonal steps.
const walkableRegions = (grid) => {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const sizes = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const first = grid.index(col, row);
      if (seen[first] || grid.blocked[first]) continue;
      let size = 0;
      const stack = [first];
      seen[first] = 1;
      while (stack.length) {
        const at = stack.pop();
        size++;
        const c = at % grid.cols;
        const r = (at - c) / grid.cols;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!grid.inBounds(c + dc, r + dr)) continue;
          const idx = grid.index(c + dc, r + dr);
          if (seen[idx] || grid.blocked[idx]) continue;
          seen[idx] = 1;
          stack.push(idx);
        }
      }
      sizes.push(size);
    }
  }
  return sizes.sort((a, b) => b - a);
};

const build = (seed) => {
  const plan = generateFloorplan(seed);
  const mission = assignRoles(plan);
  return { plan, mission, props: layoutProps(plan, mission) };
};

test('placement is deterministic', () => {
  assert.deepEqual(build('same').props, build('same').props);
});

test('every prop stays inside its cell', () => {
  for (const seed of SEEDS) {
    const { plan, props } = build(seed);
    const byId = new Map(plan.cells.map((c) => [c.id, c]));
    for (const p of props) {
      const cell = byId.get(p.cellId);
      assert.ok(p.x - p.w / 2 >= cell.x - 1e-6 && p.x + p.w / 2 <= cell.x + cell.w + 1e-6
        && p.z - p.d / 2 >= cell.z - 1e-6 && p.z + p.d / 2 <= cell.z + cell.d + 1e-6,
        `${seed}: prop in cell ${p.cellId} pokes through a wall`);
    }
  }
});

test('no prop blocks a doorway', () => {
  for (const seed of SEEDS) {
    const { plan, props } = build(seed);
    for (const door of plan.doors) {
      for (const p of props) {
        const gap = Math.hypot(p.x - door.x, p.z - door.z);
        assert.ok(gap >= 1.2, `${seed}: prop sits ${gap.toFixed(2)}m from door ${door.id}`);
      }
    }
  }
});

test('props do not overlap each other', () => {
  for (const seed of SEEDS) {
    const { props } = build(seed);
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const a = props[i];
        const b = props[j];
        const hit = Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;
        assert.ok(!hit, `${seed}: props ${i} and ${j} overlap`);
      }
    }
  }
});

test('no prop lands on a spawn point', () => {
  for (const seed of SEEDS) {
    const { mission, props } = build(seed);
    const figures = [...mission.spawns.swat, ...mission.spawns.hostiles, mission.spawns.hostage];
    for (const f of figures) {
      for (const p of props) {
        const hit = Math.abs(f.x - p.x) * 2 < p.w + 0.6 && Math.abs(f.z - p.z) * 2 < p.d + 0.6;
        assert.ok(!hit, `${seed}: a prop is on top of a figure`);
      }
    }
  }
});

test('rooms actually get furnished', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    const { props } = build(seed);
    assert.ok(props.length >= 6, `${seed}: only ${props.length} props placed`);
  }
});

test('no prop seals off part of the building', () => {
  // Keeping props 1.35m off door centres is not enough. The nav grid erodes
  // every walkable surface by the agent radius first, so a corridor measuring
  // 1.16m on the plan is ~0.5m wide to a pathfinder, and one cabinet standing
  // in it — clear of every door, wall, figure and other prop — severs it.
  // Before the connectivity guard this split the grid on 32 of these 100 maps,
  // stranding pockets of up to 95 cells; a formation point landing in one made
  // that squad member's setGoal fail permanently, and only the leg watchdog
  // eventually dragged the mission past it.
  //
  // The bare grid is checked too, and not as a formality: if the generator
  // ever started producing disconnected floor plans on its own, the assertion
  // below would fail for a reason that has nothing to do with furniture, and
  // this is what tells the two apart.
  for (const seed of SEEDS.slice(0, 100)) {
    const { plan, props } = build(seed);

    const bare = walkableRegions(buildNavGrid(plan));
    assert.equal(bare.length, 1,
      `${seed}: the floor plan is already disconnected before any prop is placed (regions ${JSON.stringify(bare)})`);

    const furnished = walkableRegions(buildNavGrid(plan, props));
    assert.equal(furnished.length, 1,
      `${seed}: props stranded ${furnished.length - 1} pocket(s) of ${furnished.slice(1).join('/')} cells`);

    // Rejecting a sealing spot costs a prop its position, not its existence —
    // another attempt is sampled. If the guard ever started rejecting wholesale
    // instead, the rooms would quietly empty out and every assertion above
    // would still pass.
    assert.ok(props.length >= 6,
      `${seed}: only ${props.length} props survived the connectivity guard`);
  }
});
