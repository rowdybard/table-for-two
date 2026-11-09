import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DoubleDateClient } from '../src/restaurant/DoubleDateClient';
import type { DoubleDateRoomState, DoubleRoomResponse } from '../src/restaurant/double-date-types';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState } from '../src/restaurant/types';

const storageKey = 'table-for-two-double-date';
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null };
const view: DinnerState = { id: 'table', generation: 0, mode: 'double-date', phase: 'paused', dateId: 'mira', stage: 'arrival', elapsed: 0, participants: [], events: [], emotion: 'neutral', seated: false, order: null, glassRaised: false, memory: '', usage, sessionLimit: 2, evening: createEvening('mira') };
const room: DoubleDateRoomState = { id: 'table', code: 'ABC123', mode: 'double-date', phase: 'waiting', hostId: 'h1', generation: 0, revision: 1, members: [], dates: [], views: { h1: view, h2: view }, lines: [{ id: 'line-1', generation: 0, speaker: 'h1', text: 'Hello, everyone.', emotion: 'neutral', at: 0 }], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] } };
const membership: DoubleRoomResponse = { roomId: room.id, memberId: 'h1', token: 'private-seat-token', state: room };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function environment(fetcher: typeof fetch) {
  const stored = new Map<string, string>(), previousFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  globalThis.fetch = fetcher;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
  return { stored, restore() { globalThis.fetch = previousFetch; if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else Reflect.deleteProperty(globalThis, 'sessionStorage'); } };
}
async function until(predicate: () => boolean) { for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(5); } throw new Error('Client did not reach expected state.'); }
const callbacks = (extra: Partial<ConstructorParameters<typeof DoubleDateClient>[0]> = {}) => ({ onState() {}, onLines() {}, onGeneration() {}, onSignals() {}, onConnection() {}, onError() {}, ...extra });

test('a stalled table command expires without losing the private seat and the next command works', async () => {
  let stalled = true;
  const env = environment(async (input, init) => {
    if (String(input).endsWith('/rooms') && init?.method === 'POST') return json(membership, 201);
    if (String(input).endsWith('/command') && stalled) return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
    return json({ state: room, signals: [] });
  });
  const client = new DoubleDateClient(callbacks(), { requestTimeoutMs: 20 });
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    await assert.rejects(client.command({ type: 'reset-model' }), /too long/);
    assert.equal(client.credentials?.token, membership.token); assert.equal(client.active, true);
    stalled = false; await client.command({ type: 'reset-model' });
    assert.equal(client.state?.id, room.id);
  } finally { client.dispose(); env.restore(); }
});

test('a stalled leave settles on its deadline and forgets the old seat without another frame', async () => {
  let signal: AbortSignal | null | undefined, keepalive: boolean | undefined, authorization = '';
  const env = environment(async (input, init) => {
    if (String(input).endsWith('/leave')) {
      signal = init?.signal; keepalive = init?.keepalive;
      authorization = (init?.headers as Record<string, string>).Authorization;
      return new Promise<Response>(() => {}); // Deliberately ignore abort too.
    }
    return init?.method === 'POST' ? json(membership, 201) : json({ state: room, signals: [] });
  });
  const client = new DoubleDateClient(callbacks(), { requestTimeoutMs: 20 });
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    await Promise.race([client.leave(), delay(1000).then(() => { throw new Error('Leave did not settle.'); })]);
    assert.ok(signal instanceof AbortSignal && signal.aborted);
    assert.equal(keepalive, true); assert.equal(authorization, `Bearer ${membership.token}`);
    assert.equal(client.active, false); assert.equal(env.stored.has(storageKey), false);
  } finally { client.dispose(); env.restore(); }
});

test('a stalled page-departure leave preserves the private seat for restore', async () => {
  let signal: AbortSignal | null | undefined;
  const env = environment(async (input, init) => {
    if (String(input).endsWith('/leave')) { signal = init?.signal; return new Promise<Response>(() => {}); }
    return init?.method === 'POST' ? json(membership, 201) : json({ state: room, signals: [] });
  });
  const client = new DoubleDateClient(callbacks(), { requestTimeoutMs: 20 });
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    await Promise.race([client.leave(false), delay(1000).then(() => { throw new Error('Leave did not settle.'); })]);
    assert.ok(signal instanceof AbortSignal && signal.aborted);
    assert.equal(client.credentials?.token, membership.token);
    assert.equal(JSON.parse(env.stored.get(storageKey)!).token, membership.token);
  } finally { client.dispose(); env.restore(); }
});

test('an old leave cannot clear or stop a replacement seat, whether it responds or times out', async () => {
  for (const finishOld of [true, false]) {
    const replacementRoom = { ...room, id: 'new-table' };
    const replacement = { ...membership, roomId: replacementRoom.id, token: 'new-private-seat-token', state: replacementRoom };
    let creates = 0, release!: (response: Response) => void, pollsNew = 0;
    const env = environment(async (input, init) => {
      const path = String(input);
      if (path.endsWith('/leave')) return new Promise<Response>(resolve => { release = resolve; });
      if (init?.method === 'POST') return json(++creates === 1 ? membership : replacement, 201);
      if (path.includes('/new-table')) { pollsNew++; return json({ state: replacementRoom, signals: [] }); }
      return json({ state: room, signals: [] });
    });
    const client = new DoubleDateClient(callbacks(), { requestTimeoutMs: 30 });
    try {
      await client.create('Alex', 'claude-haiku-5-5', 2);
      const leaving = client.leave();
      await client.create('Sam', 'claude-haiku-5-5', 2);
      if (finishOld) release(json({ state: room }));
      await Promise.race([leaving, delay(1000).then(() => { throw new Error('Old leave did not settle.'); })]);
      if (!finishOld) release(json({ state: room }));
      assert.equal(client.credentials?.token, replacement.token); assert.equal(client.state?.id, replacementRoom.id);
      assert.equal(JSON.parse(env.stored.get(storageKey)!).token, replacement.token);
      const before = pollsNew;
      await until(() => pollsNew > before);
      assert.equal(client.active, true);
    } finally { client.dispose(); env.restore(); }
  }
});

test('terminal poll 401/404 clears the private seat and stops retries with one expiry callback', async () => {
  for (const status of [401, 404]) {
    let polls = 0; const messages: string[] = [], connections: boolean[] = [];
    const env = environment(async (_input, init) => { if (init?.method === 'POST') return json(membership, 201); polls++; return json({ error: 'This table is no longer available.' }, status); });
    const client = new DoubleDateClient(callbacks({ onExpired(message) { messages.push(message); }, onConnection(connected) { connections.push(connected); } }));
    try {
      await client.create('Alex', 'claude-haiku-5-5', 2); await until(() => messages.length === 1);
      assert.equal(client.active, false); assert.equal(client.credentials, undefined); assert.equal(env.stored.has(storageKey), false); assert.equal(client.state?.id, room.id); assert.deepEqual(connections, [false]);
      await delay(330); assert.equal(polls, 1); assert.deepEqual(messages, ['This table is no longer available.']); assert.equal(await client.restore(), false); assert.equal(messages.length, 1);
    } finally { client.dispose(); env.restore(); }
  }
});

test('recoverable 503 retains saved credentials, retries, and recovers the same seat', async () => {
  let polls = 0; const messages: string[] = [], connections: boolean[] = [];
  const env = environment(async (_input, init) => { if (init?.method === 'POST') return json(membership, 201); if (++polls === 1) return json({ error: 'Temporarily unavailable.' }, 503); return json({ state: room, signals: [] }); });
  const client = new DoubleDateClient(callbacks({ onExpired(message) { messages.push(message); }, onConnection(connected) { connections.push(connected); } }));
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2); await until(() => connections.includes(false)); assert.equal(client.active, true); assert.equal(JSON.parse(env.stored.get(storageKey)!).token, membership.token);
    await until(() => connections.includes(true)); assert.equal(client.credentials?.memberId, 'h1'); assert.equal(client.credentials?.token, membership.token); assert.equal(messages.length, 0); assert.ok(polls >= 2); assert.deepEqual(connections.slice(0, 2), [false, true]);
  } finally { client.dispose(); env.restore(); }
});

test('expired stored credentials are removed and seen lines do not leak into a later restored seat', async () => {
  let status = 404; const messages: string[] = [], lines: string[] = [];
  const env = environment(async () => status === 200 ? json({ state: room, signals: [] }) : json({ message: 'Your seat expired.' }, status));
  env.stored.set(storageKey, JSON.stringify({ ...membership, seen: ['line-1'] }));
  const client = new DoubleDateClient(callbacks({ onExpired(message) { messages.push(message); }, onLines(fresh) { lines.push(...fresh.map(line => line.id)); } }));
  try {
    assert.equal(await client.restore(), false); assert.equal(env.stored.has(storageKey), false); assert.deepEqual(messages, ['Your seat expired.']);
    status = 200; env.stored.set(storageKey, JSON.stringify({ roomId: membership.roomId, memberId: membership.memberId, token: membership.token }));
    assert.equal(await client.restore(), true); assert.deepEqual(lines, ['line-1']); assert.equal(client.active, true);
  } finally { client.dispose(); env.restore(); }
});

test('temporary restore failure preserves reconnect credentials without reporting expiry', async () => {
  const messages: string[] = [], errors: string[] = [];
  const env = environment(async () => json({ error: 'Provider maintenance.' }, 503)); env.stored.set(storageKey, JSON.stringify(membership));
  const client = new DoubleDateClient(callbacks({ onExpired(message) { messages.push(message); }, onError(message) { errors.push(message); } }));
  try { assert.equal(await client.restore(), false); assert.equal(JSON.parse(env.stored.get(storageKey)!).token, membership.token); assert.deepEqual(messages, []); assert.deepEqual(errors, ['Provider maintenance.']); }
  finally { client.dispose(); env.restore(); }
});

test('turn posts how the words arrived only when the caller says so', async () => {
  const bodies: Record<string, unknown>[] = [];
  const env = environment(async (input, init) => {
    if (init?.method !== 'POST') return json({ state: room, signals: [] });
    if (String(input).endsWith('/turn')) { bodies.push(JSON.parse(String(init.body))); return json({ state: room }, 202); }
    return json(membership, 201);
  });
  const client = new DoubleDateClient(callbacks());
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    await client.turn('I am a night nurse.', 'd1', 'voice');
    await client.turn('I am a night nurse.', 'table', 'typed');
    await client.turn('Hello.', 'table');
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies.map(body => Object.keys(body).sort()), [['target', 'text', 'turnId', 'via'], ['target', 'text', 'turnId', 'via'], ['target', 'text', 'turnId']]);
    assert.deepEqual(bodies.map(body => body.via), ['voice', 'typed', undefined]);
    assert.deepEqual(bodies.map(body => body.target), ['d1', 'table', 'table']);
    assert.equal(new Set(bodies.map(body => body.turnId)).size, 3, 'every turn gets its own ID');
  } finally { client.dispose(); env.restore(); }
});

test('a playback receipt carries a timeout signal and is abandoned when the server never answers', async () => {
  let signal: AbortSignal | undefined | null;
  const env = environment(async (input, init) => {
    if (init?.method !== 'POST') return json({ state: room, signals: [] });
    if (String(input).endsWith('/playback')) {
      signal = init.signal;
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    return json(membership, 201);
  });
  const client = new DoubleDateClient(callbacks());
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout does not keep Node alive.
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    const started = performance.now();
    await assert.rejects(client.receipt('line-1', 0, true, 1.2, 30), (error: Error) => ['TimeoutError', 'AbortError'].includes(error.name));
    assert.ok(signal instanceof AbortSignal && signal.aborted);
    assert.ok(performance.now() - started < 2000);
  } finally { clearInterval(keepAlive); client.dispose(); env.restore(); }
});

test('a playback receipt that lands in time is unaffected by its timeout', async () => {
  const receipts: Record<string, unknown>[] = [];
  const env = environment(async (input, init) => {
    if (init?.method !== 'POST') return json({ state: room, signals: [] });
    if (String(input).endsWith('/playback')) { receipts.push(JSON.parse(String(init.body))); assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false); return json({ state: room }); }
    return json(membership, 201);
  });
  const client = new DoubleDateClient(callbacks());
  try {
    await client.create('Alex', 'claude-haiku-5-5', 2);
    await client.receipt('line-1', 3, false, 0.4);
    assert.deepEqual(receipts, [{ lineId: 'line-1', generation: 3, completed: false, playedSeconds: 0.4 }]);
  } finally { client.dispose(); env.restore(); }
});
