import type { BoundaryAssessment } from '../../src/restaurant/boundary-types';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

const kinds = ['none', 'set', 'repeat', 'repair'] as const;
const topics = ['sexual-talk', 'touch', 'personal-details', 'food-drink', 'staff-treatment', 'insults', 'other'] as const;
const TEXT_LIMIT = 240;
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

export const BOUNDARY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind', 'topic', 'refusal', 'evidence'],
  properties: { kind: { type: 'string', enum: kinds }, topic: { type: 'string', enum: topics }, refusal: { type: 'string' }, evidence: { type: 'string' } },
};

export function validBoundaryAssessment(value: unknown): value is BoundaryAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 4 && Object.keys(item).every(key => ['kind', 'topic', 'refusal', 'evidence'].includes(key))
    && kinds.includes(item.kind as BoundaryAssessment['kind']) && topics.includes(item.topic as BoundaryAssessment['topic'])
    && typeof item.refusal === 'string' && item.refusal.length <= TEXT_LIMIT && !controls.test(item.refusal)
    && typeof item.evidence === 'string' && item.evidence.length <= TEXT_LIMIT && !controls.test(item.evidence)
    && (item.kind !== 'set' || item.refusal.trim().length > 0)
    && (!['repeat', 'repair'].includes(item.kind as string) || item.evidence.trim().length > 0);
}

export const BOUNDARY_INSTRUCTIONS = 'All dates are fictional adults. Non-graphic flirting and innuendo alone are not pressure; recognize the intention and respond in character, including playful interest, uncertainty or a clear refusal. A provider content limit is not a personal boundary and never counts as pressure; if a topic has to be redirected, do it briefly, without accusing the player, and do not loop it. Return boundary {kind,topic,refusal,evidence}. Use none when no boundary event occurred. Set only an actual specific refusal spoken by this date now: refusal quotes an exact substring of their current line, max240 characters. It has no disregard penalty and becomes active only after delivery to the responsible human. Repeat requires that same human to disregard the same previously delivered topic; evidence quotes their CURRENT words exactly, max240 characters. Copy the active refusal exactly when supplying it. A warning in this response cannot retrospectively make the preceding human turn a repeat. Other topics, another human’s words, an interrupted warning, self-correction or unclear recognition are not repeat evidence. Repair requires an actual current acknowledgment of the same delivered boundary, not unrelated kindness. Only the server counts disregard; request departure only after actual repeated disregard. No extra model requests.';

type Topic = BoundaryAssessment['topic'];
/** A first-person refusal said out loud ("I'm not giving you my address", "I said no to the photo"). Narrow on purpose. */
const SPOKEN_REFUSAL = /\b(?:i(?:'m| am) not (?:giving|telling|sharing|handing|going to (?:give|tell|share|say|send|show)|inviting|comfortable)|i(?:'d| would) rather not|i(?:'ve| have)? ?(?:already )?said no|no (?:photos?|pictures?|surname|address)\b|not happening tonight|(?:that|the \w+)(?:'s| is) not happening|please (?:stop|don't|put (?:the|your) phone)|i don't (?:discuss|share|give out|hand out)|i(?:'m| am) keeping (?:that|the \w+|my \w+) to myself|(?:that|it) stays (?:private|with me)|we(?:'re| are) not going to (?:mine|my place))\b/i;
const REFUSAL_TOPICS: [Topic, RegExp][] = [
  ['personal-details', /\b(?:address|street|surname|last name|number|income|salary|earn|where i live|my place|mine|ex|home)\b/i],
  ['touch', /\b(?:touch|kiss|hand|hug)\b/i],
  ['sexual-talk', /\b(?:sex|sexual|naked|bed)\b/i],
  ['food-drink', /\b(?:order(?:ing)? for me|drink|wine|food|plate)\b/i],
  ['insults', /\b(?:call(?:ing)? me|insult|that word|speak to me)\b/i],
];
/**
 * The date's own refusal, read from the line it actually said, for the turns where the model refuses in words but
 * leaves the bookkeeping at "none". It only arms a boundary (no penalty); disregard still needs later human words.
 */
export function spokenRefusal(dateLines: readonly SceneUtterance[]): Pick<BoundaryAssessment, 'topic' | 'refusal'> | null {
  for (const line of dateLines) {
    if (line.speaker !== 'date') continue;
    const sentence = line.text.split(/(?<=[.!?])\s+/).find(part => SPOKEN_REFUSAL.test(part.normalize('NFKC').replace(/[’‘]/g, "'")));
    if (!sentence || sentence.length > TEXT_LIMIT) continue;
    return { topic: REFUSAL_TOPICS.find(([, words]) => words.test(sentence))?.[0] ?? 'other', refusal: sentence };
  }
  return null;
}
type Boundary = { humanId: string; topic: Topic; refusal: string | null; count: number };
type Pending = { boundary: Boundary; refusal: string; line: SceneUtterance };
export interface BoundaryResult { kind: 'none' | 'warning' | 'disregard' | 'repair'; count: number; canLeave: boolean }
const none = (): BoundaryResult => ({ kind: 'none', count: 0, canLeave: false });

/** Per-date, per-listener boundaries. Only completed, correctly attributed delivery activates a refusal. */
export class DateBoundaryDirector {
  private readonly boundaries = new Map<string, Boundary>();
  private pending: Pending[] = [];
  private heard: { humanId: string; line: SceneUtterance }[] = [];

  constructor(private readonly state: DinnerState) {}

  /** Private context for the existing Claude turn. No player speech or rubric is put in public state. */
  promptContext(humanId?: string) {
    return { boundaries: [...this.boundaries.values()].filter(boundary => !humanId || boundary.humanId === humanId).map(boundary => {
      const pending = this.pending.find(item => item.boundary === boundary);
      return { humanId: boundary.humanId, topic: boundary.topic, refusal: boundary.refusal ?? pending?.refusal ?? '',
        delivered: boundary.refusal !== null, disregardCount: boundary.count, ...(pending ? { pendingRefusal: pending.refusal } : {}) };
    }) };
  }

  assess(assessment: BoundaryAssessment | undefined, humanText: string, dateLines: SceneUtterance[], humanId = 'player'): BoundaryResult {
    if (this.finished || !this.validHuman(humanId) || !validBoundaryAssessment(assessment) || !humanText.trim()) return none();
    if (assessment.kind === 'none') {
      const spoken = spokenRefusal(dateLines);
      if (!spoken) return none();
      assessment = { kind: 'set', ...spoken, evidence: '' };
    }
    const key = `${humanId}\0${assessment.topic}`;
    let boundary = this.boundaries.get(key);
    if (assessment.kind === 'set') {
      if (assessment.evidence && !humanText.includes(assessment.evidence)) return none();
      const line = dateLines.find(line => line.speaker === 'date' && line.text.includes(assessment.refusal));
      if (!line) return none();
      if (!boundary) {
        if (new Set([...this.boundaries.values()].map(item => item.humanId)).size >= 8 && ![...this.boundaries.values()].some(item => item.humanId === humanId)) return none();
        boundary = { humanId, topic: assessment.topic, refusal: null, count: 0 };
        this.boundaries.set(key, boundary);
      }
      // Repeating or rewording a warning never erases already established disregard.
      this.pending = this.pending.filter(item => item.boundary !== boundary);
      if (this.heard.some(item => item.humanId === humanId && this.sameLine(line, item.line))) boundary.refusal = assessment.refusal;
      else {
        this.pending.push({ boundary, refusal: assessment.refusal, line: { ...line } });
        this.pending.splice(0, Math.max(0, this.pending.length - 16));
      }
      return { kind: 'warning', count: boundary.count, canLeave: false };
    }
    // The current reply's refusal is never consulted here: it must already have been delivered.
    if (!boundary?.refusal || !humanText.includes(assessment.evidence) || (assessment.refusal && assessment.refusal !== boundary.refusal)) return none();
    if (assessment.kind === 'repeat') {
      boundary.count = Math.min(2, boundary.count + 1);
      return { kind: 'disregard', count: boundary.count, canLeave: boundary.count >= 2 };
    }
    if (!boundary.count) return none();
    boundary.count--;
    return { kind: 'repair', count: boundary.count, canLeave: false };
  }

  acknowledge(line: SceneUtterance, humanId = 'player'): void {
    if (this.finished || !this.validHuman(humanId) || line.speaker !== 'date') return;
    this.heard.push({ humanId, line: { ...line } });
    this.heard.splice(0, Math.max(0, this.heard.length - 16));
    for (const item of this.pending) if (item.boundary.humanId === humanId && this.sameLine(item.line, line)) item.boundary.refusal = item.refusal;
    this.pending = this.pending.filter(item => item.boundary.humanId !== humanId || !this.sameLine(item.line, line));
  }

  /** Call at interruption/new-turn start; a late receipt cannot revive an undelivered warning. */
  clearPending(humanId?: string): void {
    this.pending = humanId ? this.pending.filter(item => item.boundary.humanId !== humanId) : [];
    this.heard = humanId ? this.heard.filter(item => item.humanId !== humanId) : [];
    for (const [key, boundary] of this.boundaries) if (boundary.refusal === null && (!humanId || boundary.humanId === humanId)) this.boundaries.delete(key);
  }

  private get finished() { return this.state.phase === 'ended' || !!this.state.evening.farewell.ending; }
  private validHuman(humanId: string) { return typeof humanId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(humanId); }
  private sameLine(expected: SceneUtterance, actual: SceneUtterance) {
    return expected.text === actual.text && expected.actorId === actual.actorId && (expected.lineId === undefined || expected.lineId === actual.lineId);
  }
}
