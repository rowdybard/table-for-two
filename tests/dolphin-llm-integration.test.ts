import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { attachRestaurantServer, type RestaurantOptions } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import { DateApiError, type ClaudeAdapter, type ClaudeRequest } from '../server/restaurant/providers';
import { DOLPHIN_LLM_MODEL } from '../src/restaurant/types';
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
