import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TouchButtonGesture } from '../src/restaurant/TouchButtonGesture';

test('touch pointerup activates once when the browser omits click, and deduplicates native click', () => {
  const gesture = new TouchButtonGesture();
  gesture.begin(7, 330, 30);
  assert.equal(gesture.end(7, 333, 31, true, 100), true);
  assert.equal(gesture.ignoreClick(1, 'touch', 7, 110), true);
  assert.equal(gesture.ignoreClick(1, undefined, undefined, 400), true, 'legacy Safari MouseEvent compatibility click');
  assert.equal(gesture.ignoreClick(0, undefined, undefined, 110), false, 'keyboard and assistive activation');
  assert.equal(gesture.ignoreClick(1, 'mouse', 1, 110), false, 'real mouse input');
  assert.equal(gesture.ignoreClick(1, undefined, undefined, 110, false), false, 'legacy real mouse input');
});

test('cancellation, resize, lost capture, leaving the button and dragging cannot activate', () => {
  const gesture = new TouchButtonGesture();
  for (const pointer of [1, 2, 3]) {
    gesture.begin(pointer, 330, 30); gesture.cancel(pointer, pointer * 100);
    assert.equal(gesture.ignoreClick(1, 'touch', pointer, pointer * 100 + 1), true, 'cancel alone cannot become a compatibility click');
    assert.equal(gesture.end(pointer, 330, 30, true, pointer * 100), false);
    assert.equal(gesture.ignoreClick(1, 'touch', pointer, pointer * 100 + 5), true);
  }
  gesture.begin(4, 330, 30); gesture.move(4, 350, 30); gesture.move(4, 330, 30);
  assert.equal(gesture.end(4, 330, 30, true, 400), false, 'returning after a drag is still canceled');
  assert.equal(gesture.ignoreClick(1, 'touch', 4, 405), true);
  gesture.begin(5, 330, 30);
  assert.equal(gesture.end(5, 330, 30, false, 500), false, 'covered or outside button');
  gesture.begin(6, 330, 30); gesture.cancel();
  assert.equal(gesture.end(6, 330, 30, true, 600), false, 'global input clear');
});

test('a second finger cannot steal or finish another finger’s button tap', () => {
  const gesture = new TouchButtonGesture();
  assert.equal(gesture.begin(1, 330, 30), true);
  assert.equal(gesture.begin(2, 330, 30), false);
  gesture.move(2, 440, 100); gesture.cancel(2);
  assert.equal(gesture.end(2, 330, 30, true, 100), false);
  assert.equal(gesture.end(1, 332, 30, true, 110), true);
  assert.equal(gesture.ignoreClick(1, 'touch', 1, 115), true);
  assert.equal(gesture.end(2, 330, 30, true, 120), false);
  assert.equal(gesture.ignoreClick(1, 'touch', 1, 125), true, 'an unowned end cannot expose a delayed owner compatibility click');
  assert.equal(gesture.ignoreClick(1, 'touch', 2, 125), true);
  gesture.begin(3, 330, 30);
  assert.equal(gesture.end(3, 330, 30, true, 140), true, 'a new deliberate tap still activates');
});
