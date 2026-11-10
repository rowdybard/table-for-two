import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import { DoubleConversation } from '../server/double-date/conversation';
import { createPairView, DoubleTableScene } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import type { RestaurantPaidAccount, RestaurantServices } from '../server/restaurant';
import type { ClaudeChunk, ClaudeRequest } from '../server/restaurant/providers';
import type { AgendaAssessment } from '../src/restaurant/agenda-types';
import type { DoubleDateRoomState, DoubleHumanId, DoubleTurnRequest } from '../src/restaurant/double-date-types';
import { doubleNote, humanTurnOf } from './helpers/double-note';

const neutral = { signal: 'none', reason: 'No boundary change.', wantsToLeave: false };
const clue = { d1: 'I would like to take the evening slowly.', d2: 'I want to feel heard tonight.' };
const secondClue = { d1: 'I prefer deciding about another date after we have enjoyed this one.', d2: 'Ask whether I want advice before trying to solve a problem for me.' };
const complete = (signal: AgendaAssessment['signal'], evidence: string, overrides: Record<string, unknown> = {}, specifics = clue) => ({
  utterances: [{ speaker: 'd1', text: specifics.d1, emotion: 'neutral' }, { speaker: 'd2', text: specifics.d2, emotion: 'neutral' }],
  dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: 'We talked at dinner.', social: neutral,
    agenda: { signal, evidence, clue: specifics[actorId as keyof typeof clue] }, ...overrides })),
});

async function fixture(stream?: (request: ClaudeRequest, signal: AbortSignal) => AsyncIterable<ClaudeChunk>) {
  await RAPIER.init();
  const usage = emptyUsage(), account: RestaurantPaidAccount = { usage, sessionLimit: 2, reserved: 0 };
  const state: DoubleDateRoomState = { id: 'agenda-double-room', code: 'AGENDAS', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [-.55, 0, 5.6], yaw: 0, seated: false },
      { id: 'h2', name: 'Jamie', connected: true, ready: true, dateId: 'jules', position: [.55, 0, 5.6], yaw: 0, seated: false },
    ],
    dates: [
      { id: 'd1', humanId: 'h1', dateId: 'mira', position: [-1.55, 0, 4.9], seated: false, emotion: 'neutral', stance: 'curious' },
      { id: 'd2', humanId: 'h2', dateId: 'jules', position: [1.55, 0, 4.9], seated: false, emotion: 'neutral', stance: 'curious' },
    ],
    views: { h1: createPairView('agenda-double-room', 'h1', 'Alex', 'mira', usage, 2), h2: createPairView('agenda-double-room', 'h2', 'Jamie', 'jules', usage, 2) },
    lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] },
  };
  for (const view of Object.values(state.views)) view.phase = 'playing';
  let signal: AgendaAssessment['signal'] = 'noticed', social = neutral, specifics = clue;
  let boundaryKind: 'none' | 'set' | 'repeat' = 'none';
  const refusal = 'Please let me choose my own food. Do not order for me.';
  const requests: ClaudeRequest[] = [];
  const services: RestaurantServices = {
    now: () => 1000,
    status: () => ({ claude: true, speech: false, development: true, models: ['claude-haiku-5-5'], defaultModel: 'claude-haiku-5-5', sessionLimit: 2 }),
    createAccount: () => account,
    async *streamClaude(_account, request, abort) {
      requests.push(request); usage.claudeRequests++;
      if (stream) { yield* stream(request, abort); return; }
      const turn = humanTurnOf(request);
      const boundarySocial = boundaryKind === 'none' ? social : { signal: boundaryKind === 'set' ? 'none' : 'pressure', reason: 'The date wants to choose their own food.', wantsToLeave: false, boundary: { kind: boundaryKind, topic: 'food-drink', refusal, evidence: turn.text } };
      const result = complete(signal, turn.text, { social: boundarySocial }, specifics);
      if (boundaryKind === 'set') for (const line of result.utterances) line.text = refusal;
      yield { type: 'text', text: JSON.stringify(result) };
    },
    async *streamSpeech() { throw new Error('Agenda tests must never request speech.'); },
  };
  const scene = new DoubleTableScene(state), conversation = new DoubleConversation(state, scene, services, account);
  let sequence = 0;
  async function settle() { for (let i = 0; i < 100; i++) { if (!state.processing) return; await delay(1); } throw new Error('Test conversation did not settle.'); }
  async function turn(human: DoubleHumanId, text: string, target: DoubleTurnRequest['target'] = 'table') {
    const request = { turnId: `agenda-${++sequence}`, text, target };
    assert.equal(conversation.submit(human, request), true); await settle(); return request;
  }
  const receipt = (human: DoubleHumanId, actor: 'd1' | 'd2', completed = true) => {
    const line = [...state.lines].reverse().find(item => item.speaker === actor && [clue[actor], secondClue[actor], refusal].includes(item.text))!;
    assert.ok(line); conversation.playback(human, line.id, line.generation, completed, completed ? 2 : .1); return line;
  };
  return { state, scene, conversation, requests, turn, settle, receipt,
    signal(value: AgendaAssessment['signal']) { signal = value; },
    secondSpecific() { specifics = secondClue; },
    warn() { boundaryKind = 'set'; },
    pressure() { boundaryKind = 'repeat'; },
    close() { conversation.close(); scene.free(); },
  };
}

test('double dates keep their own delivery and notebook without hidden agenda prompts', async t => {
  const f = await fixture(); t.after(() => f.close());
  await f.turn('h1', 'It is nice to meet both of you.');
  assert.doesNotMatch(f.requests[0].system, /Each date has a private goal|Agenda evidence counts/);
  assert.doesNotMatch(doubleNote(f.requests[0]), /private goal, not to recite/);
  assert.equal(f.state.views.h1.memory, ''); assert.equal(f.state.views.h2.memory, '');
  f.receipt('h2', 'd1'); assert.equal(f.state.views.h1.memory, '');
  f.receipt('h1', 'd1'); assert.equal(f.state.views.h1.memory, 'We talked at dinner.');
  assert.equal(f.state.views.h2.memory, ''); f.receipt('h2', 'd2'); assert.equal(f.state.views.h2.memory, 'We talked at dinner.');
});

test('double notebook disclosures require the paired listener and stale receipts cannot restore old notes', async t => {
  let calls = 0;
  const f = await fixture(async function* () {
    const result = complete('none', ''); calls++;
    result.dateUpdates[0].memory = `HUMAN: name ${calls === 1 ? 'Sam' : 'Nia'}.\nTOLD THEM: six prints.\nOPEN: promised to show a print; shared premise: bakery.`;
    result.dateUpdates[1].memory = 'HUMAN: likes books.\nTOLD THEM: train story.\nOPEN: asked about a book; shared premise: postcard.';
    yield { type: 'text', text: JSON.stringify(result) };
  }); t.after(() => f.close());
  await f.turn('h1', 'My name is Sam.');
  assert.equal(f.state.views.h1.memory, 'HUMAN: name Sam.');
  assert.equal(f.state.views.h2.memory, 'HUMAN: likes books.');
  const first = f.receipt('h2', 'd1');
  assert.equal(f.state.views.h1.memory, 'HUMAN: name Sam.', 'friend delivery does not establish paired disclosure');
  f.receipt('h1', 'd1');
  assert.match(f.state.views.h1.memory, /six prints/); assert.doesNotMatch(f.state.views.h2.memory, /train story/);
  f.receipt('h2', 'd2'); assert.match(f.state.views.h2.memory, /train story/);
  await f.turn('h1', 'Actually, my name is Nia.');
  assert.match(f.state.views.h1.memory, /name Nia/);
  await f.turn('h1', 'Please drop the joke.');
  f.conversation.playback('h1', first.id, first.generation, true, 1);
  assert.match(f.state.views.h1.memory, /name Nia/); assert.doesNotMatch(f.state.views.h1.memory, /shared premise/);
  assert.match(f.state.views.h2.memory, /train story/, 'the other pair keeps its own heard disclosure');
  assert.match(f.state.views.h2.memory, /shared premise: postcard/, 'one couple’s stop does not retire the other couple’s premise');
});

test('an accepted stop retires the paired premise even if a double response fails', async t => {
  const f = await fixture(async function* () { throw new Error('offline fixture failure'); }); t.after(() => f.close());
  f.state.views.h1.memory = 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised a print; shared premise: bakery.';
  f.state.views.h2.memory = 'HUMAN: likes books.\nOPEN: shared premise: postcard.';
  await f.turn('h1', 'Please drop the joke.');
  assert.doesNotMatch(f.state.views.h1.memory, /shared premise/);
  assert.match(f.state.views.h1.memory, /promised a print/);
  assert.match(f.state.views.h2.memory, /shared premise: postcard/);
});

test('a double paired receipt before complete JSON applies only its own validated notebook', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(async function* () {
    const result = complete('none', '');
    result.dateUpdates[0].memory = 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised a print.';
    result.dateUpdates[1].memory = 'HUMAN: likes books.\nTOLD THEM: train story.\nOPEN: asked about a book.';
    const text = JSON.stringify(result), end = text.indexOf('],"dateUpdates"');
    yield { type: 'text', text: text.slice(0, end) };
    await gate;
    yield { type: 'text', text: text.slice(end) };
  }); t.after(() => { release(); f.close(); });
  f.conversation.submit('h1', { turnId: 'early-memory', text: 'I am Nia.', target: 'table' });
  for (let i = 0; i < 100 && !f.state.lines.some(line => line.speaker === 'd1'); i++) await delay(1);
  f.receipt('h1', 'd1'); assert.equal(f.state.views.h1.memory, '');
  release(); await f.settle();
  assert.match(f.state.views.h1.memory, /TOLD THEM: six prints/);
  assert.doesNotMatch(f.state.views.h2.memory, /train story/);
});

test('a queued stop cannot be undone by an older in-flight double notebook', async t => {
  let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(async function* () {
    if (++calls > 1) throw new Error('offline fixture failure');
    const result = complete('none', '');
    result.dateUpdates[0].memory = 'HUMAN: name Sam.\nTOLD THEM: six prints.\nOPEN: shared premise: bakery.';
    const text = JSON.stringify(result), end = text.indexOf('],"dateUpdates"');
    yield { type: 'text', text: text.slice(0, end) }; await gate;
    yield { type: 'text', text: text.slice(end) };
  }); t.after(() => { release(); f.close(); });
  f.state.views.h1.memory = 'HUMAN: name Nia.\nTOLD THEM: six prints.\nOPEN: promised a print; shared premise: bakery.';
  f.conversation.submit('h1', { turnId: 'older-turn', text: 'That is funny.', target: 'table' });
  for (let i = 0; i < 100 && !f.state.lines.some(line => line.speaker === 'd1'); i++) await delay(1);
  f.conversation.submit('h1', { turnId: 'stop-turn', text: 'Please drop the joke.', target: 'table' });
  assert.doesNotMatch(f.state.views.h1.memory, /shared premise/);
  release(); await f.settle();
  assert.match(f.state.views.h1.memory, /name Nia/); assert.match(f.state.views.h1.memory, /promised a print/);
  assert.doesNotMatch(f.state.views.h1.memory, /shared premise|name Sam/);
});

test('malformed double agenda output is rejected atomically without scores or clues', async t => {
  const f = await fixture(async function* (_request) {
    const result = complete('noticed', 'I hear you.');
    (result.dateUpdates[1].agenda as Record<string, unknown>).signal = 'award-everything';
    yield { type: 'text', text: JSON.stringify(result) };
  }); t.after(() => f.close());
  await f.turn('h1', 'I hear you.');
  assert.equal(f.state.error?.code, 'invalid_dialogue');
  for (const view of Object.values(f.state.views)) { assert.equal(view.evening.agenda?.score, 0); assert.deepEqual(view.evening.agenda?.clues, []); }
  assert.equal(f.requests.length, 1);
});

test('interrupted or offstage double responses cannot change that date’s memory', async t => {
  let aborted = false;
  const f = await fixture(async function* (_request, signal) {
    yield { type: 'text', text: '{"utterances":[' + JSON.stringify({ speaker: 'd1', text: clue.d1, emotion: 'neutral' }) };
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
  }); t.after(() => f.close());
  f.state.views.h1.memory = 'HUMAN: name Nia.';
  f.conversation.submit('h1', { turnId: 'interrupted', text: 'I understand you.', target: 'd1' });
  for (let i = 0; i < 100 && !f.state.lines.some(item => item.speaker === 'd1' && item.text === clue.d1); i++) await delay(1);
  const line = f.receipt('h1', 'd1', false); f.conversation.interrupt(); await f.settle();
  f.conversation.playback('h1', line.id, line.generation, true, 2);
  assert.equal(aborted, true); assert.equal(f.state.views.h1.memory, 'HUMAN: name Nia.');
  const g = await fixture(); t.after(() => g.close());
  g.state.views.h1.memory = 'HUMAN: name Nia.'; g.scene.command('h1', { type: 'finish' }, 1000);
  await g.turn('h2', 'I enjoy quiet evenings.'); assert.equal(g.state.views.h1.memory, 'HUMAN: name Nia.');
  g.receipt('h2', 'd2'); assert.equal(g.state.views.h2.memory, 'We talked at dinner.');
  assert.equal(g.state.views.h1.memory, 'HUMAN: name Nia.');
});
