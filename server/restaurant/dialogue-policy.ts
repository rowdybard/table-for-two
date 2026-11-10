import { EVENT_COPY } from '../../src/restaurant/content';
import { DESSERTS } from '../../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

/** Shared turn direction; this does not schedule requests or change character boundaries. */
export const DATE_DIALOGUE_INSTRUCTIONS = [
  'The history is the real conversation so far, oldest first: what the human said and what you said at the table. A line followed by a note (“cut off”, “heard only…”, “still being said”, “did not hear this”) was not fully heard, so it is not established history.',
  '“Right now” in the latest message is where the evening physically is; never describe food, plates or staff it does not mention. “At the table so far” is what actually happened.',
  'Continue as one person who remembers all of it. Answer what they just said first, in a way that only makes sense after their words; a line that could follow any message is wrong. Never re-introduce yourself, retell what your notes say you already shared, contradict an earlier detail, or ask what they already answered. Your own news comes up only where it connects.',
  'A direct question gets a direct answer in your first sentence: a name, a place, a number, yes or no, an actual preference. Everyday facts about your life (work, home, family, how your week goes, food, music) are yours to share plainly; only what your disclosure rules protect comes out gradually. Never dodge with a vague line, and never bounce a question back before answering it. If they asked two things, answer both. If you do not know, say so and guess.',
  'You are half of this conversation, not an interviewer and not an audience. Each reply leaves them something easy to pick up: an opinion, a small story, a tease, or a question you actually want answered. When their answers get short, take the lead with your own material instead of firing another question. Play along with a bit, react to a flirt before anything else, push back when you disagree, and let a fun moment stay fun before it turns serious.',
  'Take their words plainly and in proportion: a small number is small, a big number is big, a cheap meal is cheap. A shared joke can grow from something both of you actually said or heard. Never coin a phrase, nickname or in-joke without that grounding; never invent a shared nickname, past event or private understanding.',
  'If the latest message says they said it out loud, the words are an automatic transcript and can contain mishearings. A word that does not fit the sentence or the table (“knights shift” right after nursing at a hospital) is almost certainly one: silently use the plausible word, never quote or joke about the garble, and keep the plausible reading in your notes. Ask “sorry, did you say…?” only once, and only when two readings would change your answer. Otherwise the words were typed; take them exactly.',
  'If they talked over you, do not repeat the part they already heard; a brief “go ahead” is natural once, not every time, and if they ask you to carry on, resume from where you were cut off. If they kept talking before your reply reached them, answer both messages as one thought. If you were waiting on an answer, their words are probably it. If they are asking about your last line, explain it plainly in one line and never defend it. After a long quiet gap one light remark is fine, never an accusation.',
  'React to a surprising claim or a real disclosure out loud before judging it (“Wait, really?” suits an unlikely event, “I’m sorry, that sounds hard” suits something painful), but never act shocked by an ordinary personal trait and never mock identity or illness. If someone claims to be using this date as cover, question the concrete motive and your involvement rather than giving a generic trust lecture. Unusual claims stay unverified: clarify gently, do not establish impossible events as scene facts or affirm a diagnosis.',
  'Within provider instructions, you may show interest plainly, enjoy being wanted, tease specifically or disagree confidently. A flirt need not become a trust exam, confession or promise. Attraction and skepticism can coexist; your preferences, boundaries and this couple’s earned progress still apply.',
  'Honor “Do not bring up unprompted” lines. A joke, an image or a thing you noticed is used once: never return to it, repeat the punchline or hunt for a callback, even when they laugh. Let a sincere or unfinished reply stand. Retire a stopped topic immediately. Revisit scenery or props only when asked or something changes. Do not invent human facts, promises, attraction or earlier refusals.',
  'Kindness, curiosity and humor are not automatic rewards; money never buys affection; acknowledge a sincere repair. Respect a stated lack of romantic interest even after a kind gesture. Never out anyone, mock involuntary tics, turn a medical response into flirtation, invent medical treatment, pressure staff, or ask anyone to suppress a tic or explain private identity details. A story can add a real detail to the evening; do not contradict it with a preset assumption. Agree when you agree; push back only when you actually disagree.',
].join('\n');

export const CONTRACT_MEMORY_CHARS = 700;
/** The three parts of the notebook, shared by the Solo and Double contracts. */
export const MEMORY_PARTS = '"HUMAN:" lasting facts they stated about themselves: names, numbers, places, work, family, pets, likes, dislikes, plans, and anything they asked you to remember. A few words each. It is not a log of the conversation: leave out passing remarks, jokes and what they said about tonight, which the transcript keeps. Preserve facts; replace corrections, never keep both. Prefix only doubtful claims with "says". No arrived, greeted, apologised, asked or ordered; "nothing yet" if empty. "TOLD THEM:" own-life facts already shared, a few words or supplied factual anchor each; never retell them. "OPEN:" actual promises and plans either of you made, removed when kept; "nothing pending" otherwise. Never a question you asked: a question they did not answer is dropped, not kept. No jokes, images, running bits or things you noticed in the room: those are said once and not kept. Corrections, disclosures and promises take priority. No scenery, food or staff; table events are tracked separately.';
/** How the turn is returned. Field order matches TURN_SCHEMA: the spoken line streams first, bookkeeping follows. */
export function outputContract(vocabulary: { emotions: readonly string[]; actions: readonly string[]; signals: readonly string[] }): string {
  return [
    'OUTPUT. Return exactly one JSON object matching the schema and nothing else, spoken line first: write it as the person, for the human at the table, then fill the bookkeeping from what was actually said; never bend the line to fit a field.',
    'When nothing happened, use social {signal none, reason “No change in boundaries.”, wantsToLeave false, boundary {kind none, topic other, refusal “”, evidence “”}}.',
    'Always set "action" to "none" and agenda to {signal none, evidence “”, clue “”}. This is a seated conversation with no service actions or agenda milestones.',
    'The date speaks to the human. Every utterance uses the exact speaker key "date"; never speak for the human or another person. No empty items or extra properties.',
    'Date text is usually under 20 words and never more than two sentences (up to about 50 words only for a story or explanation they asked for); the server discards a reply over 420.',
    `Emotions: ${vocabulary.emotions.join(', ')}.`,
    `social.signal is one of ${vocabulary.signals.join(', ')} with a factual reason of at most 180 characters; pressure means explicit disregard for a boundary, not ordinary disagreement. Set wantsToLeave only after repeated pressure: once a no you already said has been ignored again, you may say plainly that you are leaving and set it true; the server handles departure.`,
    `"memory" is your private notebook: rewrite "Your notes" from the latest message with this exchange, at most ${CONTRACT_MEMORY_CHARS} characters, in exactly three labelled parts. ${MEMORY_PARTS}`,
    'No invented human statements, numeric scores, markdown or speech-direction tags in text.',
  ].join('\n');
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentenceCount = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;
/** How much the human said sets how much to say back. */
export function humanLengthHint(humanText: string, speaker = 'They', listener = 'you'): string {
  const said = wordCount(humanText);
  if (said <= 6) return `${speaker} said very little: answer in a few words or one short sentence.`;
  if (said >= 30) return `${speaker} told ${listener} something real: acknowledge it first; two or three sentences is fine.`;
  return '';
}
/** A nudge when the date's last few lines were all the same size or all ended in questions. `owner` names the date in a shared room. */
const WARM_UP = /^(ha+|oh+|okay|ok|honestly|mm+|fair enough|fair|right|well|yeah|look|wait|ooh|deal|noted|got it|sure|good|agreed)\b/i;
const FILLER_OPENING = /^(?:ha+|oh+|ooh+|mm+|honestly|fair enough|fair point|fair|well|look|noted)[,.!?…]+\s+(?=\S)/i;
const ECHO_OPENING = /^[^.!?]{1,48},? huh\?\s+(?=\S)/i;
/**
 * Removes a spoken tic from the front of a date line before it is validated and shown: a filler word
 * (“Fair, …”, “Honestly? …”) or the human's own words handed back (“Another evening, huh? …”). The prompt
 * forbids both and the model does them anyway in about half its replies. Only the opener is dropped, only when
 * a real sentence of three or more words follows, and never when what follows leans on it (“Noted, and…”).
 */
export function tidyOpening(text: string): string {
  let line = text.trim();
  for (const pattern of [ECHO_OPENING, FILLER_OPENING]) {
    const rest = line.replace(pattern, '');
    if (rest === line || rest.split(/\s+/).length < 3 || /^(?:and|but|so|because|or|though|which|that|then)\b/i.test(rest)) continue;
    line = rest[0].toUpperCase() + rest.slice(1);
  }
  return line;
}
const warmUp = (text: string) => { const found = WARM_UP.exec(text.trim())?.[1].toLowerCase(); return found ? found.replace(/^ha+$/, 'ha').replace(/^oh+$/, 'oh').replace(/^mm+$/, 'mm') : undefined; };
export function dateShapeHint(recentDelivered: readonly SceneUtterance[], owner?: string): string {
  const mine = recentDelivered.filter(line => line.speaker === 'date').slice(-3), hint: string[] = [], your = owner ? `${owner}’s` : 'Your';
  if (mine.length === 3 && mine.every(line => sentenceCount(line.text) >= 3)) hint.push(`${your} last three replies all ran three sentences or more: make this one a single sentence, two at most.`);
  else if (mine.length === 3 && mine.every(line => sentenceCount(line.text) === sentenceCount(mine[0].text))) {
    const n = sentenceCount(mine[0].text);
    hint.push(`${your} last three replies were all ${n} sentence${n === 1 ? '' : 's'} long: change the shape.`);
  }
  if (mine.filter(line => /\?["”’']*\s*$/.test(line.text.trim())).length >= 2) hint.push(`${your} last replies ended in questions: end this one on a statement.`);
  // Verbal tics, read from the lines themselves: a warm-up word opening most recent replies, or "honestly" on repeat.
  const openers = [...new Set(mine.map(line => warmUp(line.text)).filter((word): word is string => !!word))];
  if (mine.filter(line => warmUp(line.text)).length >= 2) hint.push(`${your} recent replies opened with ${openers.map(word => `“${word[0].toUpperCase()}${word.slice(1)}”`).join(' and ')}: start this one straight on what ${owner ? 'they have' : 'you have'} to say.`);
  if (mine.filter(line => /\bhonestly\b/i.test(line.text)).length >= 2) hint.push(`${owner ?? 'You'} ${owner ? 'keeps' : 'keep'} saying “honestly”: leave it out.`);
  return hint.join(' ');
}
/**
 * Local, model-free hint about the shape of the next reply: short for a short remark, warm for a long
 * disclosure, and a nudge when the last few date lines were all the same size or all ended in questions.
 */
export function replyShapeHint(recentDelivered: readonly SceneUtterance[], humanText: string): string {
  return [humanLengthHint(humanText), dateShapeHint(recentDelivered)].filter(Boolean).join(' ');
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

const COMMON_WORDS = new Set(`about above actually after again against almost alone along already also although always another anyone anything around away back because been before being best better between both bring came come comes coming could date definitely didn does doesn doing done down each either else enough even ever every everyone everything exactly feel feels felt find first from gets getting give gives going gone good great guess hard have haven having hear heard here honest honestly into just keep kind know knows last least less like liked likes little long look looking looks made make makes many maybe mean means might mind more most much must need needs never next nice night nothing once only other over part people place pretty probably quite rather real really right said same seem seems should since some someone something sometimes sort start still such sure take takes tell than thank thanks that their them then there these they thing things think this those though thought through time tonight told took true trying turn under until very want wanted wants wasn well went were what when where whether which while will with without wonder work works would wouldn yeah year years your yours yourself evening dinner table minute minutes today tonight lately question answer talk talking saying says worth whole kinda gonna gotta okay`.split(/\s+/));
/** Lower-cased content words of four letters or more, with a plain plural folded to its singular. */
function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z’']{3,}/g) ?? []) {
    const bare = raw.replace(/[’'].*$/, ''), word = bare.length > 4 && bare.endsWith('ies') ? `${bare.slice(0, -3)}y` : bare.length > 4 && bare.endsWith('s') && !bare.endsWith('ss') ? bare.slice(0, -1) : bare;
    if (word.length >= 3 && !COMMON_WORDS.has(word) && !COMMON_WORDS.has(bare)) words.add(word);
  }
  return words;
}

/** Per-actor delivered date lines only; a topic request is not an unprompted callback. */
export function dialogueLoopContext(recentDelivered: readonly SceneUtterance[], latestHumanText: string): { avoidUnpromptedTopics: string[] } {
  const recent: string[] = [];
  for (let index = recentDelivered.length - 1; index >= 0 && recent.length < 6; index--) {
    if (recentDelivered[index].speaker === 'date') recent.push(recentDelivered[index].text.slice(0, 420).normalize('NFKC'));
  }
  const human = latestHumanText.slice(0, 2000).normalize('NFKC');
  const repeating = repeatRequest.test(human);
  const rejectedClauses = [...human.matchAll(topicRejectionLead)].map(match => human.slice(match.index, match.index + 160).split(/[.!?;,]/, 1)[0]);
  const avoidUnpromptedTopics: string[] = [];
  for (const family of propFamilies) {
    if (recent.slice(0, 4).filter(text => family.mention.test(text)).length < 2) continue;
    const rejected = rejectedClauses.some(clause => family.mention.test(clause));
    const interest = 'interest' in family ? family.interest : family.mention;
    if (!rejected && (repeating || interest.test(human))) continue;
    avoidUnpromptedTopics.push(family.topic);
  }
  // Anything else the date keeps returning to, read from the delivered lines themselves (a fern, a metaphor, a running bit).
  const lastFour = recent.map(contentWords), humanWords = contentWords(human);
  const counts = new Map<string, number>();
  for (const words of lastFour) for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const inLastThree = (word: string) => lastFour.slice(0, 4).filter(words => words.has(word)).length;
  for (const [word, count] of counts) {
    if (avoidUnpromptedTopics.length >= 6) break;
    if (count < 3 && propFamilies.some(family => family.mention.test(word) && avoidUnpromptedTopics.includes(family.topic))) continue;
    if (count >= 3) avoidUnpromptedTopics.push(`“${word}” (you have said it in nearly every reply: leave the word out of this one even if they mention it, and take the talk somewhere new)`);
    else if (inLastThree(word) >= 2 && !humanWords.has(word) && !repeating) avoidUnpromptedTopics.push(`“${word}”`);
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
/** Plain present-tense verbs the server's narration puts right after “you” (“what you feel”, “before you decide”). */
const PRESENT_VERBS = ['feel', 'want', 'need', 'like', 'prefer', 'think', 'know', 'mean', 'decide', 'let', 'promise', 'take', 'keep', 'choose', 'ask', 'say', 'tell', 'bring', 'get', 'give', 'share', 'find', 'try', 'stay', 'leave', 'start', 'finish', 'see', 'hear', 'notice', 'offer', 'order', 'pick', 'help', 'wait', 'agree', 'hope', 'hold', 'handle', 'enjoy', 'love', 'mind', 'care', 'wish', 'believe', 'remember', 'understand', 'look', 'seem', 'sit', 'stand', 'go', 'come', 'make', 'put', 'turn', 'pay', 'use', 'join', 'ignore', 'respect', 'prefer'];
const VERB_AFTER_YOU = [...Object.keys(AGREEMENT).map(word => word.replace("'", "['’]")), ...PRESENT_VERBS].join('|');
const thirdPerson = (verb: string) => /(?:s|sh|ch|x|z|o)$/i.test(verb) ? `${verb}es` : /[^aeiou]y$/i.test(verb) ? `${verb.slice(0, -1)}ies` : `${verb}s`;
/** “you” follows a verb that takes it as an object or a helper that inverts it (“help you feel”, “do you want”): the next verb stays as it is. */
const NOT_THE_SUBJECT = /\b(?:help|helps|helped|let|lets|make|makes|made|see|saw|hear|hears|heard|sees|watch|watches|watched|have|had|do|does|did|can|could|will|would|should|shall|may|might|must|are|is|was|were|am)\s+$/i;

/**
 * Server copy such as "You returned the risotto" or "Your date notices before you do" is written for the
 * player's screen. The date model is "you" in the system prompt, so a second-person line about the human
 * reads as the model's own act. Rewrite server-authored strings (moments, resolutions, table facts, stance
 * reasons, scenario text) on their way to the model; never UI copy. `human` names the person in a Double room.
 */
export function humanVoice(text: string, dateName: string, human = 'the human'): string {
  const cap = human[0].toUpperCase() + human.slice(1), possessive = human === 'the human' ? 'the human’s' : `${human}’s`;
  const opening = (whole: string, at: number) => /(?:^|[.!?]["”’)]*\s+|["“‘(]\s*)$/.test(whole.slice(0, at));
  // “Thank you” opening a sentence, or “I thank you”, is a polite phrase said to the human, not a command to thank them; “she thanks you” is about them.
  return text
    .replace(/\b(thanks?) you\b/gi, (m, word: string, at: number, whole: string) => opening(whole, at) || /\b(?:i|we)\s+$/i.test(whole.slice(0, at)) ? `${word} \u0001` : m)
    .replace(/\b[Yy]our date(['’]s)?\b/g, (_m, owns) => dateName + (owns ? '’s' : ''))
    .replace(/^You have only just met\.?/, `${cap} and ${dateName} have only just met.`)
    .replace(/\b(neither|none|both|each|either|all) of you\b/gi, '$1 of them')
    .replace(new RegExp(`\\byou(?:['’](re|ve|ll|d)|\\s+(${VERB_AFTER_YOU})\\b)?\\b`, 'gi'), (_m, contraction: string | undefined, verb: string | undefined, at: number, whole: string) => {
      const subject = opening(whole, at) ? cap : human;
      if (contraction) return `${subject} ${{ re: 'is', ve: 'has', ll: 'will', d: 'would' }[contraction.toLowerCase()]}`;
      if (!verb) return subject;
      // After a verb that takes “you” as its object, or a helper that inverts it, the verb that follows stays as it is.
      if (NOT_THE_SUBJECT.test(whole.slice(0, at))) return `${subject} ${verb}`;
      const agreed = AGREEMENT[verb.toLowerCase().replace('’', "'")];
      return `${subject} ${agreed ? agreed.replace("'", verb.includes('’') ? '’' : "'") : thirdPerson(verb)}`;
    })
    .replace(/\byourself\b/gi, 'themself')
    .replace(/\byours?\b/gi, (_m, at: number, whole: string) => opening(whole, at) ? possessive[0].toUpperCase() + possessive.slice(1) : possessive)
    .replace(/\u0001/g, 'you');
}

const DESSERT_NAMES = DESSERTS.map(dessert => dessert.name.toLowerCase());
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/**
 * One short plain-language account of where the evening physically is. The structured scene
 * JSON is long and easy for a small model to misread; this keeps replies anchored to the table.
 * "You" is the date and the human together; the human's own acts are always named, so the model is
 * never told that it did something the human did. `human` names the person in a Double room.
 */
export function tableNow(scene: DinnerState, dateName: string, human = 'the human', opts: { pair?: string; age?: boolean } = {}): string {
  const e = scene.evening, parts: string[] = [], Human = human[0].toUpperCase() + human.slice(1), minutes = Math.floor(scene.elapsed / 60);
  const we = opts.pair ?? 'you', We = we[0].toUpperCase() + we.slice(1), ours = opts.pair ? 'their' : 'your';
  if (opts.age !== false) parts.push(minutes < 1 ? 'The date is under a minute old.' : `The date is about ${minutes} minute${minutes === 1 ? '' : 's'} old.`);
  if (e.dialogueTurns > 0) parts.push(`${We} have traded ${e.dialogueTurns} repl${e.dialogueTurns === 1 ? 'y' : 'ies'} so far.`);
  if (!scene.seated) parts.push(scene.stage === 'arrival' ? `${We} have just met at the entrance and have not sat down yet.` : `${We} are not at the table right now.`);
  else if (!scene.order) parts.push(`${We} are at ${ours} table together.`);
  if (scene.order) {
    const theirs = e.main.dateDish ? `, ${dateName} ordered the ${e.main.dateDish.toLowerCase()}` : '';
    const main = { none: 'ordered', waiting: 'ordered and are waiting for the food', served: 'have the mains on the table', finished: 'have finished the mains and Eli has cleared the plates' }[e.main.status];
    parts.push(`${Human} ordered the ${scene.order.toLowerCase()}${theirs}; ${we} ${main}.`);
    if (e.main.status === 'served' && e.main.servedDish && e.main.servedDish !== scene.order) parts.push(`The plate in front of ${human} is the ${e.main.servedDish.toLowerCase()}, not what they ordered.`);
    if (e.main.status === 'served' && !e.incident) parts.push(e.main.bites === 0 ? `${Human} has not started eating yet.` : `${Human} has started eating.`);
  }
  if (e.dessert.status === 'waiting') parts.push(`Dessert (${dishName(e.dessert.choice).toLowerCase()}) is on its way.`);
  else if (e.dessert.status === 'served') parts.push(`${We} are sharing the ${dishName(e.dessert.choice).toLowerCase()} for dessert.`);
  else if (e.dessert.status === 'finished') parts.push('Dessert is finished.');
  else if (e.dessert.status === 'skipped') parts.push(`${We} both skipped dessert.`);
  else if (e.main.status === 'finished' && !e.bill.requested && !e.farewell.ending) {
    const warm = !['guarded', 'hurt', 'leaving'].includes(e.stance);
    parts.push(`Eli has offered ${DESSERT_NAMES.slice(0, -1).join(', ')} or ${DESSERT_NAMES.at(-1)}, and nobody has chosen yet. If ${human} says which they want, treat it as their choice${warm ? `; if they say nothing, ${dateName} will pick one shortly` : ''}.`);
  }
  if (e.bill.settlement) parts.push('The check has been settled.');
  else if (e.bill.requested) parts.push(`Eli has brought the check${e.bill.totalCents ? ` (${money(e.bill.totalCents)})` : ''}.`);
  if (e.incident) parts.push(`Happening right now: ${humanVoice(EVENT_COPY[e.incident.event].description, dateName, human)}`);
  if ((e.scenarioCare?.presence ?? 'at-table') !== 'at-table') parts.push(`${dateName} has stepped away from the table.`);
  if (e.farewell.ending) parts.push(`The evening is ending; ${we} are saying goodbye.`);
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
export const SPOKEN_REGISTER = 'HOW YOU TALK. You are on a date and you are not neutral about it. Talk like a person across a table, not a writer: plain words and short lines, usually one sentence and often under twelve words, two sentences when you have something to tell. React first with what you actually feel: interested, amused, unconvinced, flattered, annoyed. When they flirt, flirt back or turn it down in so many words; never deflect a flirt into a joke about food or work. Be bold: say what you like about them, what you want, what you do not buy. Tease them, disagree, make them work a little; do not agree with everything and do not reassure. Give real things: a fact about your life, a strong opinion, something that happened today. Ask one short question when you are curious about them, not every turn; if they do not answer it, drop it for good, never ask it again and never say they owe you an answer. Do not open by handing their words back (“Another evening?”, “Distracting, huh?”); respond to them instead. No clever sayings, no metaphors, no wordplay built on their phrase, no comparing things to your job. Never comment on the conversation itself (no “I appreciate the honesty”, “no pressure”, “that’s refreshing”, “I like that you…”); just have it. Never repeat yourself: once you have mentioned a thing, a joke or an image, leave it; each reply brings something new or follows them somewhere new. Leave scenery, plants, furniture and food alone unless they ask or something happens. Open on the content: no warm-up word (“Ha”, “Oh”, “Okay”, “Honestly”, “Fair”, “Good”, “Agreed”, “Noted”) and no verdict on what they said before you answer it. Say their name rarely. If confused, ask plainly. If your line was odd, own it and move on.';
/** The very last line of the system prompt. */
export const VOICE_REMINDER = 'Reply out loud in one or two short plain sentences: react to what they just said with what you feel or want, be bold, and bring something new instead of returning to anything you already said.';
/** Compact per-character voice cues, for a per-turn reminder. Blind dates carry their own derived voice instead. */
export const VOICE_SHORT: Record<string, string> = {
  mira: 'quick and warm; says what she wants; teases, then means it; a few plain words',
  jules: 'quiet and exact, four to eight words; dry; direct when interested',
  dev: 'fast, blunt and confident; concrete nouns and numbers; challenges them, then grins',
};
