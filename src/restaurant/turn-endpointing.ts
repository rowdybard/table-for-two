/**
 * Pure helpers for the voice turn path: when a spoken sentence looks finished, which transcripts
 * never deserve a reply, and the bounded waits around sending a turn. No DOM, timers or state live
 * here beyond the explicit clock arguments, so every rule can be unit tested in Node.
 *
 * Nothing in this file adds a model call. Each rule only decides whether a turn that is already
 * going to be sent should wait a little longer, be dropped as a non-turn, or stop waiting.
 */

/** A sentence that looks finished commits after the same pause the game has always used. */
export const COMMIT_FINISHED_MS = 550;
/** One or two bare words, or an ending that could go either way ("I really liked that"). */
export const COMMIT_HESITANT_MS = 800;
/** Obviously mid-thought ("My graduating class was"): leave room for the rest of the sentence. */
export const COMMIT_UNFINISHED_MS = 1400;
/** Scripted lines never hold a speaking human's floor for longer than this. */
export const HUMAN_FLOOR_MAX_MS = 6000;
export const HUMAN_FLOOR_STEP_MS = 100;
/** Longest the mic path waits on audio unlock, a pending interrupt or an earlier receipt. */
export const TURN_WAIT_MS = 2500;
/** A playback receipt that has not landed by now is abandoned rather than queueing behind. */
export const RECEIPT_TIMEOUT_MS = 5000;

const normalize = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const wordCount = (text: string) => text.split(' ').filter(Boolean).length;

/** The final word, lowercased and stripped of closing punctuation and opening quotes. */
function lastWord(text: string): string {
  const stripped = text.replace(/[\s.,;:!?…"')\]\-–—]+$/, '');
  return (stripped.split(' ').pop() ?? '').replace(/^["'(\[\-–—]+/, '').toLowerCase();
}

/**
 * Words a spoken sentence cannot end on, even if the recognizer closed it with a period:
 * determiners, possessives and conjunctions. "My graduating class was the" is a fragment.
 */
const ALWAYS_OPEN = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'its',
  'and', 'but', 'or', 'because', 'cause', 'cuz', 'if', 'of', 'with', 'than', 'whose',
]);
/** Open when the recognizer added no closing punctuation: contractions, question words, hesitation. */
const OPEN_UNPUNCTUATED = new Set([
  "i'm", "i've", "i'd", "i'll", "it's", "there's", "he's", "she's", "they're", "we're", "you're",
  "we've", "they've", "you've", "that's", "what's", "who's", "let's",
  'just', 'also', 'very', 'kinda', 'sorta', 'gonna', 'wanna', 'gotta',
  'as', 'at', 'by', 'into', 'onto', 'while', 'until', 'though', 'although', 'unless', 'since',
  'who', 'whom', 'which', 'when', 'where', 'what', 'how', 'why',
  'um', 'uh', 'er', 'erm', 'uhm', 'hm', 'hmm', 'mm', 'mmm',
]);
/**
 * Auxiliaries, copulas and prepositions end short finished answers ("Yes it is", "I'd love to") as
 * well as long fragments ("My graduating class was"). Without closing punctuation, four or more
 * words ending on one reads as unfinished and fewer reads as a possible answer.
 */
const OPEN_WHEN_LONG = new Set([
  'is', 'was', 'were', 'are', 'am', 'be', 'been', 'has', 'have', 'had', 'will', 'would', 'could', 'should', 'can', 'might', 'must', 'shall',
  'to', 'in', 'on', 'for', 'from', 'about', 'like',
]);
const OPEN_WHEN_LONG_WORDS = 4;
/** Words that end finished answers as often as unfinished ones ("I think so", "I do", "So am I"). */
const AMBIGUOUS_END = new Set(['i', 'so', 'that', 'then', 'well', 'do', 'does', 'did', 'not', 'his', 'her']);

const TRAILING_OPEN_PUNCTUATION = /[,;:\-–—]["')\]]*$/;
const TRAILING_ELLIPSIS = /(?:\.{2,}|…)["')\]]*$/;
const TERMINAL_QUESTION_OR_EXCLAIM = /[!?]["')\]]*$/;
const TERMINAL_PERIOD = /\.["')\]]*$/;

/**
 * How long to wait, after the recognizer closes a segment, before treating the words as the
 * player's finished turn. Text that reads as finished keeps today's 550 ms. Obvious fragments and
 * mid-thought pauses wait longer, so a pause to think does not send half a sentence for a reply
 * (which the player's next words would then cancel). A new speech segment cancels the wait.
 */
export function commitDelay(raw: string): number {
  const text = normalize(raw);
  if (!text) return COMMIT_FINISHED_MS;
  if (TRAILING_OPEN_PUNCTUATION.test(text)) return COMMIT_UNFINISHED_MS;
  const last = lastWord(text);
  const never = ALWAYS_OPEN.has(last), unpunctuated = OPEN_UNPUNCTUATED.has(last);
  if (TRAILING_ELLIPSIS.test(text)) return never || unpunctuated ? COMMIT_UNFINISHED_MS : COMMIT_HESITANT_MS;
  if (TERMINAL_QUESTION_OR_EXCLAIM.test(text)) return COMMIT_FINISHED_MS;
  if (TERMINAL_PERIOD.test(text)) return never ? COMMIT_UNFINISHED_MS : COMMIT_FINISHED_MS;
  if (never || unpunctuated) return COMMIT_UNFINISHED_MS;
  const words = wordCount(text);
  if (OPEN_WHEN_LONG.has(last)) return words >= OPEN_WHEN_LONG_WORDS ? COMMIT_UNFINISHED_MS : COMMIT_HESITANT_MS;
  if (AMBIGUOUS_END.has(last)) return COMMIT_HESITANT_MS;
  return words < 3 ? COMMIT_HESITANT_MS : COMMIT_FINISHED_MS;
}

/** Hesitation sounds only: um, uh, er, erm, hm, mm (any length). */
const FILLER_TOKEN = /^(?:u+m+|u+h+m*|e+r+m*|e+h+m+|h+m+|m{2,})$/;
const tokens = (text: string) => normalize(text).toLowerCase().split(' ').map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

/**
 * A transcript made only of hesitation sounds, or of punctuation with no words at all, is not a
 * turn. Replying to "um" buys a model call and a reply to nothing. Real words are never filler:
 * "huh?", "oh", "hmm, maybe" and "mm-hmm" all stay turns (mm-hmm is a back-channel, below).
 */
export function isFillerOnly(raw: string): boolean {
  const text = normalize(raw);
  if (!text) return false;
  const words = tokens(text);
  return words.length === 0 || words.every(word => FILLER_TOKEN.test(word));
}

const BACKCHANNEL_PHRASES = [
  'mm+', 'm+h+m+', 'mm-?h+m+', 'h+m+', 'uh-?huh', 'uh huh', 'mhm+',
  'ye+a+h*', 'ye+p+', 'yu+p+', 'ok', 'okay', 'right', 'o+h+', 'a+h+', 'wo+w+', 'ha(?:ha)*', 'really', 'i see',
];
const BACKCHANNEL = new RegExp(`^(?:(?:${BACKCHANNEL_PHRASES.join('|')})\\b[\\s,.!?…-]*)+$`, 'i');

/**
 * Listening noises ("mm-hm", "yeah", "right", "okay", "oh wow") rather than a turn. "Yes", "sure" and
 * "no" are deliberately absent: they answer a question instead of just acknowledging it.
 */
export function isBackchannel(raw: string): boolean {
  const text = normalize(raw);
  return !!text && BACKCHANNEL.test(text);
}

/**
 * A committed back-channel while a line is still playing is the human listening, not taking the
 * floor: drop it and let the date finish. It is kept when the line being spoken asks a question,
 * where a short "yeah" or "okay" is most likely the answer. After a barge-in the line is already
 * cut off (nothing is playing), so the turn is sent exactly as before.
 */
export function shouldDropBackchannel(text: string, playing: { speaking: boolean; caption: string }): boolean {
  return playing.speaking && isBackchannel(text) && !playing.caption.includes('?');
}

/**
 * Cue keys that are routine pacing (a plate arriving, the check, a scripted aside) and so wait
 * for a speaking human to finish their sentence. Mirrors the server's deferrable cue list; an
 * allowlist on purpose, so a cue this does not name (health, boundary, incident, scenario,
 * farewell) keeps taking the floor at once exactly as it does today.
 */
const ROUTINE_CUES = new Set(['welcome', 'seated', 'ordered', 'order-nudge', 'main-served', 'taste', 'main-finished', 'quiet-window', 'dessert-date-choice', 'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped', 'bill-requested', 'bill-settled', 'care-water-served']);
export function cueYieldsToHuman(key: string): boolean { return ROUTINE_CUES.has(key) || key.startsWith('beat-'); }

export interface WaitClock { now(): number; sleep(ms: number): Promise<void> }
const realClock: WaitClock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

/**
 * Poll `holding` until it is false or `maxMs` has passed. Resolves true if the hold was released,
 * false if the cap was reached (callers then carry on as they would have without waiting).
 */
export async function waitWhile(holding: () => boolean, maxMs = HUMAN_FLOOR_MAX_MS, stepMs = HUMAN_FLOOR_STEP_MS, clock: WaitClock = realClock): Promise<boolean> {
  const until = clock.now() + maxMs;
  while (holding()) {
    const remaining = until - clock.now();
    if (remaining <= 0) return false;
    await clock.sleep(Math.max(1, Math.min(stepMs, remaining)));
  }
  return true;
}

/**
 * Wait for `promise` to settle (either way) for at most `ms`. Resolves true if it settled in time
 * and false if the wait gave up; the promise itself is left running and its failure is ignored.
 */
export function settled(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => { clearTimeout(timer); resolve(true); };
    promise.then(done, done);
  });
}

/** An abort signal that fires after `ms`, with a fallback for browsers without AbortSignal.timeout. */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), ms);
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}
