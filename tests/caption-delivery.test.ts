import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionReadingMs, waitForCaptionReading } from '../src/restaurant/caption-delivery';

test('hidden or disabled captions never produce completed reading evidence', async () => {
  const visibility = new EventTarget();
  assert.equal(await waitForCaptionReading(1, new AbortController().signal, visibility, () => false), false);
});

test('hiding and returning during a caption cancels its delivery rather than completing retroactively', async () => {
  const visibility = new EventTarget(); let visible = true;
  const reading = waitForCaptionReading(30, new AbortController().signal, visibility, () => visible);
  visible = false; visibility.dispatchEvent(new Event('visibilitychange'));
  visible = true; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(await reading, false);
});

test('only a continuously visible full reading interval completes; cancellation wins', async () => {
  const visibility = new EventTarget();
  assert.equal(await waitForCaptionReading(5, new AbortController().signal, visibility, () => true), true);
  const controller = new AbortController();
  const reading = waitForCaptionReading(30, controller.signal, visibility, () => true); controller.abort();
  assert.equal(await reading, false);
  assert.ok(captionReadingMs('A short line.') >= 1400);
  assert.ok(captionReadingMs('word '.repeat(70)) > captionReadingMs('A short line.'));
});
