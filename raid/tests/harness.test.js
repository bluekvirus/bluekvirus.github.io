import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('character pack lives at the shared root path', () => {
  assert.ok(existsSync('assets/quaternius/Swat.glb'), 'Swat.glb should be under assets/quaternius/');
  assert.ok(existsSync('assets/quaternius/LICENSE.txt'), 'the CC0 licence must travel with the assets');
});
