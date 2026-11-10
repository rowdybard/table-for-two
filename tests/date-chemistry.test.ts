import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateChemistryDirector } from '../server/restaurant/chemistry';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState, SceneTurn, SceneUtterance } from '../src/restaurant/types';

const firstHuman = 'Your terrible joke has somehow made dinner much better.';
const secondHuman = 'I would enjoy finding another excuse to spend time with you.';
const thirdHuman = 'That grin is making it harder to pretend I am composed.';
const firstLine: SceneUtterance = { speaker: 'date', text: 'You are making it difficult to keep my very skeptical expression.', emotion: 'flirtatious', lineId: 'first' };
const secondLine: SceneUtterance = { speaker: 'date', text: 'I might be looking for an excuse to linger with you too.', emotion: 'flirtatious', lineId: 'second' };
const thirdLine: SceneUtterance = { speaker: 'date', text: 'That was unexpectedly charming. Keep talking.', emotion: 'flirtatious', lineId: 'third' };
const turn = (...utterances: SceneUtterance[]): SceneTurn => ({ utterances, emotion: 'flirtatious', action: 'none', memory: '' });

function setup(mode: DinnerState['mode'] = 'ai-date') {
  const state = { id: 'chemistry-test', generation: 0, dateId: 'mira', mode, phase: 'playing', evening: createEvening('mira') } as DinnerState;
  state.evening.agenda = { clues: ['I want to choose how the evening goes.', 'Care matters more when it leaves room for independence.'],
    milestones: [{ kind: 'noticed', evidence: 'You would like your own say.' }, { kind: 'understood', evidence: 'Being cared for should leave room for independence.' }, { kind: 'respected', evidence: 'Choose what you like; I will choose my own meal.' }],
    score: 100, possible: 100, goal: null, reflection: null };
  const director = new DateChemistryDirector(state);
  const publicState = () => (state.evening as typeof state.evening & { chemistry: { unlocked: boolean } }).chemistry;
  const begin = () => { director.clearPending(); state.generation++; };
  const deliver = (line: SceneUtterance, human: string, early = false) => {
    begin();
    if (early) { director.acknowledge(line); director.observe(turn(line), human); }
    else { director.observe(turn(line), human); director.acknowledge(line); }
  };
  return { state, director, publicState, begin, deliver };
}

test('Solo, Blind and Double each need two separate delivered reciprocal moments', () => {
  for (const mode of ['ai-date', 'blind-date', 'double-date'] as const) {
    const f = setup(mode);
    assert.equal(f.director.unlocked, false);
    f.deliver(firstLine, firstHuman);
    assert.equal(f.director.unlocked, false);
    f.deliver(secondLine, secondHuman);
    assert.equal(f.director.unlocked, true);
    assert.deepEqual(Object.keys(f.publicState()), ['unlocked'], 'no numeric relationship meter is public');
    assert.deepEqual(structuredClone(f.publicState()), { unlocked: true });
  }
});

test('generated flirting, interrupted delivery and later stale receipts do not earn a moment', () => {
  const f = setup();
  f.begin(); f.director.observe(turn(firstLine), firstHuman);
  assert.equal(f.director.unlocked, false);
  f.begin(); f.director.acknowledge(firstLine);
  f.director.observe(turn(secondLine), secondHuman); f.director.acknowledge(secondLine);
  assert.equal(f.director.unlocked, false, 'the undelivered first generation did not count');
  f.deliver(thirdLine, thirdHuman);
  assert.equal(f.director.unlocked, true);
});

test('two flirty lines, repeated receipts or repeated observation in one generation cannot unlock access', () => {
  const f = setup(); f.begin();
  f.director.observe(turn(firstLine, secondLine), firstHuman);
  f.director.acknowledge(firstLine); f.director.acknowledge(firstLine); f.director.acknowledge(secondLine);
  f.director.observe(turn(thirdLine), secondHuman); f.director.acknowledge(thirdLine);
  assert.equal(f.director.unlocked, false);
  f.deliver(secondLine, secondHuman);
  assert.equal(f.director.unlocked, true);
});

test('padding repeated player words or repeating the date’s line is not a fresh reciprocal moment', () => {
  const f = setup(); f.deliver(firstLine, firstHuman);
  f.deliver(secondLine, `${firstHuman} As I just said.`);
  assert.equal(f.director.unlocked, false);
  f.deliver({ ...firstLine, text: firstLine.text.toUpperCase() + '!!!', lineId: 'formatted-copy' }, secondHuman);
  assert.equal(f.director.unlocked, false);
  f.deliver(secondLine, secondHuman);
  assert.equal(f.director.unlocked, true);
});

test('short claims, supporting cast and another human’s turn cannot earn paired chemistry', () => {
  const f = setup();
  f.deliver(firstLine, 'Hi there');
  f.begin(); f.director.observe(turn(firstLine), firstHuman, { paired: false }); f.director.acknowledge(firstLine);
  f.deliver({ ...firstLine, speaker: 'waiter' }, secondHuman);
  f.deliver({ ...secondLine, speaker: 'other-date' }, thirdHuman);
  assert.equal(f.director.unlocked, false);
  f.deliver(firstLine, firstHuman); assert.equal(f.director.unlocked, false);
  f.deliver(secondLine, secondHuman); assert.equal(f.director.unlocked, true);
});

test('receipt identity cannot cross dates or distinct lines', () => {
  const f = setup(), own = { ...firstLine, actorId: 'd1' as const };
  f.begin(); f.director.observe(turn(own), firstHuman);
  f.director.acknowledge({ ...own, actorId: 'd2' });
  f.director.acknowledge({ ...own, lineId: 'different-line' });
  f.deliver(secondLine, secondHuman); assert.equal(f.director.unlocked, false);
  f.deliver(own, firstHuman); assert.equal(f.director.unlocked, true);
});

test('early completed playback is remembered only within the current generation and a bounded cache', () => {
  const f = setup(); f.deliver(firstLine, firstHuman, true); f.deliver(secondLine, secondHuman, true);
  assert.equal(f.director.unlocked, true);
  const g = setup(); g.begin(); g.director.acknowledge(firstLine);
  for (let i = 0; i < 16; i++) g.director.acknowledge({ ...firstLine, text: `Another completed flirting line ${i}.`, lineId: `extra-${i}` });
  g.director.observe(turn(firstLine), firstHuman);
  g.deliver(secondLine, secondHuman);
  assert.equal(g.director.unlocked, false, 'an evicted early receipt cannot be reused');
});

test('a receipt may precede the same completed turn’s final confidence update without losing delivery', () => {
  const f = setup(), respected = f.state.evening.agenda!.milestones.pop()!;
  f.begin(); f.director.acknowledge(firstLine);
  assert.equal(f.director.unlocked, false);
  f.state.evening.agenda!.milestones.push(respected);
  f.director.observe(turn(firstLine), firstHuman);
  f.deliver(secondLine, secondHuman);
  assert.equal(f.director.unlocked, true);
});

test('guarded stances and friendship prevent access despite delivered flirtation', () => {
  for (const change of [
    (state: DinnerState) => { state.evening.care.romanceClosed = true; },
    (state: DinnerState) => { state.evening.stance = 'guarded'; },
    (state: DinnerState) => { state.evening.stance = 'hurt'; },
  ]) {
    const f = setup(); change(f.state);
    f.deliver(firstLine, firstHuman); f.deliver(secondLine, secondHuman);
    assert.equal(f.director.unlocked, false);
  }
});

test('warnings and requests to leave cannot be mistaken for reciprocal attraction', () => {
  for (const boundaryEvent of ['warning', 'disregard'] as const) {
    const f = setup(); f.begin(); f.director.observe(turn(firstLine), firstHuman, { boundaryEvent }); f.director.acknowledge(firstLine);
    f.deliver(secondLine, secondHuman); assert.equal(f.director.unlocked, false);
  }
  const f = setup(); f.begin();
  f.director.observe({ ...turn(firstLine), social: { signal: 'pressure', reason: 'Asked to stop.', wantsToLeave: true } }, firstHuman);
  f.director.acknowledge(firstLine); f.deliver(secondLine, secondHuman);
  assert.equal(f.director.unlocked, false);
});

test('accepted disregard revokes access; fresh reciprocal moments are needed after repair', () => {
  const f = setup(); f.deliver(firstLine, firstHuman); f.deliver(secondLine, secondHuman);
  assert.equal(f.director.unlocked, true);
  f.director.revoke(); assert.equal(f.director.unlocked, false);
  f.deliver(thirdLine, thirdHuman); assert.equal(f.director.unlocked, false);
  f.deliver({ ...firstLine, text: 'There is that thoughtful side of you again.', lineId: 'after-repair' }, 'I would rather take our time and enjoy this moment together.');
  assert.equal(f.director.unlocked, true);
});

test('pause, ended evenings and later romantic refusal are reflected without stale public access', () => {
  const f = setup(); f.deliver(firstLine, firstHuman); f.deliver(secondLine, secondHuman);
  f.state.phase = 'paused'; assert.equal(f.publicState().unlocked, false);
  f.state.phase = 'playing'; assert.equal(f.publicState().unlocked, true, 'pausing does not erase earned moments');
  f.state.evening.care.romanceClosed = true; assert.equal(f.publicState().unlocked, false);
  const g = setup(); g.deliver(firstLine, firstHuman); g.deliver(secondLine, secondHuman);
  g.state.phase = 'ended'; assert.equal(g.publicState().unlocked, false);
});


test('table-only chemistry does not require a removed agenda objective or reward its numeric score', () => {
  const f = setup();
  f.state.evening.agenda!.milestones = []; f.state.evening.agenda!.clues = []; f.state.evening.agenda!.score = 0;
  assert.equal(f.director.unlocked, false);
  f.deliver(firstLine, firstHuman); assert.equal(f.director.unlocked, false);
  f.deliver(secondLine, secondHuman); assert.equal(f.director.unlocked, true);
});
