import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENDA_SCHEMA, DateAgendaDirector, validAgendaAssessment } from '../server/restaurant/agendas';
import { createEvening } from '../src/restaurant/evening';
import type { AgendaAssessment, DateAgendaProgress } from '../src/restaurant/agenda-types';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

function setup(seed = 'evening-seed', blind = false, variation = 0) {
  const state = { id: seed, dateId: 'mira', mode: blind ? 'blind-date' : 'ai-date', ...(blind ? { blindDate: { seed } } : {}), evening: createEvening('mira', variation) } as DinnerState;
  const director = new DateAgendaDirector(state);
  const progress = (state.evening as typeof state.evening & { agenda: DateAgendaProgress }).agenda;
  const line: SceneUtterance = { speaker: 'date', text: 'I would like a little room to make my own choices tonight.', emotion: 'neutral' };
  const secondLine: SceneUtterance = { speaker: 'date', text: 'Please ask before changing my plans, even when you mean well.', emotion: 'neutral' };
  const assess = (signal: AgendaAssessment['signal'], evidence: string, clue = '') => director.assess({ signal, evidence, clue }, evidence, [line]);
  const hear = (spoken = line, clue = spoken.text) => { director.assess({ signal: 'none', evidence: '', clue }, '', [spoken]); director.acknowledge(spoken); };
  return { state, director, progress, line, secondLine, assess, hear };
}

test('agenda selection is deterministic, has sixteen goals, and keeps the live goal/rubric private', () => {
  const first = setup(), same = setup();
  assert.deepEqual(first.director.promptContext(), same.director.promptContext());
  const goals = new Set(Array.from({ length: 512 }, (_, i) => setup(`seed-${i}`).director.promptContext().goal));
  assert.equal(goals.size, 16);
  const blind = setup('blind-seed', true), blindReload = setup('blind-seed', true, 2);
  assert.equal(blind.director.promptContext().goal, blindReload.director.promptContext().goal, 'blind identity seed determines the goal');
  const pairOne = setup('same-room', false, 0), pairTwo = setup('same-room', false, 1);
  assert.notEqual(pairOne.director.promptContext().goal, pairTwo.director.promptContext().goal, 'pair variation participates in the seed');
  assert.equal(first.progress.goal, null); assert.equal(first.progress.reflection, null);
  assert.equal(first.progress.score, 0); assert.equal(first.progress.possible, 100);
  assert.equal(JSON.stringify(first.state).includes(first.director.promptContext().goal), false);
  assert.equal(JSON.stringify(first.state).includes('rubric'), false);
});

test('assessment validation is strict and bounds evidence/clue text before mutation', () => {
  assert.deepEqual(AGENDA_SCHEMA.required, ['signal', 'evidence', 'clue']);
  assert.equal(AGENDA_SCHEMA.additionalProperties, false);
  assert.equal(validAgendaAssessment({ signal: 'none', evidence: '', clue: '' }), true);
  assert.equal(validAgendaAssessment({ signal: 'noticed', evidence: 'A specific observation.', clue: '' }), true);
  for (const invalid of [undefined, null, [], {}, { signal: 'none', evidence: '' }, { signal: 'love', evidence: 'Hi', clue: '' },
    { signal: 'noticed', evidence: ' ', clue: '' }, { signal: 'noticed', evidence: 'x'.repeat(241), clue: '' },
    { signal: 'none', evidence: '', clue: 'x'.repeat(181) }, { signal: 'none', evidence: '', clue: '', points: 100 },
    { signal: 'none', evidence: '', clue: '\u0000' }]) assert.equal(validAgendaAssessment(invalid), false);
});

test('only an exact clue from the date becomes known after completed playback', () => {
  const f = setup(), clue = 'room to make my own choices';
  f.assess('none', '', clue);
  assert.deepEqual(f.progress.clues, [], 'generating a clue does not establish that it was heard');
  f.director.acknowledge({ ...f.line, text: 'Another line.' });
  f.director.acknowledge({ ...f.line, speaker: 'waiter' });
  assert.deepEqual(f.progress.clues, []);
  f.director.acknowledge(f.line); f.director.acknowledge(f.line);
  assert.deepEqual(f.progress.clues, [clue]);
  f.assess('none', '', 'A fabricated clue.'); f.director.acknowledge(f.line);
  assert.deepEqual(f.progress.clues, [clue]);
  assert.equal(f.progress.goal, null);
});

test('new turns discard interrupted pending clues and actor/line delivery cannot cross dates', () => {
  const f = setup(), actorLine: SceneUtterance = { ...f.line, actorId: 'd1', lineId: 'line-1' };
  f.director.assess({ signal: 'none', evidence: '', clue: 'my own choices' }, '', [actorLine]);
  f.director.acknowledge({ ...actorLine, actorId: 'd2' });
  f.director.acknowledge({ ...actorLine, lineId: 'line-2' });
  assert.equal(f.progress.clues.length, 0);
  f.director.assess(undefined, 'An interrupting new turn.', []);
  f.director.acknowledge(actorLine);
  assert.equal(f.progress.clues.length, 0, 'late acknowledgment cannot revive the discarded clue');
});

test('fast completed playback received before the full assessment still establishes a clue', () => {
  const f = setup();
  f.director.acknowledge(f.line);
  f.assess('none', '', 'my own choices');
  assert.deepEqual(f.progress.clues, ['my own choices']);
  const g = setup();
  for (let i = 0; i < 17; i++) g.director.acknowledge({ ...g.line, text: `Older spoken line ${i}.` });
  g.director.assess({ signal: 'none', evidence: '', clue: 'Older' }, '', [{ ...g.line, text: 'Older spoken line 0.' }]);
  assert.deepEqual(g.progress.clues, [], 'early delivery cache is bounded');
});

test('scoring requires sequential milestones, exact new human evidence and distinct previously heard specifics', () => {
  const f = setup();
  f.assess('respected', 'I will give you room.'); assert.equal(f.progress.score, 0);
  f.director.assess({ signal: 'noticed', evidence: 'An invented player quote.', clue: '' }, 'I said something else.', [f.line]);
  assert.equal(f.progress.score, 0);
  f.assess('noticed', 'You seem to want your own say.'); assert.equal(f.progress.score, 0, 'guessing before a heard clue earns nothing');
  f.hear(f.line, 'my own choices');
  f.assess('noticed', 'You seem to want your own say.'); assert.equal(f.progress.score, 30);
  f.assess('noticed', 'Here is another observation.'); assert.equal(f.progress.score, 30);
  f.assess('understood', 'Having someone choose for you could feel tiring.'); assert.equal(f.progress.score, 30);
  f.hear(f.secondLine);
  f.assess('understood', 'You seem to want your own say.'); assert.equal(f.progress.score, 30, 'same evidence cannot pay twice');
  f.assess('understood', 'You seem to want your own say, as I mentioned.'); assert.equal(f.progress.score, 30, 'padding a reused quote is not fresh evidence');
  f.assess('understood', 'Having someone choose for you could feel tiring.'); assert.equal(f.progress.score, 65);
  f.assess('respected', 'Choose what you like; I prefer something different.'); assert.equal(f.progress.score, 100, 'honest disagreement can demonstrate respect');
  assert.deepEqual(f.progress.milestones.map(m => m.kind), ['noticed', 'understood', 'respected']);
  f.assess('respected', 'One more remark.'); assert.equal(f.progress.score, 100);
});

test('a current response clue cannot retrospectively support understanding on the human turn that preceded it', () => {
  const f = setup(); f.hear(f.line, 'my own choices'); f.assess('noticed', 'You sound interested in choosing.');
  f.director.acknowledge(f.secondLine);
  f.director.assess({ signal: 'understood', evidence: 'I see why that matters to you.', clue: f.secondLine.text }, 'I see why that matters to you.', [f.secondLine]);
  assert.equal(f.progress.score, 30);
  f.assess('understood', 'Being considered is different from being directed.');
  assert.equal(f.progress.score, 65);
});

test('pressure revokes respect and requires fresh demonstrated evidence to regain it', () => {
  const f = setup(); f.hear(f.line, 'my own choices'); f.assess('noticed', 'You would like your own choice.');
  f.hear(f.secondLine);
  f.assess('understood', 'Care should leave room for independence.');
  f.assess('respected', 'Pick your dish; I will order mine.');
  assert.equal(f.progress.score, 100);
  f.director.pressure(); assert.equal(f.progress.score, 65);
  assert.deepEqual(f.progress.milestones.map(m => m.kind), ['noticed', 'understood']);
  f.assess('respected', 'Pick your dish; I will order mine.'); assert.equal(f.progress.score, 65);
  f.assess('respected', 'You said no to sharing, so let us keep our own plates.'); assert.equal(f.progress.score, 100);
  assert.equal(f.progress.goal, null);
});

test('finish reveals an evidence-based reflection once and freezes the final score', () => {
  const f = setup(); f.hear(); f.assess('noticed', 'You want to make your own choices.');
  f.director.finish();
  assert.equal(f.progress.goal, f.director.promptContext().goal);
  assert.ok(f.progress.reflection?.includes('You want to make your own choices.'));
  const before = structuredClone(f.progress);
  f.director.finish(); f.director.pressure(); f.assess('understood', 'Another response.'); f.director.acknowledge(f.line);
  assert.deepEqual(f.progress, before);
  const empty = setup(); empty.director.finish();
  assert.equal(empty.progress.score, 0); assert.ok(empty.progress.goal); assert.ok(empty.progress.reflection);
});
