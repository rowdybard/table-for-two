import type { EveningEnding } from './types';

type EndingKind = EveningEnding['kind'];
/** Worst to best, as the player would rank a night. */
export const ENDING_RANK: readonly EndingKind[] = ['walked-away', 'early-exit', 'quiet-goodbye', 'new-friend', 'second-chance', 'another-evening', 'invited-home'];
export const BEST_LABEL: Record<EndingKind, string> = { 'walked-away': 'walked out', 'early-exit': 'you left early', 'quiet-goodbye': 'a cool goodnight', 'new-friend': 'a kind goodnight', 'second-chance': 'left the door open', 'another-evening': 'asked for a second date', 'invited-home': 'invited you home' };
export const BEST_KEY = 'table-for-two-best', EVENINGS_KEY = 'table-for-two-evenings';

/** The best ending reached with each preset date on this device: the kept record, plus any saved evenings from before it existed. Blind strangers are not counted. */
export function bestEndings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Record<string, EndingKind> {
  const best: Record<string, EndingKind> = {};
  const consider = (dateId: unknown, kind: unknown) => {
    if (typeof dateId !== 'string' || !ENDING_RANK.includes(kind as EndingKind)) return;
    if (!(dateId in best) || ENDING_RANK.indexOf(kind as EndingKind) > ENDING_RANK.indexOf(best[dateId])) best[dateId] = kind as EndingKind;
  };
  try {
    const kept = JSON.parse(storage?.getItem(BEST_KEY) || '{}');
    if (kept && typeof kept === 'object') for (const [dateId, kind] of Object.entries(kept)) consider(dateId, kind);
    const evenings = JSON.parse(storage?.getItem(EVENINGS_KEY) || '[]');
    if (Array.isArray(evenings)) for (const night of evenings) if (night && !night.blind) consider(night.dateId, night.ending?.kind);
  } catch { /* Optional storage. */ }
  return best;
}
