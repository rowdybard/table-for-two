import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTurn } from '../server/restaurant/index';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { MEMORY_REJECT } from '../server/restaurant/memory';
import { DateApiError } from '../server/restaurant/providers';

const waiterTurn = {
  utterances: [
    { speaker: 'date', text: 'Let’s ask Eli for some water.', emotion: 'warm' },
    { speaker: 'waiter', text: 'Certainly, I’ll bring some over.', emotion: 'neutral' },
  ],
  emotion: 'warm',
  action: 'none',
  memory: 'HUMAN: Asked Eli for water.',
};

test('the production Solo prompt specifies the exact first speaker even for an Eli question', () => {
  const system = soloSystem({ dateId: 'mira', blindDate: undefined, model: 'claude-haiku-5-5' });
  assert.match(system, /Set utterances\[0\]\.speaker to "date" even for questions about Eli/);
  assert.match(system, /only utterances\[1\] may use "waiter" or "diner"/);
  assert.match(system, /Eli does not comment on ordinary conversation/);
});

test('a valid waiter response is accepted and retains its date and waiter lines', () => {
  assert.deepEqual(validateTurn(waiterTurn), waiterTurn);
});

test('invalid waiter response structure reports only the failing category', () => {
  const privateContent = 'private conversation content';
  const cases: { input: unknown; field: string }[] = [
    { input: null, field: 'turn_shape' },
    { input: { ...waiterTurn, unexpected: privateContent }, field: 'turn_shape' },
    { input: { ...waiterTurn, utterances: privateContent }, field: 'utterances_type' },
    { input: { ...waiterTurn, utterances: [] }, field: 'utterances_count' },
    { input: { ...waiterTurn, utterances: [...waiterTurn.utterances, waiterTurn.utterances[1]] }, field: 'utterances_count' },
    { input: { ...waiterTurn, emotion: privateContent }, field: 'turn_emotion' },
    { input: { ...waiterTurn, action: privateContent }, field: 'turn_action' },
    { input: { ...waiterTurn, memory: { note: privateContent } }, field: 'memory_type' },
    { input: { ...waiterTurn, memory: privateContent.repeat(MEMORY_REJECT) }, field: 'memory_length' },
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
  assert.throws(() => validateTurn({ ...waiterTurn, utterances: [waiterTurn.utterances[1]] }), (error: unknown) => {
    assert.ok(error instanceof DateApiError);
    assert.deepEqual(error.details, { field: 'utterance_speaker', index: 0 });
    return true;
  });
  assert.throws(() => validateTurn({ ...waiterTurn, utterances: [{ ...waiterTurn.utterances[0], text: 'x'.repeat(421) }] }), (error: unknown) => {
    assert.ok(error instanceof DateApiError);
    assert.deepEqual(error.details, { field: 'utterance_text_length', index: 0 });
    return true;
  });
  assert.throws(() => validateTurn({ ...waiterTurn, social: { signal: 'admin', reason: '', wantsToLeave: false } }), /invalid social reaction/);
});
