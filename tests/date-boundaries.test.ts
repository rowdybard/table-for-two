import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOUNDARY_SCHEMA, DateBoundaryDirector, validBoundaryAssessment } from '../server/restaurant/boundaries';
import type { BoundaryAssessment } from '../src/restaurant/boundary-types';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

const refusal = 'Please stop making sexual comments at the table.';
const line: SceneUtterance = { speaker: 'date', text: `I like flirting, but ${refusal}`, emotion: 'annoyed', actorId: 'd1', lineId: 'warning-1' };
const current = 'I want to keep making those comments anyway.';
const proposal = (kind: BoundaryAssessment['kind'], overrides: Partial<BoundaryAssessment> = {}): BoundaryAssessment => ({ kind, topic: 'sexual-talk', refusal: kind === 'none' ? '' : refusal, evidence: kind === 'repeat' ? current : '', ...overrides });
function fixture() {
  const state = { id: 'boundary-test', phase: 'playing', dateId: 'dev', evening: createEvening('dev') } as DinnerState;
  const director = new DateBoundaryDirector(state);
  const set = (human = 'player', warning = line) => director.assess(proposal('set'), 'I was trying to flirt with you.', [warning], human);
  const repeat = (human = 'player', overrides: Partial<BoundaryAssessment> = {}) => director.assess(proposal('repeat', overrides), current, [], human);
  return { state, director, set, repeat };
}

test('boundary proposals have a strict bounded contract, not caller-supplied strikes', () => {
  assert.deepEqual(BOUNDARY_SCHEMA.required, ['kind', 'topic', 'refusal', 'evidence']);
  assert.equal(BOUNDARY_SCHEMA.additionalProperties, false);
  assert.equal(validBoundaryAssessment(proposal('none')), true);
  assert.equal(validBoundaryAssessment(proposal('set')), true);
  assert.equal(validBoundaryAssessment(proposal('repeat')), true);
  for (const value of [undefined, null, [], {}, { ...proposal('repeat'), canLeave: true },
    { ...proposal('repeat'), kind: 'pressure' }, { ...proposal('repeat'), topic: 'vibes' },
    proposal('set', { refusal: ' ' }), proposal('repeat', { evidence: ' ' }),
    proposal('repeat', { evidence: 'x'.repeat(241) }), proposal('set', { refusal: 'x'.repeat(241) }),
    proposal('set', { refusal: '\u0000' })]) assert.equal(validBoundaryAssessment(value), false);
});

test('initial flirting and an initial refusal never count as repeated disregard', () => {
  const f = fixture();
  assert.deepEqual(f.director.assess(proposal('none'), 'That was a cheeky little compliment.', [], 'player'), { kind: 'none', count: 0, canLeave: false });
  assert.deepEqual(f.set(), { kind: 'warning', count: 0, canLeave: false });
  assert.equal(f.director.promptContext().boundaries[0].delivered, false);
  assert.deepEqual(f.repeat(), { kind: 'none', count: 0, canLeave: false });
  f.director.acknowledge(line);
  assert.deepEqual(f.repeat(), { kind: 'disregard', count: 1, canLeave: false });
  assert.deepEqual(f.repeat(), { kind: 'disregard', count: 2, canLeave: true });
  assert.equal(JSON.stringify(f.state).includes(refusal), false, 'private warning text is not added to public snapshots');
});

test('fabricated refusals, quotes, unrelated topics and other listeners cannot supply a strike', () => {
  const f = fixture();
  assert.equal(f.director.assess(proposal('set', { refusal: 'An invented refusal.' }), current, [line]).kind, 'none');
  assert.equal(f.director.assess(proposal('set'), current, [{ ...line, speaker: 'waiter' }]).kind, 'none');
  assert.equal(f.director.assess(proposal('set'), '', [line]).kind, 'none');
  f.set('h1');
  f.director.acknowledge({ ...line, lineId: 'another-line' }, 'h1');
  f.director.acknowledge({ ...line, actorId: 'd2' }, 'h1');
  f.director.acknowledge(line, 'h2');
  assert.equal(f.repeat('h1').kind, 'none', 'the responsible human has not received this warning');
  f.director.acknowledge(line, 'h1');
  assert.equal(f.repeat('h2').kind, 'none', 'a different human has no active boundary');
  assert.equal(f.repeat('h1', { topic: 'food-drink' }).kind, 'none');
  assert.equal(f.repeat('h1', { evidence: 'A fabricated player sentence.' }).kind, 'none');
  assert.equal(f.repeat('h1', { refusal: 'A different refusal.' }).kind, 'none');
  assert.equal(f.repeat('h1').count, 1);
});

test('listener state and repeats remain independent at a shared table', () => {
  const f = fixture(), second = { ...line, lineId: 'warning-h2' };
  f.set('h1'); f.director.acknowledge(line, 'h1');
  f.set('h2', second); f.director.acknowledge(second, 'h2');
  f.repeat('h1'); f.repeat('h1');
  assert.equal(f.director.promptContext('h1').boundaries[0].disregardCount, 2);
  assert.equal(f.director.promptContext('h2').boundaries[0].disregardCount, 0);
  assert.deepEqual(f.repeat('h2'), { kind: 'disregard', count: 1, canLeave: false });
});

test('fast completed delivery before the enclosing response is parsed activates only a warning', () => {
  const f = fixture();
  f.director.acknowledge(line, 'h1');
  assert.deepEqual(f.set('h1'), { kind: 'warning', count: 0, canLeave: false });
  assert.equal(f.director.promptContext('h1').boundaries[0].delivered, true);
  assert.equal(f.repeat('h1').count, 1, 'only a later completed assessment may count disregard');
  const g = fixture();
  for (let i = 0; i < 17; i++) g.director.acknowledge({ ...line, text: `Earlier line ${i}`, lineId: `earlier-${i}` });
  const old = { ...line, text: 'Earlier line 0', lineId: 'earlier-0' };
  g.director.assess(proposal('set', { refusal: 'Earlier line 0' }), 'An actual human turn.', [old]);
  assert.equal(g.director.promptContext().boundaries[0].delivered, false, 'early delivery memory is bounded');
});

test('interruption discards pending warnings and stale line identity cannot revive a new warning', () => {
  const f = fixture();
  f.set('h1'); f.director.clearPending();
  f.director.acknowledge(line, 'h1');
  assert.deepEqual(f.director.promptContext().boundaries, []);
  assert.equal(f.repeat('h1').kind, 'none');
  const later = { ...line, lineId: 'new-warning' };
  f.set('h1', later);
  assert.equal(f.director.promptContext().boundaries[0].delivered, false);
  f.director.acknowledge(later, 'h1');
  assert.equal(f.repeat('h1').count, 1);
  f.director.clearPending('h1');
  assert.equal(f.director.promptContext('h1').boundaries[0].delivered, true, 'interrupting never erases a boundary already delivered');
});

test('rewording or repeating a warning cannot reset established disregard', () => {
  const f = fixture(); f.set(); f.director.acknowledge(line); f.repeat();
  const nextRefusal = 'Drop the sexual comments. I am serious.', next = { ...line, text: nextRefusal, lineId: 'warning-2' };
  const result = f.director.assess(proposal('set', { refusal: nextRefusal }), current, [next]);
  assert.deepEqual(result, { kind: 'warning', count: 1, canLeave: false });
  assert.equal(f.director.promptContext().boundaries[0].refusal, refusal, 'the earlier delivered refusal remains active until replacement delivery');
  f.director.acknowledge(next);
  assert.equal(f.repeat('player', { refusal: nextRefusal }).canLeave, true);
});

test('repair requires a delivered boundary and actual current acknowledgment, and does not erase the boundary', () => {
  const f = fixture(), apology = 'I understand. I will drop that subject.', repair = proposal('repair', { evidence: apology });
  assert.equal(f.director.assess(repair, apology, []).kind, 'none');
  f.set();
  assert.equal(f.director.assess(repair, apology, []).kind, 'none');
  f.director.acknowledge(line);
  assert.equal(f.director.assess(repair, apology, []).kind, 'none', 'a harmless initial refusal needs no paid-for repair');
  f.repeat();
  assert.equal(f.director.assess(repair, 'I said something else.', []).kind, 'none');
  assert.deepEqual(f.director.assess(repair, apology, []), { kind: 'repair', count: 0, canLeave: false });
  assert.equal(f.director.promptContext().boundaries[0].delivered, true);
  assert.equal(f.director.assess(repair, apology, []).kind, 'none', 'repeated apologies cannot manufacture further repair');
  assert.equal(f.repeat().count, 1);
});

test('private context copies cannot mutate live counts, and a completed date freezes boundary state', () => {
  const f = fixture(); f.set(); f.director.acknowledge(line);
  const context = f.director.promptContext(); context.boundaries[0].disregardCount = 100; context.boundaries[0].refusal = 'Forged';
  assert.equal(f.repeat().count, 1);
  f.state.phase = 'ended';
  const before = f.director.promptContext();
  assert.equal(f.repeat().kind, 'none');
  f.director.acknowledge({ ...line, lineId: 'after' });
  assert.deepEqual(f.director.promptContext(), before);
});
