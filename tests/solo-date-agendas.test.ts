import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { attachRestaurantServer, validateTurn } from '../server/restaurant';
import type { ClaudeAdapter } from '../server/restaurant/providers';
import type { DinnerState, SceneTurn, TurnEvent } from '../src/restaurant/types';
import { humanLine, noteOf, privateAgenda, signalFor } from './helpers/turn-note';

async function boot(claude: ClaudeAdapter) {
  let app: Awaited<ReturnType<typeof attachRestaurantServer>>;
  const server = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  app = await attachRestaurantServer(server, { claude, env: { DATE_SPEECH_PROVIDER: 'none' }, autoTick: false, ledgerPath: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    async create(mode: 'ai-date' | 'blind-date') {
      const response = await fetch(`${url}/api/date/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mode === 'blind-date' ? { mode, seed: 'agenda-integration-seed' } : { dateId: 'mira' }) });
      assert.equal(response.status, 201);
      return await response.json() as { state: DinnerState; token: string };
    },
    request(id: string, token: string, endpoint: string, data?: unknown) {
      return fetch(`${url}/api/date/sessions/${id}${endpoint}`, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    },
    async close() { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

const events = (text: string) => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as TurnEvent);
const neutral: SceneTurn = { utterances: [{ speaker: 'date', text: 'Thank you for listening.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: '', social: { signal: 'none', reason: 'An honest exchange.', wantsToLeave: false } };

for (const mode of ['ai-date', 'blind-date'] as const) test(`${mode}: private goal, delivered clues, deduplicated understanding, and ending reveal use ordinary turns`, async t => {
  let calls = 0, privateGoal = '';
  const adapter: ClaudeAdapter = { async *stream(request) {
    calls++;
    assert.ok(request.system.includes('agenda {signal,evidence,clue}'));
    assert.ok(request.system.includes('Every date begins highly skeptical'), 'Solo and Blind both receive the universal skepticism policy');
    const note = noteOf(request), agenda = privateAgenda(note), signal = signalFor(note);
    privateGoal ||= agenda.goal;
    assert.equal(agenda.goal, privateGoal);
    // The natural hint is offered on the third human turn and every third after; every other turn needs its own specific.
    const clue = calls === 1 ? `For tonight, I would like to ${privateGoal[0].toLowerCase()}${privateGoal.slice(1)}` : `A detail that matters to me: ${agenda.hint ?? `something specific on turn ${calls}.`}`;
    const turn: SceneTurn = { ...neutral, utterances: [{ speaker: 'date', text: clue, emotion: 'warm' }], agenda: { signal, evidence: signal === 'none' ? '' : humanLine(note), clue } };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: JSON.stringify(turn) };
  } };
  const api = await boot(adapter); t.after(() => api.close());
  const { state, token } = await api.create(mode), id = state.id;
  assert.equal(state.evening.agenda?.goal, null);
  assert.deepEqual(state.evening.agenda?.clues, []);
  const get = async () => (await (await api.request(id, token, '')).json()).state as DinnerState;
  const first = { turnId: 'notice', model: 'claude-haiku-5-5', text: 'What would make tonight feel good for you?' };
  const firstEvents = events(await (await api.request(id, token, '/turn', first)).text());
  const line = firstEvents.find(event => event.type === 'utterance');
  assert.ok(line?.type === 'utterance');
  const generation = (await get()).generation;
  assert.equal((await get()).evening.agenda?.score, 0, 'an opening question is not evidence of understanding');
  assert.deepEqual((await get()).evening.agenda?.clues, []);
  await api.request(id, token, '/playback', { generation, speaker: 'date', text: line.utterance.text, completed: false, playedSeconds: 0.2 });
  assert.deepEqual((await get()).evening.agenda?.clues, []);
  const receipt = await api.request(id, token, '/playback', { generation, speaker: 'date', text: line.utterance.text, completed: true, playedSeconds: 3 });
  assert.equal(receipt.status, 200);
  assert.deepEqual((await get()).evening.agenda?.clues, [line.utterance.text]);
  await (await api.request(id, token, '/turn', first)).text();
  assert.equal(calls, 1, 'retrying a turn must not request or score twice');
  assert.equal((await get()).evening.agenda?.score, 0);
  const notice = await api.request(id, token, '/turn', { turnId: 'notice-after-clue', text: 'You mentioned what you want from this evening; I noticed that matters to you.', model: 'claude-haiku-5-5' });
  const noticeLine = events(await notice.text()).find(event => event.type === 'utterance');
  assert.ok(noticeLine?.type === 'utterance');
  assert.equal((await get()).evening.agenda?.score, 30);
  assert.equal((await get()).evening.agenda?.clues.length, 1, 'the second generated clue is not yet established');
  await api.request(id, token, '/playback', { generation: (await get()).generation, speaker: 'date', text: noticeLine.utterance.text, completed: true, playedSeconds: 3 });
  assert.equal((await get()).evening.agenda?.clues.length, 2);
  for (const [turnId, text] of [['understand', 'That sounds like you want room to choose how tonight goes.'], ['respect', 'I would prefer friendship, and I accept that you may want something different.']]) {
    const response = await api.request(id, token, '/turn', { turnId, text, model: 'claude-haiku-5-5' });
    assert.ok(events(await response.text()).every(event => event.type !== 'error'));
  }
  const beforeEnding = await get();
  assert.equal(beforeEnding.evening.agenda?.score, 100);
  assert.equal(beforeEnding.evening.agenda?.goal, null);
  assert.equal(beforeEnding.usage.claudeRequests, 4);
  assert.equal(beforeEnding.evening.stance, 'curious', 'understanding does not buy attraction');
  const finished = await api.request(id, token, '/command', { type: 'finish' });
  const final = (await finished.json()).state as DinnerState;
  assert.equal(final.evening.agenda?.goal, privateGoal);
  assert.ok(final.evening.agenda?.reflection?.includes('friendship'));
  assert.equal(final.usage.claudeRequests, 4, 'ending reflection is deterministic');
});

test('malformed agenda output rejects the whole update, and interrupted output earns no points', async t => {
  assert.throws(() => validateTurn({ ...neutral, agenda: { signal: 'understood', evidence: 'Claim', clue: '', score: 100 } }));
  let canceled = false;
  const adapter: ClaudeAdapter = { async *stream(_request, signal) {
    yield { type: 'text', text: '{"utterances":[' + JSON.stringify(neutral.utterances[0]) + '],' };
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { canceled = true; resolve(); }, { once: true }));
  } };
  const api = await boot(adapter); t.after(() => api.close());
  const { state, token } = await api.create('ai-date');
  const response = await api.request(state.id, token, '/turn', { turnId: 'interrupted', model: 'claude-haiku-5-5', text: 'What are you hoping for tonight?' });
  await delay(10);
  await api.request(state.id, token, '/interrupt', {});
  assert.ok(events(await response.text()).some(event => event.type === 'error' && event.code === 'interrupted'));
  assert.equal(canceled, true);
  const current = (await (await api.request(state.id, token, '')).json()).state as DinnerState;
  assert.equal(current.evening.agenda?.score, 0);
  assert.deepEqual(current.evening.agenda?.clues, []);
  assert.equal(current.evening.agenda?.goal, null);
});
