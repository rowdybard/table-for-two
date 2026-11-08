import type { AudioPlayback, DateId, SceneUtterance } from './types';

interface SpeechPlayerCallbacks {
  onPlayback(playback: AudioPlayback): void;
  onStatus(message: string): void;
  onMetrics?(metrics: { firstAudioMs?: number; cacheHit?: boolean }): void;
  onEnded?(utterance: SceneUtterance, result: { interrupted: boolean; playedSeconds: number }): void;
}
export interface SpeechPlayerOptions { canFallback?(): boolean; dateId?(): DateId }

function aborted(): DOMException { return new DOMException('Speech playback canceled.', 'AbortError'); }

/** Plays real provider audio. The caller awaits each play() to order speakers. */
export class SpeechPlayer {
  private readonly audio = new Audio();
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private elementSource?: MediaElementAudioSourceNode;
  private samples?: Float32Array<ArrayBuffer>;
  private controller?: AbortController;
  private objectUrl?: string;
  private generation = 0;
  private animation = 0;
  private disposed = false;
  private current?: SceneUtterance;
  private volume = 1;
  private deviceUtterance?: SpeechSynthesisUtterance;
  private deviceStarted?: number;
  private devicePrimed = false;
  private deviceFallbackUntil = 0;
  private readonly deviceVoices = new Map<string, string>();

  constructor(private readonly callbacks: SpeechPlayerCallbacks, private readonly options: SpeechPlayerOptions = {}) {
    this.audio.preload = 'auto';
  }

  setVolume(value: number): void { this.volume = this.audio.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; if (this.deviceUtterance) this.deviceUtterance.volume = this.volume; }

  /** Call directly from the Start/Resume click to satisfy browser activation. */
  async unlock(): Promise<void> {
    if (this.disposed) throw new Error('Speech playback has been disposed.');
    if (!this.devicePrimed && this.options.canFallback?.() && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
      // Some mobile browsers require the first synthesis call inside a real
      // Start/Resume gesture. An empty, silent utterance never creates a receipt.
      try { const prime = new SpeechSynthesisUtterance(''); prime.volume = 0; prime.onerror = () => { this.devicePrimed = false; }; speechSynthesis.speak(prime); this.devicePrimed = true; } catch { /* Actual fallback reports device availability. */ }
    }
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.elementSource = this.context.createMediaElementSource(this.audio);
      this.elementSource.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async play(utterance: SceneUtterance, source: (signal: AbortSignal) => Promise<Response>): Promise<void> {
    if (this.disposed) return;
    this.stop();
    const generation = this.generation;
    const controller = new AbortController();
    const signal = controller.signal;
    this.controller = controller;
    this.current = utterance;
    let heard = false;
    let completed = false;
    let deviceAttempted = false;
    const requestedAt = performance.now();
    const onPlaying = () => {
      if (signal.aborted || generation !== this.generation) return;
      if (!heard) {
        heard = true;
        this.callbacks.onMetrics?.({ firstAudioMs: Math.round(performance.now() - requestedAt) });
        this.callbacks.onStatus('');
      }
      this.animate(utterance, generation);
    };
    this.audio.addEventListener('playing', onPlaying);
    let cleanupFinished = () => {};
    try {
      await this.unlock();
      signal.throwIfAborted();
      if (this.options.canFallback?.() && performance.now() < this.deviceFallbackUntil) {
        deviceAttempted = true;
        await this.playDevice(utterance, signal, generation, requestedAt);
        signal.throwIfAborted();
        completed = true;
        return;
      }
      this.callbacks.onStatus('Preparing voice…');
      const response = await source(signal);
      signal.throwIfAborted();
      if (!response.ok) {
        let message = `Voice generation failed (${response.status}).`;
        try {
          const error = await response.json() as { message?: string; error?: string };
          message = error.message ?? error.error ?? message;
        } catch { /* Preserve the HTTP error. */ }
        const failure = Object.assign(new Error(message), { status: response.status });
        // A stale/paused generation has lost permission to speak, including
        // through the device engine. Treat it like ordinary cancellation.
        if (response.status === 409) failure.name = 'AbortError';
        throw failure;
      }
      const cache = response.headers.get('x-speech-cache') ?? response.headers.get('x-audio-cache') ?? response.headers.get('x-cache');
      if (cache) this.callbacks.onMetrics?.({ cacheHit: /^(hit|true|cached)$/i.test(cache) });
      const mime = response.headers.get('content-type')?.trim() ?? 'audio/mpeg';
      if (!mime.startsWith('audio/')) throw new Error('Voice service returned no playable audio.');
      const finished = new Promise<void>((resolve, reject) => {
        const onEnded = () => resolve();
        const onError = () => reject(new Error(this.audio.error?.message || 'The generated voice could not be played.'));
        const onAbort = () => reject(aborted());
        this.audio.addEventListener('ended', onEnded, { once: true });
        this.audio.addEventListener('error', onError, { once: true });
        signal.addEventListener('abort', onAbort, { once: true });
        cleanupFinished = () => {
          this.audio.removeEventListener('ended', onEnded);
          this.audio.removeEventListener('error', onError);
          signal.removeEventListener('abort', onAbort);
        };
      });
      const streaming = response.body && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime);
      await Promise.all([finished, streaming ? this.stream(response, mime, signal) : this.blob(response, signal)]);
      completed = true;
    } catch (error) {
      if (!signal.aborted && generation === this.generation) {
        const status = (error as { status?: number }).status;
        const unavailable = (error as Error).name !== 'AbortError' && (status === undefined || status === 429 || status >= 500);
        if (!heard && !deviceAttempted && unavailable && this.options.canFallback?.()) {
          cleanupFinished(); this.audio.removeEventListener('playing', onPlaying); this.releaseAudio();
          try {
            deviceAttempted = true;
            await this.playDevice(utterance, signal, generation, requestedAt);
            signal.throwIfAborted();
            completed = true;
            this.deviceFallbackUntil = performance.now() + 30000;
          } catch (fallbackError) {
            this.deviceFallbackUntil = 0;
            if (!signal.aborted && generation === this.generation) { this.callbacks.onStatus(fallbackError instanceof Error ? fallbackError.message : String(fallbackError)); throw fallbackError; }
          }
        } else {
          if (deviceAttempted) this.deviceFallbackUntil = 0;
          this.callbacks.onStatus(error instanceof Error ? error.message : String(error));
          throw error;
        }
      }
    } finally {
      cleanupFinished();
      this.audio.removeEventListener('playing', onPlaying);
      if (generation === this.generation) {
        const playedSeconds = this.playedSeconds();
        controller.abort();
        this.releaseAudio();
        this.controller = undefined; this.current = undefined; this.deviceUtterance = undefined; this.deviceStarted = undefined;
        this.clearPlayback();
        this.callbacks.onEnded?.(utterance, { interrupted: !completed, playedSeconds });
      }
    }
  }

  private async playDevice(utterance: SceneUtterance, signal: AbortSignal, generation: number, requestedAt: number): Promise<void> {
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('Device voices are unavailable. Captions remain available.');
    signal.throwIfAborted();
    if (!speechSynthesis.getVoices().length) await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged', finish); signal.removeEventListener('abort', cancel); resolve(); };
      const cancel = () => { clearTimeout(timer); speechSynthesis.removeEventListener('voiceschanged', finish); signal.removeEventListener('abort', cancel); reject(aborted()); };
      const timer = setTimeout(finish, 1000); speechSynthesis.addEventListener('voiceschanged', finish, { once: true }); signal.addEventListener('abort', cancel, { once: true });
    });
    signal.throwIfAborted();
    const voices = speechSynthesis.getVoices().filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
    if (!voices.length) throw new Error('An English device voice is unavailable. Captions remain available.');
    const character = utterance.speaker === 'date' || utterance.speaker === 'other-date' ? utterance.dateId ?? this.options.dateId?.() ?? 'mira' : utterance.speaker;
    const preferences: Record<string, RegExp> = { mira: /ava|samantha|aria|zira|victoria/i, jules: /sonia|serena|karen|moira|kate/i, dev: /andrew|alex|guy|david|daniel/i, waiter: /ryan|oliver|daniel|arthur/i, diner: /guy|fred|david|aaron/i };
    const index = ['mira', 'jules', 'dev', 'waiter', 'diner'].indexOf(character);
    const selected = voices.find(voice => voice.voiceURI === this.deviceVoices.get(character)) ?? voices.find(voice => preferences[character]?.test(voice.name)) ?? voices[Math.max(0, index) % voices.length];
    this.deviceVoices.set(character, selected.voiceURI);
    const text = utterance.text.replace(/\[(?:neutral|amused|warm|warmly|flirtatious|playful|embarrassed|hesitant|annoyed|angry|defensive|surprised|laughs?|sighs?)\]/gi, '').trim();
    if (!text) throw new Error('This line has no speakable text. Captions remain available.');
    const spoken = this.deviceUtterance = new SpeechSynthesisUtterance(text);
    spoken.voice = selected; spoken.lang = selected.lang; spoken.volume = this.volume;
    spoken.rate = { neutral: 1, amused: 1.04, warm: .96, flirtatious: .96, embarrassed: .93, annoyed: 1.02, angry: 1.06, defensive: 1, surprised: 1.05 }[utterance.emotion];
    spoken.pitch = { neutral: 1, amused: 1.03, warm: 1, flirtatious: 1.02, embarrassed: .98, annoyed: .98, angry: .97, defensive: .99, surprised: 1.04 }[utterance.emotion];
    this.callbacks.onStatus('Using a device voice.');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { spoken.onstart = null; spoken.onboundary = null; spoken.onend = null; spoken.onerror = null; signal.removeEventListener('abort', cancel); clearTimeout(timeout); };
      const cancel = () => { cleanup(); speechSynthesis.cancel(); reject(aborted()); };
      const timeout = setTimeout(() => { cleanup(); this.devicePrimed = false; speechSynthesis.cancel(); reject(new Error('Device speech did not finish. Captions remain available.')); }, Math.min(60000, 12000 + text.length * 110));
      const actualSpeech = () => {
        if (signal.aborted || generation !== this.generation) return;
        if (this.deviceStarted === undefined) { this.deviceStarted = performance.now(); this.callbacks.onMetrics?.({ firstAudioMs: Math.round(this.deviceStarted - requestedAt) }); }
        // SpeechSynthesis exposes no waveform. This is an actual speech event
        // and speaking gate; amplitude remains zero rather than fabricated.
        this.callbacks.onPlayback({ speaker: utterance.speaker, amplitude: 0, emotion: utterance.emotion, caption: utterance.text, actorId: utterance.actorId });
      };
      spoken.onstart = actualSpeech; spoken.onboundary = actualSpeech;
      spoken.onend = () => { cleanup(); if (this.deviceStarted === undefined) reject(new Error('Device speech did not start. Captions remain available.')); else resolve(); };
      spoken.onerror = () => { cleanup(); this.devicePrimed = false; reject(new Error('Device speech could not start. Tap Resume or Talk to enable audio; captions remain available.')); };
      signal.addEventListener('abort', cancel, { once: true });
      try { speechSynthesis.speak(spoken); } catch (error) { cleanup(); reject(error); }
    });
  }

  private playedSeconds() { return this.deviceStarted !== undefined ? Math.max(0, (performance.now() - this.deviceStarted) / 1000) : Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0; }

  private async stream(response: Response, mime: string, signal: AbortSignal): Promise<void> {
    const media = new MediaSource();
    this.objectUrl = URL.createObjectURL(media);
    const opened = this.waitFor(media, 'sourceopen', signal);
    this.audio.src = this.objectUrl;
    await opened;
    signal.throwIfAborted();
    const buffer = media.addSourceBuffer(mime);
    const reader = response.body!.getReader();
    let playing = false;
    let playPromise: Promise<void> | undefined;
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        signal.throwIfAborted();
        // Copy into an ordinary ArrayBuffer for SourceBuffer's DOM type.
        await this.waitFor(buffer, 'updateend', signal, () => buffer.appendBuffer(Uint8Array.from(value).buffer));
        if (!playing) {
          playing = true;
          // play() can wait for further media data. Keep reading while it waits.
          playPromise = this.audio.play();
          void playPromise.catch(() => {});
        }
      }
      signal.throwIfAborted();
      if (!playing) throw new Error('The voice service returned an empty recording.');
      if (media.readyState === 'open') media.endOfStream();
      await playPromise;
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async blob(response: Response, signal: AbortSignal): Promise<void> {
    const blob = await response.blob();
    signal.throwIfAborted();
    if (!blob.size) throw new Error('The voice service returned an empty recording.');
    this.objectUrl = URL.createObjectURL(blob);
    this.audio.src = this.objectUrl;
    await this.audio.play();
  }

  private waitFor(target: EventTarget, event: string, signal: AbortSignal, action?: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { target.removeEventListener(event, success); target.removeEventListener('error', failure); signal.removeEventListener('abort', failure); };
      const success = () => { cleanup(); resolve(); };
      const failure = () => { cleanup(); reject(signal.aborted ? aborted() : new Error('Unable to decode streamed voice audio.')); };
      if (signal.aborted) { reject(aborted()); return; }
      target.addEventListener(event, success, { once: true });
      target.addEventListener('error', failure, { once: true });
      signal.addEventListener('abort', failure, { once: true });
      try { action?.(); } catch (error) { cleanup(); reject(error); }
    });
  }

  private animate(utterance: SceneUtterance, generation: number): void {
    cancelAnimationFrame(this.animation);
    const update = () => {
      if (generation !== this.generation || this.audio.paused || this.audio.ended) return;
      let amplitude = 0;
      if (this.analyser && this.samples) {
        this.analyser.getFloatTimeDomainData(this.samples);
        let energy = 0;
        for (const value of this.samples) energy += value * value;
        amplitude = Math.min(1, Math.sqrt(energy / this.samples.length) * 6);
      }
      this.callbacks.onPlayback({ speaker: utterance.speaker, amplitude, emotion: utterance.emotion, caption: utterance.text, actorId: utterance.actorId });
      this.animation = requestAnimationFrame(update);
    };
    update();
  }

  private clearPlayback(): void {
    cancelAnimationFrame(this.animation);
    this.callbacks.onPlayback({ speaker: null, amplitude: 0, emotion: 'neutral', caption: '' });
  }

  private releaseAudio(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  stop(): void {
    const utterance = this.current;
    const playedSeconds = this.playedSeconds();
    this.generation++;
    this.controller?.abort(); this.controller = undefined; this.current = undefined; this.deviceUtterance = undefined; this.deviceStarted = undefined;
    this.releaseAudio();
    this.clearPlayback();
    if (utterance) this.callbacks.onEnded?.(utterance, { interrupted: true, playedSeconds });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.elementSource?.disconnect(); this.analyser?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
