import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENING_EXCHANGES } from '../src/restaurant/evening';
import { CLOSING_HOUR, wallClockAngles, wallClockMinutes } from '../src/restaurant/render/WallClock';
import { CLOSING_SCRIPTS } from '../src/restaurant/evaluation-closing';
import { parseEvaluationOptions } from '../scripts/lib/conversation-evaluation';
import { EVALUATION_SCRIPTS } from '../src/restaurant/evaluation';

test('the wall clock starts a full evening at eight and reaches closing time when no exchanges are left', () => {
  assert.equal(wallClockMinutes(EVENING_EXCHANGES), 8 * 60);
  assert.equal(wallClockMinutes(0), CLOSING_HOUR * 60);
  assert.equal(wallClockMinutes(EVENING_EXCHANGES - 1) - wallClockMinutes(EVENING_EXCHANGES), 5);
  // Out-of-range or missing counts never run the hands past closing or before opening.
  assert.equal(wallClockMinutes(-4), CLOSING_HOUR * 60);
  assert.equal(wallClockMinutes(999), 8 * 60);
  assert.equal(wallClockMinutes(Number.NaN), 8 * 60);
});

test('the wall clock hands point where a real clock would', () => {
  const eight = wallClockAngles(8 * 60), closing = wallClockAngles(11 * 60), half = wallClockAngles(9 * 60 + 30);
  assert.ok(Math.abs(eight.minute) < 1e-9 && Math.abs(eight.hour - (8 / 12) * Math.PI * 2) < 1e-9);
  assert.ok(Math.abs(closing.minute) < 1e-9 && Math.abs(closing.hour - (11 / 12) * Math.PI * 2) < 1e-9);
  assert.ok(Math.abs(half.minute - Math.PI) < 1e-9 && Math.abs(half.hour - (9.5 / 12) * Math.PI * 2) < 1e-9);
});

test('closing scripts are whole clocked evenings kept outside the frozen corpus', () => {
  assert.equal(CLOSING_SCRIPTS.length, 5);
  for (const script of CLOSING_SCRIPTS) { assert.equal(script.turns.length, EVENING_EXCHANGES); assert.equal(script.closingClock, true); assert.equal(script.mode, 'solo'); }
  assert.ok(EVALUATION_SCRIPTS.every(script => !script.closingClock && !script.id.startsWith('closing-')));
  assert.deepEqual(parseEvaluationOptions(['--suite', 'closing']).scripts.map(script => script.id), CLOSING_SCRIPTS.map(script => script.id));
  assert.ok(parseEvaluationOptions(['--suite', 'all']).scripts.every(script => !script.closingClock));
});
