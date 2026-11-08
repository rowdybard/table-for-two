/** A proposal from the normal completed-turn response, never an automatic penalty. */
export interface BoundaryAssessment {
  kind: 'none' | 'set' | 'repeat' | 'repair';
  topic: 'sexual-talk' | 'touch' | 'personal-details' | 'food-drink' | 'staff-treatment' | 'insults' | 'other';
  refusal: string;
  evidence: string;
}
