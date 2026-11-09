import { EVENT_COPY } from '../../src/restaurant/content';
import { DESSERTS } from '../../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

/** Shared turn direction; this does not schedule requests or change character boundaries. */
export const DATE_DIALOGUE_INSTRUCTIONS = 'The message history is the real conversation so far, oldest first: what the human said, and what was spoken at the table with how much of it was heard. Lines from Eli, the neighbouring diner and the date’s own scripted remarks there really happened. Continue that conversation as one person who remembers it. Reply to what the human just said before anything else, in a way that only makes sense after their words; a line that could follow any message is wrong. Stay consistent with everything already said: never re-introduce yourself, retell a story or fact you already shared, contradict an earlier detail, or ask a question they already answered. Pick up threads the human started and let your own news come up only where it connects. If the latest words look like a speech-recognition slip, go with the most plausible meaning or ask a quick clarifying question instead of reacting to the literal garble. React to what was actually said in plain, believable terms first (a graduating class of under 70 is small, so say so) before any joke; never invent quirky made-up phrases or in-jokes the human has no way to understand. If the human is confused by something you said or asks what you meant, explain it plainly in one line or admit it was an odd thing to say, then move on; never repeat, double down on or build further on a remark that did not land. tableNow says where the evening physically is; never describe food, plates or staff that it does not mention. Respond to the latest human meaning first. Recognize obvious adult innuendo instead of repeatedly interpreting it as a food order. Keep flirtation playful and responsive, following the selected provider’s content instructions. Adults can reciprocate, tease, decline or steer gently in their distinct voices; skepticism can coexist with attraction. Do not make every flirt a trust exam. Respond specifically to surprising claims or meaningful disclosures with appropriate emotion and a relevant follow-up when useful, without forced shock at personal traits or mocking identity or illness. If someone claims to be using this date as cover, question the concrete motive and your involvement rather than giving a generic trust lecture. Unusual claims remain unverified: clarify gently, do not establish impossible events as scene facts or affirm a medical diagnosis. Honor avoidUnpromptedTopics and explicit requests to stop a topic. Avoid scenery, props or old jokes from recent replies unless the human brings them back or a real new incident makes them relevant. Do not retain scenery jokes in memory without genuine human interest. Setting details never replace an answer. Do not invent human facts, promises, attraction or earlier refusals. Provider limits differ from personal boundaries: redirect briefly when necessary without accusing the player of ignoring an unspoken refusal. Continue after a respected redirection without looping it.';

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
/**
 * One short plain-language line about where the evening physically is. The structured scene
 * JSON is long and easy for a small model to misread; this keeps replies anchored to the table.
 */
export function tableNow(scene: DinnerState, dateName: string): string {
  const e = scene.evening, parts: string[] = [];
  if (!scene.seated) parts.push(scene.stage === 'arrival' ? `You have just met at the entrance and have not sat down yet.` : 'You are not at the table right now.');
  else if (!scene.order) parts.push('You are seated at your table with menus; nothing has been ordered yet.');
  if (scene.order) {
    const theirs = e.main.dateDish ? `, ${dateName} ordered the ${e.main.dateDish.toLowerCase()}` : '';
    const main = { none: 'ordered', waiting: 'ordered and are waiting for the food', served: 'have the mains on the table', finished: 'have finished the mains and Eli has cleared the plates' }[e.main.status];
    parts.push(`The human ordered the ${scene.order.toLowerCase()}${theirs}; you ${main}.`);
    if (e.main.status === 'served' && e.main.servedDish && e.main.servedDish !== scene.order) parts.push(`The plate in front of the human is the ${e.main.servedDish.toLowerCase()}, not what they ordered.`);
  }
  if (e.dessert.status === 'waiting') parts.push(`Dessert (${dishName(e.dessert.choice).toLowerCase()}) is on its way.`);
  else if (e.dessert.status === 'served') parts.push(`You are sharing the ${dishName(e.dessert.choice).toLowerCase()} for dessert.`);
  else if (e.dessert.status === 'finished') parts.push('Dessert is finished.');
  else if (e.dessert.status === 'skipped') parts.push('You both skipped dessert.');
  if (e.bill.settlement) parts.push('The check has been settled.');
  else if (e.bill.requested) parts.push('Eli has brought the check.');
  if (e.incident) parts.push(`Happening right now: ${EVENT_COPY[e.incident.event].description}`);
  if ((e.scenarioCare?.presence ?? 'at-table') !== 'at-table') parts.push(`${dateName} has stepped away from the table.`);
  if (e.farewell.ending) parts.push('The evening is ending; you are saying goodbye.');
  parts.push(`The evening feels ${e.stance} to ${dateName} so far.`);
  return parts.join(' ');
}

type Message = { role: 'user' | 'assistant'; content: string };
/**
 * Providers want a conversation that starts with the human and alternates. The opening line
 * and interrupted turns can break that, so fold same-role neighbours together instead of
 * dropping either side of the exchange.
 */
export function alternatingMessages(messages: readonly Message[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const last = out.at(-1);
    if (last && last.role === message.role) last.content = `${last.content}\n${message.content}`;
    else out.push({ ...message });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '[The evening begins. The human arrives at the restaurant.]' });
  return out;
}
