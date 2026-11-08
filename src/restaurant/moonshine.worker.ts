import moduleUrl from '@moonshine-ai/moonshine-wasm/moonshine.mjs?url';
import wasmUrl from '@moonshine-ai/moonshine-wasm/moonshine.wasm?url';
import type { MoonshineModule } from '@moonshine-ai/moonshine-wasm';

// Keep the generated Emscripten module as an asset: bundling it rewrites the
// URL used by its pthread workers. Only PCM and transcript messages cross here.
type NativeStream = InstanceType<MoonshineModule['Stream']>;
type NativeTranscriber = InstanceType<MoonshineModule['Transcriber']>;
type Message = { type: 'load' } | { type: 'reset'; epoch: number }
  | { type: 'audio'; epoch: number; sampleRate: number; audio: ArrayBuffer };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage(message: unknown): void };
let engine: MoonshineModule;
let transcriber: NativeTranscriber;
let stream: NativeStream;
let epoch = 0;
let pendingSeconds = 0;
let lastPassSeconds = 0;
let started = new Set<string>();
let completed = new Set<string>();
let texts = new Map<string, string>();

async function cachedFile(url: string, expectedSize: number | undefined, progress: (bytes: number) => void): Promise<Uint8Array> {
  let cache: Cache | undefined;
  try { cache = await caches.open('restaurant-moonshine-models-v1'); } catch { /* Storage may be disabled. */ }
  const cached = await cache?.match(url);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    if (expectedSize === undefined || bytes.length === expectedSize) {
      progress(bytes.byteLength);
      return bytes;
    }
    await cache?.delete(url);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local speech model download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      length += next.value.length;
      progress(length);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes); length = bytes.length; progress(length);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (expectedSize !== undefined && bytes.length !== expectedSize) throw new Error('The local speech model download was incomplete. Please retry.');
  try { await cache?.put(url, new Response(bytes)); } catch { /* Recognition still works without persistent caching. */ }
  return bytes;
}

function reset(nextEpoch: number): void {
  stream?.close();
  epoch = nextEpoch;
  started = new Set(); completed = new Set(); texts = new Map();
  pendingSeconds = 0; lastPassSeconds = 0;
  stream = new engine.Stream(transcriber, 0);
  stream.start();
}

// Embind can return either normal arrays or native vectors; release the latter.
function vector<T>(value: T[] | { size(): number; get(index: number): T; delete?(): void } | undefined): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const result = Array.from({ length: value.size() }, (_, i) => value.get(i));
  value.delete?.();
  return result;
}

function transcribe(): void {
  const now = performance.now();
  const transcript = stream.transcribe(0);
  lastPassSeconds = (performance.now() - now) / 1000;
  pendingSeconds = 0;
  for (const line of vector<{ id: string; text?: string; isComplete?: boolean; words?: never; speakerSpans?: never }>(transcript?.lines)) {
    const id = String(line.id);
    const text = (line.text ?? '').trim();
    const first = !started.has(id);
    if (first) { started.add(id); scope.postMessage({ type: 'speech', epoch, text }); }
    if (texts.get(id) !== text || first) {
      texts.set(id, text);
      scope.postMessage({ type: 'partial', epoch, id, text });
    }
    if (line.isComplete && !completed.has(id)) {
      completed.add(id);
      scope.postMessage({ type: 'line', epoch, id, text });
    }
    vector(line.words); vector(line.speakerSpans);
  }
}

async function load(): Promise<void> {
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('Local speech needs cross-origin isolation (COOP/COEP headers).');
  const factory = (await import(/* @vite-ignore */ moduleUrl)).default;
  engine = await factory({
    // Vite hashes this filename; pthread workers must use the emitted asset URL.
    mainScriptUrlOrBlob: moduleUrl,
    locateFile: (path: string) => path.endsWith('.wasm') ? wasmUrl : moduleUrl,
    // ORT cannot identify browser CPU vendors; this harmless warning is also
    // suppressed by Moonshine's standard module loader.
    printErr: (...args: unknown[]) => {
      if (typeof args[0] === 'string' && /Unknown CPU vendor\. cpuinfo_vendor value:/.test(args[0])) return;
      console.error(...args);
    },
  });
  // Tiny streaming is deliberately chosen to leave CPU capacity for the scene.
  const architecture = 2;
  const manifest = JSON.parse(engine.sttDependencies('en', String(architecture), false)) as {
    groups: { base_url: string; files: { name: string; url?: string; size?: number }[] }[];
  };
  const files = manifest.groups.flatMap(group => group.files.map(file => ({ ...file, url: file.url ?? `${group.base_url.replace(/\/$/, '')}/${file.name}` })));
  const total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const buffers: Uint8Array[] = [];
  let finishedBytes = 0;
  let lastProgress = -1;
  for (const file of files) {
    const bytes = await cachedFile(file.url, file.size, count => {
      const loaded = finishedBytes + count;
      const progress = total ? Math.floor(loaded / total * 100) : Math.floor(loaded / 1048576);
      if (progress !== lastProgress) { lastProgress = progress; scope.postMessage({ type: 'progress', loaded, total }); }
    });
    if (file.size !== undefined && bytes.length !== file.size) throw new Error(`Incomplete local speech model: ${file.name}.`);
    buffers.push(bytes); finishedBytes += bytes.length;
  }
  transcriber = new engine.Transcriber(files.map(file => file.name), buffers, architecture, [], []);
  reset(0);
  scope.postMessage({ type: 'ready' });
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === 'load') { void load().catch(error => scope.postMessage({ type: 'error', message: String(error instanceof Error ? error.message : error) })); return; }
  try {
    if (message.type === 'reset') { reset(message.epoch); return; }
    if (message.epoch !== epoch) return;
    const audio = new Float32Array(message.audio);
    stream.addAudio(audio, message.sampleRate, 0);
    pendingSeconds += audio.length / message.sampleRate;
    if (pendingSeconds >= Math.min(Math.max(0.4, lastPassSeconds), 2)) transcribe();
    scope.postMessage({ type: 'ack', epoch });
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error instanceof Error ? error.message : error) });
  }
};
