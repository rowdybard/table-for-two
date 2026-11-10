import test from 'node:test';
import assert from 'node:assert/strict';
import { DateBoundaryDirector, spokenRefusal } from '../server/restaurant/boundaries';
import { NO_SPARK } from '../server/restaurant/evening';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

const state = () => ({ phase: 'playing', evening: createEvening('jules') }) as unknown as DinnerState;

const date = (text: string): SceneUtterance => ({ speaker: 'date', text, emotion: 'neutral' });
const none = { kind: 'none', topic: 'other', refusal: '', evidence: '' } as const;

test('a refusal the date said out loud is read from its own line', () => {
  assert.deepEqual(spokenRefusal([date("I'm not giving out my address on a first date, Grant. Where are you from?")]), { topic: 'personal-details', refusal: "I'm not giving out my address on a first date, Grant." });
  assert.deepEqual(spokenRefusal([date('No photo, Grant. Your friends can take my word for it.')]), { topic: 'other', refusal: 'No photo, Grant.' });
  assert.equal(spokenRefusal([date('I spent an hour on a sauce and I would do it again.')]), null);
  assert.equal(spokenRefusal([date('No, I have never been to Cardiff. Is it nice?')]), null, 'an ordinary no is not a refusal');
  assert.equal(spokenRefusal([{ speaker: 'waiter', text: 'I said no photos in the dining room.', emotion: 'neutral' }]), null, 'only the date sets its own boundaries');
});

test('a spoken refusal arms a boundary without a penalty, and only later pressure on it counts', () => {
  const director = new DateBoundaryDirector(state());
  const refusal = date('No photo, Grant. Your friends can take my word for it.');
  assert.deepEqual(director.assess({ ...none }, 'Let me take a photo of you for my friends.', [refusal]), { kind: 'warning', count: 0, canLeave: false });
  director.acknowledge(refusal);
  assert.equal(director.promptContext().boundaries[0].refusal, 'No photo, Grant.');
  assert.equal(director.promptContext().boundaries[0].disregardCount, 0);
  const first = director.assess({ kind: 'repeat', topic: 'other', refusal: 'No photo, Grant.', evidence: 'Hold still' }, "It's one photo. Hold still.", [date('I said no to the photo.')]);
  assert.deepEqual(first, { kind: 'disregard', count: 1, canLeave: false });
  const second = director.assess({ kind: 'repeat', topic: 'other', refusal: 'No photo, Grant.', evidence: 'Just one' }, 'Just one. Come on.', [date('No.')]);
  assert.deepEqual(second, { kind: 'disregard', count: 2, canLeave: true });
  // Ordinary talk never arms anything.
  assert.equal(new DateBoundaryDirector(state()).assess({ ...none }, 'What do you do?', [date('I restore books.')]).kind, 'none');
});

test('only the human saying there is no romance between the two of them closes it', () => {
  for (const text of ["I think I should say, I'm not feeling a romantic thing here.", "Let's just be friends.", 'I think we are better as friends.', "I don't see you that way."]) assert.ok(NO_SPARK.test(text), text);
  for (const text of ['My ex and I are just friends now.', 'I am not interested in football.', 'Hannah and Priya stay friends through everything.', 'I like you.']) assert.ok(!NO_SPARK.test(text), text);
});
