import type { Emotion } from '../types';

/**
 * A continuous facial and head performance derived from the authoritative emotion.
 * It is pure presentation: it reads emotion, speech and attention, and writes smoothed
 * expression, blink, gaze and head-motion values. It never touches game state.
 */
export interface PerformanceInput {
  emotion: Emotion;
  speaking: boolean;
  /** Current speech amplitude in 0..1 while speaking. */
  amplitude: number;
  /** The person this character is looking at is currently talking to them. */
  attentive: boolean;
  /** prefers-reduced-motion: keep expression, suppress idle movement. */
  reducedMotion: boolean;
  /** Unique actual speech/caption presentation. Null cancels its transient accents. */
  deliveryId?: string | number | null;
  /** Added to the expression's smile, -1..1: how the evening is going shows even in a resting face. */
  smileBias?: number;
  /** 0..1: how readily the eyes drift off the person in front of them. */
  wander?: number;
  /** 0..1: eyes up and aside, working something out. */
  lookUp?: number;
  /** 0..1: eyes down at the hands. */
  lookDown?: number;
}

export interface FacePose {
  /** -1 pressed/frowning .. 1 broad smile. */
  smile: number;
  /** Left/right corner imbalance; positive raises the character's right corner. */
  asymmetry: number;
  /** Cheek raise narrowing the lower lid; 0..1. */
  squint: number;
  /** Jaw drop independent of speech; 0..1. */
  jaw: number;
  /** Lip press (tightened, thinner lips); 0..1. */
  press: number;
  /** Outer brow angle in radians; positive knits the brows. */
  browAngle: number;
  /** Brow lift in metres. */
  browLift: number;
  /** Inner-brow raise for concern or embarrassment; 0..1. */
  browInner: number;
  /** Eyelid opening multiplier, including blinks. */
  eyeOpen: number;
  /** Gaze offset in look units added to the tracked target. */
  gazeX: number;
  gazeY: number;
  /** Head offsets in radians added to tracking. */
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** Hand beat gesture envelope while speaking; 0..1. */
  beat: number;
  /** Which hand carries the beat: -1 left, 1 right, 0 both. */
  beatHand: -1 | 0 | 1;
}

interface ExpressionTarget {
  smile: number; asymmetry: number; squint: number; jaw: number; press: number;
  browAngle: number; browLift: number; browInner: number; lidOpen: number; tilt: number; blinkRate: number;
}

const EXPRESSIONS: Record<Emotion, ExpressionTarget> = {
  neutral:     { smile: .1,  asymmetry: 0,   squint: .04, jaw: 0,   press: 0,   browAngle: 0,     browLift: 0,      browInner: 0,   lidOpen: 1,    tilt: 0,    blinkRate: 1 },
  amused:      { smile: 1,   asymmetry: .4,  squint: .7,  jaw: .1,  press: 0,   browAngle: -.05,  browLift: .002,   browInner: 0,   lidOpen: .9,   tilt: .05,  blinkRate: 1.1 },
  warm:        { smile: .7,  asymmetry: .15, squint: .45, jaw: 0,   press: 0,   browAngle: -.03,  browLift: .001,   browInner: .12, lidOpen: .95,  tilt: .035, blinkRate: .9 },
  flirtatious: { smile: .85, asymmetry: .65, squint: .5,  jaw: 0,   press: 0,   browAngle: -.06,  browLift: .0022,  browInner: 0,   lidOpen: .82,  tilt: .075, blinkRate: 1.25 },
  embarrassed: { smile: .32, asymmetry: .25, squint: .22, jaw: 0,   press: .4,  browAngle: .03,   browLift: .0012,  browInner: .8,  lidOpen: .88,  tilt: .03,  blinkRate: 1.8 },
  annoyed:     { smile: -.5, asymmetry: -.15, squint: .35, jaw: 0,  press: .6,  browAngle: .2,    browLift: -.0022, browInner: 0,   lidOpen: .88,  tilt: -.02, blinkRate: 1.2 },
  angry:       { smile: -.7, asymmetry: 0,   squint: .5,  jaw: 0,   press: .75, browAngle: .3,    browLift: -.0038, browInner: 0,   lidOpen: .96,  tilt: 0,    blinkRate: .7 },
  defensive:   { smile: -.25, asymmetry: 0,  squint: .2,  jaw: 0,   press: .55, browAngle: .13,   browLift: -.001,  browInner: .3,  lidOpen: .9,   tilt: -.03, blinkRate: 1.5 },
  surprised:   { smile: .05, asymmetry: 0,   squint: 0,   jaw: .6,  press: 0,   browAngle: -.14,  browLift: .005,   browInner: .35, lidOpen: 1.15, tilt: 0,    blinkRate: .5 },
};

function randomStream(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const approach = (current: number, target: number, dt: number, rate: number) =>
  dt > 0 ? lerp(current, target, 1 - Math.exp(-dt * rate)) : target;

export class FacialPerformance {
  readonly pose: FacePose = {
    smile: .12, asymmetry: 0, squint: .04, jaw: 0, press: 0, browAngle: 0, browLift: 0, browInner: 0,
    eyeOpen: 1, gazeX: 0, gazeY: 0, headPitch: 0, headYaw: 0, headRoll: 0, beat: 0, beatHand: 1,
  };
  private beatStart = -1;
  private beatDuration = .55;
  private lastBeat = -10;
  private readonly rand: () => number;
  private emotion: Emotion = 'neutral';
  private emotionAge = 0;
  // Blinks.
  private nextBlink: number;
  private blinkStart = -1;
  private blinkDuration = .22;
  private pendingDoubleBlink = false;
  private forcedBlinkDuration = 0;
  // Gaze.
  private nextSaccade = 0;
  private saccadeX = 0;
  private saccadeY = 0;
  private glanceUntil = -1;
  // Head.
  private nextNod = 0;
  private nodStart = -1;
  private nodStrength = 0;
  private nodCount = 0;
  private speechPeak = 0;
  private idleYaw = 0;
  private idleRoll = 0;
  private nextIdleShift = 0;
  private lidOpen = 1;
  private lastDelivery: string | number | null | undefined;
  private deliveryAge = Infinity;

  constructor(seed: number) {
    this.rand = randomStream(seed * 7919 + 17);
    this.nextBlink = .6 + this.rand() * 2.4;
    this.nextSaccade = this.rand() * 1.2;
    this.nextNod = 1 + this.rand() * 2;
    this.nextIdleShift = this.rand() * 3;
  }

  update(time: number, dt: number, input: PerformanceInput): FacePose {
    const pose = this.pose;
    dt = clamp(dt, 0, .1);
    const target = EXPRESSIONS[input.emotion];
    const newDelivery = input.deliveryId != null && input.deliveryId !== this.lastDelivery;
    if (newDelivery || (input.deliveryId === null && this.lastDelivery != null)) {
      this.deliveryAge = newDelivery ? 0 : Infinity;
      this.beatStart = -1; this.nodStart = -1; this.speechPeak = 0;
      pose.beat = 0;
    }
    if (input.deliveryId !== undefined) this.lastDelivery = input.deliveryId;
    if (input.emotion !== this.emotion || newDelivery) {
      // A new feeling arrives with a blink and a tiny gaze reset, like a real reaction.
      this.emotion = input.emotion;
      this.emotionAge = 0;
      if (!input.reducedMotion) this.scheduleBlink(time, .08 + this.rand() * .12, input.emotion === 'surprised' ? .14 : .2);
      if (!input.reducedMotion) this.nextSaccade = time + .25 + this.rand() * .3;
    }
    this.emotionAge += dt;
    this.deliveryAge += dt;
    const motion = input.reducedMotion ? 0 : 1;

    // Expression: features attack quickly and relax slowly so smiles bloom rather than snap.
    const settle = (current: number, goal: number, attack: number, release: number) =>
      approach(current, goal, dt, Math.abs(goal) > Math.abs(current) ? attack : release);
    const speechSmile = input.speaking ? -.06 * clamp(input.amplitude, 0, 1) : 0;
    pose.smile = settle(pose.smile, clamp(target.smile + speechSmile + (input.smileBias ?? 0), -1, 1), 6, 2.6);
    pose.asymmetry = settle(pose.asymmetry, target.asymmetry, 5, 2.5);
    pose.squint = settle(pose.squint, target.squint * (input.speaking ? .8 : 1), 5.5, 2.2);
    pose.press = settle(pose.press, input.speaking ? target.press * .35 : target.press, 7, 3);
    pose.browInner = settle(pose.browInner, target.browInner, 6, 2.5);
    // Brows punctuate speech on amplitude peaks, and lift at the start of a surprised beat.
    const peak = input.speaking ? Math.max(0, clamp(input.amplitude, 0, 1) - this.speechPeak) : 0;
    this.speechPeak = approach(this.speechPeak, input.speaking ? clamp(input.amplitude, 0, 1) : 0, dt, 5);
    const deliveryAccent = Math.sin(Math.PI * clamp(this.deliveryAge / .65, 0, 1));
    const speechLift = (peak * .0028 + deliveryAccent * .0012) * motion;
    pose.browAngle = settle(pose.browAngle, target.browAngle - peak * .02, 6, 3);
    pose.browLift = settle(pose.browLift, target.browLift + speechLift, 9, 3.5);
    const jawSurprise = target.jaw * Math.exp(-this.emotionAge * .55);
    pose.jaw = settle(pose.jaw, input.speaking ? 0 : jawSurprise, 7, 2.5);

    // Blinks: irregular intervals, fast close, slower open, occasional double blink.
    this.lidOpen = approach(this.lidOpen, target.lidOpen, dt, 4);
    let blink = 1;
    if (motion) {
      if (this.blinkStart < 0 && time >= this.nextBlink) {
        this.blinkStart = time;
        this.blinkDuration = this.forcedBlinkDuration || .16 + this.rand() * .08;
        this.forcedBlinkDuration = 0;
        this.pendingDoubleBlink = this.rand() < .14;
        this.nextBlink = time + (1.8 + this.rand() * 4.4) / target.blinkRate;
      }
      if (this.blinkStart >= 0) {
        const t = (time - this.blinkStart) / this.blinkDuration;
        if (t >= 1) {
          this.blinkStart = -1;
          if (this.pendingDoubleBlink) { this.pendingDoubleBlink = false; this.scheduleBlink(time, .1, .16); }
        } else {
          const closeFraction = .36;
          blink = t < closeFraction ? 1 - (t / closeFraction) ** 1.6 : ((t - closeFraction) / (1 - closeFraction)) ** .7;
          blink = Math.max(.02, blink);
        }
      }
    } else {
      this.blinkStart = -1;
    }
    pose.eyeOpen = this.lidOpen * blink;

    // Gaze: micro-saccades between the listener's eyes, thinking glances while speaking,
    // and a brief look away when embarrassed or defensive.
    if (motion && time >= this.nextSaccade) {
      const away = (input.emotion === 'embarrassed' ? .55 : input.emotion === 'defensive' ? .3 : input.speaking ? .22 : .08) + (input.speaking ? 0 : (input.wander ?? 0) * .45);
      if (this.rand() < away) {
        const sideways = (this.rand() < .5 ? -1 : 1) * (.35 + this.rand() * .45);
        this.saccadeX = sideways;
        this.saccadeY = input.emotion === 'embarrassed' ? -.5 - this.rand() * .3 : input.speaking ? .25 + this.rand() * .3 : -.1;
        this.glanceUntil = time + .5 + this.rand() * (input.speaking ? 1 : .6);
        this.nextSaccade = this.glanceUntil;
      } else {
        this.saccadeX = (this.rand() - .5) * .3;
        this.saccadeY = (this.rand() - .5) * .14;
        this.glanceUntil = -1;
        this.nextSaccade = time + (input.attentive ? .35 : .6) + this.rand() * (input.attentive ? .9 : 1.8);
      }
    }
    if (this.glanceUntil >= 0 && time >= this.glanceUntil) { this.glanceUntil = -1; this.saccadeX *= .2; this.saccadeY *= .2; this.nextSaccade = time + .2; }
    // Saccades move fast; the eyes rest between them. Thinking looks up and away; a phone pulls the eyes down.
    const up = clamp(input.lookUp ?? 0, 0, 1), down = clamp(input.lookDown ?? 0, 0, 1);
    pose.gazeX = approach(pose.gazeX, lerp(this.saccadeX * motion, .55, up * .8), dt, 22);
    pose.gazeY = approach(pose.gazeY, lerp(lerp(this.saccadeY * motion, .6, up), -.9, down), dt, 22);

    // Head: listening nods, speaking accents, emotional tilt and a slow idle drift.
    let nod = 0;
    if (motion) {
      if (this.nodStart < 0 && time >= this.nextNod) {
        const likely = input.attentive ? .75 : input.speaking ? .35 : .12;
        if (this.rand() < likely) {
          this.nodStart = time;
          this.nodStrength = input.attentive ? .05 + this.rand() * .04 : .03 + this.rand() * .025;
          this.nodCount = input.attentive && this.rand() < .45 ? 2 : 1;
        }
        this.nextNod = time + (input.attentive ? 1.2 : 2.2) + this.rand() * 2.5;
      }
      if (this.nodStart >= 0) {
        const duration = .42 * this.nodCount;
        const t = (time - this.nodStart) / duration;
        if (t >= 1) this.nodStart = -1;
        else nod = Math.sin(t * Math.PI * this.nodCount) * this.nodStrength * Math.sin(t * Math.PI) ** .35;
      }
      if (time >= this.nextIdleShift) {
        this.idleYaw = (this.rand() - .5) * .07;
        this.idleRoll = (this.rand() - .5) * .04;
        this.nextIdleShift = time + 2.5 + this.rand() * 4;
      }
    }
    // Hands: a beat gesture rides the stronger speech peaks, one hand at a time, sometimes both.
    if (motion && input.speaking && this.beatStart < 0 && peak > .16 && time - this.lastBeat > .7 && this.rand() < .7) {
      this.beatStart = time;
      this.beatDuration = .45 + this.rand() * .3;
      const r = this.rand();
      pose.beatHand = r < .2 ? 0 : r < .6 ? 1 : -1;
    }
    let beat = 0;
    if (this.beatStart >= 0) {
      const t = (time - this.beatStart) / this.beatDuration;
      if (t >= 1 || !input.speaking && t > .5) { this.beatStart = -1; this.lastBeat = time; }
      else beat = Math.sin(Math.min(1, t) * Math.PI) ** .8;
    }
    pose.beat = approach(pose.beat, beat * motion, dt, 18);
    const glanceYaw = this.glanceUntil >= 0 ? this.saccadeX * .09 : 0;
    const glancePitch = this.glanceUntil >= 0 ? -this.saccadeY * .05 : 0;
    const accent = input.speaking ? peak * .035 * motion : 0;
    pose.headPitch = approach(pose.headPitch, nod + accent + glancePitch + (input.emotion === 'embarrassed' ? .06 : input.emotion === 'defensive' ? -.03 : 0) - up * .07 + down * .26, dt, 10);
    pose.headYaw = approach(pose.headYaw, (this.idleYaw + glanceYaw) * motion + up * .12, dt, 3);
    const flirtRoll = input.emotion === 'flirtatious' || input.emotion === 'amused' || input.emotion === 'warm' ? -target.tilt : target.tilt;
    pose.headRoll = approach(pose.headRoll, flirtRoll + this.idleRoll * motion, dt, 3.5);
    return pose;
  }

  private scheduleBlink(time: number, delay: number, duration: number) {
    if (this.blinkStart >= 0) return;
    this.nextBlink = Math.min(this.nextBlink, time + delay);
    this.forcedBlinkDuration = duration;
  }
}
