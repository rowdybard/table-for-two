/** Quiet, code-authored room tone and object sounds; no speech service is used. */
export class EveningAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private room?: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private enabled = true;
  private paused = false;
  private speaking = false;
  private beat = 0;

  async start() {
    if (!this.context) {
      const context = this.context = new AudioContext();
      this.master = context.createGain(); this.master.gain.value = .3; this.master.connect(context.destination);
      this.room = context.createGain(); this.room.gain.value = .02; this.room.connect(this.master);
      const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const samples = buffer.getChannelData(0); let last = 0, seed = 23971;
      for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; last = (last + ((seed / 4294967296) * 2 - 1) * .02) / 1.02; samples[i] = last * 3.5; }
      const rain = context.createBufferSource(); rain.buffer = buffer; rain.loop = true;
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2800;
      rain.connect(filter); filter.connect(this.room); rain.start(); this.sources.push(rain);
      // Sparse lounge piano: intentionally quiet enough to leave room for voices.
      this.timer = setInterval(() => {
        if (!this.enabled || this.paused || !this.context) return;
        const chords = [[48, 55, 59, 64], [45, 52, 55, 60], [50, 57, 60, 65], [43, 50, 53, 59]];
        if (this.beat % 4 === 0) for (const [index, note] of chords[Math.floor(this.beat / 16) % chords.length].entries()) this.note(note, .8, .018, index * .025);
        if (this.beat % 8 === 5) this.note([72, 71, 69, 67][Math.floor(this.beat / 8) % 4], .6, .009);
        this.beat++;
      }, 880);
    }
    await this.context.resume(); this.level();
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; this.level(); }
  setPaused(paused: boolean) { this.paused = paused; this.level(); }
  setSpeaking(speaking: boolean) { this.speaking = speaking; this.level(); }
  private level() { if (this.master && this.context) this.master.gain.setTargetAtTime(this.enabled && !this.paused ? (this.speaking ? .16 : .3) : 0, this.context.currentTime, .2); }
  private tone(hz: number, duration: number, volume: number, delay = 0, type: OscillatorType = 'sine') {
    if (!this.context || !this.master || !this.enabled || this.paused) return;
    const context = this.context, oscillator = context.createOscillator(), gain = context.createGain(), time = context.currentTime + delay;
    oscillator.type = type; oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .006); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    oscillator.connect(gain); gain.connect(this.master); oscillator.start(time); oscillator.stop(time + duration + .01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  private note(midi: number, duration: number, volume: number, delay = 0) { const frequency = 440 * 2 ** ((midi - 69) / 12); this.tone(frequency, duration, volume, delay); this.tone(frequency * 2, duration * .4, volume * .2, delay); }
  cue(key: string) {
    if (/spill/.test(key)) { this.tone(320, .18, .08); this.tone(710, .13, .05, .06); }
    else if (/served|ordered|bill/.test(key)) { this.tone(1850, .12, .06); this.tone(2670, .08, .025, .025); }
    else if (/glass|toast/.test(key)) { this.tone(2100, .3, .08); this.tone(2870, .22, .035); }
    else if (/ending|farewell/.test(key)) { this.note(60, 1.4, .04); this.note(64, 1.1, .025, .1); this.note(67, 1, .02, .22); }
  }
  dispose() { clearInterval(this.timer); for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); } this.sources = []; void this.context?.close().catch(() => {}); }
}
