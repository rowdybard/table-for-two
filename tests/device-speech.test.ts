import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SpeechPlayer } from '../src/restaurant/SpeechPlayer';
import type { AudioPlayback, SceneUtterance } from '../src/restaurant/types';

const line: SceneUtterance = { speaker: 'date', dateId: 'dev', text: '[warmly] Glad you stayed.', emotion: 'warm' };
class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = ''; volume = 1; currentTime = 0; paused = true; ended = false; playCalls = 0; src = '';
  constructor() { super(); FakeAudio.instances.push(this); }
  pause() { this.paused = true; }
  load() { this.currentTime = 0; }
  removeAttribute() {}
  async play() { this.playCalls++; this.paused = false; this.ended = false; this.dispatchEvent(new Event('playing')); }
  finish() { this.ended = true; this.dispatchEvent(new Event('ended')); }
}
class FakeAudioContext { state = 'running'; createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {}, getFloatTimeDomainData(samples: Float32Array) { samples.fill(0); } }; } createMediaElementSource() { return { connect() {}, disconnect() {} }; } async close() {} async resume() {} }
class FakeUtterance { voice?: SpeechSynthesisVoice; lang = ''; volume = 1; rate = 1; pitch = 1; onstart?: (() => void) | null; onboundary?: (() => void) | null; onend?: (() => void) | null; onerror?: (() => void) | null; constructor(public text: string) {} }
const voices = [ { voiceURI: 'device-ava', name: 'Ava', lang: 'en-US' }, { voiceURI: 'device-sonia', name: 'Sonia', lang: 'en-GB' }, { voiceURI: 'device-andrew', name: 'Andrew', lang: 'en-US' } ] as SpeechSynthesisVoice[];
class FakeSynthesis extends EventTarget { queued: FakeUtterance[] = []; cancels = 0; voices = voices; getVoices() { return this.voices; } speak(value: FakeUtterance) { if (value.text) this.queued.push(value); } cancel() { this.cancels++; } }
function environment() {
  const synthesis = new FakeSynthesis();
  const supplied: Record<string, unknown> = { Audio: FakeAudio, AudioContext: FakeAudioContext, SpeechSynthesisUtterance: FakeUtterance, speechSynthesis: synthesis, cancelAnimationFrame() {}, requestAnimationFrame() { return 0; } };
  const previous = Object.fromEntries(Object.keys(supplied).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(supplied)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { synthesis, restore() { for (const key of Object.keys(supplied)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]!); else Reflect.deleteProperty(globalThis, key); } } };
}
async function ready(synthesis: FakeSynthesis, count = 1) { for (let i = 0; i < 50 && synthesis.queued.length < count; i++) await delay(2); assert.equal(synthesis.queued.length, count); return synthesis.queued[count - 1]; }
const failure = () => Promise.resolve(new Response(JSON.stringify({ error: 'Free server voice is down.' }), { status: 503, headers: { 'content-type': 'application/json' } }));

test('Edge failure can use a stable device character voice and records exactly one actual delivery', async t => {
  const env = environment(); const deliveries: { interrupted: boolean; playedSeconds: number }[] = [], playback: AudioPlayback[] = [];
  const player = new SpeechPlayer({ onPlayback(value) { playback.push(value); }, onStatus() {}, onEnded(_line, result) { deliveries.push(result); } }, { canFallback: () => true, dateId: () => 'dev' });
  t.after(() => { player.dispose(); env.restore(); }); player.setVolume(.4);
  const played = player.play(line, failure), spoken = await ready(env.synthesis);
  assert.equal(spoken.text, 'Glad you stayed.'); assert.equal(spoken.voice?.voiceURI, 'device-andrew'); assert.equal(spoken.volume, .4);
  spoken.onstart?.(); spoken.onboundary?.(); await delay(5); spoken.onend?.(); await played;
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0].interrupted, false); assert.ok(deliveries[0].playedSeconds > 0);
  assert.ok(playback.some(value => value.speaker === 'date')); assert.ok(playback.every(value => value.amplitude === 0), 'device synthesis exposes no waveform');
  const next = player.play({ ...line, text: 'A second line.' }, failure), second = await ready(env.synthesis, 2);
  assert.equal(second.voice?.voiceURI, 'device-andrew'); second.onstart?.(); second.onend?.(); await next; assert.equal(deliveries.length, 2);
});

test('interrupting device speech stops it, emits one interrupted receipt and ignores late callbacks', async t => {
  const env = environment(); const receipts: boolean[] = [], frames: AudioPlayback[] = [];
  const player = new SpeechPlayer({ onPlayback(value) { frames.push(value); }, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true }); t.after(() => { player.dispose(); env.restore(); });
  const playing = player.play(line, failure), spoken = await ready(env.synthesis); spoken.onstart?.();
  const lateBoundary = spoken.onboundary, lateEnd = spoken.onend;
  player.stop(); const framesAfterStop = frames.length; lateBoundary?.(); lateEnd?.(); await playing;
  assert.deepEqual(receipts, [true]); assert.equal(frames.length, framesAfterStop); assert.ok(env.synthesis.cancels > 0);
});

test('a canceled server attempt never starts device fallback later', async t => {
  const env = environment(); const receipts: boolean[] = []; let release!: (value: Response) => void;
  const source = new Promise<Response>(resolve => { release = resolve; });
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true }); t.after(() => { player.dispose(); env.restore(); });
  const playing = player.play(line, () => source); await delay(5); player.stop(); release(await failure()); await playing;
  assert.equal(env.synthesis.queued.length, 0); assert.deepEqual(receipts, [true]);
});

test('suspension while audio unlock is pending prevents a late voice request', async t => {
  const env = environment(); let release!: () => void, requests = 0;
  class DelayedAudioContext extends FakeAudioContext {
    override state = 'suspended';
    override resume() { return new Promise<void>(resolve => { release = resolve; }); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, writable: true, value: DelayedAudioContext });
  const deliveries: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { deliveries.push(result.interrupted); } }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  const playing = player.play(line, () => { requests++; return failure(); });
  player.suspend(); release(); await playing;
  assert.equal(requests, 0); assert.equal(env.synthesis.queued.length, 0); assert.deepEqual(deliveries, [true]);
  assert.equal(env.synthesis.cancels, 1, 'the silent activation utterance is released too');
});

test('ElevenLabs and other providers do not silently switch to device speech', async t => {
  const env = environment(); const receipts: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => false }); t.after(() => { player.dispose(); env.restore(); });
  await assert.rejects(player.play(line, failure), /Free server voice is down/); assert.equal(env.synthesis.queued.length, 0); assert.deepEqual(receipts, [true]);
});

test('unavailable or blocked device speech stays caption-only and never claims completed playback', async t => {
  for (const unavailable of [true, false]) {
    const env = environment(); const receipts: boolean[] = [];
    const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true });
    try {
      if (unavailable) env.synthesis.voices = [{ voiceURI: 'fr', name: 'French', lang: 'fr-FR' }] as SpeechSynthesisVoice[];
      const playing = player.play(line, failure); const rejection = assert.rejects(playing, /Captions remain available|captions remain available/);
      if (!unavailable) { const spoken = await ready(env.synthesis); spoken.onerror?.(); }
      await rejection; assert.deepEqual(receipts, [true]);
    } finally { player.dispose(); env.restore(); }
  }
});

test('one voice outage voices only that line on the device; two in a row skip the wait for thirty seconds', async t => {
  const env = environment(); let clock = 10000, calls = 0;
  t.mock.method(performance, 'now', () => clock);
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {} }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  const source = () => { calls++; return failure(); };
  const speak = async (count: number) => { const playing = player.play(line, source), voice = await ready(env.synthesis, count); voice.onstart?.(); clock += 100; voice.onend?.(); await playing; };
  await speak(1); assert.equal(calls, 1);
  clock += 5000;
  await speak(2); assert.equal(calls, 2, 'a single glitch does not stick: the next line asks the real voice again');
  clock += 5000;
  await speak(3); assert.equal(calls, 2, 'after two outages in a row the device voice is used without waiting');
  clock += 30001;
  await speak(4); assert.equal(calls, 3, 'then the free service is probed again');
});

test('a dropped connection voices that line on the device but never arms the outage skip', async t => {
  const env = environment(); let calls = 0;
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {} }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  const source = () => { calls++; return Promise.reject(new TypeError('network error')); };
  for (let count = 1; count <= 3; count++) { const playing = player.play(line, source), voice = await ready(env.synthesis, count); voice.onstart?.(); voice.onend?.(); await playing; }
  assert.equal(calls, 3);
});

test('a network interruption between two service outages breaks the consecutive outage streak', async t => {
  const env = environment(); let calls = 0;
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {} }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  const source = () => { calls++; return calls === 2 ? Promise.reject(new TypeError('network error')) : failure(); };
  for (let count = 1; count <= 4; count++) {
    const playing = player.play(line, source), voice = await ready(env.synthesis, count);
    voice.onstart?.(); voice.onend?.(); await playing;
  }
  assert.equal(calls, 4, 'the line after a separated 503 still retries the real voice');
});

test('a successful real voice between outages resets the cooldown streak', async t => {
  const env = environment(); let calls = 0;
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {} }, { canFallback: () => true, preparationTimeoutMs: 1000 });
  t.after(() => { player.dispose(); env.restore(); });
  const source = () => {
    calls++;
    return calls === 2 ? Promise.resolve(new Response('real voice', { headers: { 'content-type': 'audio/mpeg' } })) : failure();
  };
  const first = player.play(line, source), firstVoice = await ready(env.synthesis);
  firstVoice.onstart?.(); firstVoice.onend?.(); await first;
  const real = player.play(line, source), audio = FakeAudio.instances.at(-1)!;
  for (let spin = 0; spin < 50 && !audio.playCalls; spin++) await delay(2);
  assert.equal(audio.playCalls, 1); audio.finish(); await real;
  for (let count = 2; count <= 3; count++) {
    const playing = player.play(line, source), voice = await ready(env.synthesis, count);
    voice.onstart?.(); voice.onend?.(); await playing;
  }
  assert.equal(calls, 4, 'a completed real voice separates the two service outages');
});

test('server authorization and stale-generation rejections never bypass their guard through a device voice', async t => {
  const env = environment(); const receipts: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  for (const status of [400, 401, 403, 409]) {
    await assert.rejects(player.play(line, () => Promise.resolve(new Response(JSON.stringify({ error: 'That line is no longer authorized.' }), { status, headers: { 'content-type': 'application/json' } }))), error => error instanceof Error && (status !== 409 || error.name === 'AbortError'));
  }
  assert.equal(env.synthesis.queued.length, 0); assert.deepEqual(receipts, [true, true, true, true]);
});

test('a stalled server preparation uses device fallback and disposes a late audio response without playing it', async t => {
  const env = environment(), frames: AudioPlayback[] = [], receipts: boolean[] = [];
  let release!: (response: Response) => void, sourceSignal: AbortSignal | undefined, canceled = false;
  const player = new SpeechPlayer({ onPlayback(value) { frames.push(value); }, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true, dateId: () => 'dev', preparationTimeoutMs: 15 });
  t.after(() => { player.dispose(); env.restore(); });
  const played = player.play(line, signal => { sourceSignal = signal; return new Promise(resolve => { release = resolve; }); });
  const spoken = await ready(env.synthesis);
  assert.equal(sourceSignal?.aborted, true); assert.equal(spoken.voice?.voiceURI, 'device-andrew');
  assert.equal(frames.some(frame => frame.speaker), false, 'preparing a voice is not a delivery cue');
  release(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'audio/mpeg' } }));
  await delay(2); assert.equal(canceled, true); assert.equal(FakeAudio.instances.at(-1)!.playCalls, 0);
  spoken.onstart?.(); spoken.onend?.(); await played;
  assert.deepEqual(receipts, [false]);
  assert.ok(frames.find(frame => frame.speaker)?.deliveryId?.toString().startsWith('speech:'));
});

test('a stalled audio body is bounded and never claims a completed or actual delivery', async t => {
  const env = environment(), frames: AudioPlayback[] = [], receipts: boolean[] = [];
  let canceled = false;
  const player = new SpeechPlayer({ onPlayback(value) { frames.push(value); }, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => false, preparationTimeoutMs: 15 });
  t.after(() => { player.dispose(); env.restore(); });
  await assert.rejects(player.play(line, async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'audio/mpeg' } })), /too long to start/);
  assert.equal(canceled, true); assert.deepEqual(receipts, [true]); assert.equal(frames.some(frame => frame.speaker), false);
});

test('audio that starts but never ends times out without replaying the heard line through a device voice', async t => {
  const env = environment(), receipts: { interrupted: boolean; playedSeconds: number }[] = [], frames: AudioPlayback[] = [];
  const player = new SpeechPlayer({ onPlayback(value) { frames.push(value); }, onStatus() {}, onEnded(_line, result) { receipts.push(result); } }, { canFallback: () => true, preparationTimeoutMs: 100, playbackTimeoutMs: 20 });
  t.after(() => { player.dispose(); env.restore(); });
  const played = player.play(line, async () => new Response('mock audio', { headers: { 'content-type': 'audio/mpeg' } }));
  const rejection = assert.rejects(played, /did not finish/);
  await delay(5); const audio = FakeAudio.instances.at(-1)!; audio.currentTime = .25;
  await rejection;
  assert.equal(audio.paused, true); assert.equal(env.synthesis.queued.length, 0);
  assert.deepEqual(receipts, [{ interrupted: true, playedSeconds: .25 }]);
  assert.equal(frames.at(-1)?.deliveryId, null);
});

test('identical consecutive audio lines get distinct actual delivery cues and completed receipts', async t => {
  const env = environment(), ids: (string | number)[] = [], receipts: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback(value) { if (value.speaker && value.deliveryId != null) ids.push(value.deliveryId); }, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { preparationTimeoutMs: 100, playbackTimeoutMs: 100 });
  t.after(() => { player.dispose(); env.restore(); });
  for (let index = 0; index < 2; index++) {
    const played = player.play(line, async () => new Response('mock audio', { headers: { 'content-type': 'audio/mpeg' } }));
    for (let spin = 0; spin < 20 && ids.length <= index; spin++) await delay(2);
    assert.equal(ids.length, index + 1); FakeAudio.instances.at(-1)!.finish(); await played;
  }
  assert.notEqual(ids[0], ids[1]); assert.deepEqual(receipts, [false, false]);
});

test('canceling an uncooperative server request settles promptly without fallback or a later delivery cue', async t => {
  const env = environment(), frames: AudioPlayback[] = [], receipts: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback(value) { frames.push(value); }, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true, preparationTimeoutMs: 1000 });
  t.after(() => { player.dispose(); env.restore(); });
  const played = player.play(line, () => new Promise<Response>(() => {}));
  await delay(2); player.stop();
  await Promise.race([played, delay(100).then(() => { throw new Error('Canceled play did not settle.'); })]);
  assert.deepEqual(receipts, [true]); assert.equal(env.synthesis.queued.length, 0); assert.equal(frames.some(frame => frame.speaker), false);
});

test('a stalled authorization error body cannot turn its deadline into a device fallback', async t => {
  const env = environment();
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {} }, { canFallback: () => true, preparationTimeoutMs: 15 });
  t.after(() => { player.dispose(); env.restore(); });
  await assert.rejects(player.play(line, async () => new Response(new ReadableStream(), { status: 403, headers: { 'content-type': 'application/json' } })), error => error instanceof Error && (error as Error & { status?: number }).status === 403);
  assert.equal(env.synthesis.queued.length, 0);
});

test('background suspension releases the audio element and a later gesture can create a fresh voice', async t => {
  const env = environment(), receipts: boolean[] = []; let release!: (value: Response) => void;
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  const pending = player.play(line, () => new Promise<Response>(resolve => { release = resolve; }));
  await delay(5); const oldAudio = FakeAudio.instances.at(-1); player.suspend(); const newAudio = FakeAudio.instances.at(-1);
  assert.notEqual(oldAudio, newAudio); release(await failure()); await pending; assert.deepEqual(receipts, [true]);
  const resumed = player.play(line, failure), spoken = await ready(env.synthesis); spoken.onstart?.(); spoken.onend?.(); await resumed;
  assert.deepEqual(receipts, [true, false]);
});
