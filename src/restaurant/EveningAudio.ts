/**
 * The room you hear, authored in code; no speech service or sample download is used.
 *
 * Layers, from the back: rain on the window, the murmur of other tables (formant-filtered noise that swells
 * and settles like distant conversation), a soft lounge piano with a walking bass, and now and then a fork
 * on china or two glasses touching somewhere in the room, panned to where it happened. Everything sits in one
 * small generated room reverb so the layers share a space. It all ducks under spoken dialogue.
 */
export class EveningAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private room?: GainNode;
  private murmur?: GainNode;
  private music?: GainNode;
  private reverb?: ConvolverNode;
  private wet?: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private clinkTimer?: ReturnType<typeof setTimeout>;
  private chatterTimer?: ReturnType<typeof setInterval>;
  private enabled = true;
  private paused = false;
  private speaking = false;
  private beat = 0;
  private seed = 23971;

  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  private noiseBuffer(context: AudioContext, seconds: number, brown = false) {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const samples = buffer.getChannelData(0); let last = 0;
    for (let i = 0; i < samples.length; i++) { const white = this.random() * 2 - 1; if (brown) { last = (last + white * .02) / 1.02; samples[i] = last * 3.5; } else samples[i] = white; }
    return buffer;
  }

  /** A short, warm room: decaying stereo noise with a darker tail. */
  private impulse(context: AudioContext) {
    const length = Math.floor(context.sampleRate * 1.6), buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel); let low = 0;
      for (let i = 0; i < length; i++) { const t = i / length; low = low * .7 + (this.random() * 2 - 1) * .3; data[i] = low * (1 - t) ** 2.6 * (i < 120 ? i / 120 : 1); }
    }
    return buffer;
  }

  async start() {
    if (!this.context) {
      const context = this.context = new AudioContext();
      this.master = context.createGain(); this.master.gain.value = .3; this.master.connect(context.destination);
      this.reverb = context.createConvolver(); this.reverb.buffer = this.impulse(context);
      this.wet = context.createGain(); this.wet.gain.value = .32; this.reverb.connect(this.wet); this.wet.connect(this.master);
      this.room = context.createGain(); this.room.gain.value = .016; this.room.connect(this.master);
      this.murmur = context.createGain(); this.murmur.gain.value = .05; this.murmur.connect(this.master); this.murmur.connect(this.reverb);
      this.music = context.createGain(); this.music.gain.value = 1; this.music.connect(this.master); this.music.connect(this.reverb);

      // Rain on the glass, kept well back.
      const rain = context.createBufferSource(); rain.buffer = this.noiseBuffer(context, 4, true); rain.loop = true;
      const rainFilter = context.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 2400;
      rain.connect(rainFilter); rainFilter.connect(this.room); rain.start(); this.sources.push(rain);

      // Other tables: three voices' worth of band-limited noise through vowel-ish formants, each swelling on its own.
      const chatter = this.noiseBuffer(context, 6);
      const voices: GainNode[] = [];
      for (const [low, high, pan] of [[320, 1150, -.6], [260, 900, .4], [400, 1500, .1]] as const) {
        const source = context.createBufferSource(); source.buffer = chatter; source.loop = true; source.loopStart = this.random() * 3;
        const a = context.createBiquadFilter(); a.type = 'bandpass'; a.frequency.value = low; a.Q.value = 3.2;
        const b = context.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = high; b.Q.value = 4;
        const voice = context.createGain(); voice.gain.value = 0;
        const panner = context.createStereoPanner(); panner.pan.value = pan;
        source.connect(a); source.connect(b); a.connect(voice); b.connect(voice); voice.connect(panner); panner.connect(this.murmur);
        source.start(0, this.random() * 5); this.sources.push(source); voices.push(voice);
      }
      // Syllable-rate wobble and phrase-length swells: what makes noise read as people talking.
      this.chatterTimer = setInterval(() => {
        if (!this.context) return; const now = this.context.currentTime;
        for (const voice of voices) {
          const talking = this.random() < .62;
          voice.gain.setTargetAtTime(talking ? .5 + this.random() * .6 : .05, now, .08 + this.random() * .12);
        }
      }, 230);

      // Lounge piano: ii–V–I–vi voicings, a walking bass, an occasional top-line note.
      this.timer = setInterval(() => {
        if (!this.enabled || this.paused || !this.context) return;
        const chords = [[50, 57, 60, 64], [43, 53, 57, 59], [48, 55, 59, 64], [45, 52, 55, 60], [50, 57, 60, 65], [43, 50, 53, 59], [48, 52, 55, 59], [48, 52, 55, 59]];
        const bar = Math.floor(this.beat / 4) % chords.length, chord = chords[bar], swing = (this.random() - .5) * .03;
        if (this.beat % 4 === 0) for (const [index, note] of chord.slice(1).entries()) this.piano(note + 12, 1.9, .014, index * .022 + swing);
        if (this.beat % 4 === 2 && this.random() < .45) for (const note of chord.slice(1)) this.piano(note + 12, .5, .007, .01 + swing);
        this.piano(chord[0] - (this.beat % 4 === 2 ? 0 : 12) + [0, 0, 7, 5][this.beat % 4]!, .7, .017, swing);
        if (this.beat % 8 === 5 && this.random() < .7) this.piano([76, 74, 72, 71, 79, 77][Math.floor(this.random() * 6)]!, .9, .008, .12 + swing);
        this.beat++;
      }, 640);
      this.scheduleClink();
    }
    await this.context.resume(); this.level();
  }

  /** Cutlery on china or a glass touching another, somewhere in the room, every few seconds. */
  private scheduleClink() {
    this.clinkTimer = setTimeout(() => {
      if (this.context && this.enabled && !this.paused) {
        const pan = this.random() * 1.6 - .8, distance = .35 + this.random() * .65, kind = this.random();
        if (kind < .55) this.ring([2380, 3710, 5260], .16, .012 * distance, pan);
        else if (kind < .85) this.ring([3050, 4630, 7120], .55, .008 * distance, pan);
        else { this.ring([1880, 2950], .11, .01 * distance, pan); this.ring([2210, 3460], .1, .009 * distance, pan, .09); }
      }
      this.scheduleClink();
    }, 2200 + this.random() * 6500);
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; this.level(); }
  setPaused(paused: boolean) { this.paused = paused; this.level(); }
  setSpeaking(speaking: boolean) { this.speaking = speaking; this.level(); }
  private level() {
    if (!this.master || !this.context) return;
    const now = this.context.currentTime, on = this.enabled && !this.paused;
    this.master.gain.setTargetAtTime(on ? (this.speaking ? .17 : .3) : 0, now, .2);
    // The other tables quieten under dialogue more than the music does, the way you stop hearing them.
    this.murmur?.gain.setTargetAtTime(this.speaking ? .025 : .05, now, .35);
  }

  /** Inharmonic partials with a fast strike: metal on china, glass on glass. */
  private ring(partials: number[], decay: number, volume: number, pan: number, delay = 0) {
    if (!this.context || !this.master || !this.reverb) return;
    const context = this.context, time = context.currentTime + delay, panner = context.createStereoPanner(); panner.pan.value = pan;
    const bus = context.createGain(); bus.gain.value = 1; bus.connect(panner); panner.connect(this.master); panner.connect(this.reverb);
    partials.forEach((hz, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = hz * (1 + (this.random() - .5) * .02);
      gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume / (index + 1), time + .002); gain.gain.exponentialRampToValueAtTime(.00001, time + decay * (1 + index * .3));
      oscillator.connect(gain); gain.connect(bus); oscillator.start(time); oscillator.stop(time + decay * 2 + .05);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (index === 0) { bus.disconnect(); panner.disconnect(); } };
    });
  }

  private tone(hz: number, duration: number, volume: number, delay = 0, type: OscillatorType = 'sine', destination?: AudioNode) {
    if (!this.context || !this.master || !this.enabled || this.paused) return;
    const context = this.context, oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime + delay;
    oscillator.type = type; oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .006); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(destination ?? this.master); oscillator.start(time); oscillator.stop(time + duration + .01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  /** A felt-hammer piano note: a soft strike, a few decaying harmonics, slightly detuned strings. */
  private piano(midi: number, duration: number, volume: number, delay = 0) {
    const frequency = 440 * 2 ** ((midi - 69) / 12), out = this.music;
    this.tone(frequency, duration, volume, delay, 'triangle', out);
    this.tone(frequency * 1.0016, duration * .9, volume * .5, delay, 'sine', out);
    this.tone(frequency * 2, duration * .45, volume * .22, delay, 'sine', out);
    this.tone(frequency * 3, duration * .2, volume * .08, delay, 'sine', out);
  }
  private note(midi: number, duration: number, volume: number, delay = 0) { const frequency = 440 * 2 ** ((midi - 69) / 12); this.tone(frequency, duration, volume, delay); this.tone(frequency * 2, duration * .4, volume * .2, delay); }
  cue(key: string) {
    if (/spill/.test(key)) { this.ring([2600, 3900], .35, .05, -.1); this.tone(320, .18, .06); }
    else if (/served|ordered|bill/.test(key)) { this.ring([2380, 3710, 5260], .22, .05, .15); this.ring([1880, 2950], .15, .03, .05, .12); }
    else if (/glass|toast/.test(key)) this.ring([3050, 4630, 7120], .9, .06, 0);
    else if (/ending|farewell/.test(key)) { this.note(60, 1.4, .04); this.note(64, 1.1, .025, .1); this.note(67, 1, .02, .22); }
  }
  dispose() {
    clearInterval(this.timer); clearInterval(this.chatterTimer); clearTimeout(this.clinkTimer);
    for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); }
    this.sources = []; void this.context?.close().catch(() => {});
  }
}
