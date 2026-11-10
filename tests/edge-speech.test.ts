import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer, type ClientOptions } from 'ws';
import { edgeSpeechAdapter, edgeSettings, EDGE_MODEL, EDGE_VOICES } from '../server/restaurant/edge-speech';
import { DateApiError, speechText, type SpeechAdapter, type SpeechRequest } from '../server/restaurant/providers';
import { attachRestaurantServer } from '../server/restaurant';
import { getDate } from '../src/restaurant/content';

const request = (emotion: SpeechRequest['emotion'] = 'amused'): SpeechRequest => ({ text: 'A little joke & a real answer.', voiceId: EDGE_VOICES.mira, model: EDGE_MODEL, provider: 'edge', emotion, settings: edgeSettings(emotion) });
const audioFrame = (audio: string) => { const header = Buffer.from('Path:audio\r\nContent-Type:audio/mpeg\r\n'); const length = Buffer.alloc(2); length.writeUInt16BE(header.length); return Buffer.concat([length, header, Buffer.from(audio)]); };

async function socketServer(onConnection: (ws: WebSocket) => void) {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  wss.on('connection', onConnection);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  const connect = (_url: URL, options: ClientOptions) => { const { host: _host, ...local } = options; return new WebSocket(url, local); };
  return { connect, async close() { for (const ws of wss.clients) ws.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}

test('Edge streams MP3 chunks before turn.end, escapes text, uses prosody and never sends emotion markup', async t => {
  const messages: string[] = []; let ended = false;
  const server = await socketServer(ws => ws.on('message', data => {
    const text = data.toString(); messages.push(text);
    if (text.includes('Path:ssml')) {
      ws.send(audioFrame('ID3first'));
      setTimeout(() => { ended = true; ws.send(audioFrame('second')); ws.send('Path:turn.end\r\n\r\n'); }, 100);
    }
  })); t.after(() => server.close());
  const stream = edgeSpeechAdapter(server.connect).stream({ ...request(), text: '[amused] A joke & <an answer>.' }, new AbortController().signal)[Symbol.asyncIterator]();
  const first = await stream.next(); assert.equal(Buffer.from(first.value!).toString(), 'ID3first'); assert.equal(ended, false);
  const chunks: Uint8Array[] = [first.value!]; for (;;) { const chunk = await stream.next(); if (chunk.done) break; chunks.push(chunk.value); }
  assert.equal(Buffer.concat(chunks).toString(), 'ID3firstsecond');
  const ssml = messages.find(message => message.includes('Path:ssml'))!;
  assert.match(ssml, /rate="\+4%"/); assert.match(ssml, /pitch="\+2Hz"/); assert.match(ssml, /A joke &amp; &lt;an answer&gt;/);
  assert.doesNotMatch(ssml, /amused|express-as|style=/); assert.match(ssml, new RegExp(EDGE_VOICES.mira));
  assert.match(messages[0], /audio-24khz-96kbitrate-mono-mp3/);
});

test('Edge cancellation closes an active voice socket and rejects late audio', async t => {
  let closed = false;
  const server = await socketServer(ws => { ws.on('close', () => { closed = true; }); ws.on('message', data => { if (data.toString().includes('Path:ssml')) ws.send(audioFrame('ID3only')); }); });
  t.after(() => server.close()); const controller = new AbortController(), iterator = edgeSpeechAdapter(server.connect).stream(request(), controller.signal)[Symbol.asyncIterator]();
  assert.equal(Buffer.from((await iterator.next()).value!).toString(), 'ID3only');
  controller.abort(); await assert.rejects(iterator.next(), (error: unknown) => error instanceof DateApiError && error.code === 'interrupted');
  for (let i = 0; i < 30 && !closed; i++) await delay(5); assert.equal(closed, true);
  let calls = 0; await assert.rejects(async () => { for await (const _ of edgeSpeechAdapter(() => { calls++; throw new Error('Should not connect.'); }).stream(request(), controller.signal)) {} }, /interrupted/i); assert.equal(calls, 0);
});

test('Edge also cancels a pending handshake rather than waiting for the synthesis timeout', async t => {
  let ready!: () => void; const seen = new Promise<void>(resolve => { ready = resolve; }); const sockets = new Set<import('node:stream').Duplex>();
  const http = createServer(); http.on('upgrade', (_req, socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); ready(); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
  const controller = new AbortController(), iterator = edgeSpeechAdapter((_url, options) => { const { host: _host, ...local } = options; return new WebSocket(url, local); }, 10000).stream(request(), controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next(); await seen; controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DateApiError && error.code === 'interrupted');
});

test('an incomplete or malformed Edge stream is a visible free-service failure', async t => {
  for (const malformed of [false, true]) {
    const server = await socketServer(ws => ws.on('message', data => { if (data.toString().includes('Path:ssml')) { if (malformed) ws.send(Buffer.from([0])); else ws.close(); } }));
    t.after(() => server.close());
    await assert.rejects(async () => { for await (const _ of edgeSpeechAdapter(server.connect).stream(request(), new AbortController().signal)) {} }, (error: unknown) => error instanceof DateApiError && error.code === 'edge_speech' && error.status === 503);
  }
});

async function restaurant(speech?: SpeechAdapter, env: NodeJS.ProcessEnv = {}) {
  const http = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  const app = await attachRestaurantServer(http, { env, speech, autoTick: false, ledgerPath: false });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  return { app, base, async close() { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}

test('production defaults to free Edge even with an old ElevenLabs key; paid voices require explicit opt-in', async t => {
  const free = await restaurant(undefined, { ELEVENLABS_API_KEY: 'unused-old-key', DATE_SPEECH_MODEL: 'eleven_v4_turbo' }); t.after(() => free.close());
  const status = free.app.services.status(); assert.equal(status.speechProvider, 'edge'); assert.equal(status.speech, true); assert.equal(status.speechModel, EDGE_MODEL); assert.equal(status.speechCostPer1K, 0);
  const paid = await restaurant(undefined, { DATE_SPEECH_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'unused-explicit-key' }); t.after(() => paid.close());
  assert.equal(paid.app.services.status().speechProvider, 'elevenlabs'); assert.ok(paid.app.services.status().speechCostPer1K! > 0);
  const disabled = await restaurant(undefined, { DATE_SPEECH_PROVIDER: 'none', ELEVENLABS_API_KEY: 'unused-key' }); t.after(() => disabled.close()); assert.equal(disabled.app.services.status().speech, false);
});

test('free Edge keeps character voices consistent, counts generated characters/cache hits and never charges even at a spent paid budget', async t => {
  const requests: SpeechRequest[] = []; const adapter: SpeechAdapter = { async *stream(request) { requests.push(request); yield Buffer.from('ID3free'); } };
  const api = await restaurant(adapter, { DATE_SPEECH_PROVIDER: 'edge', DATE_SESSION_LIMIT_USD: '.01', DATE_DAILY_LIMIT_USD: '.01' }); t.after(() => api.close());
  const account = api.app.services.createAccount(); account.usage.claudeCost = account.usage.totalCost = 5;
  const speak = async (voice: keyof typeof EDGE_VOICES, emotion: SpeechRequest['emotion'] = 'warm') => { const chunks = []; for await (const chunk of api.app.services.streamSpeech(account, { voice, text: 'Glad you stayed.', emotion }, new AbortController().signal)) chunks.push(chunk); assert.equal(Buffer.concat(chunks).toString(), 'ID3free'); };
  await speak('mira'); await speak('mira'); assert.equal(requests.length, 1); assert.equal(account.usage.cacheHits, 1); assert.equal(account.usage.speechCharacters, 'Glad you stayed.'.length);
  await speak('mira', 'amused'); await speak('jules'); await speak('dev'); await speak('waiter'); await speak('diner');
  assert.equal(requests.length, 6); assert.equal(account.usage.speechCost, 0); assert.equal(account.usage.totalCost, 5); assert.equal(account.reserved, 0);
  assert.deepEqual(requests.map(request => request.voiceId), [EDGE_VOICES.mira, EDGE_VOICES.mira, EDGE_VOICES.jules, EDGE_VOICES.dev, EDGE_VOICES.waiter, EDGE_VOICES.diner]);
  assert.ok(requests.every(request => request.provider === 'edge' && request.model === EDGE_MODEL)); assert.notDeepEqual(requests[0].settings, requests[1].settings);
  assert.equal(speechText({ ...requests[0], text: '[warmly] Glad you stayed.' }), 'Glad you stayed.');
});

test('the authenticated solo speech endpoint uses the same free provider and exact audio cache', async t => {
  let calls = 0; const api = await restaurant({ async *stream() { calls++; yield Buffer.from('ID3solo'); } }, { DATE_SPEECH_PROVIDER: 'edge' }); t.after(() => api.close());
  const created = await fetch(api.base + '/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateId: 'mira' }) }).then(response => response.json());
  const utterance = { speaker: 'date', text: getDate('mira')!.opening, emotion: 'neutral' };
  for (let i = 0; i < 2; i++) { const response = await fetch(api.base + `/api/date/sessions/${created.state.id}/speech`, { method: 'POST', headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ generation: 0, utterance }) }); assert.equal(response.status, 200); assert.equal(await response.text(), 'ID3solo'); }
  const state = await fetch(api.base + `/api/date/sessions/${created.state.id}`, { headers: { authorization: `Bearer ${created.token}` } }).then(response => response.json());
  assert.equal(calls, 1); assert.equal(state.state.usage.cacheHits, 1); assert.equal(state.state.usage.speechCost, 0); assert.equal(state.state.usage.speechCharacters, utterance.text.length);
});

test('an unavailable free voice never produces paid charges, invented generated characters or cached failed audio', async t => {
  let calls = 0;
  const api = await restaurant({ async *stream() { calls++; throw new DateApiError(503, 'edge_speech', 'Free voice temporarily unavailable.'); } }, { DATE_SPEECH_PROVIDER: 'edge', ELEVENLABS_API_KEY: 'unused-old-key' }); t.after(() => api.close());
  const account = api.app.services.createAccount();
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(async () => { for await (const _ of api.app.services.streamSpeech(account, { text: 'A fresh line.', emotion: 'warm', voice: 'mira' }, new AbortController().signal)) {} }, /Free voice temporarily unavailable/);
  assert.equal(calls, 2); assert.equal(account.usage.speechCharacters, 0); assert.equal(account.usage.speechCost, 0); assert.equal(account.usage.cacheHits, 0); assert.equal(account.reserved, 0);
});

test('a dropped Edge connection before any audio gets one free second try', async t => {
  let connections = 0;
  const server = await socketServer(ws => { connections++; const first = connections === 1; ws.on('message', data => { if (!data.toString().includes('Path:ssml')) return; if (first) ws.close(); else { ws.send(audioFrame('ID3retry')); ws.send('Path:turn.end\r\n\r\n'); } }); });
  t.after(() => server.close());
  const chunks: Buffer[] = []; for await (const chunk of edgeSpeechAdapter(server.connect).stream(request(), new AbortController().signal)) chunks.push(Buffer.from(chunk));
  assert.equal(connections, 2); assert.equal(Buffer.concat(chunks).toString(), 'ID3retry');
});

test('Edge retries only once and never after audio has started', async t => {
  let connections = 0;
  const failing = await socketServer(ws => { connections++; ws.on('message', data => { if (data.toString().includes('Path:ssml')) ws.close(); }); });
  t.after(() => failing.close());
  await assert.rejects(async () => { for await (const _ of edgeSpeechAdapter(failing.connect).stream(request(), new AbortController().signal)) {} }, (error: unknown) => error instanceof DateApiError && error.code === 'edge_speech');
  assert.equal(connections, 2);
  let partial = 0;
  const cut = await socketServer(ws => { partial++; ws.on('message', data => { if (data.toString().includes('Path:ssml')) { ws.send(audioFrame('ID3half')); setTimeout(() => ws.close(), 20); } }); });
  t.after(() => cut.close());
  await assert.rejects(async () => { for await (const _ of edgeSpeechAdapter(cut.connect).stream(request(), new AbortController().signal)) {} }, (error: unknown) => error instanceof DateApiError);
  assert.equal(partial, 1);
});

test('an Edge stream deadline is not retried after an open but silent socket', async t => {
  let connections = 0;
  const server = await socketServer(() => { connections++; });
  t.after(() => server.close());
  await assert.rejects(async () => {
    for await (const _ of edgeSpeechAdapter(server.connect, 40).stream(request(), new AbortController().signal)) {}
  }, (error: unknown) => error instanceof DateApiError && error.code === 'edge_speech' && /timed out/i.test(error.message));
  assert.equal(connections, 1, 'a timeout must not consume a second full deadline');
});
