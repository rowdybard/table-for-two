import { EVENT_COPY } from '../../src/restaurant/content';
import { DESSERTS } from '../../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

/** Shared turn direction; this does not schedule requests or change character boundaries. */
export const DATE_DIALOGUE_INSTRUCTIONS = [
  'The history is the real conversation so far, oldest first: what the human said and what was said at the table by you, Eli the waiter and the neighbouring diner, your scripted remarks included. A line marked (cut off…), (still being said) or (the human did not hear this) was not fully heard, so it is not established history.',
  '“Right now” in the latest message is where the evening physically is; never describe food, plates or staff it does not mention. “At the table so far” is what actually happened.',
  'Continue as one person who remembers all of it. Answer what they just said first, in a way that only makes sense after their words; a line that could follow any message is wrong. Never re-introduce yourself, retell what your notes say you already shared, contradict an earlier detail, or ask what they already answered. Your own news comes up only where it connects.',
  'Take their words at plain meaning and in proportion: a small number is small, a big number is big, a cheap meal is cheap. Never coin a phrase, nickname or in-joke they cannot understand; say the plain thing.',
  'If the latest message says they said it out loud, the words are an automatic transcript and can contain mishearings. A word that does not fit the sentence or the table (“knights shift” right after nursing at a hospital) is almost certainly one: silently use the plausible word, never quote or joke about the garble, and keep the plausible reading in your notes. Ask “sorry, did you say…?” only once, and only when two readings would change your answer. Otherwise the words were typed; take them exactly.',
  'If they talked over you, do not repeat the part you were cut off before; a brief “go ahead” is natural once, not every time. If they kept talking before your reply reached them, answer both messages as one thought. If you were waiting on an answer, their words are probably it. If they are asking about your last line, explain it plainly in one line and never defend it. After a long quiet gap one light remark is fine, never an accusation.',
  'React to a surprising claim or a real disclosure out loud (“Wait, really?” “I’m sorry, that sounds hard”) before judging it; never mock identity or illness. Unusual claims stay unverified: clarify gently, do not establish impossible events as scene facts or affirm a diagnosis.',
  'Flirtation stays playful and responsive within the provider’s content instructions; skepticism can coexist with attraction, and not every flirt is a trust exam.',
  'Honor any “Do not bring up unprompted” line and requests to stop a topic. Avoid scenery, props and old jokes from recent replies unless the human brings them back or something new happens; setting details never replace an answer. Do not invent human facts, promises, attraction or earlier refusals.',
  'Kindness, curiosity and humor are not automatic rewards; money never buys affection; acknowledge a sincere repair. Respect a stated lack of romantic interest even after a kind gesture. Never out anyone, mock involuntary tics, turn a medical response into flirtation, invent medical treatment, pressure staff, or ask anyone to suppress a tic or explain private identity details. A story can add a real detail to the evening; do not contradict it with a preset assumption. Agree when you agree; push back only when you actually disagree.',
].join('\n');

const CONTRACT_MEMORY_CHARS = 700;
/** How the turn is returned. Field order matches TURN_SCHEMA: the spoken line streams first, bookkeeping follows. */
export function outputContract(vocabulary: { emotions: readonly string[]; actions: readonly string[]; signals: readonly string[] }): string {
  return [
    'OUTPUT. Return exactly one JSON object matching the schema and nothing else, spoken line first: write it as the person, for the human at the table, then fill the bookkeeping from what was actually said; never bend the line to fit a field.',
    'When nothing happened, use social {signal none, reason “No change in boundaries.”, wantsToLeave false, boundary {kind none, topic other, refusal “”, evidence “”}} and agenda {signal none, evidence “”, clue “”}.',
    'The date speaks first, usually alone. Add ONE short waiter or diner line only when “Right now” shows that person is involved (a live incident, a course being served, the check) or the human just spoke to them: Eli does not comment on ordinary conversation, and the neighbouring diner speaks only during their own incident. No empty items, other speakers or extra properties.',
    'Date text is about 25 words, under 260 characters in total (up to about 60 words for a story or explanation they asked for); the server discards a reply over 420.',
    `Emotions: ${vocabulary.emotions.join(', ')}. Actions: ${vocabulary.actions.join(', ')}; actions are proposals, and the server owns courses and outcomes.`,
    `social.signal is one of ${vocabulary.signals.join(', ')} with a factual reason of at most 180 characters; pressure means explicit disregard for a boundary, not ordinary disagreement. Set wantsToLeave only after repeated pressure; the server handles departure.`,
    `"memory" is your private notebook: rewrite "Your notes" from the latest message with this exchange, at most ${CONTRACT_MEMORY_CHARS} characters, in exactly three labelled parts. "HUMAN:" what they told you in their own terms (names, numbers, places, work, family, likes, dislikes); keep every earlier item unless they corrected it, and write "says" before a claim you doubt. "TOLD THEM:" stories and facts about your own life you have already shared, a few words each, so you never tell one twice. "OPEN:" a question either of you asked that is still unanswered, or something promised, removed once settled. Leave out scenery, food, staff and your own jokes or wording; the table events are tracked for you.`,
    'No invented human statements, numeric scores, markdown or speech-direction tags in text.',
  ].join('\n');
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentenceCount = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
/**
 * Local, model-free hint about the shape of the next reply: short for a short remark, warm for a long
 * disclosure, and a nudge when the last few date lines were all the same size or all ended in questions.
 */
export function replyShapeHint(recentDelivered: readonly SceneUtterance[], humanText: string): string {
  const mine = recentDelivered.filter(line => line.speaker === 'date').slice(-3), hint: string[] = [], said = wordCount(humanText);
  if (said <= 6) hint.push('They said very little: answer in a few words or one short sentence.');
  else if (said >= 30) hint.push('They told you something real: acknowledge it first; two or three sentences is fine.');
  if (mine.length === 3 && mine.every(line => sentenceCount(line.text) === sentenceCount(mine[0].text))) {
    const n = sentenceCount(mine[0].text);
    hint.push(`Your last three replies were all ${n} sentence${n === 1 ? '' : 's'} long: change the shape.`);
  }
  if (mine.filter(line => /\?["”’']*\s*$/.test(line.text.trim())).length >= 2) hint.push('Your last replies ended in questions: end this one on a statement.');
  return hint.join(' ');
}

const propFamilies = [
  { topic: 'coat racks and hangers', mention: /\b(?:coat[\s-]*racks?|coat[\s-]*stands?|hangers?)\b/i },
  { topic: 'plants and foliage', mention: /\b(?:plants?|houseplants?|foliage|ferns?|leaves|leaf)\b/i,
    interest: /\b(?:plants?|houseplants?|foliage|ferns?|leaves|leaf|botany|botanists?|horticultur(?:e|al|ists?)|gardening|gardeners?|gardens?|greenhouses?|nurser(?:y|ies))\b/i },
  { topic: 'windows and weather', mention: /\b(?:windows?|weather|rain|raining|rainy|raindrops?|rainfall|storms?|snow|snowing|snowfall)\b/i },
  { topic: 'wall art', mention: /\b(?:wall[\s-]*art|artwork|paintings?|murals?|portraits?|posters?)\b/i },
  { topic: 'chairs and seating', mention: /\b(?:chairs?|seats?|stools?|booths?)\b/i },
  { topic: 'lighting and candles', mention: /\b(?:lamps?|chandeliers?|candles?|lighting)\b/i },
] as const;
const repeatRequest = /\b(?:repeat|rephrase|say\s+(?:that|it)\s+again|what\s+did\s+you\s+say|what\s+was\s+that|(?:didn['’]?t|couldn['’]?t|did\s+not|could\s+not)\s+(?:hear|catch)|come\s+again)\b/i;
const topicRejectionLead = /\b(?:(?:stop|quit)\s+(?:talking(?:\s+about)?|bringing(?:\s+up)?|mentioning|repeating|going\s+on(?:\s+about)?|obsessing(?:\s+over)?|with)|(?:don['’]?t|do\s+not)\s+(?:keep\s+)?(?:talk(?:ing)?(?:\s+about)?|bring(?:ing)?(?:\s+up)?|mention(?:ing)?|repeat(?:ing)?|go(?:ing)?\s+on(?:\s+about)?)|no\s+more|enough\s+(?:of|about)|tired\s+of|sick\s+of|bored\s+of|not\s+interested\s+in|anything\s+but|something\s+other\s+than)\b/gi;

/** Per-actor delivered date lines only; a topic request is not an unprompted callback. */
export function dialogueLoopContext(recentDelivered: readonly SceneUtterance[], latestHumanText: string): { avoidUnpromptedTopics: string[] } {
  const recent: string[] = [];
  for (let index = recentDelivered.length - 1; index >= 0 && recent.length < 4; index--) {
    if (recentDelivered[index].speaker === 'date') recent.push(recentDelivered[index].text.slice(0, 420).normalize('NFKC'));
  }
  const human = latestHumanText.slice(0, 2000).normalize('NFKC');
  const repeating = repeatRequest.test(human);
  const rejectedClauses = [...human.matchAll(topicRejectionLead)].map(match => human.slice(match.index, match.index + 160).split(/[.!?;,]/, 1)[0]);
  const avoidUnpromptedTopics: string[] = [];
  for (const family of propFamilies) {
    if (recent.filter(text => family.mention.test(text)).length < 2) continue;
    const rejected = rejectedClauses.some(clause => family.mention.test(clause));
    const interest = 'interest' in family ? family.interest : family.mention;
    if (!rejected && (repeating || interest.test(human))) continue;
    avoidUnpromptedTopics.push(family.topic);
  }
  return { avoidUnpromptedTopics };
}

/**
 * Authored pacing cues that may wait for an in-flight reply. Eli putting a plate down or the
 * date's scripted aside should land after the date has answered the human, not abort that
 * answer. Health, boundary, incident, scenario and farewell cues still take the floor at once.
 */
const DEFERRABLE_CUES = new Set(['welcome', 'seated', 'ordered', 'order-nudge', 'main-served', 'taste', 'main-finished', 'quiet-window', 'dessert-date-choice', 'dessert-ordered', 'dessert-served', 'dessert-shared', 'dessert-skipped', 'bill-requested', 'bill-settled', 'care-water-served']);
export function deferrableCue(key: string) { return DEFERRABLE_CUES.has(key) || key.startsWith('beat-'); }

const dishName = (id: string | null | undefined) => id ? DESSERTS.find(d => d.id === id)?.name ?? id : '';

const AGREEMENT: Record<string, string> = { do: 'does', have: 'has', are: 'is', were: 'was', "don't": "doesn't", "haven't": "hasn't", "aren't": "isn't", "weren't": "wasn't" };
/**
 * Server copy such as "You returned the risotto" or "Your date notices before you do" is written for the
 * player's screen. The date model is "you" in the system prompt, so a second-person line about the human
 * reads as the model's own act. Rewrite server-authored strings (moments, resolutions, table facts, stance
 * reasons, scenario text) on their way to the model; never UI copy. `human` names the person in a Double room.
 */
export function humanVoice(text: string, dateName: string, human = 'the human'): string {
  const cap = human[0].toUpperCase() + human.slice(1), possessive = human === 'the human' ? 'the human’s' : `${human}’s`;
  const opening = (whole: string, at: number) => /(?:^|[.!?]["”’)]*\s+|["“‘(]\s*)$/.test(whole.slice(0, at));
  return text
    .replace(/\b[Yy]our date(['’]s)?\b/g, (_m, owns) => dateName + (owns ? '’s' : ''))
    .replace(/^You have only just met\.?/, `${cap} and ${dateName} have only just met.`)
    .replace(/\byou(?:['’](re|ve|ll|d)|\s+(do|have|are|were|don['’]t|haven['’]t|aren['’]t|weren['’]t))?\b/gi, (_m, contraction: string | undefined, verb: string | undefined, at: number, whole: string) => {
      const subject = opening(whole, at) ? cap : human;
      if (contraction) return `${subject} ${{ re: 'is', ve: 'has', ll: 'will', d: 'would' }[contraction.toLowerCase()]}`;
      if (verb) return `${subject} ${AGREEMENT[verb.toLowerCase().replace('’', "'")].replace("'", verb.includes('’') ? '’' : "'")}`;
      return subject;
    })
    .replace(/\byourself\b/gi, 'themself')
    .replace(/\byours?\b/gi, (_m, at: number, whole: string) => opening(whole, at) ? possessive[0].toUpperCase() + possessive.slice(1) : possessive);
}

const DESSERT_NAMES = DESSERTS.map(dessert => dessert.name.toLowerCase());
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/**
 * One short plain-language account of where the evening physically is. The structured scene
 * JSON is long and easy for a small model to misread; this keeps replies anchored to the table.
 * "You" is the date and the human together; the human's own acts are always named, so the model is
 * never told that it did something the human did. `human` names the person in a Double room.
 */
export function tableNow(scene: DinnerState, dateName: string, human = 'the human'): string {
  const e = scene.evening, parts: string[] = [], Human = human[0].toUpperCase() + human.slice(1), minutes = Math.floor(scene.elapsed / 60);
  parts.push(minutes < 1 ? 'The date is under a minute old.' : `The date is about ${minutes} minute${minutes === 1 ? '' : 's'} old.`);
  if (e.dialogueTurns > 0) parts.push(`You have traded ${e.dialogueTurns} repl${e.dialogueTurns === 1 ? 'y' : 'ies'} so far.`);
  if (!scene.seated) parts.push(scene.stage === 'arrival' ? `You have just met at the entrance and have not sat down yet.` : 'You are not at the table right now.');
  else if (!scene.order) parts.push('You are seated at your table with menus; nothing has been ordered yet.');
  if (scene.order) {
    const theirs = e.main.dateDish ? `, ${dateName} ordered the ${e.main.dateDish.toLowerCase()}` : '';
    const main = { none: 'ordered', waiting: 'ordered and are waiting for the food', served: 'have the mains on the table', finished: 'have finished the mains and Eli has cleared the plates' }[e.main.status];
    parts.push(`${Human} ordered the ${scene.order.toLowerCase()}${theirs}; you ${main}.`);
    if (e.main.status === 'served' && e.main.servedDish && e.main.servedDish !== scene.order) parts.push(`The plate in front of ${human} is the ${e.main.servedDish.toLowerCase()}, not what they ordered.`);
    if (e.main.status === 'served' && !e.incident) parts.push(e.main.bites === 0 ? `${Human} has not started eating yet.` : `${Human} has started eating.`);
  }
  if (e.dessert.status === 'waiting') parts.push(`Dessert (${dishName(e.dessert.choice).toLowerCase()}) is on its way.`);
  else if (e.dessert.status === 'served') parts.push(`You are sharing the ${dishName(e.dessert.choice).toLowerCase()} for dessert.`);
  else if (e.dessert.status === 'finished') parts.push('Dessert is finished.');
  else if (e.dessert.status === 'skipped') parts.push('You both skipped dessert.');
  else if (e.main.status === 'finished' && !e.bill.requested && !e.farewell.ending) {
    const warm = !['guarded', 'hurt', 'leaving'].includes(e.stance);
    parts.push(`Eli has offered ${DESSERT_NAMES.slice(0, -1).join(', ')} or ${DESSERT_NAMES.at(-1)}, and nobody has chosen yet. If ${human} says which they want, treat it as their choice${warm ? `; if they say nothing, ${dateName} will pick one shortly` : ''}.`);
  }
  if (e.bill.settlement) parts.push('The check has been settled.');
  else if (e.bill.requested) parts.push(`Eli has brought the check${e.bill.totalCents ? ` (${money(e.bill.totalCents)})` : ''}.`);
  if (e.incident) parts.push(`Happening right now: ${humanVoice(EVENT_COPY[e.incident.event].description, dateName, human)}`);
  if ((e.scenarioCare?.presence ?? 'at-table') !== 'at-table') parts.push(`${dateName} has stepped away from the table.`);
  if (e.farewell.ending) parts.push('The evening is ending; you are saying goodbye.');
  const reason = e.stanceReason && !/^You have only just met\.?$/.test(e.stanceReason) ? ` (${humanVoice(e.stanceReason, dateName, human).replace(/\.$/, '').replace(/^The human/, 'the human')})` : '';
  parts.push({
    curious: `${dateName} is still curious about ${human} so far${reason}.`,
    comfortable: `${dateName} feels comfortable with ${human}${reason}.`,
    guarded: `${dateName} is guarded with ${human}${reason}.`,
    hurt: `${dateName} is hurt and wary of ${human}${reason}.`,
    leaving: `${dateName} is leaving${reason}.`,
  }[e.stance] ?? `${dateName} is ${e.stance} so far${reason}.`);
  return parts.join(' ');
}

type Message = { role: 'user' | 'assistant'; content: string };
/** Read when the model's first message would otherwise be the date's own; says what the lines below it are. */
export const START_NOTE = '[The evening begins: you and the human are meeting at the restaurant. Before they speak, this was said at the table:]';
/** Read instead once older entries were dropped from the window, so a long date is not told it just began. */
export const TRIMMED_NOTE = '[Earlier conversation is not shown; your notes carry it.]';
/**
 * Providers want a conversation that starts with the human and alternates. The opening line
 * and interrupted turns can break that, so fold same-role neighbours together instead of
 * dropping either side of the exchange. `leadIn` is the first message the model reads when
 * the history begins with the date.
 */
export function alternatingMessages(messages: readonly Message[], leadIn: string = START_NOTE): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const last = out.at(-1);
    if (last && last.role === message.role) last.content = `${last.content}\n${message.content}`;
    else out.push({ ...message });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: leadIn });
  return out;
}

/** Spoken-register block: placed last in the system prompt, nearest to generation, so every earlier rule is read through it. */
export const SPOKEN_REGISTER = 'HOW YOU TALK. You are speaking out loud on a first date, not writing. Sound like a person: contractions, fragments, “oh”, “huh”, “wait, really?”, “yeah, no”. React first in a few plain words (“Oh, nice.” “Ha, no way.” “Huh. Okay.”), then add a thought or something about yourself only if you have one. Reuse the human’s own words; do not restate what they said in a cleverer phrase. Vary the length: sometimes five words, usually one or two sentences, three only when telling a story, never more than four. Most turns end on a statement; ask a question only when you want the answer, and never in two turns running. A joke is occasional and comes from something they just said, not from the room, a prop or a comparison. Do not finish every turn with a twist or a neat closing line. Do not describe the room, light, music or food unless they ask or something just happened. Keep early talk small (where you grew up, work, today, weekends, food) and let anything personal come out slowly. If you did not follow something, say so (“Sorry, which part?”). If they ask what you meant and it came out odd, own it in one line (“That came out strange, I just meant...”) and move on. Say what you think or what happened to you, not wise general lines about people.';
/** The very last line of the system prompt. */
export const VOICE_REMINDER = 'Reply the way you would across a table: their words first, short, plain, usually no question, no closing quip.';
/** Compact per-character voice cues, for a per-turn reminder. Blind dates carry their own derived voice instead. */
export const VOICE_SHORT: Record<string, string> = {
  mira: 'quick warm bursts; okay/oh/wait; laughs at herself; mostly ends on a statement',
  jules: 'quiet and exact, four to eight words; dry understatement; short plain questions',
  dev: 'fast and loose; okay so/honestly/look; concrete nouns and numbers; teases only what they just said, then softens',
};
