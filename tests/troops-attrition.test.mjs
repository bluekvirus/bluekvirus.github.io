import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// troops.js imports three.js from a CDN import map (see index.html) — there
// is no local `three` package for bare `node --test` to resolve. Rather than
// skip this regression test (or re-implement the state machine separately,
// which would test a copy instead of the real code), we register a Node
// module-customization hook that substitutes a minimal headless stub for
// 'three' / 'three/addons/utils/BufferGeometryUtils.js' — see
// tests/helpers/three-min-stub.mjs for exactly what it covers and why that's
// safe. troops.js itself is imported completely unmodified. The hook must be
// registered before troops.js is (dynamically) imported, so this file avoids
// a static top-level import of it.
const helpersDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'helpers');
register(pathToFileURL(path.join(helpersDir, 'three-min-loader.mjs')).href, import.meta.url);

const { createTroops } = await import(
  pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), '../themes/dune/troops.js')).href
);

// Regression guard for the reduced-motion guarantee (task-5 spec §5 / brief
// step 4e): under `prefers-reduced-motion`, main.js calls
// `updater.update(0, FROZEN_TIME)` every rAF frame forever (dt is always 0,
// elapsed is always the same constant) — see themes/dune/main.js's `tick()`
// (`const edt = state.reduced ? 0 : dt; const elapsed = state.reduced ?
// FROZEN_TIME : state.clock.elapsedTime;`). The frozen frame must still show
// a body or two, or reduced-motion visitors would only ever see the
// choreography's cover/fire/advance poses with no visible attrition at all.
// This is currently protected only by a code comment and a one-time manual
// check on scriptDeath()'s two build-time casualties — a future change to
// KILL_COOLDOWN_*, DOWN_MIN, SINK_DUR, FROZEN_TIME, or the PRNG seed could
// silently break it. Assert the COUNT of dying/down units (not which
// indices) so this stays robust to unrelated choreography/index tweaks.
const FROZEN_TIME = 9; // must match themes/dune/main.js's FROZEN_TIME

test('reduced motion: frozen frame (dt=0, elapsed=FROZEN_TIME) still shows >=2 casualties', () => {
  const troops = createTroops();
  // Mirror main.js's reduced-motion loop: dt is always 0, elapsed is always
  // FROZEN_TIME, called every rAF frame indefinitely.
  for (let i = 0; i < 10; i++) troops.update(0, FROZEN_TIME);

  const casualties = troops.units.filter(u => u.state === 'dying' || u.state === 'down');
  assert.ok(
    casualties.length >= 2,
    `expected >=2 units in 'dying'/'down' at the frozen frame, got ${casualties.length} ` +
    `(states: ${troops.units.map(u => u.state).join(',')})`,
  );

  // The frozen frame must also be genuinely stable: repeating update(0, 9)
  // must not advance the attrition PRNG (no impacts can ever be reported
  // when dt === 0, since combatfx never spawns tracers) and must not change
  // which units are counted as casualties.
  const drawsBefore = troops.attrition.draws();
  const statesBefore = troops.units.map(u => u.state);
  for (let i = 0; i < 50; i++) troops.update(0, FROZEN_TIME);
  assert.equal(troops.attrition.draws(), drawsBefore, 'PRNG must not advance under repeated dt=0 updates');
  assert.deepEqual(troops.units.map(u => u.state), statesBefore, 'unit states must be stable under repeated dt=0 updates');
});
