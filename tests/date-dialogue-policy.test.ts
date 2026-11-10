import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvening } from '../src/restaurant/evening';
import type { DateId, DinnerState, SceneUtterance } from '../src/restaurant/types';
import { clampMemory } from '../server/restaurant/memory';
import { alternatingMessages, deferrableCue, dialogueLoopContext, tableNow, tidyOpening } from '../server/restaurant/dialogue-policy';

function scene(dateId: DateId = 'mira'): DinnerState {
  return { id: 'dialogue-context', generation: 1, mode: 'ai-date', phase: 'playing', dateId, stage: 'arrival', elapsed: 0,
    participants: [], seated: false, order: null, glassRaised: false, emotion: 'neutral', events: [], memory: '', sessionLimit: 2,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null },
    evening: createEvening(dateId) };
}
test('tableNow anchors the reply to where the evening physically is', () => {
  const state = scene();
  assert.match(tableNow(state, 'Mira'), /just met at the entrance/);
  state.seated = true; state.stage = 'seated';
  assert.match(tableNow(state, 'Mira'), /at your table together/);
  state.order = 'Wild mushroom risotto'; state.evening.main.status = 'waiting'; state.evening.main.dateDish = 'Roasted tomato rigatoni';
  assert.match(tableNow(state, 'Mira'), /ordered the wild mushroom risotto, Mira ordered the roasted tomato rigatoni; you ordered and are waiting/);
  state.evening.main.status = 'served'; state.evening.main.servedDish = 'Lemon & herb chicken';
  assert.match(tableNow(state, 'Mira'), /lemon & herb chicken, not what they ordered/);
  state.evening.main.status = 'finished'; state.evening.dessert = { ...state.evening.dessert, choice: 'chocolate', status: 'served' };
  const later = tableNow(state, 'Mira');
  assert.match(later, /sharing the chocolate fondant/);
  assert.doesNotMatch(later, /nothing has been ordered/);
  state.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 };
  assert.match(tableNow(state, 'Mira'), /Happening right now/);
});

test('conversation history always starts with the human and alternates without losing a side', () => {
  const merged = alternatingMessages([
    { role: 'assistant', content: 'opening' },
    { role: 'user', content: 'hi' },
    { role: 'user', content: 'are you there?' },
    { role: 'assistant', content: 'yes' },
    { role: 'assistant', content: 'Eli: water' },
  ]);
  assert.deepEqual(merged.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(merged[0].content, /evening begins/);
  assert.equal(merged[2].content, 'hi\nare you there?');
  assert.equal(merged[3].content, 'yes\nEli: water');
});

test('routine pacing cues wait for an in-flight reply, while urgent table moments do not', () => {
  for (const key of ['main-served', 'main-finished', 'dessert-shared', 'beat-eating-1', 'bill-requested', 'care-water-served']) assert.equal(deferrableCue(key), true, key);
  for (const key of ['boundary-warning', 'date-leaving', 'ending-walked-away', 'wrong-order', 'spill', 'diner', 'care-medical', 'scenario-opening']) assert.equal(deferrableCue(key), false, key);
});

const dateLine = (text: string): SceneUtterance => ({ speaker: 'date', text, emotion: 'neutral' });

test('repeated plants or coat-rack synonyms produce a bounded local topic guard for unrelated human speech', () => {
  const recent = [dateLine('The fern near the window is doing well.'), dateLine('I was telling the coat rack about my day.'), dateLine('Those leaves have my attention.'), dateLine('At least the hanger appreciates a joke.')];
  const before = structuredClone(recent);
  assert.deepEqual(dialogueLoopContext(recent, 'I wanted to tell you something important about myself.'), { avoidUnpromptedTopics: ['coat racks and hangers', 'plants and foliage'] });
  assert.deepEqual(recent, before);
  assert.deepEqual(dialogueLoopContext([dateLine('A plant, fern and several leaves are in that planter.')], 'What do you want from tonight?'), { avoidUnpromptedTopics: [] }, 'one reply with several synonyms is not a repeated conversational loop');
});

test('explicit topic interest and legitimate botany work keep the relevant conversation available', () => {
  const recent = [dateLine('The plants by the window are lovely.'), dateLine('I keep noticing the fern and the rain.')];
  assert.deepEqual(dialogueLoopContext(recent, 'Are those ferns real?'), { avoidUnpromptedTopics: ['windows and weather'] });
  for (const human of ['I work as a botanist. Want to hear about my job?', 'Horticulture is what I studied.', 'I enjoy gardening.', 'Do not avoid plants; I work in a greenhouse.']) {
    assert.equal(dialogueLoopContext(recent, human).avoidUnpromptedTopics.includes('plants and foliage'), false, human);
  }
  assert.deepEqual(dialogueLoopContext(recent, 'What do you like about the rain?'), { avoidUnpromptedTopics: ['plants and foliage'] });
});

test('direct complaints about a recurring prop strengthen the guard instead of counting as interest', () => {
  const recent = [dateLine('The plants beside the coat rack are catching the rain.'), dateLine('The fern, hanger and rainy window are quite a scene.')];
  const cases = [
    ['Please stop talking about plants.', 'plants and foliage'],
    ['Do not keep bringing up the coat rack.', 'coat racks and hangers'],
    ['No more comments about the weather.', 'windows and weather'],
    ['Please do not repeat the plant joke.', 'plants and foliage'],
    ['Enough about the hanger, please.', 'coat racks and hangers'],
  ] as const;
  for (const [human, expected] of cases) assert.equal(dialogueLoopContext(recent, human).avoidUnpromptedTopics.includes(expected), true, human);
});

test('repeat requests permit replaying what was actually said without a blanket topic ban', () => {
  const recent = [dateLine('A plant near the window.'), dateLine('That fern catches the rain.')];
  for (const human of ['Can you repeat that?', 'What did you say?', 'Sorry, I didn’t catch that.', 'I could not hear you.', 'Say it again, please.']) {
    assert.deepEqual(dialogueLoopContext(recent, human), { avoidUnpromptedTopics: [] }, human);
  }
});

test('only the last four date utterances count, with staff and other actors unable to create a loop', () => {
  const ancient = [dateLine('The plants look good.'), dateLine('That fern looks good too.')];
  const current = [dateLine('How was your week?'), dateLine('That is an interesting story.'), dateLine('I have another question.'), dateLine('What do you think?')];
  assert.deepEqual(dialogueLoopContext([...ancient, ...current], 'Let us talk about us.'), { avoidUnpromptedTopics: [] });
  const cast: SceneUtterance[] = [{ speaker: 'waiter', text: 'The plants are here.', emotion: 'neutral' }, { speaker: 'other-date', text: 'The fern is here.', emotion: 'neutral' }];
  assert.deepEqual(dialogueLoopContext(cast, 'Tell me about your evening.'), { avoidUnpromptedTopics: [] });
  assert.deepEqual(dialogueLoopContext([ancient[0], cast[0], ancient[1], cast[1]], 'Tell me about your evening.'), { avoidUnpromptedTopics: ['plants and foliage'] });
});

test('word boundaries and ordinary food conversation do not trigger scenery bans', () => {
  const lines = [dateLine('I plan to discuss planets, training and the chairman.'), dateLine('The plantation story explains the seatbelt and brain teaser.')];
  assert.deepEqual(dialogueLoopContext(lines, 'I have a work story.'), { avoidUnpromptedTopics: [] });
  assert.deepEqual(dialogueLoopContext([dateLine('The risotto is delicious.'), dateLine('I like the chicken and dessert too.'), dateLine('We should talk about dinner.')], 'What do you like cooking?'), { avoidUnpromptedTopics: [] });
});

test('all supported prop families remain bounded and normalization catches formatting changes', () => {
  const all = 'The coat-rack, PLANTS, window, wall art, chair and candles.';
  const topics = dialogueLoopContext([dateLine(all), dateLine(all.toLowerCase())], 'I would like to talk about something personal.').avoidUnpromptedTopics;
  assert.equal(topics.length, 6);
  assert.equal(new Set(topics).size, topics.length);
  assert.deepEqual(dialogueLoopContext([dateLine('That ＦＥＲＮ looks good.'), dateLine('Those plants look good.')], 'I wanted to discuss my plans.'), { avoidUnpromptedTopics: ['plants and foliage'] });
});

test('a thing the date keeps returning to is stopped, even when the human asks what they are talking about', () => {
  const fern = [dateLine('That fern by the window is judging us.'), dateLine('The fern again. It has opinions about your order.'), dateLine('Oh, haha, the fern. It keeps catching my eye.')];
  const asked = dialogueLoopContext(fern, 'What are you talking about?').avoidUnpromptedTopics;
  assert.ok(asked.some(item => /^“fern” \(you have said it in nearly every reply: leave the word out of this one even if they mention it/.test(item)), JSON.stringify(asked));
  const pressed = dialogueLoopContext(fern, 'Why do you keep talking about the fern?').avoidUnpromptedTopics;
  assert.ok(pressed.some(item => item.startsWith('“fern” (you have said it in nearly every reply')), 'asking about it does not reopen it');

  // Any repeated image counts, not only listed props: twice in the last three replies is held back unless the human raises it.
  const signal = [dateLine('If I guess what the train needs, it derails. I check the signal.'), dateLine('So are you waving from the platform?'), dateLine('I verify the signal before I commit.')];
  assert.deepEqual(dialogueLoopContext(signal, 'I like a little uncertainty.').avoidUnpromptedTopics, ['“signal”']);
  assert.deepEqual(dialogueLoopContext(signal, 'Tell me more about the signal box.').avoidUnpromptedTopics, [], 'the human asked for it');
  // Ordinary words and a single mention never trigger it.
  const plain = [dateLine('I think you are right about that.'), dateLine('I really think that is something people say.'), dateLine('What do you think about tonight?')];
  assert.deepEqual(dialogueLoopContext(plain, 'Not much.').avoidUnpromptedTopics, []);
});

test('a question the date asked and did not get answered is not kept in the notebook to be asked again', () => {
  // From the Haiku sample on 10 Nov 2026: the same OPEN line survived eight turns and Jules asked about the shank four times.
  const kept = clampMemory('HUMAN: fixed a loose button\nTOLD THEM: restores old books\nOPEN: whether the button fix used a shank; promised to name a film');
  assert.equal(kept, 'HUMAN: fixed a loose button\nTOLD THEM: restores old books\nOPEN: promised to name a film');
  assert.equal(clampMemory('HUMAN: shares fries\nTOLD THEM: nothing yet\nOPEN: whether the human agrees the tiny crispy fries win.'), 'HUMAN: shares fries\nTOLD THEM: nothing yet\nOPEN: nothing pending');
  assert.equal(clampMemory('HUMAN: x\nTOLD THEM: y\nOPEN: What is the specific food scandal?; lend them the umbrella on Friday'), 'HUMAN: x\nTOLD THEM: y\nOPEN: lend them the umbrella on Friday');
  // Words spread over six replies still count, and a plural in -ies folds properly.
  const fries = [dateLine('You admit the crispy fries win.'), dateLine('That is honest.'), dateLine('You are not getting out of the fries question.'), dateLine('Bring no camera.'), dateLine('You still owe me an answer about the fries.')];
  assert.ok(dialogueLoopContext(fries, 'I would like another evening with you.').avoidUnpromptedTopics.some(item => item.startsWith('“fry” (you have said it in nearly every reply')));
});

test('filler and echo openers are dropped from the front of a date line, and nothing else is', () => {
  // Lines from the Haiku rerun on 10 Nov 2026.
  assert.equal(tidyOpening('Another evening, huh? Fine, I\'m listening. Just don\'t make it a photo shoot.'), 'Fine, I\'m listening. Just don\'t make it a photo shoot.');
  assert.equal(tidyOpening('Distracting, huh? Good. I\'ll take that over boring any day.'), 'Good. I\'ll take that over boring any day.');
  assert.equal(tidyOpening('Fair, I heard it as a dig. Nervous is better.'), 'I heard it as a dig. Nervous is better.');
  assert.equal(tidyOpening('Honestly? Someone who lets me be the fun one for once.'), 'Someone who lets me be the fun one for once.');
  assert.equal(tidyOpening('Oh, the fries have been promoted to flirting assistant.'), 'The fries have been promoted to flirting assistant.');
  assert.equal(tidyOpening('Fair enough. Consider it noted, not requested.'), 'Consider it noted, not requested.');
  // An answer, a reaction that is the whole reply, or an opener the sentence leans on stays.
  for (const kept of ['Good. Keep looking then.', 'Yes, a lot easier.', 'Fair.', 'Fair enough. Okay.', 'Noted, and I\'m glad you said it plainly.', 'Me too, honestly.', 'Wait, really? You did that?', 'Absolutely not. The big soft ones are the good ones.']) assert.equal(tidyOpening(kept), kept);
});
