import { commitDelay, isFillerOnly } from './turn-endpointing';

interface RecognitionCallbacks {
  onPartial(text: string): void;
  onTurn(text: string): void;
  onSpeechStart(): void;
  /** True for words that are only the human listening (“mm-hm”) while a line plays: they must not cut the date off. */
  isListeningOnly?(text: string): boolean;
  onStatus(status: string): void;
  onError(message: string): void;
}
interface CaptureOptions { capture(): Promise<MediaStream>; release(stream: MediaStream): void }
type WorkerMessage = { type: string; epoch?: number; id?: string; text?: string; message?: string; loaded?: number; total?: number };

/** On-device English recognition. Audio never goes to a transcription service. */
export class LocalRecognition {
  private worker?: Worker;
  private context?: AudioContext;
  private media?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private processor?: AudioWorkletNode | ScriptProcessorNode;
  private mutedOutput?: GainNode;
  private lifecycle = 0;
  private epoch = 0;
  private active = false;
  private paused = false;
  private speaking = false;
  private spokenText = '';
  private echoUntil = 0;
  private speechNotified = false;
  private lines = new Map<string, string>();
  private completed = new Set<string>();
  private commitTimer?: ReturnType<typeof setTimeout>;
  private readyReject?: (error: Error) => void;
  private pendingAudio: Float32Array[] = [];
  private pendingSamples = 0;
  private audioInFlight = false;
  private workerReady = false;
  private starting?: Promise<void>;
  private disposed = false;

  constructor(private readonly callbacks: RecognitionCallbacks, private readonly captureOptions?: CaptureOptions) {}

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Microphone recognition has been disposed.'));
    if (this.starting) return this.starting;
    if (this.active) return Promise.resolve();
    this.active = true;
    const lifecycle = ++this.lifecycle;
    const run = this.initialize(lifecycle);
    this.starting = run;
    void run.finally(() => { if (this.starting === run) this.starting = undefined; }).catch(() => {});
    return run;
  }

  private async initialize(lifecycle: number): Promise<void> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS.');
      if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') throw new Error('Local speech is unavailable: this page needs COOP/COEP isolation headers. You can still type.');
      // Resume in the originating click, before model loading loses activation.
      const context = new AudioContext({ sampleRate: 16000 });
      this.context = context;
      await context.resume();
      this.checkLifecycle(lifecycle);
      this.callbacks.onStatus('Loading local English speech model…');
      const worker = new Worker(new URL('./moonshine.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        this.readyReject = reject;
        worker.onmessage = event => {
          if (lifecycle !== this.lifecycle) return;
          const message = event.data as WorkerMessage;
          if (message.type === 'ready') {
            this.workerReady = true;
            if (this.epoch) worker.postMessage({ type: 'reset', epoch: this.epoch });
            this.readyReject = undefined; resolve();
          }
          else if (message.type === 'error') {
            const error = new Error(message.message ?? 'The local speech worker failed.');
            if (this.readyReject) { this.readyReject = undefined; reject(error); }
            else { this.stop(); this.callbacks.onError(error.message); }
          } else this.receive(message);
        };
        worker.onerror = event => {
          const error = new Error(event.message || 'Unable to load local speech recognition.');
          if (this.readyReject) { this.readyReject = undefined; reject(error); }
          else { this.stop(); this.callbacks.onError(error.message); }
        };
        worker.postMessage({ type: 'load' });
      });
      this.checkLifecycle(lifecycle);
      const media = this.captureOptions ? await this.captureOptions.capture() : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1, sampleRate: 16000 }, video: false });
      if (lifecycle !== this.lifecycle) { this.releaseCapture(media); throw new DOMException('Microphone start canceled.', 'AbortError'); }
      this.media = media;
      media.getAudioTracks().forEach(track => { track.enabled = !this.paused; });
      this.source = context.createMediaStreamSource(media);
      this.mutedOutput = context.createGain();
      this.mutedOutput.gain.value = 0;
      this.mutedOutput.connect(context.destination);
      const send = (audio: Float32Array) => this.capture(audio, context.sampleRate);
      if (context.audioWorklet) {
        const workletSource = `class Capture extends AudioWorkletProcessor { constructor(){ super(); this.chunks=[]; this.size=0; } process(inputs){ const input=inputs[0]?.[0]; if(input){ this.chunks.push(input.slice()); this.size+=input.length; if(this.size>=1280){ const pcm=new Float32Array(this.size); let p=0; for(const chunk of this.chunks){pcm.set(chunk,p);p+=chunk.length;} this.port.postMessage(pcm,[pcm.buffer]); this.chunks=[];this.size=0; } } return true; } } registerProcessor('restaurant-mic',Capture);`;
        const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
        try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        this.checkLifecycle(lifecycle);
        const processor = new AudioWorkletNode(context, 'restaurant-mic');
        processor.port.onmessage = event => send(event.data as Float32Array);
        this.processor = processor;
      } else {
        const processor = context.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = event => send(event.inputBuffer.getChannelData(0).slice());
        this.processor = processor;
      }
      this.source.connect(this.processor);
      this.processor.connect(this.mutedOutput);
      this.callbacks.onStatus(this.paused ? 'Microphone paused' : 'Listening locally');
    } catch (error) {
      if (lifecycle === this.lifecycle) {
        this.stop();
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          const detail = error instanceof Error ? error.message : String(error);
          const failure = new Error(detail.includes('You can still type') ? detail : `Local speech could not start: ${detail} You can still type.`);
          this.callbacks.onError(failure.message);
          throw failure;
        }
      }
      throw error;
    }
  }

  private checkLifecycle(lifecycle: number): void {
    if (lifecycle !== this.lifecycle || !this.active) throw new DOMException('Microphone start canceled.', 'AbortError');
  }

  private capture(audio: Float32Array, sampleRate: number): void {
    if (!this.active || this.paused || !this.worker) return;
    // Bounded backpressure: stop rather than silently lose words on slow devices.
    if (this.pendingSamples + audio.length > sampleRate * 4) {
      this.stop(); this.callbacks.onError('Local recognition cannot keep up on this device. Please use typed dialogue.'); return;
    }
    this.pendingAudio.push(audio); this.pendingSamples += audio.length;
    this.sendAudio(sampleRate);
  }

  private sendAudio(sampleRate = this.context?.sampleRate ?? 16000): void {
    if (this.audioInFlight || !this.pendingSamples || !this.worker) return;
    const audio = new Float32Array(this.pendingSamples);
    let offset = 0;
    for (const chunk of this.pendingAudio) { audio.set(chunk, offset); offset += chunk.length; }
    this.pendingAudio = []; this.pendingSamples = 0; this.audioInFlight = true;
    this.worker.postMessage({ type: 'audio', epoch: this.epoch, sampleRate, audio: audio.buffer }, [audio.buffer]);
  }

  private receive(message: WorkerMessage): void {
    if (message.type === 'progress') {
      const mb = ((message.loaded ?? 0) / 1048576).toFixed(1);
      const amount = message.total ? `${Math.min(100, Math.round((message.loaded ?? 0) / message.total * 100))}% · ${mb} MB` : `${mb} MB`;
      this.callbacks.onStatus(`Loading local speech · ${amount}`); return;
    }
    if (message.epoch !== this.epoch || this.paused) return;
    if (message.type === 'ack') { this.audioInFlight = false; this.sendAudio(); return; }
    const text = message.text ?? '';
    if (message.type === 'speech') {
      clearTimeout(this.commitTimer);
      this.notifySpeech(text);
    }
    if (message.type === 'partial' || message.type === 'line') {
      if (!message.id) return;
      this.lines.set(message.id, text);
      this.notifySpeech(text);
      this.callbacks.onPartial([...this.lines.values()].join(' ').trim());
      if (message.type === 'line') {
        this.completed.add(message.id);
        this.scheduleCommit();
      }
    }
  }

  private isEcho(text: string): boolean {
    const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const candidate = clean(text);
    // A short human answer such as "no" must not match inside "know", or be
    // discarded just because the date used that word. AEC handles those cases;
    // this extra guard only removes substantial matching playback phrases.
    return (this.speaking || performance.now() < this.echoUntil) && candidate.split(' ').length >= 3
      && ` ${clean(this.spokenText)} `.includes(` ${candidate} `);
  }

  private notifySpeech(text: string): void {
    if (this.speechNotified || this.isEcho(text)) return;
    if ((this.speaking || performance.now() < this.echoUntil) && text.trim().split(/\s+/).filter(Boolean).length < 2) return;
    // “uh huh” is two words, so the length rule lets it through; it is dropped at the end of the turn, and should not have stopped the date first.
    if (this.callbacks.isListeningOnly?.(text)) return;
    this.speechNotified = true;
    this.callbacks.onSpeechStart();
  }

  private joinedText(): string {
    return [...this.lines.values()].join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * True while the recognizer holds an unfinished human turn: a segment has started or closed but
   * nothing has been committed yet. The date's own voice coming back through the mic does not count.
   */
  holdsHumanSpeech(): boolean {
    if (!this.active || this.paused || this.lines.size === 0) return false;
    const text = this.joinedText();
    return !text || !this.isEcho(text);
  }

  private scheduleCommit(): void {
    clearTimeout(this.commitTimer);
    // Only complete VAD segments are committed; interim updates are display-only. Text that reads as
    // finished commits after 550 ms as always; an obvious fragment waits longer for the rest of the
    // sentence (a new speech segment cancels the wait). Hesitation sounds alone are never a turn.
    this.commitTimer = setTimeout(() => {
      if (!this.active || this.paused || [...this.lines.keys()].some(id => !this.completed.has(id))) return;
      const text = this.joinedText();
      const echo = this.isEcho(text);
      this.resetTurn();
      if (text && !echo && !isFillerOnly(text)) this.callbacks.onTurn(text);
    }, commitDelay(this.joinedText()));
  }

  private resetTurn(): void {
    clearTimeout(this.commitTimer);
    this.lines.clear(); this.completed.clear(); this.speechNotified = false;
    this.pendingAudio = []; this.pendingSamples = 0; this.audioInFlight = false;
    this.epoch++;
    if (this.worker && this.workerReady) this.worker.postMessage({ type: 'reset', epoch: this.epoch });
    this.callbacks.onPartial('');
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.media?.getAudioTracks().forEach(track => { track.enabled = !paused; });
    this.resetTurn();
    if (this.active) this.callbacks.onStatus(paused ? 'Microphone paused' : 'Listening locally');
  }

  /** Keep recognition active while speech plays; AEC enables human barge-in. */
  setSpeaking(speaking: boolean, caption = ''): void {
    if (speaking) this.spokenText = caption;
    else if (this.speaking) this.echoUntil = performance.now() + 2000;
    this.speaking = speaking;
  }

  stop(): void {
    this.lifecycle++; this.active = false; this.starting = undefined;
    this.readyReject?.(new DOMException('Microphone start canceled.', 'AbortError'));
    this.readyReject = undefined;
    clearTimeout(this.commitTimer);
    this.worker?.terminate(); this.worker = undefined; this.workerReady = false;
    this.processor?.disconnect(); this.source?.disconnect(); this.mutedOutput?.disconnect();
    if (typeof AudioWorkletNode !== 'undefined' && this.processor instanceof AudioWorkletNode) { this.processor.port.onmessage = null; this.processor.port.close(); }
    this.processor = undefined; this.source = undefined; this.mutedOutput = undefined;
    if (this.media) this.releaseCapture(this.media); this.media = undefined;
    void this.context?.close().catch(() => {}); this.context = undefined;
    this.lines.clear(); this.completed.clear(); this.pendingAudio = []; this.pendingSamples = 0;
    this.audioInFlight = false; this.speechNotified = false; this.epoch = 0;
    this.speaking = false; this.spokenText = ''; this.echoUntil = 0;
    this.callbacks.onPartial('');
  }

  private releaseCapture(stream: MediaStream) {
    if (this.captureOptions) this.captureOptions.release(stream);
    else stream.getTracks().forEach(track => track.stop());
  }

  dispose(): void { this.disposed = true; this.stop(); }
}
