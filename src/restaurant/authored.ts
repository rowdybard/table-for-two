import { DATES } from './content';
import { getStoryCue, STORY_CUE_KEYS, STORY_CUE_VARIANTS, type StoryCueKey } from './story';
import type { DateId, DinnerEvent, SceneUtterance } from './types';

export interface AuthoredUtterance extends SceneUtterance { clipId: string; dateId?: DateId; event?: DinnerEvent; cue: string }
/** Fixed lines can be voiced once by the optional pre-generation CLI and reused exactly. */
const LEGACY_UTTERANCES: AuthoredUtterance[] = [
  // The opening is the date's spoken welcome, so the two share one clip rather than two near-identical recordings.
  ...DATES.map(date => ({ clipId: `opening-${date.id}`, dateId: date.id, cue: 'opening' as const, speaker: 'date' as const, text: date.opening, emotion: getStoryCue('welcome', date.id).find(line => line.speaker === 'date')?.emotion ?? 'neutral' })),
  { clipId: 'greeting-waiter', cue: 'greeting', speaker: 'waiter', text: 'Welcome in. Your table is ready whenever you are.', emotion: 'warm' },
  { clipId: 'greeting-date', cue: 'greeting', speaker: 'date', text: 'This is nice. Shall we grab our table?', emotion: 'warm' },
  { clipId: 'clap-delighted', cue: 'clap', speaker: 'date', text: 'Okay, that deserves a round of applause.', emotion: 'amused' },
  { clipId: 'clap-dry', cue: 'clap', speaker: 'date', text: 'A very convincing performance. I am impressed.', emotion: 'amused' },
  { clipId: 'laugh-big', cue: 'laugh', speaker: 'date', text: 'I did not expect you to say that. That is actually really funny.', emotion: 'amused' },
  { clipId: 'laugh-small', cue: 'laugh', speaker: 'date', text: 'You are making it very hard to keep a straight face.', emotion: 'amused' },
  { clipId: 'wrong-order-date', cue: 'wrong-order', event: 'wrong-order', speaker: 'date', text: 'I am almost certain neither of us ordered that. It does look good, though.', emotion: 'surprised' },
  { clipId: 'wrong-order-waiter', cue: 'wrong-order', event: 'wrong-order', speaker: 'waiter', text: 'Oh, that is for the next table. I am sorry. Let me fix that.', emotion: 'embarrassed' },
  { clipId: 'spill-date', cue: 'spill', event: 'spilled-drink', speaker: 'date', text: 'Whoa! Are you okay? Here, take my napkin.', emotion: 'surprised' },
  { clipId: 'spill-waiter', cue: 'spill', event: 'spilled-drink', speaker: 'waiter', text: 'I am so sorry. Let me get fresh napkins and another glass.', emotion: 'embarrassed' },
  { clipId: 'diner-date', cue: 'diner', event: 'disruptive-diner', speaker: 'date', text: 'I can hear every word of that call. Should we ask them to turn it down?', emotion: 'annoyed' },
  { clipId: 'diner-defensive', cue: 'diner', event: 'disruptive-diner', speaker: 'diner', text: 'I am having a conversation. I did not realize the entire restaurant was listening.', emotion: 'defensive' },
];

const incidentFor = (cue: StoryCueKey): DinnerEvent | undefined => cue.startsWith('wrong-order') ? 'wrong-order'
  : cue.startsWith('spill') ? 'spilled-drink' : cue.startsWith('diner') ? 'disruptive-diner' : undefined;
const identity = (line: SceneUtterance & { dateId?: DateId }) => JSON.stringify([line.speaker === 'date' ? line.dateId ?? '*' : '*', line.speaker, line.emotion, line.text]);

function storyUtterances(): AuthoredUtterance[] {
  const seen = new Set(LEGACY_UTTERANCES.map(identity));
  const rows: AuthoredUtterance[] = [];
  for (const date of DATES) for (const cue of STORY_CUE_KEYS) for (const variant of STORY_CUE_VARIANTS) {
    getStoryCue(cue, date.id, variant.context).forEach((line, index) => {
      const dateId = line.speaker === 'date' ? date.id : undefined;
      const key = identity({ ...line, dateId });
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ ...line, clipId: `story-${date.id}-${cue}-${variant.id}-${index}`, ...(dateId ? { dateId } : {}), ...(incidentFor(cue) ? { event: incidentFor(cue) } : {}), cue });
    });
  }
  return rows;
}

/** Original IDs remain stable; repeated staff lines are synthesized only once. */
export const AUTHORED_UTTERANCES: AuthoredUtterance[] = [...LEGACY_UTTERANCES, ...storyUtterances()];
