import assert from 'node:assert/strict';
import test from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { doubleTurnNote, type Couple } from '../server/double-date/table-note';
import { emptyUsage } from '../server/restaurant/scene';
import { tableNow } from '../server/restaurant/dialogue-policy';
import { turnNote, type AgendaPrompt, type TurnNoteInput } from '../server/restaurant/turn-note';
import { createBlindDate } from '../src/restaurant/blind-date';
import { CONVERSATION_SEEDS, VOICE_EXCHANGES, estimatedConversationContentTokens } from '../src/restaurant/conversation-content';
import { getDate } from '../src/restaurant/content';
import type { ConversationTarget } from '../src/restaurant/double-date-types';
import type { DateId, DinnerState } from '../src/restaurant/types';

const dateIds = ['mira', 'jules', 'dev'] as const;
const agenda: AgendaPrompt = { goal: 'Wants to be listened to.', naturalHint: 'Mention a small preference.', rubric: { noticed: 'Noticed a detail.', understood: 'Understood it.', respected: 'Respected it.' }, nextMilestone: 'noticed', evidenceReady: false, confidence: 'cautious', heardClues: [] };
const allTopics = dateIds.flatMap(id => CONVERSATION_SEEDS[id].flatMap(seed => seed.topics)).join(' ');
const broadQuestion = `Tell me about ${allTopics}. I am curious about your ambition.`;

function view(dateId: DateId, human: 'h1' | 'h2' = 'h1'): DinnerState {
  const state = createPairView('content-note', human, human === 'h1' ? 'Alex' : 'Jamie', dateId, emptyUsage(), 2);
  state.phase = 'playing'; state.evening.stance = 'comfortable';
  return state;
}

function solo(state: DinnerState, humanText: string, over: Partial<TurnNoteInput> = {}): string {
  return turnNote({ scene: state, dateName: getDate(state.dateId)!.name, humanText, tableNow: tableNow(state, getDate(state.dateId)!.name), memory: '', facts: [], agenda, boundaries: { boundaries: [] }, avoid: [], ...over });
}

function couple(dateId: DateId, actorId: 'd1' | 'd2'): Couple {
  const humanId = actorId === 'd1' ? 'h1' : 'h2';
  return { actorId, humanId, dateName: getDate(dateId)!.name, humanName: humanId === 'h1' ? 'Alex' : 'Jamie', available: true, view: view(dateId, humanId), memory: '', facts: [], agenda, boundaries: { boundaries: [] }, avoid: [], friendOnlyTurns: 0, recentOwn: [], pendingQuestion: null };
}

const double = (couples: Couple[], target: ConversationTarget, humanText = broadQuestion) => doubleTurnNote({ couples, target, humanText, speaker: 'h1', flow: {}, elapsedMinutes: 8 });
/** Keep the production wrapper, not just the helper's inner text, and count its extra paragraph join. */
const additions = (note: string) => note.split('\n\n').filter(part => part.startsWith('Possible material,') || part.startsWith('Private material for '));
const completeAddition = (note: string) => additions(note).map(block => `\n\n${block}`).join('');
const seedCount = (text: string) => text.split('\n').filter(line => /^(?:anecdote|opinion|contradiction|desire):/.test(line)).length;

function withinRequestBudget(note: string) {
  assert.ok(estimatedConversationContentTokens(completeAddition(note)) <= 600, 'complete production content addition, wrappers and joins included, must fit 600 estimated tokens');
  assert.ok(seedCount(completeAddition(note)) <= 2, 'a whole request has at most two seeds');
}

function onlyOwnPreset(block: string, owner: DateId) {
  for (const other of dateIds.filter(id => id !== owner)) {
    for (const seed of CONVERSATION_SEEDS[other]) assert.ok(!block.includes(seed.text), `${owner} must not borrow ${seed.id}`);
    for (const example of VOICE_EXCHANGES[other]) assert.ok(!block.includes(`You: “${example.date}”`), `${owner} must not borrow ${other}'s example`);
  }
}

test('production Solo notes include bounded material in only the selected preset voice', () => {
  for (const dateId of dateIds) {
    const state = view(dateId); state.mode = 'ai-date';
    const note = solo(state, broadQuestion), blocks = additions(note);
    assert.equal(blocks.length, 1);
    assert.ok(seedCount(blocks[0]) > 0, 'budget assertion must exercise actual selected material');
    withinRequestBudget(note); onlyOwnPreset(blocks[0], dateId);
  }
});

test('production Blind notes deterministically use their job bank on every rig, without preset lore or examples', () => {
  const identities = new Map<string, ReturnType<typeof createBlindDate>>();
  for (let index = 0; index < 400; index++) {
    const identity = createBlindDate(`job-bank-${index}`);
    identities.set(`${identity.biography.occupation}:${identity.dateId}`, identity);
  }
  assert.equal(identities.size, 36, 'exercise all twelve jobs on all three reused visual rigs');
  for (const identity of identities.values()) {
    const state = view(identity.dateId); state.mode = 'blind-date'; state.blindDate = { seed: identity.seed };
    const text = `Tell me about ${identity.conversationSeeds.flatMap(seed => seed.topics).join(' ')} and ${allTopics}.`;
    const note = solo(state, text), block = completeAddition(note);
    assert.equal(note, solo(structuredClone(state), text), 'same seed and scene produce the same complete note');
    assert.equal(additions(note).length, 1);
    assert.ok(identity.conversationSeeds.some(seed => block.includes(seed.text)), 'production builder must actually select the generated job material');
    assert.doesNotMatch(block, /Voice example|Mira|Jules|Dev|Ada|Inez|Leena|After Closing|Second Helping|Bike Parts/);
    for (const dateId of dateIds) for (const seed of CONVERSATION_SEEDS[dateId]) assert.ok(!block.includes(seed.text));
    withinRequestBudget(note);
  }
});

test('production Double table notes share one complete content budget and keep each preset under its own header', () => {
  for (const pair of [['mira', 'jules'], ['mira', 'dev'], ['jules', 'dev']] as const) {
    const couples = [couple(pair[0], 'd1'), couple(pair[1], 'd2')];
    const note = double(couples, 'table'), blocks = additions(note);
    assert.equal(blocks.length, 2);
    for (let index = 0; index < couples.length; index++) {
      assert.ok(blocks[index].startsWith(`Private material for ${couples[index].dateName} only:\n`));
      assert.equal(seedCount(blocks[index]), 1);
      onlyOwnPreset(blocks[index], pair[index]);
    }
    withinRequestBudget(note);
  }
});

test('production Double directed notes give material only to the addressed date; friend-directed notes give none', () => {
  const couples = [couple('mira', 'd1'), couple('jules', 'd2')];
  for (const index of [0, 1]) {
    const note = double(couples, index === 0 ? 'd1' : 'd2'), blocks = additions(note);
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].startsWith(`Private material for ${couples[index].dateName} only:\n`));
    assert.ok(seedCount(blocks[0]) > 0);
    onlyOwnPreset(blocks[0], couples[index].view.dateId); withinRequestBudget(note);
  }
  for (const target of ['h1', 'h2'] as const) assert.deepEqual(additions(double(couples, target)), []);
});

test('production Double omits offstage material while retaining the available date and its budget', () => {
  for (const phase of ['playing', 'ended'] as const) {
    const absent = couple('mira', 'd1'), present = couple('jules', 'd2');
    absent.available = false; absent.agenda = null; absent.view.phase = phase;
    absent.memory = 'HUMAN: private offstage note that must not be shown';
    const tableNote = double([absent, present], 'table'), blocks = additions(tableNote);
    assert.equal(blocks.length, 1); assert.ok(blocks[0].startsWith('Private material for Jules only:'));
    assert.doesNotMatch(tableNote, /private offstage note that must not be shown/);
    assert.deepEqual(additions(double([absent, present], 'd1')), []);
    withinRequestBudget(tableNote);
  }
});

test('production note selection respects each couple’s disclosure state and its own retell notebook', () => {
  const mira = couple('mira', 'd1'), jules = couple('jules', 'd2');
  mira.view.evening.stance = 'guarded';
  const topic = 'Tell me about your dream for After Closing, the exhibition and your photo show.';
  assert.ok(!completeAddition(double([mira, jules], 'd1', topic)).includes(CONVERSATION_SEEDS.mira.find(seed => seed.id === 'mira-after-closing')!.text));
  mira.view.evening.stance = 'comfortable';
  assert.ok(completeAddition(double([mira, jules], 'd1', topic)).includes(CONVERSATION_SEEDS.mira.find(seed => seed.id === 'mira-after-closing')!.text));
  mira.memory = `TOLD THEM: ${CONVERSATION_SEEDS.mira.flatMap(seed => seed.retellKeys).join('; ')}`;
  const note = double([mira, jules], 'table', 'Tell me about work, a photo, a book and the train.');
  const blocks = additions(note);
  assert.equal(blocks.length, 1, 'Mira’s already-told material must not return or suppress Jules’s untold material');
  assert.ok(blocks[0].startsWith('Private material for Jules only:'));
  withinRequestBudget(note);
});
