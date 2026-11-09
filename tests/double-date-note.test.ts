import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { DOUBLE_START_NOTE, doubleMessages, doubleSystem, doubleTurnNote, friendNames, renderDoubleHistory } from '../server/double-date/table-note';
import type { Couple, DateSheet } from '../server/double-date/table-note';
import { SPOKEN_REGISTER, VOICE_REMINDER, TRIMMED_NOTE } from '../server/restaurant/dialogue-policy';
import { EMOTIONS, SOCIAL_SIGNALS } from '../server/restaurant/providers';
import { emptyUsage } from '../server/restaurant/scene';
import { noteTableFact } from '../server/restaurant/table-facts';
import { CHARACTER_STORIES } from '../src/restaurant/story';
import { getDate } from '../src/restaurant/content';

const names = { h1: 'Alex', h2: 'Jamie' } as const, dates = { d1: 'Mira', d2: 'Jules' } as const;
const sheet = (actorId: 'd1' | 'd2', humanId: 'h1' | 'h2', dateId: 'mira' | 'jules'): DateSheet => {
  const { voiceHabits, dinnerArc: _a, preferences: _p, preferredMain: _m, preferredDessert: _d, occupation: _o, ...life } = CHARACTER_STORIES[dateId];
  return { actorId, humanId, date: getDate(dateId)!, life, voiceHabits };
};
const sheets = [sheet('d1', 'h1', 'mira'), sheet('d2', 'h2', 'jules')];
const vocabulary = { emotions: EMOTIONS, signals: SOCIAL_SIGNALS };
const agenda = { goal: 'Wants to be asked before being advised.', naturalHint: 'Mention that long dinners tire you.', rubric: { noticed: 'Notices a preference.', understood: 'Names the goal.', respected: 'Leaves the next step open.' }, nextMilestone: 'noticed', evidenceReady: true, confidence: 'skeptical', heardClues: [] as string[] };

function couples(patch: Partial<Couple> = {}, second: Partial<Couple> = {}): Couple[] {
  const usage = emptyUsage();
  const make = (actorId: 'd1' | 'd2', humanId: 'h1' | 'h2', dateId: 'mira' | 'jules', extra: Partial<Couple>): Couple => ({
    actorId, humanId, dateName: dates[actorId], humanName: names[humanId], available: true, view: createPairView('note-room', humanId, names[humanId], dateId, usage, 2),
    memory: '', facts: [], agenda, boundaries: { boundaries: [] }, avoid: [], friendOnlyTurns: 0, recentOwn: [], pendingQuestion: null, ...extra,
  });
  return [make('d1', 'h1', 'mira', patch), make('d2', 'h2', 'jules', second)];
}
const note = (input: Partial<Parameters<typeof doubleTurnNote>[0]> = {}, a: Partial<Couple> = {}, b: Partial<Couple> = {}) =>
  doubleTurnNote({ couples: couples(a, b), speaker: 'h1', target: 'table', humanText: 'My graduating class was under seventy people.', flow: {}, elapsedMinutes: 12, ...input });

test('two friends with the same name are told apart, otherwise names are used as typed', () => {
  assert.deepEqual(friendNames([{ id: 'h1', name: 'Alex' }, { id: 'h2', name: 'Jamie' }]), { h1: 'Alex', h2: 'Jamie' });
  assert.deepEqual(friendNames([{ id: 'h1', name: 'Sam' }, { id: 'h2', name: 'sam' }]), { h1: 'Sam (first friend)', h2: 'sam (second friend)' });
});

test('the system prompt holds both character sheets and ends on how they talk; nothing that moves is in it', () => {
  const system = doubleSystem(sheets, 'ROLEPLAY RULES', vocabulary);
  assert.equal(system, doubleSystem(sheets, 'ROLEPLAY RULES', vocabulary), 'identical every turn, so the provider can cache it');
  for (const date of ['Mira', 'Jules']) assert.ok(system.includes(`is ${date}, an adult`), `${date}'s sheet`);
  assert.match(system, /d1 is Mira[^\n]*Paired with the friend h1/); assert.match(system, /d2 is Jules[^\n]*Paired with the friend h2/);
  assert.ok(!system.includes('Alex') && !system.includes('Jamie'), 'friend names change per room and live in the note');
  assert.ok(system.includes('offstage') && system.includes('ROLEPLAY RULES') && system.includes('OUTPUT. Return exactly one JSON object'));
  assert.ok(system.indexOf(SPOKEN_REGISTER) > system.indexOf('OUTPUT.'), 'the register is read after the contract');
  assert.ok(system.indexOf('MIRA’S VOICE (d1): ') > system.indexOf(SPOKEN_REGISTER) && system.indexOf('JULES’S VOICE (d2): ') > system.indexOf('MIRA’S VOICE'), 'each date’s habits follow the register');
  assert.ok(system.trimEnd().endsWith('Each date keeps their own voice.') && system.includes(VOICE_REMINDER), 'the last thing read is the reminder');
  assert.ok(!/\bpreferredMain\b|\bdinnerArc\b/.test(system), 'preferences and the dinner arc stay in the data');
  assert.match(system, /"memory" is that date’s private notebook[^\n]*700 characters[^\n]*"HUMAN:"[^\n]*"TOLD THEM:"[^\n]*"OPEN:"/);
});

test('the transcript uses names, says who a friend was talking to, and mentions delivery only when a listener missed something', () => {
  const heard = (completed: Record<string, Partial<Record<'h1' | 'h2', { completed: boolean; playedSeconds: number }>>>) => (id: string, human: 'h1' | 'h2') => completed[id]?.[human];
  const history = [
    { lines: [{ id: 'l0', speaker: 'd1', text: 'Hi! You found it.' }, { id: 'l1', speaker: 'waiter', text: 'Welcome in.' }] },
    { human: 'h1' as const, text: 'Thanks, hi.', target: 'table' },
    { human: 'h2' as const, text: 'Mira, where did you grow up?', target: 'd1' },
    { human: 'h1' as const, text: 'Jamie, do you remember this song?', target: 'h2' },
    { lines: [
      { id: 'l2', speaker: 'd1', text: 'Outside Portland, mostly. My mother taught piano and I lived at the keys.' },
      { id: 'l3', speaker: 'd2', text: 'I grew up near the water.', interrupted: true },
      { id: 'l4', speaker: 'diner', text: 'Excuse me, is this seat taken?' },
    ] },
    { lines: [] },
  ];
  const playback = heard({
    l0: { h1: { completed: true, playedSeconds: 3 }, h2: { completed: true, playedSeconds: 3 } }, l1: { h1: { completed: true, playedSeconds: 1 }, h2: { completed: true, playedSeconds: 1 } },
    l2: { h1: { completed: true, playedSeconds: 6 }, h2: { completed: false, playedSeconds: 1.5 } }, l3: {}, l4: { h1: { completed: true, playedSeconds: 2 }, h2: { completed: true, playedSeconds: 2 } },
  });
  const rendered = renderDoubleHistory(history, names, dates, ['h1', 'h2'], playback);
  assert.deepEqual(rendered.map(entry => entry.role), ['assistant', 'user', 'user', 'user', 'assistant'], 'an empty reply leaves no entry');
  assert.equal(rendered[0].content, 'Mira: Hi! You found it.\nEli (waiter): Welcome in.');
  assert.equal(rendered[1].content, 'Alex: Thanks, hi.', 'speaking to the table needs no addressee');
  assert.equal(rendered[2].content, 'Jamie (to Mira): Mira, where did you grow up?');
  assert.equal(rendered[3].content, 'Alex (to Jamie): Jamie, do you remember this song?');
  const lines = rendered[4].content.split('\n');
  assert.match(lines[0], /^Mira: Outside Portland, mostly\. .* \(Jamie heard only “Outside Portland, mostly\. My”\)$/, 'only the listener who missed the end is named, with roughly what they heard');
  assert.equal(lines[1], 'Jules: I grew up near the water. (neither friend heard this)');
  assert.equal(lines[2], 'Neighbouring diner: Excuse me, is this seat taken?', 'a fully heard line carries nothing');
  for (const entry of rendered) assert.ok(!/[{}]|delivery|speaker/.test(entry.content), 'no JSON keys in the transcript');
});

test('the message list starts on the evening, says when older talk was dropped, and ends with the note', () => {
  const opening = [{ role: 'assistant' as const, content: 'Mira: Hi!' }, { role: 'user' as const, content: 'Alex: Hi.' }];
  const fresh = doubleMessages(opening, false, 'NOTE');
  assert.deepEqual(fresh.map(message => message.role), ['user', 'assistant', 'user']);
  assert.equal(fresh[0].content, DOUBLE_START_NOTE); assert.equal(fresh.at(-1)!.content, 'Alex: Hi.\nNOTE', 'the human’s line and the note share one user message');
  const trimmed = doubleMessages([{ role: 'user', content: 'Alex: later' }, { role: 'assistant', content: 'Mira: sure' }], true, 'NOTE');
  assert.ok(trimmed[0].content.startsWith(TRIMMED_NOTE), 'a trimmed window opens with the earlier-talk note');
  for (let i = 1; i < fresh.length; i++) assert.notEqual(fresh[i].role, fresh[i - 1].role, 'roles alternate');
});

test('the turn note is short prose: both couples, the speaker’s words last, no JSON', () => {
  const text = note();
  assert.match(text, /^Right now: The evening is about 12 minutes old\.\n- Alex and Mira \(h1, d1\): /);
  assert.match(text, /\n- Jamie and Jules \(h2, d2\): /);
  assert.match(text, /Alex and Mira are seated|Alex and Mira have just met|Alex and Mira are not at the table/, 'the couple, not “you”, is the subject');
  assert.ok(!/[{}]/.test(text), 'no JSON in the note');
  assert.ok(text.endsWith('Alex said to the whole table: “My graduating class was under seventy people.”') || /Alex said to the whole table: “My graduating class was under seventy people\.”\n/.test(text));
  const paragraphs = text.split('\n\n');
  assert.ok(paragraphs.at(-1)!.startsWith('Alex said to the whole table'), 'the speaker’s words are the last paragraph');
  assert.match(note({ target: 'h2', speaker: 'h1' }), /Alex said to Jamie: /); assert.match(note({ target: 'd2' }), /Alex said to Jules: /);
});

test('each date’s notes, private goal and boundaries are labelled by name, and only the speaker’s pair can earn agenda evidence', () => {
  const text = note({}, { memory: 'HUMAN: Alex says the class had 70 people.', boundaries: { boundaries: [{ topic: 'food-drink', refusal: 'Please let me choose my own food.', delivered: true, disregardCount: 1, humanId: 'h1' } as never] } }, { memory: 'HUMAN: Jamie works nights.', agenda: { ...agenda, goal: 'Wants to feel heard.' } });
  assert.match(text, /Mira’s notes \(rewrite them into Mira’s "memory"\):\nHUMAN: Alex says the class had 70 people\./);
  assert.match(text, /Jules’s notes \(rewrite them into Jules’s "memory"\):\nHUMAN: Jamie works nights\./);
  assert.match(text, /Mira’s private goal, never said aloud: Wants to be asked before being advised\./);
  assert.match(text, /Jules’s private goal, never said aloud: Wants to feel heard\./);
  assert.equal((text.match(/You may now signal/g) ?? []).length, 1, 'the milestone rubric is offered once, for the date paired with the friend who spoke');
  assert.match(text, /Mira’s private goal[^\n]*You may now signal "noticed"/);
  assert.match(text, /Boundaries Mira has set:\n- food-drink: Alex heard you say “Please let me choose my own food\.” and has disregarded it once\./);
});

test('a date who has left or stepped away is told to the model as offstage and gets no notes, goal or boundary section', () => {
  const [mira] = couples();
  mira.view.phase = 'ended';
  const text = doubleTurnNote({ couples: [{ ...mira, available: false, agenda: null, memory: 'HUMAN: old' }, couples()[1]], speaker: 'h2', target: 'd2', humanText: 'Tell me about your week.', flow: {}, elapsedMinutes: 40 });
  assert.match(text, /Mira has left the table and Alex’s evening with Mira is over; Alex stays on as a wingman\. Write nothing for Mira\./);
  assert.ok(!text.includes('Mira’s notes') && !text.includes('Mira’s private goal'), 'nothing is asked of an offstage date');
  assert.match(text, /Jules’s private goal/);
  const away = note({}, { available: false, agenda: null });
  assert.match(away, /Mira is away from the table, so write nothing for Mira/);
});

test('table events are written about the friend by name, whatever voice the server wrote them in', () => {
  const [mira, jules] = couples();
  mira.view.evening.moments.push({ id: 'm1', title: 'Returned', description: 'You returned the risotto.' });
  noteTableFact(mira.view, 'Your date notices before you do.');
  const text = doubleTurnNote({ couples: [{ ...mira, facts: [] }, jules], speaker: 'h1', target: 'table', humanText: 'Hello', flow: {}, elapsedMinutes: 3 });
  assert.match(text, /At the table so far \(facts\):\n- Alex returned the risotto\./);
  const withFacts = doubleTurnNote({ couples: [{ ...mira, facts: ['Your date notices before you do.'] }, jules], speaker: 'h1', target: 'table', humanText: 'Hello', flow: {}, elapsedMinutes: 3 });
  assert.match(withFacts, /- Mira notices before Alex does\./);
  assert.ok(!/\bYou\b|\byour\b/.test(withFacts.split('At the table so far')[1].split('\n\n')[0]), 'no second person in the facts');
});

test('how the words arrived: out loud, over the date, before the reply landed, after a pause, or answering a question', () => {
  const voice = note({ via: 'voice', flow: { talkedOver: { by: 'Mira', heard: 'Outside Portland,' }, quietSeconds: 45 } });
  assert.match(voice, /Alex said this out loud; it is an automatic transcript/);
  assert.match(voice, /Alex started talking while Mira was still speaking; Mira was cut off after “Outside Portland,”\./);
  assert.match(voice, /It was quiet for about 45 seconds before Alex spoke\./);
  const typed = note({ via: 'typed', flow: { talkedOver: { by: 'Jules', heard: '' }, keptTalking: true } });
  assert.match(typed, /Alex replied while Jules was still speaking, right at the start of the line\./);
  assert.ok(!typed.includes('kept talking') && !typed.includes('automatic transcript'), 'typing is not talking over anyone');
  assert.match(note({ via: 'voice', flow: { keptTalking: true } }), /Alex kept talking before the last reply reached them/);
  const question = note({}, { pendingQuestion: 'Hi. I got here early and read the whole menu. How was your day?' });
  assert.match(question, /Mira had just asked Alex “How was your day\?” and was waiting for the answer\./);
  assert.ok(!note({ speaker: 'h2' }, { pendingQuestion: 'How was your day?' }).includes('waiting for the answer'), 'a friend’s words do not answer the other pair’s question');
});

test('“what is cake gossip?” points at the date who said it, by name', () => {
  const text = note({ humanText: 'what the heck is cake gossip', flow: { lastDateLine: { by: 'Mira', text: 'Wow, that is a lot of people for cake gossip.' } } });
  assert.match(text, /Alex seems to be asking about Mira’s last line \(“Wow, that is a lot of people for cake gossip\.”\)\. Mira should say plainly what that meant/);
  assert.ok(!note({ humanText: 'what do you do for work', flow: { lastDateLine: { by: 'Mira', text: 'Wow, that is a lot of people for cake gossip.' } } }).includes('seems to be asking about'));
});

test('left-out dates are described as a fact, and only once the friends have kept to themselves', () => {
  assert.ok(!note().includes('left out'));
  assert.match(note({}, { friendOnlyTurns: 2 }, { friendOnlyTurns: 2 }), /The two friends have talked only to each other for the last 2 public turns, so Mira and Jules are starting to feel left out\./);
});

test('reply-shape hints speak about the speaker and name the date whose lines were repetitive', () => {
  assert.match(note({ humanText: 'ok' }), /Alex said very little: answer in a few words or one short sentence\./);
  const long = 'My graduating class was under seventy people which is really small and honestly I never minded because everybody knew everybody and we ran the whole school like a family for years.';
  assert.match(note({ humanText: long }), /Alex told Mira something real: acknowledge it first/);
  const lines = ['Oh nice? Tell me more.', 'Really? What was that like?', 'Huh? And then?'].map(text => ({ speaker: 'date' as const, text, emotion: 'neutral' as const }));
  assert.match(note({}, { recentOwn: lines }), /Mira’s last replies ended in questions: end this one on a statement\./);
});
