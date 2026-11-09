import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningPreviewController, calmEnoughForListening } from '../src/restaurant/ListeningPreview';

test('speech starts with attention and a cautious cue settles from the first few words', () => {
  const preview = new ListeningPreviewController();
  preview.start(0, 'date');
  assert.equal(preview.sample(0)?.cue, 'attentive');
  preview.partial("I'm nervous", 20);
  assert.equal(preview.sample(199)?.cue, 'attentive');
  assert.equal(preview.sample(200)?.cue, 'reassuring');
  assert.equal(preview.sample(200)?.emotion, 'warm');
  preview.partial("I'm really nervous about this", 220);
  assert.equal(preview.sample(220)?.cue, 'reassuring', 'extending the same thought does not restart or flap the cue');
});

test('a corrected partial retracts an abandoned first impression without keeping its text', () => {
  const preview = new ListeningPreviewController();
  preview.start(0, 'd2');
  preview.partial('You are stupid', 10);
  assert.equal(preview.sample(369)?.cue, 'attentive');
  assert.equal(preview.sample(370)?.cue, 'guarded');
  preview.partial('You are not stupid, I meant the weather', 400);
  assert.deepEqual(preview.sample(400), { target: 'd2', cue: 'attentive', emotion: 'neutral', expiresAt: 3000 });
  assert.deepEqual(Object.keys(preview.sample(400)!).sort(), ['cue', 'emotion', 'expiresAt', 'target']);
});

test('quotations, conditional speech, negation and joking repairs do not become accusations', () => {
  for (const text of [
    'You are not stupid', 'You are stupidly good at this', 'If you are stupid you would do that',
    'He said you are stupid', '"You are stupid" was what they said', "'You are stupid' is a rude thing to say",
    "You're stupid, I'm kidding", "You're stupid—no, sorry, that came out wrong", 'Shut up that was amazing', "I'm not nervous", "I'm nervous, no I'm not",
  ]) {
    const preview = new ListeningPreviewController();
    preview.start(0, 'date'); preview.partial(text, 1);
    assert.equal(preview.sample(1000)?.cue, 'attentive', text);
  }
});

test('rapidly revised fragments must settle afresh instead of flashing emotional responses', () => {
  const preview = new ListeningPreviewController();
  preview.start(0, 'd1');
  preview.partial("I'm nervous", 10);
  preview.partial('You are stupid', 100);
  assert.equal(preview.sample(280)?.cue, 'attentive');
  preview.partial("I'm sorry", 300);
  assert.equal(preview.sample(479)?.cue, 'attentive');
  assert.equal(preview.sample(480)?.cue, 'reassuring');
  preview.partial('I am enjoying the evening', 500);
  assert.equal(preview.sample(500)?.cue, 'attentive');
});

test('final/reset, missing targets and expiry cannot leak a cue into the next utterance', () => {
  const preview = new ListeningPreviewController();
  preview.start(0, null); preview.partial("I'm nervous", 20);
  assert.equal(preview.sample(500), null);
  preview.start(600, 'date'); preview.partial("I'm nervous", 610);
  assert.equal(preview.sample(800)?.cue, 'reassuring');
  assert.equal(preview.sample(3209)?.cue, 'reassuring');
  assert.equal(preview.sample(3210), null);
  preview.partial('You are stupid', 3300);
  assert.equal(preview.sample(4000), null, 'late partial cannot reactivate an expired turn');
  preview.start(4500, 'd1'); preview.partial("I'm nervous", 4510); preview.clear();
  assert.equal(preview.sample(4700), null);
  preview.start(4800, 'd2');
  assert.equal(preview.sample(4800)?.cue, 'attentive');
  assert.equal(preview.sample(4800)?.target, 'd2');
});

test('invalid and old timestamps cannot revive or replace a newer partial', () => {
  const preview = new ListeningPreviewController();
  preview.start(NaN, 'date'); assert.equal(preview.sample(10), null);
  preview.start(100, 'date'); preview.partial('I enjoy this food', 150);
  preview.partial('You are stupid', 120);
  preview.partial('You are stupid', NaN);
  assert.equal(preview.sample(900)?.cue, 'attentive');
  assert.equal(preview.sample(NaN), null);
});

test('listening previews do not replace authored humor, flirtation or consequential emotion', () => {
  assert.equal(calmEnoughForListening('neutral'), true);
  assert.equal(calmEnoughForListening('warm'), true);
  for (const emotion of ['amused', 'flirtatious', 'embarrassed', 'annoyed', 'angry', 'defensive', 'surprised'] as const) {
    assert.equal(calmEnoughForListening(emotion), false);
  }
});

test('laughing along and a plain compliment show on the listener before the line ends; a negated one does not', () => {
  const cue = (text: string) => { const preview = new ListeningPreviewController(); preview.start(0, 'date'); preview.partial(text, 1); return preview.sample(1000); };
  assert.equal(cue('haha okay that is fair')?.emotion, 'amused');
  assert.equal(cue('you look really lovely tonight')?.cue, 'flattered');
  assert.equal(cue('I like your laugh')?.emotion, 'embarrassed');
  for (const text of ["you're not cute", 'he said you are pretty', '"you are gorgeous" is a line from a film', 'what is so funny']) assert.equal(cue(text)?.cue, 'attentive', text);
});
