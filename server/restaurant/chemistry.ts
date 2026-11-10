import type { DinnerState, SceneTurn, SceneUtterance } from '../../src/restaurant/types';
import { hasEarnedConfidence } from './skepticism';
import { scenePresenceAvailable } from '../../src/restaurant/scenario-care';

type BoundaryEvent = 'none' | 'warning' | 'disregard' | 'repair';
type Moment = { generation: number; human: string; date: string };
type Candidate = { generation: number; human: string; lines: SceneUtterance[] };
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const reused = (value: string, previous: string) => value === previous || value.includes(previous) || previous.includes(value);

/** Reciprocal, delivered interest unlocks a provider; player claims and raw scores cannot. */
export class DateChemistryDirector {
  private readonly moments: Moment[] = [];
  private candidate?: Candidate;
  private heard: { generation: number; line: SceneUtterance }[] = [];
  private readonly progress: { readonly unlocked: boolean };

  constructor(private readonly state: DinnerState) {
    const controller = this;
    // Snapshots serialize the current eligibility. A later friendship decision or
    // farewell cannot leave a stale true flag in public state between turns.
    this.progress = { get unlocked() { return controller.eligible && controller.moments.length >= 2; } };
    (state.evening as typeof state.evening & { chemistry?: { unlocked: boolean } }).chemistry = this.progress;
  }

  get unlocked(): boolean { return this.progress.unlocked; }

  observe(turn: SceneTurn, humanText: string, options: { paired?: boolean; boundaryEvent?: BoundaryEvent } = {}): void {
    this.candidate = undefined;
    if (options.paired === false || options.boundaryEvent === 'warning' || options.boundaryEvent === 'disregard' || !this.eligible) return;
    // A refusal is not reciprocal interest even if an emotional tag is mistaken.
    if (turn.social?.wantsToLeave || turn.social?.boundary?.kind === 'set' || turn.social?.boundary?.kind === 'repeat') return;
    if (!Number.isSafeInteger(this.state.generation) || this.state.generation < 0 || typeof humanText !== 'string' || humanText.length > 2000) return;
    const human = normalized(humanText);
    if (human.split(' ').filter(Boolean).length < 3 || this.moments.some(moment => moment.generation === this.state.generation || reused(human, moment.human))) return;
    const lines = turn.utterances.filter(line => line.speaker === 'date' && line.emotion === 'flirtatious' && line.text.trim()
      && !this.moments.some(moment => reused(normalized(line.text), moment.date))).map(line => ({ ...line }));
    if (!lines.length) return;
    this.candidate = { generation: this.state.generation, human, lines };
    for (const receipt of this.heard) if (receipt.generation === this.state.generation && lines.some(line => this.sameLine(line, receipt.line))) {
      this.accept(receipt.line); break;
    }
  }

  /** The owner calls this for a completed receipt from the paired listener only. */
  acknowledge(line: SceneUtterance): void {
    // Completion can beat the enclosing JSON's final trust update. Cache it for
    // this generation; observe/accept still require earned confidence afterward.
    if (this.state.phase !== 'playing' || this.state.evening.farewell.ending || this.state.evening.care.romanceClosed || line.speaker !== 'date' || line.emotion !== 'flirtatious') return;
    this.heard.push({ generation: this.state.generation, line: { ...line } });
    this.heard.splice(0, Math.max(0, this.heard.length - 16));
    if (this.candidate?.generation === this.state.generation && this.candidate.lines.some(expected => this.sameLine(expected, line))) this.accept(line);
  }

  /** New turns and interruptions discard unfinished delivery, while earned moments remain. */
  clearPending(): void { this.candidate = undefined; this.heard = []; }

  /** Accepted disregard removes access; a repair must earn fresh reciprocal moments. */
  revoke(): void { this.clearPending(); this.moments.length = 0; }

  private get eligible(): boolean {
    const evening = this.state.evening;
    return scenePresenceAvailable(this.state) && !evening.care.romanceClosed
      && evening.stance !== 'leaving' && evening.stance !== 'hurt' && evening.stance !== 'guarded'
      ;
  }

  private accept(line: SceneUtterance): void {
    const candidate = this.candidate;
    if (!candidate || candidate.generation !== this.state.generation || !this.eligible) return;
    const date = normalized(line.text);
    if (this.moments.some(moment => moment.generation === candidate.generation || reused(candidate.human, moment.human) || reused(date, moment.date))) return;
    this.moments.push({ generation: candidate.generation, human: candidate.human, date });
    this.moments.splice(0, Math.max(0, this.moments.length - 2));
    this.candidate = undefined;
  }

  private sameLine(expected: SceneUtterance, actual: SceneUtterance): boolean {
    return expected.speaker === actual.speaker && expected.emotion === actual.emotion && expected.text === actual.text
      && expected.actorId === actual.actorId && (expected.lineId === undefined || expected.lineId === actual.lineId);
  }
}
