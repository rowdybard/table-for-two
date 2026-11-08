export type PlayerId = 'p1' | 'p2';
export type Reaction = 'heart' | 'laugh' | 'nice';
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type VoiceSignal =
  | { kind: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { kind: 'candidate'; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string | null } };

export type ClientMessage =
  | { type: 'join'; room?: string; token?: string; name: string }
  | { type: 'input'; x: number; z: number }
  | { type: 'bowl'; aim: number; power: number; spin: number }
  | { type: 'reset-lane' }
  | { type: 'lane-join' }
  | { type: 'lane-leave' }
  | { type: 'lane-mode'; mode: 'classic' | 'arcade' }
  | { type: 'lane-flippers'; left: boolean; right: boolean }
  | { type: 'claw-join' }
  | { type: 'claw-move'; direction: -1 | 0 | 1 }
  | { type: 'claw-ready'; ready: boolean }
  | { type: 'claw-swap' }
  | { type: 'claw-leave' }
  | { type: 'kiss-choice'; choice: boolean }
  | { type: 'pool-join' }
  | { type: 'pool-leave' }
  | { type: 'pool-pass' }
  | { type: 'pool-rerack' }
  | { type: 'pool-shoot'; angle: number; power: number }
  | { type: 'voice-enable'; enabled: boolean }
  | { type: 'voice-signal'; epoch: number; signal: VoiceSignal }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'chat'; text: string }
  | { type: 'reaction'; reaction: Reaction }
  | { type: 'leave' };

export type PlayerState = {
  id: PlayerId;
  name: string;
  position: Vec3;
  rotation: number;
  connected: boolean;
  ready: boolean;
};

export type ObjectState = {
  id: string;
  kind: 'pin' | 'ball' | 'beach-ball' | 'claw-prize' | 'giant-prize' | 'lane-flipper';
  position: Vec3;
  rotation: Quat;
};

export type PoolState = {
  phase: 'waiting' | 'aiming' | 'rolling' | 'won';
  participants: PlayerId[]; turn: PlayerId | null; shots: number; total: number; pocketed: number;
  balls: { id: number; position: Vec3; rotation: Quat }[];
  lastShot: { playerId: PlayerId; potted: number; scratch: boolean } | null;
};

export type LaneState = {
  pinsDown: number; canBowl: boolean; canReset: boolean; bowler: PlayerId | null;
  mode: 'classic' | 'arcade'; participants: PlayerId[];
  warmups: Record<PlayerId, boolean>; unlocked: boolean;
  roller: PlayerId | null; pilot: PlayerId | null;
  round: number; score: number; complete: boolean; roundSettled: boolean;
};

export type RoomState = {
  type: 'state';
  room: string;
  tick: number;
  phase: 'waiting' | 'playing' | 'paused' | 'ended';
  pauseReason: 'manual' | 'reconnect' | null;
  clockSeconds: number;
  players: PlayerState[];
  objects: ObjectState[];
  pool: PoolState;
  voice: { enabled: Record<PlayerId, boolean>; epoch: number };
  claw: { phase: 'idle' | 'aiming' | 'dropping' | 'lifting' | 'surprise' | 'won'; operators: { x: PlayerId | null; z: PlayerId | null }; x: number; z: number; y: number; ready: Record<PlayerId, boolean>; moved: { x: boolean; z: boolean }; attempts: number; prizeHeld: boolean };
  ending: { phase: 'waiting' | 'choice' | 'celebration' | 'kiss'; ownChoice: boolean | null };
  lane: LaneState;
};

export type ServerMessage =
  | { type: 'welcome'; room: string; playerId: PlayerId; token: string }
  | RoomState
  | { type: 'voice-signal'; from: PlayerId; epoch: number; signal: VoiceSignal }
  | { type: 'chat'; playerId: PlayerId; name: string; text: string }
  | { type: 'reaction'; playerId: PlayerId; reaction: Reaction }
  | { type: 'error'; message: string }
  | { type: 'ended'; message: string };
