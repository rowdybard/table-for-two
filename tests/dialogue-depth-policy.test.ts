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
  assert.match(SPOKEN_REGISTER, /You do not owe every turn a joke or a question/);
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
