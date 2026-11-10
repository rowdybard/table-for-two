import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTurn } from '../server/restaurant/index';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { MEMORY_REJECT } from '../server/restaurant/memory';
import { DateApiError } from '../server/restaurant/providers';

const dateTurn = {
  utterances: [
    { speaker: 'date', text: 'I am glad we finally get to talk.', emotion: 'warm' },
    { speaker: 'date', text: 'There is no rush. Start anywhere.', emotion: 'neutral' },
  ],
  emotion: 'warm',
  action: 'none',
  memory: 'HUMAN: nothing yet. TOLD THEM: nothing yet. OPEN: none.',
};

test('the production Solo prompt keeps every utterance with the date', () => {
  const system = soloSystem({ dateId: 'mira', blindDate: undefined, model: 'claude-haiku-5-5' });
  assert.match(system, /Every utterance uses the exact speaker key "date"/);
  assert.match(system, /never speak for the human or another person/);
  assert.doesNotMatch(system, /only utterances\[1\] may use "waiter"/);
});

test('a two-clause date response retains both lines, while staff cannot take the floor', () => {
  assert.deepEqual(validateTurn(dateTurn), dateTurn);
  for (const speaker of ['waiter', 'diner']) assert.throws(() => validateTurn({ ...dateTurn, utterances: [dateTurn.utterances[0], { ...dateTurn.utterances[1], speaker }] }), /invalid line/);
});

test('invalid response structure reports only the failing category', () => {
  const privateContent = 'private conversation content';
  const cases: { input: unknown; field: string }[] = [
    { input: null, field: 'turn_shape' },
    { input: { ...dateTurn, unexpected: privateContent }, field: 'turn_shape' },
    { input: { ...dateTurn, utterances: privateContent }, field: 'utterances_type' },
    { input: { ...dateTurn, utterances: [] }, field: 'utterances_count' },
    { input: { ...dateTurn, utterances: [...dateTurn.utterances, dateTurn.utterances[1]] }, field: 'utterances_count' },
    { input: { ...dateTurn, emotion: privateContent }, field: 'turn_emotion' },
    { input: { ...dateTurn, action: privateContent }, field: 'turn_action' },
    { input: { ...dateTurn, memory: { note: privateContent } }, field: 'memory_type' },
    { input: { ...dateTurn, memory: privateContent.repeat(MEMORY_REJECT) }, field: 'memory_length' },
  ];

  for (const { input, field } of cases) {
    assert.throws(() => validateTurn(input), error => {
      assert.ok(error instanceof DateApiError);
      assert.equal(error.status, 502);
      assert.equal(error.code, 'invalid_dialogue');
      assert.equal(error.message, 'The date returned an invalid response. Please try another turn.');
      assert.deepEqual(error.details, { field });
      assert.doesNotMatch(JSON.stringify(error.details), /private conversation content/);
      return true;
    }, field);
  }
});

test('adding diagnostic categories does not permit invalid speech or state', () => {
  assert.throws(() => validateTurn({ ...dateTurn, utterances: [{ ...dateTurn.utterances[1], speaker: 'waiter' }] }), (error: unknown) => {
    assert.ok(error instanceof DateApiError);
    assert.deepEqual(error.details, { field: 'utterance_speaker', index: 0 });
    return true;
  });
  assert.throws(() => validateTurn({ ...dateTurn, utterances: [{ ...dateTurn.utterances[0], text: 'x'.repeat(421) }] }), (error: unknown) => {
    assert.ok(error instanceof DateApiError);
    assert.deepEqual(error.details, { field: 'utterance_text_length', index: 0 });
    return true;
  });
  assert.throws(() => validateTurn({ ...dateTurn, social: { signal: 'admin', reason: '', wantsToLeave: false } }), /invalid social reaction/);
});
