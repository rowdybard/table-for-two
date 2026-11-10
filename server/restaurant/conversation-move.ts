// How the date should play the next turn, read locally from what the human just said. Deterministic server code:
// no model call, no provider, no spend. The model still writes every word; this only says, in a sentence or two
// next to the human's words, what kind of reply the moment wants (answer the question, react to the flirt, take
// the lead after a short answer). Solo and Double share it.
import { getDate } from '../../src/restaurant/content';
import { CHARACTER_STORIES } from '../../src/restaurant/story';
import { isTopicStopRequest } from '../../src/restaurant/conversation-content';
import type { DateId, SceneUtterance } from '../../src/restaurant/types';

export type HumanMove = 'stop' | 'question' | 'bounce' | 'flirt' | 'joke' | 'disclosure' | 'opinion' | 'short';
export interface HumanRead {
  moves: HumanMove[];
  /** The questions put to the date, in the human's words, at most three. */
  questions: string[];
  /** The date's own earlier question that the human turned back on them ("what about you?"). */
  bounced?: string;
  words: number;
}

const normalize = (text: string) => text.normalize('NFKC').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
const LEAD = String.raw`(?:(?:um+|uh+|oh+|ok(?:ay)?|so|and|but|well|wait|hey|hmm+|haha|lol|honestly|seriously|actually|alright|right|anyway|ooh|ah)[\s,]+)*`;
const WH = String.raw`(?:what|what's|whats|where|where's|when|why|how|how's|who|who's|which|whose)`;
const AUX = String.raw`(?:do|does|did|are|is|was|were|have|has|had|can|could|would|will|should|shall|may|might)(?:n't)?`;
const SUBJECT = String.raw`(?:you|ya|u|your|it|that|this|there|they|he|she|we|i|anyone|anybody|people)`;
/** A sentence that asks, with or without a question mark (an automatic transcript rarely adds one). */
const ASKS = new RegExp(String.raw`^${LEAD}(?:${WH}\b|${AUX}\s+${SUBJECT}\b|tell me\b|any (?:pets|siblings|plans|kids)\b|got any\b|ever (?:been|tried|had)\b)`, 'i');
/** The human hands the date's own question back: "and you?", "what about you", "wbu". */
const BOUNCE = new RegExp(String.raw`^${LEAD}(?:(?:and|so|what|how) about (?:you|yourself|u)|and (?:you|yourself|u)|you|yourself|wbu|hbu|same question|same to you|your turn|you go|what do you think|how about you)\b[\s,.!?]*$`, 'i');
const FLIRT = /\b(?:you(?:'re| are| look| seem)\s+(?:so\s+|really\s+|very\s+|kinda\s+|kind of\s+|pretty\s+|quite\s+)?(?:cute|pretty|beautiful|gorgeous|handsome|hot|sexy|attractive|stunning|adorable|charming|lovely|sweet|amazing|fun|funny|interesting|cool|nice|great|good)|your\s+(?:eyes|smile|laugh|voice|hair|outfit|dress)|(?:i\s+)?(?:like|fancy|adore)\s+you|into you|crush on you|kiss(?:ing)? you|flirt\w*|cutie|second date|see you again)\b/i;
const JOKE = /(?:\b(?:lol|lmao|lmfao|rofl|haha+|hehe+|jk|just kidding|kidding|joking)\b|😂|🤣|😜|😉)/i;
const DISCLOSURE = /\b(?:i\s+(?:feel|felt)\b|i(?:'m| am)\s+(?:so\s+|really\s+|kind of\s+|a bit\s+)?(?:sad|stressed|nervous|anxious|lonely|scared|worried|overwhelmed|exhausted|burnt out|burned out|heartbroken|grieving)|passed away|died|lost my|got fired|laid off|broke up|divorc\w*|depress\w*|therapy|diagnos\w*|miss (?:her|him|them|my)|hard (?:time|year|week))\b/i;
const OPINION = /\b(?:i think|i reckon|i feel like|i (?:love|hate|can't stand|cannot stand|prefer|refuse)|overrated|underrated|the best|the worst|(?:is|are) (?:better|worse) than|hot take|unpopular opinion)\b/i;

const sentencesOf = (text: string) => normalize(text).split(/(?<=[.!?…])\s+|\n+/).map(item => item.trim()).filter(Boolean);
const lastQuestionIn = (text: string) => (text.match(/[^.!?]*\?/g) ?? []).map(item => item.trim()).filter(Boolean).at(-1);

/** What kind of turn the human just took. Each pattern is narrow; a miss only drops one hint line. */
export function readHumanTurn(humanText: string, lastDateLine?: string): HumanRead {
  const text = normalize(humanText).slice(0, 2000), words = wordCount(text), moves: HumanMove[] = [], questions: string[] = [];
  let bounced: string | undefined;
  if (isTopicStopRequest(text)) moves.push('stop');
  for (const sentence of sentencesOf(text)) {
    const bare = sentence.replace(/[\s.!?…]+$/, '');
    if (BOUNCE.test(sentence)) { bounced = (lastDateLine && lastQuestionIn(lastDateLine)) || ''; continue; }
    if (/\?\s*$/.test(sentence) || ASKS.test(bare)) { if (questions.length < 3) questions.push(sentence.length > 140 ? `${sentence.slice(0, 137).replace(/\s+\S*$/, '')}…` : sentence); }
  }
  if (questions.length) moves.push('question');
  if (bounced !== undefined) moves.push('bounce');
  if (FLIRT.test(text)) moves.push('flirt');
  if (JOKE.test(text)) moves.push('joke');
  if (DISCLOSURE.test(text) || (words >= 30 && !questions.length)) moves.push('disclosure');
  if (!questions.length && OPINION.test(text)) moves.push('opinion');
  if (!questions.length && bounced === undefined && words <= 4 && !moves.includes('flirt') && !moves.includes('stop')) moves.push('short');
  return { moves, questions, ...(bounced !== undefined ? { bounced } : {}), words };
}

/* ------------------------------------------------------------------ answerable facts */

type Topic = 'work' | 'home' | 'family' | 'free time' | 'food' | 'culture' | 'age';
const TOPICS: { topic: Topic; asks: RegExp }[] = [
  { topic: 'work', asks: /\b(?:work|working|job|jobs|career|profession|occupation|for (?:a )?living|what do you do|do you do)\b/i },
  { topic: 'age', asks: /\b(?:how old|your age)\b/i },
  { topic: 'family', asks: /\b(?:family|siblings?|sisters?|brothers?|parents|mom|mum|dad|grand(?:ma|pa|mother|father|parents?)|relatives)\b/i },
  { topic: 'home', asks: /\b(?:where (?:are|do) (?:you|u) (?:from|live|stay)|where(?:'s| is) home|live (?:around|near|nearby|close)|grow up|grew up|hometown|your (?:place|flat|apartment|neighbou?rhood))\b/i },
  { topic: 'free time', asks: /\b(?:free time|spare time|weekends?|for fun|hobb(?:y|ies)|downtime|after work|evenings|relax|unwind)\b/i },
  { topic: 'food', asks: /\b(?:favou?rite (?:food|dish|meal|dessert)|cook|cooking|cuisine|eat|eating|order(?:ing)?|hungry|dessert)\b/i },
  { topic: 'culture', asks: /\b(?:music|band|bands|songs?|concerts?|gigs?|movies?|films?|books?|read|reading|shows?|tv|series)\b/i },
];

/**
 * Everyday facts each preset date can say plainly when asked. Drawn from their story; the private hope each of them is
 * carrying (an exhibition, a recipe of their own, a food truck) is deliberately absent, so it still comes out gradually.
 */
export const PLAIN_FACTS: Record<DateId, Partial<Record<Topic, string>>> = {
  mira: {
    work: 'freelance photographer: weddings, small music venues, portraits for local shops',
    home: 'a tiny flat above a bakery, for three years now',
    family: 'older sister Ada, who calls Mira everyone’s emergency contact',
    'free time': 'cycling everywhere, live music after a good week, voice notes to herself she forgets to play',
    food: 'tomato rigatoni, crunchy bread, chocolate fondant; hates overcooked vegetables',
    culture: 'small gigs and live music; likes an encore only when the singer means it',
  },
  jules: {
    work: 'book restorer at a small conservation workshop: bindings, paper tears, damaged family books',
    family: 'grandmother Inez, alive and opinionated, who taught them to cook and still texts corrections',
    'free time': 'old films on Tuesday evenings, independent bookshops, unglamorous museum postcards',
    food: 'mushroom risotto, lemon posset; dislikes truffle oil drowning a dish',
    culture: 'old films, rereading favourite books, independent bookshops',
  },
  dev: {
    work: 'bicycle mechanic who cooks ambitious dinners for friends after work, an amateur rather than a chef',
    family: 'older sister Leena, his sauce taste-tester for years',
    'free time': 'pickup basketball on Thursdays, fixing friends’ bikes too cheaply, testing one sauce until he is sick of it',
    food: 'lemon and herb chicken, spicy food at home, strawberries and cream after a heavy meal; hates oversweet sauces',
  },
};

/** The plain facts a question touches, at most two, for a preset date or a blind date's own occupation. */
export function answerFacts(dateId: DateId, questions: readonly string[], blind?: { occupation: string }): string[] {
  const asked = questions.join(' '), out: string[] = [];
  for (const { topic, asks } of TOPICS) {
    if (out.length >= 2 || !asks.test(asked)) continue;
    if (blind) { if (topic === 'work') out.push(`work: ${blind.occupation}`); continue; }
    const fact = topic === 'age' ? `${getDate(dateId)?.age ?? ''}`.trim() : PLAIN_FACTS[dateId]?.[topic];
    if (fact) out.push(`${topic}: ${fact}`);
  }
  return out;
}

/* ------------------------------------------------------------------ the move */

export interface MoveInput {
  dateId: DateId;
  humanText: string;
  /** The date's last delivered line, for "what about you?". */
  lastDateLine?: string;
  /** The date's recent delivered lines, oldest first. */
  recentDelivered?: readonly SceneUtterance[];
  /** The human's previous few turns, oldest first, not including this one. */
  previousHuman?: readonly string[];
  /** The human is asking what the date's last line meant; the clarification hint takes over. */
  clarifying?: boolean;
  /** Guarded, hurt or leaving: a flirt is not something to encourage. */
  guarded?: boolean;
  romanceClosed?: boolean;
  blind?: { occupation: string };
}

const quote = (text: string) => `“${text}”`;
const endsAsking = (line: SceneUtterance) => /\?["”’)]*\s*$/.test(line.text.trim());

/**
 * One or two plain sentences about what this reply should do, or an empty string when the turn needs no steer.
 * Written to the date as "you"; Double prefixes the date's name.
 */
export function conversationMove(input: MoveInput): string {
  if (input.clarifying) return '';
  const read = readHumanTurn(input.humanText, input.lastDateLine), out: string[] = [];
  const mine = (input.recentDelivered ?? []).filter(line => line.speaker === 'date').slice(-3);
  const askingLately = mine.length >= 2 && mine.slice(-2).every(endsAsking);
  const shortStreak = [...(input.previousHuman ?? [])].reverse().findIndex(text => wordCount(text) > 4 || /\?/.test(text));
  const previousShort = shortStreak === -1 ? (input.previousHuman ?? []).length : shortStreak;
  const has = (move: HumanMove) => read.moves.includes(move);

  if (has('stop')) out.push('They want to drop that topic: let it go without arguing and bring up something new and specific.');
  if (has('question')) {
    const facts = answerFacts(input.dateId, read.questions, input.blind);
    const many = read.questions.length > 1;
    out.push(`They asked you ${read.questions.map(quote).join(' and ')}. Answer ${many ? 'each one' : 'it'} in your first sentence with a real, specific answer${facts.length ? ` (true for you: ${facts.join('; ')})` : ''}; no dodging, and no handing it back before you have answered. If you truly don’t know, say so and guess.`);
  }
  if (has('bounce')) out.push(read.bounced ? `They turned your question back on you (${quote(read.bounced)}): answer it about yourself, as concretely as you hoped they would.` : 'They turned it back to you: give your own answer to what you were just talking about, concretely.');
  if (has('flirt')) out.push(input.romanceClosed || input.guarded
    ? 'They are flirting: you can notice it out loud, but answer as you actually feel right now, without encouraging more than you mean.'
    : 'They are flirting with you: react in the moment first, the way you really feel about it (pleased, flustered, teasing back, or a little cooler), instead of analysing it or changing the subject.');
  if (has('joke') && !has('question')) out.push('They are joking around: play along or top it with something specific before you get serious.');
  if (has('disclosure')) out.push(`They told you something real: respond to the specific detail first, by name. Then ${askingLately ? 'share a small parallel of your own' : 'ask one follow-up about it or share a small parallel of your own'}; no advice unless they ask.`);
  if (has('opinion')) out.push('They gave an opinion: take a side with your own reason; agreeing is fine, and friendly friction is fun.');
  if (has('short') && !has('joke')) out.push(previousShort >= 1 || askingLately
    ? 'Their answers are getting short and you have been doing the asking: stop interviewing and take the lead with your own story, opinion or tease, something easy to react to.'
    : 'Short answer: pick up one thing in it and add something of your own (an opinion, a small story, a tease) so they have something easy to answer. Don’t just acknowledge it.');
  return out.join(' ');
}
