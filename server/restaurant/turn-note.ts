// What the date model reads each turn, as a short note a person could have written, instead of a database row.
// Everything here is deterministic server code: it adds no model call, no provider and no spend. The stored
// history keeps its JSON form because conversation-routing parses it; it is rendered for the model at send time.
import type { DinnerState, SceneUtterance, TurnVia } from '../../src/restaurant/types';
import type { RestaurantScenarioState } from '../../src/restaurant/scenario-types';
import { TRIMMED_NOTE, alternatingMessages, humanVoice, replyShapeHint, START_NOTE } from './dialogue-policy';

type Entry = { role: 'user' | 'assistant'; content: string };

/* ------------------------------------------------------------------ what was heard */

/** Edge neural speech runs about 160 words a minute; this only estimates how far a cut-off line got. */
const WORDS_PER_SECOND = 2.7;
/** A silence this long after the date's last line is worth telling the date about; shorter is just thinking or typing. */
export const QUIET_GAP_SECONDS = 20;

/** The words of a line a listener plausibly heard in `seconds`; empty when we cannot say anything useful. */
export function heardPrefix(text: string, seconds: number): string {
  const words = text.split(/\s+/).filter(Boolean), count = Math.min(words.length - 1, Math.max(1, Math.floor(seconds * WORDS_PER_SECOND)));
  return count > 0 ? words.slice(0, count).join(' ') : '';
}

/**
 * The stored delivery label for one line. The three leading phrases are matched elsewhere (tests and
 * conversation routing), so only the tail of the partial label carries the words-heard estimate.
 */
export function deliveryLabel(text: string, playback: { completed: boolean; playedSeconds: number } | undefined, interrupted: boolean): string {
  if (playback?.completed) return 'heard completely';
  if (playback?.playedSeconds) {
    const heard = heardPrefix(text, playback.playedSeconds);
    return heard ? `interrupted partway; they heard roughly “${heard}” and nothing after it; do not assume the rest was heard` : 'interrupted partway; do not assume the whole line was heard';
  }
  return interrupted ? 'not heard; response was interrupted' : 'awaiting playback; do not assume it was heard';
}

/* ------------------------------------------------------------------ history */

const speakerName = (speaker: string, dateName: string) => speaker === 'date' ? dateName : speaker === 'waiter' ? 'Eli (waiter)' : 'Neighbouring diner';
function heardNote(delivery: string, text: string, playedSeconds: unknown): string {
  if (delivery === 'heard completely') return '';
  if (delivery.startsWith('interrupted partway')) {
    const heard = typeof playedSeconds === 'number' ? heardPrefix(text, playedSeconds) : '';
    return heard ? ` (cut off: the human heard only “${heard}”)` : ' (cut off: the human heard only the start)';
  }
  return delivery.startsWith('awaiting') ? ' (still being said)' : ' (the human did not hear this)';
}

/**
 * The stored history is JSON so routing can read it; the model gets a plain transcript. Names replace
 * the internal speaker keys, and a delivery note appears only for lines that were not heard in full.
 */
export function renderHistory(history: readonly Entry[], dateName: string): Entry[] {
  return history.map(entry => {
    if (entry.role !== 'assistant') return entry;
    try {
      const lines: unknown = JSON.parse(entry.content)?.spokenResponse;
      if (!Array.isArray(lines)) return entry;
      return { role: 'assistant' as const, content: lines.map((line: { speaker: string; text: string; delivery: string; playedSeconds?: number }) => `${speakerName(line.speaker, dateName)}: ${line.text}${heardNote(line.delivery, line.text, line.playedSeconds)}`).join('\n') };
    } catch { return entry; }
  });
}

/** The message list the provider receives: the transcript so far, then this turn's note. */
export function conversationMessages(history: readonly Entry[], trimmed: boolean, dateName: string, note: string): Entry[] {
  const rendered = renderHistory(history, dateName);
  // Older entries were dropped: say so once, at the head of what remains, so it does not read as the start.
  const lead: Entry[] = trimmed && rendered[0]?.role === 'user' ? [{ role: 'user', content: TRIMMED_NOTE }] : [];
  return alternatingMessages([...lead, ...rendered, { role: 'user', content: note }], trimmed ? TRIMMED_NOTE : START_NOTE);
}

/* ------------------------------------------------------------------ what they are asking about */

const aboutYourLine = /\b(?:what\s+(?:do|did)\s+you\s+mean|what\s+does\s+that\s+mean|wait,?\s+what\b|(?:i\s+)?(?:don['’]?t|do\s+not)\s+(?:get|understand|follow)\b|what\s+are\s+you\s+talking\s+about|that['’]?s\s+(?:a\s+)?weird)|^\s*(?:huh|what)\s*\??\s*$/i;
const whatIsX = /\bwhat\s+(?:the\s+)?(?:(?:heck|hell)\s+)?(?:is|are|was|does)\s+(?:a\s+|an\s+|the\s+)?([\p{L}'’ -]{3,40})\??\s*$/iu;
const FILLER = new Set(['that', 'this', 'your', 'their', 'there', 'here', 'with', 'from', 'into', 'like', 'even', 'mean', 'just', 'really', 'about', 'what', 'have', 'does', 'supposed', 'going']);
const stem = (word: string) => word.replace(/s$/, '');
const wordsOf = (text: string) => text.toLowerCase().normalize('NFKC').match(/[\p{L}]{4,}/gu) ?? [];

/**
 * When the human asks "what do you mean?" or "what is cake gossip?", the thing they are asking about is
 * the date's own last line. A buried rule does not reliably make a small model look there, so say so next
 * to the question. Fires only on the date's last delivered line, never on an ordinary question.
 */
export function clarificationNudge(humanText: string, lastDateLine?: string): string {
  if (!lastDateLine) return '';
  const said = new Set(wordsOf(lastDateLine).map(stem));
  // "What is X like?" asks for a description of something; "what is X?" asks what the date's own word meant.
  const subject = whatIsX.exec(humanText)?.[1] ?? '', asked = /\blike\b/i.test(subject) ? [] : wordsOf(subject).filter(word => !FILLER.has(word));
  if (!aboutYourLine.test(humanText) && !asked.some(word => said.has(stem(word)))) return '';
  return `They seem to be asking about your last line (“${lastDateLine}”). Say plainly what you meant, or admit it was an odd thing to say, in one short sentence, then go back to what they were telling you.`;
}

/* ------------------------------------------------------------------ the note */

export interface AgendaPrompt { goal: string; naturalHint: string; rubric: Record<string, string>; nextMilestone: string | null; evidenceReady: boolean; confidence: string; heardClues: readonly string[] }
export interface BoundaryPrompt { boundaries: readonly { topic: string; refusal: string; delivered: boolean; disregardCount: number; pendingRefusal?: string }[] }
export interface TurnFlow {
  /** The human began speaking while the date was mid-line; `heard` is the part they probably caught. */
  talkedOver?: { heard: string };
  /** The date's previous reply never reached them before they spoke again. */
  keptTalking?: boolean;
  /** Seconds since the last line finished playing, when that was long. */
  quietSeconds?: number;
  /** A question the date asked (a scripted aside) that they have not answered yet. */
  pendingQuestion?: string | null;
  /** The date's last delivered line, for a clarification request. */
  lastDateLine?: string;
}
export interface TurnNoteInput {
  scene: DinnerState;
  dateName: string;
  humanText: string;
  via?: TurnVia;
  /** tableNow(scene, dateName), computed by the caller. */
  tableNow: string;
  memory: string;
  /** Facts the server recorded at the table (a toast, a taste, a scenario choice). */
  facts: readonly string[];
  agenda: AgendaPrompt;
  boundaries: BoundaryPrompt;
  /** Topics the date has been circling and should not raise again unprompted. */
  avoid: readonly string[];
  /** Compact view of the kitchen, staff and table care, if any. */
  mechanics?: Record<string, unknown>;
  scenario?: Pick<RestaurantScenarioState, 'phase' | 'description'>;
  /** The date's last few delivered lines, for reply-shape hints. */
  recentDelivered?: readonly SceneUtterance[];
  flow?: TurnFlow;
  human?: string;
}

const quote = (text: string) => `“${text}”`;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The natural hint is offered on the third human turn and every third after, or when asked directly. */
const asksWhatTheyWant = /\b(?:what (?:do|are) you (?:want|looking|hoping)|looking for|what brings you|what are you after|what do you want)\b/i;
export function hintTurn(dialogueTurns: number, humanText: string): boolean {
  return asksWhatTheyWant.test(humanText) || (dialogueTurns >= 2 && dialogueTurns % 3 === 2);
}

const EXTRA_STATUS: Record<string, string> = { pending: 'still cooking', served: 'on the table', shared: 'shared', cancelled: 'cancelled', boxed: 'boxed up' };
/** The kitchen, staff and table facts from scenarioMechanicsContext, in plain words. */
export function serviceFacts(mechanics: Record<string, unknown> | undefined, dateName: string): string[] {
  if (!mechanics) return [];
  const out: string[] = [], cleanup = mechanics.cleanup as { wine: string; glassesCleared: boolean } | undefined;
  if (mechanics.dinnerHeld) out.push('The kitchen is holding dinner for now.');
  if (mechanics.table === 'quiet') out.push('You have moved to a quieter part of the restaurant.');
  if (mechanics.staff === 'medical') out.push(`Eli and the staff are helping ${dateName} with a medical need.`);
  else if (mechanics.staff === 'safe-finish') out.push('Eli and the staff are helping bring the evening to a safe close.');
  if (mechanics.spaceCleared) out.push('The space around the table has been cleared.');
  if (mechanics.alcoholStopped) out.push('No more alcohol is being served.');
  if (mechanics.contactRequested) out.push('Someone has been contacted to help.');
  if (cleanup?.wine === 'wet') out.push('Spilled wine has not been cleaned up yet.');
  else if (cleanup?.wine === 'clean') out.push('The spilled wine has been cleaned up.');
  if (cleanup?.glassesCleared) out.push('The glasses have been cleared.');
  const extras = mechanics.extraOrder as { dish: string; quantity: number; status: string }[] | undefined;
  if (extras?.length) out.push(`${dateName} ordered extra dishes: ${extras.map(item => `${item.quantity} ${item.dish.toLowerCase()} (${EXTRA_STATUS[item.status] ?? item.status})`).join(', ')}.`);
  return out;
}

/** Only refusals that were actually heard are in force; a pending one is shown so it is not repeated as settled. */
function boundaryLines(context: BoundaryPrompt): string[] {
  return context.boundaries.map(item => {
    if (!item.delivered) return `- ${item.topic}: you started to say ${quote(item.pendingRefusal ?? item.refusal)}, but they have not heard it, so it is not in force yet.`;
    const times = item.disregardCount === 1 ? 'once' : `${item.disregardCount} times`;
    return `- ${item.topic}: they heard you say ${quote(item.refusal)}${item.disregardCount ? ` and have disregarded it ${times}` : ''}.`;
  });
}

function agendaLine(agenda: AgendaPrompt, showHint: boolean): string {
  const parts = [`Private, never say it aloud: ${agenda.goal}${showHint ? ` ${agenda.naturalHint}` : ''}`];
  if (agenda.heardClues.length) parts.push(`What they have already heard from you on this: ${agenda.heardClues.map(quote).join(' ')}`);
  if (agenda.confidence === 'earned') parts.push('They have earned your trust.');
  // The server discards a signal it cannot accept, so the rubric is shown only when one could count.
  if (agenda.nextMilestone && agenda.evidenceReady) parts.push(`You may now signal "${agenda.nextMilestone}" only if this turn earns it: ${agenda.rubric[agenda.nextMilestone]}`);
  return parts.join(' ');
}

/** The last question in a scripted line, which is what the human is answering. */
const lastQuestion = (text: string) => (text.match(/[^.!?]*\?/g) ?? []).map(item => item.trim()).filter(Boolean).at(-1) ?? clean(text).slice(0, 240);

/**
 * The whole per-turn message. Labelled sections appear only when they have content, in a fixed order, and
 * the human's words come last, followed by plain sentences about how they arrived.
 */
export function turnNote(input: TurnNoteInput): string {
  const { scene, dateName: date, human = 'the human', flow = {} } = input, e = scene.evening, say = (text: string) => humanVoice(text, date, human);
  const Human = human[0].toUpperCase() + human.slice(1), out: string[] = [];
  const now = [input.tableNow, ...serviceFacts(input.mechanics, date)];
  if (e.care.romanceClosed) now.push('Romance is closed tonight; stay friendly and do not flirt.');
  else if (e.chemistry?.unlocked) now.push(`Mutual chemistry is established between you and ${human}.`);
  out.push(`Right now: ${now.join(' ')}`);
  if (input.memory.trim()) out.push(`Your notes (rewrite them into "memory"):\n${input.memory.trim()}`);
  const facts = [...new Set([...e.moments.map(moment => moment.description), ...input.facts].map(say))].slice(-8);
  if (facts.length) out.push(`At the table so far (facts):\n${facts.map(fact => `- ${fact}`).join('\n')}`);
  if (input.scenario?.phase === 'active') out.push(`Happening now: ${say(input.scenario.description)}`);
  out.push(agendaLine(input.agenda, hintTurn(e.dialogueTurns, input.humanText)));
  const boundaries = boundaryLines(input.boundaries);
  if (boundaries.length) out.push(`Boundaries in play:\n${boundaries.join('\n')}`);
  if (input.avoid.length) out.push(`Do not bring up unprompted: ${input.avoid.join(', ')}.`);
  if (input.via === 'voice') out.push('They said this out loud; it is an automatic transcript from a small on-device recognizer and can contain mishearings.');
  const after: string[] = [];
  // Typing is not talking: only the spoken case says they talked over the date or kept going. A typed answer that
  // arrives while the date is mid-line replies over them, and a typed answer to a line never played is just an answer.
  const overlap = input.via === 'typed' ? 'They replied' : 'They started talking';
  if (flow.talkedOver) after.push(flow.talkedOver.heard ? `${overlap} while you were still speaking; you were cut off after ${quote(flow.talkedOver.heard)}.` : `${overlap} while you were still speaking, right at the start of your line.`);
  if (flow.keptTalking && input.via !== 'typed') after.push('They kept talking before your last reply reached them; treat this as the continuation of their previous message.');
  if (flow.quietSeconds) after.push(`It was quiet for ${flow.quietSeconds < 60 ? `about ${flow.quietSeconds} seconds` : flow.quietSeconds < 150 ? 'a minute or two' : 'a long while'} after your last line before they spoke.`);
  if (flow.pendingQuestion) after.push(`You had just asked them ${quote(lastQuestion(flow.pendingQuestion))} and were waiting for the answer. What they say next is most likely that answer unless it clearly changes the subject.`);
  const nudge = clarificationNudge(input.humanText, flow.lastDateLine);
  if (nudge) after.push(nudge);
  const shape = replyShapeHint(input.recentDelivered ?? [], input.humanText);
  if (shape) after.push(shape);
  out.push([`${Human} just said: ${quote(clean(input.humanText))}`, ...after].join('\n'));
  return out.join('\n\n');
}
