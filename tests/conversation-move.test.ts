import assert from 'node:assert/strict';
import test from 'node:test';
import { answerFacts, conversationMove, readHumanTurn } from '../server/restaurant/conversation-move';
import { turnNote } from '../server/restaurant/turn-note';
import { DATE_DIALOGUE_INSTRUCTIONS } from '../server/restaurant/dialogue-policy';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

const date = (text: string): SceneUtterance => ({ speaker: 'date', text, emotion: 'warm' });

test('questions are found with or without a question mark, at most three, and bounced questions resolve to the date’s own', () => {
  assert.deepEqual(readHumanTurn('So what do you do for work').questions, ['So what do you do for work']);
  assert.deepEqual(readHumanTurn('I love hiking. Do you have any siblings? Where do you live?').questions, ['Do you have any siblings?', 'Where do you live?']);
  assert.equal(readHumanTurn('I went to a tiny school.').questions.length, 0);
  const bounced = readHumanTurn('I grew up by the sea. What about you?', 'Oh nice. Where did you grow up?');
  assert.ok(bounced.moves.includes('bounce'));
  assert.equal(bounced.bounced, 'Where did you grow up?');
  assert.equal(bounced.questions.length, 0, 'the bounce is not also a fresh question');
  assert.ok(readHumanTurn('wbu').moves.includes('bounce'));
});

test('flirts, jokes, disclosures, opinions and short answers are told apart without counting ordinary words', () => {
  assert.ok(readHumanTurn('You look really nice tonight.').moves.includes('flirt'));
  assert.ok(readHumanTurn('I like your smile.').moves.includes('flirt'));
  assert.ok(!readHumanTurn('The pasta was pretty good.').moves.includes('flirt'));
  assert.ok(!readHumanTurn('It is hot in here.').moves.includes('flirt'));
  assert.ok(!readHumanTurn('Would you like your water topped up?').moves.includes('flirt'));
  assert.ok(readHumanTurn('haha that is so dumb').moves.includes('joke'));
  assert.ok(readHumanTurn('My dad passed away last spring and it has been a hard year.').moves.includes('disclosure'));
  assert.ok(readHumanTurn('Pineapple on pizza is underrated.').moves.includes('opinion'));
  assert.ok(readHumanTurn('yeah not bad').moves.includes('short'));
  assert.ok(!readHumanTurn('yes?').moves.includes('short'), 'a question is not a short answer');
});

test('reactions, invitations and plain facts about themselves are not treated as fresh questions or short answers', () => {
  for (const text of ['really?', 'what', 'no way', 'is that right', 'wait, seriously?']) {
    const read = readHumanTurn(text);
    assert.ok(read.moves.includes('reaction'), text); assert.equal(read.questions.length, 0, text);
  }
  assert.ok(!readHumanTurn('What do you do?').moves.includes('reaction'));
  const invite = readHumanTurn('no way, tell me more');
  assert.ok(invite.moves.includes('invite')); assert.equal(invite.questions.length, 0);
  assert.deepEqual(readHumanTurn('Tell me about your family.').questions, ['Tell me about your family.']);
  assert.deepEqual(readHumanTurn("I'm a nurse").moves, ['share']);
  assert.deepEqual(readHumanTurn('I love dogs').moves, ['opinion'], 'one steer, not two');
  assert.ok(readHumanTurn('you first', 'Where did you grow up?').moves.includes('bounce'));
  assert.match(conversationMove({ dateId: 'mira', humanText: 'really?', lastDateLine: 'I once shot a wedding on a ferry.' }), /confirm it/);
  assert.match(conversationMove({ dateId: 'mira', humanText: 'what', lastDateLine: 'Where did you grow up?' }), /simpler words/);
  assert.match(conversationMove({ dateId: 'mira', humanText: "I'm a nurse" }), /never ask for what they just told you/);
});

test('a direct question is answered with the date’s own plain facts and never the private hope', () => {
  const facts = answerFacts('mira', ['What do you do for work?', 'Any siblings?']);
  assert.deepEqual(facts.map(fact => fact.split(':')[0]), ['work', 'family']);
  assert.match(facts.join(' '), /photographer/); assert.match(facts.join(' '), /Ada/);
  for (const id of ['mira', 'jules', 'dev'] as const) {
    const all = answerFacts(id, ['What do you do for work, what about family, what do you do for fun, your favourite food, how old are you']).join(' ');
    assert.doesNotMatch(all, /exhibition|After Closing|food truck|Second Helping|recipe of their own/i, id);
  }
  assert.deepEqual(answerFacts('jules', ['How old are you?']), ['age: 29']);
  assert.deepEqual(answerFacts('mira', ['what do you do?'], { occupation: 'ferry engineer' }), ['work: ferry engineer'], 'a blind date never borrows the preset biography');
  assert.deepEqual(answerFacts('mira', ['Do you remember what I do for work?']), [], 'a question about the human never gets the date’s own facts');
  const recall = conversationMove({ dateId: 'mira', humanText: 'Okay, a test. Do you remember what I do for work?' });
  assert.match(recall, /about their own life/); assert.match(recall, /never guess/); assert.doesNotMatch(recall, /photographer/);
  assert.match(conversationMove({ dateId: 'mira', humanText: 'What is my dog’s name?' }), /about their own life/);
  assert.doesNotMatch(conversationMove({ dateId: 'mira', humanText: 'What is your sister’s name?' }), /about their own life/);
  const move = conversationMove({ dateId: 'dev', humanText: 'What do you do?' });
  assert.match(move, /They asked you “What do you do\?”/);
  assert.match(move, /first sentence/); assert.match(move, /bicycle mechanic/);
});

test('short answers ask the date to carry the talk, more firmly once the date has been doing the asking', () => {
  const first = conversationMove({ dateId: 'mira', humanText: 'yeah', recentDelivered: [date('Hi there.')] });
  assert.match(first, /Short answer/);
  const streak = conversationMove({ dateId: 'mira', humanText: 'not really', previousHuman: ['fine'], recentDelivered: [date('How was work?'), date('Busy day?')] });
  assert.match(streak, /stop interviewing/);
  assert.equal(conversationMove({ dateId: 'mira', humanText: 'what does that mean', clarifying: true }), '', 'a clarification keeps its own instruction');
});

test('a flirt is answered as the date actually feels, and guarded or romance-closed dates are not told to encourage it', () => {
  assert.match(conversationMove({ dateId: 'jules', humanText: 'You are really cute.' }), /react in the moment/);
  assert.match(conversationMove({ dateId: 'jules', humanText: 'You are really cute.', guarded: true }), /without encouraging/);
  assert.match(conversationMove({ dateId: 'jules', humanText: 'You are really cute.', romanceClosed: true }), /without encouraging/);
});

test('the Solo note carries the move next to the human’s words and the prompt asks for direct answers', () => {
  const scene = { id: 'x', dateId: 'mira', mode: 'ai-date', phase: 'playing', stage: 'seated', seated: true, elapsed: 120, order: null, memory: '', evening: createEvening('mira') } as unknown as DinnerState;
  const note = turnNote({ scene, dateName: 'Mira', humanText: 'Where do you live?', tableNow: 'You are at your table together.', memory: '', facts: [], agenda: null, boundaries: { boundaries: [] }, avoid: [] });
  const said = note.indexOf('The human just said'), move = note.indexOf('They asked you');
  assert.ok(said >= 0 && move > said, 'the move follows the human’s words');
  assert.match(note, /flat above a bakery/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /direct question gets a direct answer in your first sentence/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /half of this conversation/);
  assert.match(soloSystem({ dateId: 'mira', blindDate: undefined, model: 'claude-haiku-5-5' }), /everyday facts are plain answers when asked/);
});

test('ending the date gives a verdict from what the pair earned, without a scripted goodbye', async () => {
  const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
  const { DinnerScene } = await import('../server/restaurant/scene');
  await RAPIER.init();
  const reply = { utterances: [date('Ha, fair.')], emotion: 'warm' as const, action: 'none' as const, memory: 'HUMAN: nothing yet\nTOLD THEM: nothing\nOPEN: nothing pending' };
  const ended = (setup: (scene: InstanceType<typeof DinnerScene>) => void) => {
    const scene = new DinnerScene('mira', 1);
    try { setup(scene); scene.command({ type: 'finish' }); return scene.snapshot(); } finally { scene.free(); }
  };
  const quick = ended(() => {});
  assert.equal(quick.phase, 'ended'); assert.equal(quick.evening.farewell.ending?.kind, 'early-exit');
  assert.equal(quick.evening.farewell.ending?.dateLine, '', 'no authored line is put in the date’s mouth');
  const friendly = ended(scene => { for (let i = 1; i <= 4; i++) { scene.state.generation = i; scene.applyTurn(reply, `Tell me more, part ${i}.`); } });
  assert.equal(friendly.evening.farewell.ending?.kind, 'new-friend');
  const sparks = ended(scene => {
    const first = { ...date('You are making me smile too.'), emotion: 'flirtatious' as const }, second = { ...date('I would like to keep talking with you.'), emotion: 'flirtatious' as const };
    scene.state.generation = 1; scene.applyTurn({ ...reply, utterances: [first], emotion: 'flirtatious' }, 'I really like your smile.'); scene.acknowledge(first);
    scene.state.generation = 2; scene.applyTurn({ ...reply, utterances: [second], emotion: 'flirtatious' }, 'I would enjoy seeing you again.'); scene.acknowledge(second);
    scene.state.generation = 3; scene.applyTurn(reply, 'This has been great.');
  });
  assert.equal(sparks.evening.farewell.ending?.kind, 'another-evening');
  assert.match(sparks.evening.farewell.ending!.title, /Another evening/);
});
