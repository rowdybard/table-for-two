export type DateId = 'mira' | 'jules' | 'dev';
export type Speaker = 'date' | 'other-date' | 'waiter' | 'diner';
export type Emotion = 'neutral' | 'amused' | 'warm' | 'flirtatious' | 'embarrassed' | 'annoyed' | 'angry' | 'defensive' | 'surprised';
export const DOLPHIN_MODEL = 'cognitivecomputations/dolphin-mistral-24b-venice-edition' as const;
/** Stable game identity; the current community model is configured only on the server. */
export const HORDE_MODEL = 'ai-horde' as const;
export const isEarnedModel = (model: unknown): boolean => model === DOLPHIN_MODEL;
/** Legacy name retained for saved games; these identifiers may use different providers. */
export type ClaudeModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | typeof DOLPHIN_MODEL | typeof HORDE_MODEL;
export type DinnerStage = 'arrival' | 'seated' | 'ordered' | 'dining' | 'dessert' | 'farewell' | 'finished';
export type DinnerEvent = 'wrong-order' | 'spilled-drink' | 'disruptive-diner';
export type DateAction = 'follow' | 'sit' | 'order' | 'reassure' | 'finish' | 'none';
export type Vec3 = [number, number, number];
export interface DatePreset { id: DateId; name: string; age: number; pronouns: string; archetype: string; description: string; personality: string; preferences: string; boundaries: string; color: string; voiceId: string; opening: string }
export interface SceneUtterance { speaker: Speaker; text: string; emotion: Emotion; clipId?: string; actorId?: import('./double-date-types').DoubleSpeakerId; dateId?: DateId; lineId?: string }
export interface SocialResponse { signal: 'none' | 'kindness' | 'curiosity' | 'humor' | 'pressure' | 'repair'; reason: string; wantsToLeave: boolean; boundary?: import('./boundary-types').BoundaryAssessment }
export interface SceneTurn { utterances: SceneUtterance[]; emotion: Emotion; action: DateAction; memory: string; social?: SocialResponse; agenda?: import('./agenda-types').AgendaAssessment }
export type EveningAction = 'taste' | 'order-dessert' | 'skip-dessert' | 'settle-bill' | 'farewell' | 'inspect-ticket' | 'return-order' | 'keep-order' | 'wipe' | 'steady-glass' | 'ask-quiet' | 'let-it-go' | 'apologize' | 'offer-taste' | 'toast' | 'request-water' | 'check-in' | 'resume-dinner';
/** Player-facing actions the server still accepts; course progression itself is paced by the waiter. */
export const EVENING_ACTIONS: readonly EveningAction[] = ['taste', 'order-dessert', 'skip-dessert', 'settle-bill', 'farewell', 'inspect-ticket', 'return-order', 'keep-order', 'wipe', 'steady-glass', 'ask-quiet', 'let-it-go', 'apologize', 'offer-taste', 'toast', 'request-water', 'check-in', 'resume-dinner'];
export type DateStance = 'curious' | 'comfortable' | 'guarded' | 'hurt' | 'leaving';
export interface EveningCue { id: string; key: string; utterances: SceneUtterance[] }
export interface EveningMoment { id: string; title: string; description: string }
export interface EveningEnding { kind: 'another-evening' | 'new-friend' | 'second-chance' | 'quiet-goodbye' | 'early-exit' | 'walked-away'; title: string; description: string; dateLine: string }
export interface EveningState {
  tabletop?: import('./tabletop').TabletopState;
  scenarioCare?: import('./scenario-types').ScenarioCareState;
  /** Earned independently per couple; provider credentials never enter this state. */
  chemistry?: { unlocked: boolean };
  /** Heard clues and earned understanding only. The private goal is revealed at the ending. */
  agenda?: import('./agenda-types').DateAgendaProgress;
  scenario?: import('./scenario-types').RestaurantScenarioState;
  care: import('./scenario-types').RestaurantCareState;
  chapter: 'welcome' | 'mains' | 'dessert' | 'bill' | 'farewell';
  lastInterruptionAt: number;
  variation: number; dialogueTurns: number; stance: DateStance; stanceReason: string;
  /** Courses are served and cleared by the waiter on scene time; bites are the player's own physical eating. */
  main: { status: 'none' | 'waiting' | 'served' | 'finished'; bites: number; dateDish: string | null; servedDish: string | null; orderedAt?: number; servedAt?: number; finishedAt?: number };
  dessert: { choice: string | null; status: 'none' | 'waiting' | 'served' | 'finished' | 'skipped'; bites: number; chosenBy: 'you' | 'date' | null; offeredAt?: number; servedAt?: number; finishedAt?: number };
  /** Authored lines the date offered to break a silence; no model request is made for them. */
  beats: number;
  incident: { event: DinnerEvent; progress: number; startedAt: number } | null;
  resolutions: Partial<Record<DinnerEvent, string>>;
  sharedActivities: string[]; moments: EveningMoment[]; cues: EveningCue[];
  bill: { requested: boolean; settlement: 'split' | 'treat' | 'separate' | null; arrivedAt?: number; items?: import('./scenario-types').DinnerBillItem[]; totalCents?: number };
  farewell: { choice: 'again' | 'friendly' | 'goodbye' | null; ending: EveningEnding | null };
}
export interface CostUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; speechCharacters: number; cacheHits: number; claudeRequests: number; claudeCost: number; speechCost: number; totalCost: number; responseMs: number | null; firstAudioMs: number | null }
export interface DinnerState {
  /** Monotonic snapshot order for discarding delayed Solo/Blind HTTP responses. */
  revision?: number;
  conversationModel?: ClaudeModel;
  id: string; generation: number; mode: 'ai-date' | 'double-date' | 'blind-date'; phase: 'playing' | 'paused' | 'ended'; dateId: DateId; stage: DinnerStage;
  blindDate?: { seed: string };
  elapsed: number; participants: { id: 'p1' | 'p2'; kind: 'human' | 'ai'; name: string; position: Vec3 }[];
  events: DinnerEvent[]; emotion: Emotion; seated: boolean; order: string | null; glassRaised: boolean;
  memory: string; usage: CostUsage; sessionLimit: number; reason?: string;
  evening: EveningState;
  doubleDate?: import('./double-date-types').DoubleDatePresentation;
}
export const INTERACTION_TARGETS = ['seat', 'menu', 'glass', 'meal', 'date', 'exit', 'bill', 'ticket', 'napkin', 'dessert', 'service-bell', 'window', 'carafe', 'bread', 'salt', 'pepper', 'cutlery', 'lamp', 'vase', 'plate'] as const;
export type InteractionTarget = typeof INTERACTION_TARGETS[number];
export type DinnerCommand =
  | { type: 'move'; x: number; z: number; yaw: number }
  | { type: 'interact'; target: InteractionTarget; choice?: string }
  | { type: 'tabletop'; action: import('./tabletop').TabletopAction }
  | { type: 'evening'; action: EveningAction; choice?: string }
  | { type: 'scenario'; choice: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'finish' };
export interface TurnRequest { turnId: string; text: string; model: ClaudeModel }
export type TurnEvent =
  | { type: 'start'; generation: number }
  | { type: 'utterance'; generation: number; index: number; utterance: SceneUtterance }
  | { type: 'state'; state: DinnerState }
  | { type: 'done'; generation: number }
  | { type: 'error'; message: string; code?: string; details?: { field: string; index?: number } };
export interface ProviderStatus { claude: boolean; anthropic?: boolean; dolphin?: boolean; horde?: boolean; speech: boolean; speechProvider?: 'edge' | 'elevenlabs' | 'none'; speechModel?: string; speechCostPer1K?: number; cachedSpeech?: boolean; development: boolean; models: ClaudeModel[]; defaultModel: ClaudeModel; sessionLimit: number; message?: string }
export interface AudioPlayback { speaker: Speaker | null; amplitude: number; emotion: Emotion; caption: string; actorId?: import('./double-date-types').DoubleSpeakerId }
