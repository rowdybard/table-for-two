import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { DATES, MENU } from '../src/restaurant/content';
import { AUTHORED_UTTERANCES } from '../src/restaurant/authored';
import { getStoryCue } from '../src/restaurant/story';
import type { SceneTurn, TurnEvent } from '../src/restaurant/types';
import { attachRestaurantServer, completeUtterances, validateTurn, type RestaurantOptions } from '../server/restaurant/index';
import { DinnerScene } from '../server/restaurant/scene';
import { anthropicAdapter, DateApiError, elevenLabsAdapter, type ClaudeAdapter, type SpeechAdapter } from '../server/restaurant/providers';

const turn: SceneTurn = { utterances: [{ speaker: 'date', text: 'I like that answer. What made you pick this place?', emotion: 'amused' }, { speaker: 'waiter', text: 'I will give you two another minute.', emotion: 'warm' }], emotion: 'amused', action: 'none', memory: 'The human chose this restaurant.' };
const encode = (data: unknown) => JSON.stringify(data);
const decode = (text: string): TurnEvent[] => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
function adapter(onCall?: () => void): ClaudeAdapter { return { async *stream() { onCall?.(); yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 1, cacheReadTokens: 30, cacheWriteTokens: 20 } }; const text = encode(turn); for (let i = 0; i < text.length; i += 17) { await delay(1); yield { type: 'text', text: text.slice(i, i + 17) }; } yield { type: 'usage', usage: { outputTokens: 80 } }; } }; }
async function boot(options: RestaurantOptions = {}) {
  let app: Awaited<ReturnType<typeof attachRestaurantServer>>;
  const http = createServer((req, res) => { if (!app.handle(req, res)) { res.statusCode = 404; res.end(); } });
  app = await attachRestaurantServer(http, { autoTick: false, ledgerPath: false, env: { DATE_SPEECH_PROVIDER: 'none' }, ...options });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  async function create(extra: Record<string, unknown> = {}) { const r = await fetch(url + '/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: encode({ dateId: 'mira', ...extra }) }); assert.equal(r.status, 201); return await r.json() as { state: ReturnType<DinnerScene['snapshot']>; token: string }; }
  return { url, create, request: (path: string, token: string, value?: unknown) => fetch(url + path, { method: value === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: encode(value) }) }), async close() { await app.close(); http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close(e => e ? reject(e) : resolve())); } };
}

test('restaurant HTTP starts a solo scene immediately and validates auth, origin, commands and providers', async t => {
  const api = await boot(); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  assert.equal(state.phase, 'playing'); assert.deepEqual(state.participants.map(p => p.kind), ['human', 'ai']);
  assert.equal((await api.request(path, 'wrong')).status, 401);
  const provider = await fetch(api.url + '/api/date/status').then(r => r.json()); assert.equal(provider.claude, false); assert.equal(provider.speech, false);
  const unavailable = await api.request(path + '/turn', token, { turnId: 'a', text: 'Hello', model: 'claude-haiku-5-5' }); assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, 'claude_unconfigured');
  assert.equal((await api.request(path + '/command', token, { type: 'interact', target: 'menu', choice: MENU[0] })).status, 409);
  assert.equal((await api.request(path + '/command', token, { type: 'move', x: 9, z: 0, yaw: 0 })).status, 409);
  assert.equal((await api.request(path + '/command', token, { type: 'pause', paused: 'yes' })).status, 400);
  const cross = await fetch(api.url + path + '/command', { method: 'POST', headers: { origin: 'https://unrelated.example', 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: encode({ type: 'pause', paused: true }) }); assert.equal(cross.status, 403);
  assert.equal((await api.request(path + '/command', token, { type: 'pause', paused: true })).status, 200);
  assert.equal((await api.request(path + '/command', token, { type: 'move', x: 0, z: 1, yaw: 0 })).status, 409);
  const unpause = await api.request(path + '/command', token, { type: 'pause', paused: false }); assert.equal((await unpause.json()).state.phase, 'playing');
  await api.request(path + '/command', token, { type: 'pause', paused: true }); const finish = await api.request(path + '/command', token, { type: 'finish' }); assert.equal((await finish.json()).state.phase, 'ended');
});

test('one deduplicated Claude request streams a date and one cast line, preserves memory and actual usage', async t => {
  let calls = 0; const api = await boot({ claude: adapter(() => calls++) }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`, request = { turnId: 'same-turn', text: 'I liked the menu.', model: 'claude-haiku-5-5' };
  const a = await api.request(path + '/turn', token, request), b = await api.request(path + '/turn', token, request);
  const [first, second] = await Promise.all([a.text(), b.text()]); assert.equal(calls, 1); assert.deepEqual(decode(first), decode(second));
  const events = decode(first); assert.deepEqual(events.filter(e => e.type === 'utterance').map(e => e.utterance.speaker), ['date', 'waiter']); assert.equal(events[0].type, 'start'); assert.equal(events.at(-1)?.type, 'done');
  const snapshot = (await (await api.request(path, token)).json()).state; assert.equal(snapshot.memory, turn.memory); assert.equal(snapshot.emotion, 'amused'); assert.equal(snapshot.usage.inputTokens, 100); assert.equal(snapshot.usage.outputTokens, 80); assert.equal(snapshot.usage.cacheReadTokens, 30); assert.equal(snapshot.usage.cacheWriteTokens, 20); assert.equal(snapshot.usage.claudeRequests, 1); assert.ok(snapshot.usage.totalCost > 0);
  const conflict = await api.request(path + '/turn', token, { ...request, text: 'Changed content' }); assert.equal(conflict.status, 409);
  const replay = decode(await (await api.request(path + '/turn', token, request)).text()); assert.deepEqual(replay, events); assert.equal(calls, 1);
});

test('JSON extraction handles chunked escaped strings and invalid speaker, action or extra cast responses are rejected', () => {
  const line = { speaker: 'date', text: 'A "brace }" and a \\ slash.', emotion: 'warm' };
  assert.deepEqual(completeUtterances('{"utterances":[' + encode(line).slice(0, -1)), []);
  assert.deepEqual(completeUtterances('{"utterances":[' + encode(line) + ','), [line]);
  assert.throws(() => validateTurn({ ...turn, action: 'teleport' }));
  assert.throws(() => validateTurn({ ...turn, utterances: [turn.utterances[1]] }));
  assert.throws(() => validateTurn({ ...turn, utterances: [...turn.utterances, turn.utterances[1]] }));
  assert.throws(() => validateTurn({ ...turn, emotion: 'secret-admin' }));
  const social = { signal: 'pressure', reason: 'A delivered food boundary was repeated.', wantsToLeave: false, boundary: { kind: 'repeat', topic: 'food-drink', refusal: 'Please choose only your own food.', evidence: 'I am ordering for you anyway.' } };
  assert.deepEqual(validateTurn({ ...turn, social }).social, social);
  assert.throws(() => validateTurn({ ...turn, social: { ...social, boundary: { ...social.boundary, topic: 'free-romance-points' } } }));
  assert.throws(() => validateTurn({ ...turn, social: { ...social, boundary: { ...social.boundary, strikes: 100 } } }));
});

test('ungrounded pressure flags cannot turn ordinary flirting into repeated boundary disregard', async t => {
  let calls = 0;
  const claude: ClaudeAdapter = { async *stream() {
    calls++;
    yield { type: 'text', text: encode({ ...turn, social: { signal: 'pressure', reason: 'The model judged this too forward.', wantsToLeave: true } }) };
  } };
  const api = await boot({ claude }); t.after(() => api.close());
  const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  for (const [index, text] of ['You look lovely tonight.', 'I was flirting with you, not talking about the menu.', 'I like your sense of humor.'].entries()) {
    const response = await api.request(path + '/turn', token, { turnId: `ungrounded-${index}`, text, model: 'claude-haiku-5-5' });
    assert.ok(decode(await response.text()).every(event => event.type !== 'error'));
    const snapshot = (await (await api.request(path, token)).json()).state;
    assert.equal(snapshot.phase, 'playing'); assert.equal(snapshot.evening.stance, 'curious');
    assert.equal(snapshot.evening.farewell.ending, null);
    assert.equal(snapshot.evening.cues.some((cue: { key: string }) => cue.key === 'boundary-warning'), false);
  }
  assert.equal(calls, 3, 'there are no extra assessment or recovery calls');
});

test('outage, damaged JSON and timeout produce visible failures and leave scene usable', async t => {
  let mode = 'damage';
  const claude: ClaudeAdapter = { async *stream(_request, signal) { if (mode === 'outage') throw new DateApiError(502, 'claude_provider', 'Provider unavailable.'); if (mode === 'timeout') { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return; } yield { type: 'usage', usage: { inputTokens: 12 } }; yield { type: 'text', text: '{"utterances":[]' }; } };
  const api = await boot({ claude, requestTimeoutMs: 20 }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  for (mode of ['damage', 'outage', 'timeout']) { const events = decode(await (await api.request(path + '/turn', token, { turnId: mode, text: 'Hello', model: 'claude-haiku-5-5' })).text()); assert.ok(events.some(e => e.type === 'error')); assert.equal(events.at(-1)?.type, 'done'); }
  const snapshot = (await (await api.request(path, token)).json()).state; assert.equal(snapshot.phase, 'playing'); assert.equal(snapshot.usage.claudeRequests, 3);
});

test('interrupt cancels Claude and stale speech, while retaining received usage', async t => {
  let aborted = false;
  const claude: ClaudeAdapter = { async *stream(_request, signal) { yield { type: 'usage', usage: { inputTokens: 45 } }; yield { type: 'text', text: '{"utterances":[' + encode(turn.utterances[0]) }; await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); } };
  const api = await boot({ claude }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  const response = await api.request(path + '/turn', token, { turnId: 'cancel', text: 'Hello', model: 'claude-haiku-5-5' });
  await delay(10); await api.request(path + '/interrupt', token, {}); const events = decode(await response.text()); assert.equal(aborted, true); assert.ok(events.some(e => e.type === 'error' && e.code === 'interrupted'));
  const stale = await api.request(path + '/speech', token, { generation: 1, utterance: turn.utterances[0] }); assert.equal(stale.status, 409);
  const snapshot = (await (await api.request(path, token)).json()).state; assert.equal(snapshot.usage.inputTokens, 45); assert.ok(snapshot.usage.outputTokens > 0); assert.ok(snapshot.usage.totalCost > 0);
});

test('speech requires an authorized line, streams once, caches exact voice/emotion/text and charges canceled synthesis', async t => {
  let calls = 0, shouldAbort = false;
  const speech: SpeechAdapter = { async *stream(_request, signal) { calls++; yield Buffer.from('ID3audio'); if (shouldAbort) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); else yield Buffer.from('complete'); } };
  const api = await boot({ speech }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`, opening = { speaker: 'date', text: DATES[0].opening, emotion: 'neutral' };
  const unknown = await api.request(path + '/speech', token, { generation: 0, utterance: { ...opening, text: 'Arbitrary expensive synthesis' } }); assert.equal(unknown.status, 400);
  const first = await api.request(path + '/speech', token, { generation: 0, utterance: opening }); assert.equal(first.headers.get('x-speech-cache'), 'miss'); assert.equal(await first.text(), 'ID3audiocomplete');
  const cached = await api.request(path + '/speech', token, { generation: 0, utterance: opening }); assert.equal(cached.headers.get('x-speech-cache'), 'hit'); assert.equal(await cached.text(), 'ID3audiocomplete'); assert.equal(calls, 1);
  let snapshot = (await (await api.request(path, token)).json()).state; assert.equal(snapshot.usage.cacheHits, 1); assert.equal(snapshot.usage.speechCharacters, opening.text.length); assert.ok(snapshot.usage.speechCost > 0);
  shouldAbort = true; const second = await api.create({ dateId: 'dev' }), secondPath = `/api/date/sessions/${second.state.id}`;
  const speaking = await api.request(secondPath + '/speech', second.token, { generation: 0, utterance: { speaker: 'date', text: DATES[2].opening, emotion: 'neutral' } }); const canceled = speaking.text().catch(() => 'canceled');
  await api.request(secondPath + '/interrupt', second.token, {}); await canceled;
  snapshot = (await (await api.request(secondPath, second.token)).json()).state; assert.ok(snapshot.usage.speechCharacters > 0); assert.ok(snapshot.usage.speechCost > 0);
});

test('session and daily reservations block paid calls before starting, and production locks model selection', async t => {
  let calls = 0; const api = await boot({ claude: adapter(() => calls++), env: { DATE_DAILY_LIMIT_USD: '.01', NODE_ENV: 'production' } }); t.after(() => api.close());
  const tiny = await api.create({ sessionLimit: .01 }), path = `/api/date/sessions/${tiny.state.id}`;
  const sonnet = await api.request(path + '/turn', tiny.token, { turnId: 'sonnet', text: 'Hello', model: 'claude-sonnet-5-5' }); assert.equal(sonnet.status, 400); assert.equal(calls, 0);
  const expensiveApi = await boot({ claude: adapter(() => calls++), env: { DATE_SESSION_LIMIT_USD: '.01', DATE_MAX_OUTPUT_TOKENS: '1500' } }); t.after(() => expensiveApi.close());
  const expensive = await expensiveApi.create(); const tooMuch = await expensiveApi.request(`/api/date/sessions/${expensive.state.id}/turn`, expensive.token, { turnId: 'expensive', text: 'Hello', model: 'claude-sonnet-5-5' }); assert.equal(tooMuch.status, 402); assert.equal(calls, 0);
});

test('scene physics bounds movement, stages only legitimate seated orders, pauses clock and triggers authored events', async () => {
  await RAPIER.init();
  const scene = new DinnerScene('mira', 2); try {
    assert.throws(() => scene.command({ type: 'interact', target: 'seat' }));
    let now = 1000; for (let i = 0; i < 110; i++) { scene.command({ type: 'move', x: 0, z: -1, yaw: 0 }, now); scene.step(1 / 60, now); now += 1000 / 60; }
    scene.command({ type: 'interact', target: 'seat' }); assert.equal(scene.state.stage, 'seated');
    for (let i = 0; i < 600; i++) { scene.step(1 / 60, now); now += 1000 / 60; const date = scene.state.participants[1].position; assert.ok(!(Math.abs(date[0]) < .94 && date[2] > -2.09 && date[2] < -.21), 'date must route outside the table footprint'); }
    const seatedDate = scene.state.participants[1].position; assert.ok(Math.hypot(seatedDate[0], seatedDate[2] + 2.25) < .25, `date reaches chair (${seatedDate[0]},${seatedDate[2]})`);
    scene.command({ type: 'interact', target: 'menu', choice: MENU[0] }); assert.equal(scene.state.stage, 'ordered');
    scene.command({ type: 'interact', target: 'glass' }); assert.equal(scene.state.glassRaised, true); scene.command({ type: 'interact', target: 'glass' }); assert.equal(scene.state.glassRaised, false);
    scene.command({ type: 'pause', paused: true }); const elapsed = scene.state.elapsed; scene.step(60); assert.equal(scene.state.elapsed, elapsed);
    scene.command({ type: 'pause', paused: false }); scene.step(45); scene.step(4 * 60); assert.deepEqual(scene.state.events, ['wrong-order']); scene.step(6 * 60); scene.step(7 * 60); assert.deepEqual(scene.state.events, ['wrong-order'], 'later incidents must wait for a real resolution');
    scene.applyTurn({ ...turn, action: 'finish' }); assert.equal(scene.state.phase, 'playing');
    assert.throws(() => scene.command({ type: 'interact', target: 'bill' })); scene.command({ type: 'finish' }); assert.equal(scene.state.phase, 'ended'); assert.equal(scene.state.evening.farewell.ending?.kind, 'early-exit');
  } finally { scene.free(); }
});

test('playback receipts preserve heard and interrupted lines in the next single Claude context', async t => {
  const contexts: any[] = []; const base = adapter(); const claude: ClaudeAdapter = { async *stream(request, signal) { contexts.push(structuredClone(request.messages)); yield* base.stream(request, signal); } };
  const api = await boot({ claude }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  const events = decode(await (await api.request(path + '/turn', token, { turnId: 'first', text: 'My favorite food is pasta.', model: 'claude-haiku-5-5' })).text()); const start = events.find(e => e.type === 'start'); assert.ok(start && start.type === 'start');
  const complete = await api.request(path + '/playback', token, { generation: start.generation, speaker: 'date', text: turn.utterances[0].text, completed: true, playedSeconds: 3.1 }); assert.equal(complete.status, 200);
  const invalid = await api.request(path + '/playback', token, { generation: start.generation, speaker: 'date', text: 'Not an authorized line', completed: true, playedSeconds: 3 }); assert.equal(invalid.status, 409);
  await api.request(path + '/interrupt', token, {});
  await (await api.request(path + '/turn', token, { turnId: 'second', text: 'Sorry, what were you saying?', model: 'claude-haiku-5-5' })).text();
  const context = JSON.stringify(contexts[1]); assert.match(context, /heard completely/); assert.match(context, /not heard; response was interrupted/); assert.match(context, /My favorite food is pasta/);
});

test('Anthropic adapter sends fast model-specific thinking and structured output, parses split SSE usage without exposing provider secrets', async () => {
  for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const) {
    let captured: any;
    const payload = 'data: ' + encode({ type: 'message_start', message: { usage: { input_tokens: 41, output_tokens: 1, cache_read_input_tokens: 22, cache_creation_input_tokens: 3 } } }) + '\r\n\r\n' + 'data: ' + encode({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"text":"quoted \\\"yes\\\""}' } }) + '\n\n' + 'data: ' + encode({ type: 'message_delta', usage: { output_tokens: 12 } }) + '\n\n';
    const fetcher = (async (_url: unknown, init: RequestInit) => { captured = JSON.parse(init.body as string); return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < payload.length; i += 7) controller.enqueue(new TextEncoder().encode(payload.slice(i, i + 7))); controller.close(); } }), { status: 200 }); }) as typeof fetch;
    const result = []; for await (const event of anthropicAdapter({ ANTHROPIC_API_KEY: 'secret-never-returned' }, fetcher).stream({ model, system: 'system', messages: [{ role: 'user', content: 'hello' }], maxTokens: 700 }, new AbortController().signal)) result.push(event);
    assert.equal(captured.model, model); assert.equal(captured.output_config.effort, 'low'); assert.equal(captured.output_config.format.type, 'json_schema'); assert.equal(captured.thinking.type, model === 'claude-haiku-5-5' ? 'disabled' : 'between_tools'); assert.equal(captured.temperature, undefined);
    assert.ok(result.some(r => r.type === 'usage' && r.usage.inputTokens === 41)); assert.ok(result.some(r => r.type === 'usage' && r.usage.outputTokens === 12)); assert.equal(result.filter(r => r.type === 'text').length, 1);
  }
  const bad = anthropicAdapter({ ANTHROPIC_API_KEY: 'private-key' }, (async () => new Response('private-key internal response', { status: 401 })) as typeof fetch);
  await assert.rejects(async () => { for await (const _event of bad.stream({ model: 'claude-haiku-5-5', system: '', messages: [], maxTokens: 700 }, new AbortController().signal)) {} }, error => error instanceof DateApiError && !error.message.includes('private-key') && error.message.includes('API key'));
});

test('persisted daily ledger recovers unresolved reservations and blocks new provider calls after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'table-for-two-budget-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'budget.json'); await writeFile(path, encode({ day: new Date().toISOString().slice(0, 10), spent: .009, reserved: .005 })); let calls = 0;
  const api = await boot({ ledgerPath: path, env: { DATE_DAILY_LIMIT_USD: '.01' }, claude: adapter(() => calls++) }); t.after(() => api.close());
  const { state, token } = await api.create(); const response = await api.request(`/api/date/sessions/${state.id}/turn`, token, { turnId: 'recovered-budget', text: 'Hello', model: 'claude-haiku-5-5' }); assert.equal(response.status, 402); assert.equal((await response.json()).code, 'daily_limit'); assert.equal(calls, 0);
});

test('Eleven v4 Turbo registers a single voice on the dialogue socket, flushes audio and closes on cancellation', async t => {
  const http = createServer(), wss = new WebSocketServer({ server: http }); await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { for (const client of wss.clients) client.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); });
  const frames: any[] = []; let cancel = false, remoteClosed = false;
  wss.on('connection', ws => { ws.on('close', () => { remoteClosed = true; }); ws.on('message', bytes => { const frame = JSON.parse(bytes.toString()); frames.push(frame); if (frame.close_socket) { ws.send(encode({ audio: Buffer.from('ID3fake').toString('base64') })); if (!cancel) ws.send(encode({ is_final: true })); } }); });
  let url: URL | undefined; const provider = elevenLabsAdapter({ ELEVENLABS_API_KEY: 'local-test-key' }, (providerUrl, options) => { url = providerUrl; assert.equal((options.headers as Record<string, string>)['xi-api-key'], 'local-test-key'); return new WebSocket(`ws://127.0.0.1:${address.port}`, options); });
  const request = { voiceId: 'test-voice', model: 'eleven_v4_turbo', text: 'That was funny.', emotion: 'amused' as const }, chunks: Uint8Array[] = [];
  for await (const chunk of provider.stream(request, new AbortController().signal)) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'ID3fake'); assert.equal(url?.pathname, '/v1/text-to-dialogue/stream-input'); assert.equal(url?.searchParams.get('model_id'), 'eleven_v4_turbo'); assert.deepEqual(frames[0], { voices: ['test-voice'] }); assert.equal(frames[1].inputs[0].voice_id, 'test-voice'); assert.match(frames[1].inputs[0].text, /^\[amused\]/); assert.equal(frames[1].flush, true); assert.equal(frames[2].close_socket, true);
  cancel = true; remoteClosed = false; const controller = new AbortController(); await assert.rejects(async () => { for await (const _chunk of provider.stream(request, controller.signal)) controller.abort(); }, error => error instanceof DateApiError && error.code === 'interrupted'); await delay(15); assert.equal(remoteClosed, true);
});

test('pre-generated exact clips play without a live speech key and future scene reactions cannot be synthesized early', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'table-for-two-clips-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'opening.mp3'), 'ID3authored'); await writeFile(join(directory, 'manifest.json'), encode({ clips: [{ id: 'opening-mira', text: DATES[0].opening, emotion: 'neutral', voiceId: DATES[0].voiceId, model: 'eleven_v4_turbo', file: 'opening.mp3' }] }));
  const api = await boot({ clipsDirectory: directory }); t.after(() => api.close()); const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  const status = await fetch(api.url + '/api/date/status').then(r => r.json()); assert.equal(status.cachedSpeech, true); assert.equal(status.speech, false);
  const response = await api.request(path + '/speech', token, { generation: 0, utterance: { speaker: 'date', text: DATES[0].opening, emotion: 'neutral' } }); assert.equal(response.status, 200); assert.equal(response.headers.get('x-speech-cache'), 'clip'); assert.equal(await response.text(), 'ID3authored');
  const future = AUTHORED_UTTERANCES.find(line => line.clipId === 'spill-waiter')!;
  const premature = await api.request(path + '/speech', token, { generation: 0, utterance: { speaker: future.speaker, text: future.text, emotion: future.emotion } }); assert.equal(premature.status, 400);
  const futureEnding = getStoryCue('ending-another-evening', 'mira')[0]; assert.ok(futureEnding);
  assert.equal((await api.request(path + '/speech', token, { generation: 0, utterance: futureEnding })).status, 400, 'a pre-generated ending is not authorized before its scene cue');
  const welcome = state.evening.cues[0].utterances.find(u => u.speaker === 'date')!;
  assert.equal((await api.request(path + '/playback', token, { generation: 0, speaker: welcome.speaker, text: welcome.text, completed: true, playedSeconds: 0 })).status, 200, 'caption-only authored cues can acknowledge playback');
  const snapshot = (await (await api.request(path, token)).json()).state; assert.equal(snapshot.usage.speechCost, 0); assert.equal(snapshot.usage.cacheHits, 1);
});

test('newer turn supersedes a pending ledger write, duplicate clients share cancellation, and reservations settle', async t => {
  let release!: () => void, entered!: () => void, holding = true, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }), saved: { reserved: number; spent: number }[] = [];
  t.after(() => release());
  const api = await boot({ claude: adapter(() => calls++), budgetStore: { async load() { return null; }, async save(record) { saved.push({ ...record }); if (holding && record.reserved > 0) { holding = false; entered(); await gate; } } } }); t.after(() => api.close());
  const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`, first = { turnId: 'pending-first', text: 'The first sentence.', model: 'claude-haiku-5-5' };
  const original = api.request(path + '/turn', token, first); await started;
  const duplicate = await api.request(path + '/turn', token, first);
  const latest = api.request(path + '/turn', token, { ...first, turnId: 'pending-latest', text: 'Actually, let me start again.' });
  for (let i = 0; i < 20; i++) { const current = (await (await api.request(path, token)).json()).state; if (current.generation >= 2) break; await delay(2); }
  release(); const older = await original; assert.equal(older.status, 409); assert.equal((await older.json()).code, 'interrupted'); const shared = decode(await duplicate.text()); assert.ok(shared.some(event => event.type === 'error' && event.code === 'interrupted'));
  const newestEvents = decode(await (await latest).text()); assert.ok(newestEvents.some(event => event.type === 'utterance')); assert.equal(calls, 1);
  for (let i = 0; i < 20 && saved.at(-1)?.reserved !== 0; i++) await delay(2);
  assert.equal(saved.at(-1)?.reserved, 0); assert.ok((saved.at(-1)?.spent || 0) > 0);
});

test('interrupt during ledger persistence prevents a paid request from starting afterward', async t => {
  let release!: () => void, entered!: () => void, holding = true, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; }), saved: { reserved: number; spent: number }[] = [];
  t.after(() => release());
  const api = await boot({ claude: adapter(() => calls++), budgetStore: { async load() { return null; }, async save(record) { saved.push({ ...record }); if (holding && record.reserved > 0) { holding = false; entered(); await gate; } } } }); t.after(() => api.close());
  const { state, token } = await api.create(), path = `/api/date/sessions/${state.id}`;
  const pending = api.request(path + '/turn', token, { turnId: 'pending-interrupt', text: 'Never mind.', model: 'claude-haiku-5-5' }); await started;
  const interruption = await api.request(path + '/interrupt', token, {}); assert.equal(interruption.status, 200); release(); const response = await pending; assert.equal(response.status, 409); assert.equal((await response.json()).code, 'interrupted'); assert.equal(calls, 0);
  for (let i = 0; i < 20 && saved.at(-1)?.reserved !== 0; i++) await delay(2);
  assert.equal(saved.at(-1)?.reserved, 0); assert.equal(saved.at(-1)?.spent, 0);
});
