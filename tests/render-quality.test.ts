import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RENDER_TIERS, detectRenderQuality, parseQualityOverride, readRenderQualityEnvironment } from '../src/restaurant/render/RenderQuality';

const desktop = { search: '', coarsePointer: false, maxTouchPoints: 0, innerWidth: 1280, deviceMemory: 8, webdriver: false };

test('a fine-pointer desktop gets the high tier with adaptive pixel ratio', () => {
  const quality = detectRenderQuality(desktop);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.pixelRatioCap, 1.5);
  assert.equal(quality.pixelRatioFloor, 1);
  assert.equal(quality.adaptive, true);
  assert.equal(quality.forced, false);
});

test('coarse pointers, small touch screens and small memory pick the low tier', () => {
  assert.equal(detectRenderQuality({ ...desktop, coarsePointer: true }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 5, innerWidth: 1100 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 5, innerWidth: 1366 }).tier, 'high', 'a wide touch laptop with a fine pointer stays high');
  assert.equal(detectRenderQuality({ ...desktop, maxTouchPoints: 0, innerWidth: 800 }).tier, 'high', 'a narrow desktop window without touch stays high');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: 4 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: 2 }).tier, 'low');
  assert.equal(detectRenderQuality({ ...desktop, deviceMemory: undefined }).tier, 'high', 'browsers without deviceMemory are judged by input only');
  const phone = detectRenderQuality({ search: '', coarsePointer: true, maxTouchPoints: 5, innerWidth: 844 });
  assert.equal(phone.tier, 'low');
  assert.equal(phone.pixelRatioCap, 1.25);
  assert.equal(phone.pixelRatioFloor, .75);
  assert.equal(phone.adaptive, true);
});

test('?quality=high|low overrides detection and disables adaptation', () => {
  const forcedHigh = detectRenderQuality({ ...desktop, coarsePointer: true, search: '?quality=high' });
  assert.equal(forcedHigh.tier, 'high');
  assert.equal(forcedHigh.adaptive, false);
  assert.equal(forcedHigh.forced, true);
  const forcedLow = detectRenderQuality({ ...desktop, search: '?mode=solo&quality=LOW' });
  assert.equal(forcedLow.tier, 'low');
  assert.equal(forcedLow.pixelRatioCap, RENDER_TIERS.low.pixelRatioCap);
  assert.equal(forcedLow.adaptive, false);
  assert.equal(detectRenderQuality({ ...desktop, search: '?quality=ultra' }).tier, 'high', 'unknown values fall back to detection');
  assert.equal(detectRenderQuality({ ...desktop, search: '?quality=ultra' }).forced, false);
  assert.equal(parseQualityOverride(undefined), null);
  assert.equal(parseQualityOverride('?venue=bowling'), null);
  assert.equal(parseQualityOverride('quality=low'), 'low');
});

test('automated browsers keep a stable pixel ratio', () => {
  assert.equal(detectRenderQuality({ ...desktop, webdriver: true }).adaptive, false);
  assert.equal(detectRenderQuality({ ...desktop, webdriver: true }).tier, 'high');
});

test('detection is safe without a browser', () => {
  assert.doesNotThrow(() => readRenderQualityEnvironment());
  const quality = detectRenderQuality();
  assert.ok(quality.tier === 'high' || quality.tier === 'low');
  assert.ok(quality.pixelRatioFloor < quality.pixelRatioCap);
});
