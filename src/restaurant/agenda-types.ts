/** A proposed observation from the existing completed-turn response, not a score. */
export interface AgendaAssessment {
  signal: 'none' | 'noticed' | 'understood' | 'respected';
  evidence: string;
  clue: string;
}

/** Safe to send to players. The private goal is revealed only when dinner ends. */
export interface DateAgendaProgress {
  clues: string[];
  milestones: { kind: 'noticed' | 'understood' | 'respected'; evidence: string }[];
  score: number;
  possible: number;
  goal: string | null;
  reflection: string | null;
}
