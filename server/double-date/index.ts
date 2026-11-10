import { DOLPHIN_LLM_MODEL, HORDE_MODEL, isEarnedModel } from '../../src/restaurant/types';
import type { RestaurantScenarioId } from '../../src/restaurant/scenario-types';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import { getDate } from '../../src/restaurant/content';
import { DOUBLE_TABLE, type DoubleDateRoomState, type DoubleHumanId, type DoubleMember, type DoubleRoomCommand, type DoubleVoiceSignal } from '../../src/restaurant/double-date-types';
import type { ClaudeModel } from '../../src/restaurant/types';
import type { RestaurantServices } from '../restaurant';
import { validateCommand } from '../restaurant';
import { DateApiError } from '../restaurant/providers';
import { validateVoiceSignal } from '../voice';
import { DoubleConversation } from './conversation';
import { createPairView, DoubleTableScene } from './scene';
import { initializeScenario, resolveScenario, tickScenario } from './scenarios';

export interface DoubleDateOptions {
  scenarioId?: RestaurantScenarioId;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  autoTick?: boolean;
  storyRate?: number;
  reconnectMs?: number;
  disconnectMs?: number;
  roomIdleMs?: number;
}
type Seat = { tokenHash: string; lastSeen: number; disconnectedAt?: number; voiceWindow: number; voiceCount: number; epoch: number };
type Signal = DoubleVoiceSignal & { to: DoubleHumanId; at: number };
type Room = { state: DoubleDateRoomState; scene: DoubleTableScene; conversation: DoubleConversation; seats: Map<DoubleHumanId, Seat>; signals: Signal[]; signalId: number; touched: number; resumeAfterReconnect: boolean };
const humans: DoubleHumanId[] = ['h1', 'h2'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const failure = (status: number, code: string, message: string) => new DateApiError(status, code, message);
const hash = (token: string) => createHash('sha256').update(token).digest();
function json(res: ServerResponse, status: number, value: unknown) { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); }
function errorResponse(res: ServerResponse, caught: unknown) { const e = caught instanceof DateApiError ? caught : failure(500, 'room_error', 'The table could not complete that action. Please try again.'); if (res.headersSent) { if (!res.destroyed && !res.writableEnded) res.end(); } else json(res, e.status, { code: e.code, error: e.message, message: e.message }); }
async function body(req: IncomingMessage) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw failure(415, 'content_type', 'Send application/json.');
  if (Number(req.headers['content-length'] || 0) > 48 * 1024) { req.resume(); throw failure(413, 'body_limit', 'This request is too large.'); }
  const chunks: Buffer[] = []; let length = 0;
  for await (const bytes of req) { const chunk = Buffer.from(bytes); length += chunk.length; if (length > 48 * 1024) throw failure(413, 'body_limit', 'This request is too large.'); chunks.push(chunk); }
  let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure(400, 'invalid_json', 'Invalid JSON request.'); }
  if (!object(value)) throw failure(400, 'invalid_json', 'Expected a JSON object.'); return value;
}
function name(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.trim().length > 32 || /[\u0000-\u001f\u007f]/.test(value)) throw failure(400, 'invalid_name', 'Enter a name of 1–32 characters.'); return value.trim(); }
function iceConfiguration(env: NodeJS.ProcessEnv): RTCIceServer[] {
  const source = env.DATE_ICE_SERVERS_JSON || env.VOICE_ICE_SERVERS_JSON;
  if (!source) return [{ urls: 'stun:stun.l.google.com:19302' }];
  let value: unknown; try { value = JSON.parse(source); } catch { throw failure(500, 'voice_configuration', 'DATE_ICE_SERVERS_JSON must contain a JSON array of RTC ice servers.'); }
  if (!Array.isArray(value) || value.length > 8) throw failure(500, 'voice_configuration', 'Configure at most eight RTC ice servers.');
  return value.map(server => {
    if (!object(server) || !exact(server, ['urls', 'username', 'credential'])) throw failure(500, 'voice_configuration', 'An RTC ice server has unsupported fields.');
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string' || url.length > 512 || !/^(?:stun|stuns|turn|turns):[^\s]+$/.test(url)) || (server.username !== undefined && (typeof server.username !== 'string' || server.username.length > 512)) || (server.credential !== undefined && (typeof server.credential !== 'string' || server.credential.length > 1024))) throw failure(500, 'voice_configuration', 'An RTC ice server has invalid URLs or credentials.');
    return { urls: server.urls as string | string[], ...(server.username === undefined ? {} : { username: server.username as string }), ...(server.credential === undefined ? {} : { credential: server.credential as string }) };
  });
}

/** REST room transport; speech has its own streaming response and never enters gameplay messages. */
export async function attachDoubleDateServer(_http: Server, restaurant: { services: RestaurantServices }, options: DoubleDateOptions = {}) {
  await RAPIER.init();
  const services = restaurant.services, now = options.now ?? services.now, env = options.env ?? process.env;
  const iceServers = iceConfiguration(env), reconnectMs = options.reconnectMs ?? 60_000, disconnectMs = options.disconnectMs ?? 12_000, roomIdleMs = options.roomIdleMs ?? 60 * 60_000;
  const rooms = new Map<string, Room>(), codes = new Map<string, string>(); let closed = false;
  const snapshot = (room: Room) => { for (const view of Object.values(room.state.views)) view.generation = room.state.generation; return structuredClone(room.state); };
  const member = (room: Room, id: DoubleHumanId) => room.state.members.find(item => item.id === id)!;
  const bumpVoice = (room: Room) => { room.state.voice.epoch++; room.signals.length = 0; room.state.revision++; };
  const disconnect = (room: Room, id: DoubleHumanId, at: number) => {
    const seat = room.seats.get(id)!, player = member(room, id); if (!player.connected) return;
    seat.disconnectedAt = at; seat.epoch++; player.connected = false; room.state.voice.enabled[id] = false; bumpVoice(room);
    if (room.state.phase === 'playing' || room.state.phase === 'paused') {
      if (room.state.phase === 'playing') room.resumeAfterReconnect = true;
      room.scene.setPhase('paused'); room.state.pauseReason = 'reconnect'; room.conversation.interrupt();
    }
  };
  const reconnect = (room: Room, id: DoubleHumanId, at: number) => {
    const player = member(room, id), seat = room.seats.get(id)!; seat.lastSeen = at;
    if (!player.connected) { player.connected = true; delete seat.disconnectedAt; bumpVoice(room); }
    if (room.state.phase === 'paused' && room.state.pauseReason === 'reconnect' && room.state.members.length === 2 && room.state.members.every(item => item.connected)) {
      if (room.resumeAfterReconnect) { room.scene.setPhase('playing'); room.state.pauseReason = undefined; room.conversation.resume(); }
      else room.state.pauseReason = 'manual';
      room.resumeAfterReconnect = false; room.state.revision++;
    }
  };
  const remove = (id: string) => { const room = rooms.get(id); if (!room) return; room.conversation.close(); room.scene.free(); rooms.delete(id); codes.delete(room.state.code); };
  const maintain = (at: number) => {
    for (const [id, room] of rooms) {
      if (at - room.touched > roomIdleMs) { remove(id); continue; }
      for (const [human, seat] of room.seats) if (member(room, human).connected && at - seat.lastSeen > disconnectMs) disconnect(room, human, at);
      const expired = [...room.seats].find(([, seat]) => seat.disconnectedAt !== undefined && at - seat.disconnectedAt > reconnectMs);
      if (expired) {
        if (room.state.phase !== 'waiting' || expired[0] === 'h1') { remove(id); continue; }
        room.state.members = room.state.members.filter(item => item.id !== 'h2'); room.state.dates = room.state.dates.filter(item => item.humanId !== 'h2'); room.seats.delete('h2'); member(room, 'h1').ready = false; room.state.revision++;
      }
      room.signals = room.signals.filter(signal => at - signal.at < 120_000);
    }
  };
  const authorize = (req: IncomingMessage, id: string) => {
    maintain(now()); const room = rooms.get(id); if (!room) throw failure(404, 'room_missing', 'This table is no longer available.');
    const token = /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || '')?.[1];
    const seat = token ? [...room.seats].find(([, item]) => timingSafeEqual(hash(token), Buffer.from(item.tokenHash, 'hex'))) : undefined;
    if (!seat) throw failure(401, 'unauthorized', 'This table requires your player token.');
    const at = now(), isSnapshot = req.method === 'GET' && new URL(req.url || '/', 'http://localhost').pathname === `/api/double-date/rooms/${id}`;
    if (!member(room, seat[0]).connected) {
      if (!isSnapshot) throw failure(409, 'friend_disconnected', 'Reconnect to the table before continuing.');
      reconnect(room, seat[0], at);
    } else seat[1].lastSeen = at;
    room.touched = at; return { room, human: seat[0], seat: seat[1], epoch: seat[1].epoch };
  };
  const addMember = (room: Room, id: DoubleHumanId, playerName: string) => {
    const token = randomBytes(24).toString('hex'), position = DOUBLE_TABLE.seats[id];
    const player: DoubleMember = { id, name: playerName, connected: true, ready: false, dateId: null, position: [position[0], 0, position[2]], yaw: 0, seated: true };
    room.state.members.push(player); room.state.views[id].participants[0].name = playerName;
    room.seats.set(id, { tokenHash: hash(token).toString('hex'), lastSeen: now(), voiceWindow: now(), voiceCount: 0, epoch: 0 }); room.state.revision++;
    return { roomId: room.state.id, memberId: id, token, state: snapshot(room) };
  };
  function resumeAfterPersonalChoice(room: Room) {
    if (room.state.phase === 'paused' && room.state.pauseReason === 'manual' && room.state.members.every(member => member.connected) && Object.values(room.state.views).some(view => view.phase !== 'ended')) {
      room.scene.setPhase('playing'); room.state.pauseReason = undefined; room.resumeAfterReconnect = false; room.conversation.resume();
    }
  }
  function command(room: Room, human: DoubleHumanId, data: Record<string, unknown>) {
    const state = room.state, player = member(room, human);
    if (data.type === 'choose-date' && exact(data, ['type', 'dateId']) && getDate(String(data.dateId))) {
      if (state.phase !== 'waiting') throw failure(409, 'already_started', 'Choose your date before dinner starts.');
      if (state.members.some(item => item.id !== human && item.dateId === data.dateId)) throw failure(409, 'date_taken', 'Your friend has already invited that date.');
      player.dateId = data.dateId as NonNullable<DoubleMember['dateId']>; player.ready = false; room.scene.chooseDate(human, player.dateId);
    } else if (data.type === 'ready' && exact(data, ['type', 'ready']) && typeof data.ready === 'boolean') {
      if (state.phase !== 'waiting' || !player.dateId) throw failure(409, 'not_ready', 'Choose your date before getting ready.'); player.ready = data.ready;
    } else if (data.type === 'start' && exact(data, ['type'])) {
      if (human !== state.hostId) throw failure(403, 'host_only', 'Your host starts the evening.');
      if (state.phase !== 'waiting' || state.members.length !== 2 || !state.members.every(item => item.connected && item.ready && item.dateId) || state.dates.length !== 2) throw failure(409, 'not_ready', 'Both friends need to choose a date and get ready.');
      room.scene.setPhase('playing'); room.conversation.collectCues();
    } else if (data.type === 'set-model' && exact(data, ['type', 'model']) && services.status().models.includes(data.model as ClaudeModel)) {
      if (human !== state.hostId) throw failure(403, 'host_only', 'Your host chooses the table’s conversation model.'); if (isEarnedModel(data.model) && data.model !== DOLPHIN_LLM_MODEL && data.model !== services.status().defaultModel) throw failure(409, data.model === HORDE_MODEL ? 'horde_locked' : 'dolphin_locked', 'The alternative model unlocks independently for each couple through mutual chemistry.'); state.model = data.model as ClaudeModel;
    } else if (data.type === 'reset-model' && exact(data, ['type'])) {
      if (human !== state.hostId) throw failure(403, 'host_only', 'Your host chooses the table’s conversation model.');
      room.conversation.resetModel();
      state.model = services.status().defaultModel;
      for (const view of Object.values(state.views)) view.conversationModel = services.modelFor?.(state.model, view) ?? state.model;
    } else if ((data.type === 'view-ending' || data.type === 'return-to-table') && exact(data, ['type'])) {
      try { room.scene.viewEnding(human, data.type === 'view-ending'); } catch (caught) { throw failure(409, 'personal_ending', caught instanceof Error ? caught.message : 'Finish your date first.'); }
      resumeAfterPersonalChoice(room);
    } else if (data.type === 'scenario' && exact(data, ['type', 'choice']) && typeof data.choice === 'string' && data.choice.length < 80) {
      throw failure(409, 'scenario_action', 'There are no scripted table scenarios.');
    } else if (data.type === 'scene' && exact(data, ['type', 'command'])) {
      const sceneCommand = validateCommand(data.command);
      if (state.phase === 'waiting' || state.phase === 'ended') throw failure(409, 'inactive_room', 'Start the evening before interacting.');
      if (sceneCommand.type === 'pause' && !sceneCommand.paused && state.members.some(item => !item.connected)) throw failure(409, 'friend_disconnected', 'Wait for your friend to reconnect before resuming.');
      try {
        room.scene.command(human, sceneCommand, now());
        if (sceneCommand.type === 'finish') resumeAfterPersonalChoice(room);
      } catch (caught) { throw failure(409, 'scene_action', caught instanceof Error ? caught.message : 'That action is unavailable.'); }
      if (sceneCommand.type === 'pause') {
        state.pauseReason = sceneCommand.paused ? 'manual' : undefined; room.resumeAfterReconnect = false;
        // Resume creates fresh peer connections. Neither queued signaling nor
        // already-delivered messages may belong to those new connections.
        if (sceneCommand.paused) { bumpVoice(room); room.conversation.interrupt(); }
        else room.conversation.resume();
      }
      room.conversation.collectCues();
    } else if (data.type === 'voice-enable' && exact(data, ['type', 'enabled']) && typeof data.enabled === 'boolean') {
      if (state.voice.enabled[human] !== data.enabled) { state.voice.enabled[human] = data.enabled; bumpVoice(room); }
    } else if (data.type === 'voice-signal' && exact(data, ['type', 'epoch', 'signal'])) {
      const peer = human === 'h1' ? 'h2' : 'h1', signal = validateVoiceSignal(data.signal, human === 'h1' ? 'p1' : 'p2');
      if (state.phase !== 'playing' || !Number.isSafeInteger(data.epoch) || data.epoch !== state.voice.epoch || !humans.every(id => state.voice.enabled[id] && state.members.some(item => item.id === id && item.connected))) throw failure(409, 'voice_epoch', 'Voice connection changed. Reconnect with the current room state.');
      if (!signal) throw failure(400, 'invalid_voice_signal', 'Invalid voice signaling message.');
      const seat = room.seats.get(human)!; if (now() - seat.voiceWindow > 10_000) { seat.voiceWindow = now(); seat.voiceCount = 0; }
      if (++seat.voiceCount > 160) throw failure(429, 'voice_signal_limit', 'Too many voice connection messages.');
      room.signals.push({ id: ++room.signalId, from: human, to: peer, epoch: state.voice.epoch, signal, at: now() }); room.signals = room.signals.slice(-256);
    } else throw failure(400, 'invalid_command', 'Invalid table command.');
    state.revision++;
  }
  async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (closed) throw failure(503, 'server_closed', 'The table server is shutting down.');
    if (req.method === 'POST' && req.headers.origin) { let origin: URL; try { origin = new URL(req.headers.origin); } catch { throw failure(403, 'origin', 'Invalid request origin.'); } if (origin.host !== req.headers.host) throw failure(403, 'origin', 'Open the game on this server to use its API.'); }
    if (req.method === 'POST' && url.pathname === '/api/double-date/rooms') {
      maintain(now()); if (rooms.size >= 100) throw failure(429, 'room_capacity', 'The restaurant is full. Please try again shortly.');
      const data = await body(req), playerName = name(data.name), status = services.status();
      if (!exact(data, ['name', 'model', 'sessionLimit']) || data.model !== undefined && !status.models.includes(data.model as ClaudeModel)) throw failure(400, 'invalid_room', 'Choose a supported conversation model.');
      if (data.sessionLimit !== undefined && (typeof data.sessionLimit !== 'number' || !Number.isFinite(data.sessionLimit) || data.sessionLimit < .01)) throw failure(400, 'invalid_limit', 'Choose a positive room spending limit.');
      if (isEarnedModel(data.model) && data.model !== DOLPHIN_LLM_MODEL && data.model !== status.defaultModel) throw failure(409, data.model === HORDE_MODEL ? 'horde_locked' : 'dolphin_locked', 'Start with Haiku and build mutual chemistry first.');
      const account = services.createAccount(data.sessionLimit as number | undefined), id = randomBytes(12).toString('hex');
      let code: string; do { code = [...randomBytes(6)].map(value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join(''); } while (codes.has(code));
      const state: DoubleDateRoomState = { id, code, mode: 'double-date', phase: 'waiting', hostId: 'h1', generation: 0, revision: 0, members: [], dates: [], views: { h1: createPairView(id, 'h1', playerName, 'mira', account.usage, account.sessionLimit), h2: createPairView(id, 'h2', 'Your friend', 'jules', account.usage, account.sessionLimit) }, lines: [], usage: account.usage, sessionLimit: account.sessionLimit, model: data.model as ClaudeModel || status.defaultModel, voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: structuredClone(iceServers) } };
      const scene = new DoubleTableScene(state, options.storyRate), conversation = new DoubleConversation(state, scene, services, account);
      const room: Room = { state, scene, conversation, seats: new Map(), signals: [], signalId: 0, touched: now(), resumeAfterReconnect: false }; rooms.set(id, room); codes.set(code, id);
      json(res, 201, addMember(room, 'h1', playerName)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/double-date/rooms/join') {
      maintain(now()); const data = await body(req), playerName = name(data.name);
      if (!exact(data, ['code', 'name']) || typeof data.code !== 'string' || !/^[A-Z2-9]{6}$/.test(data.code.trim().toUpperCase())) throw failure(400, 'invalid_code', 'Enter the six-character table code.');
      const room = rooms.get(codes.get(data.code.trim().toUpperCase()) || ''); if (!room) throw failure(404, 'room_missing', 'That table code is no longer available.');
      if (room.state.phase !== 'waiting' || room.seats.has('h2')) throw failure(409, 'room_full', 'Both seats at that table are taken. Reconnect with your saved player token.');
      room.touched = now(); json(res, 201, addMember(room, 'h2', playerName)); return;
    }
    const match = /^\/api\/double-date\/rooms\/([a-f0-9]{24})(?:\/(command|turn|interrupt|speech|playback|leave))?$/.exec(url.pathname);
    if (!match) throw failure(404, 'route_missing', 'Unknown table endpoint.');
    const { room, human, seat, epoch } = authorize(req, match[1]), route = match[2];
    if (!route && req.method === 'GET') { const after = Number(url.searchParams.get('after') || 0); if (!Number.isSafeInteger(after) || after < 0) throw failure(400, 'invalid_cursor', 'Invalid voice signal cursor.'); json(res, 200, { state: snapshot(room), signals: room.signals.filter(signal => signal.to === human && signal.id > after).map(({ to: _to, at: _at, ...signal }) => signal) }); return; }
    if (req.method !== 'POST') throw failure(405, 'method', 'Use POST for table actions.');
    const data = await body(req);
    if (room.seats.get(human) !== seat || seat.epoch !== epoch || !member(room, human).connected) throw failure(409, 'friend_disconnected', 'Reconnect to the table before continuing.');
    if (route === 'command') { command(room, human, data); json(res, 200, { state: snapshot(room) }); return; }
    if (route === 'leave') { if (!exact(data, [])) throw failure(400, 'invalid_leave', 'Invalid leave request.'); disconnect(room, human, now()); json(res, 200, { state: snapshot(room) }); return; }
    if (route === 'interrupt') { if (!exact(data, [])) throw failure(400, 'invalid_interrupt', 'Invalid interruption request.'); room.conversation.interrupt(); json(res, 200, { state: snapshot(room) }); return; }
    if (route === 'speech') { if (!exact(data, ['lineId', 'generation']) || typeof data.lineId !== 'string' || data.lineId.length > 80 || !Number.isSafeInteger(data.generation)) throw failure(400, 'invalid_speech', 'Invalid speech request.'); await room.conversation.speech(req, res, data.lineId, data.generation as number); return; }
    if (route === 'playback') { if (!exact(data, ['lineId', 'generation', 'completed', 'playedSeconds']) || typeof data.lineId !== 'string' || data.lineId.length > 80 || !Number.isSafeInteger(data.generation) || typeof data.completed !== 'boolean' || typeof data.playedSeconds !== 'number' || !Number.isFinite(data.playedSeconds) || data.playedSeconds < 0 || data.playedSeconds > 300) throw failure(400, 'invalid_playback', 'Invalid playback receipt.'); room.conversation.playback(human, data.lineId, data.generation as number, data.completed, data.playedSeconds); json(res, 200, { state: snapshot(room) }); return; }
    if (route !== 'turn') throw failure(404, 'route_missing', 'Unknown table endpoint.');
    if (!exact(data, ['turnId', 'text', 'target', 'via']) || (data.via !== undefined && data.via !== 'voice' && data.via !== 'typed') || typeof data.turnId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.turnId) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.text) || !['h1', 'h2', 'd1', 'd2', 'table'].includes(data.target as string) || data.target === human) throw failure(400, 'invalid_turn', 'Use a short transcript, unique turn ID, and someone else at the table as its target.');
    if (!services.status().claude) throw failure(503, 'claude_unconfigured', 'Live conversation is unavailable. Add ANTHROPIC_API_KEY on the server.');
    const accepted = room.conversation.submit(human, { turnId: data.turnId, text: data.text.trim(), target: data.target as 'table', ...(data.via ? { via: data.via as 'voice' | 'typed' } : {}) }); json(res, accepted ? 202 : 200, { state: snapshot(room) });
  }
  let previous = now();
  const tick = (dt?: number, at = now()) => { maintain(at); const elapsed = dt ?? Math.max(0, Math.min(.1, (at - previous) / 1000)); previous = at; for (const room of rooms.values()) { const wasPlaying = room.state.phase === 'playing'; room.scene.step(elapsed, at); room.conversation.collectCues(); if (wasPlaying && room.state.phase === 'ended') room.conversation.interrupt(); if (wasPlaying) room.state.revision++; } };
  const timer = options.autoTick === false ? undefined : setInterval(() => tick(), 1000 / 60); timer?.unref();
  return {
    handle(req: IncomingMessage, res: ServerResponse) { const url = new URL(req.url || '/', 'http://localhost'); if (!url.pathname.startsWith('/api/double-date/')) return false; void dispatch(req, res, url).catch(caught => errorResponse(res, caught)); return true; },
    tick,
    close() { if (closed) return; closed = true; if (timer) clearInterval(timer); for (const id of [...rooms.keys()]) remove(id); },
  };
}
