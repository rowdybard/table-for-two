// Closing time. An evening lasts a fixed number of exchanges (EVENING_EXCHANGES); the restaurant's clock runs down
// with each one. In the last stretch the date knows the place is closing, and its final reply is the verdict, said in
// its own words. The server decides which verdict from earned state only; no line is authored and no model call is added.
import { CLOSING_STRETCH, EVENING_EXCHANGES } from '../../src/restaurant/evening';

/** How the evening closes when the clock runs out. Leaving early (walked-away) can happen at any exchange and is not one of these. */
export type ClosingVerdict = 'invited-home' | 'another-evening' | 'second-chance' | 'new-friend' | 'quiet-goodbye';
export interface ClosingContext { left: number; final: boolean; verdict: ClosingVerdict }
const RANK: ClosingVerdict[] = ['quiet-goodbye', 'new-friend', 'second-chance', 'another-evening', 'invited-home'];

/** Exchanges still to come, counting the one being answered now. */
export const exchangesLeft = (dialogueTurns: number, total = EVENING_EXCHANGES) => Math.max(0, total - dialogueTurns);

export interface ClosingState { guarded: boolean; romanceClosed: boolean; repairedAfterHurt: boolean; chemistryUnlocked: boolean; comfortable: boolean; reciprocalFlirts: number; trustEarned: boolean }
/**
 * The verdict from what the pair earned. An invitation home needs established mutual chemistry and a comfortable date;
 * a second date needs one flirt that landed both ways or earned trust; a flat evening is a kind goodnight.
 */
export function closingVerdict(state: ClosingState): ClosingVerdict {
  if (state.guarded) return 'quiet-goodbye';
  if (state.repairedAfterHurt) return 'second-chance';
  if (state.romanceClosed) return 'new-friend';
  if (state.chemistryUnlocked && state.comfortable) return 'invited-home';
  if (state.reciprocalFlirts >= 1 || state.trustEarned) return 'another-evening';
  return 'new-friend';
}
/** The ending can fall below what the date was told before its last line (a last-second insult), never rise above what it said. */
export const settledVerdict = (promised: ClosingVerdict | null, afterTurn: ClosingVerdict): ClosingVerdict => promised && RANK.indexOf(promised) < RANK.indexOf(afterTurn) ? promised : afterTurn;

export function closingContext(dialogueTurns: number, verdict: ClosingVerdict, total = EVENING_EXCHANGES): ClosingContext | null {
  const left = exchangesLeft(dialogueTurns, total);
  return left >= 1 && left <= CLOSING_STRETCH ? { left, final: left === 1, verdict } : null;
}

const LAST_LINE: Record<ClosingVerdict, string> = {
  'invited-home': 'You do not want tonight to end here. Invite them to come back with you, plainly and warmly, in your own words; it is an invitation, not a description of what happens next.',
  'another-evening': 'You want to see them again. Ask for a second date in your own words, with one specific idea that comes from tonight.',
  'second-chance': 'It got rocky and they made it right. Say goodnight honestly and leave the door open to trying again, without pretending nothing happened.',
  'new-friend': 'It was good company without a spark. Say a kind, honest goodnight; do not promise or hint at a second date.',
  'quiet-goodbye': 'You are not comfortable with how tonight went. Say a short, civil goodnight and nothing more.',
};
/** What the date is told about the clock: nothing until the last stretch, then that the place is closing, then its last line. */
export function closingLine(closing: ClosingContext | null | undefined): string {
  if (!closing) return '';
  if (closing.final) return `The restaurant is closing: this is the last thing you say tonight. Answer what they just said in a few words, then close the evening the way you actually feel. ${LAST_LINE[closing.verdict]} Do not end on a question unless it is the invitation itself.`;
  return `The restaurant is closing soon; there is time for about ${closing.left - 1} more exchange${closing.left - 1 === 1 ? '' : 's'} after this one. Do not announce a countdown. Let the talk turn toward how tonight has felt and anything you still want to say or ask before it ends.`;
}
