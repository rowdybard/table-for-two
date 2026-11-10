// What the date model reads each turn, as a short note a person could have written, instead of a database row.
// Everything here is deterministic server code: it adds no model call, no provider and no spend. The stored
// history keeps its JSON form because conversation-routing parses it; it is rendered for the model at send time.
import type { DinnerState, SceneUtterance, TurnVia } from '../../src/restaurant/types';
import type { RestaurantScenarioState } from '../../src/restaurant/scenario-types';
import { TRIMMED_NOTE, alternatingMessages, humanVoice, replyShapeHint, START_NOTE } from './dialogue-policy';
import { createBlindDate } from '../../src/restaurant/blind-date';
import { conversationContentNote } from '../../src/restaurant/conversation-content';

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

const squash = (text: string) => text.toLowerCase().normalize('NFKC').replace(/[’‘`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/(^| )'+|'+(?= |$)/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (word: string) => word.replace(/s$/, '');
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Interjections, softeners and endearments that can sit around the question without changing what it asks. */
const LEAD_WORDS = 'um+|uh+|hm+|mm+|oh+|ah+|huh|ha+|haha|lol|lmao|wait|hold on|hang on|sorry|okay|ok|well|no|yeah|yes|like|hey|hi|wow|ugh|so|and|but|please|actually|honestly|seriously|really|dude|man|babe|honey|hon|sweetie|mate|baby|darling|love|sweetheart|cutie|bro|bae|bruh|omg|whoa|woah|damn|yo|excuse me|i\'?m sorry|oh my (?:god|gosh)|wait a minute|hold up|wtf';
const TAIL_WORDS = 'by that|by this|there|here|again|though|tho|exactly|even|anyway|now|please|sorry|lol|haha|ha|lmao|really|actually|honestly|seriously|dude|man|babe|honey|hon|sweetie|mate|friend|baby|darling|love|sweetheart|cutie|bro|bae|bruh|wtf';
const PLAIN_CORE = [
  'huh', 'what', 'what did you (?:just )?say', 'what (?:exactly )?(?:do|did) you (?:even |actually )?mean(?: by (?:that|this)(?: \\p{L}+){0,3})?', 'what (?:does|did) (?:that|this|it) (?:even |actually )?mean', 'what(?:\'?s| is) that mean', 'what are you (?:talking about|saying)', '(?:what is|what\'?s|whats|what was) that supposed to mean',
  '(?:i )?(?:(?:really|still|just|honestly|totally|genuinely) )?(?:don\'?t|do not|didn\'?t|did not|can\'?t|cannot) (?:really |quite |fully )?(?:get|understand|follow|catch)(?: (?:it|that|you|this|what you mean|what you said|what you\'?re saying|what you are saying|what that means|the joke|the reference))?',
  'i\'?m (?:so |really |still |very )?(?:confused|lost)', 'i\'?m not following(?: you)?', 'you lost me',
  '(?:that|this|it) (?:(?:doesn\'?t|does not|didn\'?t|did not) make (?:any )?sense|makes? (?:no|zero|little) sense|made no sense)',
].join('|');
interface AskPatterns { plain: RegExp; shrug: RegExp; named: { pattern: RegExp; strict: boolean }[] }
const patternCache = new Map<string, AskPatterns>();
/** The whole sentence is the question: "huh?", "wait, what", "Mira, what do you mean by that", "I don't get it". */
function askPatterns(names: readonly string[]): AskPatterns {
  const key = names.join('|'), cached = patternCache.get(key);
  if (cached) return cached;
  const vocative = names.map(name => escapeRegex(squash(name))).filter(Boolean).join('|');
  const lead = `(?:(?:${LEAD_WORDS}${vocative ? `|${vocative}` : ''})\\s+)*`, tail = `(?:\\s+(?:${TAIL_WORDS}${vocative ? `|${vocative}` : ''}))*`;
  const phrase = "([\\p{L}' ]+?)", det = '(?:a |an |the |this |that |these |those )?';
  const built: AskPatterns = {
    plain: new RegExp(`^${lead}(?:${PLAIN_CORE})${tail}$`, 'u'),
    shrug: new RegExp(`^${lead}(?:so|and|but) what${tail}$`, 'u'),
    named: [
      // "what is cake gossip", "what the heck is cake gossip lol", "what exactly is this cake gossip"
      { strict: true, pattern: new RegExp(`^${lead}what(?: the)?(?: (?:heck|hell|fuck))?(?: (?:in the world|on earth|exactly|even|actually))?(?: is| are| was| were|'?s) ${det}${phrase}(?: (?:even|exactly|supposed to be|supposed to mean|anyway))*${tail}$`, 'u') },
      // "what do you mean by cake gossip", "what do you mean cake gossip"
      { strict: false, pattern: new RegExp(`^${lead}what (?:do|did) you mean (?:(?:by|with) )?${det}${phrase}${tail}$`, 'u') },
      // "what does cake gossip even mean"
      { strict: false, pattern: new RegExp(`^${lead}what (?:does|do) ${det}${phrase} (?:even |actually )?mean${tail}$`, 'u') },
    ],
  };
  patternCache.set(key, built);
  return built;
}
const PERSONAL = /^(?:you|your|yours|youre|my|mine|i|me|we|our|he|she|they|their|it|its)(?:'|$)/;
const COMMON = new Set(['that', 'this', 'there', 'here', 'what', 'which', 'good', 'time', 'going', 'doing', 'getting', 'happening', 'wrong', 'nice', 'special', 'today', 'tonight', 'else', 'next', 'the', 'and', 'for']);

/**
 * The asked-about phrase is a contiguous run of the date's own words, never a pronoun, a description or a food
 * question. A plain "what is X" is also held to a word of some substance; "what do you mean by X" is explicit enough
 * to name short ones ("a lot", "cap").
 */
function namedInLine(subject: string, line: string, strict: boolean): boolean {
  const words = subject.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 4 || words.includes('like') || words.some(word => PERSONAL.test(word))) return false;
  if (words.length === 1 && (COMMON.has(words[0]) || words[0].length < (strict ? 4 : 2))) return false;
  const said = ` ${squash(line).split(' ').map(stem).join(' ')} `;
  return said.includes(` ${words.map(stem).join(' ')} `);
}

/**
 * True when the human's message asks the date to explain the line they just said, not a new question. Each sentence of
 * a short message is judged on its own, so "huh what do you mean babe" and "what do you mean by that? im confused" count while
 * "I don't get why people like cilantro" and "what are you drinking" never do. `names` are the people who may be addressed ("Mira, what do you mean").
 */
export function asksAboutLine(humanText: string, lastDateLine?: string, names: readonly string[] = []): boolean {
  if (!lastDateLine) return false;
  const sentences = humanText.split(/[.!?;…]+/).map(squash).filter(Boolean);
  if (!sentences.length || sentences.join(' ').split(' ').length > 16) return false;
  const { plain, shrug, named } = askPatterns(names);
  return sentences.some(sentence => {
    if (shrug.test(sentence)) return false; // "so what?" and "so what, Mira?" are a shrug, not a question about the line
    if (plain.test(sentence)) return true;
    return named.some(({ pattern, strict }) => { const subject = pattern.exec(sentence)?.[1]; return subject !== undefined && namedInLine(subject.trim(), lastDateLine, strict); });
  });
}

/** What to do with a clarification: say what it meant if it meant something, own it if it did not, and never invent a meaning now. */
export const CLARIFY_REPLY = 'If it had a plain meaning, say it in one short sentence. If it made no sense, say so (“that came out wrong, scratch that”) instead of inventing a meaning now. Then pick up what they were telling you.';

/**
 * When the human asks "what do you mean?" or "what is cake gossip?", the thing they are asking about is
 * the date's own last line. A buried rule does not reliably make a small model look there, so say so next
 * to the question. Fires only when a sentence of the message is the question itself or names words from that line, so an
 * ordinary question or a story that happens to say "I don't get why" never triggers it.
 */
export function clarificationNudge(humanText: string, lastDateLine?: string, names: readonly string[] = []): string {
  if (!lastDateLine || !asksAboutLine(humanText, lastDateLine, names)) return '';
  return `They seem to be asking about your last line (“${lastDateLine}”). ${CLARIFY_REPLY}`;
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
  agenda: AgendaPrompt | null;
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

export const quote = (text: string) => `“${text}”`;
/** What the notes section says when there is nothing to keep, so an empty notebook reads as empty rather than as a missing section. */
export const NOTES_EMPTY = '(empty so far: nothing worth keeping has come up)';
export const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The natural hint is offered on the third human turn and every third after, or when asked directly. */
const asksWhatTheyWant = /\b(?:what (?:do|are) you (?:want|looking|hoping)|looking for|what brings you|what are you after|what do you want)\b/i;
export function hintTurn(dialogueTurns: number, humanText: string): boolean {
  return asksWhatTheyWant.test(humanText) || (dialogueTurns >= 2 && dialogueTurns % 3 === 2);
}

const EXTRA_STATUS: Record<string, string> = { pending: 'still cooking', served: 'on the table', shared: 'shared', cancelled: 'cancelled', boxed: 'boxed up' };
/** The kitchen, staff and table facts from scenarioMechanicsContext, in plain words. */
export function serviceFacts(mechanics: Record<string, unknown> | undefined, dateName: string, pair = 'You'): string[] {
  if (!mechanics) return [];
  const out: string[] = [], cleanup = mechanics.cleanup as { wine: string; glassesCleared: boolean } | undefined;
  if (mechanics.dinnerHeld) out.push('The kitchen is holding dinner for now.');
  if (mechanics.table === 'quiet') out.push(`${pair} have moved to a quieter part of the restaurant.`);
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

/**
 * Only refusals that were actually heard are in force; a pending one is shown so it is not repeated as settled.
 * `who` names the person in a shared room; in Solo it is "they".
 */
export function boundaryLines(context: BoundaryPrompt, who = 'they'): string[] {
  const has = who === 'they' ? 'have' : 'has';
  return context.boundaries.map(item => {
    if (!item.delivered) return `- ${item.topic}: you started to say ${quote(item.pendingRefusal ?? item.refusal)}, but ${who} ${has} not heard it, so it is not in force yet.`;
    const times = item.disregardCount === 1 ? 'once' : `${item.disregardCount} times`;
    return `- ${item.topic}: ${who} heard you say ${quote(item.refusal)}${item.disregardCount ? ` and ${has} disregarded it ${times}` : ''}.`;
  });
}

export function agendaLine(agenda: AgendaPrompt, showHint: boolean, lead = 'Private to you, not to recite', who?: { date: string; human: string }): string {
  const parts = [`${lead}: ${agenda.goal}${showHint ? ` ${agenda.naturalHint}` : ''}`];
  if (agenda.heardClues.length) parts.push(`What ${who ? who.human : 'they'} ${who ? 'has' : 'have'} already heard from ${who ? who.date : 'you'} on this: ${agenda.heardClues.map(quote).join(' ')}`);
  if (agenda.confidence === 'earned') parts.push(who ? `${who.human} has earned ${who.date}’s trust.` : 'They have earned your trust.');
  // The server discards a signal it cannot accept, so the rubric is shown only when one could count.
  if (agenda.nextMilestone && agenda.evidenceReady) parts.push(`${who ? who.date : 'You'} may now signal "${agenda.nextMilestone}" only if this turn earns it: ${agenda.rubric[agenda.nextMilestone]}`);
  return parts.join(' ');
}

/** The last question in a scripted line, which is what the human is answering. */
export const lastQuestion = (text: string) => (text.match(/[^.!?]*\?/g) ?? []).map(item => item.trim()).filter(Boolean).at(-1) ?? clean(text).slice(0, 240);

/**
 * The whole per-turn message. Labelled sections appear only when they have content, in a fixed order, and
 * the human's words come last, followed by plain sentences about how they arrived.
 */
export function turnNote(input: TurnNoteInput): string {
  const { scene, dateName: date, human = 'the human', flow = {} } = input, e = scene.evening, say = (text: string) => humanVoice(text, date, human);
  const Human = human[0].toUpperCase() + human.slice(1), out: string[] = [];
  const now = [input.tableNow];
  if (e.care.romanceClosed) now.push('Romance is closed tonight; stay friendly and do not flirt.');
  else if (e.chemistry?.unlocked) now.push(`Mutual chemistry is established between you and ${human}.`);
  out.push(`Right now: ${now.join(' ')}`);
  out.push(`Your notes (rewrite them into "memory"):\n${input.memory.trim() || NOTES_EMPTY}`);
  const boundaries = boundaryLines(input.boundaries);
  if (boundaries.length) out.push(`Boundaries in play:\n${boundaries.join('\n')}`);
  if (input.avoid.length) out.push(`Do not bring up unprompted: ${input.avoid.join(', ')}.`);
  const blind = scene.blindDate ? createBlindDate(scene.blindDate.seed) : undefined;
  const material = conversationContentNote({ dateId: scene.dateId, latestHumanText: input.humanText, memory: input.memory,
    recentDateLines: input.recentDelivered?.filter(line => line.speaker === 'date').map(line => line.text),
    personalDisclosureAllowed: !['guarded', 'hurt', 'leaving'].includes(e.stance), stoppedTopics: input.avoid, maxEstimatedTokens: 590,
    ...(blind ? { seeds: blind.conversationSeeds ?? [], includeVoiceExample: false } : {}) });
  if (material) out.push(material);
  if (input.via === 'voice') out.push('They said this out loud; it is an automatic transcript from a small on-device recognizer and can contain mishearings.');
  const after: string[] = [];
  // Typing is not talking: only the spoken case says they talked over the date or kept going. A typed answer that
  // arrives while the date is mid-line replies over them, and a typed answer to a line never played is just an answer.
  const overlap = input.via === 'typed' ? 'They replied' : 'They started talking';
  if (flow.talkedOver) after.push(flow.talkedOver.heard ? `${overlap} while you were still speaking; you were cut off after ${quote(flow.talkedOver.heard)}.` : `${overlap} while you were still speaking, right at the start of your line.`);
  if (flow.keptTalking && input.via !== 'typed') after.push('They kept talking before your last reply reached them; treat this as the continuation of their previous message.');
  if (flow.quietSeconds) after.push(`It was quiet for ${flow.quietSeconds < 60 ? `about ${flow.quietSeconds} seconds` : flow.quietSeconds < 150 ? 'a minute or two' : 'a long while'} after your last line before they spoke.`);
  if (flow.pendingQuestion) after.push(`You asked them ${quote(lastQuestion(flow.pendingQuestion))} a little while ago and have not had an answer. If what they say next is not an answer, just respond to what they said.`);
  const nudge = clarificationNudge(input.humanText, flow.lastDateLine, [date]);
  if (nudge) after.push(nudge);
  const shape = replyShapeHint(input.recentDelivered ?? [], input.humanText);
  if (shape) after.push(shape);
  out.push([`${Human} just said: ${quote(clean(input.humanText))}`, ...after].join('\n'));
  return out.join('\n\n');
}
