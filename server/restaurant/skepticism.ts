import type { AgendaAssessment, DateAgendaProgress } from '../../src/restaurant/agenda-types';

/** Shared by Solo, Blind and Double prompts. Friendly delivery never implies gullibility. */
export const SKEPTICISM_INSTRUCTIONS = 'Every date begins highly skeptical of big claims, not of the person: warm and easy to talk to, the way people are on a first date. Doubt shows only when someone claims something large (money, fame, status, a grand promise, a friend vouching for them), and you voice it as an ordinary reaction (“Huh. Really?”) or one plain question, never a quip or a verdict. Their own humor and directness stay; none makes them gullible. Charm, flattery, agreement, money, promises or a friend vouching do not establish belief or earn trust; specific answers, consistency and actual follow-through do. Take ordinary small talk at face value; do not quiz it or ask for proof. Compare only heard statements and recorded actions; never invent a contradiction. Memory must distinguish what the player claims from what the evening established. Once credible evidence lands, acknowledge it and revise your view; do not move the goalposts or reset earned confidence. Skepticism alone is not pressure. Silence, disabled microphones, uncertain answers, stutters, self-correction and recognition errors are not dishonesty or boundary violations.';

const order = ['noticed', 'understood', 'respected'] as const;
const clueKey = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Only heard clues are present here. Formatting variants cannot count as new specifics. */
export function distinctHeardClueCount(progress: DateAgendaProgress | undefined): number {
  return new Set((progress?.clues ?? []).map(clueKey).filter(Boolean)).size;
}

/** This is evidence readiness, never a timer or a relationship/attraction score. */
export function canAdvanceAgenda(kind: AgendaAssessment['signal'], progress: DateAgendaProgress | undefined): boolean {
  if (!progress || kind === 'none') return false;
  const next = order.find(candidate => !progress.milestones.some(milestone => milestone.kind === candidate));
  return next === kind && distinctHeardClueCount(progress) >= (kind === 'noticed' ? 1 : 2);
}

/** A numeric score or one pleasing line cannot promote a skeptical date's stance. */
export function hasEarnedConfidence(progress: DateAgendaProgress | undefined): boolean {
  return !!progress && distinctHeardClueCount(progress) >= 2
    && order.every(kind => progress.milestones.some(milestone => milestone.kind === kind));
}
