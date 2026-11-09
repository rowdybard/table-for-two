import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvening } from '../src/restaurant/evening';
import type { DateId, DinnerState, SceneUtterance } from '../src/restaurant/types';
import { alternatingMessages, deferrableCue, dialogueLoopContext, tableNow } from '../server/restaurant/dialogue-policy';

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
  assert.match(tableNow(state, 'Mira'), /menus; nothing has been ordered/);
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
