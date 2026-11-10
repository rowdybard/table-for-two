import assert from 'node:assert/strict';
import test from 'node:test';
import { doubleConversationFlow } from '../server/double-date/table-note';

const lines = [
  { id: 'mira-line', speaker: 'd1', text: 'I collect tiny railway maps.' },
  { id: 'jules-line', speaker: 'd2', text: 'I keep the misprinted ones.' },
];
const heard = () => ({ completed: true, playedSeconds: 3 });
const input = {
  history: [{ human: 'h1' as const, text: 'Hello both of you.', target: 'table' }, { lines }],
  lines, human: 'h1' as const, target: 'table' as const, text: 'What do you mean?', quietSeconds: 0,
  dateNames: { d1: 'Mira', d2: 'Jules' }, humanNames: ['Alex', 'Casey'], available: () => true, heard,
};

test('an explicit friend target cannot acquire an AI clarification from a name mention', () => {
  for (const humanNames of [['Alex', 'Casey'], ['Alex', 'Mira'], ['Mira', 'Mira']]) {
    for (const text of ['Mira, what do you mean?', 'Jules, what do you mean?', 'What do you mean?']) {
      assert.equal(doubleConversationFlow({ ...input, target: 'h2', text, humanNames }).lastDateLine, undefined, `${humanNames}: ${text}`);
    }
  }
});

test('a date target beats incidental or ambiguous names while a unique date vocative remains usable', () => {
  for (const text of ['Jules said something about maps. What do you mean?', 'Mira and Jules, what do you mean?']) {
    assert.deepEqual(doubleConversationFlow({ ...input, target: 'd1', text }).lastDateLine, { by: 'Mira', text: lines[0].text }, text);
  }
  for (const text of ['Jules, what do you mean?', 'Jules what do you mean?', 'What do you mean, Jules?']) {
    assert.deepEqual(doubleConversationFlow({ ...input, target: 'd1', text }).lastDateLine, { by: 'Jules', text: lines[1].text }, text);
  }
  assert.deepEqual(doubleConversationFlow({ ...input, target: 'd1', text: 'Jules, what do you mean?', humanNames: ['Alex', 'Jules'] }).lastDateLine,
    { by: 'Mira', text: lines[0].text }, 'a colliding name cannot override the explicit date target');
});

test('table clarifications do not turn a friend vocative or an ambiguous name into AI history', () => {
  for (const [humanNames, text] of [
    [['Alex', 'Casey'], 'Casey, what do you mean?'],
    [['Alex', 'Mira'], 'Mira, what do you mean?'],
    [['Mira', 'Mira'], 'Mira, what do you mean?'],
    [['Alex', 'Casey'], 'Mira and Jules, what do you mean?'],
  ] as const) {
    assert.equal(doubleConversationFlow({ ...input, humanNames, text }).lastDateLine, undefined, text);
  }
  assert.deepEqual(doubleConversationFlow({ ...input, text: 'Mira, what do you mean?' }).lastDateLine, { by: 'Mira', text: lines[0].text });
  assert.deepEqual(doubleConversationFlow(input).lastDateLine, { by: 'Jules', text: lines[1].text }, 'an unnamed table question still points at its last heard date');
});

test('a named but unheard or offstage date never falls back to somebody else’s line', () => {
  const text = 'Mira, what do you mean?';
  assert.equal(doubleConversationFlow({ ...input, text, heard: id => id === 'mira-line' ? undefined : heard() }).lastDateLine, undefined);
  assert.equal(doubleConversationFlow({ ...input, text, available: actor => actor !== 'd1' }).lastDateLine, undefined);
});

test('an unnamed table clarification does not skip over the friend who actually spoke last', () => {
  const friend = { id: 'friend-line', speaker: 'h2', text: 'My house is a lighthouse, apparently.' };
  const current = { id: 'current-line', speaker: 'h1', text: 'What do you mean?' };
  const afterFriend = { ...input, history: [...input.history, { human: 'h2' as const, text: friend.text, target: 'table' }, { lines: [] }], lines: [...lines, friend, current] };
  assert.equal(doubleConversationFlow(afterFriend).lastDateLine, undefined);
  assert.deepEqual(doubleConversationFlow({ ...afterFriend, target: 'd1' }).lastDateLine, { by: 'Mira', text: lines[0].text });
  assert.deepEqual(doubleConversationFlow({ ...afterFriend, text: 'Mira, what do you mean?' }).lastDateLine, { by: 'Mira', text: lines[0].text });
  assert.equal(doubleConversationFlow({ ...input, heard: id => id === 'jules-line' ? undefined : heard() }).lastDateLine, undefined,
    'an implicit clarification does not substitute an older line for the latest unheard participant');
});
