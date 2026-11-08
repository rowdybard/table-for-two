import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTHORED_UTTERANCES } from '../src/restaurant/authored';
import { DATES } from '../src/restaurant/content';
import { createEvening } from '../src/restaurant/evening';
import type { DateId, DinnerEvent, DinnerState, SceneUtterance } from '../src/restaurant/types';
import { dialogueLoopContext, reusableDialogueLines } from '../server/restaurant/dialogue-policy';

function scene(dateId: DateId = 'mira'): DinnerState {
  return { id: 'dialogue-context', generation: 1, mode: 'ai-date', phase: 'playing', dateId, stage: 'arrival', elapsed: 0,
    participants: [], seated: false, order: null, glassRaised: false, emotion: 'neutral', events: [], memory: '', sessionLimit: 2,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null },
    evening: createEvening(dateId) };
}
const authored = (id: string) => {
  const line = AUTHORED_UTTERANCES.find(item => item.clipId === id);
  assert.ok(line, `Missing authored fixture ${id}`);
  return line;
};
const has = (lines: SceneUtterance[], id: string) => lines.some(line => line.speaker === authored(id).speaker && line.text === authored(id).text);

test('greetings fit arrival and pre-order seating, but not ordered or late dinner stages', () => {
  const state = scene();
  for (const stage of ['arrival', 'seated'] as const) {
    state.stage = stage;
    assert.equal(has(reusableDialogueLines(state, []), 'greeting-waiter'), true);
    assert.equal(has(reusableDialogueLines(state, []), 'greeting-date'), true);
  }
  for (const stage of ['ordered', 'dining', 'dessert', 'farewell', 'finished'] as const) {
    state.stage = stage;
    assert.equal(has(reusableDialogueLines(state, []), 'greeting-waiter'), false, stage);
    assert.equal(has(reusableDialogueLines(state, []), 'greeting-date'), false, stage);
  }
  state.stage = 'arrival'; state.order = 'Roasted tomato rigatoni';
  assert.equal(has(reusableDialogueLines(state, []), 'greeting-waiter'), false, 'an existing order outranks a stale arrival stage');
});

test('only the active incident can offer recovery dialogue; historical incidents cannot recur as clip suggestions', () => {
  const state = scene(); state.stage = 'dining'; state.order = 'Wild mushroom risotto';
  const fixtures = { 'wrong-order': ['wrong-order-date', 'wrong-order-waiter'], 'spilled-drink': ['spill-date', 'spill-waiter'], 'disruptive-diner': ['diner-date', 'diner-defensive'] } as const;
  state.events = Object.keys(fixtures) as DinnerEvent[];
  for (const event of state.events) {
    state.evening.incident = { event, progress: 0, startedAt: 0 };
    const lines = reusableDialogueLines(state, []);
    for (const [candidate, ids] of Object.entries(fixtures)) for (const id of ids) assert.equal(has(lines, id), candidate === event);
  }
  state.evening.incident = null;
  state.evening.resolutions = { 'wrong-order': 'The right plate arrived.', 'spilled-drink': 'The table is dry.', 'disruptive-diner': 'The phone call ended.' };
  for (const ids of Object.values(fixtures)) for (const id of ids) assert.equal(has(reusableDialogueLines(state, []), id), false);
  assert.equal(has(reusableDialogueLines(state, []), 'laugh-small'), true, 'calm conversation still has a suitable reusable reaction');
});

test('a real active incident does not need a historical event entry and suppresses an out-of-place welcome', () => {
  const state = scene();
  state.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 };
  const lines = reusableDialogueLines(state, []);
  assert.equal(has(lines, 'spill-waiter'), true);
  assert.equal(has(lines, 'greeting-waiter'), false);
});

test('recent delivered words cannot be suggested again through a different emotion tag', () => {
  const state = scene();
  const delivered: SceneUtterance[] = [{ ...authored('laugh-small'), emotion: 'warm' }, authored('greeting-waiter')];
  const before = structuredClone(delivered);
  const lines = reusableDialogueLines(state, delivered);
  assert.equal(has(lines, 'laugh-small'), false);
  assert.equal(has(lines, 'greeting-waiter'), false);
  assert.equal(has(lines, 'laugh-big'), true);
  assert.deepEqual(delivered, before, 'filtering does not mutate playback receipts');
  const keys = lines.map(line => JSON.stringify([line.speaker, line.text]));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(lines.length <= 8);
});

test('preset and Blind candidates preserve identity without injecting greetings or biography from another date', () => {
  for (const preset of DATES) {
    const state = scene(preset.id);
    const lines = reusableDialogueLines(state, []);
    for (const date of DATES) assert.equal(lines.some(line => line.text === date.opening), false);
    assert.equal(lines.some(line => /coat rack|grandmother|food truck|photo show/i.test(line.text)), false);
    state.mode = 'blind-date'; state.blindDate = { seed: 'seeded-personality' };
    const blind = reusableDialogueLines(state, []);
    assert.ok(blind.length > 0, 'staff can still greet a Blind date');
    assert.equal(blind.some(line => line.speaker === 'date'), false);
    assert.equal(has(blind, 'greeting-waiter'), true);
    state.stage = 'dining'; state.order = 'Lemon chicken'; state.evening.incident = { event: 'wrong-order', progress: 0, startedAt: 0 };
    assert.equal(has(reusableDialogueLines(state, []), 'wrong-order-waiter'), true);
    assert.equal(reusableDialogueLines(state, []).some(line => line.speaker === 'date'), false);
  }
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
