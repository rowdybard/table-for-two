export { EVALUATION_SCRIPTS, SHORT_EVALUATION_SCRIPTS, CONTINUITY_EVALUATION_SCRIPTS, EVALUATION_MODELS } from './evaluation-fixtures';
export type { EvaluationScript, EvaluationTurn, ContinuityCheckpoint } from './evaluation-fixtures';
export { EvaluationConversation } from './evaluation-runtime';
export type { EvaluationResult } from './evaluation-runtime';

/** Null means unreviewed. A protocol-valid reply is not an automatic quality pass. */
export const DATE_EVALUATION_RUBRIC = Object.freeze({ naturalness: null, castVoice: null, specificity: null, humor: null, flirtation: null, emotionalAttunement: null, continuity: null, agency: null, boundaries: null, shareability: null });
export const EVALUATION_REVIEW_GUIDE = {
  scale: 'Human review only: 1 poor, 3 acceptable, 5 excellent. Leave null until reviewed.',
  shareability: 'Would you quote this specific exchange or show a friend? Record the actual line and why; a generic punchline is not enough.',
  hardFailures: ['Invented human facts or commitments', 'Unheard dialogue treated as heard', 'Repeated story presented as new', 'Private facts or ownership transferred between couples', 'Pressure, a false boundary accusation, or a changed ending without evidence'],
  limits: 'Text-only controlled dining snapshots. No renderer, microphone, speech service, physical progression or automatic human-quality judge is started.',
  baselineComparison: { status: 'unrated', baselineReport: null, candidateReport: null,
    note: 'Model comparisons within one source revision do not establish a baseline-code versus candidate-code preference. Pair immutable, matched reports and obtain independent human review first.' },
};
