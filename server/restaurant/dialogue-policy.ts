import { AUTHORED_UTTERANCES } from '../../src/restaurant/authored';
import type { DinnerState, SceneUtterance } from '../../src/restaurant/types';

/** Shared turn direction; this does not schedule requests or change character boundaries. */
export const DATE_DIALOGUE_INSTRUCTIONS = 'Respond to the latest human meaning first. Recognize obvious adult innuendo instead of repeatedly interpreting it as a food order. Keep flirtation playful and responsive, following the selected provider’s content instructions. Adults can reciprocate, tease, decline or steer gently in their distinct voices; skepticism can coexist with attraction. Do not make every flirt a trust exam. Respond specifically to surprising claims or meaningful disclosures with appropriate emotion and a relevant follow-up when useful, without forced shock at personal traits or mocking identity or illness. If someone claims to be using this date as cover, question the concrete motive and your involvement rather than giving a generic trust lecture. Unusual claims remain unverified: clarify gently, do not establish impossible events as scene facts or affirm a medical diagnosis. Honor avoidUnpromptedTopics and explicit requests to stop a topic. Avoid scenery, props or old jokes from recent replies unless the human brings them back or a real new incident makes them relevant. Do not retain scenery jokes in memory without genuine human interest. Setting details never replace an answer. Do not invent human facts, promises, attraction or earlier refusals. Provider limits differ from personal boundaries: redirect briefly when necessary without accusing the player of ignoring an unspoken refusal. Continue after a respected redirection without looping it.';

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

type ReusableLine = Pick<SceneUtterance, 'speaker' | 'text' | 'emotion'>;
const lineKey = (line: Pick<SceneUtterance, 'speaker' | 'text'>) => JSON.stringify([line.speaker, line.text]);

/** Only offer clips that still fit the current scene and have not just been delivered. */
export function reusableDialogueLines(scene: DinnerState, recentDelivered: readonly SceneUtterance[]): ReusableLine[] {
  const incident = scene.evening.incident?.event;
  const greetingsFit = !incident && !scene.order && (scene.stage === 'arrival' || scene.stage === 'seated');
  const delivered = new Set(recentDelivered.map(lineKey));
  const seen = new Set<string>();
  const candidates = AUTHORED_UTTERANCES.filter(line => {
    if (line.cue === 'opening' || line.clipId.startsWith('story-')) return false;
    if (scene.blindDate && line.speaker === 'date') return false;
    if (line.dateId && line.dateId !== scene.dateId) return false;
    if (line.cue === 'greeting' && !greetingsFit) return false;
    if (line.event && line.event !== incident) return false;
    const key = lineKey(line);
    if (delivered.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Active incidents take precedence if the authored catalog grows. Keep the prompt bounded.
  candidates.sort((left, right) => Number(!!right.event) - Number(!!left.event));
  return candidates.slice(0, 8).map(({ speaker, text, emotion }) => ({ speaker, text, emotion }));
}
