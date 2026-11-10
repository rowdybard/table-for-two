import test from 'node:test';
import assert from 'node:assert/strict';
import { PerfWindow } from '../src/restaurant/PerfStats';

test('reports the actual draw rate separately from the update callback rate', () => {
  const window = new PerfWindow();
  assert.equal(window.sample(0, 2, 5), undefined);
  for (let i = 1; i < 30; i++) assert.equal(window.sample(i * 1000 / 60, 2, 5 + Math.floor(i / 2)), undefined);
  const sample = window.sample(500, 2, 20)!;
  assert.equal(sample.updateFPS, 60);
  assert.equal(sample.drawFPS, 30);
  assert.equal(sample.scriptMs, 2);
  assert.ok(Math.abs(sample.worstGap - 1000 / 60) < .001);
  for (let i = 1; i < 30; i++) window.sample(500 + i * 1000 / 60, 4, 20 + Math.floor(i / 2));
  const next = window.sample(1000, 4, 35)!;
  assert.equal(next.updateFPS, 60);
  assert.equal(next.drawFPS, 30);
  assert.equal(next.scriptMs, 4);
});

test('counter resets, backwards time, and explicit page suspensions start a fresh window', () => {
  const window = new PerfWindow();
  window.sample(0, 1, 20); window.sample(200, 1, 25);
  assert.equal(window.sample(250, 1, 0), undefined);
  assert.equal(window.sample(200, 1, 1), undefined);
  window.reset();
  assert.equal(window.sample(5000, 1, 10), undefined);
  const sample = window.sample(5500, 3, 25)!;
  assert.equal(sample.drawFPS, 30);
  assert.equal(sample.updateFPS, 2);
  assert.equal(sample.scriptMs, 3);
  assert.equal(sample.worstGap, 500);
});

test('a genuinely slow visible frame remains measurable instead of being discarded as a suspension', () => {
  const window = new PerfWindow();
  window.sample(0, 0, 0);
  const sample = window.sample(2600, 2500, 1)!;
  assert.equal(sample.drawFPS, 1000 / 2600);
  assert.equal(sample.updateFPS, 1000 / 2600);
  assert.equal(sample.scriptMs, 2500);
  assert.equal(sample.worstGap, 2600);
});
