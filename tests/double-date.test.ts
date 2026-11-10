import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { attachRestaurantServer, type RestaurantOptions } from '../server/restaurant';
import { attachDoubleDateServer, type DoubleDateOptions } from '../server/double-date';
import { DateApiError, type ClaudeAdapter, type ClaudeRequest, type SpeechAdapter } from '../server/restaurant/providers';
import type { DoubleDateRoomState, DoubleRoomResponse } from '../src/restaurant/double-date-types';
import { localDoubleDateView } from '../src/restaurant/double-date-types';
import { RESTAURANT_SCENARIOS } from '../src/restaurant/scenarios';
import { MENU } from '../src/restaurant/content';
import { initializeScenario, resolveScenario, tickScenario } from '../server/double-date/scenarios';
import type { SocialResponse } from '../src/restaurant/types';
import { stepScenarioEffects } from '../server/restaurant/scenario-effects';
import { doubleNote, humanTurnOf } from './helpers/double-note';
import { tableFacts } from '../server/restaurant/table-facts';
import { STORY_CUE_ALTERNATIVES } from '../src/restaurant/story';

const encode = JSON.stringify;
const neutral: SocialResponse = { signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false };
const response = (utterances: unknown[] = [{ speaker: 'd1', text: 'I have been meaning to ask about your music taste.', emotion: 'amused' }]) => ({ utterances, dateUpdates: ['d1', 'd2'].map(actorId => ({ actorId, emotion: 'neutral', memory: `The ${actorId} date remembers the table conversation.`, social: neutral })) });
function claude(onCall?: (request: ClaudeRequest) => void, result: () => unknown = response): ClaudeAdapter { return { async *stream(request) { onCall?.(request); yield { type: 'usage', usage: { inputTokens: 120, cacheReadTokens: 15, cacheWriteTokens: 10 } }; yield { type: 'text', text: encode(result()) }; yield { type: 'usage', usage: { outputTokens: 50 } }; } }; }
async function boot(options: RestaurantOptions = {}, doubleOptions: DoubleDateOptions = {}) {
  let restaurant: Awaited<ReturnType<typeof attachRestaurantServer>>, double: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  let clock = Date.UTC(2026, 10, 7, 12);
  const now = () => clock;
  const http = createServer((req, res) => { if (!double.handle(req, res) && !restaurant.handle(req, res)) { res.statusCode = 404; res.end(); } });
  restaurant = await attachRestaurantServer(http, { env: {}, autoTick: false, ledgerPath: false, now, ...options });
  double = await attachDoubleDateServer(http, restaurant, { env: {}, autoTick: false, now, disconnectMs: 1e9, ...doubleOptions });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token = '', value?: unknown) => fetch(url + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: encode(value) }) });
  const create = async (extra: Record<string, unknown> = {}) => { const r = await request('/api/double-date/rooms', '', { name: 'Alex', ...extra }); assert.equal(r.status, 201, await r.clone().text()); return await r.json() as DoubleRoomResponse; };
  const join = async (host: DoubleRoomResponse) => { const r = await request('/api/double-date/rooms/join', '', { code: host.state.code.toLowerCase(), name: 'Jamie' }); assert.equal(r.status, 201); return await r.json() as DoubleRoomResponse; };
  const path = (seat: DoubleRoomResponse) => `/api/double-date/rooms/${seat.roomId}`;
  const poll = async (seat: DoubleRoomResponse) => { const r = await request(path(seat), seat.token); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).state as DoubleDateRoomState; };
  const command = (seat: DoubleRoomResponse, value: unknown) => request(path(seat) + '/command', seat.token, value);
  const okay = async (seat: DoubleRoomResponse, value: unknown) => { const r = await command(seat, value); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).state as DoubleDateRoomState; };
  const pair = async () => { const h1 = await create(), h2 = await join(h1); await okay(h1, { type: 'choose-date', dateId: 'mira' }); await okay(h2, { type: 'choose-date', dateId: 'jules' }); for (const player of [h1, h2]) await okay(player, { type: 'ready', ready: true }); await okay(h1, { type: 'start' }); return { h1, h2 }; };
  const settle = async (seat: DoubleRoomResponse) => { for (let i = 0; i < 150; i++) { const state = await poll(seat); if (!state.processing) return state; await delay(2); } throw new Error('Conversation did not settle.'); };
  const hear = async (seat: DoubleRoomResponse, speaker: 'd1' | 'd2', text: string) => { const state = await poll(seat); const line = [...state.lines].reverse().find(line => line.speaker === speaker && line.text === text); assert.ok(line); const receipt = await request(path(seat) + '/playback', seat.token, { lineId: line.id, generation: line.generation, completed: true, playedSeconds: 2 }); assert.equal(receipt.status, 200); return line; };
  const advance = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 20); i++) { clock += 50; double.tick(.05, clock); } };
  // Authored playback expiry uses wall time; do not accidentally cook another course or introduce a second story while testing that deadline.
  const advanceWallClock = (seconds: number) => { clock += seconds * 1000; double.tick(0, clock); };
  const walk = async (players: DoubleRoomResponse[], x: number, z: number, seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 5); i++) { for (const player of players) await okay(player, { type: 'scene', command: { type: 'move', x, z, yaw: 0 } }); advance(.2); } for (const player of players) await okay(player, { type: 'scene', command: { type: 'move', x: 0, z: 0, yaw: 0 } }); };
  return { url, create, join, request, path, poll, command, okay, pair, settle, hear, advance, advanceWallClock, walk, async close() { double.close(); await restaurant.close(); http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); } };
}

test('private double-date room requires separate bearer seats, unique dates, both ready and host start', async t => {
  const api = await boot(); t.after(() => api.close()); const h1 = await api.create(), h2 = await api.join(h1);
  assert.equal((await api.request(api.path(h1), 'wrong')).status, 401);
  assert.equal((await api.request('/api/double-date/rooms/join', '', { name: 'Third', code: h1.state.code })).status, 409);
  assert.equal((await api.command(h1, { type: 'start' })).status, 409);
  await api.okay(h1, { type: 'choose-date', dateId: 'mira' });
  assert.equal((await api.command(h2, { type: 'choose-date', dateId: 'mira' })).status, 409);
  await api.okay(h2, { type: 'choose-date', dateId: 'dev' });
  for (const player of [h1, h2]) await api.okay(player, { type: 'ready', ready: true });
  assert.equal((await api.command(h2, { type: 'start' })).status, 403);
  const state = await api.okay(h1, { type: 'start' }); assert.equal(state.phase, 'playing'); assert.deepEqual(state.dates.map(date => date.id), ['d1', 'd2']); assert.deepEqual(state.members.map(member => member.id), ['h1', 'h2']);
  assert.equal(JSON.stringify(state).includes(h1.token), false); assert.equal(JSON.stringify(state).includes(h2.token), false);
  const cross = await fetch(api.url + api.path(h1) + '/command', { method: 'POST', headers: { authorization: `Bearer ${h1.token}`, origin: 'https://unrelated.example', 'content-type': 'application/json' }, body: encode({ type: 'ready', ready: false }) }); assert.equal(cross.status, 403);
});

test('shared Rapier world moves only the requesting player, rejects remote seating, and seats four actors', async t => {
  const api = await boot(); t.after(() => api.close()); const { h1, h2 } = await api.pair(); const before = await api.poll(h1);
  assert.equal((await api.command(h1, { type: 'scene', command: { type: 'interact', target: 'seat' } })).status, 409);
  assert.equal((await api.command(h1, { type: 'scene', command: { type: 'move', x: 9, z: 0, yaw: 0 } })).status, 409);
  await api.walk([h1], 0, -1, 1.4); const moved = await api.poll(h2); assert.ok(moved.members[0].position[2] < before.members[0].position[2] - 3); assert.equal(moved.members[1].position[2], before.members[1].position[2]);
  await api.walk([h2], 0, -1, 1.4); for (const player of [h1, h2]) await api.okay(player, { type: 'scene', command: { type: 'interact', target: 'seat' } });
  api.advance(7); const seated = await api.poll(h1); assert.ok(seated.members.every(player => player.seated)); assert.ok(seated.dates.every(date => date.seated), JSON.stringify(seated.dates)); assert.equal(seated.views.h1.elapsed, seated.views.h2.elapsed);
});

test('one completed turn creates one Claude request shared by both clients; duplicates never rebill', async t => {
  const requests: ClaudeRequest[] = []; const api = await boot({ claude: claude(request => requests.push(request), () => response([{ speaker: 'd2', text: 'That is a bold song choice.', emotion: 'amused' }, { speaker: 'd1', text: 'I want to hear the chorus now.', emotion: 'flirtatious' }])) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  const turn = { turnId: 'music', text: 'I grew up listening to Girls Generation.', target: 'table' };
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, turn)).status, 202); assert.equal((await api.request(api.path(h1) + '/turn', h1.token, turn)).status, 200);
  let state = await api.settle(h1); assert.equal(state.usage.claudeRequests, 1); assert.equal(requests.length, 1); assert.equal(state.usage.inputTokens, 120); assert.equal(state.usage.outputTokens, 50); assert.ok(state.usage.totalCost > 0);
  assert.ok(state.lines.some(line => line.speaker === 'd2' && line.text.includes('bold song'))); assert.deepEqual((await api.poll(h2)).lines, state.lines); assert.ok(requests[0].system.includes('two fictional adult AI dates')); assert.ok(requests[0].system.includes('Life (draw on it only where the talk goes there'), 'the character sheets sit in the cached system prompt, not in every turn'); assert.ok(!doubleNote(requests[0]).includes('biography')); assert.ok(requests[0].outputSchema);
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { ...turn, text: 'Changed.' })).status, 409);
  assert.equal((await api.request(api.path(h2) + '/turn', h2.token, turn)).status, 202); state = await api.settle(h2); assert.equal(state.usage.claudeRequests, 2);
});

test('quiet friend turns and sustained exclusion are observable; silence never creates a penalty and repair includes both dates', async t => {
  const contexts: string[] = []; let repair = false;
  const api = await boot({ claude: claude(request => contexts.push(request.messages.at(-1)!.content), () => ({ ...response([]), dateUpdates: response([]).dateUpdates.map(update => ({ ...update, social: repair ? { signal: 'repair', reason: 'Both friends included us again.', wantsToLeave: false } : neutral })) })) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  api.advance(30); assert.ok((await api.poll(h1)).dates.every(date => date.stance === 'curious'));
  for (let i = 0; i < 3; i++) { await api.request(api.path(h1) + '/turn', h1.token, { turnId: `friend-${i}`, text: 'Remember our old playlist, Jamie?', target: 'h2' }); await api.settle(h1); }
  let state = await api.poll(h2); assert.ok(state.dates.every(date => date.stance === 'guarded')); assert.match(contexts.at(-1)!, /talked only to each other for the last 3 public turns/); assert.equal(state.lines.filter(line => line.text.includes('old playlist')).length, 3);
  repair = true; await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'include', text: 'Sorry, we got carried away. What music do you both like?', target: 'table' }); state = await api.settle(h2); assert.ok(state.dates.every(date => date.stance === 'curious'), 'including the table repairs exclusion without manufacturing earned confidence'); assert.equal(state.usage.claudeRequests, 4);
});

test('two listeners share one billed speech producer and separate playback receipts', async t => {
  let calls = 0; const speech: SpeechAdapter = { async *stream() { calls++; yield Buffer.from('ID3shared'); await delay(15); yield Buffer.from('complete'); } };
  const contexts: string[] = []; const api = await boot({ claude: claude(request => contexts.push(encode(request.messages))), speech }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'audio', text: 'What do you listen to?', target: 'd1' }); let state = await api.settle(h1); const line = [...state.lines].reverse().find(line => line.speaker === 'd1')!;
  const value = { lineId: line.id, generation: line.generation }; const [a, b] = await Promise.all([api.request(api.path(h1) + '/speech', h1.token, value), api.request(api.path(h2) + '/speech', h2.token, value)]);
  assert.deepEqual(await Promise.all([a.text(), b.text()]), ['ID3sharedcomplete', 'ID3sharedcomplete']); assert.equal(calls, 1);
  await api.request(api.path(h1) + '/playback', h1.token, { ...value, completed: true, playedSeconds: 2 }); await api.request(api.path(h2) + '/playback', h2.token, { ...value, completed: false, playedSeconds: .4 });
  state = await api.poll(h1); assert.ok(state.usage.speechCharacters >= line.text.length); assert.ok(state.usage.speechCharacters < line.text.length * 2);
  await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'followup', text: 'That sounds fun.', target: 'table' }); await api.settle(h2); const context = JSON.parse(contexts.at(-1)!) as { role: string; content: string }[]; const history = context.find(entry => entry.role === 'assistant' && entry.content.includes(line.text))!; const said = history.content.split('\n').find(part => part.includes(line.text))!; assert.ok(said.startsWith('Mira: '), 'the transcript names the speaker'); assert.match(said, /\(Jamie heard only /, 'only the listener who missed the end is mentioned'); assert.ok(!said.includes('Alex heard'), 'a line the first friend heard in full carries no note'); assert.ok(!said.includes('{') && !said.includes('delivery'), 'no JSON in the transcript');
});

test('validated utterances stream before turn completion and either human can barge in across both listeners', async t => {
  let claudeAborted = false, speechAborted = false, speechCalls = 0;
  const ai: ClaudeAdapter = { async *stream(_request, signal) { yield { type: 'usage', usage: { inputTokens: 30 } }; yield { type: 'text', text: '{"utterances":[' + encode({ speaker: 'd1', text: 'I was going to tell you something.', emotion: 'warm' }) }; await new Promise<void>(resolve => signal.addEventListener('abort', () => { claudeAborted = true; resolve(); }, { once: true })); } };
  const speech: SpeechAdapter = { async *stream(_request, signal) { speechCalls++; yield Buffer.from('ID3start'); await new Promise<void>(resolve => signal.addEventListener('abort', () => { speechAborted = true; resolve(); }, { once: true })); } };
  const api = await boot({ claude: ai, speech }); t.after(() => api.close()); const { h1, h2 } = await api.pair(); await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'barge', text: 'Tell me.', target: 'd1' });
  let state = await api.poll(h1); assert.equal(state.processing, true); const line = [...state.lines].reverse().find(line => line.text.includes('going to tell'))!; assert.ok(line);
  const a = await api.request(api.path(h1) + '/speech', h1.token, { lineId: line.id, generation: line.generation }), b = await api.request(api.path(h2) + '/speech', h2.token, { lineId: line.id, generation: line.generation }); const bodies = Promise.all([a.text(), b.text()]);
  await api.request(api.path(h2) + '/interrupt', h2.token, {}); await bodies; state = await api.settle(h1); assert.equal(claudeAborted, true); assert.equal(speechAborted, true); assert.equal(speechCalls, 1); assert.equal(state.lines.find(item => item.id === line.id)?.interrupted, true); assert.ok(state.usage.speechCharacters > 0); assert.equal(state.usage.inputTokens, 30);
  assert.equal((await api.request(api.path(h2) + '/speech', h2.token, { lineId: line.id, generation: line.generation })).status, 409);
});

test('malformed output and outages produce visible room errors without counterfeit NPC dialogue', async t => {
  let mode = 'invalid'; const ai: ClaudeAdapter = { async *stream() { if (mode === 'outage') throw new DateApiError(502, 'claude_provider', 'Provider unavailable.'); yield { type: 'text', text: '{"utterances":[],"dateUpdates":[]}' }; } };
  const api = await boot({ claude: ai }); t.after(() => api.close()); const { h1 } = await api.pair();
  for (mode of ['invalid', 'outage']) { await api.request(api.path(h1) + '/turn', h1.token, { turnId: mode, text: 'Hello.', target: 'table' }); const state = await api.settle(h1); assert.equal(state.error?.code, mode === 'invalid' ? 'invalid_dialogue' : 'claude_provider'); assert.equal(state.phase, 'playing'); }
  const offline = await boot(); t.after(() => offline.close()); const pair = await offline.pair(); const r = await offline.request(offline.path(pair.h1) + '/turn', pair.h1.token, { turnId: 'offline', text: 'Hello.', target: 'table' }); assert.equal(r.status, 503); assert.equal((await offline.poll(pair.h1)).usage.claudeRequests, 0);
});

test('room session caps and shared solo/double daily reservations reject requests before paid providers run', async t => {
  let calls = 0; const api = await boot({ claude: claude(() => calls++), env: { DATE_DAILY_LIMIT_USD: '.01' } }); t.after(() => api.close()); const { h1 } = await api.pair(); await api.okay(h1, { type: 'set-model', model: 'claude-sonnet-5-5' });
  await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'cap', text: 'Hello.', target: 'table' }); const state = await api.settle(h1); assert.equal(state.error?.code, 'daily_limit'); assert.equal(calls, 0); assert.equal(state.usage.claudeRequests, 0);
  const solo = await api.request('/api/date/sessions', '', { dateId: 'mira' }).then(r => r.json()); const r = await api.request(`/api/date/sessions/${solo.state.id}/turn`, solo.token, { turnId: 'solo', text: 'Hello.', model: 'claude-sonnet-5-5' }); assert.equal(r.status, 402); assert.equal((await r.json()).code, 'daily_limit'); assert.equal(calls, 0);
  const small = await api.create({ sessionLimit: .01, model: 'claude-sonnet-5-5' }); const friend = await api.join(small); for (const [seat, dateId] of [[small, 'mira'], [friend, 'jules']] as const) { await api.okay(seat, { type: 'choose-date', dateId }); await api.okay(seat, { type: 'ready', ready: true }); } await api.okay(small, { type: 'start' }); await api.request(api.path(small) + '/turn', small.token, { turnId: 'tiny', text: 'Hello.', target: 'table' }); assert.equal((await api.settle(small)).error?.code, 'session_limit');
});

test('host model changes affect the next turn, and production model restrictions survive the room facade', async t => {
  const models: string[] = []; const api = await boot({ claude: claude(request => models.push(request.model)) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'haiku', text: 'Hello.', target: 'table' }); await api.settle(h1);
  assert.equal((await api.command(h2, { type: 'set-model', model: 'claude-sonnet-5-5' })).status, 403); await api.okay(h1, { type: 'set-model', model: 'claude-sonnet-5-5' }); await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'sonnet', text: 'Hello again.', target: 'table' }); await api.settle(h2); assert.deepEqual(models, ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  const production = await boot({ development: false, env: {} }); t.after(() => production.close()); assert.equal((await production.request('/api/double-date/rooms', '', { name: 'Host', model: 'claude-sonnet-5-5' })).status, 400);
});

test('voice signaling is validated, epoch scoped and delivered only to the other enabled human', async t => {
  const api = await boot(); t.after(() => api.close()); const { h1, h2 } = await api.pair(); await api.okay(h1, { type: 'voice-enable', enabled: true }); const state = await api.okay(h2, { type: 'voice-enable', enabled: true }); const epoch = state.voice.epoch;
  assert.equal((await api.command(h2, { type: 'voice-signal', epoch, signal: { kind: 'description', description: { type: 'offer', sdp: 'offer' } } })).status, 400);
  await api.okay(h1, { type: 'voice-signal', epoch, signal: { kind: 'description', description: { type: 'offer', sdp: 'offer' } } });
  const own = await api.request(api.path(h1), h1.token).then(r => r.json()), peer = await api.request(api.path(h2), h2.token).then(r => r.json()); assert.equal(own.signals.length, 0); assert.equal(peer.signals.length, 1); assert.equal(peer.signals[0].from, 'h1'); assert.equal((await api.request(api.path(h2) + '?after=' + peer.signals[0].id, h2.token).then(r => r.json())).signals.length, 0);
  await api.okay(h2, { type: 'voice-enable', enabled: false }); assert.equal((await api.command(h1, { type: 'voice-signal', epoch, signal: { kind: 'description', description: { type: 'offer', sdp: 'old' } } })).status, 409);
});

test('manual pause invalidates queued offers and candidates before fresh voice connections resume', async t => {
  const api = await boot(); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await api.okay(h1, { type: 'voice-enable', enabled: true }); const enabled = await api.okay(h2, { type: 'voice-enable', enabled: true }); const previousEpoch = enabled.voice.epoch;
  const offer = { kind: 'description', description: { type: 'offer', sdp: 'pre-pause-offer' } }, candidate = { kind: 'candidate', candidate: { candidate: 'candidate:old-peer', sdpMid: '0', sdpMLineIndex: 0 } };
  await api.okay(h1, { type: 'voice-signal', epoch: previousEpoch, signal: offer }); await api.okay(h1, { type: 'voice-signal', epoch: previousEpoch, signal: candidate });
  const queued = await api.request(api.path(h2), h2.token).then(response => response.json()); assert.equal(queued.signals.length, 2); assert.ok(queued.signals.every((signal: { epoch: number }) => signal.epoch === previousEpoch));
  const paused = await api.okay(h2, { type: 'scene', command: { type: 'pause', paused: true } }); assert.equal(paused.phase, 'paused'); assert.ok(paused.voice.epoch > previousEpoch); assert.deepEqual(paused.voice.enabled, { h1: true, h2: true });
  const poll = () => api.request(api.path(h2) + '?after=0', h2.token).then(response => response.json()); assert.deepEqual((await poll()).signals, []);
  assert.equal((await api.command(h1, { type: 'voice-signal', epoch: previousEpoch, signal: offer })).status, 409);
  assert.equal((await api.command(h1, { type: 'voice-signal', epoch: paused.voice.epoch, signal: candidate })).status, 409);
  const resumed = await api.okay(h1, { type: 'scene', command: { type: 'pause', paused: false } }); assert.equal(resumed.phase, 'playing'); assert.equal(resumed.voice.epoch, paused.voice.epoch); assert.deepEqual(resumed.voice.enabled, { h1: true, h2: true }); assert.deepEqual((await poll()).signals, []);
  assert.equal((await api.command(h1, { type: 'voice-signal', epoch: previousEpoch, signal: candidate })).status, 409);
  await api.okay(h1, { type: 'voice-signal', epoch: resumed.voice.epoch, signal: { kind: 'description', description: { type: 'offer', sdp: 'fresh-resumed-offer' } } });
  const fresh = (await poll()).signals; assert.equal(fresh.length, 1); assert.equal(fresh[0].epoch, resumed.voice.epoch); assert.equal(fresh[0].signal.description.sdp, 'fresh-resumed-offer'); assert.ok(fresh[0].id > queued.signals.at(-1).id);
});

test('disconnect pauses both pairs, reserves the private seat, and reconnect restores the same evening', async t => {
  const api = await boot({}, { reconnectMs: 1000, disconnectMs: 1e9 }); t.after(() => api.close()); const { h1, h2 } = await api.pair(); const before = await api.poll(h1);
  const left = await api.request(api.path(h2) + '/leave', h2.token, {}).then(r => r.json()); assert.equal(left.state.phase, 'paused'); assert.equal(left.state.pauseReason, 'reconnect'); assert.equal(left.state.members[1].connected, false);
  assert.equal((await api.command(h1, { type: 'scene', command: { type: 'pause', paused: false } })).status, 409); assert.equal((await api.request('/api/double-date/rooms/join', '', { name: 'Intruder', code: before.code })).status, 409);
  const restored = await api.poll(h2); assert.equal(restored.phase, 'playing'); assert.equal(restored.id, before.id); assert.deepEqual(restored.members.map(player => player.dateId), ['mira', 'jules']);
  await api.request(api.path(h2) + '/leave', h2.token, {}); api.advance(1.2); assert.equal((await api.request(api.path(h2), h2.token)).status, 404); assert.equal((await api.request(api.path(h1), h1.token)).status, 404);
});

async function resolveSharedStory(api: Awaited<ReturnType<typeof boot>>, seat: DoubleRoomResponse) {
  for (let beat = 0; beat < 2; beat++) { const state = await api.poll(seat); if (state.scenario?.phase !== 'active') break; await api.okay(seat, { type: 'scenario', choice: state.scenario.choices[0].id }); }
}
async function serveBothMains(api: Awaited<ReturnType<typeof boot>>, seats: DoubleRoomResponse[], storyRate = 20) {
  await api.walk(seats, 0, -1, 1.4);
  for (const seat of seats) { await api.okay(seat, { type: 'scene', command: { type: 'interact', target: 'seat' } }); await api.okay(seat, { type: 'scene', command: { type: 'interact', target: 'menu', choice: MENU[0] } }); }
  api.advance(46 / storyRate);
}
async function resolveArrivalOrder(api: Awaited<ReturnType<typeof boot>>, seat: DoubleRoomResponse) {
  const before = await api.poll(seat);
  assert.equal(before.views.h1.evening.incident?.event, 'wrong-order');
  assert.equal(before.views.h1.evening.main.bites, 0);
  await api.okay(seat, { type: 'scene', command: { type: 'evening', action: 'inspect-ticket' } });
  await api.okay(seat, { type: 'scene', command: { type: 'evening', action: 'return-order' } });
  assert.equal((await api.poll(seat)).views.h1.evening.incident, null);
}
/** Bites are paced on the wall clock only, so the scene clock does not run into the next interruption. */
async function eatBothMains(api: Awaited<ReturnType<typeof boot>>, seats: DoubleRoomResponse[]) {
  for (let bite = 0; bite < 3; bite++) for (const seat of seats) { await resolveSharedStory(api, seat); await api.okay(seat, { type: 'scene', command: { type: 'evening', action: 'taste' } }); api.advanceWallClock(.55); }
}
/** Let the shared evening carry itself one scene second at a time, answering any table story, until the predicate holds. */
async function waitFor(api: Awaited<ReturnType<typeof boot>>, seat: DoubleRoomResponse, label: string, predicate: (state: DoubleDateRoomState) => boolean, maxSeconds = 300, storyRate = 20) {
  const clock = (state: DoubleDateRoomState) => Math.max(...Object.values(state.views).map(view => view.elapsed));
  const start = clock(await api.poll(seat));
  for (;;) {
    const state = await api.poll(seat);
    if (predicate(state)) return state;
    assert.ok(clock(state) - start <= maxSeconds, `${label} did not happen within ${maxSeconds} scene seconds (${Object.values(state.views).map(view => `${view.evening.main.status}/${view.evening.dessert.status}/${view.evening.incident?.event ?? 'calm'}`).join(' ')})`);
    if (state.scenario?.phase === 'active') await api.command(seat, { type: 'scenario', choice: state.scenario.choices[0].id });
    api.advance(1 / storyRate);
  }
}

test('complete shared dinner carries itself: Eli serves and clears, the friends recover three interruptions, one check comes for the table, farewells stay independent', async t => {
  const api = await boot({}, { storyRate: 20, scenarioId: 'family-visit' }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  const action = (seat: DoubleRoomResponse, value: Record<string, unknown>) => api.okay(seat, { type: 'scene', command: { type: 'evening', ...value } });
  await serveBothMains(api, [h1,h2]); api.advance(5.4);
  assert.equal((await api.poll(h2)).views.h2.evening.incident?.event, 'wrong-order');
  await action(h2, { action: 'inspect-ticket' }); await action(h1, { action: 'return-order' });
  await eatBothMains(api, [h1,h2]);
  let state = await waitFor(api, h1, 'the spill', room => Object.values(room.views).some(view => view.evening.incident?.event === 'spilled-drink'));
  for (let i = 0; i < 3; i++) { await action(i % 2 ? h1 : h2, { action: 'wipe' }); api.advance(.15); } await action(h2, { action: 'steady-glass' });
  state = await waitFor(api, h1, 'Eli clearing both tables', room => ['h1','h2'].every(id => room.views[id as 'h1'|'h2'].evening.main.status === 'finished'));
  assert.ok(state.views.h1.evening.cues.some(cue => cue.key === 'main-finished' && cue.utterances[0].speaker === 'waiter'));
  assert.equal((await api.command(h1, { type: 'scene', command: { type: 'evening', action: 'settle-bill', choice: 'split' } })).status, 409, 'nobody settles before Eli brings the check');
  await action(h1, { action: 'skip-dessert' }); await action(h2, { action: 'order-dessert', choice: 'chocolate' });
  state = await waitFor(api, h2, 'dessert service', room => room.views.h2.evening.dessert.status === 'served');
  assert.equal(state.views.h1.evening.bill.requested, false, 'the check waits while the other pair is still eating');
  for (let spoon = 0; spoon < 2; spoon++) { await action(h2, { action: 'taste' }); api.advanceWallClock(.55); }
  state = await waitFor(api, h2, 'the noisy diner', room => Object.values(room.views).some(view => view.evening.incident?.event === 'disruptive-diner'));
  await action(h2, { action: 'ask-quiet' });
  state = await waitFor(api, h1, 'one check for the table', room => ['h1','h2'].every(id => room.views[id as 'h1'|'h2'].evening.bill.requested));
  assert.equal(state.views.h2.evening.dessert.status, 'finished'); assert.equal(state.views.h1.evening.bill.arrivedAt, state.views.h2.evening.bill.arrivedAt);
  await action(h2, { action: 'settle-bill', choice: 'split' });
  state = await api.poll(h1); assert.ok(['h1','h2'].every(id => state.views[id as 'h1'|'h2'].evening.bill.settlement === 'split'));
  for (const seat of [h1,h2]) await api.okay(seat, { type: 'scene', command: { type: 'interact', target: 'seat' } }); await api.walk([h1,h2], 0, 1, 1.4);
  await action(h1, { action: 'farewell', choice: 'friendly' }); await action(h2, { action: 'farewell', choice: 'goodbye' }); api.advance(2.5);
  state=await api.poll(h1); assert.equal(state.views.h1.evening.farewell.ending?.kind,'new-friend'); assert.equal(state.views.h2.evening.farewell.ending?.kind,'quiet-goodbye'); assert.equal(state.phase,'ended'); assert.equal(state.usage.claudeRequests,0);
});

test('a finished human can stay as a wingman, help by name, converse, view their result and return without reviving their date', async t => {
  const calls: ClaudeRequest[] = [];
  const api = await boot({ claude: claude(request => calls.push(request), () => response([{ speaker: 'd2', text: 'Thanks for staying with us, Alex.', emotion: 'warm' }])) }, { storyRate: 20, scenarioId: 'family-visit' });
  t.after(() => api.close()); const { h1, h2 } = await api.pair(); await serveBothMains(api, [h1,h2]);
  await api.okay(h1, { type: 'scene', command: { type: 'pause', paused: true } });
  let state = await api.okay(h1, { type: 'scene', command: { type: 'finish' } });
  assert.equal(state.phase, 'playing'); assert.equal(state.views.h1.phase, 'ended'); assert.equal(state.views.h2.phase, 'playing');
  assert.equal(localDoubleDateView(state,'h1').phase,'playing'); assert.equal(localDoubleDateView(state,'h1').doubleDate?.role,'wingman');
  const frozenMemory = state.views.h1.memory, otherPosition = [...state.members[1].position];
  await api.okay(h1, { type: 'scene', command: { type: 'interact', target: 'seat' } });
  const before = (await api.poll(h1)).members[0].position[0]; await api.walk([h1], -1, 0, .2); state=await api.poll(h1);
  assert.ok(state.members[0].position[0] < before-.3); assert.deepEqual(state.members[1].position,otherPosition);
  await api.okay(h1, { type: 'scene', command: { type: 'interact', target: 'seat' } });
  assert.equal((await api.command(h1, { type:'scene', command:{ type:'evening', action:'skip-dessert' } })).status,409);
  assert.equal((await api.command(h1, { type:'scene', command:{ type:'interact', target:'menu', choice:MENU[1] } })).status,409);
  await api.okay(h1, { type:'scene', command:{type:'evening',action:'request-water'} });
  await api.okay(h1, { type:'scene', command:{type:'evening',action:'check-in'} });
  state=await api.poll(h1); assert.equal(state.views.h2.evening.care.water.status,'requested');
  assert.ok(state.views.h1.evening.moments.some(moment=>moment.id.startsWith('wingman-') && moment.description.includes('Alex')));
  assert.ok(state.views.h2.evening.moments.some(moment=>moment.description.includes('Alex')));
  assert.equal(state.views.h1.memory,frozenMemory);
  await api.request(api.path(h1)+'/turn',h1.token,{turnId:'wingman-chat',text:'What would make the rest of your evening good?',target:'d2'}); state=await api.settle(h1);
  assert.equal(calls.length,1); assert.equal(state.views.h1.memory,frozenMemory); assert.ok(state.lines.some(line=>line.speaker==='d2' && line.text.includes('staying')));
  const note=doubleNote(calls[0]); assert.match(note,/Mira has left the table and Alex’s evening with Mira is over; Alex stays on as a wingman\. Write nothing for Mira\./); assert.match(note,/Alex said to Jules: “What would make the rest of your evening good\?”/);
  state=await api.okay(h1,{type:'view-ending'}); assert.equal(localDoubleDateView(state,'h1').phase,'ended'); assert.equal(state.phase,'playing');
  state=await api.okay(h1,{type:'return-to-table'}); assert.equal(localDoubleDateView(state,'h1').phase,'playing'); assert.equal(state.views.h1.phase,'ended');
  state=await api.okay(h2,{type:'scene',command:{type:'finish'}}); assert.equal(state.phase,'ended'); assert.equal(localDoubleDateView(state,'h1').phase,'ended');
  assert.equal((await api.command(h1,{type:'return-to-table'})).status,409);
});

test('a date ending during a shared spill transfers recovery to the active pair and keeps their dinner usable', async t => {
  const api=await boot({}, {storyRate:20,scenarioId:'family-visit'}); t.after(()=>api.close()); const {h1,h2}=await api.pair();
  const action=(seat:DoubleRoomResponse, name:string)=>api.okay(seat,{type:'scene',command:{type:'evening',action:name}});
  await serveBothMains(api,[h1,h2]); api.advance(5.4); await action(h1,'inspect-ticket'); await action(h2,'return-order');
  await eatBothMains(api,[h1,h2]);
  let state=await waitFor(api,h1,'the spill',room=>room.views.h1.evening.incident?.event==='spilled-drink');
  await api.okay(h1,{type:'scene',command:{type:'finish'}}); state=await api.poll(h2); assert.equal(state.views.h1.phase,'ended'); assert.equal(state.views.h1.evening.incident,null); assert.equal(state.views.h2.evening.incident?.event,'spilled-drink');
  for(let wipe=0;wipe<3;wipe++){await action(h2,'wipe');api.advance(.15);} await action(h2,'steady-glass');
  state=await api.poll(h2); assert.equal(state.views.h2.evening.incident,null); assert.ok(state.views.h2.evening.resolutions['spilled-drink']); assert.equal(state.views.h1.phase,'ended');
  state=await waitFor(api,h2,'Eli clearing the remaining table',room=>room.views.h2.evening.main.status==='finished');
  await action(h2,'skip-dessert');
  state=await waitFor(api,h2,'the check',room=>room.views.h2.evening.bill.requested,60); assert.equal(state.views.h1.phase,'ended');
});

test('personal ending choices never bypass a reconnect pause', async t=>{
  const api=await boot(); t.after(()=>api.close()); const {h1,h2}=await api.pair();
  await api.request(api.path(h2)+'/leave',h2.token,{});
  let state=await api.okay(h1,{type:'scene',command:{type:'finish'}}); assert.equal(state.phase,'paused'); assert.equal(state.pauseReason,'reconnect');
  state=await api.okay(h1,{type:'view-ending'}); assert.equal(state.phase,'paused'); assert.equal(localDoubleDateView(state,'h1').phase,'ended');
  assert.equal((await api.command(h1,{type:'scene',command:{type:'pause',paused:false}})).status,409);
  state=await api.poll(h2); assert.equal(state.phase,'playing'); assert.equal(state.views.h1.phase,'ended'); assert.equal(state.views.h2.phase,'playing');
  state=await api.okay(h1,{type:'return-to-table'}); assert.equal(localDoubleDateView(state,'h1').doubleDate?.role,'wingman');
});

test('removed table games and course shortcuts are rejected at the room door, not silently ignored', async t => {
  const api = await boot(); t.after(() => api.close()); const { h1 } = await api.pair();
  for (const command of [{ type: 'coaster-shot', angle: 0, power: .5 }, { type: 'napkin', points: [[.1, .1]], complete: true }, { type: 'evening', action: 'start-coasters' }, { type: 'evening', action: 'finish-main' }, { type: 'evening', action: 'request-bill' }, { type: 'interact', target: 'coasters' }]) {
    assert.equal((await api.command(h1, { type: 'scene', command })).status, 400, JSON.stringify(command));
  }
  const state = await api.poll(h1); assert.equal('tableActivity' in state, false); assert.equal(state.views.h1.evening.main.status, 'none');
});

test('alternate scenario activates once after shared conversation, blocks competing course incidents, and resolves through either friend', async t => {
  const contexts: string[] = []; const api = await boot({ claude: claude(request => contexts.push(request.messages.at(-1)!.content), () => response([])) }, { storyRate: 20, scenarioId: 'family-visit' }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await serveBothMains(api, [h1, h2]); await resolveArrivalOrder(api, h1); api.advance(26 / 20);
  assert.equal((await api.poll(h1)).scenario?.phase, 'dormant'); assert.ok((await api.poll(h1)).views.h1.elapsed < 240, 'conversation, rather than the time threshold, opens this story');
  for (let i = 0; i < 2; i++) { await api.request(api.path(h1) + '/turn', h1.token, { turnId: `scenario-${i}`, text: 'What would your ideal evening look like?', target: 'table' }); await api.settle(h1); }
  api.advance(.05); let state = await api.poll(h2); assert.equal(state.scenario?.phase, 'active'); await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'scenario-active', text: 'Tell me more.', target: 'table' }); await api.settle(h1); assert.match(contexts.at(-1)!, /Happening now \(/, 'an active story is part of what the dates know');
  assert.equal((await api.command(h2, { type: 'scenario', choice: 'invented-action' })).status, 400);
  assert.equal((await api.command(h1, { type: 'scene', command: { type: 'evening', action: 'skip-dessert' } })).status, 409);
  const choice = state.scenario!.choices[0].id; await api.okay(h2, { type: 'scenario', choice }); state = await api.poll(h1); assert.equal(state.scenario?.phase, 'active'); assert.equal(state.scenario?.beat, 'follow-through'); assert.equal(state.scenario?.decisions[0].by, 'Jamie'); await api.okay(h1, { type: 'scenario', choice: state.scenario!.choices[0].id }); state = await api.poll(h1); assert.equal(state.scenario?.phase, 'resolved'); assert.ok(state.scenario?.resolution); assert.ok(state.views.h1.evening.moments.some(moment => moment.id.startsWith('scenario-'))); assert.ok(state.views.h2.evening.moments.some(moment => moment.id.startsWith('scenario-')));
  assert.equal((await api.command(h1, { type: 'scenario', choice })).status, 409); api.advance(.2); assert.equal((await api.poll(h1)).scenario?.phase, 'resolved');
});

test('all eleven scenario tracks are deterministic, remain dormant during incidents, and retain an actual shared moment', async t => {
  const api = await boot(); t.after(() => api.close()); const { h1 } = await api.pair();
  for (const {id} of RESTAURANT_SCENARIOS) {
    const room = await api.poll(h1); initializeScenario(room, id);
    for (const member of room.members) member.seated = true;
    for (const view of Object.values(room.views)) { view.seated = true; view.elapsed = 300; view.evening.main.status = 'served'; view.evening.incident = { event: 'wrong-order', progress: 0, startedAt: 290 }; }
    tickScenario(room); assert.equal(room.scenario?.phase, 'dormant'); for (const view of Object.values(room.views)) view.evening.incident = null;
    tickScenario(room); assert.equal(room.scenario?.phase, 'active'); assert.throws(() => resolveScenario(room, 'h1', 'invalid'));
    resolveScenario(room, 'h2', room.scenario!.choices[0].id); assert.equal(room.scenario?.phase, 'active');
    if (id === 'feeling-unwell') { const target = room.views[room.scenario!.target]; target.elapsed += 6; stepScenarioEffects(target); }
    resolveScenario(room, 'h2', room.scenario!.choices[0].id); assert.equal(room.scenario?.phase, 'resolved'); assert.ok(room.views.h1.evening.moments.some(moment => moment.id === `scenario-${id}`)); assert.ok(room.views.h2.evening.moments.some(moment => moment.description.includes('Jamie'))); assert.ok(tableFacts(room.views[room.scenario!.target]).some(fact => fact.includes('Jamie')), 'the choice is a recorded table fact, not a line pushed into the notebook'); assert.equal(room.scenario!.decisions.length, 2);
  }
});

test('authored care and scenario choices cancel held stale table updates without creating another Claude request', async t => {
  for (const kind of ['care', 'scenario'] as const) {
    let release!: () => void, ready!: () => void, holding = false, aborted = false, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { ready = resolve; });
    const ai: ClaudeAdapter = { async *stream(_request, signal) {
      calls++;
      if (!holding) { yield { type: 'text', text: encode(response([])) }; return; }
      signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      yield { type: 'usage', usage: { inputTokens: 61 } };
      const result = { ...response([{ speaker:'d1', text:'An unfinished thought before the interruption.', emotion:'flirtatious' }]), dateUpdates: response([]).dateUpdates.map(update => ({ ...update, memory:'STALE_TABLE_MEMORY', emotion:'flirtatious' })) };
      const prefix = '{"utterances":[' + encode(result.utterances[0]);
      yield { type:'text', text:prefix }; ready(); await gate;
      yield { type:'text', text:encode(result).slice(prefix.length) };
    } };
    const api = await boot({ claude:ai, speech:{ async *stream() { yield Buffer.from('ID3authored'); } } }, {storyRate:20, scenarioId:'family-visit'});
    t.after(() => { release(); return api.close(); }); const {h1,h2}=await api.pair(); await serveBothMains(api,[h1,h2]); await resolveArrivalOrder(api,h1); api.advance(26 / 20);
    if (kind==='scenario') {
      for(let i=0;i<4;i++) { await api.request(api.path(h1)+'/turn',h1.token,{turnId:`setup-${i}`,text:'Tell us a little more.',target:'table'}); await api.settle(h1); }
      api.advance(.05); assert.equal((await api.poll(h1)).scenario?.phase,'active');
    }
    holding=true; const beforeCalls=calls, beforeTokens=(await api.poll(h1)).usage.inputTokens;
    assert.equal((await api.request(api.path(h1)+'/turn',h1.token,{turnId:'held',text:'What were you about to say?',target:'table'})).status,202);
    await started; let state=await api.poll(h1); const generation=state.generation;
    const unfinished=state.lines.find(line=>line.text==='An unfinished thought before the interruption.')!; assert.ok(unfinished);
    await api.request(api.path(h1)+'/playback',h1.token,{lineId:unfinished.id,generation,completed:false,playedSeconds:.25});
    await api.okay(h1,{type:'scene',command:{type:'move',x:0,z:0,yaw:.2}});
    assert.equal((await api.command(h1,{type:'scenario',choice:'invalid'})).status,kind==='scenario'?400:409);
    assert.equal(aborted,false); assert.equal((await api.poll(h1)).generation,generation);
    state=kind==='care' ? await api.okay(h1,{type:'scene',command:{type:'evening',action:'request-water'}}) : await api.okay(h2,{type:'scenario',choice:state.scenario!.choices[0].id});
    assert.equal(aborted,true); assert.equal(state.generation,generation+1); assert.equal(calls,beforeCalls+1);
    const memories=Object.values(state.views).map(view=>view.memory), emotions=Object.values(state.views).map(view=>view.emotion);
    // A care action is a notebook moment the date reads back; it is no longer copied into the memory a model reply rewrites.
    const moments=Object.values(state.views).flatMap(view=>view.evening.moments.map(moment=>moment.description));
    assert.ok(kind==='care' ? moments.some(text=>text.includes('fresh water')) : state.scenario!.decisions.length>0, 'the choice was recorded by the scenario (its table fact lives in server memory, not the snapshot)');
    const authored=state.lines.filter(line=>line.generation===state.generation && !['h1','h2'].includes(line.speaker)).at(-1)!;
    assert.ok(authored); const speech=await api.request(api.path(h2)+'/speech',h2.token,{lineId:authored.id,generation:authored.generation}); assert.equal(speech.status,200); await speech.text();
    release(); state=await api.settle(h1);
    assert.deepEqual(Object.values(state.views).map(view=>view.memory),memories); assert.deepEqual(Object.values(state.views).map(view=>view.emotion),emotions);
    assert.equal(state.lines.find(line=>line.id===unfinished.id)?.interrupted,true); assert.equal(state.usage.inputTokens,beforeTokens+61); assert.equal(state.error,undefined);
    assert.equal((await api.request(api.path(h1)+'/speech',h1.token,{lineId:unfinished.id,generation})).status,409);
  }
});

test('late wingman scenarios use the active clock and require a seated player outside their ending screen', async t => {
  const requests: ClaudeRequest[]=[]; const api=await boot({claude:claude(request=>requests.push(request),()=>response([]))},{storyRate:20,scenarioId:'family-visit'});
  t.after(()=>api.close()); const {h1,h2}=await api.pair(); await serveBothMains(api,[h1,h2]); await resolveArrivalOrder(api,h1); api.advance(26 / 20);
  let state=await api.okay(h1,{type:'scene',command:{type:'finish'}}); const frozenClock=state.views.h1.elapsed;
  api.advance(1);
  for(let i=0;i<4;i++) { await api.request(api.path(h2)+'/turn',h2.token,{turnId:`late-${i}`,text:'Let us keep talking.',target:'d2'}); await api.settle(h2); }
  api.advance(.05); state=await api.poll(h1);
  assert.equal(state.scenario?.phase,'active'); assert.equal(state.scenario.target,'h2'); assert.ok(state.scenario.startedAt!>frozenClock);
  assert.equal(localDoubleDateView(state,'h1').elapsed,state.views.h2.elapsed);
  await api.okay(h1,{type:'view-ending'}); assert.equal((await api.command(h1,{type:'scenario',choice:state.scenario.choices[0].id})).status,409);
  await api.okay(h1,{type:'return-to-table'}); await api.okay(h2,{type:'scene',command:{type:'interact',target:'seat'}});
  assert.equal((await api.command(h2,{type:'scenario',choice:state.scenario.choices[0].id})).status,409);
  await api.okay(h2,{type:'scene',command:{type:'interact',target:'seat'}});
  state=await api.okay(h1,{type:'scenario',choice:state.scenario.choices[0].id}); api.advance(.2);
  state=await api.okay(h2,{type:'scenario',choice:state.scenario!.choices[0].id});
  assert.equal(state.scenario?.phase,'resolved'); assert.ok(state.scenario.resolvedAt!>=state.scenario.startedAt!); assert.ok(state.scenario.resolvedAt!>frozenClock);
  await api.request(api.path(h2)+'/turn',h2.token,{turnId:'after-story',text:'Back to our evening.',target:'d2'}); state=await api.settle(h2);
  { const minutes=Math.floor(state.views.h2.elapsed/60); assert.match(doubleNote(requests.at(-1)!),minutes<1?/The evening is under a minute old/:new RegExp(`The evening is about ${minutes} minutes? old`)); }
});

test('a queued old human turn waits for authored interruption delivery, with caption fallback and fresh speech able to proceed', async t => {
  for (const resume of ['receipts','timeout','new-turn'] as const) {
    let ready!:()=>void, release!:()=>void, calls=0; const requests:ClaudeRequest[]=[];
    const started=new Promise<void>(resolve=>{ready=resolve;}), held=new Promise<void>(resolve=>{release=resolve;});
    const ai:ClaudeAdapter={ async *stream(request) {
      requests.push(request); if(++calls===1) { ready(); await held; }
      yield {type:'text',text:encode(response([]))};
    } };
    const api=await boot({claude:ai},{storyRate:1,scenarioId:'family-visit'}); t.after(()=>{release();return api.close();});
    const {h1,h2}=await api.pair(); await serveBothMains(api,[h1,h2],1); await resolveArrivalOrder(api,h1);
    await api.request(api.path(h1)+'/turn',h1.token,{turnId:'held',text:'Tell us about your weekend.',target:'table'}); await started;
    const queued={turnId:'already-queued',text:'And what music did you hear?',target:'d2'};
    await api.request(api.path(h2)+'/turn',h2.token,queued);
    let state=await api.okay(h1,{type:'scene',command:{type:'evening',action:'request-water'}});
    const cue=state.lines.filter(line=>line.generation===state.generation && line.speaker==='waiter').at(-1)!; assert.ok(cue);
    release(); state=await api.settle(h1); assert.equal(calls,1); assert.equal(state.lines.find(line=>line.id===cue.id)?.interrupted,undefined);
    if(resume==='receipts') {
      await api.request(api.path(h1)+'/playback',h1.token,{lineId:cue.id,generation:cue.generation,completed:true,playedSeconds:2}); assert.equal(calls,1);
      await api.request(api.path(h2)+'/playback',h2.token,{lineId:cue.id,generation:cue.generation,completed:false,playedSeconds:0});
    } else if(resume==='timeout') api.advanceWallClock(31);
    else await api.request(api.path(h1)+'/turn',h1.token,{turnId:'fresh-interruption',text:'Actually, let me ask you something.',target:'table'});
    state=await api.settle(h2); assert.equal(calls,resume==='new-turn'?3:2, resume); assert.equal(state.usage.claudeRequests,calls);
    assert.match(requests[1].messages.at(-1)!.content,/fresh water/); assert.equal(humanTurnOf(requests[1]).speaker,'Jamie');
    assert.equal((await api.request(api.path(h2)+'/turn',h2.token,queued)).status,200); assert.equal(state.error,undefined);
  }
});

test('a finished date walks to the exit while their seated human remains a wingman', async t => {
  const api=await boot({}, {storyRate:20,scenarioId:'family-visit'}); t.after(()=>api.close()); const {h1,h2}=await api.pair(); await serveBothMains(api,[h1,h2]); api.advance(4);
  let state=await api.okay(h1,{type:'scene',command:{type:'finish'}}); const outcome=state.views.h1.evening.farewell.ending, memory=state.views.h1.memory;
  assert.equal(state.members[0].seated,true); assert.equal(state.dates[0].departed,false);
  api.advance(8); state=await api.poll(h1);
  assert.equal(state.dates[0].departed,true,encode(state.dates[0])); assert.equal(state.members[0].seated,true); assert.equal(state.views.h1.memory,memory); assert.deepEqual(state.views.h1.evening.farewell.ending,outcome);
  assert.equal(localDoubleDateView(state,'h1').doubleDate?.role,'wingman'); assert.equal(state.phase,'playing');
});

test('independent date boundaries can end one pairing without forcing the other date to leave', async t => {
  const refusal = 'Please let me choose my own food. Do not order for me.';
  let calls = 0, humanText = '';
  const api = await boot({ claude: claude(request => { humanText = humanTurnOf(request).text; }, () => {
    const setting = calls++ === 0;
    return { utterances: [{ speaker: 'd1', text: refusal, emotion: 'annoyed' }], dateUpdates: [{ actorId: 'd1', emotion: 'annoyed', memory: 'The date stated a food choice boundary.', social: { signal: setting ? 'none' : 'pressure', reason: 'The same explicit food boundary was disregarded again.', wantsToLeave: calls >= 3, boundary: { kind: setting ? 'set' : 'repeat', topic: 'food-drink', refusal, evidence: humanText } } }, { actorId: 'd2', emotion: 'warm', memory: 'My date has been considerate.', social: { signal: 'kindness', reason: 'My date made room for my answer.', wantsToLeave: false } }] };
  }) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  for (let i = 0; i < 3; i++) {
    await api.request(api.path(h1) + '/turn', h1.token, { turnId: `boundary-${i}`, text: i === 0 ? 'Shall I choose dinner for you?' : 'I am choosing your dinner despite your answer.', target: 'd1' });
    const state = await api.settle(h1);
    if (i === 0) { assert.equal(state.views.h1.evening.stance, 'curious'); assert.equal(state.views.h1.evening.farewell.ending, null); }
    if (i < 2) await api.hear(h1, 'd1', refusal);
  }
  const state = await api.poll(h2); assert.equal(state.views.h1.evening.farewell.ending?.kind, 'walked-away'); assert.equal(state.dates.find(date => date.id === 'd1')?.stance, 'leaving'); assert.equal(state.dates.find(date => date.id === 'd2')?.stance, 'curious', 'ordinary warmth keeps the other date engaged without instant trust'); assert.equal(state.views.h2.evening.farewell.ending, null); assert.equal(state.phase, 'playing');
});

test('offstage dates cannot speak or change memory after an ending or departure while the remaining date continues', async t => {
  for (const departure of ['ended', 'leaving'] as const) {
    let stage: 'before' | 'pressure' | 'after' = 'before', speechCalls = 0, boundaryTurns = 0;
    const refusal = 'Please let me choose my own food. Do not order for me.';
    const requests: ClaudeRequest[] = [];
    const ai: ClaudeAdapter = { async *stream(request) {
      requests.push(request);
      const result = response(stage === 'after'
        ? [{ speaker: 'd1', text: 'I have returned and want another date.', emotion: 'warm' }, { speaker: 'd2', text: 'We can still enjoy the rest of our evening.', emotion: 'warm' }]
        : [{ speaker: 'd1', text: 'A line from when I was still at the table.', emotion: 'neutral' }]);
      if (stage === 'pressure') {
        const setting = boundaryTurns++ === 0, humanText = humanTurnOf(request).text;
        result.utterances = [{ speaker: 'd1', text: refusal, emotion: 'annoyed' }];
        result.dateUpdates[0] = { actorId: 'd1', emotion: 'annoyed', memory: 'I stated the same food choice boundary.', social: { signal: setting ? 'none' : 'pressure', reason: 'The explicit boundary was ignored.', wantsToLeave: !setting, boundary: { kind: setting ? 'set' : 'repeat', topic: 'food-drink', refusal, evidence: humanText } } };
      }
      if (stage === 'after') result.dateUpdates[0] = { actorId: 'd1', emotion: 'warm', memory: 'I returned and heard this new conversation.', social: { signal: 'repair', reason: 'I changed my mind about leaving.', wantsToLeave: false } };
      const text = encode(result); for (let index = 0; index < text.length; index += 19) yield { type: 'text', text: text.slice(index, index + 19) };
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 80 } };
    } };
    const speech: SpeechAdapter = { async *stream() { speechCalls++; yield Buffer.from('ID3farewell'); } };
    const api = await boot({ claude: ai, speech }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
    await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'before', text: 'How is your evening?', target: 'table' }); let state = await api.settle(h2);
    const earlier = state.lines.find(line => line.text === 'A line from when I was still at the table.')!;
    if (departure === 'ended') await api.okay(h1, { type: 'scene', command: { type: 'finish' } });
    else {
      stage = 'pressure';
      for (let index = 0; index < 3; index++) { await api.request(api.path(h1) + '/turn', h1.token, { turnId: `pressure-${index}`, text: index === 0 ? 'Shall I choose your dinner?' : 'I am ignoring your food choice again.', target: 'd1' }); await api.settle(h1); if (index < 2) await api.hear(h1, 'd1', refusal); }
    }
    state = await api.poll(h2); const previousMemory = state.views.h1.memory;
    const farewell = [...state.lines].reverse().find(line => line.speaker === 'd1' && line.text === state.views.h1.evening.farewell.ending?.dateLine)!; assert.ok(farewell);
    const blocked = await api.request(api.path(h2) + '/speech', h2.token, { lineId: earlier.id, generation: earlier.generation }); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'speaker_unavailable'); assert.equal(speechCalls, 0);
    const authored = await api.request(api.path(h2) + '/speech', h2.token, { lineId: farewell.id, generation: farewell.generation }); assert.equal(authored.status, 200); assert.equal(await authored.text(), 'ID3farewell'); assert.equal(speechCalls, 1);
    stage = 'after'; const before = requests.length;
    await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'remaining-pair', text: 'We can carry on talking.', target: 'd2' }); state = await api.settle(h2);
    assert.equal(requests.length - before, 1); assert.equal(state.lines.some(line => line.text === 'I have returned and want another date.'), false); assert.ok(state.lines.some(line => line.speaker === 'd2' && line.text === 'We can still enjoy the rest of our evening.')); assert.equal(state.views.h1.memory, previousMemory); assert.equal(state.phase, 'playing'); assert.equal(state.error, undefined);
    if (departure === 'ended') assert.equal(state.views.h1.phase, 'ended'); else assert.equal(state.views.h1.evening.stance, 'leaving');
    const lastNote = doubleNote(requests.at(-1)!); assert.match(lastNote, /rite nothing for Mira/); assert.doesNotMatch(lastNote, /rite nothing for Jules/);
    const allowed = (requests.at(-1)!.outputSchema as any).properties.utterances.items.properties.speaker.enum; assert.equal(allowed.includes('d1'), false); assert.ok(allowed.includes('d2')); assert.ok(requests.at(-1)!.system.includes('offstage'));
  }
});

async function seatBoth(api: Awaited<ReturnType<typeof boot>>, h1: DoubleRoomResponse, h2: DoubleRoomResponse) {
  await api.walk([h1], 0, -1, 1.4); await api.walk([h2], 0, -1, 1.4);
  for (const player of [h1, h2]) await api.okay(player, { type: 'scene', command: { type: 'interact', target: 'seat' } });
  api.advance(7);
}

test('the question a date was waiting on reaches the model even though the friend’s own turn answers it', async t => {
  // Pin this fixture to an authored question. The test checks delivery/clearing,
  // not whether every welcome variation happens to contain a question.
  const welcomes = STORY_CUE_ALTERNATIVES.jules.welcome;
  STORY_CUE_ALTERNATIVES.jules.welcome = [welcomes[0], welcomes[0], welcomes[0]];
  t.after(() => { STORY_CUE_ALTERNATIVES.jules.welcome = welcomes; });
  const requests: ClaudeRequest[] = []; const api = await boot({ claude: claude(request => requests.push(request)) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await seatBoth(api, h1, h2);
  const state = await api.poll(h2);
  assert.ok(state.lines.some(line => line.speaker === 'd2' && line.text.includes('How was your day?')), 'Jules’s greeting asks something: ' + JSON.stringify(state.lines.map(line => line.text)));
  assert.equal((await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'answer', text: 'Pretty good, I got here a bit early.', target: 'table' })).status, 202); await api.settle(h2);
  assert.match(doubleNote(requests[0]), /Jules asked Jamie “How was your day\?” a little while ago and has not had an answer\./, 'it is read before the speaking friend’s own turn clears it');
  assert.doesNotMatch(doubleNote(requests[0]), /Mira asked Alex/, 'the other pair’s greeting asked nothing');
  assert.equal((await api.request(api.path(h2) + '/turn', h2.token, { turnId: 'again', text: 'And you?', target: 'table' })).status, 202); await api.settle(h2);
  assert.doesNotMatch(doubleNote(requests[1]), /a little while ago and has not had an answer/, 'once answered it is not carried forward');
});

test('“what do you mean?” is about the line of the date they were talking to, not whoever spoke last', async t => {
  const requests: ClaudeRequest[] = [];
  const lines = [[{ speaker: 'd1', text: 'Honestly, I am just here for the cake gossip.', emotion: 'amused' }, { speaker: 'd2', text: 'I only came for the bread basket.', emotion: 'amused' }], [], [], [], [], []];
  const api = await boot({ claude: claude(request => requests.push(request), () => response(lines.shift() ?? [])) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await seatBoth(api, h1, h2);
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'first', text: 'My graduating class was under seventy people.', target: 'table' })).status, 202); await api.settle(h1);
  await api.hear(h1, 'd1', 'Honestly, I am just here for the cake gossip.'); await api.hear(h1, 'd2', 'I only came for the bread basket.');
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'second', text: 'what the heck is cake gossip', target: 'd1' })).status, 202); await api.settle(h1);
  assert.match(doubleNote(requests[1]), /Alex seems to be asking about Mira’s last line \(“Honestly, I am just here for the cake gossip\.”\)/);
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'third', text: 'what do you mean', target: 'd1' })).status, 202); await api.settle(h1);
  assert.match(doubleNote(requests[2]), /asking about Mira’s last line/, 'it points at the date who was addressed (Mira), even though Jules spoke after her');
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'fourth', text: 'what do you mean', target: 'h2' })).status, 202); await api.settle(h1);
  assert.doesNotMatch(doubleNote(requests[3]), /asking about/, 'said to the other friend, it is not about anything a date said');
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'fifth', text: 'Jules, what do you mean by that?', target: 'd1' })).status, 202); await api.settle(h1);
  assert.match(doubleNote(requests[4]), /asking about Jules’s last line \(“I only came for the bread basket\.”\)/, 'a date named in the question is the one being asked');
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'sixth', text: 'huh what do you mean', target: 'table' })).status, 202); await api.settle(h1);
  assert.match(doubleNote(requests[5]), /asking about Jules’s last line/, 'said to the table, it is about whoever spoke last');
});

test('a scripted line that arrives after the reply is not mistaken for that reply never reaching the friend', async t => {
  const requests: ClaudeRequest[] = []; const api = await boot({ claude: claude(request => requests.push(request)) }); t.after(() => api.close()); const { h1, h2 } = await api.pair();
  await seatBoth(api, h1, h2);
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'one', text: 'Pretty good, thanks for asking.', target: 'table' })).status, 202); await api.settle(h1);
  const spoken = (await api.poll(h1)).lines.filter(line => line.speaker === 'd1' && line.text === 'I have been meaning to ask about your music taste.').at(-1)!;
  await api.hear(h1, 'd1', spoken.text); api.advance(60);
  assert.equal((await api.request(api.path(h1) + '/turn', h1.token, { turnId: 'two', text: 'I like all sorts, honestly.', target: 'table' })).status, 202); await api.settle(h1);
  assert.ok((await api.poll(h1)).lines.some(line => line.speaker === 'waiter' && line.text.startsWith('Take your time with the menu')), 'Eli’s scripted line did land after the reply, unheard');
  assert.doesNotMatch(doubleNote(requests[1]), /kept talking/, 'an unheard scripted line is not their reply, which they did hear');
});
