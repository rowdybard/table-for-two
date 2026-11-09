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

test('double dates assess the speaking player only, disclose on owning playback, and keep goals private', async t => {
  const f = await fixture(); t.after(() => f.close());
  const before = JSON.stringify(f.state);
  assert.equal(before.includes(f.scene.agendaContext('h1').goal), false, 'the hidden goal is absent from room snapshots');
  assert.equal(before.includes(f.scene.agendaContext('h2').goal), false);
  assert.equal(f.state.views.h1.evening.agenda?.goal, null);
  assert.equal(f.state.views.h2.evening.agenda?.goal, null);
  const first = await f.turn('h1', 'It sounds like you want room to settle into tonight.');
  assert.equal(f.requests.length, 1);
  assert.equal(f.conversation.submit('h1', first), false);
  assert.equal(f.state.views.h1.evening.agenda?.score, 0, 'a guess before a heard clue cannot earn trust');
  assert.equal(f.state.views.h2.evening.agenda?.score, 0, 'a friend cannot earn understanding for the other pairing');
  assert.deepEqual(f.state.views.h1.evening.agenda?.clues, []);
  f.receipt('h2', 'd1');
  assert.deepEqual(f.state.views.h1.evening.agenda?.clues, [], 'the friend hearing a line does not establish paired delivery');
  f.receipt('h1', 'd1'); f.receipt('h2', 'd2');
  assert.deepEqual(f.state.views.h1.evening.agenda?.clues, [clue.d1]);
  assert.deepEqual(f.state.views.h2.evening.agenda?.clues, [clue.d2], 'other dates can disclose without scoring the absent speaker');
  f.secondSpecific(); await f.turn('h1', 'You said you would like to take tonight slowly, and I noticed that preference.');
  assert.equal(f.state.views.h1.evening.agenda?.score, 30);
  assert.equal(f.state.views.h2.evening.agenda?.score, 0);
  f.receipt('h1', 'd1'); f.receipt('h2', 'd2');
  assert.deepEqual(f.state.views.h1.evening.agenda?.clues, [clue.d1, secondClue.d1]);
  assert.deepEqual(f.state.views.h2.evening.agenda?.clues, [clue.d2, secondClue.d2]);
  const note = doubleNote(f.requests[0]);
  assert.match(note, /Mira’s private goal, never said aloud: /); assert.match(note, /Jules’s private goal, never said aloud: /);
  assert.ok(!f.requests[0].system.includes(f.scene.agendaContext('h1').goal), 'the goal is per-turn private context, not part of the cached system prompt');
  assert.ok(f.requests[0].system.includes('private goal'));
  assert.ok(f.requests[0].system.includes('Every date begins highly skeptical'), 'both dates receive the shared skepticism policy');
  assert.ok(JSON.stringify(f.requests[0].outputSchema).includes('agenda'));
  assert.equal(before.includes('promptContext'), false);
  f.signal('understood'); await f.turn('h1', 'You want space to decide how this feels, without being rushed.', 'h2');
  assert.equal(f.state.views.h1.evening.agenda?.score, 65, 'public friend-directed speech may still show actual understanding');
  assert.equal(f.state.views.h2.evening.agenda?.score, 0);
  f.signal('respected'); await f.turn('h1', 'I can enjoy dinner with you and leave the next step open.');
  assert.equal(f.state.views.h1.evening.agenda?.score, 100);
  assert.equal(f.state.views.h1.evening.agenda?.goal, null, 'the answer is revealed at the ending, not in a live meter');
  f.signal('noticed'); await f.turn('h2', 'It sounds important to have your own say in tonight.');
  assert.equal(f.state.views.h2.evening.agenda?.score, 30);
  assert.equal(f.state.views.h1.evening.agenda?.score, 100);
  f.warn(); await f.turn('h1', 'Shall I choose dinner for both of you?');
  f.receipt('h1', 'd1'); f.receipt('h2', 'd2');
  assert.equal(f.state.views.h1.evening.agenda?.score, 100, 'stating a limit does not itself revoke understanding');
  f.pressure(); await f.turn('h2', 'I am ignoring what you both asked for.');
  assert.equal(f.state.views.h1.evening.agenda?.score, 100, 'a friend cannot revoke the paired player’s understanding credit');
  await f.turn('h1', 'I am ignoring your boundary too.');
  assert.equal(f.state.views.h1.evening.agenda?.score, 65, 'the player’s own boundary disregard revokes respect credit');
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

test('interrupted or offstage double date responses cannot earn agenda credit', async t => {
  let aborted = false;
  const f = await fixture(async function* (_request, signal) {
    yield { type: 'text', text: '{"utterances":[' + JSON.stringify({ speaker: 'd1', text: clue.d1, emotion: 'neutral' }) };
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
  }); t.after(() => f.close());
  f.conversation.submit('h1', { turnId: 'interrupted', text: 'I understand you.', target: 'd1' });
  for (let i = 0; i < 100 && !f.state.lines.some(item => item.speaker === 'd1' && item.text === clue.d1); i++) await delay(1);
  const line = f.receipt('h1', 'd1', false);
  f.conversation.interrupt(); await f.settle();
  f.conversation.playback('h1', line.id, line.generation, true, 2);
  assert.equal(aborted, true);
  assert.equal(f.state.views.h1.evening.agenda?.score, 0);
  assert.deepEqual(f.state.views.h1.evening.agenda?.clues, []);
  const g = await fixture(); t.after(() => g.close());
  g.scene.command('h1', { type: 'finish' }, 1000);
  const finished = structuredClone(g.state.views.h1.evening.agenda);
  await g.turn('h2', 'I notice you want a comfortable evening.');
  assert.deepEqual(g.state.views.h1.evening.agenda, finished);
  assert.equal(g.state.views.h2.evening.agenda?.score, 0, 'the remaining date still requires actual delivered context');
  g.receipt('h2', 'd2');
  await g.turn('h2', 'You mentioned wanting to be heard; I noticed that mattered to you.');
  assert.equal(g.state.views.h2.evening.agenda?.score, 30);
  assert.deepEqual(g.state.views.h1.evening.agenda, finished);
});
