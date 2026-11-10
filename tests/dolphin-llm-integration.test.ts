import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { attachRestaurantServer, type RestaurantOptions } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import { DateApiError, type ClaudeAdapter, type ClaudeRequest } from '../server/restaurant/providers';
import { DOLPHIN_LLM_MODEL, type SceneTurn } from '../src/restaurant/types';
import { humanLine, noteOf, signalFor } from './helpers/turn-note';
import { doubleContext } from './helpers/double-note';
import type { DoubleRoomResponse, DoubleDateRoomState } from '../src/restaurant/double-date-types';

const neutral = { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false };
const solo = { utterances: [{ speaker: 'date', text: 'I remember that little blue umbrella.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'HUMAN: has a little blue umbrella.', social: neutral };
const double = { utterances: [{ speaker: 'd1', text: 'That little blue umbrella is memorable.', emotion: 'warm' }], dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'warm', memory: 'HUMAN: has a little blue umbrella.', social: neutral })) };
const adapter = (requests: ClaudeRequest[], fail = false): ClaudeAdapter => ({ async *stream(request) {
  requests.push(request);
  if (fail) throw new DateApiError(503, 'dolphin_provider', 'Dolphin LLM is unavailable.');
  yield { type: 'text', text: JSON.stringify(Object.hasOwn(request.outputSchema?.properties ?? {}, 'dateUpdates') ? double : solo) };
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40 } };
} });
async function boot(options: RestaurantOptions) {
  let restaurant: Awaited<ReturnType<typeof attachRestaurantServer>>, room: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  const http = createServer((req, res) => { if (!room.handle(req, res) && !restaurant.handle(req, res)) { res.statusCode = 404; res.end(); } });
  restaurant = await attachRestaurantServer(http, { env: {}, autoTick: false, ledgerPath: false, ...options });
  room = await attachDoubleDateServer(http, restaurant, { env: {}, autoTick: false, disconnectMs: 1e9 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const call = (path: string, token = '', value?: unknown) => fetch(url + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const seatPath = (seat: DoubleRoomResponse) => `/api/double-date/rooms/${seat.roomId}`;
  const okay = async (seat: DoubleRoomResponse, value: unknown) => { const r = await call(seatPath(seat) + '/command', seat.token, value); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).state as DoubleDateRoomState; };
  const settle = async (seat: DoubleRoomResponse) => { for (let i = 0; i < 150; i++) { const r = await call(seatPath(seat), seat.token); const state = (await r.json()).state as DoubleDateRoomState; if (!state.processing) return state; await delay(2); } throw new Error('Double turn did not settle.'); };
  return { call, seatPath, okay, settle, async close() { room.close(); await restaurant.close(); http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); } };
}

test('Solo direct selection, stateful next turn, accounting, and reset to Haiku', async t => {
  const direct: ClaudeRequest[] = [], standard: ClaudeRequest[] = [];
  const api = await boot({ dolphinLlm: adapter(direct), claude: adapter(standard) }); t.after(() => api.close());
  const created = await api.call('/api/date/sessions', '', { dateId: 'mira' }); assert.equal(created.status, 201);
  const { state, token } = await created.json(), path = `/api/date/sessions/${state.id}`;
  for (const [turnId, text] of [['one', 'I brought a little blue umbrella.'], ['two', 'What color was it?']]) {
    const response = await api.call(path + '/turn', token, { turnId, text, model: DOLPHIN_LLM_MODEL }); assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line)); assert.ok(!events.some(event => event.type === 'error')); assert.equal(events.at(-1).type, 'done');
  }
  assert.equal(direct.length, 2); assert.equal(standard.length, 0); assert.equal(direct[0].model, DOLPHIN_LLM_MODEL);
  const context = direct[1].messages.map(item => item.content).join('\n'); assert.match(context, /little blue umbrella/i); assert.match(context, /What color was it/);
  const snapshot = (await (await api.call(path, token)).json()).state; assert.equal(snapshot.usage.inputTokens, 200); assert.equal(snapshot.usage.outputTokens, 80);
  assert.ok(Math.abs(snapshot.usage.totalCost - (200 * .15 + 80 * .50) / 1e6) < 1e-10);
  assert.equal((await api.call(path + '/reset-model', token, {})).status, 200);
  const after = await api.call(path + '/turn', token, { turnId: 'reset', text: 'Still here?', model: 'claude-haiku-5-5' }); await after.text();
  assert.equal(standard.length, 1); assert.match(standard[0].messages.map(item => item.content).join('\n'), /little blue umbrella/i);
});

test('Double host chooses direct immediately, shares one stateful turn, then resets without losing conversation', async t => {
  const direct: ClaudeRequest[] = [], standard: ClaudeRequest[] = [];
  const api = await boot({ dolphinLlm: adapter(direct), claude: adapter(standard) }); t.after(() => api.close());
  const created = await api.call('/api/double-date/rooms', '', { name: 'Alex' }); assert.equal(created.status, 201); const h1 = await created.json() as DoubleRoomResponse;
  const joined = await api.call('/api/double-date/rooms/join', '', { code: h1.state.code, name: 'Jamie' }); assert.equal(joined.status, 201); const h2 = await joined.json() as DoubleRoomResponse;
  await api.okay(h1, { type: 'choose-date', dateId: 'mira' }); await api.okay(h2, { type: 'choose-date', dateId: 'jules' });
  for (const seat of [h1, h2]) await api.okay(seat, { type: 'ready', ready: true }); await api.okay(h1, { type: 'start' });
  const selected = await api.okay(h1, { type: 'set-model', model: DOLPHIN_LLM_MODEL }); assert.equal(selected.model, DOLPHIN_LLM_MODEL);
  for (const [seat, turnId, text] of [[h1, 'one', 'I brought a little blue umbrella.'], [h2, 'two', 'What color was it?']] as const) {
    const r = await api.call(api.seatPath(seat) + '/turn', seat.token, { turnId, text, target: 'table' }); assert.equal(r.status, 202); const state = await api.settle(seat); assert.equal(state.error, undefined);
  }
  assert.equal(direct.length, 2); assert.equal(standard.length, 0); assert.equal(direct[1].model, DOLPHIN_LLM_MODEL);
  assert.match(direct[1].messages.map(item => item.content).join('\n'), /little blue umbrella/i);
  const state = await api.settle(h2); assert.equal(state.usage.inputTokens, 200); assert.equal(state.usage.outputTokens, 80);
  assert.ok(Math.abs(state.usage.totalCost - (200 * .15 + 80 * .50) / 1e6) < 1e-10);
  const reset = await api.okay(h1, { type: 'reset-model' }); assert.equal(reset.model, 'claude-haiku-5-5');
  const r = await api.call(api.seatPath(h1) + '/turn', h1.token, { turnId: 'reset', text: 'Still here?', target: 'table' }); assert.equal(r.status, 202); await api.settle(h1);
  assert.equal(standard.length, 1); assert.match(standard[0].messages.map(item => item.content).join('\n'), /little blue umbrella/i);
});

test('blank secret remains unconfigured and direct provider failures never fall back', async t => {
  const offline = await boot({ env: { DOLPHIN_LLM_API_KEY: '   ' } }); t.after(() => offline.close());
  const status = await (await offline.call('/api/date/status')).json(); assert.ok(!status.models.includes(DOLPHIN_LLM_MODEL));
  const direct: ClaudeRequest[] = [], standard: ClaudeRequest[] = [];
  const api = await boot({ dolphinLlm: adapter(direct, true), claude: adapter(standard) }); t.after(() => api.close());
  const created = await api.call('/api/date/sessions', '', { dateId: 'mira' }); const { state, token } = await created.json();
  const response = await api.call(`/api/date/sessions/${state.id}/turn`, token, { turnId: 'error', text: 'Hello.', model: DOLPHIN_LLM_MODEL });
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line)); assert.ok(events.some(event => event.type === 'error' && event.code === 'dolphin_provider'));
  assert.equal(direct.length, 1); assert.equal(standard.length, 0);
});


const earnLines = ['What would you enjoy from tonight?', 'You want room to make your own choices tonight.', 'Being considered matters more than being organized for you.', 'Choose what you want; I will keep my own preference.', 'I keep catching your grin and losing track of my clever lines.', 'If we linger a little longer, I might finally stop pretending I am only here for dinner.'];
const dateLines = ['I want time to make my own choices tonight.', 'I would like to decide about another date after dinner.', 'You noticed why a little room matters to me.', 'You listened carefully. I appreciate that.', 'That smile of yours is making this dinner rather distracting.', 'Now you have me wondering what your next excuse to see me will be.'];
const turnEvents = (raw: string) => raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const forbiddenFallback = (): ClaudeAdapter => ({ async *stream() { throw new Error('An unselected provider was called.'); } });

test('Solo earned topic routing prefers direct Dolphin and returns to Haiku after a topic change', async t => {
  const haiku: ClaudeRequest[] = [], direct: ClaudeRequest[] = [];
  const standard: ClaudeAdapter = { async *stream(request) {
    haiku.push(request); const index = haiku.length, note = noteOf(request), signal = signalFor(note);
    const turn: SceneTurn = { utterances: [{ speaker: 'date', text: dateLines[index - 1] ?? 'Dessert sounds good.', emotion: index >= 5 && index <= 6 ? 'flirtatious' : 'warm' }], emotion: index >= 5 && index <= 6 ? 'flirtatious' : 'warm', action: 'none', memory: '', social: { ...neutral, signal: index >= 4 && index <= 6 ? 'kindness' : 'none' }, agenda: { signal, evidence: signal === 'none' ? '' : humanLine(note), clue: index <= 2 ? dateLines[index - 1] : '' } };
    yield { type: 'text', text: JSON.stringify(turn) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) { direct.push(request); assert.equal(request.model, DOLPHIN_LLM_MODEL); yield { type: 'text', text: JSON.stringify({ ...solo, memory: '', utterances: [{ speaker: 'date', text: 'We can talk about sexual compatibility and attraction.', emotion: 'warm' }] }) }; } };
  const api = await boot({ claude: standard, dolphinLlm: dolphin, dolphin: forbiddenFallback(), horde: forbiddenFallback(), env: { DATE_SPEECH_PROVIDER: 'none', DATE_ALLOW_MODEL_SELECTION: '1' } }); t.after(() => api.close());
  const created = await api.call('/api/date/sessions', '', { dateId: 'mira' }); const { state, token } = await created.json(), path = `/api/date/sessions/${state.id}`;
  for (const [index, text] of earnLines.entries()) {
    const response = await api.call(path + '/turn', token, { turnId: `earn-${index}`, text, model: 'claude-haiku-5-5' }); assert.equal(response.status, 200);
    const events = turnEvents(await response.text()), utterance = events.find(event => event.type === 'utterance'); assert.ok(utterance); assert.ok(!events.some(event => event.type === 'error'));
    const before = (await (await api.call(path, token)).json()).state; assert.equal(before.evening.chemistry.unlocked, false);
    assert.equal((await api.call(path + '/playback', token, { generation: before.generation, speaker: 'date', text: utterance.utterance.text, completed: true, playedSeconds: 3 })).status, 200);
    const after = (await (await api.call(path, token)).json()).state; assert.equal(after.evening.chemistry.unlocked, index === earnLines.length - 1);
  }
  const send = async (turnId: string, text: string) => {
    const r = await api.call(path + '/turn', token, { turnId, text, model: 'claude-haiku-5-5' }); assert.equal(r.status, 200); const events = turnEvents(await r.text()); assert.ok(!events.some(event => event.type === 'error')); return events;
  };
  await send('ordinary', 'What music do you enjoy?'); assert.equal(haiku.length, 7); assert.equal(direct.length, 0);
  const explicit = await send('adult', 'I would like to talk about sexual fantasies after dinner.'); assert.equal(direct.length, 1);
  const spoken = explicit.find(event => event.type === 'utterance'), afterAdult = (await (await api.call(path, token)).json()).state; assert.ok(spoken);
  assert.equal((await api.call(path + '/playback', token, { generation: afterAdult.generation, speaker: 'date', text: spoken.utterance.text, completed: true, playedSeconds: 3 })).status, 200);
  await send('followup', 'Tell me more about that.'); assert.equal(direct.length, 2);
  await send('dessert', 'Which dessert would you order?'); assert.equal(haiku.length, 8); assert.equal(direct.length, 2);
  assert.equal((await (await api.call(path, token)).json()).state.conversationModel, 'claude-haiku-5-5');
  const fresh = await (await api.call('/api/date/sessions', '', { dateId: 'mira' })).json();
  assert.equal(fresh.state.evening.chemistry.unlocked, false);
  const locked = await api.call(`/api/date/sessions/${fresh.state.id}/turn`, fresh.token, { turnId: 'before-unlock', text: 'I would like to talk about sexual fantasies after dinner.', model: 'claude-haiku-5-5' });
  assert.equal(locked.status, 200); assert.ok(!turnEvents(await locked.text()).some(event => event.type === 'error')); assert.equal(haiku.length, 9); assert.equal(direct.length, 2);
});

test('Double earned direct routing follows each human independently and returns to Haiku for ordinary talk', async t => {
  const haiku: ClaudeRequest[] = [], direct: ClaudeRequest[] = [];
  const result = (speaker: 'h1' | 'h2', text: string, emotion: 'warm' | 'flirtatious', agenda: SceneTurn['agenda']) => ({
    utterances: [{ speaker: speaker === 'h1' ? 'd1' : 'd2', text, emotion }],
    dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? emotion : 'neutral', memory: '', social: { ...neutral, signal: actorId === 'd1' && speaker === 'h1' ? 'kindness' : 'none' }, agenda: actorId === (speaker === 'h1' ? 'd1' : 'd2') ? agenda : { signal: 'none', evidence: '', clue: '' } })),
  });
  const standard: ClaudeAdapter = { async *stream(request) {
    haiku.push(request); const context = doubleContext(request), speaker = context.humanTurn.speaker as 'h1' | 'h2', actor = context.characters.find(item => item.humanId === speaker)!;
    const index = haiku.length, signal = actor.agenda.evidenceReady ? actor.agenda.nextMilestone ?? 'none' : 'none';
    const text = speaker === 'h2' ? 'I would enjoy making my own choices at this table.' : dateLines[index - 1] ?? 'Dessert sounds good.';
    yield { type: 'text', text: JSON.stringify(result(speaker, text, speaker === 'h1' && index >= 5 && index <= 6 ? 'flirtatious' : 'warm', { signal, evidence: signal === 'none' ? '' : context.humanTurn.text, clue: index <= 2 ? text : '' })) };
  } };
  const dolphin: ClaudeAdapter = { async *stream(request) { direct.push(request); assert.equal(request.model, DOLPHIN_LLM_MODEL); assert.equal(doubleContext(request).humanTurn.speaker, 'h1'); yield { type: 'text', text: JSON.stringify(result('h1', 'We can talk about sexual compatibility and attraction.', 'warm', { signal: 'none', evidence: '', clue: '' })) }; } };
  const api = await boot({ claude: standard, dolphinLlm: dolphin, dolphin: forbiddenFallback(), horde: forbiddenFallback(), env: { DATE_SPEECH_PROVIDER: 'none', DATE_ALLOW_MODEL_SELECTION: '1' } }); t.after(() => api.close());
  const created = await api.call('/api/double-date/rooms', '', { name: 'Alex' }); const h1 = await created.json() as DoubleRoomResponse;
  const joined = await api.call('/api/double-date/rooms/join', '', { code: h1.state.code, name: 'Jamie' }); const h2 = await joined.json() as DoubleRoomResponse;
  await api.okay(h1, { type: 'choose-date', dateId: 'mira' }); await api.okay(h2, { type: 'choose-date', dateId: 'jules' }); for (const seat of [h1, h2]) await api.okay(seat, { type: 'ready', ready: true }); await api.okay(h1, { type: 'start' });
  for (const [index, text] of earnLines.entries()) {
    const r = await api.call(api.seatPath(h1) + '/turn', h1.token, { turnId: `earn-${index}`, text, target: 'd1' }); assert.equal(r.status, 202);
    const state = await api.settle(h1); assert.equal(state.error, undefined); assert.equal(state.views.h1.evening.chemistry?.unlocked, false); assert.equal(state.views.h2.evening.chemistry?.unlocked, false);
    const line = [...state.lines].reverse().find(item => item.speaker === 'd1'); assert.ok(line);
    assert.equal((await api.call(api.seatPath(h1) + '/playback', h1.token, { lineId: line.id, generation: line.generation, completed: true, playedSeconds: 3 })).status, 200);
    const after = await api.settle(h1); assert.equal(after.views.h1.evening.chemistry?.unlocked, index === earnLines.length - 1); assert.equal(after.views.h2.evening.chemistry?.unlocked, false);
  }
  const send = async (seat: DoubleRoomResponse, turnId: string, text: string, target: 'd1' | 'd2') => {
    const r = await api.call(api.seatPath(seat) + '/turn', seat.token, { turnId, text, target }); assert.equal(r.status, 202); const state = await api.settle(seat); assert.equal(state.error, undefined); return state;
  };
  await send(h1, 'ordinary', 'What music do you enjoy?', 'd1'); assert.equal(haiku.length, 7); assert.equal(direct.length, 0);
  const adult = await send(h1, 'adult', 'I would like to talk about sexual fantasies after dinner.', 'd1'); assert.equal(direct.length, 1);
  const line = [...adult.lines].reverse().find(item => item.speaker === 'd1'); assert.ok(line);
  assert.equal((await api.call(api.seatPath(h1) + '/playback', h1.token, { lineId: line.id, generation: line.generation, completed: true, playedSeconds: 3 })).status, 200);
  await send(h1, 'followup', 'Tell me more about that.', 'd1'); assert.equal(direct.length, 2);
  const other = await send(h2, 'other', 'I would like to talk about sexual fantasies after dinner.', 'd2'); assert.equal(haiku.length, 8); assert.equal(direct.length, 2); assert.equal(other.views.h2.evening.chemistry?.unlocked, false);
  const ordinary = await send(h1, 'dessert', 'Which dessert would you order?', 'd1'); assert.equal(haiku.length, 9); assert.equal(direct.length, 2); assert.equal(ordinary.views.h1.conversationModel, 'claude-haiku-5-5');
});
