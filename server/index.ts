import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import { nearClaw, nearLane, nearPool, STATIC_BOXES, VENUE } from '../src/shared/venue';
import { ClawGame } from './claw';
import { PoolGame } from './pool';
import { LaneGame, updatePinGroundDamping } from './lane';
import { validateVoiceSignal } from './voice';
import type { ObjectState, PlayerId, RoomState, ServerMessage, Vec3 } from '../src/shared/protocol';

const STEP = 1 / 60;
const GRACE_MS = 60_000;
const INPUT_TTL_MS = 250;
type Player = { id: PlayerId; name: string; token: string; socket: WebSocket | null; body: RAPIER.RigidBody; x: number; z: number; inputAt: number; ready: boolean; disconnectedAt: number | null };
type Entity = { id: string; kind: ObjectState['kind']; body: RAPIER.RigidBody };
type Room = { id: string; world: RAPIER.World; players: Player[]; entities: Entity[]; phase: RoomState['phase']; pauseReason: RoomState['pauseReason']; clock: number; tick: number; rolled: boolean; bowler: PlayerId | null; closed: boolean; laneGame: LaneGame; claw: ClawGame; pool: PoolGame; voice: RoomState['voice']; choices: Record<PlayerId, boolean | null>; ending: RoomState['ending']['phase']; midnightElapsed: number };
const id = (n: number) => randomBytes(n).toString('hex');
const vec = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
function send(ws: WebSocket | null, msg: ServerMessage) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function broadcast(room: Room, msg: ServerMessage) { for (const p of room.players) send(p.socket, msg); }
function shape(world: RAPIER.World, body: RAPIER.RigidBody, collider: RAPIER.ColliderDesc) { world.createCollider(collider, body); }
function createRoom(roomId: string): Room {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.2, (VENUE.minZ + VENUE.maxZ) / 2));
  shape(world, floor, RAPIER.ColliderDesc.cuboid(VENUE.width / 2, .2, VENUE.depth / 2).setFriction(.8));
  for (const box of STATIC_BOXES) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...box.center));
    shape(world, body, RAPIER.ColliderDesc.cuboid(...box.half));
  }
  const room: Room = { id: roomId, world, players: [], entities: [], phase: 'waiting', pauseReason: null, clock: VENUE.startTime, tick: 0, rolled: false, bowler: null, closed: false, laneGame: null!, claw: null!, pool: new PoolGame(), voice: { enabled: { p1: false, p2: false }, epoch: 0 }, choices: { p1: null, p2: null }, ending: 'waiting', midnightElapsed: 0 };
  resetLane(room);
  room.laneGame = new LaneGame(world, room.entities);
  room.claw = new ClawGame(world, room.entities);
  return room;
}
function resetLane(room: Room) {
  for (const e of room.entities.filter(e => e.kind === 'pin' || e.kind === 'ball')) room.world.removeRigidBody(e.body);
  for (let i = room.entities.length - 1; i >= 0; i--) if (room.entities[i].kind === 'pin' || room.entities[i].kind === 'ball') room.entities.splice(i, 1);
  let index = 0;
  for (let row = 0; row < 4; row++) for (let column = 0; column <= row; column++) {
    const body = room.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(VENUE.laneX + (column - row / 2) * .42, .42, VENUE.pinZ - row * .38).setLinearDamping(.35).setAngularDamping(.35).setCcdEnabled(true));
    shape(room.world, body, RAPIER.ColliderDesc.cylinder(.4, .12).setMass(1.3).setFriction(.6));
    room.entities.push({ id: `pin-${index++}`, kind: 'pin', body });
  }
  const body = room.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(VENUE.laneX, .3, VENUE.laneStartZ).setLinearDamping(.14).setAngularDamping(.15).setCcdEnabled(true));
  shape(room.world, body, RAPIER.ColliderDesc.ball(.3).setMass(4.5).setRestitution(.15).setFriction(.7));
  room.entities.push({ id: 'bowling-ball', kind: 'ball', body });
  room.rolled = false; room.bowler = null;
}
function laneStopped(room: Room) {
  return room.entities.filter(e => e.kind === 'pin' || e.kind === 'ball').every(e => {
    const v = e.body.linvel(), w = e.body.angvel();
    return Math.hypot(v.x, v.y, v.z) < .22 && Math.hypot(w.x, w.y, w.z) < .55;
  });
}
function state(room: Room, viewer?: PlayerId): RoomState {
  const pinsDown = room.entities.filter(e => e.kind === 'pin' && (Math.abs(e.body.rotation().x) > .4 || Math.abs(e.body.rotation().z) > .4 || e.body.translation().y < .27)).length;
  const lane = room.laneGame;
  const lanePairPresent = room.phase === 'playing' && room.players.length === 2 && room.players.every(p => !!p.socket && nearLane(vec(p.body.translation())));
  const canBowl = !room.rolled && (lane.mode === 'classic' || (lanePairPresent && lane.bothJoined && !lane.complete && !lane.roundSettled));
  const canReset = lane.canResetShot(room.rolled) && (lane.mode === 'classic' || (lanePairPresent && lane.bothJoined && lane.roundSettled));
  return { type: 'state', room: room.id, tick: room.tick, phase: room.phase, pauseReason: room.pauseReason, clockSeconds: room.clock,
    players: room.players.map(p => ({ id: p.id, name: p.name, position: vec(p.body.translation()), rotation: Math.atan2(p.x, p.z), connected: !!p.socket, ready: p.ready })),
    objects: room.entities.map(e => { const q = e.body.rotation(); return { id: e.id, kind: e.kind, position: vec(e.body.translation()), rotation: [q.x, q.y, q.z, q.w] }; }),
    claw: room.claw.snapshot(), pool: room.pool.snapshot(), voice: { enabled: { ...room.voice.enabled }, epoch: room.voice.epoch }, ending: { phase: room.ending, ownChoice: viewer ? room.choices[viewer] : null },
    lane: { pinsDown, canBowl, canReset, bowler: room.bowler, mode: lane.mode, participants: [...lane.participants], warmups: { ...lane.warmups }, unlocked: lane.unlocked, roller: lane.roller, pilot: lane.pilot, round: lane.round, score: lane.score, complete: lane.complete, roundSettled: lane.roundSettled } };
}
/** Only automatic, already-started actions delay the private choice or ending. */
function activityInFlight(room: Room) {
  return room.laneGame.hasPendingRoll || room.pool.isRolling || room.claw.phase === 'dropping' || room.claw.phase === 'lifting';
}
function midnightPending(room: Room) {
  return room.clock >= VENUE.endTime && (room.ending === 'waiting' || room.ending === 'choice');
}
function publishState(room: Room) { for (const p of room.players) send(p.socket, state(room, p.id)); }
export async function attachGameServer(httpServer: Server, opts: { tickRate?: number; startClock?: number; storyRate?: number } = {}): Promise<{ close: () => Promise<void> }> {
  await RAPIER.init();
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024 });
  function end(room: Room, message: string) {
    if (room.closed) return;
    room.closed = true; room.phase = 'ended';
    broadcast(room, { type: 'ended', message });
    for (const p of room.players) { const ws = p.socket; p.socket = null; ws?.close(); }
    rooms.delete(room.id); room.pool.free(); room.world.free();
  }
  wss.on('connection', ws => {
    let joined: { room: Room; player: Player } | null = null;
    const joinTimeout = setTimeout(() => { if (!joined) ws.close(1008, 'Join timeout'); }, 10_000);
    let windowStart = Date.now(), count = 0, chatWindowStart = Date.now(), chatCount = 0, voiceWindowStart = Date.now(), voiceCount = 0;
    const fail = (message: string) => send(ws, { type: 'error', message });
    ws.on('error', () => {});
    ws.on('message', data => {
      const now = Date.now();
      if (now - windowStart >= 1000) { windowStart = now; count = 0; }
      if (++count > 100) { ws.close(1008, 'Rate limit'); return; }
      let msg: Record<string, unknown>;
      try { const parsed: unknown = JSON.parse(data.toString()); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Invalid message'); msg = parsed as Record<string, unknown>; } catch { return fail('Invalid message'); }
      if (!joined) {
        if (msg.type !== 'join' || typeof msg.name !== 'string' || !/^[\p{L}\p{N} _'-]{1,24}$/u.test(msg.name.trim())) { fail('Invalid join'); ws.close(); return; }
        const name = msg.name.trim();
        if (msg.room !== undefined && (typeof msg.room !== 'string' || !/^[A-F0-9]{6}$/.test(msg.room))) { fail('Invalid room'); ws.close(); return; }
        if (msg.token !== undefined && (typeof msg.token !== 'string' || !/^[a-f0-9]{48}$/.test(msg.token))) { fail('Invalid token'); ws.close(); return; }
        let room: Room | undefined;
        if (typeof msg.room === 'string') room = rooms.get(msg.room);
        else if (msg.token === undefined) { let roomId: string; do roomId = id(3).toUpperCase(); while (rooms.has(roomId)); room = createRoom(roomId); if (finite(opts.startClock)) room.clock = Math.max(VENUE.startTime, Math.min(VENUE.endTime, opts.startClock)); rooms.set(roomId, room); }
        if (!room || room.closed) { fail('Room not found'); ws.close(); return; }
        let player: Player | undefined;
        if (msg.token !== undefined) {
          player = room.players.find(p => p.token === msg.token);
          if (!player || player.socket || player.disconnectedAt === null || now - player.disconnectedAt >= GRACE_MS) { fail('Invalid or active token'); ws.close(); return; }
          player.socket = ws; player.disconnectedAt = null; player.ready = false;
          if (room.phase === 'paused' && room.pauseReason === 'reconnect' && room.players.length === 2 && room.players.every(p => p.socket)) room.pauseReason = 'manual';
        } else {
          if (room.players.length >= 2) { fail('Room full'); ws.close(); return; }
          const playerId: PlayerId = room.players.length === 0 ? 'p1' : 'p2';
          const body = room.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...VENUE.spawn[playerId]).lockRotations().setCcdEnabled(true));
          shape(room.world, body, RAPIER.ColliderDesc.capsule(.45, .3).setFriction(.2));
          player = { id: playerId, name, token: id(24), socket: ws, body, x: 0, z: 0, inputAt: 0, ready: false, disconnectedAt: null };
          room.players.push(player);
          if (room.players.length === 2 && room.players.every(p => p.socket)) { room.phase = 'playing'; room.pauseReason = null; }
        }
        joined = { room, player };
        clearTimeout(joinTimeout);
        send(ws, { type: 'welcome', room: room.id, playerId: player.id, token: player.token });
        publishState(room); return;
      }
      const { room, player } = joined;
      if (room.closed || player.socket !== ws) return;
      const lanePairPresent = () => room.phase === 'playing' && room.players.length === 2 && room.players.every(p => !!p.socket && nearLane(vec(p.body.translation())));
      const poolPairPresent = () => room.phase === 'playing' && room.players.length === 2 && room.players.every(p => !!p.socket && nearPool(vec(p.body.translation())));
      switch (msg.type) {
        case 'lane-join': if ((room.phase !== 'playing' && room.phase !== 'waiting') || !nearLane(vec(player.body.translation())) || !room.laneGame.join(player.id)) fail('Cannot join lane'); break;
        case 'lane-leave': room.laneGame.leave(player.id); break;
        case 'lane-mode': {
          if (room.phase !== 'playing' || !nearLane(vec(player.body.translation())) || !room.laneGame.participants.includes(player.id) || (msg.mode !== 'classic' && msg.mode !== 'arcade') || room.laneGame.hasPendingRoll || (!room.rolled && !laneStopped(room)) || !room.laneGame.selectMode(msg.mode, lanePairPresent())) return fail('Cannot change lane mode');
          resetLane(room); break;
        }
        case 'lane-flippers': if (room.phase !== 'playing' || !nearLane(vec(player.body.translation())) || typeof msg.left !== 'boolean' || typeof msg.right !== 'boolean' || !room.laneGame.setFlippers(player.id, msg.left, msg.right, now, lanePairPresent())) fail('Cannot move flippers'); break;
        case 'voice-enable': {
          if (typeof msg.enabled !== 'boolean' || Object.keys(msg).some(k => !['type', 'enabled'].includes(k))) return fail('Invalid voice setting');
          if (msg.enabled && (room.phase !== 'playing' || room.players.length !== 2 || room.players.some(p => !p.socket))) return fail('Cannot enable voice');
          if (room.voice.enabled[player.id] !== msg.enabled) { room.voice.enabled[player.id] = msg.enabled; room.voice.epoch++; publishState(room); }
          break;
        }
        case 'voice-signal': {
          if (now - voiceWindowStart >= 10_000) { voiceWindowStart = now; voiceCount = 0; }
          if (++voiceCount > 40) return fail('Voice signaling rate limit');
          if (Object.keys(msg).some(k => !['type', 'epoch', 'signal'].includes(k)) || !Number.isSafeInteger(msg.epoch) || msg.epoch !== room.voice.epoch || room.phase !== 'playing' || room.players.length !== 2 || room.players.some(p => !p.socket || !room.voice.enabled[p.id])) return fail('Cannot signal voice');
          const signal = validateVoiceSignal(msg.signal, player.id); if (!signal) return fail('Invalid voice signal');
          const other = room.players.find(p => p.id !== player.id); send(other?.socket ?? null, { type: 'voice-signal', from: player.id, epoch: room.voice.epoch, signal }); break;
        }
        case 'pool-join': if (room.phase !== 'playing' || !nearPool(vec(player.body.translation())) || !room.pool.join(player.id)) fail('Cannot join pool'); break;
        case 'pool-leave': room.pool.leave(player.id); break;
        case 'pool-pass': if (!poolPairPresent() || !room.pool.pass(player.id)) fail('Cannot pass pool turn'); break;
        case 'pool-rerack': if (!poolPairPresent() || !room.pool.rerack(player.id)) fail('Cannot rerack pool'); break;
        case 'pool-shoot': if (midnightPending(room) || !poolPairPresent() || !finite(msg.angle) || !finite(msg.power) || !room.pool.shoot(player.id, msg.angle, msg.power)) fail('Cannot shoot pool'); break;
        case 'claw-join': if (room.phase !== 'playing' || !nearClaw(vec(player.body.translation())) || !room.claw.join(player.id)) fail('Cannot join claw'); break;
        case 'claw-leave': room.claw.leave(player.id); break;
        case 'claw-swap': if (room.phase !== 'playing' || !nearClaw(vec(player.body.translation())) || !room.claw.swap(player.id)) fail('Cannot swap claw roles'); break;
        case 'claw-move': if (room.phase !== 'playing' || !nearClaw(vec(player.body.translation())) || (msg.direction !== -1 && msg.direction !== 0 && msg.direction !== 1) || !room.claw.move(player.id, msg.direction, now)) fail('Cannot move claw'); break;
        case 'claw-ready': if ((midnightPending(room) && room.claw.phase === 'aiming' && msg.ready === true) || room.phase !== 'playing' || room.players.length !== 2 || room.players.some(p => !p.socket || !nearClaw(vec(p.body.translation()))) || typeof msg.ready !== 'boolean' || !room.claw.setReady(player.id, msg.ready)) fail('Cannot ready claw'); break;
        case 'kiss-choice': if (room.phase !== 'playing' || room.ending !== 'choice' || typeof msg.choice !== 'boolean') fail('Cannot choose now'); else room.choices[player.id] = msg.choice; break;
        case 'input': {
          if (!finite(msg.x) || !finite(msg.z)) return fail('Invalid input');
          const magnitude = Math.hypot(msg.x, msg.z); player.x = msg.x / Math.max(1, magnitude); player.z = msg.z / Math.max(1, magnitude); player.inputAt = now; break;
        }
        case 'bowl': {
          if (!finite(msg.aim) || !finite(msg.power) || !finite(msg.spin) || Math.abs(msg.aim) > 1 || msg.power < 0 || msg.power > 1 || Math.abs(msg.spin) > 1) return fail('Invalid bowl');
          if (room.phase === 'paused' || room.phase === 'ended' || midnightPending(room) || room.rolled || !nearLane(vec(player.body.translation())) || !room.laneGame.canRoll(player.id, lanePairPresent())) return fail('Cannot bowl');
          const ball = room.entities.find(e => e.kind === 'ball')!.body;
          if (room.players.some(p => { const v = p.body.translation(); return Math.hypot(v.x - VENUE.laneX, v.z - VENUE.laneStartZ) < .7; })) return fail('Tee is blocked');
          ball.setTranslation({ x: VENUE.laneX, y: .3, z: VENUE.laneStartZ }, true);
          ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          ball.setLinvel({ x: msg.aim * 3, y: 0, z: -(4 + msg.power * 9) }, true); ball.setAngvel({ x: -(4 + msg.power * 9) / .3, y: 0, z: -msg.spin * 8 }, true);
          room.rolled = true; room.bowler = player.id; room.laneGame.beginRoll(player.id); break;
        }
        case 'reset-lane': if (room.phase !== 'paused' && room.laneGame.canResetShot(room.rolled) && nearLane(vec(player.body.translation())) && room.laneGame.reset(lanePairPresent())) resetLane(room); else fail('Cannot reset'); break;
        case 'pause': if (room.phase === 'playing') { room.phase = 'paused'; room.pauseReason = 'manual'; room.voice.epoch++; room.claw.clearInputs(); room.laneGame.clearInputs(); if (room.ending === 'choice') { room.choices = { p1: null, p2: null }; room.midnightElapsed = 0; } for (const p of room.players) { p.ready = false; p.x = p.z = 0; } publishState(room); } break;
        case 'resume': if (room.phase === 'paused' && room.players.length === 2 && room.players.every(p => p.socket)) { player.ready = true; if (room.players.every(p => p.ready)) { room.phase = 'playing'; room.pauseReason = null; for (const p of room.players) p.ready = false; publishState(room); } } break;
        case 'chat': if (now - chatWindowStart >= 10_000) { chatWindowStart = now; chatCount = 0; } if (++chatCount > 15) { fail('Chat rate limit'); break; } if (typeof msg.text === 'string') { const text = msg.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); if (text.length > 0 && text.length <= 300) broadcast(room, { type: 'chat', playerId: player.id, name: player.name, text }); else fail('Invalid chat'); } else fail('Invalid chat'); break;
        case 'reaction': if (msg.reaction === 'heart' || msg.reaction === 'laugh' || msg.reaction === 'nice') broadcast(room, { type: 'reaction', playerId: player.id, reaction: msg.reaction }); else fail('Invalid reaction'); break;
        case 'leave': end(room, 'A player left the date.'); break;
        default: fail('Unknown message');
      }
    });
    ws.on('close', () => {
      clearTimeout(joinTimeout);
      if (!joined || joined.room.closed || joined.player.socket !== ws) return;
      const { room, player } = joined; if (room.phase === 'ended') { end(room, 'The celebration ended.'); return; } player.socket = null; player.disconnectedAt = Date.now(); player.x = player.z = 0;
      room.phase = 'paused'; room.pauseReason = 'reconnect'; room.voice.enabled = { p1: false, p2: false }; room.voice.epoch++; room.claw.clearInputs(); room.laneGame.clearInputs(); if (room.ending === 'choice') { room.choices = { p1: null, p2: null }; room.midnightElapsed = 0; } for (const p of room.players) p.ready = false;
      publishState(room);
    });
  });
  let last = performance.now(), accumulator = 0, nextSnapshot = 0;
  const tickRate = Number.isFinite(opts.tickRate) ? Math.max(5, Math.min(60, opts.tickRate!)) : 20;
  const timer = setInterval(() => {
    const now = performance.now(); accumulator += Math.min(.25, (now - last) / 1000); last = now;
    let steps = 0;
    while (accumulator >= STEP && steps++ < 15) {
      accumulator -= STEP;
      for (const room of rooms.values()) {
        if (room.players.some(p => p.disconnectedAt !== null && Date.now() - p.disconnectedAt >= GRACE_MS)) { end(room, 'A player did not reconnect.'); continue; }
        if (room.phase !== 'paused' && room.phase !== 'ended') {
          for (const p of room.players) {
            const fresh = p.socket && Date.now() - p.inputAt < INPUT_TTL_MS;
            const v = p.body.linvel(); p.body.setLinvel({ x: fresh ? p.x * VENUE.playerSpeed : 0, y: v.y, z: fresh ? p.z * VENUE.playerSpeed : 0 }, true);
          }
          if (room.phase === 'playing') {
            for (const p of room.players) if (!nearClaw(vec(p.body.translation()))) room.claw.leave(p.id);
            room.claw.step(STEP, Date.now());
            for (const p of room.players) if (!nearLane(vec(p.body.translation()))) room.laneGame.leave(p.id);
            room.laneGame.step(STEP, Date.now(), room.players.length === 2 && room.players.every(p => !!p.socket && nearLane(vec(p.body.translation()))));
            for (const p of room.players) if (!nearPool(vec(p.body.translation()))) room.pool.leave(p.id);
            room.pool.step();
          }
          for (const entity of room.entities) if (entity.kind === 'pin') updatePinGroundDamping(entity.body);
          room.world.step(); room.tick++;
          if (room.rolled && room.laneGame.hasPendingRoll) {
            const stopped = laneStopped(room);
            const pinsDown = stopped ? room.entities.filter(e => e.kind === 'pin' && (Math.abs(e.body.rotation().x) > .4 || Math.abs(e.body.rotation().z) > .4 || e.body.translation().y < .27)).length : 0;
            room.laneGame.observe(stopped, STEP, pinsDown);
          }
          if (room.phase === 'playing') {
            room.clock = Math.min(VENUE.endTime, room.clock + STEP * (finite(opts.storyRate) ? Math.max(0, opts.storyRate) : VENUE.storyRate));
            const safe = !activityInFlight(room);
            if (room.ending === 'waiting' && room.clock >= VENUE.endTime - 300 && safe) room.ending = 'choice';
            if (room.clock >= VENUE.endTime && room.ending === 'choice' && safe) {
              room.midnightElapsed += STEP;
              if (room.choices.p1 === true && room.choices.p2 === true) room.ending = 'kiss';
              else if (room.midnightElapsed >= 15) room.ending = 'celebration';
            }
          }
        }
      }
    }
    if (now >= nextSnapshot) { nextSnapshot = now + 1000 / tickRate; for (const room of rooms.values()) for (const p of room.players) send(p.socket, state(room, p.id)); }
  }, 8);
  return { close: async () => { clearInterval(timer); for (const room of [...rooms.values()]) end(room, 'Server stopped.'); for (const client of wss.clients) client.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); } };
}
