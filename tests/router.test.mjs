import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, isoWeekday, THEME_BY_WEEKDAY } from '../js/router.js';

// Local-time constructors — July 27 2026 is a Monday.
const MON = new Date(2026, 6, 27), TUE = new Date(2026, 6, 28), WED = new Date(2026, 6, 29),
      THU = new Date(2026, 6, 30), FRI = new Date(2026, 6, 31), SAT = new Date(2026, 7, 1),
      SUN = new Date(2026, 7, 2);
const BOTH = new Set(['dune', 'w40k']);

test('isoWeekday maps Mon..Sun to 1..7', () => {
  assert.equal(isoWeekday(MON), 1);
  assert.equal(isoWeekday(SAT), 6);
  assert.equal(isoWeekday(SUN), 7);
});

test('registry: dune on 1,3,5,7 and w40k on 2,4,6', () => {
  assert.deepEqual(THEME_BY_WEEKDAY, { 1: 'dune', 2: 'w40k', 3: 'dune', 4: 'w40k', 5: 'dune', 6: 'w40k', 7: 'dune' });
});

test('dune days resolve to dune', () => {
  for (const d of [MON, WED, FRI, SUN]) {
    assert.equal(resolveTheme({ date: d, search: '' }), 'dune');
  }
});

test('w40k days resolve to w40k once implemented', () => {
  for (const d of [TUE, THU, SAT]) {
    assert.equal(resolveTheme({ date: d, search: '', implemented: BOTH }), 'w40k');
  }
});

test('unimplemented theme falls back to dune', () => {
  assert.equal(resolveTheme({ date: TUE, search: '' }), 'dune');
});

test('?theme= override wins when implemented', () => {
  assert.equal(resolveTheme({ date: TUE, search: '?theme=dune', implemented: BOTH }), 'dune');
});

test('unknown ?theme= override is ignored', () => {
  assert.equal(resolveTheme({ date: MON, search: '?theme=zzz' }), 'dune');
});
