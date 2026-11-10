import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleLooseAssessments } from '../server/restaurant/loose-assessments';
import { validateTurn } from '../server/restaurant/index';
import { validateDoubleTurn } from '../server/double-date/conversation';
import { DOLPHIN_LLM_MODEL } from '../src/restaurant/types';

const boundary = () => ({ kind: 'none', topic: 'other', refusal: '', evidence: '' });
const solo = (social: unknown, agenda: unknown = { signal: 'none', evidence: '', clue: '' }) => ({ utterances: [{ speaker: 'date', text: 'Guilty. I was thinking the same about you.', emotion: 'amused' }], emotion: 'amused', action: 'none', memory: 'HUMAN: nothing yet\nTOLD THEM: nothing yet\nOPEN: nothing yet', social, agenda });
const typo = () => ({ signal: 'humor', reason: 'Playful.', wantsToLeave: false, boundary: { kind: 'none', topic: 'other', refusion: '', evidence: '' } });

test('a misspelled bookkeeping key or an unknown signal from Dolphin no longer discards the spoken reply', () => {
  // The two slips seen in the live Dolphin batch on 10 Nov 2026.
  const misspelled = solo(typo());
  assert.throws(() => validateTurn(structuredClone(misspelled)), /invalid social reaction/);
  assert.deepEqual(settleLooseAssessments(misspelled, DOLPHIN_LLM_MODEL), ['social_corrected']);
  const turn = validateTurn(misspelled);
  assert.equal(turn.social!.signal, 'humor'); assert.deepEqual(turn.social!.boundary, boundary()); assert.equal(turn.utterances[0].text, 'Guilty. I was thinking the same about you.');

  const offList = solo({ signal: 'warmth', reason: 'Appreciated it.', wantsToLeave: false, boundary: boundary() });
  assert.deepEqual(settleLooseAssessments(offList, DOLPHIN_LLM_MODEL), ['social_corrected']);
  assert.equal(validateTurn(offList).social!.signal, 'none');
});

test('a real boundary survives the correction, and hopeless bookkeeping becomes neutral without inventing anything', () => {
  const set = solo({ signal: 'pressure', reason: 'Asked twice.', wantsToLeave: false, boundary: { kind: 'set', topic: 'other', refusion: 'I would rather not', evidence: '' } });
  settleLooseAssessments(set, DOLPHIN_LLM_MODEL);
  assert.deepEqual(validateTurn(set).social!.boundary, { kind: 'set', topic: 'other', refusal: 'I would rather not', evidence: '' });

  const broken = solo('fine', { signal: 'progress' });
  assert.deepEqual(settleLooseAssessments(broken, DOLPHIN_LLM_MODEL), ['social_neutralised', 'agenda_neutralised']);
  const turn = validateTurn(broken);
  assert.equal(turn.social!.signal, 'none'); assert.equal(turn.social!.wantsToLeave, false); assert.equal(turn.social!.boundary!.kind, 'none'); assert.equal(turn.agenda!.signal, 'none');
});

test('schema-enforced models and the spoken line itself stay strict', () => {
  const haiku = solo(typo());
  assert.deepEqual(settleLooseAssessments(haiku, 'claude-haiku-5-5'), []);
  assert.throws(() => validateTurn(haiku), /invalid social reaction/);
  const badLine = { ...solo(typo()), utterances: [{ speaker: 'date', text: '', emotion: 'amused' }] };
  settleLooseAssessments(badLine, DOLPHIN_LLM_MODEL);
  assert.throws(() => validateTurn(badLine), /invalid line/);
  const valid = solo({ signal: 'humor', reason: 'Playful.', wantsToLeave: false, boundary: boundary() }), before = JSON.stringify(valid);
  assert.deepEqual(settleLooseAssessments(valid, DOLPHIN_LLM_MODEL), []); assert.equal(JSON.stringify(valid), before);
});

test('Double table turns are settled per date for Dolphin only', () => {
  const update = (actorId: string, social: unknown) => ({ actorId, emotion: 'warm', memory: 'HUMAN: nothing yet\nTOLD THEM: nothing yet\nOPEN: nothing yet', social, agenda: { signal: 'none', evidence: '', clue: '' } });
  const raw = JSON.stringify({ utterances: [{ speaker: 'd1', text: 'Hello both.', emotion: 'warm' }], dateUpdates: [update('d1', typo()), update('d2', { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false, boundary: boundary() })] });
  assert.throws(() => validateDoubleTurn(raw), /invalid/);
  assert.throws(() => validateDoubleTurn(raw, 'claude-haiku-5-5'), /invalid/);
  const turn = validateDoubleTurn(raw, DOLPHIN_LLM_MODEL);
  assert.equal(turn.dateUpdates[0].social.signal, 'humor'); assert.deepEqual(turn.dateUpdates[0].social.boundary, boundary());
});
