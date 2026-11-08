export type RestaurantScenarioId =
  | 'feeling-unwell' | 'wine-spill' | 'oversized-order' | 'staff-flirt'
  | 'awkward-ex' | 'family-visit' | 'unexpected-tic' | 'allergic-reaction'
  | 'too-many-drinks' | 'questioning-attraction' | 'unwelcome-comment';

export interface RestaurantScenarioState {
  id: RestaurantScenarioId;
  title: string;
  description: string;
  phase: 'dormant' | 'active' | 'resolved';
  beat: 'setup' | 'follow-through';
  choices: { id: string; label: string }[];
  decisions: { id: string; label: string; by: string }[];
  effects: { romanceClosed: boolean; earlyExit: boolean; wineStain: boolean; service: 'none' | 'water' | 'help' };
  resolution?: string;
  startedAt?: number;
  resolvedAt?: number;
}

export type ToastIntention = 'tonight' | 'honesty' | 'friends' | 'mischief';
export interface RestaurantCareState {
  tasteOffer: { result: 'accepted' | 'declined'; dish: string } | null;
  toast: { intention: ToastIntention; at: number } | null;
  water: { status: 'none' | 'requested' | 'served'; requestedAt: number | null };
  checkIn: { answer: 'continue' | 'slow-down'; at: number } | null;
  romanceClosed: boolean;
  quietUntil: number;
  assistedExit?: boolean;
}

export type ScenarioDishStatus = 'pending' | 'served' | 'shared' | 'cancelled' | 'boxed';
export interface ScenarioExtraDish { id: string; dish: string; quantity: number; unitPriceCents: number; status: ScenarioDishStatus }
export interface DinnerBillItem { id: string; label: string; quantity: number; unitPriceCents: number; status: ScenarioDishStatus; chargedCents: number; owner: 'you' | 'date' }
/** Server-owned consequences. Rendering follows these facts, rather than resolving them. */
export interface ScenarioCareState {
  applied: string[];
  kitchen: { held: boolean; heldAt: number | null; pausedSeconds: number };
  presence: 'at-table' | 'privacy-break' | 'cleanup-break' | 'staff-care';
  returnAt: number | null;
  table: 'original' | 'quiet';
  cleanup: { wine: 'none' | 'wet' | 'clean'; cloth: 'none' | 'ready' | 'used'; glassesCleared: boolean };
  service: { staff: 'none' | 'discreet' | 'medical' | 'safe-finish'; spaceCleared: boolean; alcoholStopped: boolean; contactRequested: boolean };
  extraOrder: { items: ScenarioExtraDish[] };
}
