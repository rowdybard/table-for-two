import assert from 'node:assert/strict';
import test from 'node:test';
import { DATE_DIALOGUE_INSTRUCTIONS, MEMORY_PARTS, SPOKEN_REGISTER, VOICE_REMINDER } from '../server/restaurant/dialogue-policy';
import { MEMORY_HARD, MEMORY_TARGET, clampMemory, retireSharedPremise } from '../server/restaurant/memory';
import { isTopicStopRequest } from '../src/restaurant/conversation-content';

test('policy permits grounded humor and character-specific interest while preserving factual and boundary priorities', () => {
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /both of you actually said or heard/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /this couple’s earned progress still apply/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /Retire a stopped topic immediately/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /never invent a shared nickname, past event/);
  assert.match(SPOKEN_REGISTER, /flirt back or turn it down in so many words/); assert.match(SPOKEN_REGISTER, /Never repeat yourself/); assert.match(SPOKEN_REGISTER, /Never comment on the conversation itself/);
  assert.doesNotMatch(VOICE_REMINDER, /no closing quip/);
  assert.match(MEMORY_PARTS, /Corrections, disclosures and promises take priority/);
  assert.equal(MEMORY_TARGET, 700);
});

test('a stopped premise is retired without erasing disclosures, corrections or genuine obligations', () => {
  const memory = 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints, no exhibition date\nOPEN: promised to name a film; shared premise: both overplan a free afternoon';
  const retired = retireSharedPremise(memory, 'Please stop bringing up our overplanning joke.');
  assert.equal(retired, 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints, no exhibition date\nOPEN: promised to name a film');
  assert.doesNotMatch(clampMemory('', memory, 'Enough about that joke.'), /shared premise/);
  assert.match(clampMemory(memory, '', 'No more of that joke.'), /promised to name a film/);
  assert.equal(retireSharedPremise(memory, 'Don’t you like a plan?'), memory);
  assert.equal(isTopicStopRequest('I stop for coffee on the way to work.'), false);
});

test('drop requests retire a shared bit while ordinary physical drops do not', () => {
  const memory = 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints\nOPEN: promised a film title; shared premise: the wedding joke';
  const expected = 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints\nOPEN: promised a film title';
  for (const text of ['Please drop the joke.', 'Drop it.', 'Drop that, please.', 'Please drop this and move on.', 'Drop the bit.', 'Drop this topic.', 'Drop that subject.', "Please stop talking about it; don't drop that glass."]) {
    assert.equal(retireSharedPremise(memory, text), expected, text);
    assert.equal(clampMemory('', memory, text), expected, text);
  }
  for (const text of ['I will drop a friend off after dinner.', 'Please drop it off at the shop.', 'I dropped salt on the table.', 'Drop that photo in the album.', 'Drop it and pick it up.', "Please don't drop the joke; I like it.", "Don't drop the subject; I'm interested.", "Don't stop joking."]) {
    assert.equal(retireSharedPremise(memory, text), memory, text);
  }
});

test('standalone stop and enough boundaries retire only the optional premise', () => {
  const memory = 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints\nOPEN: promised a film title; shared premise: the wedding joke';
  const expected = 'HUMAN: sister is Nia, not Mia; works nights\nTOLD THEM: six prints\nOPEN: promised a film title';
  for (const text of ['Stop it.', 'Please stop it.', 'Stop it, please!', 'Quit it.', 'Please quit it.', 'Enough.', 'Enough, please.', 'That is enough.', 'That’s enough.', 'I cannot get enough of your stories, but please stop joking about that.']) {
    assert.equal(isTopicStopRequest(text), true, text);
    assert.equal(retireSharedPremise(memory, text), expected, text);
    assert.equal(clampMemory('', memory, text), expected, text);
  }
  for (const text of ["Don't stop it.", 'Please do not quit it.', "That isn't enough.", 'Not enough.', 'Enough food for two.', 'That is enough food.', 'Please stop it from spilling.', 'I cannot get enough of your stories.', 'I quit it last year.']) {
    assert.equal(isTopicStopRequest(text), false, text);
    assert.equal(retireSharedPremise(memory, text), memory, text);
  }
});

test('OPEN retains one premise after real obligations and sacrifices it first under notebook pressure', () => {
  const compact = clampMemory('HUMAN: likes trains\nTOLD THEM: nothing\nOPEN: shared premise: both miss trains; promised a film title; shared premise: secret agents');
  assert.equal(compact, 'HUMAN: likes trains\nTOLD THEM: nothing\nOPEN: promised a film title; shared premise: both miss trains');
  const long = clampMemory(`HUMAN: ${'likes quiet; '.repeat(70)}\nTOLD THEM: ${'chair photo; '.repeat(40)}\nOPEN: shared premise: both miss trains; promised to send the title; ${'asked which version; '.repeat(12)}`);
  assert.ok(long.length <= MEMORY_HARD);
  assert.match(long, /promised to send the title/);
  assert.doesNotMatch(long, /shared premise/);
});

test('a corrected next notebook replaces old facts and a stale premise without resurrecting either', () => {
  const previous = 'HUMAN: sister Mia; works days\nTOLD THEM: chose six prints\nOPEN: promised a film title; shared premise: both overplan afternoons';
  const corrected = 'HUMAN: sister Nia, not Mia; works nights\nTOLD THEM: chose six prints\nOPEN: promised a film title';
  assert.equal(clampMemory(corrected, previous), corrected, 'bookkeeping must not merge the superseded name or schedule back into the new facts');
  const settled = 'HUMAN: sister Nia; works nights\nTOLD THEM: chose six prints; named the film\nOPEN: nothing pending';
  assert.equal(clampMemory(settled, corrected), settled, 'a settled promise and retired premise stay out of OPEN on later turns');
  assert.match(clampMemory('', settled), /sister Nia; works nights/, 'a blank provider notebook still preserves the latest corrected facts');
});

test('the retained notebook never exceeds 700 and preserves labeled corrections and promises ahead of an optional premise', () => {
  for (const length of [701, 800, 900]) {
    assert.ok(clampMemory('x'.repeat(length)).length <= 700, `valid ${length}-character unlabelled reply`);
    assert.ok(clampMemory('', 'x'.repeat(length)).length <= 700, `blank reply with ${length}-character previous notebook`);
  }
  const long = `HUMAN: sister is Nia, not Mia; works nights; ${'likes pasta; '.repeat(65)}\nTOLD THEM: ${'grew up in Leeds; '.repeat(30)}\nOPEN: ${'asked about work; '.repeat(15)}promised a film title; shared premise: the wedding joke`;
  for (const kept of [clampMemory(long), clampMemory('', long)]) {
    assert.ok(kept.length <= 700);
    const [human, told, open] = kept.split('\n');
    assert.match(human, /^HUMAN: sister is Nia, not Mia; works nights/);
    assert.match(told, /^TOLD THEM:/);
    assert.match(open, /^OPEN: promised a film title/);
    assert.doesNotMatch(open, /shared premise/);
  }
  const duplicated = `HUMAN: old detail; ${'old; '.repeat(150)}\nHUMAN: corrected name is Nia\nTOLD THEM: ${'Leeds; '.repeat(100)}\nOPEN: promised a film title`;
  const kept = clampMemory(duplicated);
  assert.ok(kept.length <= 700); assert.match(kept, /^HUMAN: corrected name is Nia/);
  assert.match(kept, /\nOPEN: promised a film title/); assert.doesNotMatch(kept, /old detail/);
  const repeatedOpen = `HUMAN: ${'important; '.repeat(65)}\nOPEN: shared premise: old joke\nOPEN: shared premise: another joke; promised a film title; shared premise: yet another joke`;
  const afterStop = clampMemory(repeatedOpen, '', 'Please drop the joke.');
  assert.ok(afterStop.length <= 700); assert.match(afterStop, /\nOPEN: promised a film title/);
  assert.doesNotMatch(afterStop, /shared premise/);
  const shortRepeated = 'HUMAN: old name Mia\nHUMAN: corrected name is Nia\nOPEN: shared premise: old joke\nOPEN: shared premise: another joke; promised a film';
  const newest = clampMemory(shortRepeated);
  assert.equal(newest, 'HUMAN: corrected name is Nia\nOPEN: promised a film; shared premise: another joke');
  assert.equal(clampMemory(shortRepeated, '', 'Please drop the joke.'), 'HUMAN: corrected name is Nia\nOPEN: promised a film');
});
