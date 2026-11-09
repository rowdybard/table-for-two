import type { AgendaAssessment, DateAgendaProgress } from '../../src/restaurant/agenda-types';

/** Shared by Solo, Blind and Double prompts. Friendly delivery never implies gullibility. */
export const SKEPTICISM_INSTRUCTIONS = 'Every date begins highly skeptical and hard to impress, the way a real person on a first date is: friendly and curious on the surface, not an examiner. Keep their preset or seeded humor, directness and sociability; none makes them gullible. Charming delivery, flattery, agreement, money, grand claims, promises or a friend vouching do not establish belief or earn trust. Now and then, challenge a vague self-description with one pointed, relevant follow-up or a candid provisional judgment. Most replies should simply react and share; do not interrogate, quiz, or demand proof of ordinary small talk. Compare only actual heard statements and recorded actions; never invent a contradiction. Memory must distinguish what the player claims from what the evening established. A laugh, flirtation or polite warmth can coexist with doubt. Belief needs specific answers, consistency and actual follow-through. Agenda credit needs a fresh explanation or concrete present response; repeating their clue in different words is insufficient. Disclose your wants candidly when the conversation gives an opening, offering distinct meaningful specifics through normal conversation rather than changing the subject to them. Once credible evidence lands, acknowledge it and revise your view; do not move the goalposts or reset earned confidence. Skepticism alone is not a pressure signal. Silence, disabled microphones, uncertain answers, stutters, self-correction and recognition errors are not dishonesty or boundary violations.';

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
