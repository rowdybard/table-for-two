import type { RestaurantScenarioState } from './scenario-types';
import type { VoiceSignal } from '../shared/protocol';
import type { ClaudeModel, CostUsage, DateId, DateStance, DinnerCommand, DinnerState, Emotion, Vec3 } from './types';

export type DoubleHumanId = 'h1' | 'h2';
export type DoubleDateActorId = 'd1' | 'd2';
export type DoubleSpeakerId = DoubleHumanId | DoubleDateActorId | 'waiter' | 'diner';
export type ConversationTarget = DoubleHumanId | DoubleDateActorId | 'table';
export interface DoubleMember {
  id: DoubleHumanId; name: string; connected: boolean; ready: boolean;
  dateId: DateId | null; position: Vec3; yaw: number; seated: boolean;
  viewingEnding?: boolean;
}
export interface DoubleDateActor {
  id: DoubleDateActorId; humanId: DoubleHumanId; dateId: DateId;
  position: Vec3; seated: boolean; emotion: Emotion; stance: DateStance;
  departed?: boolean;
}
export interface DoubleDialogueLine {
  id: string; generation: number; speaker: DoubleSpeakerId; text: string;
  emotion: Emotion; clipId?: string; at: number; interrupted?: boolean;
}
export interface DoubleVoiceSignal {
  id: number; from: DoubleHumanId; epoch: number; signal: VoiceSignal;
}
/** Public room state; bearer/reconnect tokens are never part of snapshots. */
export interface DoubleScenario extends RestaurantScenarioState { target: DoubleHumanId }
export interface DoubleDateRoomState {
  id: string; code: string; mode: 'double-date';
  phase: 'waiting' | 'playing' | 'paused' | 'ended';
  scenario?: DoubleScenario;
  incidentOwner?: DoubleHumanId;
  hostId: DoubleHumanId; generation: number; revision: number;
  members: DoubleMember[]; dates: DoubleDateActor[];
  views: Record<DoubleHumanId, DinnerState>;
  lines: DoubleDialogueLine[];
  usage: CostUsage; sessionLimit: number; model: ClaudeModel;
  voice: { enabled: Record<DoubleHumanId, boolean>; epoch: number; iceServers: RTCIceServer[] };
  pauseReason?: 'manual' | 'reconnect';
  processing?: boolean;
  activeTurnId?: string;
  error?: { code: string; message: string };
}
export interface DoubleRoomCredentials {
  roomId: string; memberId: DoubleHumanId; token: string;
}
export interface DoubleRoomResponse extends DoubleRoomCredentials { state: DoubleDateRoomState }
export interface DoubleRoomPoll { state: DoubleDateRoomState; signals: DoubleVoiceSignal[] }
export type DoubleRoomCommand =
  | { type: 'choose-date'; dateId: DateId }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'set-model'; model: ClaudeModel }
  | { type: 'reset-model' }
  | { type: 'view-ending' }
  | { type: 'return-to-table' }
  | { type: 'scenario'; choice: string }
  | { type: 'scene'; command: DinnerCommand }
  | { type: 'voice-enable'; enabled: boolean }
  | { type: 'voice-signal'; epoch: number; signal: VoiceSignal };
export interface DoubleTurnRequest {
  turnId: string; text: string; target: ConversationTarget;
}
export interface DoubleDatePresentation {
  scenario?: DoubleScenario;
  incidentOwner?: DoubleHumanId;
  role: 'dating' | 'wingman' | 'finished';
  localHumanId: DoubleHumanId; roomId: string;
  members: DoubleMember[]; dates: DoubleDateActor[];
  speakingActor: DoubleSpeakerId | null;
  /** The other pair's raw view, without presentation data or nested room state. */
  otherView?: DinnerState;
}
export const DOUBLE_TABLE = {
  center: [0, .78, -1.15] as Vec3,
  seats: { h1: [-.57, 0, .20] as Vec3, h2: [.57, 0, .20] as Vec3 },
  dateSeats: { d1: [-.57, 0, -2.50] as Vec3, d2: [.57, 0, -2.50] as Vec3 },
  spawns: { h1: [-.55, 1.38, 5.6] as Vec3, h2: [.55, 1.38, 5.6] as Vec3 },
  pairings: { h1: 'd1', h2: 'd2' } as Record<DoubleHumanId, DoubleDateActorId>,
} as const;

export function localDoubleDateView(room: DoubleDateRoomState, humanId: DoubleHumanId): DinnerState {
  const member = room.members.find(candidate => candidate.id === humanId)!;
  const date = room.dates.find(candidate => candidate.humanId === humanId)!;
  const source = room.views[humanId];
  return {
    ...source, mode: 'double-date', dateId: date.dateId,
    phase: room.phase === 'waiting' ? 'paused' : room.phase === 'ended' || (source.phase === 'ended' && member.viewingEnding) ? 'ended' : room.phase,
    elapsed: source.phase === 'ended' && room.phase !== 'ended' && !member.viewingEnding ? Math.max(...Object.values(room.views).map(view => view.elapsed)) : source.elapsed,
    generation: room.generation, usage: room.usage, sessionLimit: room.sessionLimit,
    seated: member.seated,
    participants: [
      { id: 'p1', kind: 'human', name: member.name, position: member.position },
      { id: 'p2', kind: 'ai', name: source.participants.find(participant => participant.kind === 'ai')?.name ?? 'Your date', position: date.position },
    ],
    doubleDate: { role: room.phase === 'ended' ? 'finished' : source.phase === 'ended' ? 'wingman' : 'dating', scenario: room.scenario, incidentOwner: room.incidentOwner, localHumanId: humanId, roomId: room.id, members: room.members, dates: room.dates, speakingActor: null,
      otherView: { ...room.views[humanId === 'h1' ? 'h2' : 'h1'], doubleDate: undefined } },
  };
}
