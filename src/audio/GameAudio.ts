import type { RoomState } from '../shared/protocol';
import { POOL } from '../shared/venue';

/** Optional, locally synthesized effects. No microphone, media downloads, or recording. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private enabled = false;
  private previous?: RoomState;
  private velocities = new Map<number, { x: number; z: number }>();
  private lastImpact = 0;

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled) {
      this.context ??= new AudioContext();
      if (!this.master) { this.master = this.context.createGain(); this.master.gain.value = .18; this.master.connect(this.context.destination); }
      await this.context.resume();
      this.enabled = this.context.state === 'running';
      if (this.enabled) this.tone(440, .06, .12);
    } else { this.enabled = false; if (this.context?.state === 'running') await this.context.suspend(); }
    return this.enabled;
  }

  observe(state: RoomState) {
    const old = this.previous;
    this.previous = state;
    if (!old || old.room !== state.room) { this.velocities.clear(); return; }
    if (state.phase !== 'playing') { this.velocities.clear(); return; }
    if (state.pool.shots > old.pool.shots) this.impact(.30, 3300);
    if (state.pool.pocketed > old.pool.pocketed || (state.pool.balls.length < old.pool.balls.length && state.pool.pocketed === old.pool.pocketed)) {
      this.noise(.09, .18, 550); this.tone(180, .12, .15, 0, 85);
    }
    const elapsed = (state.tick - old.tick) / 60;
    if (state.pool.phase === 'rolling' && elapsed > 0 && elapsed < .4) {
      let collision = false;
      const nextVelocities = new Map<number, { x: number; z: number }>();
      for (const ball of state.pool.balls) {
        const before = old.pool.balls.find(b => b.id === ball.id); if (!before) continue;
        const velocity = { x: (ball.position[0] - before.position[0]) / elapsed, z: (ball.position[2] - before.position[2]) / elapsed };
        nextVelocities.set(ball.id, velocity);
        const prior = this.velocities.get(ball.id); if (!prior) continue;
        const priorSpeed = Math.hypot(prior.x, prior.z), speed = Math.hypot(velocity.x, velocity.z);
        const change = Math.hypot(velocity.x - prior.x, velocity.z - prior.z);
        if (priorSpeed > .25 && change > .6 && speed > .08) {
          const [x,,z] = ball.position;
          const byRail = Math.min(x - POOL.minX, POOL.maxX - x, z - POOL.minZ, POOL.maxZ - z) < .27;
          const byBall = state.pool.balls.some(other => other.id !== ball.id && Math.hypot(other.position[0] - x, other.position[2] - z) < .36);
          collision ||= byRail || byBall;
        }
      }
      this.velocities = nextVelocities;
      if (collision && performance.now() - this.lastImpact > 65) { this.lastImpact = performance.now(); this.impact(.14, 4300); }
    } else this.velocities.clear();
    if (old.lane.canBowl && !state.lane.canBowl) { this.noise(.65, .09, 220); this.tone(68, .25, .1, 0, 42); }
    const fallen = state.lane.pinsDown - old.lane.pinsDown;
    for (let i = 0; i < Math.min(4, fallen); i++) this.impact(.22, 2200, i * .035);
    if (state.claw.phase !== old.claw.phase) {
      if (state.claw.phase === 'dropping') this.tone(155, .3, .08, 0, 105, 'triangle');
      if (state.claw.phase === 'surprise') { this.tone(260, .16, .1); this.tone(195, .2, .08, .14); }
      if (state.claw.phase === 'won') this.chime();
    }
    if (state.pool.phase === 'won' && old.pool.phase !== 'won') this.chime();
    if (['kiss','celebration'].includes(state.ending.phase) && old.ending.phase === 'choice') this.chime();
  }

  private impact(volume: number, cutoff: number, delay = 0) { this.noise(.025, volume, cutoff, delay); this.tone(460, .045, volume * .24, delay, 210); }
  private chime() { for (const [i, pitch] of [261.63, 329.63, 392, 523.25].entries()) this.tone(pitch, .3, .1, i * .085); }
  private tone(frequency: number, duration: number, volume: number, delay = 0, end = frequency, type: OscillatorType = 'sine') {
    if (!this.enabled || !this.context || !this.master) return;
    const ctx = this.context, at = ctx.currentTime + delay, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, at); osc.frequency.exponentialRampToValueAtTime(Math.max(20,end), at + duration);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(volume, at + .004); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(at); osc.stop(at + duration + .01);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  private noise(duration: number, volume: number, cutoff: number, delay = 0) {
    if (!this.enabled || !this.context || !this.master) return;
    const ctx = this.context, at = ctx.currentTime + delay, buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const samples = buffer.getChannelData(0); for (let i=0;i<samples.length;i++) samples[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(); source.buffer = buffer;
    filter.type = 'lowpass'; filter.frequency.value = cutoff; gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(at);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  reset() { this.previous = undefined; this.velocities.clear(); }
  dispose() { this.enabled = false; void this.context?.close(); }
}
