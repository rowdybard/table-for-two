import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { attachRestaurantServer } from '../server/restaurant';
import { AGENDA_INSTRUCTIONS, DateAgendaDirector } from '../server/restaurant/agendas';
import { BOUNDARY_INSTRUCTIONS } from '../server/restaurant/boundaries';
import { DATE_DIALOGUE_INSTRUCTIONS, SPOKEN_REGISTER, VOICE_REMINDER, VOICE_SHORT, outputContract, replyShapeHint } from '../server/restaurant/dialogue-policy';
import { ACTIONS, EMOTIONS, SOCIAL_SIGNALS, type ClaudeAdapter } from '../server/restaurant/providers';
import { roleplayInstructions } from '../server/restaurant/roleplay';
import { SKEPTICISM_INSTRUCTIONS } from '../server/restaurant/skepticism';
import { createBlindDate } from '../src/restaurant/blind-date';
import { DATES } from '../src/restaurant/content';
import { createEvening } from '../src/restaurant/evening';
import { CHARACTER_STORIES } from '../src/restaurant/story';
import type { DateId, DinnerState, SceneTurn, SceneUtterance } from '../src/restaurant/types';

/** The prompt is cached, so its size costs little per turn, but a small model reads all of it: nothing may grow past this without a deliberate decision. Preset Solo prompts are ~16.3k characters. */
const PROMPT_BOUND = 16_500;
const turn: SceneTurn = { utterances: [{ speaker: 'date', text: 'Oh, nice.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: '', social: { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false } };

/** Boots the real Solo server with a mock provider and returns the system prompt of the first model request. */
async function systemPromptFor(body: Record<string, unknown>, model = 'claude-haiku-5-5') {
  const systems: string[] = [];
  const claude: ClaudeAdapter = { async *stream(request) { systems.push(request.system); yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }; yield { type: 'text', text: JSON.stringify(turn) }; } };
  let app: Awaited<ReturnType<typeof attachRestaurantServer>>;
  const http = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  app = await attachRestaurantServer(http, { claude, env: { DATE_SPEECH_PROVIDER: 'none' }, autoTick: false, ledgerPath: false });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const created = await (await fetch(`${url}/api/date/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as { state: DinnerState; token: string };
    const response = await fetch(`${url}/api/date/sessions/${created.state.id}/turn`, { method: 'POST', headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'voice-prompt', text: 'My graduating class was less than 70 people.', model }) });
    assert.equal(response.status, 200); await response.text();
    assert.equal(systems.length, 1);
    return { system: systems[0], blindSeed: created.state.blindDate?.seed };
  } finally { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); }
}

const present = (system: string, needle: string) => { const at = system.indexOf(needle); assert.ok(at >= 0, `missing: ${needle.slice(0, 60)}`); return at; };

for (const dateId of ['mira', 'jules', 'dev'] as const) test(`${dateId}: the system prompt reads rules first, the contract next, and the spoken register, voice and reminder last`, async () => {
  const { system } = await systemPromptFor({ dateId });
  const rules = [DATE_DIALOGUE_INSTRUCTIONS, BOUNDARY_INSTRUCTIONS, roleplayInstructions('claude-haiku-5-5')].map(text => present(system, text));
  assert.deepEqual([...rules].sort((a, b) => a - b), rules, 'the rule blocks keep their documented order');
  const contract = present(system, 'OUTPUT. Return exactly one JSON object');
  const register = present(system, SPOKEN_REGISTER), voice = present(system, `YOUR VOICE: ${CHARACTER_STORIES[dateId].voiceHabits}`), reminder = present(system, VOICE_REMINDER);
  assert.ok(rules.every(at => at < contract) && contract < register && register < voice && voice < reminder, 'rules, contract, register, voice, reminder');
  assert.ok(system.endsWith(VOICE_REMINDER), 'the one-line reminder is the very last line');
  assert.equal(system.split('YOUR VOICE:').length, 2, 'the voice is its own line, rendered once');
  assert.equal(system.split(CHARACTER_STORIES[dateId].voiceHabits).length, 2, 'the voice text is not also buried in the biography JSON');
  assert.ok(system.length <= PROMPT_BOUND, `${dateId} prompt is ${system.length} characters`);
});

test('a blind date gets the same ordering with a voice derived from its seeded traits, and stays inside the size bound', async () => {
  const { system, blindSeed } = await systemPromptFor({ mode: 'blind-date', seed: 'spoken-voice-seed' });
  const identity = createBlindDate(blindSeed!);
  assert.ok(system.endsWith(VOICE_REMINDER));
  assert.ok(present(system, SPOKEN_REGISTER) < present(system, `YOUR VOICE: ${identity.biography.voiceHabits}`));
  assert.ok(present(system, 'This is a blind date with a newly seeded personality') < present(system, 'OUTPUT.'));
  assert.ok(system.length <= PROMPT_BOUND, `blind prompt is ${system.length} characters`);
});

test('the system prompt names the turn-note sections and memory labels, not the old JSON keys', async () => {
  const { system } = await systemPromptFor({ dateId: 'dev' });
  for (const label of ['Right now', 'Your notes', 'At the table so far', 'Do not bring up unprompted', 'HUMAN:', 'TOLD THEM:', 'OPEN:', 'at most 700 characters', 'cut off', 'still being said', 'did not hear this']) present(system, label);
  for (const retired of ['playerSaid', 'tableNow', 'scene.evening', 'avoidUnpromptedTopics', 'nextMilestone', 'evidenceReady', 'dateAgenda', 'naturalHint', 'playerVia', 'playerTalkedOver']) assert.equal(system.includes(retired), false, `old key still in the prompt: ${retired}`);
  assert.doesNotMatch(system, /Every date begins highly skeptical|Private to you, not to recite|You may now signal/);
  assert.match(system, /Every utterance uses the exact speaker key/);
});

test('the prompt is deduplicated: one persona line per fact, one provider-limit sentence, no stray double period', async () => {
  const { system } = await systemPromptFor({ dateId: 'mira' });
  const mira = DATES.find(date => date.id === 'mira')!;
  assert.equal(system.split(mira.preferences).length, 2, 'preferences appear once');
  assert.equal(system.includes(CHARACTER_STORIES.mira.dinnerArc), false, 'the dinner arc stays in the data, not the live prompt');
  assert.equal(system.split('A provider content limit is not a personal boundary').length, 2, 'one provider-limit statement');
  assert.equal(system.includes('Provider limits differ'), false);
  assert.equal(system.includes('A provider limit is not a personal-boundary'), false);
  assert.equal(/Boundaries:[^\n]*\.\./.test(system), false, 'no double period at the end of the boundaries line');
  assert.equal(system.includes('graduating class'), false, 'no one-off playtest example in the general rules');
  assert.equal(system.includes('Do not always agree'), false);
  assert.equal(system.includes('Be specific, conversational'), false);
});

test('the Anthropic route keeps its fade-out rule; earned routes still avoid it', () => {
  assert.match(roleplayInstructions('claude-haiku-5-5'), /On the Anthropic route/);
  assert.doesNotMatch(roleplayInstructions('ai-horde'), /On the Anthropic route/);
  for (const model of ['claude-haiku-5-5', 'ai-horde'] as const) assert.match(roleplayInstructions(model), /Recognize obvious adult innuendo/, 'the innuendo rule lives with the content policy');
  assert.doesNotMatch(DATE_DIALOGUE_INSTRUCTIONS, /innuendo/);
});

test('legacy skepticism and agenda instructions stay outside the live prompt', () => {
  assert.ok(SKEPTICISM_INSTRUCTIONS.startsWith('Every date begins highly skeptical'));
  assert.doesNotMatch(SKEPTICISM_INSTRUCTIONS, /pointed|provisional judgment|hard to impress/);
  assert.ok(AGENDA_INSTRUCTIONS.includes('agenda {signal,evidence,clue}'));
  assert.match(AGENDA_INSTRUCTIONS, /only when that note says “You may now signal”/);
  assert.doesNotMatch(AGENDA_INSTRUCTIONS, /evidenceReady|naturalHint|paraphrase|forced interview|constant follow-up/);
  assert.doesNotMatch(DATE_DIALOGUE_INSTRUCTIONS, /relevant follow-up|constant follow-up|quiz/);
});

test('all sixteen agenda hints are plain first-person sentences', () => {
  const hints = new Set<string>();
  for (let index = 0; index < 4000 && hints.size < 16; index++) {
    // Blind dates choose their agenda from the seed; session ids are random, so any seed is as good as another.
    const state = { id: 'hints', dateId: 'mira' as DateId, blindDate: { seed: `seed-${(index * 7919).toString(36)}-${index}` }, evening: createEvening('mira') } as DinnerState;
    hints.add(new DateAgendaDirector(state).promptContext().naturalHint);
  }
  assert.equal(hints.size, 16, 'every agenda is reachable');
  for (const hint of hints) {
    assert.match(hint, /\bI(?:’m|’d|’ll|’ve)?\b/, hint);
    assert.doesNotMatch(hint, /^(?:A|An|The|Being|Getting|Trying|Some|Different|Remembering|There is)\b/, `no third-person aphorism: ${hint}`);
    assert.ok(hint.length < 100, hint);
  }
});

test('character voices are separate paragraphs in separate rhythms, and a short cue exists for each preset', () => {
  const voices = Object.fromEntries((['mira', 'jules', 'dev'] as const).map(id => [id, CHARACTER_STORIES[id].voiceHabits]));
  assert.match(voices.mira, /^Mira talks in quick, warm bursts/); assert.match(voices.jules, /^Jules is measured and quiet/); assert.match(voices.dev, /^Dev is fast and loose/);
  assert.equal(new Set(Object.values(voices)).size, 3);
  for (const id of ['mira', 'jules', 'dev']) assert.ok(VOICE_SHORT[id].length <= 120, `${id} short voice stays short`);
  assert.doesNotMatch(Object.values(voices).join(' '), /macho nicknames|constant challenges|follow-up questions/, 'no prohibition lists priming the behaviour');
  for (const date of DATES) assert.doesNotMatch(date.personality, /follow-up question|into an interview|bad puns|Dry jokes/, `${date.id} personality leaves style to the voice line`);
});

test('blind dates sound like their traits instead of three rigs with one narrator', () => {
  const lines = Array.from({ length: 80 }, (_, index) => createBlindDate(`rhythm-${index}`).biography.voiceHabits);
  const openers = new Set(lines.map(line => line.split(' ').slice(0, 2).join(' ')));
  assert.deepEqual([...openers].sort(), ['Easygoing and', 'Fast and', 'Quick, warm', 'Quiet and'], 'the four rhythm families all occur');
  for (const line of lines) {
    assert.match(line, / Humor: /);
    assert.doesNotMatch(line, /ridiculous exaggerations|bad pun|follow-up questions/);
  }
  for (let index = 0; index < 80; index++) assert.doesNotMatch(createBlindDate(`rhythm-${index}`).personality, /interview|ridiculous exaggerations|bad pun/, 'no quiz or quip priming in the seeded personality');
  for (const [index, voice] of lines.entries()) {
    const { sociability, directness } = createBlindDate(`rhythm-${index}`).traits;
    if (voice.startsWith('Quick, warm')) assert.ok(sociability > 65);
    else if (voice.startsWith('Quiet and')) assert.ok(sociability < 35);
    else if (voice.startsWith('Fast and')) assert.ok(sociability >= 35 && sociability <= 65 && directness > 65);
    else assert.ok(sociability >= 35 && sociability <= 65 && directness <= 65);
  }
});

test('the output contract states the three-part 700-character memory, the cast rule and the length target', () => {
  const contract = outputContract({ emotions: EMOTIONS, actions: ACTIONS, signals: SOCIAL_SIGNALS });
  for (const label of ['"HUMAN:"', '"TOLD THEM:"', '"OPEN:"', 'at most 700 characters', 'rewrite "Your notes"']) assert.ok(contract.includes(label), label);
  assert.match(contract, /about 25 words, under 260 characters/); assert.match(contract, /discards a reply over 420/);
  assert.match(contract, /Every utterance uses the exact speaker key "date"/); assert.match(contract, /never speak for the human or another person/);
  for (const word of [...EMOTIONS, ...ACTIONS, ...SOCIAL_SIGNALS]) assert.ok(contract.includes(word), word);
  assert.match(contract, /spoken line first/, 'the field order the schema streams in is stated');
});

test('the dialogue rules cover transcripts, talk-over, continuation and quiet gaps in the note’s own words', () => {
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /says they said it out loud, the words are an automatic transcript/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /silently use the plausible word, never quote or joke about the garble/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /only once, and only when two readings would change your answer/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /If they talked over you/); assert.match(DATE_DIALOGUE_INSTRUCTIONS, /If they kept talking before your reply reached them/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /long quiet gap/);
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /small number is small, a big number is big/, 'the general principle replaces the one-off example');
  assert.match(DATE_DIALOGUE_INSTRUCTIONS, /Never coin a phrase, nickname or in-joke/);
});

const line = (text: string): SceneUtterance => ({ speaker: 'date', text, emotion: 'neutral' });

test('replyShapeHint answers short remarks briefly and long disclosures warmly', () => {
  assert.equal(replyShapeHint([], 'ok'), 'They said very little: answer in a few words or one short sentence.');
  assert.equal(replyShapeHint([], 'yes please, that sounds good to me'), '', 'seven words is neither short nor long');
  const long = Array.from({ length: 31 }, (_, index) => `word${index}`).join(' ');
  assert.equal(replyShapeHint([], long), 'They told you something real: acknowledge it first; two or three sentences is fine.');
  assert.match(replyShapeHint([], ''), /very little/);
});

test('replyShapeHint notices three same-size replies and repeated questions, and ignores other speakers', () => {
  const same = [line('Small towns are like that.'), line('Right, that makes sense.'), line('Okay, I follow.')];
  assert.match(replyShapeHint(same, 'My graduating class was less than 70 people.'), /all 1 sentence long: change the shape/);
  const two = [line('Small towns are like that. Fair enough.'), line('Right. That makes sense.'), line('Okay. I follow.')];
  assert.match(replyShapeHint(two, 'My graduating class was less than 70 people.'), /all 2 sentences long/);
  const mixed = [line('Small towns are like that.'), line('Right. That makes sense.'), line('Okay.')];
  assert.equal(replyShapeHint(mixed, 'My graduating class was less than 70 people.'), '');
  const asking = [line('What was that like?'), line('Right. And then?'), line('Okay. Where did you go next?')];
  assert.match(replyShapeHint(asking, 'My graduating class was less than 70 people.'), /end this one on a statement/);
  assert.doesNotMatch(replyShapeHint([line('Where to?'), line('Fine.'), line('Okay.')], 'My graduating class was less than 70 people.'), /ended in questions/, 'one question ending is normal');
  const onlyWaiter: SceneUtterance[] = [{ speaker: 'waiter', text: 'More water?', emotion: 'warm' }, { speaker: 'waiter', text: 'Anything else?', emotion: 'warm' }, { speaker: 'waiter', text: 'Sure?', emotion: 'warm' }];
  assert.equal(replyShapeHint(onlyWaiter, 'My graduating class was less than 70 people.'), '', 'only the date’s own lines shape the date’s next reply');
  assert.match(replyShapeHint([line('Is that right?”'), line('Oh? Really?'), line('Sure.')], 'a b c d e f g h'), /end this one on a statement/, 'a closing quote does not hide a question');
});
