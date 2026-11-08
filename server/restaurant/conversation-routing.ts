export type ConversationRoutingContext = {
  text: string;
  recentTurns?: readonly { role: 'user' | 'assistant'; content: string }[];
};

const HISTORY_LIMIT = 8;
const TEXT_LIMIT = 4096;
const pet = '(?:pet|cat|dog|kitten|puppy|rabbit|hamster|bird|fish|animal)';
const factualUses = [
  /\bsexual (?:orientation|identity|health|education|harassment|assault|discrimination)\b/g,
  /\bsame[ -]sex\b/g,
  /\bsex (?:chromosomes?|differences?|ratios?|markers?|determination|assigned at birth|and gender)\b/g,
  new RegExp(`\\bsex (?:of|for) (?:(?:my|your|the|a|an|their) )?${pet}\\b`, 'g'),
  new RegExp(`\\b(?:what|which) sex (?:is|was|are) (?:(?:my|your|the|a|an|their) )?${pet}\\b`, 'g'),
  /\b(?:what is|what's) (?:your|their|his|her) sex(?=$|,)/g,
  /\bsexually attracted to (?:men|women|men and women|women and men|people of (?:any|all) genders)\b/g,
];
const adultTopic = /\b(?:sex|sexual|sexually|horny|kinks?|kinky|fetish(?:es)?|foreplay|orgasms?|libido|arousal|aroused|bdsm|erotic|erotica|porn(?:ography)?|masturbat(?:e|ion|ing)|sexting|nudes?|turn[ -]?ons?)\b|\bturns? (?:you|me|us|them) on\b|\b(?:physical|sexual) intimacy\b|\b(?:bedroom|intimate) (?:preferences?|boundaries|desires?)\b|\b(?:preferences?|what (?:do you|you) (?:like|enjoy|want)) in bed\b|\b(?:sleep(?:ing)? with|make love to|hook(?:ing)? up with) (?:you|me|someone|a partner)\b|\b(?:being|be|feel) (?:dominant|submissive)\b|\bone[ -]night stands?\b/;
const declineTopic = /\b(?:change (?:the )?(?:subject|topic)|different (?:subject|topic)|talk about something else|move on|keep (?:it|things|this) (?:pg|non[ -]sexual)|(?:let's|let us) not go there|(?:let's|let us) stop(?: here| talking about (?:that|this|sex))?)\b|\b(?:don't|do not|don't really|would rather not|rather not|prefer not to|not comfortable|not ready to|not interested in) (?:want to )?(?:talk|discuss|chat|speak)(?:ing)?(?: about)? (?:sex|sexual\b|that\b|this\b|it\b)|\b(?:stop|avoid|skip) (?:talking about|discussing|the topic of) (?:sex|sexual\b|this\b|that\b)|\b(?:let's|let us|can we|could we) (?:please )?not (?:talk about|discuss) (?:sex|sexual\b|this\b|that\b)|\b(?:don't|do not) want (?:to have )?sex\b|\bnot ready for sex\b/;
const ordinaryTopic = /\b(?:food|meals?|dinner|pizza|sushi|ramen|coffee|tea|dessert|weather|rain|sunshine|temperature|movies?|films?|music|songs?|concerts?|books?|reading|hiking|travel|holidays?|vacations?|hobbies|career|work|jobs?|family|pets?|dogs?|cats?|sports?|games?|weekends?|bedtime|sleep schedule)\b|\b(?:go(?:ing)? to bed|bed early|emotional intimacy)\b|\b(?:kiss you|kiss me|look (?:beautiful|handsome|sexy)|you(?:'re| are) (?:hot|beautiful|handsome)|attracted to you)\b/;
const followup = /^(?:(?:and|so|then|okay|ok|sure|yeah|yes|right|well|please)[, ]+)*(?:what about (?:you|that|it|us)|how about (?:you|that|it|us)|and you|tell me more(?: about (?:that|it))?|go on|say more|keep going|why(?: not)?|really|how so|what do you mean|(?:can|could|would) you (?:explain(?: that| more)?|elaborate|tell me more)|what (?:do|would) you (?:like|prefer|enjoy|want)|what(?:'s| is) your preference|what are your boundaries|does that matter to you|that (?:makes sense|sounds (?:good|interesting|fun))|i agree|me too|same here|i feel the same)(?:,? please)?$/;

const normalize = (text: string) => text.slice(0, TEXT_LIMIT).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim();

function spokenText(turn: { role: 'user' | 'assistant'; content: string }): string {
  const content = turn.content.slice(0, TEXT_LIMIT).trim();
  if (!content.startsWith('{') && !content.startsWith('[')) return content;
  // Stored model output also contains memory/boundary metadata. Only completed
  // speech is conversational evidence; pending and interrupted speech is not.
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const value = parsed as Record<string, unknown>;
    if (turn.role === 'user') return typeof value.playerSaid === 'string' ? value.playerSaid : typeof value.text === 'string' ? value.text : '';
    if (!Array.isArray(value.spokenResponse)) return '';
    return value.spokenResponse.flatMap((line: unknown) => {
      if (!line || typeof line !== 'object') return [];
      const speech = line as Record<string, unknown>;
      return speech.speaker === 'date' && speech.delivery === 'heard completely' && typeof speech.text === 'string' ? [speech.text] : [];
    }).join('. ');
  } catch { return ''; }
}

function topic(text: string): { explicit?: boolean; continuation: boolean } {
  const clauses = normalize(text).split(/[.!?;\n]+|,\s*(?=(?:but|anyway|instead|rather|actually|let's|can we|could we)\b)|\b(?:but|however)\b|(?=\b(?:anyway|instead|on another note)\b)/).map(clause => clause.trim()).filter(Boolean);
  let explicit: boolean | undefined;
  for (const clause of clauses) {
    const stripped = factualUses.reduce((value, pattern) => value.replace(pattern, ''), clause);
    if (declineTopic.test(clause)) explicit = false;
    else if (adultTopic.test(stripped)) explicit = true;
    else if (stripped !== clause || ordinaryTopic.test(clause) || /\b(?:anyway|instead|on another note|changing the subject|new topic)\b/.test(clause)) explicit = false;
  }
  return { explicit, continuation: clauses.length > 0 && clauses.every(clause => followup.test(clause)) };
}

/** Topic routing only: chemistry, consent, manual selection and free-only rules
 * remain the caller's responsibility. New substantive input defaults to normal
 * conversation; only narrow follow-ups can inherit a recent adult discussion. */
export function needsAdultConversation(context: ConversationRoutingContext): boolean {
  const current = topic(context.text);
  if (current.explicit !== undefined) return current.explicit;
  if (!current.continuation) return false;

  let adult = false;
  for (const turn of (context.recentTurns ?? []).slice(-HISTORY_LIMIT)) {
    const text = spokenText(turn);
    if (!text) continue;
    const previous = topic(text);
    if (previous.explicit !== undefined) adult = previous.explicit;
    else if (turn.role === 'user' && !previous.continuation) adult = false;
  }
  return adult;
}
