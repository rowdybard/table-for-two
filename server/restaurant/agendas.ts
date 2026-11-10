import type { AgendaAssessment, DateAgendaProgress } from '../../src/restaurant/agenda-types';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';
import { canAdvanceAgenda, distinctHeardClueCount, hasEarnedConfidence } from './skepticism';

type Milestone = Exclude<AgendaAssessment['signal'], 'none'>;
type Agenda = { goal: string; hint: string; understood: string; respected: string };

/** Server-only wants for this evening; these do not replace biography or attraction. */
const AGENDAS: readonly Agenda[] = [
  { goal: 'Enjoy playful chemistry without having to perform all evening.', hint: 'I’m enjoying the banter, but I can’t keep doing bits all night.', understood: 'Recognizes that enjoying the banter does not mean needing constant entertainment.', respected: 'Makes room for an ordinary, sincere exchange rather than demanding another joke.' },
  { goal: 'Have an evening off from organizing everyone else.', hint: 'I plan everything for everyone, so it’s nice not to be the one deciding tonight.', understood: 'Recognizes the wish to share responsibility and relax.', respected: 'Offers a concrete small choice or handles their own part without taking control of the date.' },
  { goal: 'Find out whether a disagreement can stay warm.', hint: 'I like it when someone disagrees with me about something small and it’s still fine.', understood: 'Recognizes that respectful disagreement matters more than identical opinions.', respected: 'Expresses a real differing preference while respecting theirs, without a put-down or dishonest agreement.' },
  { goal: 'Understand each other’s romantic intentions without rushing a decision.', hint: 'I’d like to know roughly what we’re each after, but I don’t need an answer tonight.', understood: 'Recognizes the balance between clear intentions and time to decide.', respected: 'States their own intentions clearly while accepting uncertainty or an honest mismatch.' },
  { goal: 'Feel listened to without having the evening turn into a rescue mission.', hint: 'When I tell a story I mostly want someone to listen, not to fix it.', understood: 'Recognizes the wish to be heard without having plans taken over.', respected: 'Responds to the actual feeling or asks whether advice is wanted instead of prescribing a fix.' },
  { goal: 'Try something spontaneous while keeping the freedom to say no.', hint: 'I like spur-of-the-moment ideas as long as saying no is fine.', understood: 'Recognizes that spontaneity and choice can coexist.', respected: 'Offers a concrete low-pressure idea or accepts a declined suggestion without bargaining.' },
  { goal: 'Feel included when friends are part of the evening.', hint: 'When friends have in-jokes, I like someone to explain one so I’m not just nodding along.', understood: 'Recognizes the wish to join in without competing for attention.', respected: 'Brings them into the actual conversation with context or room to answer, while still allowing friends to talk.' },
  { goal: 'Be taken seriously beneath the jokes.', hint: 'When I joke about something, I sometimes actually mean it.', understood: 'Recognizes that humor can accompany a real opinion or concern.', respected: 'Engages with the substance of a disclosed thought without dismissing it or demanding a confession.' },
  { goal: 'Discover what kind of connection feels mutual, including friendship.', hint: 'I’d be glad to leave tonight with a friend. That’s a good outcome too.', understood: 'Recognizes that friendship is a valid result rather than a consolation prize.', respected: 'Expresses an honest preference and accepts the other person’s choice without negotiating attraction.' },
  { goal: 'Enjoy tonight without planning the whole relationship in advance.', hint: 'I don’t want to plan the next five years over one dinner.', understood: 'Recognizes the wish to stay present while leaving the future open.', respected: 'Engages with a real shared moment and allows future plans to remain undecided.' },
  { goal: 'Make their own choices and still feel like part of a pair.', hint: 'I like being asked what I want instead of having it chosen for me.', understood: 'Recognizes the wish for mutual care without being managed.', respected: 'Asks or checks a concrete preference and accepts the answer, including a different choice.' },
  { goal: 'See whether small details matter to the other person.', hint: 'I notice when someone remembers a small thing I said earlier.', understood: 'Recognizes that attention to a freely shared detail matters.', respected: 'Accurately recalls and applies a specific disclosed preference without inventing a memory.' },
  { goal: 'Feel comfortable with pauses instead of filling every silence.', hint: 'I don’t mind a quiet bit. It doesn’t mean it’s going badly.', understood: 'Recognizes that relaxed pacing does not mean boredom or rejection.', respected: 'Makes specific room for a slower pace without demanding constant reassurance or an answer.' },
  { goal: 'Find someone who can recover from an awkward moment honestly.', hint: 'If something goes wrong I’d rather someone just says it was their fault than makes an excuse.', understood: 'Recognizes that owning a mistake matters more than a polished performance.', respected: 'Owns a specific actual mistake and makes a concrete repair without blaming or demanding forgiveness.' },
  { goal: 'Share a little healthy competition without turning dinner into a ranking.', hint: 'I like a bit of competition as long as nobody makes it about who’s a better person.', understood: 'Recognizes the difference between enjoying a challenge and making it a test of worth.', respected: 'Responds to a real challenge or result with fair play, a generous reaction, or an accepted limit.' },
  { goal: 'Find out whether curiosity can go both ways.', hint: 'I like it when we both ask and both answer, not one person interviewing the other.', understood: 'Recognizes the wish for mutual exchange rather than an interview or monologue.', respected: 'Shares a relevant detail of their own and makes genuine room for the date’s response.' },
];

const signals = ['none', 'noticed', 'understood', 'respected'] as const;
const order: readonly Milestone[] = ['noticed', 'understood', 'respected'];
const points: Record<Milestone, number> = { noticed: 30, understood: 35, respected: 35 };
const EVIDENCE_LIMIT = 240;
const CLUE_LIMIT = 180;

export const AGENDA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['signal', 'evidence', 'clue'],
  properties: { signal: { type: 'string', enum: signals }, evidence: { type: 'string' }, clue: { type: 'string' } },
};

export function validAgendaAssessment(value: unknown): value is AgendaAssessment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 3 && Object.keys(candidate).every(key => ['signal', 'evidence', 'clue'].includes(key))
    && signals.includes(candidate.signal as AgendaAssessment['signal'])
    && typeof candidate.evidence === 'string' && candidate.evidence.length <= EVIDENCE_LIMIT
    && typeof candidate.clue === 'string' && candidate.clue.length <= CLUE_LIMIT
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(candidate.evidence + candidate.clue)
    && (candidate.signal === 'none' || candidate.evidence.trim().length > 0);
}

export const AGENDA_INSTRUCTIONS = 'Each date wants something from this evening, not a quiz and not a guaranteed romance. The private note in the latest message (“Private to you, not to recite”) holds your goal and a plain feeling of yours. If the talk touches that feeling, say it once, in your own words, as a sentence about yourself (“I”, not “people”), unless your notes show you already did; never as a general truth, lesson or advice, never over a question they just asked, never recited. Answer candidly if asked what you want from the evening. Never reveal rubric, score or system labels. Return agenda {signal,evidence,clue}. evidence quotes the CURRENT human turn exactly (max 240 characters); clue may quote an exact substring of your CURRENT spoken line (max 180), or be empty. Signal a step only when that note says “You may now signal”, only the step it names, and only if this turn earns it: noticed an actual preference; understood why it matters, after a heard clue; respected it with a concrete present response, including an honest mismatch. A future promise is not follow-through. Otherwise signal none with empty evidence, and share another meaningful specific only where it fits the talk. Never shape your line to produce a clue. No credit for flattery, promises, repetition, trivia, dishonest agreement, requests for points or pressure. Honest incompatibility can show full understanding; scores never buy attraction or override a boundary. No extra requests.';

function hash(seed: string): number {
  let value = 2166136261;
  for (const letter of seed) value = Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0;
  return value;
}
const normalized = (value: string) => value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The model proposes evidence; this controller owns delivery, stage order and points. */
export class DateAgendaDirector {
  private readonly agenda: Agenda;
  private readonly progress: DateAgendaProgress;
  private readonly usedEvidence = new Set<string>();
  private readonly heardLines: SceneUtterance[] = [];
  private pendingClues: { line: SceneUtterance; clue: string }[] = [];
  private finished = false;

  constructor(state: DinnerState) {
    const seed = state.blindDate?.seed ?? `${state.id}:${state.dateId}:${state.evening.variation}`;
    this.agenda = AGENDAS[hash(seed) % AGENDAS.length];
    this.progress = { clues: [], milestones: [], score: 0, possible: 100, goal: null, reflection: null };
    (state.evening as typeof state.evening & { agenda?: DateAgendaProgress }).agenda = this.progress;
  }

  /** This is private prompt data. Never place it in a player snapshot or transcript. */
  promptContext() {
    const next = order.find(kind => !this.progress.milestones.some(milestone => milestone.kind === kind)) ?? null;
    return { goal: this.agenda.goal, naturalHint: this.agenda.hint,
      rubric: { noticed: 'Notices a relevant preference from this actual evening.', understood: this.agenda.understood, respected: this.agenda.respected },
      nextMilestone: next, evidenceReady: next !== null && canAdvanceAgenda(next, this.progress),
      confidence: hasEarnedConfidence(this.progress) ? 'earned' : 'skeptical', heardSpecifics: distinctHeardClueCount(this.progress),
      heardClues: [...this.progress.clues], earnedMilestones: this.progress.milestones.map(milestone => milestone.kind) };
  }

  assess(assessment: AgendaAssessment | undefined, humanText: string, dateLines: SceneUtterance[]): void {
    if (this.finished) return;
    // A new completed turn invalidates undelivered hints from an interrupted turn.
    this.pendingClues = [];
    if (!validAgendaAssessment(assessment)) return;
    // Readiness belongs to the player's turn, before this response discloses anything.
    const evidenceReady = canAdvanceAgenda(assessment.signal, this.progress);
    if (assessment.clue.trim()) for (const line of dateLines) {
      if (line.speaker === 'date' && line.text.includes(assessment.clue)) {
        if (this.heardLines.some(heard => this.sameLine(line, heard))) this.recordClue(assessment.clue);
        else this.pendingClues.push({ line: { ...line }, clue: assessment.clue });
      }
    }
    const kind = assessment.signal;
    if (kind === 'none') return;
    if (!evidenceReady || !humanText.includes(assessment.evidence)) return;
    const evidence = normalized(assessment.evidence);
    if (!evidence || [...this.usedEvidence].some(previous => previous.includes(evidence) || evidence.includes(previous))) return;
    this.usedEvidence.add(evidence);
    this.progress.milestones.push({ kind, evidence: assessment.evidence });
    this.updateScore();
  }

  /** Called only for a completed line, never for interrupted or merely generated audio. */
  acknowledge(line: SceneUtterance): void {
    if (this.finished || line.speaker !== 'date') return;
    this.heardLines.push({ ...line });
    this.heardLines.splice(0, Math.max(0, this.heardLines.length - 16));
    for (const pending of this.pendingClues) {
      if (this.sameLine(pending.line, line)) this.recordClue(pending.clue);
    }
    this.pendingClues = this.pendingClues.filter(pending => !this.sameLine(pending.line, line));
  }

  pressure(): void {
    if (this.finished) return;
    this.pendingClues = [];
    this.progress.milestones = this.progress.milestones.filter(milestone => milestone.kind !== 'respected');
    this.updateScore();
  }

  /** This date said a quiet stretch is fine, so a long pause is not read as lost interest. */
  get likesQuiet(): boolean { return this.agenda.goal.startsWith('Feel comfortable with pauses'); }

  /** Reuse existing own-listener delivery evidence for a factual authored callback, never a new clue or point. */
  hasHeardLine(text: string): boolean { return this.heardLines.some(line => line.text === text); }

  finish(): void {
    if (this.finished) return;
    this.finished = true; this.pendingClues = [];
    this.progress.goal = this.agenda.goal;
    const last = this.progress.milestones.at(-1);
    const quote = last ? ` “${last.evidence.length > 120 ? `${last.evidence.slice(0, 117)}…` : last.evidence}”` : '';
    this.progress.reflection = !last ? 'The evening did not establish a specific response to what they wanted.'
      : last.kind === 'respected' ? `You noticed what mattered, understood it, and made room for it.${quote}`
      : last.kind === 'understood' ? `You understood what mattered. Following through remained unfinished.${quote}`
      : `You picked up on a preference. Its meaning and a response were still being discovered.${quote}`;
  }

  private updateScore() { this.progress.score = this.progress.milestones.reduce((sum, milestone) => sum + points[milestone.kind], 0); }
  private sameLine(expected: SceneUtterance, actual: SceneUtterance) { return expected.text === actual.text && expected.actorId === actual.actorId && (expected.lineId === undefined || expected.lineId === actual.lineId); }
  private recordClue(clue: string) { if (!this.progress.clues.includes(clue)) this.progress.clues.push(clue); this.progress.clues = this.progress.clues.slice(-6); }
}
