import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameCap } from '../src/restaurant/FrameCap';

/** Feed `frames` callbacks at `hz` (with a little jitter) and return how many ran the game in the last second. */
function run(hz: number, frames = 400) {
  const cap = createFrameCap();
  let now = 1000, rendered = 0;
  for (let i = 0; i < frames; i++) {
    now += 1000 / hz + (i % 3 - 1) * .15;
    if (cap.shouldRender(now) && i >= frames - hz) rendered++;
  }
  return { divisor: cap.divisor, rendered };
}

test('high-refresh displays run the game at about 60 fps, ordinary ones on every refresh', () => {
  for (const [hz, divisor] of [[60, 1], [75, 1], [90, 1], [100, 1], [120, 2], [144, 2], [165, 2], [240, 4]] as const) {
    const result = run(hz);
    assert.equal(result.divisor, divisor, `${hz} Hz`);
    assert.ok(Math.abs(result.rendered - hz / divisor) <= 1, `${hz} Hz renders ${result.rendered}`);
  }
});

test('a device that cannot keep up is never capped further, and long gaps are ignored', () => {
  assert.equal(run(30).divisor, 1);
  assert.equal(run(45).divisor, 1);
  const cap = createFrameCap();
  let now = 0;
  for (let i = 0; i < 200; i++) { now += i % 50 === 49 ? 5000 : 1000 / 144; cap.shouldRender(now); }
  assert.equal(cap.divisor, 2, 'hidden-tab gaps do not skew the measured rate');
  assert.equal(createFrameCap().shouldRender(123), true, 'the very first frame runs');
});
