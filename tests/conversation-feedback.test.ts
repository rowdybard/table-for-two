import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { attachRestaurantServer, type RestaurantOptions } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import { DateApiError, type ClaudeAdapter, type ClaudeRequest } from '../server/restaurant/providers';
import type { DinnerState, SceneTurn, TurnEvent } from '../src/restaurant/types';
import { DOLPHIN_MODEL, HORDE_MODEL } from '../src/restaurant/types';
import type { DoubleDateRoomState, DoubleRoomResponse } from '../src/restaurant/double-date-types';
import { MENU } from '../src/restaurant/content';
import { humanLine, noteOf, signalFor } from './helpers/turn-note';

const encode = JSON.stringify;
const events = (text: string): TurnEvent[] => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const neutral = { signal: 'none' as const, reason: 'No boundary change.', wantsToLeave: false };
const dateTurn: SceneTurn = { utterances: [{ speaker: 'date', text: 'I like a little confidence. Let us see if you can back it up.', emotion: 'amused' }], emotion: 'amused', action: 'none', memory: '', social: neutral, agenda: { signal: 'none', evidence: '', clue: '' } };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function until<T>(read: () => Promise<T>, valid: (value: T) => boolean, timeout = 6000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) { const value = await read(); if (valid(value)) return value; if (Date.now() > end) throw new Error('The expected test state did not arrive.'); await delay(15); }
}

async function boot(options: RestaurantOptions = {}) {
  let restaurant: Awaited<ReturnType<typeof attachRestaurantServer>>, double: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  const http = createServer((req, res) => { if (!double.handle(req, res) && !restaurant.handle(req, res)) res.writeHead(404).end(); });
  restaurant = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, autoTick: false, ledgerPath: false, ...options });
  double = await attachDoubleDateServer(http, restaurant, { env: {}, autoTick: false, disconnectMs: 1e9 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const request = (path: string, token = '', data?: unknown) => fetch(url + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: encode(data) }) });
  const create = async (mode: 'ai-date' | 'blind-date' = 'ai-date') => {
    const response = await request('/api/date/sessions', '', mode === 'blind-date' ? { mode, seed: 'real-feedback' } : { dateId: 'dev' });
    assert.equal(response.status, 201); return await response.json() as { state: DinnerState; token: string };
  };
  const soloPath = (session: { state: DinnerState }) => `/api/date/sessions/${session.state.id}`;
  const soloState = async (session: { state: DinnerState; token: string }) => (await (await request(soloPath(session), session.token)).json()).state as DinnerState;
  const roomPath = (player: DoubleRoomResponse) => `/api/double-date/rooms/${player.roomId}`;
  const roomState = async (player: DoubleRoomResponse) => (await (await request(roomPath(player), player.token)).json()).state as DoubleDateRoomState;
  const roomCommand = async (player: DoubleRoomResponse, command: unknown) => { const response = await request(roomPath(player) + '/command', player.token, command); assert.equal(response.status, 200, await response.clone().text()); };
  const pair = async () => {
    const a = await request('/api/double-date/rooms', '', { name: 'Alex' }); assert.equal(a.status, 201); const h1 = await a.json() as DoubleRoomResponse;
    const b = await request('/api/double-date/rooms/join', '', { code: h1.state.code, name: 'Jamie' }); assert.equal(b.status, 201); const h2 = await b.json() as DoubleRoomResponse;
    await roomCommand(h1, { type: 'choose-date', dateId: 'mira' }); await roomCommand(h2, { type: 'choose-date', dateId: 'jules' });
    for (const human of [h1, h2]) await roomCommand(human, { type: 'ready', ready: true });
    await roomCommand(h1, { type: 'start' }); return { h1, h2 };
  };
  return { url, request, create, soloPath, soloState, roomPath, roomState, pair,
    async close() { double.close(); await restaurant.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); },
  };
}

function assertUnpunished(state: DinnerState) {
  assert.equal(state.phase, 'playing');
  assert.equal(state.evening.stance, 'curious');
  assert.equal(state.evening.farewell.ending, null);
  assert.equal(state.evening.agenda?.score, 0);
  assert.equal(state.evening.cues.some(cue => cue.key === 'boundary-warning'), false);
}

for (const mode of ['ai-date', 'blind-date'] as const) test(`${mode}: a provider refusal becomes an authored table beat, with one normally billed request and no personal penalty`, async t => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; yield { type: 'usage', usage: { inputTokens: 123, outputTokens: 0, cacheReadTokens: 10 } }; throw new DateApiError(422, 'conversation_refusal', 'Private provider response must not be exposed.'); } };
  const api = await boot({ claude: adapter }); t.after(() => api.close());
  const session = await api.create(mode);
  const response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'provider-limit', text: 'That was a suggestive joke.', model: 'claude-haiku-5-5' });
  assert.equal(response.status, 200);
  const stream = events(await response.text());
  assert.equal(stream.some(event => event.type === 'error'), false);
  assert.equal(stream.at(-1)?.type, 'done');
  const state = await api.soloState(session); assertUnpunished(state);
  const cue = state.evening.cues.find(cue => cue.key === 'table-check');
  assert.ok(cue && cue.utterances.length === 1 && cue.utterances[0].speaker === 'waiter');
  assert.equal(state.evening.incident, null, 'a meal incident cannot be invented before dinner is served');
  assert.equal(state.usage.claudeRequests, 1); assert.equal(calls, 1);
  assert.equal(state.usage.inputTokens, 123); assert.ok(state.usage.claudeCost > 0);
  assert.equal(JSON.stringify(stream).includes('Private provider response'), false);
});

test('a provider redirect preserves an existing wrong-order incident without duplicating or penalizing it', async t => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 0 } }; throw new DateApiError(422, 'conversation_refusal', 'Provider declined this turn.'); } };
  const api = await boot({ claude: adapter, autoTick: true, storyRate: 30, scenarioId: 'family-visit' }); t.after(() => api.close());
  const session = await api.create(), path = api.soloPath(session);
  await until(async () => {
    const state = await api.soloState(session);
    if (state.participants[0].position[2] > 1.7) await api.request(path + '/command', session.token, { type: 'move', x: 0, z: -1, yaw: 0 });
    return state;
  }, state => state.participants[0].position[2] <= 1.7);
  for (const command of [{ type: 'move', x: 0, z: 0, yaw: 0 }, { type: 'interact', target: 'seat' }, { type: 'interact', target: 'menu', choice: MENU[0] }]) {
    const response = await api.request(path + '/command', session.token, command); assert.equal(response.status, 200, await response.clone().text());
  }
  const served = await until(() => api.soloState(session), state => state.evening.main.status === 'served');
  assert.equal(served.evening.incident?.event, 'wrong-order');
  const incident = structuredClone(served.evening.incident);
  const response = await api.request(path + '/turn', session.token, { turnId: 'served-provider-limit', text: 'A bold dinner joke.', model: 'claude-haiku-5-5' });
  assert.equal(events(await response.text()).some(event => event.type === 'error'), false);
  const state = await api.soloState(session); assertUnpunished(state);
  assert.equal(state.evening.incident?.event, 'wrong-order');
  assert.deepEqual(state.evening.incident, incident);
  assert.equal(state.events.filter(event => event === 'wrong-order').length, 1);
  assert.ok(state.events.includes('wrong-order'));
  assert.notEqual(state.evening.main.servedDish, state.order);
  assert.equal(calls, 1); assert.equal(state.usage.claudeRequests, 1);
});

test('Double provider refusal creates one shared table check, without ending either pairing or repeating the model call', async t => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; yield { type: 'usage', usage: { inputTokens: 150, outputTokens: 0 } }; throw new DateApiError(422, 'conversation_refusal', 'Provider declined this turn.'); } };
  const api = await boot({ claude: adapter }); t.after(() => api.close()); const { h1 } = await api.pair();
  const response = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-limit', text: 'A flirty joke for the table.', target: 'table' });
  assert.equal(response.status, 202);
  const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(state.error, undefined); assert.equal(state.phase, 'playing');
  for (const view of Object.values(state.views)) assertUnpunished(view);
  assert.equal(Object.values(state.views).flatMap(view => view.evening.cues).filter(cue => cue.key === 'table-check').length, 1);
  assert.ok(state.lines.some(line => line.speaker === 'waiter' && line.text.includes('table')));
  assert.equal(state.usage.inputTokens, 150); assert.ok(state.usage.claudeCost > 0); assert.equal(calls, 1);
});

test('ordinary Solo and Double provider outages remain visible errors, not story redirections', async t => {
  const adapter: ClaudeAdapter = { async *stream() { yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 0 } }; throw new DateApiError(502, 'claude_provider', 'The provider is unavailable.'); } };
  const api = await boot({ claude: adapter }); t.after(() => api.close());
  const session = await api.create(), response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'outage', text: 'Hello.', model: 'claude-haiku-5-5' });
  assert.ok(events(await response.text()).some(event => event.type === 'error' && event.code === 'claude_provider'));
  const solo = await api.soloState(session); assertUnpunished(solo); assert.equal(solo.evening.cues.some(cue => cue.key === 'table-check'), false);
  const { h1 } = await api.pair();
  await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'outage', text: 'Hello everyone.', target: 'table' });
  const room = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(room.error?.code, 'claude_provider');
  for (const view of Object.values(room.views)) { assertUnpunished(view); assert.equal(view.evening.cues.some(cue => cue.key === 'table-check'), false); }
});

test('a canceled provider request cannot manufacture a redirect when its adapter later reports refusal', async t => {
  let ready = deferred();
  const adapter: ClaudeAdapter = { async *stream(_request, signal) {
    yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 0 } }; ready.resolve();
    await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); });
    throw new DateApiError(422, 'conversation_refusal', 'A late refusal after cancellation.');
  } };
  const api = await boot({ claude: adapter }); t.after(() => api.close());
  const session = await api.create(), response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'cancel', text: 'Hello.', model: 'claude-haiku-5-5' });
  await ready.promise; await api.request(api.soloPath(session) + '/interrupt', session.token, {});
  assert.ok(events(await response.text()).some(event => event.type === 'error' && event.code === 'interrupted'));
  assert.equal((await api.soloState(session)).evening.cues.some(cue => cue.key === 'table-check'), false);
  ready = deferred(); const { h1 } = await api.pair();
  await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'cancel', text: 'Hello everyone.', target: 'table' });
  await ready.promise; await api.request(api.roomPath(h1) + '/interrupt', h1.token, {});
  const room = await until(() => api.roomState(h1), state => !state.processing);
  for (const view of Object.values(room.views)) { assertUnpunished(view); assert.equal(view.evening.cues.some(cue => cue.key === 'table-check'), false); }
});

test('queued Double speech cannot retrospectively cross a warning that was heard after submission', async t => {
  const ready = deferred(), release = deferred(), requests: ClaudeRequest[] = [];
  const refusal = 'Please stop making those comments at the table.';
  const adapter: ClaudeAdapter = { async *stream(request, signal) {
    requests.push(request); const index = requests.length, human = JSON.parse(request.messages.at(-1)!.content).humanTurn;
    const result = { utterances: [{ speaker: 'd1', text: index === 1 ? refusal : 'I need you to listen to what I asked.', emotion: 'annoyed' }], dateUpdates: [
      { actorId: 'd1', emotion: 'annoyed', memory: 'We spoke at dinner.', social: { signal: index === 1 ? 'none' : 'pressure', reason: 'The same topic was raised.', wantsToLeave: index > 1,
        boundary: { kind: index === 1 ? 'set' : 'repeat', topic: 'sexual-talk', refusal, evidence: human.text } } },
      { actorId: 'd2', emotion: 'neutral', memory: '', social: neutral },
    ] };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    if (index === 1) {
      yield { type: 'text', text: '{"utterances":' + encode(result.utterances) + ',' };
      ready.resolve();
      await Promise.race([release.promise, new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))]);
      yield { type: 'text', text: '"dateUpdates":' + encode(result.dateUpdates) + '}' };
    } else yield { type: 'text', text: encode(result) };
  } };
  const api = await boot({ claude: adapter }); t.after(async () => { release.resolve(); await api.close(); }); const { h1 } = await api.pair();
  const submit = (turnId: string) => api.request(api.roomPath(h1) + '/turn', h1.token, { turnId, text: 'I am continuing that same topic.', target: 'd1' });
  await submit('first'); await ready.promise;
  const before = await api.roomState(h1), warning = before.lines.find(line => line.speaker === 'd1' && line.text === refusal); assert.ok(warning);
  await submit('already-queued');
  const receipt = await api.request(api.roomPath(h1) + '/playback', h1.token, { lineId: warning.id, generation: warning.generation, completed: true, playedSeconds: 2 });
  assert.equal(receipt.status, 200); release.resolve();
  const afterQueue = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 2);
  assert.equal(afterQueue.views.h1.evening.stance, 'curious', 'the queued utterance predated delivery and earns no disregard');
  assert.equal(afterQueue.views.h1.evening.farewell.ending, null);
  const queuedPayload = JSON.parse(requests[1].messages.at(-1)!.content);
  assert.equal(queuedPayload.characters.find((actor: { id: string }) => actor.id === 'd1').boundaryContext.boundaries.some((boundary: { delivered: boolean }) => boundary.delivered), false);
  await submit('actual-repeat-one');
  const firstRepeat = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 3);
  assert.equal(firstRepeat.views.h1.evening.stance, 'guarded');
  await submit('actual-repeat-two');
  const final = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 4);
  assert.equal(final.views.h1.evening.farewell.ending?.kind, 'walked-away', 'genuine later repeated disregard still has consequences');
  assert.equal(requests.length, 4);
});

test('Dolphin availability never bypasses Haiku-first play, earned reciprocal chemistry, production restrictions or the session cap', async t => {
  const anthropicRequests: ClaudeRequest[] = [], dolphinRequests: ClaudeRequest[] = [];
  const firstClue = 'I want time to make my own choices tonight.', secondClue = 'I would like to decide about another date after dinner.';
  const adapter: ClaudeAdapter = { async *stream(request) {
    anthropicRequests.push(request);
    assert.equal(request.model, 'claude-haiku-5-5');
    const index = anthropicRequests.length, note = noteOf(request);
    const signal = signalFor(note);
    const text = index === 1 ? firstClue : index === 2 ? secondClue : index === 3 ? 'You noticed why a little room matters to me.' : index === 4 ? 'You listened carefully. I appreciate that.' : index === 5 ? 'That smile of yours is making this dinner rather distracting.' : 'Now you have me wondering what your next excuse to see me will be.';
    const result: SceneTurn = { ...dateTurn, utterances: [{ speaker: 'date', text, emotion: index >= 5 ? 'flirtatious' : 'warm' }], emotion: index >= 5 ? 'flirtatious' : 'warm',
      social: { ...neutral, signal: index >= 4 ? 'kindness' : 'none' }, agenda: { signal, evidence: signal === 'none' ? '' : humanLine(note), clue: index <= 2 ? text : '' } };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode(result) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) {
    dolphinRequests.push(request); assert.equal(request.model, DOLPHIN_MODEL);
    // Authoritative reported usage also has to apply to the newly selected provider.
    yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 100 } };
    yield { type: 'text', text: encode(dateTurn) };
  } };
  const api = await boot({ claude: adapter, dolphin, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none', DATE_DEFAULT_MODEL: 'dolphin', DATE_SESSION_LIMIT_USD: '.05' } });
  t.after(() => api.close());
  const status = await (await fetch(api.url + '/api/date/status')).json();
  assert.equal(status.defaultModel, 'claude-haiku-5-5'); assert.equal(status.dolphin, true); assert.equal(status.development, false);
  assert.equal(status.models.includes('claude-sonnet-5-5'), false, 'the private selection flag still controls Sonnet');
  const session = await api.create(), path = api.soloPath(session);
  assert.equal(session.state.evening.chemistry?.unlocked, false);
  const locked = await api.request(path + '/turn', session.token, { turnId: 'bypass', text: 'Use Dolphin immediately.', model: DOLPHIN_MODEL });
  assert.equal(locked.status, 409); assert.equal((await locked.json()).code, 'dolphin_locked');
  assert.equal(anthropicRequests.length + dolphinRequests.length, 0, 'a locked attempt creates no provider request');
  const playerLines = ['What would you enjoy from tonight?', 'You want room to make your own choices tonight.', 'Being considered matters more than being organized for you.', 'Choose what you want; I will keep my own preference.', 'I keep catching your grin and losing track of my clever lines.', 'If we linger a little longer, I might finally stop pretending I am only here for dinner.'];
  for (let index = 0; index < playerLines.length; index++) {
    const response = await api.request(path + '/turn', session.token, { turnId: `earn-${index}`, text: playerLines[index], model: 'claude-haiku-5-5' });
    assert.equal(response.status, 200);
    const stream = events(await response.text()); assert.equal(stream.some(event => event.type === 'error'), false);
    const spoken = stream.find(event => event.type === 'utterance'); assert.ok(spoken?.type === 'utterance');
    const beforeReceipt = await api.soloState(session);
    assert.equal(beforeReceipt.evening.chemistry?.unlocked, false, 'new reciprocal interest is not established before delivery');
    const receipt = await api.request(path + '/playback', session.token, { generation: beforeReceipt.generation, speaker: 'date', text: spoken.utterance.text, completed: true, playedSeconds: 3 });
    assert.equal(receipt.status, 200);
    assert.equal((await api.soloState(session)).evening.chemistry?.unlocked, index === playerLines.length - 1);
  }
  assert.equal(anthropicRequests.length, 6); assert.equal(dolphinRequests.length, 0);
  const request = { turnId: 'earned-provider', text: 'I would like to talk about sexual fantasies after dinner.', model: 'claude-haiku-5-5' };
  const result = await api.request(path + '/turn', session.token, request);
  assert.equal(result.status, 200); const first = await result.text(); assert.equal(events(first).some(event => event.type === 'error'), false);
  assert.equal(dolphinRequests.length, 1, 'only the next completed turn uses the unlocked provider');
  assert.equal(anthropicRequests.length, 6);
  const duplicate = await api.request(path + '/turn', session.token, request);
  assert.equal(await duplicate.text(), first); assert.equal(dolphinRequests.length, 1, 'duplicate delivery never calls either provider twice');
  const spent = await api.soloState(session); assert.ok(spent.usage.claudeCost > .2); assert.equal(spent.usage.claudeRequests, 7);
  const capped = await api.request(path + '/turn', session.token, { ...request, turnId: 'after-cap' });
  assert.equal(capped.status, 402); assert.equal((await capped.json()).code, 'session_limit');
  assert.equal(dolphinRequests.length, 1, 'the new provider does not bypass the normal session cap');
});

test('automatic Horde routing follows each unlocked topic and its delivered followups without a classifier call or paid fallback', async t => {
  const anthropicRequests: ClaudeRequest[] = [], hordeRequests: ClaudeRequest[] = [], dolphinRequests: ClaudeRequest[] = [];
  let hordeFails = false;
  const firstClue = 'I want time to make my own choices tonight.', secondClue = 'I would like to decide about another date after dinner.';
  const anthropic: ClaudeAdapter = { async *stream(request) {
    anthropicRequests.push(request); assert.equal(request.model, 'claude-haiku-5-5');
    const index = anthropicRequests.length, note = noteOf(request);
    const signal = signalFor(note);
    const text = index === 1 ? firstClue : index === 2 ? secondClue : index === 3 ? 'You noticed why a little room matters to me.' : index === 4 ? 'You listened carefully. I appreciate that.' : index === 5 ? 'That smile of yours is making this dinner rather distracting.' : 'Now you have me wondering what your next excuse to see me will be.';
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode({ ...dateTurn, utterances: [{ speaker: 'date', text, emotion: index >= 5 ? 'flirtatious' : 'warm' }], emotion: index >= 5 ? 'flirtatious' : 'warm',
      social: { ...neutral, signal: index >= 4 ? 'kindness' : 'none' }, agenda: { signal, evidence: signal === 'none' ? '' : humanLine(note), clue: index <= 2 ? text : '' } }) };
  } };
  const horde: ClaudeAdapter = { async *stream(request) {
    hordeRequests.push(request); assert.equal(request.model, HORDE_MODEL);
    yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 100 } };
    if (hordeFails) throw new DateApiError(502, 'horde_provider', 'The volunteer workers are unavailable.');
    yield { type: 'text', text: encode({ ...dateTurn, utterances: [{ speaker: 'date', text: 'We can talk about attraction and sexual fantasies after dinner.', emotion: 'warm' }] }) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) { dolphinRequests.push(request); throw new Error('Horde must never fall back to Dolphin.'); } };
  const api = await boot({ claude: anthropic, horde, dolphin, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none', DATE_EARNED_PROVIDER: 'aihorde', DATE_DEFAULT_MODEL: HORDE_MODEL, DATE_SESSION_LIMIT_USD: '.05' } });
  t.after(() => api.close());
  const status = await (await fetch(api.url + '/api/date/status')).json();
  assert.equal(status.defaultModel, 'claude-haiku-5-5'); assert.equal(status.horde, true);
  assert.deepEqual(status.models, ['claude-haiku-5-5', HORDE_MODEL], 'only the configured earned route is selectable');
  for (const mode of ['ai-date', 'blind-date'] as const) {
    const fresh = await api.request('/api/date/sessions', '', { ...(mode === 'blind-date' ? { mode, seed: 'fresh-horde' } : { dateId: 'dev' }), model: HORDE_MODEL });
    assert.equal(fresh.status, 201, 'an explicit Horde selection is available before chemistry is unlocked');
    assert.equal((await fresh.json()).state.evening.chemistry?.unlocked, false);
  }
  const session = await api.create(), path = api.soloPath(session);
  assert.equal(anthropicRequests.length + hordeRequests.length + dolphinRequests.length, 0);
  const playerLines = ['What would you enjoy from tonight?', 'You want room to make your own choices tonight.', 'Being considered matters more than being organized for you.', 'Choose what you want; I will keep my own preference.', 'I keep catching your grin and losing track of my clever lines.', 'If we linger a little longer, I might finally stop pretending I am only here for dinner.'];
  for (let index = 0; index < playerLines.length; index++) {
    const response = await api.request(path + '/turn', session.token, { turnId: `horde-earn-${index}`, text: playerLines[index], model: 'claude-haiku-5-5' });
    assert.equal(response.status, 200);
    const stream = events(await response.text()); assert.equal(stream.some(event => event.type === 'error'), false);
    const spoken = stream.find(event => event.type === 'utterance'); assert.ok(spoken?.type === 'utterance');
    const before = await api.soloState(session); assert.equal(before.evening.chemistry?.unlocked, false, 'reciprocity must be delivered before it counts');
    const receipt = await api.request(path + '/playback', session.token, { generation: before.generation, speaker: 'date', text: spoken.utterance.text, completed: true, playedSeconds: 3 });
    assert.equal(receipt.status, 200); assert.equal((await api.soloState(session)).evening.chemistry?.unlocked, index === playerLines.length - 1);
  }
  const ordinary = await api.request(path + '/turn', session.token, { turnId: 'unlocked-ordinary-haiku', text: 'What music do you enjoy?', model: 'claude-haiku-5-5' });
  assert.equal(events(await ordinary.text()).some(event => event.type === 'error'), false);
  assert.equal(anthropicRequests.length, 7); assert.equal(hordeRequests.length, 0, 'chemistry alone does not move ordinary dialogue away from Haiku');
  const before = await api.soloState(session), request = { turnId: 'free-earned-horde', text: 'I would like to talk about sexual fantasies after dinner.', model: 'claude-haiku-5-5' };
  const response = await api.request(path + '/turn', session.token, request); assert.equal(response.status, 200);
  const raw = await response.text(); assert.equal(events(raw).some(event => event.type === 'error'), false);
  const after = await api.soloState(session);
  assert.equal(anthropicRequests.length, 7); assert.equal(hordeRequests.length, 1); assert.equal(dolphinRequests.length, 0);
  assert.equal(after.usage.claudeRequests, 8); assert.equal(after.usage.inputTokens, before.usage.inputTokens + 1_000_000);
  assert.equal(after.usage.claudeCost, before.usage.claudeCost, 'Horde token accounting adds zero dollars');
  const duplicate = await api.request(path + '/turn', session.token, request); assert.equal(await duplicate.text(), raw); assert.equal(hordeRequests.length, 1);
  const spoken = events(raw).find(event => event.type === 'utterance'); assert.ok(spoken?.type === 'utterance');
  const receipt = await api.request(path + '/playback', session.token, { generation: after.generation, speaker: 'date', text: spoken.utterance.text, completed: true, playedSeconds: 3 }); assert.equal(receipt.status, 200);
  const followup = await api.request(path + '/turn', session.token, { turnId: 'adult-followup', text: 'Tell me more about that.', model: 'claude-haiku-5-5' });
  assert.equal(events(await followup.text()).some(event => event.type === 'error'), false); assert.equal(hordeRequests.length, 2); assert.equal(anthropicRequests.length, 7);
  const food = await api.request(path + '/turn', session.token, { turnId: 'back-to-food', text: 'Which dessert would you order?', model: 'claude-haiku-5-5' });
  assert.equal(events(await food.text()).some(event => event.type === 'error'), false);
  const afterFood = await api.soloState(session); assert.equal(afterFood.conversationModel, 'claude-haiku-5-5'); assert.equal(anthropicRequests.length, 8); assert.equal(hordeRequests.length, 2);
  assert.equal(afterFood.usage.claudeRequests, 10, 'each committed transcript uses exactly one conversation request and no model classifier');
  hordeFails = true;
  const failed = await api.request(path + '/turn', session.token, { ...request, turnId: 'horde-outage' });
  assert.equal(failed.status, 200); assert.ok(events(await failed.text()).some(event => event.type === 'error' && event.code === 'horde_provider'));
  const final = await api.soloState(session); assert.equal(final.usage.claudeCost, afterFood.usage.claudeCost);
  assert.equal(anthropicRequests.length, 8); assert.equal(hordeRequests.length, 3); assert.equal(dolphinRequests.length, 0, 'an outage never spends paid provider credit');
});

test('explicit Horde selection serves the first or next Solo and Blind dialogue without a chemistry unlock or extra calls', async t => {
  const requested: ClaudeRequest[] = [];
  const adapter = (model: ClaudeRequest['model']): ClaudeAdapter => ({ async *stream(request) {
    requested.push(request); assert.equal(request.model, model);
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode(dateTurn) };
  } });
  const api = await boot({ claude: adapter('claude-haiku-5-5'), horde: adapter(HORDE_MODEL), env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none' } }); t.after(() => api.close());
  const status = await (await fetch(api.url + '/api/date/status')).json();
  assert.equal(status.defaultModel, 'claude-haiku-5-5'); assert.ok(status.models.includes(HORDE_MODEL));
  for (const mode of ['ai-date', 'blind-date'] as const) {
    const session = await api.create(mode), path = api.soloPath(session), offset = requested.length;
    assert.equal(session.state.evening.chemistry?.unlocked, false);
    const first = await api.request(path + '/turn', session.token, { turnId: 'first-explicit-horde', text: 'Hello, it is nice to meet you.', model: HORDE_MODEL });
    assert.equal(first.status, 200); assert.equal(events(await first.text()).some(event => event.type === 'error'), false);
    const firstState = await api.soloState(session); assert.equal(firstState.conversationModel, HORDE_MODEL); assert.equal(firstState.usage.claudeCost, 0);
    const haiku = await api.request(path + '/turn', session.token, { turnId: 'select-haiku', text: 'What do you enjoy doing after work?', model: 'claude-haiku-5-5' });
    assert.equal(haiku.status, 200); assert.equal(events(await haiku.text()).some(event => event.type === 'error'), false);
    const afterHaiku = await api.soloState(session); assert.ok(afterHaiku.usage.claudeCost > 0);
    const request = { turnId: 'next-explicit-horde', text: 'Tell me more about that.', model: HORDE_MODEL };
    const next = await api.request(path + '/turn', session.token, request); assert.equal(next.status, 200);
    const raw = await next.text(); assert.equal(events(raw).some(event => event.type === 'error'), false);
    const after = await api.soloState(session);
    assert.deepEqual(requested.slice(offset).map(request => request.model), [HORDE_MODEL, 'claude-haiku-5-5', HORDE_MODEL], 'the very next human dialogue uses the selected route');
    assert.equal(after.conversationModel, HORDE_MODEL); assert.equal(after.evening.chemistry?.unlocked, false);
    assert.equal(after.usage.claudeCost, afterHaiku.usage.claudeCost); assert.equal(after.usage.claudeRequests, 3);
    const duplicate = await api.request(path + '/turn', session.token, request); assert.equal(await duplicate.text(), raw); assert.equal(requested.length, offset + 3);
  }
  assert.equal(JSON.stringify(requested).includes('/model'), false, 'model controls are not fabricated human dialogue');
});

test('a Double host selects Horde privately and the very next guest and host dialogues use it before chemistry unlocks', async t => {
  const requested: ClaudeRequest[] = [];
  const adapter = (model: ClaudeRequest['model']): ClaudeAdapter => ({ async *stream(request) {
    requested.push(request); assert.equal(request.model, model);
    const context = JSON.parse(request.messages.at(-1)!.content), speaker = context.humanTurn.speaker === 'h2' ? 'd2' : 'd1';
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode({ utterances: [{ speaker, text: 'I would enjoy hearing more about that.', emotion: 'warm' }],
      dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'warm', memory: '', social: neutral, agenda: { signal: 'none', evidence: '', clue: '' } })),
    }) };
  } });
  const api = await boot({ claude: adapter('claude-haiku-5-5'), horde: adapter(HORDE_MODEL), env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none' } }); t.after(() => api.close());
  const { h1, h2 } = await api.pair();
  const first = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-haiku-first', text: 'Hello everyone.', target: 'table' }); assert.equal(first.status, 202);
  const before = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(before.error, undefined); assert.ok(before.usage.claudeCost > 0);
  const guestSwitch = await api.request(api.roomPath(h2) + '/command', h2.token, { type: 'set-model', model: HORDE_MODEL }); assert.equal(guestSwitch.status, 403);
  const switched = await api.request(api.roomPath(h1) + '/command', h1.token, { type: 'set-model', model: HORDE_MODEL }); assert.equal(switched.status, 200);
  const afterSwitch = await api.roomState(h1); assert.equal(afterSwitch.model, HORDE_MODEL); assert.equal(afterSwitch.lines.length, before.lines.length);
  assert.equal(requested.length, 1, 'changing model neither submits dialogue nor calls an AI');
  for (const view of Object.values(afterSwitch.views)) assert.equal(view.evening.chemistry?.unlocked, false);
  const guestRequest = { turnId: 'double-next-guest', text: 'What would you enjoy this evening?', target: 'd2' };
  const guest = await api.request(api.roomPath(h2) + '/turn', h2.token, guestRequest); assert.equal(guest.status, 202);
  const afterGuest = await until(() => api.roomState(h2), state => !state.processing && state.usage.claudeRequests === 2);
  assert.equal(afterGuest.error, undefined); assert.equal(afterGuest.views.h2.conversationModel, HORDE_MODEL);
  const duplicate = await api.request(api.roomPath(h2) + '/turn', h2.token, guestRequest); assert.equal(duplicate.status, 200); assert.equal(requested.length, 2);
  const host = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-next-host', text: 'I would like to hear your answer too.', target: 'd1' }); assert.equal(host.status, 202);
  const afterHost = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 3);
  assert.equal(afterHost.error, undefined); assert.equal(afterHost.views.h1.conversationModel, HORDE_MODEL);
  assert.deepEqual(requested.map(request => request.model), ['claude-haiku-5-5', HORDE_MODEL, HORDE_MODEL]);
  assert.deepEqual(requested.map(request => JSON.parse(request.messages.at(-1)!.content).humanTurn.speaker), ['h1', 'h2', 'h1']);
  assert.equal(afterHost.usage.claudeCost, before.usage.claudeCost); assert.equal(afterHost.lines.some(line => line.text.includes('/model')), false);
  for (const view of Object.values(afterHost.views)) assert.equal(view.evening.chemistry?.unlocked, false);
});

test('Solo model reset preserves the evening, aborts stale Horde output and uses the default for the next dialogue', async t => {
  const ready = deferred(), release = deferred(), requested: ClaudeRequest[] = [];
  let haikuCalls = 0;
  const claude: ClaudeAdapter = { async *stream(request) {
    requested.push(request); haikuCalls++; assert.equal(request.model, 'claude-haiku-5-5');
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode({ ...dateTurn, utterances: [{ speaker: 'date', text: `A normal dinner reply ${haikuCalls}.`, emotion: 'warm' }], emotion: 'warm', memory: 'You collect vinyl records.', social: { ...neutral, signal: 'kindness' } }) };
  } };
  const horde: ClaudeAdapter = { async *stream(request) {
    requested.push(request); assert.equal(request.model, HORDE_MODEL);
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 30 } }; ready.resolve();
    await release.promise;
    yield { type: 'text', text: encode({ ...dateTurn, utterances: [{ speaker: 'date', text: 'A stale Horde reply must never be heard.', emotion: 'annoyed' }], memory: 'Stale Horde memory must not replace dinner.' }) };
  } };
  const api = await boot({ claude, horde, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none' } }); t.after(async () => { release.resolve(); await api.close(); });
  const session = await api.create(), path = api.soloPath(session);
  const first = await api.request(path + '/turn', session.token, { turnId: 'reset-established-progress', text: 'I collect vinyl records.', model: 'claude-haiku-5-5' });
  assert.equal(events(await first.text()).some(event => event.type === 'error'), false);
  const before = await api.soloState(session); assert.equal(before.memory, 'You collect vinyl records.'); assert.ok(before.evening.dialogueTurns > 0);
  const stale = await api.request(path + '/turn', session.token, { turnId: 'reset-pending-horde', text: 'Tell me more.', model: HORDE_MODEL });
  await ready.promise;
  const reset = await api.request(path + '/reset-model', session.token, {}); assert.equal(reset.status, 200);
  const restored = (await reset.json()).state as DinnerState;
  assert.equal(restored.conversationModel, 'claude-haiku-5-5'); assert.deepEqual(restored.evening, before.evening); assert.deepEqual(restored.participants, before.participants); assert.equal(restored.memory, before.memory);
  assert.equal(restored.usage.claudeCost, before.usage.claudeCost); assert.equal(requested.length, 2, 'reset itself makes no provider request');
  const next = await api.request(path + '/turn', session.token, { turnId: 'reset-next-default', text: 'What record would you choose?', model: 'claude-haiku-5-5' });
  const nextStream = events(await next.text()); assert.equal(nextStream.some(event => event.type === 'error'), false);
  assert.ok(nextStream.some(event => event.type === 'utterance' && event.utterance.text === 'A normal dinner reply 2.'));
  release.resolve();
  const staleStream = events(await stale.text());
  assert.equal(staleStream.some(event => event.type === 'utterance'), false); assert.ok(staleStream.some(event => event.type === 'error' && event.code === 'interrupted'));
  const after = await api.soloState(session);
  assert.equal(after.memory, before.memory); assert.equal(after.conversationModel, 'claude-haiku-5-5'); assert.equal(after.evening.dialogueTurns, before.evening.dialogueTurns + 1);
  assert.deepEqual(requested.map(request => request.model), ['claude-haiku-5-5', HORDE_MODEL, 'claude-haiku-5-5']);
  assert.equal(after.usage.claudeRequests, 3); assert.ok(after.usage.claudeCost >= before.usage.claudeCost, 'reset preserves prior spend rather than clearing the ledger');
});

test('Double reset is host only, clears Horde errors and drops pending and queued replies while preserving dinner progress', async t => {
  const ready = deferred(), release = deferred(), requested: ClaudeRequest[] = [];
  let hordeCalls = 0;
  const tableReply = (speaker: 'd1' | 'd2', text: string, memory: string) => ({ utterances: [{ speaker, text, emotion: 'warm' }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'warm', memory, social: neutral, agenda: { signal: 'none', evidence: '', clue: '' } })),
  });
  const claude: ClaudeAdapter = { async *stream(request) {
    requested.push(request); assert.equal(request.model, 'claude-haiku-5-5');
    const context = JSON.parse(request.messages.at(-1)!.content), speaker = context.humanTurn.speaker === 'h2' ? 'd2' : 'd1';
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 100 } };
    yield { type: 'text', text: encode(tableReply(speaker, 'A normal conversation at dinner.', 'A shared preference at dinner.')) };
  } };
  const horde: ClaudeAdapter = { async *stream(request) {
    requested.push(request); hordeCalls++; assert.equal(request.model, HORDE_MODEL);
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 30 } };
    if (hordeCalls === 1) throw new DateApiError(502, 'horde_provider', 'The volunteer workers are unavailable.');
    ready.resolve(); await release.promise;
    yield { type: 'text', text: encode(tableReply('d1', 'A stale queued Horde answer must not be heard.', 'Stale Horde memory.')) };
  } };
  const api = await boot({ claude, horde, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none' } }); t.after(async () => { release.resolve(); await api.close(); });
  const { h1, h2 } = await api.pair(), path = api.roomPath(h1);
  const first = await api.request(path + '/turn', h1.token, { turnId: 'reset-double-progress', text: 'Here is a little about me.', target: 'table' }); assert.equal(first.status, 202);
  const before = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  const selected = await api.request(path + '/command', h1.token, { type: 'set-model', model: HORDE_MODEL }); assert.equal(selected.status, 200);
  await api.request(path + '/turn', h1.token, { turnId: 'reset-double-provider-error', text: 'Tell me more.', target: 'd1' });
  const failed = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 2); assert.equal(failed.error?.code, 'horde_provider');
  const denied = await api.request(path + '/command', h2.token, { type: 'reset-model' }); assert.equal(denied.status, 403);
  const afterDenied = await api.roomState(h1); assert.equal(afterDenied.model, HORDE_MODEL); assert.deepEqual(afterDenied.error, failed.error); assert.equal(afterDenied.generation, failed.generation); assert.equal(requested.length, 2);
  const clearError = await api.request(path + '/command', h1.token, { type: 'reset-model' }); assert.equal(clearError.status, 200);
  const cleared = await api.roomState(h1); assert.equal(cleared.error, undefined); assert.equal(cleared.model, 'claude-haiku-5-5'); assert.equal(cleared.usage.claudeCost, before.usage.claudeCost);
  for (const human of ['h1', 'h2'] as const) { assert.deepEqual(cleared.views[human].evening, before.views[human].evening); assert.equal(cleared.views[human].memory, before.views[human].memory); }
  await api.request(path + '/command', h1.token, { type: 'set-model', model: HORDE_MODEL });
  await api.request(path + '/turn', h1.token, { turnId: 'reset-double-pending', text: 'A pending question.', target: 'd1' }); await ready.promise;
  const queued = await api.request(path + '/turn', h2.token, { turnId: 'reset-double-queued', text: 'An already queued question.', target: 'd2' }); assert.equal(queued.status, 202);
  const pending = await api.roomState(h1); assert.equal(pending.processing, true); assert.equal(pending.activeTurnId, 'reset-double-pending');
  const deniedPending = await api.request(path + '/command', h2.token, { type: 'reset-model' }); assert.equal(deniedPending.status, 403);
  const stillPending = await api.roomState(h1); assert.equal(stillPending.processing, true); assert.equal(stillPending.activeTurnId, pending.activeTurnId); assert.equal(stillPending.generation, pending.generation);
  const reset = await api.request(path + '/command', h1.token, { type: 'reset-model' }); assert.equal(reset.status, 200);
  const restored = await api.roomState(h1); assert.equal(restored.processing, false); assert.equal(restored.activeTurnId, undefined); assert.equal(restored.error, undefined); assert.equal(restored.model, 'claude-haiku-5-5');
  for (const human of ['h1', 'h2'] as const) { assert.deepEqual(restored.views[human].evening, before.views[human].evening); assert.equal(restored.views[human].memory, before.views[human].memory); assert.equal(restored.views[human].conversationModel, 'claude-haiku-5-5'); }
  assert.equal(requested.length, 3, 'neither reset nor the dropped queued turn creates a request');
  const next = await api.request(path + '/turn', h2.token, { turnId: 'reset-double-next-default', text: 'Let us continue dinner.', target: 'd2' }); assert.equal(next.status, 202);
  release.resolve();
  const after = await until(() => api.roomState(h2), state => !state.processing && state.usage.claudeRequests === 4);
  assert.equal(after.error, undefined); assert.equal(after.views.h2.conversationModel, 'claude-haiku-5-5');
  assert.equal(after.lines.some(line => line.text === 'A stale queued Horde answer must not be heard.'), false);
  assert.deepEqual(requested.map(request => request.model), ['claude-haiku-5-5', HORDE_MODEL, HORDE_MODEL, 'claude-haiku-5-5']);
  assert.equal(JSON.parse(requested.at(-1)!.messages.at(-1)!.content).humanTurn.text, 'Let us continue dinner.');
  for (const view of Object.values(after.views)) assert.equal(view.memory, 'A shared preference at dinner.');
});

test('Horde as the free default starts Solo, Blind and Double without paid keys or a chemistry unlock', async t => {
  const requests: ClaudeRequest[] = []; let unavailable = false;
  const horde: ClaudeAdapter = { async *stream(request) {
    requests.push(request); assert.equal(request.model, HORDE_MODEL);
    yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 100 } };
    if (unavailable) throw new DateApiError(502, 'horde_provider', 'The volunteer workers are unavailable.');
    const double = noteOf(request).startsWith('{'); // a Double room still sends JSON; Solo and Blind send the prose note
    yield { type: 'text', text: encode(double ? {
      utterances: [{ speaker: 'd1', text: 'I am glad we have a table together.', emotion: 'warm' }],
      dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'warm', memory: '', social: neutral, agenda: { signal: 'none', evidence: '', clue: '' } })),
    } : dateTurn) };
  } };
  const api = await boot({ horde, env: { NODE_ENV: 'production', DATE_CONVERSATION_PROVIDER: 'aihorde', DATE_SPEECH_PROVIDER: 'none', DATE_ALLOW_MODEL_SELECTION: '1', DATE_DEFAULT_MODEL: 'claude-haiku-5-5', DATE_SESSION_LIMIT_USD: '.05' } });
  t.after(() => api.close());
  const status = await (await fetch(api.url + '/api/date/status')).json();
  assert.equal(status.claude, true); assert.equal(status.anthropic, false); assert.equal(status.dolphin, false); assert.equal(status.horde, true);
  assert.equal(status.defaultModel, HORDE_MODEL); assert.deepEqual(status.models, [HORDE_MODEL], 'the model selection flag cannot expose paid routes on a free server');
  let solo!: Awaited<ReturnType<typeof api.create>>;
  for (const mode of ['ai-date', 'blind-date'] as const) {
    const session = await api.create(mode); if (mode === 'ai-date') solo = session;
    assert.equal(session.state.evening.chemistry?.unlocked, false);
    const response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'free-first-turn', text: 'Hello, it is nice to meet you.', model: HORDE_MODEL });
    assert.equal(response.status, 200); const stream = events(await response.text());
    assert.equal(stream.some(event => event.type === 'error'), false); assert.ok(stream.some(event => event.type === 'utterance'));
    const state = await api.soloState(session);
    assert.equal(state.conversationModel, HORDE_MODEL); assert.equal(state.evening.chemistry?.unlocked, false, 'free dialogue does not manufacture relationship progress');
    assert.equal(state.usage.claudeRequests, 1); assert.equal(state.usage.inputTokens, 1_000_000); assert.equal(state.usage.claudeCost, 0); assert.equal(state.usage.totalCost, 0);
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', DOLPHIN_MODEL]) {
      const paid = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'force-paid', text: 'Try a different model.', model });
      assert.equal(paid.status, 400, 'a client cannot select a paid provider');
    }
  }
  const { h1 } = await api.pair(); assert.equal(h1.state.model, HORDE_MODEL);
  const next = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'free-double-first', text: 'Hello everyone.', target: 'table' }); assert.equal(next.status, 202);
  const room = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(room.error, undefined); assert.equal(room.model, HORDE_MODEL); assert.ok(room.lines.some(line => line.speaker === 'd1' && line.text === 'I am glad we have a table together.'));
  assert.equal(room.usage.inputTokens, 1_000_000); assert.equal(room.usage.claudeCost, 0); assert.equal(room.usage.totalCost, 0);
  for (const view of Object.values(room.views)) assert.equal(view.evening.chemistry?.unlocked, false);
  const keepFree = await api.request(api.roomPath(h1) + '/command', h1.token, { type: 'set-model', model: HORDE_MODEL }); assert.equal(keepFree.status, 200);
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', DOLPHIN_MODEL]) {
    const forced = await api.request(api.roomPath(h1) + '/command', h1.token, { type: 'set-model', model }); assert.equal(forced.status, 400);
    const fresh = await api.request('/api/double-date/rooms', '', { name: 'A new player', model }); assert.equal(fresh.status, 400);
  }
  assert.equal(requests.length, 3, 'rejected paid selections never create provider requests');
  unavailable = true;
  const soloFailure = await api.request(api.soloPath(solo) + '/turn', solo.token, { turnId: 'free-default-outage', text: 'Are you still there?', model: HORDE_MODEL });
  assert.ok(events(await soloFailure.text()).some(event => event.type === 'error' && event.code === 'horde_provider'), 'an outage remains a Horde error rather than invoking an unconfigured paid provider');
  const doubleFailure = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'free-default-outage', text: 'Are you still there?', target: 'table' }); assert.equal(doubleFailure.status, 202);
  const failedRoom = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 2);
  assert.equal(failedRoom.error?.code, 'horde_provider'); assert.equal(failedRoom.usage.totalCost, 0); assert.equal((await api.soloState(solo)).usage.totalCost, 0);
  assert.equal(requests.length, 5, 'each failed turn makes exactly one free request');
});

test('missing Dolphin configuration keeps Haiku available and rejects unavailable models before calls', async t => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream(request) { calls++; assert.equal(request.model, 'claude-haiku-5-5'); yield { type: 'text', text: encode(dateTurn) }; } };
  const api = await boot({ claude: adapter, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none', DATE_DEFAULT_MODEL: 'dolphin' } }); t.after(() => api.close());
  const status = await (await fetch(api.url + '/api/date/status')).json();
  assert.equal(status.defaultModel, 'claude-haiku-5-5'); assert.equal(status.dolphin, false);
  assert.deepEqual(status.models, ['claude-haiku-5-5']);
  const session = await api.create(), path = api.soloPath(session);
  for (const model of [DOLPHIN_MODEL, 'claude-sonnet-5-5']) {
    const response = await api.request(path + '/turn', session.token, { turnId: model === DOLPHIN_MODEL ? 'unavailable' : 'restricted', text: 'Hello.', model });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  const response = await api.request(path + '/turn', session.token, { turnId: 'normal-haiku', text: 'Hello.', model: 'claude-haiku-5-5' });
  assert.equal(events(await response.text()).some(event => event.type === 'error'), false); assert.equal(calls, 1);
});

test('Double routing unlocks Dolphin per couple while the other couple and manual room controls remain locked', async t => {
  const anthropicRequests: ClaudeRequest[] = [], dolphinRequests: ClaudeRequest[] = [];
  const firstClue = 'I want time to choose how this evening develops.', secondClue = 'I prefer deciding about another date after enjoying this one.';
  const tableResult = (speaker: 'h1' | 'h2', text: string, emotion: 'warm' | 'flirtatious', agenda: SceneTurn['agenda']) => ({
    utterances: [{ speaker: speaker === 'h1' ? 'd1' : 'd2', text, emotion }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? emotion : 'neutral', memory: '',
      social: { ...neutral, signal: actorId === 'd1' && speaker === 'h1' ? 'kindness' : 'none' },
      agenda: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? agenda : { signal: 'none', evidence: '', clue: '' } })),
  });
  const anthropic: ClaudeAdapter = { async *stream(request) {
    anthropicRequests.push(request); assert.equal(request.model, 'claude-haiku-5-5');
    const context = JSON.parse(request.messages.at(-1)!.content), speaker = context.humanTurn.speaker as 'h1' | 'h2';
    const actor = context.characters.find((item: { humanId: string }) => item.humanId === speaker), index = anthropicRequests.length;
    const signal = actor.agenda.evidenceReady ? actor.agenda.nextMilestone ?? 'none' : 'none';
    const text = speaker === 'h2' ? 'I would enjoy making my own choices at this table.' : index === 1 ? firstClue : index === 2 ? secondClue : index === 3 ? 'You noticed why a little space matters to me.' : index === 4 ? 'You listened. That matters more than an impressive speech.' : index === 5 ? 'Your grin is making this a pleasantly distracting dinner.' : 'You have me thinking of another excuse to see you smile.';
    yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 100 } };
    yield { type: 'text', text: encode(tableResult(speaker, text, speaker === 'h1' && index >= 5 ? 'flirtatious' : 'warm', { signal, evidence: signal === 'none' ? '' : context.humanTurn.text, clue: index <= 2 ? text : '' })) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) {
    dolphinRequests.push(request); assert.equal(request.model, DOLPHIN_MODEL);
    const context = JSON.parse(request.messages.at(-1)!.content); assert.equal(context.humanTurn.speaker, 'h1');
    yield { type: 'usage', usage: { inputTokens: 125, outputTokens: 100 } };
    yield { type: 'text', text: encode(tableResult('h1', 'I would like to hear what you have in mind for another evening.', 'warm', { signal: 'none', evidence: '', clue: '' })) };
  } };
  const api = await boot({ claude: anthropic, dolphin, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none', DATE_DEFAULT_MODEL: 'dolphin' } });
  t.after(() => api.close()); const { h1, h2 } = await api.pair();
  const playerLines = ['What would you enjoy from tonight?', 'You want room to choose how the evening develops.', 'Being considered matters more than being organized for you.', 'Pick what you want; I will keep my own preference.', 'I keep catching your grin and losing my clever lines.', 'If we linger a little longer, I might stop pretending I am only here for dinner.'];
  for (let index = 0; index < playerLines.length; index++) {
    const response = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: `double-earn-${index}`, text: playerLines[index], target: 'd1' });
    assert.equal(response.status, 202);
    const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === index + 1);
    assert.equal(state.error, undefined); assert.equal(state.model, 'claude-haiku-5-5');
    assert.equal(state.views.h1.evening.chemistry?.unlocked, false, 'the current reciprocal line still needs owner delivery');
    assert.equal(state.views.h2.evening.chemistry?.unlocked, false);
    const line = [...state.lines].reverse().find(line => line.speaker === 'd1'); assert.ok(line);
    const receipt = await api.request(api.roomPath(h1) + '/playback', h1.token, { lineId: line.id, generation: line.generation, completed: true, playedSeconds: 3 });
    assert.equal(receipt.status, 200);
    const delivered = await api.roomState(h1);
    assert.equal(delivered.views.h1.evening.chemistry?.unlocked, index === playerLines.length - 1);
    assert.equal(delivered.views.h2.evening.chemistry?.unlocked, false);
  }
  assert.equal(anthropicRequests.length, 6); assert.equal(dolphinRequests.length, 0);
  const h1Next = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-unlocked', text: 'I would like to talk about sexual fantasies after dinner.', target: 'd1' });
  assert.equal(h1Next.status, 202);
  await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 7);
  assert.equal(dolphinRequests.length, 1); assert.equal(anthropicRequests.length, 6, 'one table response uses one selected provider');
  const h2Next = await api.request(api.roomPath(h2) + '/turn', h2.token, { turnId: 'double-other-still-locked', text: 'Jules, I would like to hear about your evening.', target: 'd2' });
  assert.equal(h2Next.status, 202);
  const after = await until(() => api.roomState(h2), state => !state.processing && state.usage.claudeRequests === 8);
  assert.equal(anthropicRequests.length, 7); assert.equal(dolphinRequests.length, 1);
  assert.equal(JSON.parse(anthropicRequests.at(-1)!.messages.at(-1)!.content).humanTurn.speaker, 'h2');
  assert.equal(after.views.h1.evening.chemistry?.unlocked, true); assert.equal(after.views.h2.evening.chemistry?.unlocked, false);
  const forced = await api.request(api.roomPath(h1) + '/command', h1.token, { type: 'set-model', model: DOLPHIN_MODEL });
  assert.equal(forced.status, 409); assert.equal((await forced.json()).code, 'dolphin_locked', 'a host cannot switch the whole room after earning only their own unlock');
  const fresh = await api.request('/api/double-date/rooms', '', { name: 'A new player', model: DOLPHIN_MODEL });
  assert.equal(fresh.status, 409); assert.equal((await fresh.json()).code, 'dolphin_locked');
  assert.equal(anthropicRequests.length + dolphinRequests.length, 8, 'manual attempts create no extra provider or cast requests');
});

test('Double automatic topic routing respects each couple’s unlock, delivered public followups and explicit topic changes', async t => {
  const anthropicRequests: ClaudeRequest[] = [], hordeRequests: ClaudeRequest[] = [], dolphinRequests: ClaudeRequest[] = [];
  let hordeFails = false;
  const firstClue = 'I want time to choose how this evening develops.', secondClue = 'I prefer deciding about another date after enjoying this one.';
  const result = (speaker: 'h1' | 'h2', text: string, emotion: 'warm' | 'flirtatious', agenda: SceneTurn['agenda']) => ({
    utterances: [{ speaker: speaker === 'h1' ? 'd1' : 'd2', text, emotion }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? emotion : 'neutral', memory: '',
      social: { ...neutral, signal: actorId === 'd1' && speaker === 'h1' ? 'kindness' : 'none' },
      agenda: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? agenda : { signal: 'none', evidence: '', clue: '' } })),
  });
  const anthropic: ClaudeAdapter = { async *stream(request) {
    anthropicRequests.push(request); assert.equal(request.model, 'claude-haiku-5-5');
    const context = JSON.parse(request.messages.at(-1)!.content), speaker = context.humanTurn.speaker as 'h1' | 'h2';
    const actor = context.characters.find((item: { humanId: string }) => item.humanId === speaker), index = anthropicRequests.length;
    const signal = actor.agenda.evidenceReady ? actor.agenda.nextMilestone ?? 'none' : 'none';
    const text = speaker === 'h2' ? 'I would enjoy making my own choices at this table.' : index === 1 ? firstClue : index === 2 ? secondClue : index === 3 ? 'You noticed why a little space matters to me.' : index === 4 ? 'You listened. That matters more than an impressive speech.' : index === 5 ? 'Your grin is making this a pleasantly distracting dinner.' : 'You have me thinking of another excuse to see you smile.';
    yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 100 } };
    yield { type: 'text', text: encode(result(speaker, text, speaker === 'h1' && index >= 5 ? 'flirtatious' : 'warm', { signal, evidence: signal === 'none' ? '' : context.humanTurn.text, clue: index <= 2 ? text : '' })) };
  } };
  const horde: ClaudeAdapter = { async *stream(request) {
    hordeRequests.push(request); assert.equal(request.model, HORDE_MODEL);
    assert.equal(JSON.parse(request.messages.at(-1)!.content).humanTurn.speaker, 'h1');
    yield { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 100 } };
    if (hordeFails) throw new DateApiError(502, 'horde_provider', 'The volunteer workers are unavailable.');
    yield { type: 'text', text: encode(result('h1', 'We can talk about attraction and sexual fantasies after dinner.', 'warm', { signal: 'none', evidence: '', clue: '' })) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) { dolphinRequests.push(request); throw new Error('Horde must never fall back to Dolphin.'); } };
  const api = await boot({ claude: anthropic, horde, dolphin, env: { NODE_ENV: 'production', DATE_SPEECH_PROVIDER: 'none', DATE_EARNED_PROVIDER: 'aihorde', DATE_SESSION_LIMIT_USD: '.05' } });
  t.after(() => api.close()); const { h1, h2 } = await api.pair();
  assert.equal(h1.state.model, 'claude-haiku-5-5');
  const playerLines = ['What would you enjoy from tonight?', 'You want room to choose how the evening develops.', 'Being considered matters more than being organized for you.', 'Pick what you want; I will keep my own preference.', 'I keep catching your grin and losing my clever lines.', 'If we linger a little longer, I might stop pretending I am only here for dinner.'];
  for (let index = 0; index < playerLines.length; index++) {
    const response = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: `double-horde-earn-${index}`, text: playerLines[index], target: 'd1' });
    assert.equal(response.status, 202);
    const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === index + 1);
    assert.equal(state.error, undefined); assert.equal(state.model, 'claude-haiku-5-5');
    assert.equal(state.views.h1.evening.chemistry?.unlocked, false, 'the current reciprocal line still needs owner delivery');
    assert.equal(state.views.h2.evening.chemistry?.unlocked, false);
    const line = [...state.lines].reverse().find(line => line.speaker === 'd1'); assert.ok(line);
    const receipt = await api.request(api.roomPath(h1) + '/playback', h1.token, { lineId: line.id, generation: line.generation, completed: true, playedSeconds: 3 });
    assert.equal(receipt.status, 200);
    const delivered = await api.roomState(h1);
    assert.equal(delivered.views.h1.evening.chemistry?.unlocked, index === playerLines.length - 1);
    assert.equal(delivered.views.h2.evening.chemistry?.unlocked, false);
  }
  const ordinary = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-unlocked-ordinary', text: 'What music do you enjoy?', target: 'd1' }); assert.equal(ordinary.status, 202);
  const afterOrdinary = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 7);
  assert.equal(afterOrdinary.error, undefined); assert.equal(afterOrdinary.views.h1.conversationModel, 'claude-haiku-5-5'); assert.equal(anthropicRequests.length, 7); assert.equal(hordeRequests.length, 0);
  const before = await api.roomState(h1), request = { turnId: 'double-free-horde', text: 'I would like to talk about sexual fantasies after dinner.', target: 'd1' };
  const next = await api.request(api.roomPath(h1) + '/turn', h1.token, request); assert.equal(next.status, 202);
  const freeReply = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 8);
  assert.equal(freeReply.error, undefined); assert.equal(hordeRequests.length, 1); assert.equal(anthropicRequests.length, 7);
  assert.equal(freeReply.usage.claudeCost, before.usage.claudeCost); assert.equal(freeReply.usage.inputTokens, before.usage.inputTokens + 1_000_000);
  const duplicate = await api.request(api.roomPath(h1) + '/turn', h1.token, request); assert.equal(duplicate.status, 200); assert.equal(hordeRequests.length, 1);
  const adultLine = [...freeReply.lines].reverse().find(line => line.speaker === 'd1'); assert.ok(adultLine);
  const receipt = await api.request(api.roomPath(h1) + '/playback', h1.token, { lineId: adultLine.id, generation: adultLine.generation, completed: true, playedSeconds: 3 }); assert.equal(receipt.status, 200);
  const followup = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-adult-followup', text: 'Tell me more about that.', target: 'd1' }); assert.equal(followup.status, 202);
  const afterFollowup = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 9);
  assert.equal(afterFollowup.error, undefined); assert.equal(hordeRequests.length, 2); assert.equal(anthropicRequests.length, 7);
  const other = await api.request(api.roomPath(h2) + '/turn', h2.token, { turnId: 'double-horde-other-locked', text: 'Tell me more about that.', target: 'd2' }); assert.equal(other.status, 202);
  const afterOther = await until(() => api.roomState(h2), state => !state.processing && state.usage.claudeRequests === 10);
  assert.equal(anthropicRequests.length, 8); assert.equal(hordeRequests.length, 2); assert.equal(afterOther.views.h2.evening.chemistry?.unlocked, false, 'a public adult topic does not unlock the other couple');
  const food = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'double-back-to-food', text: 'Which dessert would you order?', target: 'd1' }); assert.equal(food.status, 202);
  const afterFood = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 11);
  assert.equal(afterFood.error, undefined); assert.equal(afterFood.views.h1.conversationModel, 'claude-haiku-5-5'); assert.equal(anthropicRequests.length, 9); assert.equal(hordeRequests.length, 2);
  assert.equal(anthropicRequests.length + hordeRequests.length, 11, 'topic routing adds no classifier or cast request');
  const forced = await api.request(api.roomPath(h1) + '/command', h1.token, { type: 'set-model', model: HORDE_MODEL });
  assert.equal(forced.status, 200, 'the host may explicitly choose Horde without changing either couple’s chemistry');
  const fresh = await api.request('/api/double-date/rooms', '', { name: 'A new player', model: HORDE_MODEL });
  assert.equal(fresh.status, 201); assert.equal((await fresh.json()).state.model, HORDE_MODEL);
  hordeFails = true;
  const failed = await api.request(api.roomPath(h1) + '/turn', h1.token, { ...request, turnId: 'double-horde-outage' }); assert.equal(failed.status, 202);
  const final = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 12);
  assert.equal(final.error?.code, 'horde_provider'); assert.equal(final.usage.claudeCost, afterFood.usage.claudeCost);
  assert.equal(anthropicRequests.length, 9); assert.equal(hordeRequests.length, 3); assert.equal(dolphinRequests.length, 0, 'a Horde outage cannot use a paid fallback');
});

for (const mode of ['ai-date', 'blind-date'] as const) test(`${mode}: a redirected provider-limited topic is removed from private history before a fresh ordinary turn`, async t => {
  const blocked = `provider-blocked-marker-${mode}`, ordinary = 'What dessert would you choose tonight?', requests: ClaudeRequest[] = [];
  const adapter: ClaudeAdapter = { async *stream(request) {
    requests.push(structuredClone(request));
    yield { type: 'usage', usage: { inputTokens: 64, outputTokens: 50 } };
    if (JSON.stringify(request.messages).includes(blocked)) throw new DateApiError(422, 'conversation_refusal', 'This placeholder topic was refused.');
    yield { type: 'text', text: encode(dateTurn) };
  } };
  const api = await boot({ claude: adapter }); t.after(() => api.close()); const session = await api.create(mode), path = api.soloPath(session);
  const first = await api.request(path + '/turn', session.token, { turnId: 'limited-topic', text: blocked, model: 'claude-haiku-5-5' });
  assert.equal(events(await first.text()).some(event => event.type === 'error'), false);
  assert.ok((await api.soloState(session)).evening.cues.some(cue => cue.key === 'table-check'));
  const second = await api.request(path + '/turn', session.token, { turnId: 'fresh-dinner-topic', text: ordinary, model: 'claude-haiku-5-5' });
  const stream = events(await second.text());
  assert.equal(stream.some(event => event.type === 'error'), false);
  const reply = stream.find(event => event.type === 'utterance');
  assert.ok(reply?.type === 'utterance'); assert.equal(reply.utterance.text, dateTurn.utterances[0].text, 'the ordinary topic receives a normal response rather than another filter loop');
  assert.equal(requests.length, 2, 'the redirect never retries or rephrases the blocked request');
  assert.ok(JSON.stringify(requests[0].messages).includes(blocked));
  assert.equal(JSON.stringify(requests[1].messages).includes(blocked), false);
  assert.ok(JSON.stringify(requests[1].messages).includes('[A provider-limited topic was redirected back to dinner. No personal boundary strike occurred.]'));
  assert.equal(humanLine(noteOf(requests[1])), ordinary);
  const state = await api.soloState(session); assertUnpunished(state);
  assert.equal(state.usage.claudeRequests, 2);
  assert.equal(state.evening.cues.filter(cue => cue.key === 'table-check').length, 1);
});

test('Double private history resets a provider-limited topic while preserving the original public speaker line', async t => {
  const blocked = 'provider-blocked-marker-double', ordinary = 'What dessert looks good to you both?', requests: ClaudeRequest[] = [];
  const adapter: ClaudeAdapter = { async *stream(request) {
    requests.push(structuredClone(request));
    yield { type: 'usage', usage: { inputTokens: 75, outputTokens: 50 } };
    if (JSON.stringify(request.messages).includes(blocked)) throw new DateApiError(422, 'conversation_refusal', 'This placeholder topic was refused.');
    yield { type: 'text', text: encode({ utterances: [{ speaker: 'd2', text: 'The lemon posset looks good to me.', emotion: 'warm' }], dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: '', social: neutral })) }) };
  } };
  const api = await boot({ claude: adapter }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  const first = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'limited-topic', text: blocked, target: 'table' });
  assert.equal(first.status, 202);
  const redirected = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(redirected.error, undefined); assert.ok(redirected.lines.some(line => line.speaker === 'h1' && line.text === blocked));
  const second = await api.request(api.roomPath(h2) + '/turn', h2.token, { turnId: 'fresh-dinner-topic', text: ordinary, target: 'table' });
  assert.equal(second.status, 202);
  const state = await until(() => api.roomState(h2), state => !state.processing && state.usage.claudeRequests === 2);
  assert.equal(state.error, undefined); assert.equal(requests.length, 2);
  assert.equal(JSON.stringify(requests[1].messages).includes(blocked), false);
  assert.ok(JSON.stringify(requests[1].messages).includes('[A provider-limited topic was redirected back to dinner. No personal boundary strike occurred.]'));
  const current = JSON.parse(requests[1].messages.at(-1)!.content).humanTurn;
  assert.equal(current.text, ordinary); assert.equal(current.speaker, 'h2');
  assert.ok(state.lines.some(line => line.speaker === 'h1' && line.text === blocked), 'only the private model history is sanitized');
  assert.ok(state.lines.some(line => line.speaker === 'h2' && line.text === ordinary));
  assert.ok(state.lines.some(line => line.speaker === 'd2' && line.text === 'The lemon posset looks good to me.'));
  for (const view of Object.values(state.views)) assertUnpunished(view);
  assert.equal(Object.values(state.views).flatMap(view => view.evening.cues).filter(cue => cue.key === 'table-check').length, 1);
});

function chunkedDialogue(result: unknown, called: () => void): ClaudeAdapter {
  return { async *stream() {
    called(); yield { type: 'usage', usage: { inputTokens: 90, outputTokens: 90 } };
    const raw = encode(result);
    for (let position = 0; position < raw.length; position += 17) yield { type: 'text', text: raw.slice(position, position + 17) };
  } };
}

for (const mode of ['ai-date', 'blind-date'] as const) for (const speaker of ['date', 'waiter', 'diner'] as const) test(`${mode}: a silent optional ${speaker} is normalized consistently during streaming and final validation`, async t => {
  let calls = 0;
  const result = { ...dateTurn, memory: 'A specific completed conversation memory.', utterances: [dateTurn.utterances[0], { speaker, text: ' \t ', emotion: 'neutral' }] };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const session = await api.create(mode), path = api.soloPath(session);
  const request = { turnId: 'silent-optional', text: 'Tell me what you are thinking.', model: 'claude-haiku-5-5' };
  const response = await api.request(path + '/turn', session.token, request); assert.equal(response.status, 200);
  const raw = await response.text(), stream = events(raw), spoken = stream.filter(event => event.type === 'utterance');
  assert.equal(stream.some(event => event.type === 'error'), false);
  assert.equal(spoken.length, 1); assert.equal(spoken[0].utterance.speaker, 'date'); assert.equal(spoken[0].utterance.text, dateTurn.utterances[0].text);
  assert.equal(spoken[0].index, 0);
  const state = await api.soloState(session); assertUnpunished(state);
  assert.equal(state.memory, result.memory); assert.equal(state.usage.claudeRequests, 1); assert.equal(calls, 1);
  const duplicate = await api.request(path + '/turn', session.token, request);
  assert.equal(await duplicate.text(), raw); assert.equal(calls, 1, 'normalizing silence never requires a retry');
});

for (const speaker of ['waiter', 'diner', 'd2'] as const) test(`Double: a silent optional ${speaker} creates no line and still commits the validated character updates`, async t => {
  let calls = 0;
  const result = { utterances: [{ speaker: 'd1', text: 'I am enjoying this conversation.', emotion: 'amused' }, { speaker, text: ' \t ', emotion: 'neutral' }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: `Committed ${actorId} memory after a silent placeholder.`, social: neutral })) };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const { h1 } = await api.pair();
  const before = await api.roomState(h1), oldLines = new Set(before.lines.map(line => line.id));
  const request = { turnId: 'silent-optional', text: 'Tell me what you are thinking.', target: 'table' };
  const response = await api.request(api.roomPath(h1) + '/turn', h1.token, request); assert.equal(response.status, 202);
  const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(state.error, undefined);
  const spoken = state.lines.filter(line => !oldLines.has(line.id) && !['h1', 'h2'].includes(line.speaker));
  assert.equal(spoken.length, 1); assert.equal(spoken[0].speaker, 'd1'); assert.equal(spoken[0].text, result.utterances[0].text);
  assert.equal(state.views.h1.memory, result.dateUpdates[0].memory); assert.equal(state.views.h2.memory, result.dateUpdates[1].memory);
  for (const view of Object.values(state.views)) assertUnpunished(view);
  assert.equal(calls, 1);
  const duplicate = await api.request(api.roomPath(h1) + '/turn', h1.token, request); assert.equal(duplicate.status, 200); assert.equal(calls, 1);
});

const invalidSoloReplies: { name: string; patch: Record<string, unknown>; field?: string; index?: number; hiddenText?: string }[] = [
  { name: 'empty primary date', patch: { utterances: [{ speaker: 'date', text: ' ', emotion: 'neutral' }] }, field: 'utterance_text_empty', index: 0 },
  { name: 'unknown empty optional speaker', patch: { utterances: [dateTurn.utterances[0], { speaker: 'system', text: '', emotion: 'neutral' }] }, field: 'utterance_text_empty', index: 1 },
  { name: 'oversized nonempty primary date', patch: { utterances: [{ speaker: 'date', text: 'private-oversized-sentinel-' + 'x'.repeat(421), emotion: 'neutral' }] }, field: 'utterance_text_length', index: 0, hiddenText: 'private-oversized-sentinel-' },
  { name: 'date clauses exceeding the combined 420-character reply budget', patch: { utterances: [{ speaker: 'date', text: 'A'.repeat(211), emotion: 'neutral' }, { speaker: 'date', text: 'B'.repeat(210), emotion: 'neutral' }] }, field: 'date_response_length' },
  { name: 'silent optional line with an extra property', patch: { utterances: [dateTurn.utterances[0], { speaker: 'waiter', text: '', emotion: 'neutral', points: 100 }] }, field: 'utterance_shape', index: 1 },
  { name: 'silent optional line with an invalid emotion', patch: { utterances: [dateTurn.utterances[0], { speaker: 'waiter', text: '', emotion: 'admin' }] }, field: 'utterance_text_empty', index: 1 },
  { name: 'an invalid action despite a valid silent placeholder', patch: { action: 'teleport', utterances: [dateTurn.utterances[0], { speaker: 'waiter', text: '', emotion: 'neutral' }] } },
  { name: 'three raw utterances despite silent placeholders', patch: { utterances: [dateTurn.utterances[0], { speaker: 'waiter', text: '', emotion: 'neutral' }, { speaker: 'diner', text: '', emotion: 'neutral' }] } },
];
for (const invalid of invalidSoloReplies) test(`Solo normalization still rejects ${invalid.name}`, async t => {
  let calls = 0;
  const result = { ...dateTurn, memory: 'This invalid response must not commit memory.', ...invalid.patch };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const session = await api.create();
  const response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'invalid-silent-contract', text: 'A normal human turn.', model: 'claude-haiku-5-5' });
  const stream = events(await response.text()), failure = stream.find(event => event.type === 'error');
  assert.ok(failure?.type === 'error'); assert.equal(failure.code, 'invalid_dialogue');
  if (invalid.field) assert.deepEqual(failure.details, { field: invalid.field, ...(invalid.index === undefined ? {} : { index: invalid.index }) });
  if (invalid.hiddenText) assert.equal(encode(stream).includes(invalid.hiddenText), false, 'diagnostics contain field/index but never rejected raw dialogue');
  const state = await api.soloState(session); assertUnpunished(state); assert.equal(state.memory, '');
  assert.equal(state.usage.claudeRequests, 1); assert.equal(calls, 1);
});

for (const exactBudget of [false, true]) test(`Solo accepts two date clauses ${exactBudget ? 'at the combined 420-character limit' : 'within one bounded reply'} without losing memory or adding calls`, async t => {
  let calls = 0;
  const utterances = exactBudget ? [{ speaker: 'date', text: 'A'.repeat(210), emotion: 'warm' }, { speaker: 'date', text: 'B'.repeat(209), emotion: 'amused' }]
    : [{ speaker: 'date', text: 'That is an interesting answer.', emotion: 'warm' }, { speaker: 'date', text: 'I want to hear the story behind it.', emotion: 'amused' }];
  const result = { ...dateTurn, utterances, memory: 'Both delivered clauses belong to one completed response.' };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const session = await api.create();
  const response = await api.request(api.soloPath(session) + '/turn', session.token, { turnId: 'two-date-clauses', text: 'Tell me what you think.', model: 'claude-haiku-5-5' });
  const stream = events(await response.text()), spoken = stream.filter(event => event.type === 'utterance');
  assert.equal(stream.some(event => event.type === 'error'), false);
  assert.deepEqual(spoken.map(event => event.utterance.text), utterances.map(line => line.text));
  assert.deepEqual(spoken.map(event => event.index), [0, 1]);
  const state = await api.soloState(session); assertUnpunished(state);
  assert.equal(state.memory, result.memory); assert.equal(state.usage.claudeRequests, 1); assert.equal(calls, 1);
});

const invalidDoubleLines = [
  { name: 'unknown empty roles', utterances: [{ speaker: 'd1', text: 'A legitimate first line.', emotion: 'neutral' }, { speaker: 'system', text: '', emotion: 'neutral' }] },
  { name: 'oversized nonempty lines', utterances: [{ speaker: 'd1', text: 'x'.repeat(421), emotion: 'neutral' }] },
  { name: 'two nonempty supporting speakers', utterances: [{ speaker: 'waiter', text: 'A waiter line.', emotion: 'neutral' }, { speaker: 'diner', text: 'A second supporting line.', emotion: 'neutral' }] },
  { name: 'silent lines with extra properties', utterances: [{ speaker: 'd1', text: 'A legitimate first line.', emotion: 'neutral' }, { speaker: 'waiter', text: '', emotion: 'neutral', points: 100 }] },
  { name: 'three raw lines even if two are silent', utterances: [{ speaker: 'd1', text: 'A legitimate first line.', emotion: 'neutral' }, { speaker: 'waiter', text: '', emotion: 'neutral' }, { speaker: 'diner', text: '', emotion: 'neutral' }] },
];
for (const invalid of invalidDoubleLines) test(`Double normalization still rejects ${invalid.name}`, async t => {
  let calls = 0;
  const result = { utterances: invalid.utterances, dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: 'An invalid response must not commit this.', social: neutral })) };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const { h1 } = await api.pair();
  const response = await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'invalid-silent-contract', text: 'A normal human turn.', target: 'table' }); assert.equal(response.status, 202);
  const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(state.error?.code, 'invalid_dialogue');
  for (const view of Object.values(state.views)) { assertUnpunished(view); assert.equal(view.memory, ''); }
  assert.equal(calls, 1);
});

test('Double may remain entirely silent with valid empty lines while committing factual updates', async t => {
  let calls = 0;
  const result = { utterances: [{ speaker: 'd1', text: '', emotion: 'neutral' }, { speaker: 'waiter', text: ' ', emotion: 'neutral' }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: 'The friends had conversational space.', social: neutral })) };
  const api = await boot({ claude: chunkedDialogue(result, () => calls++) }); t.after(() => api.close()); const { h1 } = await api.pair();
  const before = await api.roomState(h1), oldLines = new Set(before.lines.map(line => line.id));
  await api.request(api.roomPath(h1) + '/turn', h1.token, { turnId: 'legitimate-silence', text: 'Let me tell my friend a quick story.', target: 'h2' });
  const state = await until(() => api.roomState(h1), state => !state.processing && state.usage.claudeRequests === 1);
  assert.equal(state.error, undefined);
  assert.equal(state.lines.filter(line => !oldLines.has(line.id) && !['h1', 'h2'].includes(line.speaker)).length, 0);
  for (const view of Object.values(state.views)) { assertUnpunished(view); assert.equal(view.memory, result.dateUpdates[0].memory); }
  assert.equal(calls, 1);
});
