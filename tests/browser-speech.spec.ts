import { createServer, type Server } from 'node:http';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { expect, test } from '@playwright/test';
import type { LocalRecognition } from '../src/restaurant/LocalRecognition';
import type { SpeechPlayer } from '../src/restaurant/SpeechPlayer';
import type { ListeningPreviewController } from '../src/restaurant/ListeningPreview';

interface SpeechWindow extends Window { __speechClasses: { LocalRecognition: typeof LocalRecognition; SpeechPlayer: typeof SpeechPlayer; ListeningPreviewController: typeof ListeningPreviewController } }
let vite: ViteDevServer, server: Server, base = '';

// Isolate the speech adapters from the 3D scene. No provider credentials, model
// downloads, or real microphone permissions are used in these lifecycle tests.
test.beforeAll(async () => {
  vite = await createViteServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  server = createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (req.url === '/__speech_fixture') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><button id="activate">Enable audio</button><script type="module">import {LocalRecognition} from "/src/restaurant/LocalRecognition.ts";import {SpeechPlayer} from "/src/restaurant/SpeechPlayer.ts";import {ListeningPreviewController} from "/src/restaurant/ListeningPreview.ts";window.__speechClasses={LocalRecognition,SpeechPlayer,ListeningPreviewController};</script>');
      return;
    }
    vite.middlewares(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/__speech_fixture`;
});

test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  await vite?.close();
});

test('canceling recognition prevents a late load from opening the mic and releases a late permission stream', async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as SpeechWindow).__speechClasses);
  await page.locator('#activate').click();
  const result = await page.evaluate(async () => {
    const { LocalRecognition } = (window as unknown as SpeechWindow).__speechClasses;
    const errors: string[] = [];
    const workers: { onmessage: ((event: MessageEvent) => void) | null; ready(): void }[] = [];
    let autoReady = false, mediaCalls = 0, release: (() => void) | undefined;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      constructor() { workers.push(this); }
      ready() { this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } })); }
      postMessage(message: { type: string }) { if (message.type === 'load' && autoReady) queueMicrotask(() => this.ready()); }
      terminate() {}
    }
    window.Worker = FakeWorker as unknown as typeof Worker;
    const fixtureContext = new AudioContext();
    const stream = fixtureContext.createMediaStreamDestination().stream;
    navigator.mediaDevices.getUserMedia = async () => {
      mediaCalls++;
      await new Promise<void>(resolve => { release = resolve; });
      return stream;
    };
    const until = async (condition: () => boolean) => {
      for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
      throw new Error('Recognition did not reach the expected lifecycle stage.');
    };
    const callbacks = { onPartial() {}, onTurn() {}, onSpeechStart() {}, onStatus() {}, onError(message: string) { errors.push(message); } };
    const loading = new LocalRecognition(callbacks);
    const first = loading.start().catch(error => (error as Error).name);
    await until(() => workers.length === 1);
    loading.stop(); workers[0].ready();
    const canceledLoad = await first;
    const callsAfterLoadCancel = mediaCalls;
    loading.dispose();
    autoReady = true;
    const permission = new LocalRecognition(callbacks);
    const second = permission.start().catch(error => (error as Error).name);
    await until(() => !!release);
    permission.dispose(); release!();
    const canceledPermission = await second;
    const trackStates = stream.getTracks().map(track => track.readyState);
    await fixtureContext.close();
    return { canceledLoad, callsAfterLoadCancel, canceledPermission, trackStates, errors };
  });
  expect(result.canceledLoad).toBe('AbortError');
  expect(result.callsAfterLoadCancel).toBe(0);
  expect(result.canceledPermission).toBe('AbortError');
  expect(result.trackStates).toEqual(['ended']);
  expect(result.errors).toEqual([]);
});

test('real audio drives mouth amplitude, while stop aborts pending synthesis and clears captions', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as SpeechWindow).__speechClasses);
  await page.locator('#activate').click();
  const result = await page.evaluate(async () => {
    const { SpeechPlayer } = (window as unknown as SpeechWindow).__speechClasses;
    let maximum = 0, caption = '', fetchStarted = false, aborted = false;
    const metrics: { firstAudioMs?: number; cacheHit?: boolean } = {};
    const player = new SpeechPlayer({ onPlayback(next) { maximum = Math.max(maximum, next.amplitude); caption = next.caption; }, onStatus() {}, onMetrics(next) { Object.assign(metrics, next); } });
    await player.unlock();
    const pending = player.play({ speaker: 'date', text: 'Never delivered.', emotion: 'neutral' }, signal => {
      fetchStarted = true;
      return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Canceled', 'AbortError')); }, { once: true }));
    });
    while (!fetchStarted) await new Promise(resolve => setTimeout(resolve, 5));
    player.stop(); await pending;
    const captionAfterAbort = caption;
    // A non-silent PCM test fixture, never used by the game itself.
    const sampleRate = 16000, samples = 8000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
    const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    label(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / sampleRate * 2 * Math.PI * 220) * 10000, true);
    await player.play({ speaker: 'date', text: 'A delivered line.', emotion: 'warm' }, async () => new Response(bytes, { headers: { 'content-type': 'audio/wav', 'x-speech-cache': 'hit' } }));
    player.dispose();
    return { maximum, caption, captionAfterAbort, aborted, metrics };
  });
  expect(result.aborted).toBe(true);
  expect(result.captionAfterAbort).toBe('');
  expect(result.maximum).toBeGreaterThan(0);
  expect(result.caption).toBe('');
  expect(result.metrics.cacheHit).toBe(true);
  expect(result.metrics.firstAudioMs).toBeGreaterThanOrEqual(0);
  expect(pageErrors).toEqual([]);
});

// Added with the adaptive-endpointing work; written without a browser available, so not yet run.
test('an unfinished sentence waits for its ending, finished ones do not, and hesitation sounds never become a turn', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as SpeechWindow).__speechClasses);
  await page.locator('#activate').click();
  const result = await page.evaluate(async () => {
    const { LocalRecognition } = (window as unknown as SpeechWindow).__speechClasses;
    let worker: FakeWorker | undefined;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      epoch = 0;
      constructor() { worker = this; }
      postMessage(message: { type: string; epoch?: number }) {
        if (message.type === 'load') queueMicrotask(() => this.emit('ready'));
        if (message.type === 'reset') this.epoch = message.epoch ?? this.epoch;
        if (message.type === 'audio') queueMicrotask(() => this.emit('ack'));
      }
      emit(type: string, id?: string, text?: string) {
        this.onmessage?.(new MessageEvent('message', { data: { type, text, id, epoch: this.epoch } }));
      }
      terminate() { this.onmessage = null; }
    }
    window.Worker = FakeWorker as unknown as typeof Worker;
    const fixtureAudio = new AudioContext(), media = fixtureAudio.createMediaStreamDestination().stream;
    navigator.mediaDevices.getUserMedia = async () => media;
    const turns: string[] = [], failures: string[] = [];
    const recognition = new LocalRecognition({ onSpeechStart() {}, onPartial() {}, onTurn(text) { turns.push(text); }, onStatus() {}, onError(message) { failures.push(message); } });
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (condition: () => boolean, ms = 3000) => { for (let waited = 0; waited < ms && !condition(); waited += 5) await wait(5); };
    try {
      await recognition.start();
      const idleHolds = recognition.holdsHumanSpeech();

      // A finished-looking sentence still commits on the original short pause.
      worker!.emit('speech', 'a', ''); worker!.emit('partial', 'a', 'I really love sushi.');
      const holdingWhileSpeaking = recognition.holdsHumanSpeech();
      worker!.emit('line', 'a', 'I really love sushi.');
      await wait(800);
      const finishedAfter800 = [...turns];
      await until(() => !recognition.holdsHumanSpeech(), 500);

      // A thinking pause after "was" is not the end of the turn: the player carries on in a new segment.
      worker!.emit('speech', 'b', ''); worker!.emit('partial', 'b', 'My graduating class was'); worker!.emit('line', 'b', 'My graduating class was');
      await wait(1000);
      const fragmentAfter1000 = [...turns];
      worker!.emit('speech', 'c', ''); worker!.emit('partial', 'c', 'less than seventy people.'); worker!.emit('line', 'c', 'less than seventy people.');
      await until(() => turns.length === 2, 2500);
      const continued = [...turns];

      // A fragment the player abandons is still sent once the longer wait has passed.
      worker!.emit('speech', 'd', ''); worker!.emit('partial', 'd', 'I was going to say that'); worker!.emit('line', 'd', 'I was going to say that,');
      await wait(1000);
      const abandonedAfter1000 = turns.length;
      await until(() => turns.length === 3, 2500);

      // Hesitation sounds alone are never a turn.
      const beforeFiller = turns.length;
      for (const [index, text] of ['Um.', 'uh', 'Hmm...', 'er, um'].entries()) {
        worker!.emit('speech', `f${index}`, ''); worker!.emit('partial', `f${index}`, text); worker!.emit('line', `f${index}`, text);
        await until(() => !recognition.holdsHumanSpeech(), 2500);
      }
      return { idleHolds, holdingWhileSpeaking, finishedAfter800, fragmentAfter1000, continued, abandonedAfter1000, turns, beforeFiller, holdsAfterFiller: recognition.holdsHumanSpeech(), failures };
    } finally {
      recognition.dispose(); await fixtureAudio.close();
    }
  });
  expect(result.idleHolds).toBe(false);
  expect(result.holdingWhileSpeaking).toBe(true);
  expect(result.finishedAfter800).toEqual(['I really love sushi.']);
  expect(result.fragmentAfter1000).toEqual(['I really love sushi.']);
  expect(result.continued).toEqual(['I really love sushi.', 'My graduating class was less than seventy people.']);
  expect(result.abandonedAfter1000).toBe(2);
  expect(result.turns).toEqual(['I really love sushi.', 'My graduating class was less than seventy people.', 'I was going to say that,']);
  expect(result.turns).toHaveLength(result.beforeFiller);
  expect(result.holdsAfterFiller).toBe(false);
  expect(result.failures).toEqual([]);
  expect(requests.some(url => /api\.anthropic\.com|\/api\/date\/.*\/turn|elevenlabs/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});

test('revised recognition partials remain local until one completed player turn', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(base);
  await page.waitForFunction(() => (window as unknown as SpeechWindow).__speechClasses);
  await page.locator('#activate').click();
  const result = await page.evaluate(async () => {
    const { LocalRecognition, ListeningPreviewController } = (window as unknown as SpeechWindow).__speechClasses;
    let worker: FakeWorker | undefined;
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror = null;
      epoch = 0;
      constructor() { worker = this; }
      postMessage(message: { type: string; epoch?: number }) {
        if (message.type === 'load') queueMicrotask(() => this.emit('ready'));
        if (message.type === 'reset') this.epoch = message.epoch ?? this.epoch;
        if (message.type === 'audio') queueMicrotask(() => this.emit('ack'));
      }
      emit(type: string, text?: string, epoch = this.epoch) {
        this.onmessage?.(new MessageEvent('message', { data: { type, text, id: 'one-line', epoch } }));
      }
      terminate() { this.onmessage = null; }
    }
    window.Worker = FakeWorker as unknown as typeof Worker;
    const fixtureAudio = new AudioContext(), media = fixtureAudio.createMediaStreamDestination().stream;
    navigator.mediaDevices.getUserMedia = async () => media;
    const preview = new ListeningPreviewController(), turns: string[] = [], failures: string[] = [];
    let speechStarts = 0;
    const recognition = new LocalRecognition({
      onSpeechStart() { speechStarts++; preview.start(performance.now(), 'date'); },
      onPartial(text) { if (text) preview.partial(text, performance.now()); else preview.clear(); },
      onTurn(text) { preview.clear(); turns.push(text); },
      onStatus() {}, onError(message) { failures.push(message); preview.clear(); },
    });
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await recognition.start();
      worker!.emit('partial', 'I am nervous');
      await wait(210);
      const tentative = preview.sample(performance.now());
      worker!.emit('partial', 'I am not nervous, I just forgot the word');
      const revised = preview.sample(performance.now()), completedBeforeFinal = turns.length;
      const completedEpoch = worker!.epoch;
      worker!.emit('line', 'I am not nervous, I just forgot the word.');
      for (let attempt = 0; attempt < 200 && turns.length === 0; attempt++) await wait(5);
      const afterFinal = preview.sample(performance.now());
      worker!.emit('line', 'The abandoned fragment must not return.', completedEpoch);
      await wait(610);
      const afterLateFinal = turns.length;
      worker!.emit('partial', 'You are stupid');
      recognition.setPaused(true);
      await wait(380);
      return { tentative, revised, completedBeforeFinal, turns, afterFinal, afterLateFinal, afterPause: preview.sample(performance.now()), speechStarts, failures };
    } finally {
      recognition.dispose(); await fixtureAudio.close();
    }
  });
  expect(result.tentative?.cue).toBe('reassuring');
  expect(result.revised?.cue).toBe('attentive');
  expect(result.completedBeforeFinal).toBe(0);
  expect(result.turns).toEqual(['I am not nervous, I just forgot the word.']);
  expect(result.afterLateFinal).toBe(1);
  expect(result.afterFinal).toBeNull(); expect(result.afterPause).toBeNull();
  expect(result.speechStarts).toBe(2);
  expect(result.failures).toEqual([]);
  expect(requests.some(url => /api\.anthropic\.com|\/api\/date\/.*\/turn|elevenlabs/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
