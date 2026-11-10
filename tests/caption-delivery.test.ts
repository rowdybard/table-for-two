import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionReadingMs, waitForCaptionPaint, waitForCaptionReading, watchCaptionObstructions } from '../src/restaurant/caption-delivery';

function frameQueue() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return { request(callback: FrameRequestCallback) { callbacks.set(++id, callback); return id; }, cancel(key: number) { callbacks.delete(key); },
    paint() { const entry = callbacks.entries().next().value; if (entry) { callbacks.delete(entry[0]); entry[1](performance.now()); } }, get pending() { return callbacks.size; } };
}

test('caption reading cannot start while newly inserted text is waiting to paint', async () => {
  const frames = frameQueue(); let ready = false;
  const paint = waitForCaptionPaint(new AbortController().signal, new EventTarget(), () => true, frames).then(value => { ready = value; return value; });
  await Promise.resolve(); assert.equal(ready, false);
  frames.paint(); await Promise.resolve(); assert.equal(ready, false);
  frames.paint(); assert.equal(await paint, true); assert.equal(frames.pending, 0);
});

test('a renderer with no frames cannot manufacture visible delivery or hold the queue forever', async () => {
  const frames = frameQueue();
  assert.equal(await waitForCaptionPaint(new AbortController().signal, new EventTarget(), () => true, frames, 5), false);
  assert.equal(frames.pending, 0);
});

test('hiding or cancelling before paint removes scheduled work and never earns a delivery', async () => {
  for (const action of ['hide', 'abort'] as const) {
    const frames = frameQueue(), visibility = new EventTarget(), controller = new AbortController(); let visible = true;
    const paint = waitForCaptionPaint(controller.signal, visibility, () => visible, frames);
    if (action === 'hide') { visible = false; visibility.dispatchEvent(new Event('visibilitychange')); visible = true; }
    else controller.abort();
    assert.equal(await paint, false); assert.equal(frames.pending, 0);
  }
});

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

test('only a real overlay opening cancels a caption reading interval, even in a mixed batch', async t => {
  let notify!: MutationCallback, disconnected = false;
  const watched: Element[] = [];
  class Observer {
    constructor(callback: MutationCallback) { notify = callback; }
    observe(target: Element, options: MutationObserverInit) { watched.push(target); assert.deepEqual(options.attributeFilter, ['hidden']); assert.equal(options.attributeOldValue, true); }
    disconnect() { disconnected = true; }
  }
  const old = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: Observer });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'MutationObserver', old); else Reflect.deleteProperty(globalThis, 'MutationObserver'); });
  const element = (hidden: string | null) => ({ hidden, getAttribute() { return this.hidden; } });
  const first = element(''), second = element('');
  const record = (target: typeof first, oldValue: string | null) => ({ target, attributeName: 'hidden', oldValue } as unknown as MutationRecord);
  const emit = (records: MutationRecord[]) => notify(records, {} as MutationObserver);
  let interruptions = 0;
  const stop = watchCaptionObstructions([first as unknown as Element, second as unknown as Element], () => { interruptions++; });
  emit([record(first, '')]); // hidden = true when already hidden
  assert.equal(interruptions, 0);
  first.hidden = null;
  emit([record(first, null)]); // removing an already absent attribute
  assert.equal(interruptions, 0);
  emit([record(first, '')]); // a single hidden -> visible transition
  assert.equal(interruptions, 1);
  first.hidden = '';
  emit([record(first, ''), record(second, ''), record(second, ''), record(first, null)]);
  assert.equal(interruptions, 2, 'interleaved same-node records still reveal a brief opening');
  stop(); assert.equal(disconnected, true);
  assert.deepEqual(watched, [first, second]);

  const controller = new AbortController();
  const stopReading = watchCaptionObstructions([first as unknown as Element], () => controller.abort());
  const reading = waitForCaptionReading(30, controller.signal, new EventTarget(), () => true);
  // Both mutations arrive together: it opened and then closed before the observer ran.
  emit([record(first, ''), record(first, null)]);
  assert.equal(await reading, false);
  stopReading();
});
