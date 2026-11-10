import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeferredActivity } from '../src/restaurant/DeferredActivity';

test('GPU restoration work waits for activity, coalesces and is dropped on disposal', () => {
  const gate = new DeferredActivity(), calls: string[] = [];
  const restore = () => calls.push('restore');
  gate.setActive(false);
  gate.run(restore); gate.run(restore);
  assert.deepEqual(calls, []); assert.equal(gate.isActive, false);
  gate.setActive(true);
  assert.deepEqual(calls, ['restore']);
  gate.setActive(false); gate.run(restore); gate.dispose(); gate.setActive(true);
  assert.deepEqual(calls, ['restore']); assert.equal(gate.isActive, false);
});

test('work deferred again during a flush stays pending until the next activation', () => {
  const gate = new DeferredActivity(), calls: string[] = [];
  gate.setActive(false);
  gate.run(() => { calls.push('first'); gate.setActive(false); });
  gate.run(() => calls.push('second'));
  gate.setActive(true); assert.deepEqual(calls, ['first']);
  gate.setActive(true); assert.deepEqual(calls, ['first', 'second']);
});

test('inactive resize requests coalesce and apply the latest viewport on return', () => {
  const gate = new DeferredActivity(), sizes: number[] = [];
  let viewport = 100;
  const resize = () => sizes.push(viewport);
  gate.setActive(false);
  gate.run(resize); viewport = 240; gate.run(resize); viewport = 360;
  assert.deepEqual(sizes, []);
  gate.setActive(true);
  assert.deepEqual(sizes, [360]);
  gate.setActive(true); assert.deepEqual(sizes, [360]);
});
