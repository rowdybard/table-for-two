// The per-turn note and everything that feeds it (server/restaurant/turn-note.ts, memory.ts and the lower half of
// dialogue-policy.ts): what the date model is told about the human's words, the table, its own notebook and how
// the words arrived. Unit tests pin the wording; the HTTP tests pin that the Solo route wires it up.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { attachRestaurantServer, type ClaudeAdapter, type RestaurantOptions } from '../server/restaurant';
import type { ClaudeRequest } from '../server/restaurant/providers';
import { EveningDirector } from '../server/restaurant/evening';
import { MEMORY_HARD, MEMORY_REJECT, MEMORY_TARGET, clampMemory } from '../server/restaurant/memory';
import { TRIMMED_NOTE, START_NOTE, alternatingMessages, humanVoice, replyShapeHint, tableNow } from '../server/restaurant/dialogue-policy';
import { NOTES_EMPTY, QUIET_GAP_SECONDS, clarificationNudge, conversationMessages, deliveryLabel, heardPrefix, hintTurn, renderHistory, serviceFacts, turnNote, type AgendaPrompt, type TurnNoteInput } from '../server/restaurant/turn-note';
import { createEvening } from '../src/restaurant/evening';
import { DATES } from '../src/restaurant/content';
import type { DateId, DinnerCommand, DinnerState, SceneTurn, SceneUtterance, TurnEvent } from '../src/restaurant/types';
import { humanLine, noteOf, privateAgenda, recordedAtTable, rightNow, section } from './helpers/turn-note';

/* ------------------------------------------------------------------ fixtures */

function scene(dateId: DateId = 'mira'): DinnerState {
  return { id: 'turn-note', generation: 1, mode: 'ai-date', phase: 'playing', dateId, stage: 'arrival', elapsed: 0,
    participants: [], seated: false, order: null, glassRaised: false, emotion: 'neutral', events: [], memory: '', sessionLimit: 2,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null },
    evening: createEvening(dateId) };
}
function seated(state = scene()): DinnerState {
  state.seated = true; state.stage = 'ordered'; state.order = 'Wild mushroom risotto';
  state.evening.main.status = 'waiting'; state.evening.main.dateDish = 'Roasted tomato rigatoni';
  return state;
}
const agenda = (over: Partial<AgendaPrompt> = {}): AgendaPrompt => ({ goal: 'You want to find out whether they really listen.', naturalHint: 'Ask what their week was like.', rubric: { noticed: 'They pick up a detail you let slip.', understood: 'They say back what it meant.', respected: 'They leave it alone when you pull back.' }, nextMilestone: 'noticed', evidenceReady: false, confidence: 'cautious', heardClues: [], ...over });
function input(over: Partial<TurnNoteInput> = {}): TurnNoteInput {
  const state = over.scene ?? scene();
  return { scene: state, dateName: 'Mira', humanText: HUMAN, tableNow: tableNow(state, 'Mira'), memory: '', facts: [], agenda: agenda(), boundaries: { boundaries: [] }, avoid: [], ...over };
}
const HUMAN = 'I teach primary school and I have done for about nine years now.';
const line = (text: string, speaker: SceneUtterance['speaker'] = 'date'): SceneUtterance => ({ speaker, text, emotion: 'warm' });
const stored = (...lines: { speaker: string; text: string; delivery: string; playedSeconds?: number }[]) => ({ role: 'assistant' as const, content: JSON.stringify({ spokenResponse: lines.map(item => ({ playedSeconds: 0, ...item })) }) });

/* ------------------------------------------------------------------ perspective */

test('a human who is the subject of server narration gets the verb that goes with a name, and an object keeps the verb it had', () => {
  const say = (text: string) => humanVoice(text, 'Mira', 'Alex');
  assert.equal(say('Mira asks what you feel comfortable sharing.'), 'Mira asks what Alex feels comfortable sharing.');
  assert.equal(say('There is a small pause before you decide what belongs where.'), 'There is a small pause before Alex decides what belongs where.');
  assert.equal(say('The joke stays affectionate if you let them decide.'), 'The joke stays affectionate if Alex lets them decide.');
  assert.equal(say('A friendly table, if that is something you want too.'), 'A friendly table, if that is something Alex wants too.');
  assert.equal(say('Once you are alone, you can talk. Neither of you minds.'), 'Once Alex is alone, Alex can talk. Neither of them minds.');
  assert.equal(say('What would help you feel comfortable?'), 'What would help Alex feel comfortable?', 'an object keeps the plain verb');
  assert.equal(say('She lets you decide, and the glance she gives you is a question.'), 'She lets Alex decide, and the glance she gives Alex is a question.');
  assert.equal(say('Do you want to share?'), 'Do Alex want to share?', 'an inverted question is left alone rather than half-converted');
  assert.equal(humanVoice('Once you try it, you decide.', 'Mira'), 'Once the human tries it, the human decides.');
  assert.equal(say('“Thank you,” she says. Thanks, you were kind.'), '“Thank you,” she says. Thanks, Alex was kind.', 'a thank-you is left as spoken');
});
test('server copy written to the player is rewritten so the date model never reads the human’s acts as its own', () => {
  assert.equal(humanVoice('You returned the risotto.', 'Mira'), 'The human returned the risotto.');
  assert.equal(humanVoice('Your date notices before you do.', 'Mira'), 'Mira notices before the human does.');
  assert.equal(humanVoice('You have only just met.', 'Mira'), 'The human and Mira have only just met.');
  assert.equal(humanVoice('You’re late, and you’ve eaten; you’ll stay if you don’t mind.', 'Mira'), 'The human is late, and the human has eaten; the human will stay if the human doesn’t mind.');
  assert.equal(humanVoice('Your glass is yours.', 'Mira'), 'The human’s glass is the human’s.');
  assert.equal(humanVoice('Thank you for asking: you were kind.', 'Mira'), 'Thank you for asking: the human was kind.', 'a colon does not start a sentence');
  assert.equal(humanVoice('She thanks you for the wine, and Mira sees you smile.', 'Mira'), 'She thanks the human for the wine, and Mira sees the human smile.', 'someone thanking them is about them; only a spoken thank-you is left alone');
  assert.equal(humanVoice('I thank you for coming.', 'Mira'), 'I thank you for coming.');
  assert.equal(humanVoice('You: Asked Eli for fresh water.', 'Mira'), 'The human: Asked Eli for fresh water.');
  assert.equal(humanVoice('Eli asks, "You alright?"', 'Mira'), 'Eli asks, "The human alright?"', 'a quoted line still opens a sentence');
});
test('a named human replaces “the human” everywhere, including possessives and the sentence-start capital', () => {
  assert.equal(humanVoice('You spilled your wine.', 'Dev', 'Alex'), 'Alex spilled Alex’s wine.');
  assert.equal(humanVoice('Your date smiles. You do not mind.', 'Jules', 'Sam'), 'Jules smiles. Sam does not mind.');
  assert.equal(humanVoice('You have only just met.', 'Jules', 'Sam'), 'Sam and Jules have only just met.');
  assert.equal(humanVoice('Yours is the one on the left.', 'Mira', 'Alex'), 'Alex’s is the one on the left.');
});
test('words that merely contain “you” are left alone', () => {
  assert.equal(humanVoice('Young Youssef yodelled.', 'Mira'), 'Young Youssef yodelled.');
  assert.equal(humanVoice('Eli brought the check.', 'Mira'), 'Eli brought the check.');
});

/* ------------------------------------------------------------------ table now */

test('tableNow reports how old the date is and how many replies have been traded', () => {
  const state = scene();
  assert.match(tableNow(state, 'Mira'), /^The date is under a minute old\./);
  state.elapsed = 60; assert.match(tableNow(state, 'Mira'), /The date is about 1 minute old\./);
  state.elapsed = 185; state.evening.dialogueTurns = 1; assert.match(tableNow(state, 'Mira'), /about 3 minutes old\. You have traded 1 reply so far\./);
  state.evening.dialogueTurns = 4; assert.match(tableNow(state, 'Mira'), /traded 4 replies so far/);
});
test('tableNow says whether the human has started eating, but not while an incident owns the table', () => {
  const state = seated(); state.evening.main.status = 'served'; state.evening.main.servedDish = state.order;
  assert.match(tableNow(state, 'Mira'), /The human has not started eating yet\./);
  state.evening.main.bites = 2; assert.match(tableNow(state, 'Mira'), /The human has started eating\./);
  assert.match(tableNow(state, 'Mira', 'Alex'), /Alex has started eating\./);
  state.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 };
  assert.doesNotMatch(tableNow(state, 'Mira'), /eating/);
});
test('tableNow names the human’s own acts and the date’s mood toward them', () => {
  const state = seated();
  assert.match(tableNow(state, 'Mira'), /The human ordered the wild mushroom risotto, Mira ordered the roasted tomato rigatoni; you ordered and are waiting for the food\./);
  assert.match(tableNow(state, 'Mira'), /Mira is still curious about the human so far\./);
  assert.match(tableNow(state, 'Mira', 'Alex'), /Alex ordered the wild mushroom risotto.*Mira is still curious about Alex so far\./);
  state.evening.stance = 'guarded'; state.evening.stanceReason = 'You pushed past a refusal.';
  assert.match(tableNow(state, 'Mira'), /Mira is guarded with the human \(the human pushed past a refusal\)\./);
  state.evening.stance = 'curious'; state.evening.stanceReason = 'You have only just met.';
  assert.doesNotMatch(tableNow(state, 'Mira'), /only just met/, 'the default reason is not repeated');
});
test('after the mains are cleared the date is told dessert is on offer and unchosen, not that nothing is happening', () => {
  const state = seated(); state.evening.main.status = 'finished';
  const now = tableNow(state, 'Mira');
  assert.match(now, /Eli has offered lemon posset, chocolate fondant or strawberries & cream, and nobody has chosen yet\./);
  assert.match(now, /If the human says which they want, treat it as their choice; if they say nothing, Mira will pick one shortly\./);
  state.evening.stance = 'guarded'; assert.doesNotMatch(tableNow(state, 'Mira'), /will pick one shortly/, 'a guarded date does not promise to choose');
  state.evening.stance = 'curious'; state.evening.dessert = { ...state.evening.dessert, choice: 'lemon', status: 'waiting' };
  assert.doesNotMatch(tableNow(state, 'Mira'), /nobody has chosen/);
  state.evening.dessert = { ...state.evening.dessert, choice: null, status: 'none' }; state.evening.bill.requested = true;
  assert.doesNotMatch(tableNow(state, 'Mira'), /nobody has chosen/, 'once the check is out the dessert offer is over');
});
test('the check is reported with its total', () => {
  const state = seated(); state.evening.main.status = 'finished'; state.evening.dessert.status = 'finished';
  state.evening.bill.requested = true; state.evening.bill.totalCents = 4000;
  assert.match(tableNow(state, 'Mira'), /Eli has brought the check \(\$40\.00\)\./);
  state.evening.bill.settlement = 'split'; assert.match(tableNow(state, 'Mira'), /The check has been settled\./);
});

/* ------------------------------------------------------------------ the notebook */

test('the notebook contract: under the hard cap it is kept as written, a blank answer keeps the previous one', () => {
  assert.equal(MEMORY_TARGET, 700); assert.equal(MEMORY_HARD, 700); assert.ok(MEMORY_HARD < MEMORY_REJECT);
  const written = 'HUMAN: teaches primary school; allergic to nuts.\nTOLD THEM: grew up in Leeds.\nOPEN: asked about their sister.';
  assert.equal(clampMemory(written, 'old'), written);
  assert.equal(clampMemory('  \n \r\n', 'HUMAN: kept.'), 'HUMAN: kept.');
  assert.equal(clampMemory('  HUMAN: a  \r\n\n  OPEN: b ', ''), 'HUMAN: a\nOPEN: b', 'lines are trimmed and blank lines dropped');
});
test('an over-long notebook is trimmed instead of rejected, and the human’s facts are the last thing lost', () => {
  const plain = clampMemory('word '.repeat(300).trim());
  assert.ok(plain.length <= MEMORY_HARD && plain.length > MEMORY_HARD - 10, `one paragraph is cut at a word boundary (${plain.length})`);
  assert.equal(clampMemory('x'.repeat(1001)).length, MEMORY_HARD);
  const labelled = clampMemory(`HUMAN: ${'likes pasta, '.repeat(60)}\nTOLD THEM: ${'grew up in Leeds; '.repeat(30)}\nOPEN: ${'asked about work; '.repeat(20)}`);
  assert.ok(labelled.length <= MEMORY_HARD);
  const [human, told, open] = labelled.split('\n');
  assert.ok(human.startsWith('HUMAN: ') && told.startsWith('TOLD THEM: ') && open.startsWith('OPEN: '), 'all three parts survive');
  assert.ok(human.length <= 400 && told.length <= 158 && open.length <= 140);
  assert.ok(human.length > told.length && told.length > open.length, 'what the human said keeps the most room');
  assert.ok(!/[,;]$/.test(human) && !/[,;]$/.test(told) && !/[,;]$/.test(open), 'cuts land on a clause boundary');
});

/* ------------------------------------------------------------------ what was heard */

test('heardPrefix estimates how many words a cut-off line got to, and never claims a whole line', () => {
  const text = 'I really love this little place by the river';
  assert.equal(heardPrefix(text, 1.2), 'I really love');
  assert.equal(heardPrefix(text, .1), 'I', 'at least one word once any audio played');
  assert.equal(heardPrefix(text, 60), 'I really love this little place by the', 'never the last word');
  assert.equal(heardPrefix('Hello', 2), '', 'a one-word line has no honest prefix');
});
test('delivery labels keep their three leading phrases and add the words heard to the partial one', () => {
  const text = 'I really love this little place by the river';
  assert.equal(deliveryLabel(text, { completed: true, playedSeconds: 3 }, false), 'heard completely');
  assert.match(deliveryLabel(text, { completed: false, playedSeconds: 1.2 }, true), /^interrupted partway; they heard roughly “I really love” and nothing after it; do not assume the rest was heard$/);
  assert.match(deliveryLabel('Hello', { completed: false, playedSeconds: 1 }, true), /^interrupted partway; do not assume the whole line was heard$/);
  assert.match(deliveryLabel(text, undefined, true), /^not heard; response was interrupted$/);
  assert.match(deliveryLabel(text, undefined, false), /^awaiting playback; do not assume it was heard$/);
});
test('the transcript the model reads names the speakers, marks only what was not fully heard, and carries no JSON', () => {
  const rendered = renderHistory([
    { role: 'user', content: 'My sister lives in Leeds.' },
    stored(
      { speaker: 'date', text: 'Oh nice, I love Leeds.', delivery: 'heard completely' },
      { speaker: 'waiter', text: 'Can I get you anything?', delivery: 'interrupted partway; they heard roughly “Can I get” and nothing after it; do not assume the rest was heard', playedSeconds: 1.2 },
      { speaker: 'diner', text: 'Lovely evening.', delivery: 'awaiting playback; do not assume it was heard' },
    ),
    stored({ speaker: 'date', text: 'Actually…', delivery: 'interrupted partway; do not assume the whole line was heard', playedSeconds: 0.2 }, { speaker: 'date', text: 'Tell me everything.', delivery: 'not heard; response was interrupted' }),
  ], 'Mira');
  assert.equal(rendered[0].content, 'My sister lives in Leeds.');
  assert.equal(rendered[1].content, ['Mira: Oh nice, I love Leeds.', 'Eli (waiter): Can I get you anything? (cut off: the human heard only “Can I get”)', 'Neighbouring diner: Lovely evening. (still being said)'].join('\n'));
  assert.equal(rendered[2].content, ['Mira: Actually… (cut off: the human heard only the start)', 'Mira: Tell me everything. (the human did not hear this)'].join('\n'));
  assert.ok(rendered.every(entry => !/spokenResponse|playedSeconds|"delivery"/.test(entry.content)));
});
test('entries that are not stored dialogue are passed through untouched', () => {
  const odd = [{ role: 'assistant' as const, content: 'not json' }, { role: 'assistant' as const, content: '{"other":1}' }];
  assert.deepEqual(renderHistory(odd, 'Mira'), odd);
});

/* ------------------------------------------------------------------ message list */

test('the first message is a lead-in only when the history would otherwise start with the date', () => {
  const note = 'Right now: …\n\nThe human just said: “hi”';
  assert.deepEqual(conversationMessages([], false, 'Mira', note), [{ role: 'user', content: note }], 'nothing was heard yet: the note stands alone');
  const opened = conversationMessages([stored({ speaker: 'date', text: 'Hi, you made it.', delivery: 'heard completely' })], false, 'Mira', note);
  assert.deepEqual(opened.map(message => message.role), ['user', 'assistant', 'user']);
  assert.equal(opened[0].content, START_NOTE); assert.equal(opened[1].content, 'Mira: Hi, you made it.');
  assert.deepEqual(alternatingMessages([{ role: 'assistant', content: 'a' }], 'custom lead').map(message => message.content), ['custom lead', 'a']);
});
test('a trimmed window opens with its own note and never reads as the start of the evening', () => {
  const note = 'Right now: …';
  const trimmed = conversationMessages([{ role: 'user', content: 'Where were we?' }, stored({ speaker: 'date', text: 'Leeds.', delivery: 'heard completely' })], true, 'Mira', note);
  assert.deepEqual(trimmed.map(message => message.role), ['user', 'assistant', 'user']);
  assert.equal(trimmed[0].content, `${TRIMMED_NOTE}\nWhere were we?`);
  assert.ok(!trimmed.some(message => message.content.includes(START_NOTE)));
  const fromDate = conversationMessages([stored({ speaker: 'date', text: 'Leeds.', delivery: 'heard completely' })], true, 'Mira', note);
  assert.equal(fromDate[0].content, TRIMMED_NOTE, 'even a window that starts on the date gets the trimmed note, not the opening one');
});

/* ------------------------------------------------------------------ asking about the date's own line */

test('a question about the date’s last line is pointed back at that line', () => {
  const last = 'Honestly, I am just here for the cake gossip and the company.';
  for (const asked of ['What the heck is cake gossip?', 'what do you mean by that', 'Wait, what', 'Huh?', 'What does cake gossip even mean', 'I don’t get it', 'what are you talking about', 'sorry, what?', 'what do you mean by cake gossip', 'whats cake gossip', 'I dont understand that']) {
    const nudge = clarificationNudge(asked, last);
    assert.match(nudge, /asking about your last line \(“Honestly, I am just here for the cake gossip and the company\.”\)/, asked);
    assert.match(nudge, /If it had a plain meaning, say it in one short sentence\. If it made no sense, say so/);
    assert.doesNotMatch(nudge, /admit it was an odd thing/, 'the reply is never steered toward inventing a meaning');
  }
});
test('a clarification still counts with a name, an endearment, an interjection or a second sentence around it', () => {
  const last = 'Wow, that is a lot of people for cake gossip.';
  const asked = [
    'Mira, what do you mean by that?', 'what do you mean babe', 'huh what do you mean', 'oh wait what', 'what do you mean by that? im confused',
    'I don’t follow', 'I still don’t get it', 'I don’t get the joke', 'I’m confused', 'you lost me', 'that makes no sense',
    'what is cake gossip lol', 'what is cake gossip though', 'what is cake gossip again', 'what is cake gossip supposed to mean', 'what is this cake gossip',
    'what do you mean cake gossip', 'what is ‘cake gossip’', 'what do you mean by a lot', 'what the heck is cake gossip',
    'what does that even mean', 'what exactly do you mean', 'what did you just say', 'whats that mean', 'what do you mean by that comment', 'what do you mean by that last bit',
    'baby what do you mean', 'omg what do you mean', 'excuse me what do you mean', 'im sorry what do you mean', 'bruh what',
  ];
  for (const text of asked) assert.match(clarificationNudge(text, last, ['Mira']), /asking about your last line/, text);
  for (const text of ['So what?', 'and what', 'So what, Mira?', 'so what lol', 'so what though', 'ok so what now?', 'what does that cost', 'what did you order', 'what are you drinking', 'what is a good wine here', 'my graduating class was under 70 people']) assert.equal(clarificationNudge(text, last, ['Mira']), '', text);
});
test('ordinary questions and stories get no clarification nudge, with or without a line to point at', () => {
  const last = 'Honestly, I am just here for the cake gossip and the company.';
  const ordinary = [
    'What is that on your plate?', 'What the hell is Leeds like?', 'What are you getting?', 'What do you do for work?', 'What is pasta like here?', 'I teach primary school.',
    'what are you drinking', 'what does the salmon come with', 'what is your sister called', 'what is your favorite cake?', 'what is the company called',
    'That’s weird, I grew up near Dayton too!', 'I don’t get why people like cilantro', 'I don’t understand how anyone watches golf', 'What is good here?', 'Wait, what time is it?',
  ];
  for (const asked of ordinary) assert.equal(clarificationNudge(asked, last), '', asked);
  assert.equal(clarificationNudge('what do you mean by that', undefined), '', 'nothing to point at');
});
test('asking about a phrase needs that phrase in the line they are asking about', () => {
  assert.equal(clarificationNudge('what is cake gossip', 'So where did you grow up?'), '');
  assert.equal(clarificationNudge('what is cake', 'Honestly, I am just here for the cake gossip.') === '', false, 'a contiguous word of the line counts');
  assert.equal(clarificationNudge('what is gossip cake', 'Honestly, I am just here for the cake gossip.'), '', 'but not the same words in another order');
});

/* ------------------------------------------------------------------ reply shape */

test('reply-shape hints come from the human’s length and the date’s last three delivered replies', () => {
  assert.match(replyShapeHint([], 'Yeah, sure.'), /answer in a few words or one short sentence/);
  assert.match(replyShapeHint([], 'word '.repeat(30)), /They told you something real: acknowledge it first/);
  assert.equal(replyShapeHint([], 'I teach primary school and I have done for about nine years now.'), '');
  const same = [line('One thing. Two things.'), line('Another one. And more.'), line('Third reply. Also two.')];
  assert.match(replyShapeHint(same, 'I teach primary school and I have done for about nine years now.'), /Your last three replies were all 2 sentences long: change the shape\./);
  assert.match(replyShapeHint([line('Is that right?'), line('So you like it?'), line('Fine.')], 'I teach primary school and I have done for about nine years now.'), /end this one on a statement/);
  assert.doesNotMatch(replyShapeHint([line('Is that right?'), line('Fine.'), line('Good.')], 'I teach primary school and I have done for about nine years now.'), /statement/, 'one question is not a habit');
});

/* ------------------------------------------------------------------ the note */

test('the table-only note keeps memory, boundaries and the human words without scripted scenes', () => {
  const state = seated(); state.evening.moments.push({ id: 'water', title: 'Water', description: 'You asked Eli for fresh water.' });
  const note = turnNote(input({ scene: state, tableNow: tableNow(state, 'Mira'), memory: 'HUMAN: teaches.', facts: ['You: Offered a taste.'], avoid: ['the weather'], via: 'voice', scenario: { phase: 'active', description: 'An invented interruption.' }, boundaries: { boundaries: [{ topic: 'family', refusal: 'I would rather not talk about family.', delivered: true, disregardCount: 2 }] } }));
  const labels = ['Right now:', 'Your notes (rewrite them into "memory"):', 'Boundaries in play:', 'Do not bring up unprompted:', 'They said this out loud;', 'The human just said:'];
  const at = labels.map(label => note.indexOf(label)); assert.ok(at.every(index => index >= 0)); assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.equal(humanLine(note), HUMAN); assert.doesNotMatch(note, /Eli|invented interruption|Offered a taste|Private to you, not to recite/);
});

test('sections with nothing to say are absent, and an empty notebook says it is empty', () => {
  const note = turnNote(input());
  assert.deepEqual(note.split('\n\n').map(part => part.split(':')[0]), ['Right now', 'Your notes (rewrite them into "memory")', 'The human just said']);
  assert.ok(note.includes(`Your notes (rewrite them into "memory"):\n${NOTES_EMPTY}`), 'an empty notebook is stated, so the model neither invents entries nor reads a missing section as nothing to rewrite');
  for (const label of ['At the table so far', 'Happening now', 'Boundaries in play', 'Do not bring up', 'They said this out loud']) assert.equal(section(note, label), undefined, label);
  assert.equal(section(turnNote(input({ scenario: { phase: 'dormant', description: 'A story that has not started.' } })), 'Happening now'), undefined, 'a dormant story is not mentioned');
  assert.equal(section(turnNote(input({ scenario: { phase: 'resolved', description: 'A story that is over.' } })), 'Happening now'), undefined, 'a resolved story is not "happening now"');
});
test('stale scripted facts do not enter the table-only note', () => {
  const state = scene(); state.evening.moments.push({ id: 'service', title: 'Service', description: 'Eli brought a plate.' });
  const note = turnNote(input({ scene: state, facts: ['A scripted event.'] }));
  assert.doesNotMatch(note, /Eli brought a plate|A scripted event/);
});

test('the human’s line is quoted on one line, whatever whitespace it arrived with', () => {
  const note = turnNote(input({ humanText: '  I teach\n\n primary   school.  ' }));
  assert.equal(humanLine(note), 'I teach primary school.');
  assert.equal(turnNote(input({ human: 'Alex', humanText: 'Hello.' })).split('\n\n').at(-1)!.split('\n')[0], 'Alex just said: “Hello.”');
});
test('the place of the evening, the mood and the chemistry are stated in plain words', () => {
  const state = seated();
  assert.match(rightNow(turnNote(input({ scene: state, tableNow: tableNow(state, 'Mira') }))), /^The date is under a minute old\./);
  state.evening.chemistry = { unlocked: true };
  assert.match(rightNow(turnNote(input({ scene: state, tableNow: tableNow(state, 'Mira') }))), /Mutual chemistry is established between you and the human\./);
  state.evening.care.romanceClosed = true;
  const closed = rightNow(turnNote(input({ scene: state, tableNow: tableNow(state, 'Mira') })));
  assert.match(closed, /Romance is closed tonight; stay friendly and do not flirt\./); assert.doesNotMatch(closed, /chemistry/i, 'a closed romance outranks stored chemistry');
});
test('kitchen and staff facts are phrased for the date, and absent when nothing is going on', () => {
  assert.deepEqual(serviceFacts(undefined, 'Mira'), []);
  assert.deepEqual(serviceFacts({}, 'Mira'), []);
  const facts = serviceFacts({ dinnerHeld: true, table: 'quiet', staff: 'medical', spaceCleared: true, alcoholStopped: true, contactRequested: true, cleanup: { wine: 'clean', glassesCleared: true }, extraOrder: [{ dish: 'Garlic Bread', quantity: 3, status: 'pending' }] }, 'Mira');
  assert.deepEqual(facts, ['The kitchen is holding dinner for now.', 'You have moved to a quieter part of the restaurant.', 'Eli and the staff are helping Mira with a medical need.', 'The space around the table has been cleared.', 'No more alcohol is being served.', 'Someone has been contacted to help.', 'The spilled wine has been cleaned up.', 'The glasses have been cleared.', 'Mira ordered extra dishes: 3 garlic bread (still cooking).']);
  const state = seated();
  assert.doesNotMatch(rightNow(turnNote(input({ scene: state, tableNow: tableNow(state, 'Mira'), mechanics: { dinnerHeld: true } }))), /kitchen|holding dinner/);
});

/* ------------------------------------------------------------------ the private agenda */

test('private agenda hints and hidden scores are absent from the table-only prompt', () => {
  const note = turnNote(input({ agenda: agenda({ evidenceReady: true, heardClues: ['A hidden clue.'], confidence: 'earned' }) }));
  assert.doesNotMatch(note, /Private to you, not to recite|hidden clue|earned your trust|signal "noticed"/i);
});
test('boundaries say what was actually heard; a refusal still being said is not yet in force', () => {
  const note = turnNote(input({ boundaries: { boundaries: [
    { topic: 'family', refusal: 'Let’s not do family.', delivered: true, disregardCount: 0 },
    { topic: 'exes', refusal: 'I do not discuss exes.', delivered: true, disregardCount: 1 },
    { topic: 'money', refusal: 'Money is private.', delivered: true, disregardCount: 3 },
    { topic: 'work', refusal: 'Not work.', delivered: false, disregardCount: 0, pendingRefusal: 'Not work, please.' },
  ] } }));
  assert.equal(section(note, 'Boundaries in play'), [
    '- family: they heard you say “Let’s not do family.”.',
    '- exes: they heard you say “I do not discuss exes.” and have disregarded it once.',
    '- money: they heard you say “Money is private.” and have disregarded it 3 times.',
    '- work: you started to say “Not work, please.”, but they have not heard it, so it is not in force yet.',
  ].join('\n'));
});

/* ------------------------------------------------------------------ how the words arrived */

const after = (note: string) => note.split('\n\n').at(-1)!.split('\n').slice(1).join('\n');
test('a spoken turn says it is a recognizer transcript; a typed one does not', () => {
  assert.match(turnNote(input({ via: 'voice' })), /They said this out loud; it is an automatic transcript from a small on-device recognizer and can contain mishearings\./);
  assert.doesNotMatch(turnNote(input({ via: 'typed' })), /recognizer/);
  assert.doesNotMatch(turnNote(input()), /recognizer/, 'a client that does not say is not assumed to have spoken');
});
test('talking over the date is described with the words they probably heard', () => {
  const flow = { talkedOver: { heard: 'I really love' } };
  assert.equal(after(turnNote(input({ via: 'voice', flow }))), 'They started talking while you were still speaking; you were cut off after “I really love”.');
  assert.equal(after(turnNote(input({ via: 'typed', flow }))), 'They replied while you were still speaking; you were cut off after “I really love”.', 'typing is not talking over');
  assert.equal(after(turnNote(input({ via: 'voice', flow: { talkedOver: { heard: '' } } }))), 'They started talking while you were still speaking, right at the start of your line.');
});
test('a human who kept talking is told so; a typist who simply answered later is not', () => {
  const flow = { keptTalking: true };
  assert.equal(after(turnNote(input({ via: 'voice', flow }))), 'They kept talking before your last reply reached them; treat this as the continuation of their previous message.');
  assert.equal(after(turnNote(input({ via: 'typed', flow }))), '');
});
test('a long quiet is mentioned coarsely, and a question the date left hanging is what the next words probably answer', () => {
  assert.equal(after(turnNote(input({ flow: { quietSeconds: 25 } }))), 'It was quiet for about 25 seconds after your last line before they spoke.');
  assert.match(after(turnNote(input({ flow: { quietSeconds: 90 } }))), /It was quiet for a minute or two after/);
  assert.match(after(turnNote(input({ flow: { quietSeconds: 400 } }))), /It was quiet for a long while after/);
  assert.equal(after(turnNote(input({ flow: {} }))), '');
  assert.equal(after(turnNote(input({ flow: { pendingQuestion: 'Eli just left. So, what do you do for work?' } }))), 'You asked them “So, what do you do for work?” a little while ago and have not had an answer. If what they say next is not an answer, just respond to what they said.');
  assert.match(after(turnNote(input({ flow: { pendingQuestion: 'Say anything at all.' } }))), /You asked them “Say anything at all\.” a little while ago/, 'a scripted aside with no question mark is quoted whole');
  assert.equal(after(turnNote(input({ flow: { pendingQuestion: null } }))), '');
});
test('a request to clarify and the reply-shape hints trail the human’s words', () => {
  const note = turnNote(input({ humanText: 'what do you mean by that', flow: { lastDateLine: 'I am only here for the cake gossip.' }, recentDelivered: [line('Is that right?'), line('So you like it?'), line('Really?')] }));
  const trailing = after(note).split('\n');
  assert.match(trailing[0], /They seem to be asking about your last line/);
  assert.match(trailing.at(-1)!, /They said very little/);
  assert.match(after(note), /end this one on a statement/);
});

/* ------------------------------------------------------------------ the test helpers */

test('the note readers find a section by the paragraph it opens, not by words that appear inside another', () => {
  const note = 'Right now: Happening right now: a spill.\n\nHappening now: the door.\n\nThe human just said: “hi”';
  assert.equal(section(note, 'Happening now'), 'the door.');
  assert.equal(section(note, 'Nothing here'), undefined);
  assert.equal(rightNow(note), 'Happening right now: a spill.');
});

/* ------------------------------------------------------------------ the Solo route */

const neutral = { signal: 'none' as const, reason: 'No boundary change.', wantsToLeave: false };
const REPLY_LINE = 'I really love this little place by the river, honestly.';
const reply = (over: Partial<SceneTurn> = {}): SceneTurn => ({ utterances: [{ speaker: 'date', text: REPLY_LINE, emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'HUMAN: teaches primary school.', social: neutral, agenda: { signal: 'none', evidence: '', clue: '' }, ...over });
const decode = (text: string) => text.trim().split('\n').filter(Boolean).map(item => JSON.parse(item) as TurnEvent);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function until<T>(read: () => T | Promise<T>, valid: (value: T) => boolean, timeout = 4000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) { const value = await read(); if (valid(value)) return value; if (Date.now() > end) throw new Error('The expected test state did not arrive.'); await delay(10); }
}
function recorder(make: (call: number) => SceneTurn = () => reply()) {
  const requests: ClaudeRequest[] = [];
  const claude: ClaudeAdapter = { async *stream(request) { requests.push(structuredClone(request)); yield { type: 'text', text: JSON.stringify(make(requests.length)) }; } };
  return { claude, requests };
}

async function boot(claude: ClaudeAdapter, options: RestaurantOptions = {}) {
  let clock = 1_000_000;
  const http = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  const app = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, ledgerPath: false, autoTick: false, now: () => clock, claude, requestTimeoutMs: 5000, ...options });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  async function start() {
    const created = await fetch(base + '/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateId: 'mira' }) }).then(response => response.json());
    const path = `${base}/api/date/sessions/${created.state.id}`;
    const request = (suffix: string, value?: unknown) => fetch(path + suffix, { method: value === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${created.token}`, ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const snapshot = async () => (await (await request('')).json()).state as DinnerState;
    let n = 0;
    const api = {
      state: created.state as DinnerState, request, snapshot,
      command: (value: DinnerCommand) => request('/command', value),
      /** One completed human turn. Returns the NDJSON events and the generation the reply came in. */
      async turn(text: string, extra: Record<string, unknown> = {}) {
        const response = await request('/turn', { turnId: `t${++n}`, text, model: 'claude-haiku-5-5', ...extra });
        const body = await response.text();
        return { status: response.status, body, events: response.status === 200 ? decode(body) : [], generation: (response.status === 200 ? decode(body).find(event => event.type === 'start') : undefined)?.generation as number };
      },
      interrupt: () => request('/interrupt', {}),
      hear: (generation: number, text: string, completed: boolean, playedSeconds: number, speaker = 'date') => request('/playback', { generation, speaker, text, completed, playedSeconds }),
      advance: (ms: number) => { clock += ms; },
    };
    return api;
  }
  return { start, async close() { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}

test('a notebook over the hard cap completes the turn with a trimmed notebook', async t => {
  const long = `HUMAN: ${'likes long walks and quiet bars, '.repeat(40)}`.slice(0, 1001);
  assert.equal(long.length, 1001, 'valid oversize memory must be trimmed without rejecting the reply');
  const { claude, requests } = recorder(call => reply({ memory: call === 1 ? long : 'HUMAN: short again.' }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('I walk a lot.');
  assert.ok(first.events.some(event => event.type === 'done'), 'the turn completed'); assert.ok(!first.events.some(event => event.type === 'error'));
  const kept = (await api.snapshot()).memory;
  assert.ok(kept.length <= MEMORY_HARD && kept.startsWith('HUMAN: likes long walks'), `the notebook is the model’s, trimmed (${kept.length})`);
  await api.turn('And you?');
  assert.equal(section(noteOf(requests[1]), 'Your notes (rewrite them into "memory")'), kept, 'the next turn is shown the stored, trimmed notebook');
  assert.equal((await api.snapshot()).memory, 'HUMAN: short again.');
});

test('notebook disclosures wait for complete delivery and old receipts cannot roll back corrections', async t => {
  const firstMemory = 'HUMAN: name Sam.\nTOLD THEM: six prints.\nOPEN: promised to show a print.';
  const corrected = 'HUMAN: name Nia.\nTOLD THEM: six prints; bakery story.\nOPEN: promised to show a print; shared premise: bakery.';
  const { claude, requests } = recorder(call => reply({ memory: call === 1 ? firstMemory : corrected }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('My name is Sam.');
  assert.equal((await api.snapshot()).memory, 'HUMAN: name Sam.');
  await api.hear(first.generation, REPLY_LINE, false, .2);
  assert.equal((await api.snapshot()).memory, 'HUMAN: name Sam.');
  await api.hear(first.generation, REPLY_LINE, true, 1);
  assert.equal((await api.snapshot()).memory, firstMemory);
  const second = await api.turn('Actually, my name is Nia.');
  assert.equal((await api.snapshot()).memory, 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised to show a print.');
  await api.turn('Please drop the joke.');
  await api.hear(second.generation, REPLY_LINE, true, 1);
  const memory = (await api.snapshot()).memory;
  assert.match(memory, /name Nia/); assert.doesNotMatch(memory, /bakery story|shared premise/);
  assert.match(noteOf(requests[2]), /name Nia/); assert.doesNotMatch(noteOf(requests[2]), /shared premise: bakery/);
});

test('an early caption receipt commits the validated notebook when the rest of the response arrives', async t => {
  const gate = deferred();
  const claude: ClaudeAdapter = { async *stream() {
    const text = JSON.stringify(reply({ memory: 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised a print.' }));
    const end = text.indexOf('],"emotion"');
    yield { type: 'text', text: text.slice(0, end) };
    await gate.promise;
    yield { type: 'text', text: text.slice(end) };
  } };
  const server = await boot(claude); t.after(() => { gate.resolve(); return server.close(); }); const api = await server.start();
  const response = await api.request('/turn', { turnId: 'early-receipt', text: 'I am Nia.', model: 'claude-haiku-5-5' });
  assert.ok(response.body); const reader = response.body.getReader(), decoder = new TextDecoder(); let received = '';
  while (!received.includes('"type":"utterance"')) { const part = await reader.read(); assert.equal(part.done, false); received += decoder.decode(part.value, { stream: true }); }
  const start = decode(received).find(event => event.type === 'start'); assert.ok(start && start.type === 'start');
  await api.hear(start.generation, REPLY_LINE, true, 0);
  assert.equal((await api.snapshot()).memory, '', 'a receipt cannot commit unvalidated bookkeeping');
  gate.resolve(); while (!(await reader.read()).done) { /* drain the real event stream */ }
  assert.match((await api.snapshot()).memory, /TOLD THEM: six prints/);
});

test('indistinguishable repeated Solo lines cannot use one receipt as proof that both were heard', async t => {
  const line = { speaker: 'date' as const, text: REPLY_LINE, emotion: 'warm' as const };
  const { claude } = recorder(() => reply({ utterances: [line, line], memory: 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised a print.' }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('I am Nia.'); await api.hear(first.generation, REPLY_LINE, true, 1);
  assert.equal((await api.snapshot()).memory, 'HUMAN: name Nia.');
});

test('a stop retires the shared premise even if the provider fails', async t => {
  let call = 0;
  const claude: ClaudeAdapter = { async *stream() {
    call++;
    if (call === 2) throw new Error('offline fixture failure');
    yield { type: 'text', text: JSON.stringify(reply({ memory: 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised to show a print; shared premise: bakery.' })) };
  } };
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('I am Nia.'); await api.hear(first.generation, REPLY_LINE, true, 1);
  const failed = await api.turn('Please drop the joke.'); assert.ok(failed.events.some(event => event.type === 'error'));
  const memory = (await api.snapshot()).memory;
  assert.match(memory, /name Nia/); assert.match(memory, /six prints/); assert.match(memory, /promised/); assert.doesNotMatch(memory, /shared premise/);
});
test('a runaway notebook is an invalid response and leaves the stored notebook alone', async t => {
  const { claude } = recorder(call => reply({ memory: call === 2 ? 'x'.repeat(MEMORY_REJECT + 1) : `HUMAN: note ${call}.` }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  await api.turn('First.'); assert.equal((await api.snapshot()).memory, 'HUMAN: note 1.');
  const bad = await api.turn('Second.');
  assert.ok(bad.events.some(event => event.type === 'error' && event.code === 'invalid_dialogue'));
  assert.equal((await api.snapshot()).memory, 'HUMAN: note 1.');
});

test('the optional via field is validated, shown to the model, and does not change what counts as the same turn', async t => {
  const { claude, requests } = recorder();
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const bad = await api.turn('Hello there.', { via: 'carrier-pigeon' });
  assert.equal(bad.status, 400); assert.equal(JSON.parse(bad.body).code, 'invalid_turn'); assert.equal(requests.length, 0, 'an unknown value never reaches the provider');
  const spoken = await api.turn('Hello there.', { turnId: 'same', via: 'voice' });
  assert.equal(spoken.status, 200); assert.match(noteOf(requests[0]), /They said this out loud; it is an automatic transcript/);
  const retry = await api.request('/turn', { turnId: 'same', text: 'Hello there.', model: 'claude-haiku-5-5', via: 'typed' });
  assert.equal(retry.status, 200); await retry.text();
  assert.equal(requests.length, 1, 'the same turn ID with the same words is a retry whichever way it says it arrived');
  const conflict = await api.request('/turn', { turnId: 'same', text: 'Different words.', model: 'claude-haiku-5-5', via: 'voice' });
  assert.equal(conflict.status, 409);
  await api.turn('Typed this one.', { via: 'typed' }); await api.turn('No idea how this arrived.');
  assert.doesNotMatch(noteOf(requests[1]), /recognizer/); assert.doesNotMatch(noteOf(requests[2]), /recognizer/);
});

test('the note says whether the human talked over the date, kept talking, or answered after a silence', async t => {
  const { claude, requests } = recorder();
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('Hi, I am Sam.', { via: 'voice' });
  await api.interrupt();
  await api.turn('Sorry, did you say something?', { via: 'voice' });
  assert.match(after(noteOf(requests[1])), /They kept talking before your last reply reached them/, 'a spoken reply that never played was not heard');
  assert.match(humanLine(noteOf(requests[1])), /did you say something/);
  await api.interrupt();
  await api.turn('Typing this instead.', { via: 'typed' });
  assert.doesNotMatch(noteOf(requests[2]), /kept talking|started talking|They replied/, 'a typed answer to a line never played is just an answer');
  const third = await api.turn('Here is another typed one.', { via: 'typed' });
  assert.equal((await api.hear(third.generation, REPLY_LINE, false, 1.2)).status, 200);
  await api.interrupt();
  await api.turn('Oh, sorry to cut in.', { via: 'typed' });
  assert.match(after(noteOf(requests[4])), /^They replied while you were still speaking; you were cut off after “I really love”\.$/m);
  const fourth = await api.turn('And one more.', { via: 'voice' });
  assert.equal((await api.hear(fourth.generation, REPLY_LINE, false, 1.2)).status, 200);
  await api.interrupt();
  await api.turn('Sorry, I was saying — ', { via: 'voice' });
  assert.match(after(noteOf(requests[6])), /^They started talking while you were still speaking; you were cut off after “I really love”\.$/m);
  assert.doesNotMatch(noteOf(requests[6]), /kept talking/);
  const fifth = await api.turn('Go on then.', { via: 'voice' });
  assert.equal((await api.hear(fifth.generation, REPLY_LINE, true, 3.4)).status, 200);
  await api.interrupt();
  await api.turn('That is lovely.', { via: 'voice' });
  assert.equal(after(noteOf(requests[8])).includes('kept talking') || after(noteOf(requests[8])).includes('cut off'), false, 'a reply that was heard in full leaves nothing to say');
  assert.ok(first.generation >= 1);
});
test('a quiet gap is reported only when 20 seconds or more passed since the last line finished playing', async t => {
  assert.equal(QUIET_GAP_SECONDS, 20);
  const { claude, requests } = recorder();
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const noteAt = (index: number) => noteOf(requests[index]);
  const first = await api.turn('Hello.', { via: 'voice' });
  assert.equal(noteAt(0).includes('It was quiet'), false, 'nothing has been heard yet');
  await api.hear(first.generation, REPLY_LINE, true, 3); api.advance(30_000); await api.interrupt();
  const second = await api.turn('Sorry, I got distracted.', { via: 'voice' });
  assert.match(noteAt(1), /It was quiet for about 30 seconds after your last line before they spoke\./);
  await api.hear(second.generation, REPLY_LINE, true, 3); api.advance(3_000); await api.interrupt();
  const third = await api.turn('Quick one.', { via: 'voice' });
  assert.equal(noteAt(2).includes('It was quiet'), false, 'three seconds is just taking turns');
  await api.hear(third.generation, REPLY_LINE, true, 3); api.advance(300_000);
  assert.equal((await api.command({ type: 'pause', paused: true })).status, 200); assert.equal((await api.command({ type: 'pause', paused: false })).status, 200);
  await api.interrupt(); await api.turn('Back again.', { via: 'voice' });
  assert.equal(noteAt(3).includes('It was quiet'), false, 'time spent paused is not a quiet table');
});
test('a caption-only player, whose receipts report no audio, still gets the same flow notes', async t => {
  const { claude, requests } = recorder();
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const first = await api.turn('Hello.', { via: 'typed' });
  await api.hear(first.generation, REPLY_LINE, true, 0); api.advance(45_000); await api.interrupt();
  await api.turn('Sorry, back.', { via: 'typed' });
  assert.match(noteOf(requests[1]), /It was quiet for about 45 seconds/);
  assert.equal(after(noteOf(requests[1])).includes('cut off'), false);
});

test('a question left hanging by a scripted aside is carried into the note', async t => {
  const original = Object.getOwnPropertyDescriptor(EveningDirector.prototype, 'pendingQuestion')!;
  Object.defineProperty(EveningDirector.prototype, 'pendingQuestion', { configurable: true, get: () => 'Eli went to fetch the menus. Shall we share the lemon posset?' });
  t.after(() => Object.defineProperty(EveningDirector.prototype, 'pendingQuestion', original));
  const { claude, requests } = recorder();
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  await api.turn('Sure, why not.', { via: 'voice' });
  assert.match(after(noteOf(requests[0])), /You asked them “Shall we share the lemon posset\?” a little while ago and have not had an answer\./);
});
test('the director is told when the human spoke and when the date’s reply ended, and not for a reply that was replaced', async t => {
  const proto = EveningDirector.prototype, spoken: string[] = []; let ended = 0;
  const noteHuman = proto.noteHumanTurn, replyEnded = proto.replyEnded;
  proto.noteHumanTurn = function (this: EveningDirector, text?: string) { spoken.push(text ?? ''); return noteHuman.call(this, text); };
  proto.replyEnded = function (this: EveningDirector) { ended++; return replyEnded.call(this); };
  t.after(() => { proto.noteHumanTurn = noteHuman; proto.replyEnded = replyEnded; });
  const ready = deferred(), release = deferred(); let calls = 0;
  const claude: ClaudeAdapter = { async *stream(_request, signal) {
    calls++;
    if (calls === 1) { ready.resolve(); await release.promise; if (signal.aborted) return; }
    yield { type: 'text', text: JSON.stringify(reply()) };
  } };
  const server = await boot(claude); t.after(() => { release.resolve(); return server.close(); }); const api = await server.start();
  const held = api.request('/turn', { turnId: 'held', text: 'This one will be replaced.', model: 'claude-haiku-5-5' }).then(response => response.text());
  await ready.promise;
  assert.deepEqual(spoken, ['This one will be replaced.'], 'the director hears the human as soon as the turn is accepted');
  assert.equal(ended, 0, 'a reply still being written has not ended');
  await api.interrupt(); release.resolve(); await held;
  await delay(30);
  assert.equal(ended, 1, 'an interrupted reply ends the wait for it exactly once, so the evening is not held quiet for a line that will never arrive');
  await api.turn('Second go.');
  await until(() => ended, count => count === 2);
  assert.deepEqual(spoken, ['This one will be replaced.', 'Second go.']);
});

test('the conversation begins with the human rather than a scripted welcome', async t => {
  const { claude, requests } = recorder(); const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  assert.deepEqual(api.state.evening.cues, []); await api.turn('Hi there.');
  assert.equal(requests[0].messages.length, 1); assert.equal(requests[0].messages[0].role, 'user');
  assert.match(requests[0].messages[0].content, /Hi there/); assert.doesNotMatch(requests[0].messages[0].content, /Eli|welcome/);
});
test('a scripted opening is not authorized for voice before a generated line', async t => {
  const { claude } = recorder(); const server = await boot(claude, { env: {}, speech: { async *stream() { yield Buffer.from('opening-audio'); } } }); t.after(() => server.close());
  const api = await server.start(), opening = { speaker: 'date', text: DATES[0].opening, emotion: 'neutral' };
  assert.equal((await api.request('/speech', { generation: 0, utterance: opening })).status, 400);
});

test('the transcript window holds sixty entries, starts on the human, and says when older talk is not shown', async t => {
  const { claude, requests } = recorder(call => reply({ utterances: [{ speaker: 'date', text: `${REPLY_LINE} (${call})`, emotion: 'warm' }] }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  for (let i = 1; i <= 36; i++) await api.turn(`Human remark number ${i}.`);
  const early = requests[9].messages;
  assert.ok(!early.some(message => message.content.includes(TRIMMED_NOTE)), 'a young evening is not marked trimmed');
  assert.equal(early[0].content, 'Human remark number 1.', 'while the whole evening fits, it starts at the first human turn');
  assert.ok(early.some(message => message.content.startsWith('Human remark number 1.')));
  const last = requests.at(-1)!.messages, history = last.slice(0, -1);
  assert.ok(history.length <= 60, `at most sixty entries (${history.length})`);
  assert.equal(last[0].role, 'user'); assert.ok(last[0].content.startsWith(TRIMMED_NOTE), 'the window says it is a window');
  assert.ok(last.every((message, index) => index === 0 || message.role !== last[index - 1].role), 'roles alternate');
  assert.equal(last.at(-1)!.role, 'user'); assert.ok(last.at(-1)!.content.startsWith('Right now: '));
  const text = last.map(message => message.content).join('\n');
  assert.ok(!text.includes('Human remark number 1.') && !text.includes('Human remark number 2.'), 'the oldest talk has gone');
  assert.ok(text.includes('Human remark number 35.') && text.includes, 'the newest exchange is verbatim');
  assert.ok(text.indexOf(TRIMMED_NOTE) === text.lastIndexOf(TRIMMED_NOTE), 'the note appears once');
});
test('long speeches hit the byte cap before the entry cap, so a window never grows without bound', async t => {
  const { claude, requests } = recorder(call => reply({ utterances: [{ speaker: 'date', text: `${REPLY_LINE} (${call})`, emotion: 'warm' }] }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  const speech = (i: number) => `Speech ${i}: ${'and then I kept going about the river, '.repeat(36)}`.slice(0, 1500);
  for (let i = 1; i <= 24; i++) assert.equal((await api.turn(speech(i))).status, 200);
  const last = requests.at(-1)!.messages, history = last.slice(0, -1);
  assert.ok(history.length < 40, `the byte cap binds well before sixty entries (${history.length})`);
  assert.ok(history.reduce((total, message) => total + message.content.length, 0) <= 20_000, 'the window is within the byte budget');
  assert.equal(last[0].role, 'user'); assert.ok(last[0].content.startsWith(TRIMMED_NOTE));
  assert.ok(!last.map(message => message.content).join('\n').includes('Speech 1:'));
  assert.ok(last.map(message => message.content).join('\n').includes('Speech 23:'));
});

test('successive model notebooks survive without adding scripted table facts', async t => {
  const { claude, requests } = recorder(call => reply({ memory: `HUMAN: rewrite ${call}.` }));
  const server = await boot(claude); t.after(() => server.close()); const api = await server.start();
  await api.turn('I like books.'); await api.turn('Where were we?');
  assert.equal(section(noteOf(requests[1]), 'Your notes'), 'HUMAN: rewrite 1.');
  assert.doesNotMatch(noteOf(requests[1]), /Eli|At the table so far|menus/);
});
