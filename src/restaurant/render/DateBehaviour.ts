import * as THREE from 'three';
import type { DateStance, Emotion } from '../types';

/**
 * What a seated date does with their hands, posture and attention between and during lines: eating their
 * own plate, sipping, tucking their hair, covering a laugh, resting their chin while listening, thinking
 * before a reply, and glancing at their phone when the evening has gone flat.
 *
 * Pure presentation. It reads the server's interest read-out, the course and the conversation state, and
 * writes hand targets and posture offsets in the actor's own space. It never touches game state.
 */
export type DateGesture = 'bite' | 'sip' | 'hair' | 'laugh' | 'phone' | 'chin' | 'think' | 'fidget';

export interface DateBehaviourInput {
  /** The server's read-out, 0..100; undefined before a dinner exists. */
  interest?: number;
  stance: DateStance;
  emotion: Emotion;
  seated: boolean;
  speaking: boolean;
  /** The human is talking to this date right now. */
  listening: boolean;
  /** This date's reply to the human is on its way. */
  thinking: boolean;
  mainServed: boolean;
  /** Bites the date has taken of their own plate (server count); a new one plays a bite. */
  dateBites: number;
  /** Seconds since anybody at the table last said anything. */
  quietFor: number;
  reducedMotion: boolean;
  /** The date's own glass, in the actor's space, when it is on the table in reach. */
  glass: THREE.Vector3 | null;
  /** Centre of the date's plate in the actor's space. */
  plate: THREE.Vector3 | null;
  /** Head centre in the actor's space. */
  head: THREE.Vector3;
}

/** One arm's override: where the hand goes (actor space), how the hand is turned, and how much it wins. */
/** `bend` is the preferred elbow direction (the IK pole), e.g. forward and down for an elbow on the table. */
export interface ArmOverride { target: THREE.Vector3; orientation: THREE.Quaternion; weight: number; bend?: THREE.Vector3 }

export interface DateBehaviourOutput {
  /** Index 0 is the date's right hand (actor -x), index 1 the left (actor +x), as in the body rig. */
  arms: [ArmOverride, ArmOverride];
  /** Extra forward lean in radians. */
  lean: number;
  /** Small vertical shake of the shoulders, metres (a laugh). */
  bounce: number;
  /** Added to the resting smile, -1..1. */
  smile: number;
  /** 0..1: how readily the eyes drift away from the person in front of them. */
  wander: number;
  /** Looking up and aside, thinking. */
  lookUp: number;
  /** Looking down at something in the hands (phone). */
  lookDown: number;
  /**
   * Where the date's fork is: in its place setting before the main, resting on the plate's rim once
   * they have started eating, or in their hand during a bite.
   */
  fork: 'table' | 'plate' | 'hand';
  phone: boolean;
  /** The date's own glass, lifted: weight 0 leaves it on the table; position in actor space. */
  glass: { weight: number; position: THREE.Vector3; tilt: number };
  /** The gesture currently playing, for tests and the QA harness. */
  gesture: DateGesture | null;
  /** Smoothed interest, 0..1. */
  interest: number;
}

interface Clip { kind: DateGesture; start: number; duration: number; side: 0 | 1 }

/** Durations in seconds. Holds (chin, think) have no fixed end and fade when their reason ends. */
const DURATION: Record<DateGesture, number> = { bite: 2.3, sip: 3.1, hair: 1.7, laugh: 1.2, phone: 4.8, chin: Infinity, think: Infinity, fidget: 2.6 };

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function randomStream(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
/** In and out over `edge` seconds, held between. */
function envelope(age: number, duration: number, edge = .35) { return Number.isFinite(duration) ? Math.min(smooth(age / edge), smooth((duration - age) / edge)) : smooth(age / edge); }

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

export class DateBehaviour {
  readonly output: DateBehaviourOutput = {
    arms: [{ target: new THREE.Vector3(), orientation: new THREE.Quaternion(), weight: 0 }, { target: new THREE.Vector3(), orientation: new THREE.Quaternion(), weight: 0 }],
    lean: 0, bounce: 0, smile: 0, wander: 0, lookUp: 0, lookDown: 0, fork: 'table', phone: false,
    glass: { weight: 0, position: new THREE.Vector3(), tilt: 0 }, gesture: null, interest: .35,
  };
  private readonly rand: () => number;
  private clip: Clip | null = null;
  private hold: { kind: 'chin' | 'think'; start: number; side: 0 | 1; releasing: number } | null = null;
  private interest = -1;
  private lastBites = -1;
  private lastEmotion: Emotion = 'neutral';
  private nextIdle = 0;
  private lastPhone = -1000;
  private lastSip = -1000;
  private readonly scratch = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private readonly elbow = [new THREE.Vector3(), new THREE.Vector3()] as const;

  constructor(seed: number) { this.rand = randomStream(seed * 4099 + 3); this.nextIdle = 6 + this.rand() * 6; }

  /** Start a gesture now, for the QA harness or a deterministic test. */
  force(kind: DateGesture, time: number) { if (kind === 'chin' || kind === 'think') this.hold = { kind, start: time, side: 1, releasing: -1 }; else this.clip = { kind, start: time, duration: DURATION[kind], side: kind === 'sip' || kind === 'hair' ? 0 : 1 }; }

  update(time: number, dt: number, input: DateBehaviourInput): DateBehaviourOutput {
    const out = this.output;
    const target = clamp01((input.interest ?? 35) / 100);
    this.interest = this.interest < 0 ? target : this.interest + (target - this.interest) * (1 - Math.exp(-Math.max(0, dt) * 1.2));
    const interest = out.interest = this.interest;
    const cold = input.stance === 'guarded' || input.stance === 'hurt' || input.stance === 'leaving';
    const free = input.seated && !input.reducedMotion;

    // Bites follow the server's count, so both friends at a shared table see the same plate.
    if (this.lastBites < 0) this.lastBites = input.dateBites;
    if (input.dateBites > this.lastBites && input.mainServed && free && !input.speaking) this.play('bite', time, 1);
    this.lastBites = input.dateBites;
    // A laugh catches the hand on its way to the mouth.
    if (input.emotion !== this.lastEmotion && input.emotion === 'amused' && free && (!this.clip || this.clip.kind === 'fidget') && this.rand() < .7) this.play('laugh', time, 0);
    // A flirtatious line is often finished with a tuck of the hair.
    if (input.emotion !== this.lastEmotion && input.emotion === 'flirtatious' && free && !this.clip && this.rand() < .6) this.play('hair', time + .4, 0);
    this.lastEmotion = input.emotion;

    // Holds: chin on a hand while really listening and interested; a hand at the chin while working out a reply.
    const wantsChin = free && input.listening && !input.speaking && interest > .62 && !cold;
    const wantsThink = free && input.thinking && !input.speaking && !input.listening;
    if (this.hold && this.hold.releasing < 0 && !(this.hold.kind === 'chin' ? wantsChin : wantsThink)) this.hold.releasing = time;
    if (this.hold && this.hold.releasing >= 0 && time - this.hold.releasing > .45) this.hold = null;
    if (!this.hold && !this.clip && (wantsThink || wantsChin)) this.hold = { kind: wantsThink ? 'think' : 'chin', start: time, side: this.rand() < .5 ? 0 : 1, releasing: -1 };

    // Idle business between lines: a sip now and then, fiddling when unsure, the phone when bored.
    if (free && !this.clip && !this.hold && !input.speaking && time >= this.nextIdle) {
      const bored = interest < .25 && input.quietFor > 12 && !input.listening;
      if (bored && time - this.lastPhone > 40) { this.play('phone', time, 1); this.lastPhone = time; }
      else if (input.glass && time - this.lastSip > 26 && this.rand() < .55) { this.play('sip', time, 0); this.lastSip = time; }
      else if (!cold && interest > .5 && this.rand() < .35) this.play('hair', time, 0);
      else if (interest < .5 || cold) this.play('fidget', time, 0);
      this.nextIdle = time + 9 + this.rand() * 12 - interest * 3;
    }
    if (this.clip && time - this.clip.start >= this.clip.duration) this.clip = null;
    if (this.clip && (!input.seated || input.reducedMotion)) this.clip = null;
    if (this.clip?.kind === 'phone' && (input.speaking || input.listening)) this.clip.duration = Math.min(this.clip.duration, time - this.clip.start + .5);

    // Posture from interest: leaning in and an easy smile when it is going well, sitting back when it is not.
    const leanFromInterest = (interest - .4) * .07;
    out.lean = leanFromInterest + (this.hold?.kind === 'chin' ? .06 : 0);
    out.smile = cold ? -.05 : (interest - .4) * .35;
    out.wander = clamp01((.45 - interest) * 1.6) + (cold ? .25 : 0);
    out.bounce = 0; out.lookUp = 0; out.lookDown = 0; out.fork = input.mainServed ? 'plate' : 'table'; out.phone = false;
    out.glass.weight = 0; out.glass.tilt = 0;
    out.gesture = this.clip?.kind ?? this.hold?.kind ?? null;
    for (const arm of out.arms) { arm.weight = 0; arm.bend = undefined; }

    const head = input.head;
    this.mouth.set(head.x, head.y - .085, head.z + .1);
    if (this.hold) {
      const age = time - this.hold.start, release = this.hold.releasing >= 0 ? 1 - smooth((time - this.hold.releasing) / .45) : 1;
      const w = envelope(age, Infinity, .5) * release, arm = out.arms[this.hold.side], side = this.hold.side ? 1 : -1;
      if (this.hold.kind === 'chin') {
        // Elbow on the table, the chin resting on the back of the fingers.
        arm.target.set(head.x + side * .02, head.y - .14, head.z + .1);
        arm.orientation.copy(q(.35, side * -1.2, side * -.25));
        arm.bend = this.elbow[this.hold.side].set(side * .25, -.45, .86);
      } else {
        arm.target.set(head.x + side * .035, head.y - .13, head.z + .1);
        arm.orientation.copy(q(.1, side * -1.35, side * -.6));
        arm.bend = this.elbow[this.hold.side].set(side * .35, -.5, .79);
        out.lookUp = w;
      }
      arm.weight = w;
    }
    if (this.clip) {
      const clip = this.clip, age = time - clip.start, d = clip.duration, arm = out.arms[clip.side], side = clip.side ? 1 : -1;
      const p = age / d, w = envelope(age, d, .4);
      if (clip.kind === 'bite' && input.plate) {
        // Fork to the near side of the plate, then up to the mouth and back down.
        const plate = this.scratch.copy(input.plate).add(new THREE.Vector3(side * .05, .035, -.11));
        const lift = smooth((p - .3) / .25) * (1 - smooth((p - .72) / .25));
        // At the top the fingers turn up so the fork's tines meet the lips from just below and in front.
        const lips = new THREE.Vector3(this.mouth.x + side * .035, this.mouth.y - .13, this.mouth.z + .05);
        arm.target.copy(plate).lerp(lips, lift);
        arm.orientation.copy(q(-Math.PI / 2 - lift * 1.85, side * (.2 - lift * 1.3), side * .1));
        arm.bend = this.elbow[clip.side].set(side * .55, -.65, -.2 + lift * .6);
        arm.weight = w;
        out.lean += .05 * (1 - lift) * w;
        // The fork is picked up off the rim when the hand gets there and put back the same way.
        if (p > .26 && p < .86) out.fork = 'hand';
      } else if (clip.kind === 'sip' && input.glass) {
        // The hand meets the glass, lifts it to the lips, tips it, and sets it back where it was.
        const reach = smooth(p / .2), lift = smooth((p - .2) / .25) * (1 - smooth((p - .72) / .2));
        const hold = this.scratch.copy(input.glass).add(new THREE.Vector3(0, .06, -.02));
        const atLips = new THREE.Vector3(this.mouth.x + side * .02, this.mouth.y - .07, this.mouth.z + .05);
        arm.target.copy(hold).lerp(atLips, lift);
        arm.orientation.copy(q(-.15 - lift * .25, side * -1.45, side * -.05));
        arm.bend = this.elbow[clip.side].set(side * .55, -.6, .1 + lift * .5);
        arm.weight = Math.min(w, Math.max(reach, lift));
        out.glass.weight = lift;
        out.glass.position.copy(arm.target).add(new THREE.Vector3(0, -.06, .02));
        out.glass.tilt = smooth((p - .38) / .12) * (1 - smooth((p - .62) / .12)) * .75;
        out.lean += .04 * w;
      } else if (clip.kind === 'hair') {
        const brush = Math.sin(Math.min(1, p) * Math.PI);
        // Fingertips behind the ear, the elbow low and forward: a tuck, not a stretch.
        arm.target.set(head.x + side * .09, head.y - .03 - brush * .025, head.z + .07);
        arm.orientation.copy(q(.35, side * -1.3, side * -1.25));
        arm.bend = this.elbow[clip.side].set(side * .45, -.75, .5);
        arm.weight = w;
      } else if (clip.kind === 'laugh') {
        arm.target.set(this.mouth.x + side * .01, this.mouth.y - .005, this.mouth.z + .055);
        arm.orientation.copy(q(.05, side * -1.4, side * -.4));
        arm.bend = this.elbow[clip.side].set(side * .4, -.55, .73);
        arm.weight = w * .95;
        out.bounce = Math.sin(age * 22) * .004 * w;
        out.smile += .25 * w;
      } else if (clip.kind === 'phone') {
        // Phone low in the lap edge of the table, glanced at.
        arm.target.set(side * .06, head.y - .43, head.z + .29);
        arm.orientation.copy(q(-.55, side * .15, 0));
        arm.weight = w; out.phone = w > .5; out.lookDown = w;
        out.lean -= .02 * w;
      } else if (clip.kind === 'fidget') {
        // Turning the glass by its base, or straightening the cutlery: something to do with the hands.
        const at = input.glass ?? new THREE.Vector3(side * .2, .82, .42);
        arm.target.set(at.x * .6 + side * .02, .815, Math.min(.47, at.z - .04) + Math.sin(age * 3) * .01);
        arm.orientation.copy(q(-Math.PI / 2, side * .5, side * .1));
        arm.weight = w * .9;
      }
    }
    return out;
  }

  private play(kind: DateGesture, start: number, side: 0 | 1) {
    if (this.hold?.kind === 'think' && kind !== 'laugh') return;
    this.hold = null;
    this.clip = { kind, start, duration: DURATION[kind], side };
  }
}
