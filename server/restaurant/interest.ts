import type { DateInterest, DinnerState, Emotion, SceneTurn } from '../../src/restaurant/types';
import { hasEarnedConfidence } from './skepticism';

type BoundaryEvent = 'none' | 'warning' | 'disregard' | 'repair' | string;

/**
 * How each delivered feeling nudges the date's visible interest. Small on purpose: one charming
 * line moves the needle a little, a whole warm exchange moves it a lot.
 */
const EMOTION_STEP: Record<Emotion, number> = {
  flirtatious: 6, amused: 5, warm: 4, embarrassed: 2, surprised: 1, neutral: 0, annoyed: -6, defensive: -8, angry: -12,
};
const SIGNAL_STEP: Record<string, number> = { kindness: 3, curiosity: 3, humor: 3, repair: 2, pressure: -8, none: 0 };
/** Seconds of the human saying nothing at a calm table before the date's attention starts to wander… */
export const INTEREST_IDLE_AFTER = 90;
/** …and how often it slips one point after that, never below the floor. */
export const INTEREST_IDLE_EVERY = 12;
const IDLE_FLOOR = 20;

/**
 * A presentation read-out of how into the evening the date seems, 0..100, from signals the server
 * already owns: the feelings in lines the date delivered, the model's social signal, agenda steps and
 * reciprocal chemistry, boundaries, and long stretches of the human saying nothing.
 *
 * It is never an input to anything: not to the prompt, chemistry, routing, boundaries or endings.
 * It earns nothing from food, cleaning, spending, fidgeting or scenario choices. Its ceiling follows
 * the stance and earned confidence, so it cannot run ahead of what the evening actually established.
 */
export class DateInterestDirector {
  private readonly interest: DateInterest;
  private milestones = 0;
  private unlocked = false;
  private idleAt = 0;

  constructor(private readonly state: DinnerState, opening: number) {
    this.interest = { level: Math.round(opening), trend: 0, changedAt: 0 };
    state.evening.interest = this.interest;
  }

  /** A completed conversation turn. A friend's turn (Double, `paired: false`) can only cool things, at half weight. */
  observe(turn: SceneTurn, options: { paired: boolean; boundary: BoundaryEvent }) {
    const dateLines = turn.utterances.filter(line => line.speaker === 'date' && line.text.trim());
    let delta = 0;
    if (dateLines.length) {
      const steps = dateLines.map(line => EMOTION_STEP[line.emotion] ?? 0);
      const low = Math.min(...steps), high = Math.max(...steps);
      // A mixed reply (a smile, then a wince) counts the wince.
      delta += low < 0 ? low : high;
    }
    delta += SIGNAL_STEP[turn.social?.signal ?? 'none'] ?? 0;
    if (options.boundary === 'warning') delta -= 6;
    if (options.boundary === 'disregard') delta -= 20;
    if (turn.social?.wantsToLeave) delta -= 30;
    if (!options.paired) delta = Math.min(0, delta) / 2;
    this.apply(delta);
  }

  /** Agenda steps and chemistry can land on a later delivery receipt, so both are read whenever they may have changed. */
  noticeProgress() {
    const evening = this.state.evening;
    const milestones = evening.agenda?.milestones.length ?? 0, unlocked = !!evening.chemistry?.unlocked;
    let delta = 0;
    if (milestones > this.milestones) delta += 5 * (milestones - this.milestones);
    if (unlocked && !this.unlocked) delta += 8;
    this.milestones = milestones; this.unlocked = unlocked;
    if (delta) this.apply(delta); else this.clampToStance();
  }

  /**
   * Scene time. A human who has said nothing for a long while at a calm table loses a little of the
   * date's attention, unless this date said they like quiet or asked to slow down.
   */
  step(quietFor: number, options: { calm: boolean; likesQuiet: boolean; quietRequested: boolean }) {
    if (!options.calm || options.likesQuiet || options.quietRequested || quietFor < INTEREST_IDLE_AFTER) { this.idleAt = 0; this.clampToStance(); return; }
    const t = this.state.elapsed;
    if (!this.idleAt) { this.idleAt = t; return; }
    if (t - this.idleAt >= INTEREST_IDLE_EVERY) {
      this.idleAt = t;
      if (this.interest.level > IDLE_FLOOR) this.apply(-1, false);
    }
  }

  private ceiling() {
    const evening = this.state.evening;
    if (evening.stance === 'leaving') return 0;
    if (evening.stance === 'hurt') return 15;
    if (evening.stance === 'guarded') return 30;
    // Liking someone's company without trusting them yet; friendship is warm but not a spark.
    let ceiling = hasEarnedConfidence(evening.agenda) ? 100 : 72;
    if (evening.care.romanceClosed) ceiling = Math.min(ceiling, 60);
    return ceiling;
  }

  private clampToStance() {
    const capped = Math.min(this.interest.level, this.ceiling());
    if (capped !== this.interest.level) this.set(capped, -1);
  }

  private apply(delta: number, scaled = true) {
    const level = this.interest.level;
    // Warming gets slower near the top; cooling is felt in full.
    const change = delta > 0 && scaled ? delta * Math.max(.25, 1 - level / 110) : delta;
    const next = Math.max(0, Math.min(this.ceiling(), Math.round(level + change)));
    if (next === level) { this.clampToStance(); return; }
    this.set(next, next > level ? 1 : -1);
  }

  private set(level: number, trend: -1 | 1) {
    this.interest.level = level;
    this.interest.trend = trend;
    this.interest.changedAt = this.state.elapsed;
  }
}

/** Where a date starts: polite curiosity, a little warmer for an easy talker, slower for a slow burn. */
export function openingInterest(state: DinnerState, openness?: number): number {
  if (typeof openness === 'number') return 24 + Math.max(0, Math.min(100, openness)) * .14;
  return ({ mira: 34, jules: 24, dev: 32 } as const)[state.dateId] ?? 30;
}
