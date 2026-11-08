import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchLookTap } from '../src/restaurant/TouchLookTap';

const start = (tap: TouchLookTap, id: number, at = 0) => { tap.pointerDown(id); tap.begin(id, 100, 200, at); };

test('a short, almost stationary finger is one inspection tap', () => {
  const tap = new TouchLookTap(); start(tap, 1, 1000);
  tap.move(1, 103, 204); tap.pointerUp(1);
  assert.equal(tap.end(1, 103, 204, 1349), true);
  assert.equal(tap.end(1, 103, 204, 1350), false, 'one pointer cannot activate twice');
});

test('dragging, returning, long presses and exact thresholds never inspect', () => {
  const tap = new TouchLookTap(); start(tap, 1); tap.move(1, 108, 200); tap.move(1, 100, 200); tap.pointerUp(1);
  assert.equal(tap.end(1, 100, 200, 100), false);
  start(tap, 2); tap.pointerUp(2); assert.equal(tap.end(2, 100, 200, 350), false);
  start(tap, 3); tap.pointerUp(3); assert.equal(tap.end(3, 108, 200, 200), false);
});

test('a second finger anywhere cancels inspection until all fingers lift', () => {
  const tap = new TouchLookTap(); start(tap, 1);
  tap.pointerDown(2); tap.pointerUp(2); tap.pointerUp(1);
  assert.equal(tap.end(1, 100, 200, 100), false);
  tap.pointerDown(3); tap.pointerDown(4); tap.begin(4, 100, 200, 100);
  tap.pointerUp(3); tap.pointerUp(4);
  assert.equal(tap.end(4, 100, 200, 200), false, 'a touch that began with another finger down cannot inspect');
  start(tap, 5, 200); tap.pointerUp(5);
  assert.equal(tap.end(5, 100, 200, 201), true);
});

test('clear and lost capture cancel the owner without promoting another finger', () => {
  const tap = new TouchLookTap(); start(tap, 1); tap.cancel(); tap.pointerUp(1);
  assert.equal(tap.end(1, 100, 200, 100), false);
  start(tap, 2, 100); assert.equal(tap.end(3, 100, 200, 200), false);
  tap.reset(); assert.equal(tap.end(2, 100, 200, 200), false);
  start(tap, 4, 200); tap.pointerUp(4); assert.equal(tap.end(4, 100, 200, 201), true);
});
