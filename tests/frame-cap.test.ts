import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDrawCadence, createFrameCap, createFrameIntervalClock } from '../src/restaurant/FrameCap';

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

test('low-tier drawing averages thirty frames without reducing the input callback cadence', () => {
  for (const hz of [60, 75, 90, 120, 144, 240]) {
    const drawing = createDrawCadence(30); let draws = 0, inputCallbacks = 0;
    for (let callback = 0; callback < hz * 4; callback++) {
      inputCallbacks++;
      if (drawing.shouldDraw(callback * 1000 / hz)) draws++;
    }
    assert.equal(inputCallbacks, hz * 4);
    assert.ok(Math.abs(draws - 120) <= 1, `${hz} Hz produced ${draws} draws`);
  }
  const slow = createDrawCadence(30);
  for (const now of [0, 500, 1000, 9000]) assert.equal(slow.shouldDraw(now), true, 'slow devices are not capped further');
  assert.equal(slow.shouldDraw(9000), false, 'a missed interval never produces catch-up draws');
  slow.reset(); assert.equal(slow.shouldDraw(9000), true, 'a restored/resized canvas draws immediately');
});

test('render timing retains multi-second frame cost and excludes a reset hidden-tab gap', () => {
  const clock = createFrameIntervalClock();
  assert.equal(clock.sample(1000), 0);
  assert.equal(clock.sample(3600), 2.6, 'quality sees wall time rather than animation dt clamped to sixty milliseconds');
  clock.reset(); assert.equal(clock.sample(90000), 0);
  assert.ok(Math.abs(clock.sample(90016) - .016) < 1e-9);
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
