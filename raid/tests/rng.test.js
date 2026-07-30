import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, hashSeed } from '../rng.js';

test('the same seed replays the same sequence', () => {
  const a = makeRng('alpha');
  const b = makeRng('alpha');
  const left = Array.from({ length: 50 }, () => a.next());
  const right = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(left, right);
});

test('different seeds diverge', () => {
  const a = Array.from({ length: 20 }, (_, i) => makeRng('alpha').next() + i);
  const b = Array.from({ length: 20 }, (_, i) => makeRng('beta').next() + i);
  assert.notDeepEqual(a, b);
});

test('next stays in [0, 1)', () => {
  const rng = makeRng('bounds');
  for (let i = 0; i < 10000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `next() returned ${v}`);
  }
});

test('int stays in range and reaches both ends', () => {
  const rng = makeRng('ints');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(3, 7);
    assert.ok(Number.isInteger(v), `${v} is not an integer`);
    assert.ok(v >= 3 && v < 7, `${v} out of range`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
});

test('range respects its bounds', () => {
  const rng = makeRng('range');
  for (let i = 0; i < 5000; i++) {
    const v = rng.range(-2, 5);
    assert.ok(v >= -2 && v < 5, `${v} out of range`);
  }
});

test('pick returns a member of the array', () => {
  const rng = makeRng('pick');
  const items = ['a', 'b', 'c'];
  for (let i = 0; i < 200; i++) assert.ok(items.includes(rng.pick(items)));
});

test('hashSeed is stable and unsigned', () => {
  assert.equal(hashSeed('alpha'), hashSeed('alpha'));
  assert.notEqual(hashSeed('alpha'), hashSeed('beta'));
  assert.ok(hashSeed('alpha') >= 0);
});
