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
