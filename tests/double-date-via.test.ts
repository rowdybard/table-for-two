import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mock, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { attachRestaurantServer } from '../server/restaurant';
import { attachDoubleDateServer } from '../server/double-date';
import { DoubleConversation } from '../server/double-date/conversation';
import type { ClaudeAdapter, ClaudeRequest } from '../server/restaurant/providers';
import type { DoubleDateRoomState, DoubleRoomResponse } from '../src/restaurant/double-date-types';

// The Double turn route accepts an optional `via` ("voice" | "typed") and hands it to the table
// conversation. It is provenance only: it must not change idempotency, billing or validation of
// anything else, and it must never be required.
const neutral = { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false };
const reply = () => JSON.stringify({ utterances: [{ speaker: 'd1', text: 'I have been meaning to ask about your music taste.', emotion: 'amused' }], dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: `The ${actorId} date remembers the table conversation.`, social: neutral })) });
const claude = (onCall: (request: ClaudeRequest) => void): ClaudeAdapter => ({ async *stream(request) {
  onCall(request);
  yield { type: 'usage', usage: { inputTokens: 120, cacheReadTokens: 15, cacheWriteTokens: 10 } };
  yield { type: 'text', text: reply() };
  yield { type: 'usage', usage: { outputTokens: 50 } };
} });

async function boot(onCall: (request: ClaudeRequest) => void) {
  let restaurant: Awaited<ReturnType<typeof attachRestaurantServer>>, double: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  const now = () => Date.UTC(2026, 10, 7, 12);
  const http = createServer((req, res) => { if (!double.handle(req, res) && !restaurant.handle(req, res)) { res.statusCode = 404; res.end(); } });
  restaurant = await attachRestaurantServer(http, { env: {}, autoTick: false, ledgerPath: false, now, claude: claude(onCall) });
  double = await attachDoubleDateServer(http, restaurant, { env: {}, autoTick: false, now, disconnectMs: 1e9 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token = '', value?: unknown) => fetch(url + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const path = (seat: DoubleRoomResponse) => `/api/double-date/rooms/${seat.roomId}`;
  const command = async (seat: DoubleRoomResponse, value: unknown) => { const r = await request(path(seat) + '/command', seat.token, value); assert.equal(r.status, 200, await r.clone().text()); };
  const poll = async (seat: DoubleRoomResponse) => { const r = await request(path(seat), seat.token); assert.equal(r.status, 200); return (await r.json()).state as DoubleDateRoomState; };
  const pair = async () => {
    const created = await request('/api/double-date/rooms', '', { name: 'Alex' }); assert.equal(created.status, 201);
    const h1 = await created.json() as DoubleRoomResponse;
    const joined = await request('/api/double-date/rooms/join', '', { code: h1.state.code, name: 'Jamie' }); assert.equal(joined.status, 201);
    const h2 = await joined.json() as DoubleRoomResponse;
    await command(h1, { type: 'choose-date', dateId: 'mira' }); await command(h2, { type: 'choose-date', dateId: 'jules' });
    for (const seat of [h1, h2]) await command(seat, { type: 'ready', ready: true });
    await command(h1, { type: 'start' });
    return { h1, h2 };
  };
  const settle = async (seat: DoubleRoomResponse) => { for (let i = 0; i < 150; i++) { const state = await poll(seat); if (!state.processing) return state; await delay(2); } throw new Error('Conversation did not settle.'); };
  const turn = (seat: DoubleRoomResponse, body: Record<string, unknown>) => request(path(seat) + '/turn', seat.token, body);
  return { turn, settle, pair, async close() { double.close(); await restaurant.close(); http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); } };
}

test('a Double turn may say it was spoken or typed, and the table conversation receives it', async t => {
  let calls = 0;
  const api = await boot(() => { calls++; }); t.after(() => api.close());
  const submit = mock.method(DoubleConversation.prototype, 'submit'); t.after(() => submit.mock.restore());
  const { h1, h2 } = await api.pair();
  assert.equal((await api.turn(h1, { turnId: 'spoken', text: 'I am a night nurse.', target: 'table', via: 'voice' })).status, 202); await api.settle(h1);
  assert.equal((await api.turn(h2, { turnId: 'typed', text: 'I paint on weekends.', target: 'table', via: 'typed' })).status, 202); await api.settle(h2);
  assert.equal((await api.turn(h1, { turnId: 'plain', text: 'What do you both listen to?', target: 'd1' })).status, 202); await api.settle(h1);
  assert.equal(calls, 3, 'one request per completed turn, however the words arrived');
  const requests = submit.mock.calls.map(call => call.arguments[1] as { turnId: string; text: string; target: string; via?: string });
  assert.deepEqual(requests.map(item => [item.turnId, item.via]), [['spoken', 'voice'], ['typed', 'typed'], ['plain', undefined]]);
  assert.equal('via' in requests[2], false, 'a turn that did not say how it arrived is forwarded exactly as before');
  assert.deepEqual(requests.map(item => item.text), ['I am a night nurse.', 'I paint on weekends.', 'What do you both listen to?']);
});

test('an unknown via value, or any other extra key, rejects the turn before any model call', async t => {
  let calls = 0;
  const api = await boot(() => { calls++; }); t.after(() => api.close());
  const submit = mock.method(DoubleConversation.prototype, 'submit'); t.after(() => submit.mock.restore());
  const { h1 } = await api.pair();
  const base = { text: 'I am a night nurse.', target: 'table' };
  const bad: [string, Record<string, unknown>][] = [
    ['spoken', { via: 'spoken' }], ['empty', { via: '' }], ['null', { via: null }], ['number', { via: 1 }], ['array', { via: ['voice'] }], ['object', { via: { kind: 'voice' } }], ['case', { via: 'Voice' }],
    ['extra key', { via: 'voice', transcriptConfidence: 0.2 }], ['extra key alone', { source: 'voice' }],
  ];
  for (const [name, extra] of bad) {
    const r = await api.turn(h1, { turnId: `bad-${name.replace(/\W/g, '-')}`, ...base, ...extra });
    assert.equal(r.status, 400, name); assert.equal((await r.json()).code, 'invalid_turn', name);
  }
  assert.equal(calls, 0); assert.equal(submit.mock.callCount(), 0);
  assert.equal((await api.turn(h1, { turnId: 'still-fine', ...base, via: 'voice' })).status, 202); await api.settle(h1);
  assert.equal(calls, 1);
});

test('how the words arrived never changes idempotency: a retry with another via is the same turn and is not rebilled', async t => {
  let calls = 0;
  const api = await boot(() => { calls++; }); t.after(() => api.close());
  const { h1 } = await api.pair();
  const body = { turnId: 'retry', text: 'I am a night nurse.', target: 'table' };
  assert.equal((await api.turn(h1, { ...body, via: 'voice' })).status, 202); await api.settle(h1);
  assert.equal((await api.turn(h1, { ...body, via: 'voice' })).status, 200);
  assert.equal((await api.turn(h1, { ...body, via: 'typed' })).status, 200);
  assert.equal((await api.turn(h1, body)).status, 200);
  await api.settle(h1);
  assert.equal(calls, 1);
  // A different transcript under the same ID is still a conflict.
  assert.equal((await api.turn(h1, { ...body, text: 'Something else entirely.', via: 'voice' })).status, 409);
  assert.equal(calls, 1);
});
