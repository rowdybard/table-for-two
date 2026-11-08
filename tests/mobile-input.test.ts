import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MobileInput } from '../src/restaurant/MobileInput';

test('two thumbs move and look independently, including out-of-order releases', () => {
  const input = new MobileInput();
  assert.equal(input.beginMove(3, 70, 180), true);
  assert.equal(input.beginLook(8, 620, 180), true);
  assert.equal(input.move(3, 114, 136), true);
  assert.ok(input.movement.horizontal > .7);
  assert.ok(input.movement.forward > .7);
  assert.ok(Math.hypot(input.movement.horizontal, input.movement.forward) <= 1);
  assert.deepEqual(input.look(8, 640, 186), { x: 20, y: 6 });
  input.end(8);
  assert.ok(input.movement.forward > .7, 'lifting the look thumb must preserve movement');
  assert.equal(input.look(8, 660, 180), null);
  input.end(3);
  assert.deepEqual(input.movement, { horizontal: 0, forward: 0 });
});

test('thumb jitter stays still and analog speed reaches full movement at the edge', () => {
  const input = new MobileInput(40, .15);
  input.beginMove(1, 100, 100);
  input.move(1, 103, 98);
  assert.deepEqual(input.movement, { horizontal: 0, forward: 0 });
  input.move(1, 120, 100);
  assert.ok(input.movement.horizontal > .4 && input.movement.horizontal < .5);
  input.move(1, 500, 100);
  assert.equal(input.movement.horizontal, 1);
  assert.equal(input.movement.forward, 0);
});

test('extra fingers cannot steal, move, or release a held thumb', () => {
  const input = new MobileInput();
  input.beginMove(1, 100, 100); input.move(1, 144, 100);
  assert.equal(input.beginMove(2, 50, 50), false);
  assert.equal(input.beginLook(1, 50, 50), false);
  assert.equal(input.move(2, 100, 200), false);
  input.end(2);
  assert.equal(input.movement.horizontal, 1);
  input.beginLook(2, 300, 100);
  assert.equal(input.beginLook(3, 300, 100), false);
  assert.equal(input.look(3, 400, 200), null);
});

test('menu, lost capture, rotation and visibility cancellation erase both thumb owners', () => {
  const input = new MobileInput();
  input.beginMove(1, 100, 100); input.move(1, 144, 100);
  input.beginLook(2, 300, 100);
  input.clear();
  assert.deepEqual(input.movement, { horizontal: 0, forward: 0 });
  assert.equal(input.movementPointer, null);
  assert.equal(input.lookPointer, null);
  assert.equal(input.move(1, 100, 100), false);
  assert.equal(input.look(2, 350, 100), null);
  assert.equal(input.beginMove(1, 100, 100), true);
  assert.deepEqual(input.movement, { horizontal: 0, forward: 0 });
});

test('look discontinuities are bounded and never retain a delta after cancellation', () => {
  const input = new MobileInput();
  input.beginLook(7, 300, 100);
  assert.deepEqual(input.look(7, 1000, -200), { x: 100, y: -100 });
  assert.deepEqual(input.look(7, 1005, -195), { x: 5, y: 5 });
  input.end(7);
  assert.equal(input.look(7, 1010, -190), null);
});
