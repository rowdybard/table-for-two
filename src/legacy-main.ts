import './style.css';
import { ENDING_SHOT_SECONDS, VenueRenderer } from './render/CinematicVenueRenderer';
import { ARCADE, CLAW, VENUE, nearClaw, nearLane, nearPool } from './shared/venue';
import type { ClientMessage, PlayerId, RoomState, ServerMessage } from './shared/protocol';
import { gameMarkup } from './ui/template';
import { GameAudio } from './audio/GameAudio';
import { VoiceChat, type VoiceStatus } from './voice/VoiceChat';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = gameMarkup;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const button = (id: string) => el<HTMLButtonElement>(id);
const audio = new GameAudio();
const initialState = (): RoomState => ({
  type: 'state', room: '', tick: 0, phase: 'waiting', pauseReason: null,
  clockSeconds: VENUE.startTime, players: [], objects: [],
  lane: { pinsDown: 0, canBowl: true, canReset: false, bowler: null, mode: 'classic', participants: [], warmups: { p1: false, p2: false }, unlocked: false, roller: null, pilot: null, round: 0, score: 0, complete: false, roundSettled: false },
  claw: { phase: 'idle', operators: { x: null, z: null }, x: CLAW.initialX, z: CLAW.initialZ, y: CLAW.restY, ready: { p1: false, p2: false }, moved: { x: false, z: false }, attempts: 0, prizeHeld: false },
  pool: { phase: 'waiting', participants: [], turn: null, shots: 0, total: 6, pocketed: 0, balls: [], lastShot: null },
  ending: { phase: 'waiting', ownChoice: null },
  voice: { enabled: { p1: false, p2: false }, epoch: 0 },
});
let state = initialState(), renderer: VenueRenderer | undefined, socket: WebSocket | undefined;
let voice: VoiceChat | undefined;
let voiceStatus: VoiceStatus = { enabled: false, muted: false, phase: 'off', message: 'Voice is off.', playbackBlocked: false };
let playerId: PlayerId = 'p1', joined = false, intentionalLeave = false;
let activity: 'bowling' | 'claw' | 'pool' | null = null;
let poolDrag: { pointerId: number; cueX: number; cueZ: number; distance: number } | null = null;
let poolShotPending = false;
let heldClaw: -1 | 0 | 1 = 0, lastClaw = 0, reconnectAttempt = 0;
const heldFlippers = { left: false, right: false };
let lastFlippers = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined, toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastFrame = performance.now(), lastInput = 0, celebrationDismissed = false, announcedSurprise = false;
let endingShotSeconds = ENDING_SHOT_SECONDS, choiceDismissed = false;
const keys = new Set<string>();
const urlRoom = new URL(location.href).searchParams.get('room');
if (urlRoom && /^[a-z0-9]{6}$/i.test(urlRoom)) input('room').value = urlRoom.toUpperCase();

function send(message: ClientMessage) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function toast(message: string) { clearTimeout(toastTimer); el('toast').textContent = message; el('toast').hidden = false; toastTimer = setTimeout(() => { el('toast').hidden = true; }, 4500); }
function clawInputEligible() { return activity === 'claw' && state.phase === 'playing' && (state.claw.phase === 'aiming' || state.claw.phase === 'surprise') && (state.claw.operators.x === playerId || state.claw.operators.z === playerId); }
function laneInputEligible() { return activity === 'bowling' && state.phase === 'playing' && state.lane.mode === 'arcade' && state.lane.pilot === playerId && !state.lane.complete && !state.lane.roundSettled; }
function stopMovement(sendActions = true) { const clearLane = lastFlippers || laneInputEligible(); keys.clear(); heldClaw = 0; lastClaw = 0; heldFlippers.left = heldFlippers.right = false; lastFlippers = false; poolDrag = null; if (!sendActions) return; send({ type: 'input', x: 0, z: 0 }); if (clawInputEligible()) send({ type: 'claw-move', direction: 0 }); if (clearLane) send({ type: 'lane-flippers', left: false, right: false }); }
function gameplayInputEnabled() {
  return joined && state.phase !== 'paused' && state.phase !== 'ended' && endingShotSeconds >= ENDING_SHOT_SECONDS && Boolean(el('chat').hidden) && Boolean(el('voice-panel').hidden) && Boolean(el('midnight-choice').hidden) && Boolean(el('celebration').hidden);
}
function midnightPending() { return state.clockSeconds >= VENUE.endTime && (state.ending.phase === 'waiting' || state.ending.phase === 'choice'); }
function sendHeldInput(force = false) {
  const now = performance.now();
  if (!joined || (!force && now - lastInput < 45)) return;
  lastInput = now;
  const active = gameplayInputEnabled();
  const horizontal = active ? Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')) : 0;
  const forward = active ? Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')) : 0;
  const movement = !activity && active ? renderer?.getMovementVector(horizontal, forward) || { x: horizontal, z: forward } : { x: 0, z: 0 };
  send({ type: 'input', ...movement });
  if (movement.x || movement.z) el('welcome').hidden = true;
  const clawAxis = state.claw.operators.x === playerId ? horizontal : state.claw.operators.z === playerId ? forward : 0;
  const eligible = clawInputEligible();
  const direction = active && eligible ? (heldClaw || clawAxis) as -1 | 0 | 1 : 0;
  if (eligible && (direction || lastClaw)) send({ type: 'claw-move', direction });
  lastClaw = direction;
  const laneEligible = active && laneInputEligible();
  const left = laneEligible && (heldFlippers.left || keys.has('a') || keys.has('arrowleft'));
  const right = laneEligible && (heldFlippers.right || keys.has('d') || keys.has('arrowright'));
  if (left || right || lastFlippers) send({ type: 'lane-flippers', left, right });
  lastFlippers = left || right;
  button('flipper-left').setAttribute('aria-pressed', String(left)); button('flipper-right').setAttribute('aria-pressed', String(right));
}
function setActivity(next: typeof activity) {
  stopMovement();
  if (activity === 'claw' && next !== 'claw') send({ type: 'claw-leave' });
  if (activity === 'pool' && next !== 'pool') send({ type: 'pool-leave' });
  if (activity === 'bowling' && next !== 'bowling') send({ type: 'lane-leave' });
  if (next === 'bowling' && activity !== 'bowling') send({ type: 'lane-join' });
  activity = next; renderer?.setActivityFocus(next);
  if (next) el('welcome').hidden = true;
  updateHud();
}
function interact() {
  const me = state.players.find(p => p.id === playerId);
  if (!joined || !me || state.phase === 'paused') return;
  if (activity) { setActivity(null); return; }
  if (nearLane(me.position)) setActivity('bowling');
  else if (nearClaw(me.position)) setActivity('claw');
  else if (nearPool(me.position)) setActivity('pool');
}
function addChat(name: string, text: string) {
  const line = document.createElement('p'), label = document.createElement('strong'); label.textContent = name + ' ';
  line.append(label, document.createTextNode(text)); const log = el('chat-log'); log.appendChild(line);
  while (log.children.length > 80) log.firstElementChild?.remove(); log.scrollTop = log.scrollHeight;
}
function toggleChat(open: boolean) { if (open) toggleVoice(false); el('chat').hidden = !open; el('chat-toggle').setAttribute('aria-expanded', String(open)); stopMovement(); if (open) input('chat-input').focus(); else input('chat-input').blur(); }
function toggleVoice(open: boolean) {
  if (open) toggleChat(false);
  el('voice-panel').hidden = !open; button('voice-toggle').setAttribute('aria-expanded', String(open)); stopMovement();
  updateHud();
}
function renderVoiceStatus() {
  const { enabled, muted, phase, message, playbackBlocked } = voiceStatus;
  const active = enabled || phase === 'requesting';
  const labels = { off: 'Voice off', requesting: 'Mic permission…', waiting: 'Voice waiting', connecting: 'Connecting voice', connected: muted ? 'Mic muted' : 'Voice on', paused: 'Voice paused', error: 'Voice off' };
  button('voice-toggle').textContent = labels[phase]; button('voice-toggle').setAttribute('aria-label', `${labels[phase]}. Open voice controls.`);
  el('voice-status').textContent = message;
  el('voice-enable').hidden = active; button('voice-enable').disabled = !joined || state.phase !== 'playing';
  el('voice-mute').hidden = !enabled; button('voice-mute').textContent = muted ? 'Unmute mic' : 'Mute mic'; button('voice-mute').setAttribute('aria-pressed', String(muted));
  el('voice-disable').hidden = !active; button('voice-disable').textContent = phase === 'requesting' ? 'Cancel' : 'Leave voice';
  el('voice-play').hidden = !playbackBlocked;
}
function formatClock(seconds: number) { const minutes = Math.floor(seconds / 60), hour = Math.floor(minutes / 60) % 24; return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} <small>${hour < 12 ? 'AM' : 'PM'}</small>`; }
function updateHud() {
  renderVoiceStatus();
  const me = state.players.find(p => p.id === playerId), partner = state.players.find(p => p.id !== playerId && p.connected), paused = state.phase === 'paused';
  const presentingEnding = (state.ending.phase === 'kiss' || state.ending.phase === 'celebration') && !celebrationDismissed;
  el('clock').innerHTML = formatClock(state.clockSeconds);
  const canChoose = joined && state.ending.phase === 'choice' && state.phase === 'playing';
  el('midnight-choice').hidden = !canChoose || choiceDismissed;
  button('clock').disabled = !canChoose;
  button('clock').setAttribute('aria-expanded', String(canChoose && !choiceDismissed));
  button('clock').title = canChoose ? 'Open your private midnight choice' : 'Story time';
  el('midnight-hint').hidden = !canChoose || !choiceDismissed;
  el('night-status').textContent = paused ? 'The night can wait.' : partner ? `An evening with ${partner.name}` : 'Your date has a seat waiting.';
  if (joined && socket?.readyState === WebSocket.OPEN) el('connection').textContent = partner ? `${me?.name || 'You'} + ${partner.name} · connected` : 'Your room is ready. Invite your date.';
  button('pause').disabled = state.phase !== 'playing';
  if (activity && (!me || !(activity === 'bowling' ? nearLane(me.position) : activity === 'claw' ? nearClaw(me.position) : nearPool(me.position)))) { activity = null; poolDrag = null; renderer?.setActivityFocus(null); }
  el('controls').hidden = !joined || !!activity || presentingEnding;
  if (presentingEnding) el('welcome').hidden = true;
  el('bowling').hidden = !joined || activity !== 'bowling' || paused; el('claw').hidden = !joined || activity !== 'claw' || paused; el('pool').hidden = !joined || activity !== 'pool' || paused;
  el('interact').hidden = !joined || !me || !!activity || paused || presentingEnding || !(nearLane(me.position) || nearClaw(me.position) || nearPool(me.position));
  el('interaction-label').textContent = me && nearLane(me.position) ? 'Take a lane' : me && nearClaw(me.position) ? 'Try the prize machine together' : 'Clear the pool table together';
  const byCabinets = me && Math.abs(me.position[0] - ARCADE.centerX) < ARCADE.half[0] + 1.6 && Math.abs(me.position[2] - ARCADE.centerZ) < ARCADE.half[2] + 2.2;
  el('station-note').hidden = !joined || !!activity || paused || presentingEnding || !me || nearLane(me.position) || nearClaw(me.position) || nearPool(me.position) || !byCabinets;
  el('station-note').textContent = 'These arcade cabinets aren’t playable in this build yet.';
  updateLaneHud();
  const claw = state.claw, role = claw.operators.x === playerId ? 'x' : claw.operators.z === playerId ? 'z' : null;
  const both = !!claw.operators.x && !!claw.operators.z, steering = (claw.phase === 'aiming' || claw.phase === 'surprise') && both && !paused;
  el('claw-join').hidden = !!role; button('claw-join').disabled = state.phase !== 'playing'; el('claw-controls').hidden = !role;
  el('claw-role').textContent = role === 'x' ? 'You steer left and right · A / D' : 'You steer away and toward you · W / S';
  el('claw-hint').textContent = claw.phase === 'won' ? 'Leave the machine to see your prize in the lounge.' : claw.phase === 'surprise' ? `Use ${role === 'z' ? 'W / S' : 'A / D'} or hold a direction. Guide the shadow over the side hatch, then both choose to release.` : `Hold a direction or use ${role === 'z' ? 'W / S' : 'A / D'}. Match the claw’s shadow to the prize, then both choose to drop.`;
  button('claw-left').textContent = role === 'z' ? 'Away ↑' : '← Left'; button('claw-right').textContent = role === 'z' ? 'Toward ↓' : 'Right →';
  button('claw-left').setAttribute('aria-label', role === 'z' ? 'Move claw away' : 'Move claw left');
  button('claw-right').setAttribute('aria-label', role === 'z' ? 'Move claw toward you' : 'Move claw right');
  button('claw-left').disabled = button('claw-right').disabled = !steering;
  const hatchAligned = claw.x <= CLAW.hatchMaxX && claw.z >= CLAW.hatchMinZ;
  button('claw-ready').disabled = !steering || !(claw.moved.x && claw.moved.z) || (claw.phase === 'surprise' && !hatchAligned) || (midnightPending() && claw.phase !== 'surprise' && !claw.ready[playerId]);
  button('claw-ready').textContent = claw.phase === 'won' ? 'Prize released' : claw.ready[playerId] ? 'Ready · tap to undo' : claw.phase === 'surprise' ? 'Ready to release' : 'Ready to drop';
  button('claw-ready').setAttribute('aria-pressed', String(claw.ready[playerId])); button('claw-swap').disabled = !steering;
  const messages = { idle: 'Take a control. Your date takes the other.', aiming: both ? 'Line up over the prize. You both steer, then both choose to drop.' : 'Waiting for your date to take the other control.', dropping: 'Here goes…', lifting: 'Easy does it. Let’s see what you caught.', surprise: hatchAligned ? 'Over the hatch! Both choose to release your enormous prize.' : 'That will never fit! Steer left and toward you, over the brass side hatch.', won: 'You actually got it. That one’s yours, together.' };
  el('claw-status').textContent = messages[claw.phase];
  if (claw.phase === 'surprise' && !announcedSurprise) { announcedSurprise = true; toast('Mira: “That prize is definitely bigger than the machine…”'); }
  const pool = state.pool, seated = pool.participants.includes(playerId), poolTurn = pool.turn === playerId;
  const turnName = state.players.find(p => p.id === pool.turn)?.name || 'Your date';
  el('pool-join').hidden = seated; button('pool-join').disabled = state.phase !== 'playing';
  el('pool-controls').hidden = !seated || pool.phase === 'won'; el('pool-rerack').hidden = !seated || pool.phase !== 'won';
  el('pool-progress').textContent = `${pool.pocketed} / ${pool.total}`;
  const scratch = pool.lastShot?.scratch ? 'The white ball has been put back. ' : '';
  el('pool-status').textContent = pool.phase === 'won' ? 'Table cleared. Six balls, one team.' : pool.phase === 'rolling' ? 'Let it roll…' : pool.phase === 'waiting' ? seated ? 'Your cue is ready. Your date needs to take the other.' : 'Take a cue. You’ll take turns clearing all six balls together.' : `${scratch}${poolTurn ? 'Your shot.' : `${turnName}’s shot.`} Take turns after every shot.`;
  for (const id of ['pool-aim','pool-power','pool-shoot','pool-pass']) (el(id) as HTMLInputElement | HTMLButtonElement).disabled = !canShootPool();
  if (paused || pool.phase !== 'aiming' || !poolTurn) poolDrag = null;
  el('pause-screen').hidden = !paused;
  if (paused) { el('pause-title').textContent = state.pauseReason === 'reconnect' ? 'Saving their seat.' : 'A little intermission.'; el('pause-description').textContent = (state.pauseReason === 'reconnect' ? 'Your date disconnected. The room and clock are paused while they return.' : 'The evening resumes when you’re both ready.') + (state.ending.phase === 'choice' ? ' Midnight choices have been cleared. You can choose again after resuming.' : ''); button('resume').disabled = !!me?.ready || state.pauseReason === 'reconnect'; el('resume').textContent = me?.ready ? 'Waiting for your date…' : 'I’m ready'; }
  button('kiss-yes').setAttribute('aria-pressed', String(state.ending.ownChoice === true)); button('kiss-no').setAttribute('aria-pressed', String(state.ending.ownChoice === false));
  el('choice-status').textContent = state.ending.ownChoice === null ? 'No answer means just celebrating. You can change your choice until the celebration begins.' : 'Choice saved. You can change it until the celebration begins.';
  const endedNight = ['kiss','celebration'].includes(state.ending.phase);
  el('celebration').hidden = !joined || celebrationDismissed || !endedNight || endingShotSeconds < ENDING_SHOT_SECONDS;
  el('celebration-text').textContent = state.ending.phase === 'kiss' ? 'A little luck brought you here. The rest was you two.' : 'You’ve got a story about tonight.';
}
function updateLaneHud() {
  const lane = state.lane, arcade = lane.mode === 'arcade', pilot = arcade && lane.pilot === playerId;
  const name = (id: PlayerId | null) => state.players.find(p => p.id === id)?.name || 'Your date';
  const both = lane.participants.length === 2;
  el('pins').textContent = `${lane.pinsDown} / 10`;
  el('lane-title').textContent = arcade ? lane.complete ? 'Quite the double act.' : 'Well, that’s new.' : 'Line up your shot.';
  el('lane-role').textContent = arcade ? `ROUND ${lane.round} OF 2 · YOU ${pilot ? 'CONTROL THE FLIPPERS' : 'ROLL'}` : 'A LITTLE FRIENDLY COMPETITION';
  el('lane-status').textContent = arcade
    ? lane.complete ? `You knocked down ${lane.score} of 20 pins together.`
      : !both ? 'Your date needs to join you at the lane.'
      : lane.roundSettled ? lane.round === 1 ? 'First round done. Swap roles for the next one.' : 'Both rounds are in.'
      : pilot ? `${name(lane.roller)} rolls. Hold A and D to open the flippers; release to bring them back.` : `${name(lane.pilot)} controls the flippers. Roll when you’re both ready.`
    : lane.unlocked ? 'You’ve both had a go. Try the flippers together.'
      : lane.warmups[playerId] ? 'Your date gets the next warm-up. Set fresh pins when the lane settles.' : 'Try a roll each. Things may get a little strange.';
  el('lane-score').hidden = !arcade; el('lane-score').textContent = `TOGETHER · ${lane.score} / 20`;
  el('lane-roller-controls').hidden = pilot || lane.complete;
  el('lane-flippers').hidden = !pilot || lane.complete;
  button('bowl').disabled = !canBowl();
  button('reset-lane').disabled = !lane.canReset || state.phase !== 'playing';
  button('reset-lane').textContent = arcade ? lane.complete ? 'Play again' : 'Swap roles' : 'Fresh pins';
  button('flipper-left').disabled = button('flipper-right').disabled = !laneInputEligible() || !both;
  button('lane-mode-classic').hidden = !arcade;
  button('lane-mode-arcade').hidden = arcade || !lane.unlocked;
  const laneAtRest = lane.bowler === null || lane.canReset || lane.roundSettled;
  button('lane-mode-classic').disabled = state.phase !== 'playing' || !laneAtRest;
  button('lane-mode-arcade').disabled = state.phase !== 'playing' || !laneAtRest || !both;
}
function endSession(message: string) {
  intentionalLeave = true; clearTimeout(reconnectTimer); stopMovement();
  voice?.disable();
  if (state.room) sessionStorage.removeItem(`lfs:${state.room}`); socket?.close(); joined = false; activity = null; poolShotPending = false; celebrationDismissed = false; announcedSurprise = false; endingShotSeconds = ENDING_SHOT_SECONDS; choiceDismissed = false;
  renderer?.setActivityFocus(null); el('chat-log').replaceChildren(); input('chat-input').value = '';
  audio.reset();
  for (const id of ['session-actions','controls','social','bowling','claw','pool','interact','station-note','pause-screen','chat','voice-panel','welcome','midnight-choice','celebration']) el(id).hidden = true;
  button('chat-toggle').setAttribute('aria-expanded', 'false'); button('voice-toggle').setAttribute('aria-expanded', 'false');
  el('arrival').hidden = false; document.body.classList.remove('in-game'); el('connection').textContent = message; button('join').disabled = false; input('room').value = ''; history.replaceState(null, '', location.pathname); state = initialState();
}
function connect(room: string, name: string, reconnect = false) {
  intentionalLeave = false; el('connection').textContent = reconnect ? 'Reconnecting to your date…' : 'Saving you a seat…'; button('join').disabled = true;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); socket = ws;
  ws.addEventListener('open', () => { const token = room ? sessionStorage.getItem(`lfs:${room}`) || undefined : undefined; ws.send(JSON.stringify({ type: 'join', room: room || undefined, token, name } satisfies ClientMessage)); });
  ws.addEventListener('message', event => {
    if (ws !== socket) return;
    let message: ServerMessage; try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type === 'welcome') {
      playerId = message.playerId; state.room = message.room; sessionStorage.setItem(`lfs:${message.room}`, message.token); history.replaceState(null, '', `?room=${message.room}`); joined = true; reconnectAttempt = 0; document.body.classList.add('in-game'); el('arrival').hidden = true;
      for (const id of ['session-actions','controls','social']) el(id).hidden = false;
      if (!reconnect) el('welcome').hidden = false; el('room-code').textContent = `ROOM ${message.room}`; el('connection').textContent = 'You’re here.'; input('name').blur();
    } else if (message.type === 'state') {
      if (message.pool.shots !== state.pool.shots || message.pool.phase !== 'aiming' || message.pool.turn !== playerId) poolShotPending = false;
      const beganEnding = message.ending.phase !== state.ending.phase && ['kiss','celebration'].includes(message.ending.phase);
      const interruptedInput = message.phase === 'paused' || message.phase === 'ended' || message.lane.pilot !== state.lane.pilot || message.lane.mode !== state.lane.mode;
      const arcadeBegan = state.lane.mode === 'classic' && message.lane.mode === 'arcade';
      const choiceOpened = message.ending.phase === 'choice' && state.ending.phase !== 'choice';
      if (choiceOpened || message.phase === 'paused') choiceDismissed = false;
      if (interruptedInput) stopMovement(false);
      state = message;
      if (beganEnding) endingShotSeconds = 0;
      if (choiceOpened) stopMovement();
      if (arcadeBegan && activity === 'bowling') toast('The lane has flippers now. One rolls. One keeps the ball moving.');
      voice?.update(state, playerId);
      if (beganEnding && activity) setActivity(null);
      audio.observe(state); updateHud();
    }
    else if (message.type === 'voice-signal') { void voice?.handleSignal(message); }
    else if (message.type === 'chat') { addChat(message.name, message.text); if (el('chat').hidden && message.playerId !== playerId) toast(`${message.name}: ${message.text}`); }
    else if (message.type === 'reaction') {
      renderer?.react(message);
      const name = state.players.find(p => p.id === message.playerId)?.name || 'Your date';
      toast(`${name} ${message.reaction === 'heart' ? 'sent a heart ♡' : message.reaction === 'nice' ? 'says “Nice!”' : 'is laughing with you'}`);
    }
    else if (message.type === 'error') { poolShotPending = false; toast(message.message); if (!joined) { intentionalLeave = true; button('join').disabled = false; el('connection').textContent = message.message; ws.close(); } }
    else if (message.type === 'ended') endSession(message.message);
  });
  ws.addEventListener('close', () => { if (ws !== socket || intentionalLeave) return; voice?.disconnect(); poolShotPending = false; stopMovement(); if (joined && reconnectAttempt < 12) { reconnectAttempt++; el('connection').textContent = 'Connection interrupted. Reconnecting…'; reconnectTimer = setTimeout(() => connect(state.room, input('name').value.trim(), true), Math.min(4000, 500 * reconnectAttempt)); } else endSession('Connection closed. Start a new evening when you’re ready.'); });
  ws.addEventListener('error', () => { el('connection').textContent = 'Unable to reach the game server.'; });
}

el('join-form').addEventListener('submit', e => { e.preventDefault(); const name = input('name').value.trim(), room = input('room').value.trim().toUpperCase(); if (name && name.length <= 24 && (!room || /^[A-Z0-9]{6}$/.test(room))) connect(room, name); });
el('invite').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.room}`); toast('Invitation copied. Open in a separate browser profile to join this local build.'); } catch { toast(`Your room code is ${state.room}.`); } });
el('dismiss-welcome').addEventListener('click', () => { el('welcome').hidden = true; });
el('sound-toggle').addEventListener('click', async () => {
  const control = button('sound-toggle'); control.disabled = true;
  try { const enabled = await audio.setEnabled(control.getAttribute('aria-pressed') !== 'true'); control.setAttribute('aria-pressed',String(enabled)); control.setAttribute('aria-label', enabled ? 'Disable game sounds' : 'Enable game sounds'); control.textContent = enabled ? 'Sound on' : 'Sound off'; }
  catch { toast('Sound could not start. You can keep playing with it off.'); }
  finally { control.disabled = false; }
});
el('pause').addEventListener('click', () => { stopMovement(); send({ type: 'pause' }); });
el('resume').addEventListener('click', () => send({ type: 'resume' }));
for (const id of ['leave','pause-leave']) el(id).addEventListener('click', () => { send({ type: 'leave' }); endSession('You’ve left the date.'); });
el('chat-toggle').addEventListener('click', () => toggleChat(Boolean(el('chat').hidden))); el('chat-close').addEventListener('click', () => toggleChat(false));
voice = new VoiceChat({ send, audio: el<HTMLAudioElement>('voice-output'), onStatus: status => { voiceStatus = status; renderVoiceStatus(); } });
voice.setVolume(Number(input('voice-volume').value));
el('voice-toggle').addEventListener('click', () => toggleVoice(Boolean(el('voice-panel').hidden)));
el('voice-close').addEventListener('click', () => toggleVoice(false));
el('voice-enable').addEventListener('click', () => { void voice?.enable(); });
el('voice-disable').addEventListener('click', () => voice?.disable());
el('voice-mute').addEventListener('click', () => voice?.toggleMute());
el('voice-play').addEventListener('click', () => { void voice?.playRemote(); });
input('voice-volume').addEventListener('input', () => voice?.setVolume(Number(input('voice-volume').value)));
el('chat-form').addEventListener('submit', e => { e.preventDefault(); const text = input('chat-input').value.trim(); if (text) { send({ type: 'chat', text }); input('chat-input').value = ''; } });
document.querySelectorAll<HTMLButtonElement>('.reaction').forEach(b => b.addEventListener('click', () => send({ type: 'reaction', reaction: b.dataset.reaction as 'heart'|'laugh'|'nice' })));
input('aim').addEventListener('input', () => { const value = Number(input('aim').value); el('aim-value').textContent = Math.abs(value) < .05 ? 'Straight' : `${value < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(value) * 100)}%`; });
function canBowl() { return activity === 'bowling' && gameplayInputEnabled() && !midnightPending() && state.phase === 'playing' && state.lane.canBowl && (state.lane.mode === 'classic' || state.lane.roller === playerId); }
function bowl() { if (canBowl()) send({ type: 'bowl', aim: Number(input('aim').value), power: Number(input('power').value), spin: Number(input('spin').value) }); }
el('bowl').addEventListener('click', bowl); el('reset-lane').addEventListener('click', () => send({ type: 'reset-lane' }));
el('lane-mode-classic').addEventListener('click', () => { stopMovement(); send({ type: 'lane-mode', mode: 'classic' }); });
el('lane-mode-arcade').addEventListener('click', () => { stopMovement(); send({ type: 'lane-mode', mode: 'arcade' }); });
for (const side of ['left', 'right'] as const) {
  const control = button(`flipper-${side}`);
  control.addEventListener('pointerdown', event => { if (control.disabled || !gameplayInputEnabled()) return; event.preventDefault(); heldFlippers[side] = true; control.setPointerCapture(event.pointerId); sendHeldInput(true); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) control.addEventListener(event, () => { heldFlippers[side] = false; sendHeldInput(true); });
}
el('bowling-exit').addEventListener('click', () => setActivity(null)); el('interact').addEventListener('click', interact); el('claw-exit').addEventListener('click', () => setActivity(null));
el('claw-join').addEventListener('click', () => send({ type: 'claw-join' })); el('claw-ready').addEventListener('click', () => send({ type: 'claw-ready', ready: !state.claw.ready[playerId] })); el('claw-swap').addEventListener('click', () => send({ type: 'claw-swap' }));
for (const [id,direction] of [['claw-left',-1],['claw-right',1]] as const) { const control = button(id); control.addEventListener('pointerdown', e => { if (control.disabled || activity !== 'claw' || !gameplayInputEnabled()) return; heldClaw = direction; control.setPointerCapture(e.pointerId); sendHeldInput(true); }); for (const event of ['pointerup','pointercancel','lostpointercapture']) control.addEventListener(event, () => { heldClaw = 0; sendHeldInput(true); }); }
function canShootPool() {
  return activity === 'pool' && gameplayInputEnabled() && state.phase === 'playing' && !midnightPending() && !poolShotPending && state.pool.phase === 'aiming' && state.pool.turn === playerId && state.pool.participants.includes(playerId);
}
function updatePoolAim() { renderer?.setPoolAim(Number(input('pool-aim').value) * Math.PI / 180, Number(input('pool-power').value)); }
function shootPool() {
  if (!canShootPool()) return;
  send({ type: 'pool-shoot', angle: Number(input('pool-aim').value) * Math.PI / 180, power: Number(input('pool-power').value) });
  poolShotPending = true; poolDrag = null; updateHud();
}
el('pool-exit').addEventListener('click', () => setActivity(null));
el('pool-join').addEventListener('click', () => send({ type: 'pool-join' }));
el('pool-pass').addEventListener('click', () => { if (canShootPool()) send({ type: 'pool-pass' }); });
el('pool-rerack').addEventListener('click', () => send({ type: 'pool-rerack' }));
el('pool-shoot').addEventListener('click', shootPool);
input('pool-aim').addEventListener('input', updatePoolAim); input('pool-power').addEventListener('input', updatePoolAim);
el('kiss-yes').addEventListener('click', () => send({ type: 'kiss-choice', choice: true })); el('kiss-no').addEventListener('click', () => send({ type: 'kiss-choice', choice: false }));
el('midnight-dismiss').addEventListener('click', () => { choiceDismissed = true; updateHud(); button('midnight-dismiss').blur(); });
el('clock').addEventListener('click', () => { if (button('clock').disabled) return; toggleChat(false); toggleVoice(false); choiceDismissed = false; stopMovement(); updateHud(); button('kiss-yes').focus(); });
el('stay').addEventListener('click', () => { celebrationDismissed = true; updateHud(); });
window.addEventListener('keydown', event => {
  const rangeControl = event.target instanceof HTMLInputElement && event.target.type === 'range';
  const typing = (event.target instanceof HTMLInputElement && !rangeControl) || event.target instanceof HTMLTextAreaElement;
  if (event.key === 'Escape') { stopMovement(); if (!el('voice-panel').hidden) toggleVoice(false); else if (!el('chat').hidden) toggleChat(false); else if (activity) setActivity(null); else if (joined) send({ type: 'pause' }); return; }
  if (typing || !gameplayInputEnabled()) return;
  if (rangeControl && event.code !== 'Space') return;
  if (event.key === 'Enter') { event.preventDefault(); toggleChat(true); return; }
  if (event.code === 'KeyV' && !activity) el('welcome').hidden = true;
  if (event.key.toLowerCase() === 'e' && !event.repeat) { interact(); return; }
  if (event.code === 'Space' && activity === 'bowling' && !event.repeat) { event.preventDefault(); bowl(); return; }
  if (event.code === 'Space' && activity === 'pool' && !event.repeat) { event.preventDefault(); shootPool(); return; }
  const movementKey = event.key.toLowerCase();
  if (['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright'].includes(movementKey)) { event.preventDefault(); if (!keys.has(movementKey)) { keys.add(movementKey); sendHeldInput(true); } }
});
window.addEventListener('keyup', event => { if (keys.delete(event.key.toLowerCase())) sendHeldInput(true); }); window.addEventListener('blur', () => stopMovement()); document.addEventListener('visibilitychange', () => { if (document.hidden) stopMovement(); });
try { renderer = new VenueRenderer(el('venue')); el('connection').textContent = 'The alley is open.'; } catch (error) { console.error(error); el('connection').textContent = 'The game could not open its drawing surface. Try reloading.'; button('join').disabled = true; }
if (renderer) {
  const canvas = renderer.canvas;
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !canShootPool()) return;
    const point = renderer!.getPoolPoint(event.clientX, event.clientY), cue = state.pool.balls.find(b => b.id === 0);
    if (!point || !cue) return;
    event.preventDefault(); canvas.focus();
    const dx = point.x - cue.position[0], dz = point.z - cue.position[2];
    if (Math.hypot(dx,dz) <= .3) {
      poolDrag = { pointerId: event.pointerId, cueX: cue.position[0], cueZ: cue.position[2], distance: 0 }; canvas.setPointerCapture(event.pointerId);
    } else { input('pool-aim').value = String(Math.atan2(dz,dx) * 180 / Math.PI); updatePoolAim(); }
  });
  canvas.addEventListener('pointermove', event => {
    if (!poolDrag || poolDrag.pointerId !== event.pointerId || !canShootPool()) return;
    const point = renderer!.getPoolPoint(event.clientX,event.clientY); if (!point) return;
    const dx = poolDrag.cueX - point.x, dz = poolDrag.cueZ - point.z;
    poolDrag.distance = Math.hypot(dx,dz);
    if (poolDrag.distance > .02) input('pool-aim').value = String(Math.atan2(dz,dx) * 180 / Math.PI);
    input('pool-power').value = String(Math.max(.1,Math.min(1,poolDrag.distance / 1.35))); updatePoolAim();
  });
  canvas.addEventListener('pointerup', event => {
    if (!poolDrag || poolDrag.pointerId !== event.pointerId) return;
    const releaseShot = poolDrag.distance > .08; poolDrag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (releaseShot) shootPool();
  });
  for (const event of ['pointercancel','lostpointercapture']) canvas.addEventListener(event, () => { poolDrag = null; });
  updatePoolAim();
}
function frame(now: number) {
  const dt = Math.max(0, Math.min(.15, (now-lastFrame)/1000)); lastFrame = now;
  const active = gameplayInputEnabled();
  renderer?.setInputEnabled(active && !activity);
  renderer?.update(state, playerId, dt);
  const drewScene = renderer?.render(dt, endingShotSeconds);
  // Keep the card behind the shot even when a background tab suspends rendering.
  if (endingShotSeconds < ENDING_SHOT_SECONDS && !document.hidden) {
    endingShotSeconds = drewScene ? Math.min(ENDING_SHOT_SECONDS, endingShotSeconds + dt) : ENDING_SHOT_SECONDS;
    if (endingShotSeconds === ENDING_SHOT_SECONDS) updateHud();
  }
  requestAnimationFrame(frame);
}
const inputTimer = setInterval(() => sendHeldInput(), 50);
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { clearInterval(inputTimer); stopMovement(); voice?.dispose(); renderer?.dispose(); audio.dispose(); });
Object.defineProperty(window, '__lfsState', { get: () => state });
Object.defineProperty(window, '__lfsView', { value: Object.freeze({ projectWorld: (position: [number, number, number]) => renderer?.projectWorld(position), stats: () => renderer?.stats() }) });
