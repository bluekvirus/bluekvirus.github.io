import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// rng.js, floorplan.js, roles.js and furnish.js are PURE: no Babylon, no DOM,
// runnable under plain Node. Three more phases are going to build on top of
// them, so a browser global creeping in (even one that "happens to work" in a
// browser test) needs to fail loudly here rather than surface later as a
// ReferenceError under `node --test`.
//
// main.js is NOT covered: it is a browser module, and its use of
// Math.random() (to mint a random seed string for the "shuffle" button) is
// legitimate there.
const PURE_FILES = [
  'rng.js', 'floorplan.js', 'roles.js', 'furnish.js',
  'sim/navgrid.js', 'sim/path.js', 'sim/world.js', 'sim/orders.js',
];

// Read as plain text and never imported — importing a module that touched
// `window` or `document` would throw under Node before this test got a
// chance to report anything useful.
const dir = path.dirname(fileURLToPath(import.meta.url));

// Comments are allowed to talk about these tokens (rng.js's file banner
// explains that generation "never touches Math.random", which would
// otherwise be a false positive) — strip them before scanning so the test
// checks actual code, not prose about the rule it enforces.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const FORBIDDEN = ['BABYLON', 'window', 'document', 'performance', 'location', 'Math.random'];

test('pure modules never reference browser globals', () => {
  for (const file of PURE_FILES) {
    const code = stripComments(readFileSync(path.join(dir, '..', file), 'utf8'));
    for (const token of FORBIDDEN) {
      const pattern = new RegExp(`(?<![\\w.])${token.replace('.', '\\.')}(?!\\w)`);
      assert.ok(!pattern.test(code), `${file} references "${token}", which is a browser/host global`);
    }
  }
});
