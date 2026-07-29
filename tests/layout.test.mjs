import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT } from '../themes/dune/layout.js';

// Task 5: reinforcement entry routes — pure-coordinate invariants the
// attrition machine in troops.js depends on.

test('reinforce routes exist for both factions as non-empty [x,z] waypoint lists', () => {
  for (const fac of ['fremen', 'hark']) {
    const wps = LAYOUT.reinforce[fac];
    assert.ok(Array.isArray(wps) && wps.length >= 1, `${fac} route missing`);
    for (const wp of wps) {
      assert.equal(wp.length, 2);
      assert.ok(wp.every(Number.isFinite));
    }
  }
});

test('fremen re-enter from the eastern dunes, beyond the whole cover line', () => {
  const [entryX] = LAYOUT.reinforce.fremen[0];
  const maxCoverX = Math.max(...LAYOUT.fremenCover.map(([x]) => x));
  // beyond the farthest cover point even after de-confliction offsets (<=20)
  assert.ok(entryX > maxCoverX + 20 + 40, `fremen entry x=${entryX} not beyond cover line (max ${maxCoverX})`);
});

test('hark entry spawns behind the harvester, clear of every leg foot pad', () => {
  const [entry, ...rest] = LAYOUT.reinforce.hark;
  assert.ok(rest.length >= 1, 'hark route needs at least one rally waypoint after the entry');
  // "behind the harvester": on the far (north-west / -x,-z) side of the hull
  // center relative to the battlefield.
  const h = LAYOUT.harvester;
  assert.ok(entry[0] < h.x - 60, `hark entry x=${entry[0]} not behind the hull (hull x=${h.x})`);
  // every route waypoint keeps >=10 units from every harvester foot pad
  // (harvester.js legs: local (lx in {-48,-6,36}, z=+-43), rotY applied)
  const c = Math.cos(h.rotY), s = Math.sin(h.rotY);
  const feet = [];
  for (const side of [-1, 1]) {
    for (const lx of [-48, -6, 36]) {
      feet.push([h.x + c * lx + s * side * 43, h.z - s * lx + c * side * 43]);
    }
  }
  const wps = LAYOUT.reinforce.hark;
  for (let k = 0; k + 1 < wps.length; k++) {
    const [ax, az] = wps[k], [bx, bz] = wps[k + 1];
    for (const [fx, fz] of feet) {
      // point-to-segment distance
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((fx - ax) * dx + (fz - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(fx - (ax + t * dx), fz - (az + t * dz));
      assert.ok(d >= 10, `hark route leg ${k} passes ${d.toFixed(1)} units from foot pad (${fx.toFixed(0)},${fz.toFixed(0)})`);
    }
  }
});
