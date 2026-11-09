import assert from 'node:assert/strict';
import test from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DinnerScene } from '../server/restaurant/scene';
import { FREQUENT_CUE_KEYS, STORY_CUE_ALTERNATIVES, STORY_CUE_VARIANTS, getStoryCue } from '../src/restaurant/story';

test('twelve frequent cue slots have three distinct authored versions per character', () => {
  assert.equal(FREQUENT_CUE_KEYS.length, 12);
  assert.deepEqual([...FREQUENT_CUE_KEYS], ['welcome', 'seated', 'ordered', 'main-served', 'beat-cold', 'beat-waiting-1', 'beat-eating-1', 'beat-after-1', 'dessert-served', 'boundary-warning', 'repair', 'farewell-invite'], 'coverage includes opening, ordering, service, silence, pushback, repair and farewell');
  let count = 0;
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    for (const key of FREQUENT_CUE_KEYS) {
      const lines = STORY_CUE_ALTERNATIVES[dateId][key];
      assert.equal(lines.length, 3);
      assert.equal(new Set(lines.map(line => line.text)).size, 3, `${dateId}:${key}`);
      for (let variation = 0; variation < 3; variation++) {
        assert.equal(getStoryCue(key, dateId, { variation }).find(line => line.speaker === 'date')?.text, lines[variation].text);
        assert.ok(lines[variation].text.length <= 260, `${dateId}:${key}:${variation} is a short spoken aside`);
        count++;
      }
    }
  }
  assert.equal(count, 108);
  assert.ok(STORY_CUE_VARIANTS.some(variant => variant.context.variation === 1));
  assert.ok(STORY_CUE_VARIANTS.some(variant => variant.context.variation === 2));
});

test('variation preserves factual service, guarded wording, reserved suppression and named dessert', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    for (const variation of [0, 1, 2]) {
      assert.equal(getStoryCue('main-served', dateId, { variation, resolution: 'hurt' }).find(line => line.speaker === 'date')?.text, 'Thank you.');
      assert.equal(getStoryCue('bill-requested', dateId, { variation, reserved: true }).filter(line => line.speaker === 'date').length, 0);
      assert.deepEqual(getStoryCue('farewell-invite', dateId, { variation, reserved: true }), getStoryCue('farewell-invite', dateId, { reserved: true }), 'reserved goodbyes do not gain warmth from variation');
      assert.deepEqual(getStoryCue('farewell-invite', dateId, { variation, resolution: 'hurt' }), getStoryCue('farewell-invite', dateId, { resolution: 'hurt' }), 'hurt goodbyes retain the guarded override');
      assert.deepEqual(getStoryCue('ordered', dateId, { variation, humanDish: { mira: 'Roasted tomato rigatoni', jules: 'Wild mushroom risotto', dev: 'Lemon & herb chicken' }[dateId] }), getStoryCue('ordered', dateId, { humanDish: { mira: 'Roasted tomato rigatoni', jules: 'Wild mushroom risotto', dev: 'Lemon & herb chicken' }[dateId] }), 'matching orders retain the factual shared-dish reaction');
      const named = getStoryCue('dessert-date-choice', dateId, { variation, choice: 'lemon', named: true });
      assert.match(named[0].text, /Lemon posset/i);
      assert.doesNotMatch(named[0].text, /chocolate|berries/i);
      assert.deepEqual(getStoryCue('main-served', dateId, { variation, dish: 'Wild mushroom risotto' }).filter(line => line.speaker === 'waiter'), getStoryCue('main-served', dateId, { dish: 'Wild mushroom risotto' }).filter(line => line.speaker === 'waiter'));
    }
  }
});

test('unvaried slots retain their original authored lines and boundary variants remain explicit stops', () => {
  for (const dateId of ['mira', 'jules', 'dev'] as const) {
    for (const key of ['taste', 'beat-waiting-2', 'beat-eating-2', 'beat-after-2']) {
      assert.deepEqual(getStoryCue(key, dateId, { variation: 2 }), getStoryCue(key, dateId, { variation: 0 }));
    }
    for (const line of STORY_CUE_ALTERNATIVES[dateId]['boundary-warning']) {
      assert.match(line.text, /not comfortable|don’t want|not okay|need you to drop/);
      assert.doesNotMatch(line.text, /kiss|cute|flirt|maybe|probably|kidding|joking/i);
      assert.equal(line.emotion, 'annoyed');
    }
  }
});

test('the evening controller uses its existing stable variation for the actual opening', async () => {
  await RAPIER.init();
  const scenes = [0, 1, 2].map(variation => new DinnerScene('mira', 1, { variation }));
  try {
    const openings = scenes.map(scene => scene.state.evening.cues.find(cue => cue.key === 'welcome')?.utterances.find(line => line.speaker === 'date')?.text);
    assert.deepEqual(openings, STORY_CUE_ALTERNATIVES.mira.welcome.map(line => line.text));
    assert.equal(new Set(openings).size, 3);
  } finally { scenes.forEach(scene => scene.free()); }
});
