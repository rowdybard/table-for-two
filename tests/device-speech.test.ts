import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SpeechPlayer } from '../src/restaurant/SpeechPlayer';
import type { AudioPlayback, SceneUtterance } from '../src/restaurant/types';

const line: SceneUtterance = { speaker: 'date', dateId: 'dev', text: '[warmly] Glad you stayed.', emotion: 'warm' };
class FakeAudio extends EventTarget { preload = ''; volume = 1; currentTime = 0; pause() {} load() {} removeAttribute() {} }
class FakeAudioContext { state = 'running'; createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {} }; } createMediaElementSource() { return { connect() {}, disconnect() {} }; } async close() {} async resume() {} }
class FakeUtterance { voice?: SpeechSynthesisVoice; lang = ''; volume = 1; rate = 1; pitch = 1; onstart?: (() => void) | null; onboundary?: (() => void) | null; onend?: (() => void) | null; onerror?: (() => void) | null; constructor(public text: string) {} }
const voices = [ { voiceURI: 'device-ava', name: 'Ava', lang: 'en-US' }, { voiceURI: 'device-sonia', name: 'Sonia', lang: 'en-GB' }, { voiceURI: 'device-andrew', name: 'Andrew', lang: 'en-US' } ] as SpeechSynthesisVoice[];
class FakeSynthesis extends EventTarget { queued: FakeUtterance[] = []; cancels = 0; voices = voices; getVoices() { return this.voices; } speak(value: FakeUtterance) { if (value.text) this.queued.push(value); } cancel() { this.cancels++; } }
function environment() {
  const synthesis = new FakeSynthesis();
  const supplied: Record<string, unknown> = { Audio: FakeAudio, AudioContext: FakeAudioContext, SpeechSynthesisUtterance: FakeUtterance, speechSynthesis: synthesis, cancelAnimationFrame() {} };
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

test('server authorization and stale-generation rejections never bypass their guard through a device voice', async t => {
  const env = environment(); const receipts: boolean[] = [];
  const player = new SpeechPlayer({ onPlayback() {}, onStatus() {}, onEnded(_line, result) { receipts.push(result.interrupted); } }, { canFallback: () => true });
  t.after(() => { player.dispose(); env.restore(); });
  for (const status of [400, 401, 403, 409]) {
    await assert.rejects(player.play(line, () => Promise.resolve(new Response(JSON.stringify({ error: 'That line is no longer authorized.' }), { status, headers: { 'content-type': 'application/json' } }))), error => error instanceof Error && (status !== 409 || error.name === 'AbortError'));
  }
  assert.equal(env.synthesis.queued.length, 0); assert.deepEqual(receipts, [true, true, true, true]);
});
