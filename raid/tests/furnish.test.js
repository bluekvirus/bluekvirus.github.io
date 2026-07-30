import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFloorplan } from '../floorplan.js';
import { assignRoles } from '../roles.js';
import { layoutProps } from '../furnish.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `props-${i}`);

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
