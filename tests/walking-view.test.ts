import test from 'node:test';
import assert from 'node:assert/strict';
import { WalkingView } from '../src/restaurant/WalkingView';

test('walking responds before a delayed snapshot and stays smooth between updates', () => {
  const view = new WalkingView(), start: [number, number, number] = [0, 0, 5];
  const first = view.sample('date', start, true, 0, -1, 1 / 60);
  const second = view.sample('date', start, true, 0, -1, 1 / 60);
  assert.ok(first[2] < start[2]);
  assert.ok(second[2] < first[2]);
  assert.deepEqual(start, [0, 0, 5], 'presentation must not mutate authoritative state');
  const updated = view.sample('date', [0, 0, 4.86], true, 0, -1, 1 / 60);
  assert.ok(updated[2] < second[2], 'a delayed snapshot does not pull a walking camera backwards');
});

test('a collision or stalled connection bounds the estimate and release converges to the server', () => {
  const view = new WalkingView(), wall: [number, number, number] = [0, 0, 0];
  let position = wall;
  for (let i = 0; i < 180; i++) position = view.sample('date', wall, true, 1, 0, 1 / 60);
  assert.ok(position[0] > 0 && position[0] <= .200001);
  for (let i = 0; i < 60; i++) position = view.sample('date', wall, true, 0, 0, 1 / 60);
  assert.ok(position[0] < .001);
});

test('seating, pausing, and a different session discard the old estimate', () => {
  const view = new WalkingView();
  view.sample('old', [0, 0, 0], true, 1, 0, .06);
  assert.deepEqual(view.sample('old', [4, 0, 2], false, 1, 0, .06), [4, 0, 2]);
  const fresh = view.sample('new', [-2, 0, 1], true, 0, 0, .06);
  assert.deepEqual(fresh, [-2, 0, 1]);
});

