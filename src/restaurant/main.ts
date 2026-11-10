import './style.css';
import { DATES, EVENT_COPY, getDate } from './content';
import type { AudioPlayback, ClaudeModel, DateId, DinnerCommand, DinnerState, ProviderStatus, SceneUtterance, TurnEvent, TurnVia } from './types';
import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL } from './types';
import { markup } from './ui';
import { RestaurantRenderer } from './RestaurantRenderer';
import { LocalRecognition } from './LocalRecognition';
import { RECEIPT_TIMEOUT_MS, TURN_WAIT_MS, settled, shouldDropBackchannel, timeoutSignal } from './turn-endpointing';
import { SpeechPlayer } from './SpeechPlayer';
import { createEvening } from './evening';
import { EveningInterface } from './EveningInterface';
import { EveningAudio } from './EveningAudio';
import { GameMenuNavigation, type GameMenuScope } from './GameMenuNavigation';
import { DoubleDateClient } from './DoubleDateClient';
import { DoubleDateLobby } from './DoubleDateLobby';
import { localDoubleDateView, type ConversationTarget, type DoubleDateRoomState, type DoubleDialogueLine } from './double-date-types';
import { SharedMicrophone } from './SharedMicrophone';
import { VoiceChat } from '../voice/VoiceChat';
import { MobileControls } from './MobileControls';
import { conversationModelName, parseModelChatCommand, savedConversationModel, type ModelChatCommand } from './ModelChatCommand';
import { ListeningPreviewController, type ListeningPreviewTarget } from './ListeningPreview';
import { scenePresenceAvailable } from './scenario-care';
import { diningOffsetZ } from './dining-space';
import { InterestCue } from './InterestCue';
import { createPerfStats } from './PerfStats';
import { createFrameCap } from './FrameCap';
import { consumeTurnResponse, replyDeadlineMs } from './conversation-stream';
import { captionReadingMs, waitForCaptionPaint, waitForCaptionReading } from './caption-delivery';
import { PageActivity } from './PageActivity';
import { dateArrival } from './DateArrival';

document.title = 'Table for Two';
document.querySelector<HTMLDivElement>('#app')!.innerHTML = markup;
const interestCue = new InterestCue(document.querySelector<HTMLElement>('#dinner-hud')!);
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const btn = (id: string) => el<HTMLButtonElement>(id);
const input = (id: string) => el<HTMLInputElement>(id);
const blankUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null });
const preview = (dateId: DateId): DinnerState => ({ evening: createEvening(dateId), id: '', generation: 0, mode: 'ai-date', phase: 'playing', dateId, stage: 'arrival', elapsed: 0, participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, 5.6] }, { id: 'p2', kind: 'ai', name: getDate(dateId)!.name, position: [0, 0, -2.25] }], events: [], emotion: 'warm', seated: false, order: null, glassRaised: false, memory: '', usage: blankUsage(), sessionLimit: 2 });
type Preferences = { model: ClaudeModel; modelSource?: 'chat-command'; sessionLimit: number; speech: boolean; captions: boolean; volume: number; ambience: boolean; interestCue?: boolean };
const preferences: Preferences = { model: 'claude-haiku-5-5', sessionLimit: 2, speech: true, captions: true, volume: .8, ambience: true };
try {
  const saved = JSON.parse(localStorage.getItem('table-for-two-settings') || '{}') as Partial<Preferences>;
  preferences.model = savedConversationModel(saved);
  if (saved.modelSource === 'chat-command' && saved.model === preferences.model) preferences.modelSource = 'chat-command';
  if (typeof saved.sessionLimit === 'number' && saved.sessionLimit >= .05 && saved.sessionLimit <= 20) preferences.sessionLimit = saved.sessionLimit;
  if (typeof saved.speech === 'boolean') preferences.speech = saved.speech;
  if (typeof saved.captions === 'boolean') preferences.captions = saved.captions;
  if (typeof saved.ambience === 'boolean') preferences.ambience = saved.ambience;
  if (typeof saved.volume === 'number') preferences.volume = Math.max(0, Math.min(1, saved.volume));
} catch { /* Settings are optional in private browsing. */ }
let selectedDate: DateId = 'mira', state = preview(selectedDate), token = '', joined = false;
const sharedMicrophone = new SharedMicrophone();
let doubleRoom: DoubleDateRoomState | undefined;
const loggedDoubleLines = new Set<string>();
let doubleLobby: DoubleDateLobby;
let friendVoice: VoiceChat;
let endingPresented = false;
const ambience = new EveningAudio();
ambience.setEnabled(preferences.ambience);
let eveningUI: EveningInterface;
let presentedCues = new Set<string>();
let revealedIncident = '';
let renderer: RestaurantRenderer;
let softwareNoticeShown = false;
let providers: ProviderStatus | undefined;
let playback: AudioPlayback = { speaker: null, amplitude: 0, emotion: 'neutral', caption: '' };
let busy = false, activeGeneration = 0, generationEpoch = 0, turnAbort: AbortController | undefined;
let captionReadAbort: AbortController | undefined;
let speechQueue: Promise<void> = Promise.resolve(), pendingSpeeches = 0;
let interruption: Promise<void> = Promise.resolve();
let interruptPending = false;
let playbackReceipts: Promise<void> = Promise.resolve();
let captionTimer: ReturnType<typeof setTimeout> | undefined, toastTimer: ReturnType<typeof setTimeout> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined, commandEpoch = 0;
let micEnabled = false, disposed = false, settingsPaused = false;
let microphoneAttempt = 0;
let pausePending = false;
let settingsOpening: Promise<void> = Promise.resolve(), settingsClosing = false;
let startingDinner = false, typedSubmissionPending = false, pageSuspended = false;
let pageRequests = new AbortController(), pageEpoch = 0, frameHandle = 0;
let backgroundPause: Promise<unknown> | undefined;
let typedSubmissionEpoch = 0, modelResetEpoch = 0, modelResetPending = false;
let modelControlQueue: Promise<void> = Promise.resolve();
const doubleTurnSubmissions = new Set<Promise<void>>();
let audioWarningShown = false, userEnteredMenu = false, restoreAttempted = false;
let connectionTimer: ReturnType<typeof setTimeout> | undefined;
let mobile: MobileControls | undefined;
let turnStartedAt = 0, firstAudioMs: number | null = null, presentedEvents = new Set<string>();
let lastFrame = performance.now();
let lastPartial = '', dragging = false, pointerX = 0, pointerY = 0;
let pointerTravel = 0;
let currentSpeechGeneration = 0;
let tableAttention: { actor: 'h1' | 'h2'; until: number } | undefined;
let hadPointerLock = false, intentionalPointerRelease = false;
const keys = new Set<string>();
const listeningPreview = new ListeningPreviewController();
let listeningTarget: ListeningPreviewTarget = null;
const money = (value: number) => '$' + value.toFixed(3);
const otherModalOpen = () => ['settings-dialog', 'pause-dialog', 'ending-screen', 'history-dialog'].some(id => !el(id).hidden);
const visibleModal = otherModalOpen;
const menuInputOpen = () => visibleModal() || !el('journal').hidden;
function currentListeningTarget(): ListeningPreviewTarget {
  if (!renderer?.isReady || !joined) return null;
  if (!state.doubleDate) return scenePresenceAvailable(state) ? 'date' : null;
  const target = renderer.getConversationTarget(state);
  return target === 'd1' || target === 'd2' ? target : null;
}
function clearListeningPreview() {
  listeningPreview.clear(); listeningTarget = null; renderer?.setListeningPreview(null);
}
function beginListeningPreview() {
  listeningTarget = currentListeningTarget();
  listeningPreview.start(performance.now(), listeningTarget);
}
function gameMenuScope(): GameMenuScope | null {
  if (mobile?.menuScope) return { key: 'mobile-display', element: mobile.menuScope, initial: '#mobile-display-close' };
  // Settings can sit above Pause; the uppermost surface always owns input.
  for (const id of ['settings-dialog', 'ending-screen', 'history-dialog', 'pause-dialog']) {
    if (!el(id).hidden) return { key: id, element: el(id), initial: id === 'pause-dialog' ? '#resume-date' : undefined };
  }
  if (doubleLobby && !doubleLobby.element.hidden) return { key: 'double-date', element: doubleLobby.element };
  if (!joined) {
    if (el('arrival-screen').dataset.screen === 'mode') return { key: 'mode', element: el('mode-menu'), initial: '#mode-solo' };
    const selecting = el('arrival-screen').dataset.screen === 'select';
    return selecting ? {
      key: 'select', element: el('restaurant-app'), items: '[data-date]', initial: '[data-date].selected', horizontal: true,
      select(item) { item.click(); },
      confirm(item) { if (!item.matches('[data-date]')) return false; btn('start-date').click(); return true; },
    } : { key: 'title', element: el('restaurant-app'), items: '[data-game-item]', initial: '#title-start' };
  }
  if (!el('journal').hidden) return { key: 'journal', element: el('journal'), horizontal: true };
  return null;
}
const menuNavigation = new GameMenuNavigation(el('restaurant-app'), gameMenuScope, () => releasePointer());
const savePreferences = () => { try { localStorage.setItem('table-for-two-settings', JSON.stringify(preferences)); } catch { /* Session settings still apply. */ } };
function toast(message: string, duration = 6000) {
  clearTimeout(toastTimer); el('toast').textContent = message; el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, duration);
}
function log(name: string, text: string, system = false) {
  const line = document.createElement('p');
  if (system) { line.className = 'log-system'; line.textContent = text; }
  else { const label = document.createElement('strong'); label.textContent = name + ': '; line.append(label, document.createTextNode(text)); }
  const panel = el('conversation-log'); panel.append(line);
  while (panel.children.length > 100) panel.firstElementChild?.remove();
  panel.scrollTop = panel.scrollHeight;
}
function speakerName(speaker: SceneUtterance['speaker'], actorId?: SceneUtterance['actorId']) {
  const actor = doubleRoom?.dates.find(date => date.id === actorId);
  if (actor) return getDate(actor.dateId)!.name;
  return speaker === 'date' ? getDate(state.dateId)!.name : speaker === 'other-date' ? 'Your friend’s date' : speaker === 'waiter' ? 'Eli · your waiter' : 'The neighboring diner';
}
function caption(utterance: SceneUtterance) {
  clearTimeout(captionTimer);
  el('caption-speaker').textContent = speakerName(utterance.speaker, utterance.actorId);
  el('caption-text').textContent = utterance.text;
  el('caption').hidden = !preferences.captions;
}
function clearCaptionLater(delay = 2500) { clearTimeout(captionTimer); captionTimer = setTimeout(() => { if (!playback.speaker) el('caption').hidden = true; }, delay); }
function renderUsage() {
  const u = state.usage;
  el('usage-requests').textContent = String(u.claudeRequests);
  el('usage-tokens').textContent = `${u.inputTokens.toLocaleString()} / ${u.outputTokens.toLocaleString()}`;
  el('usage-cache-tokens').textContent = u.cacheReadTokens.toLocaleString();
  el('usage-characters').textContent = u.speechCharacters.toLocaleString();
  el('usage-hits').textContent = String(u.cacheHits);
  el('usage-components').textContent = `${money(u.claudeCost)} / ${money(u.speechCost)}`;
  el('usage-total').textContent = money(u.totalCost);
  const audioMs = doubleRoom ? u.firstAudioMs : firstAudioMs ?? u.firstAudioMs;
  el('usage-latency').textContent = `${audioMs === null ? '—' : Math.round(audioMs) + ' ms'} / ${u.responseMs === null ? '—' : Math.round(u.responseMs) + ' ms'}`;
}
function renderProviders() {
  if (!providers) return;
  const voiceStatus = providers.speechProvider === 'edge' ? 'Free Edge neural voices' : providers.speechProvider === 'elevenlabs' ? (providers.speech ? 'ElevenLabs configured' : 'ElevenLabs key is missing') : providers.cachedSpeech ? 'Reusable voice clips' : 'Captions only';
  el('provider-status').textContent = `Anthropic: ${(providers.anthropic ?? providers.claude) ? 'key configured' : 'key missing'}. Dolphin: ${providers.models.includes(DOLPHIN_LLM_MODEL) ? 'available via /model dolphin' : 'direct provider unavailable'}.${providers.models.includes(DOLPHIN_MODEL) ? ' Dolphin Venice via OpenRouter is also configured.' : ''} Voice: ${voiceStatus}. Recognition runs locally.`;
  el('developer-settings').hidden = !providers.development;
  input('session-limit').max = String(Math.min(20, providers.sessionLimit));
  if (!providers.models.includes(preferences.model)) { preferences.model = providers.defaultModel; delete preferences.modelSource; }
}
function applyState(next: DinnerState) {
  if (joined && state.id && next.id !== state.id) return;
  if (next.id === state.id && next.revision !== undefined && state.revision !== undefined && next.revision < state.revision) return;
  const presenceChanged = next.evening.scenarioCare?.presence !== state.evening.scenarioCare?.presence && [next.evening.scenarioCare?.presence, state.evening.scenarioCare?.presence].some(presence => presence === 'privacy-break' || presence === 'cleanup-break');
  if (joined && next.id === state.id && (diningOffsetZ(next) !== diningOffsetZ(state) || presenceChanged)) {
    const stage = el('restaurant-scene');
    stage.animate([{ opacity: .12 }, { opacity: 1 }], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200, easing: 'ease-out' });
    releasePointer();
  }
  state = next;
  if ('generation' in next && typeof next.generation === 'number') activeGeneration = next.generation;
  (window as Window & { __restaurantState?: DinnerState }).__restaurantState = state;
  if (!joined) return;
  const wingman = state.doubleDate?.role === 'wingman';
  el('date-status').textContent = wingman ? 'Staying for your friend' : `An evening with ${getDate(state.dateId)!.name}`;
  interestCue.update(state, preferences.interestCue !== false);
  btn('finish-date').textContent = wingman ? 'Show my ending' : state.mode === 'double-date' ? 'End my date' : 'End date';
  const stages = { arrival: 'At the table', seated: 'At the table', ordered: 'At the table', dining: 'At the table', dessert: 'At the table', farewell: 'At the table', finished: 'Goodnight' };
  el('dinner-stage').textContent = wingman ? 'At the table' : stages[state.stage];
  const minutes = Math.floor(state.elapsed / 60);
  el('evening-label').textContent = `${String(19 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} · TABLE 02`;
  for (const event of state.events) if (!presentedEvents.has(event)) {
    presentedEvents.add(event);
    log('The evening', EVENT_COPY[event].description, true);
  }
  // Only generated, player-addressed dialogue takes the floor. Legacy evening cues
  // are intentionally ignored when restoring an older dinner.
  saveSessionReference();
  eveningUI.update(state); ambience.setPaused(state.phase !== 'playing');
  const incident = state.evening.incident;
  if (incident && revealedIncident !== `${incident.event}:${incident.startedAt}`) {
      revealedIncident = `${incident.event}:${incident.startedAt}`;
  }
  recognition.setPaused(state.phase !== 'playing' || visibleModal() || !doubleClient.active && !scenePresenceAvailable(state));
  if (state.phase === 'playing' && !pausePending) el('pause-dialog').hidden = true;
  if (state.phase === 'paused' && el('settings-dialog').hidden && !eveningUI.isDialogOpen) el('pause-dialog').hidden = false;
  if (state.phase === 'ended') showEnding();
  renderUsage();
  updateTypedSubmit();
}
async function request<T>(path: string, body?: unknown, options: { signal?: AbortSignal; method?: string } = {}): Promise<T> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  const pageSignal = pageRequests.signal;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true }); pageSignal.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted || pageSignal.aborted) controller.abort();
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(path, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
    const data = await response.json().catch(() => ({})) as { error?: string | { message?: string }; message?: string };
    controller.signal.throwIfAborted();
    if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Request failed (${response.status})`), { status: response.status });
    return data as T;
  } catch (error) {
    if (controller.signal.aborted && pageSignal.aborted) throw new DOMException('Page suspended.', 'AbortError');
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error('The restaurant took too long to respond. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); pageSignal.removeEventListener('abort', cancel); }
}
const sessionPath = () => '/api/date/sessions/' + encodeURIComponent(state.id);
async function command(body: DinnerCommand, quiet = false) {
  if (!joined) return false;
  const sessionId = state.id, sessionToken = token;
  commandEpoch++;
  try {
    if (doubleClient.active) { await doubleClient.command({ type: 'scene', command: body }); return true; }
    const result = await request<{ state: DinnerState }>(sessionPath() + '/command', body);
    if (!joined || doubleClient.active || state.id !== sessionId || token !== sessionToken) return false;
    applyState(result.state);
    return true;
  }
  catch (error) { if (!quiet) toast((error as Error).message); return false; }
}
async function unlockAudio(withAmbience = false) {
  const results = await Promise.allSettled([speech.unlock(), ...(withAmbience ? [ambience.start()] : [])]);
  if (results.some(result => result.status === 'rejected') && !audioWarningShown) {
    audioWarningShown = true;
    toast('Sound could not start. You can keep playing with captions and typed dialogue.', 8000);
  }
}
async function poll() {
  if (!joined || disposed || pageSuspended || document.hidden || doubleClient.active) return;
  const epoch = commandEpoch;
  try { const result = await request<{ state: DinnerState }>(sessionPath()); if (epoch === commandEpoch) applyState(result.state); }
  catch (error) {
    if (pageSuspended || document.hidden || disposed) return;
    const status = (error as Error & { status?: number }).status;
    if (epoch === commandEpoch && (status === 401 || status === 404)) {
      try { sessionStorage.removeItem('table-for-two-session'); } catch { /* Optional storage. */ }
      returnToModes('This evening is no longer available. Start a new date.'); return;
    }
    el('turn-status').textContent = 'Connection interrupted · retrying';
  }
  if (joined && !disposed && !pageSuspended && !document.hidden && state.phase !== 'ended') pollTimer = setTimeout(() => void poll(), 300);
}
function recordDelivery(generation: number, utterance: SceneUtterance, completed: boolean, playedSeconds: number) {
  if (pageSuspended || document.hidden || disposed) return;
  const receiptEpoch = pageEpoch, pageSignal = pageRequests.signal;
  if (doubleClient.active && utterance.lineId) {
    playbackReceipts = playbackReceipts.then(() => receiptEpoch === pageEpoch && !pageSignal.aborted ? doubleClient.receipt(utterance.lineId!, generation, completed, playedSeconds) : undefined).then(() => {}).catch(() => {}); return;
  }
  const path = sessionPath() + '/playback', sessionToken = token;
  playbackReceipts = playbackReceipts.then(async () => {
    // A stalled receipt must not hold every later receipt, or the next spoken turn, behind it.
    if (receiptEpoch !== pageEpoch || pageSignal.aborted) return;
    await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ generation, speaker: utterance.speaker, text: utterance.text, completed, playedSeconds }), signal: AbortSignal.any([pageSignal, timeoutSignal(RECEIPT_TIMEOUT_MS)]) });
  }).catch(() => {});
}
let displayedVoiceStatus = '';
let displayedArrivalStatus = '';
const clearVoiceStatus = () => {
  const status = el('turn-status');
  if (displayedVoiceStatus && status.textContent === displayedVoiceStatus) status.textContent = '';
  displayedVoiceStatus = '';
};
const speech = new SpeechPlayer({
  onPlayback(next) {
    playback = next; recognition.setSpeaking(!!next.speaker, next.caption); ambience.setSpeaking(!!next.speaker);
    if (next.speaker) {
      clearVoiceStatus();
      caption({ speaker: next.speaker, text: next.caption, emotion: next.emotion, actorId: next.actorId });
      if (turnStartedAt && firstAudioMs === null) { firstAudioMs = performance.now() - turnStartedAt; renderUsage(); }
    } else clearCaptionLater();
  },
  onStatus(message) {
    if (message) { displayedVoiceStatus = message; el('turn-status').textContent = message; }
    else clearVoiceStatus();
  },
  onEnded(utterance, result) {
    if (joined) recordDelivery(currentSpeechGeneration, utterance, !result.interrupted, result.playedSeconds);
  },
}, { canFallback: () => providers?.speechProvider === 'edge', dateId: () => state.dateId });
const recognition = new LocalRecognition({
  onPartial(text) {
    lastPartial = text;
    if (micEnabled && !busy) el('turn-status').textContent = text ? `You: ${text}` : '';
    if (!text || !micEnabled || !joined || busy || state.phase !== 'playing' || visibleModal() || document.hidden) { clearListeningPreview(); return; }
    const now = performance.now(), target = currentListeningTarget();
    if (target !== listeningTarget || !listeningPreview.sample(now)) { listeningTarget = target; listeningPreview.start(now, target); }
    listeningPreview.partial(text, now);
  },
  onTurn(text) {
    clearListeningPreview();
    if (!micEnabled || state.phase !== 'playing' || visibleModal()) return;
    lastPartial = '';
    // A bare "mm-hm" or "yeah" while the date is still talking is listening, not taking the floor.
    if (shouldDropBackchannel(text, { speaking: !!playback.speaker, caption: playback.caption })) return;
    void sendTurn(text, undefined, 'voice');
  },
  isListeningOnly(text) { return shouldDropBackchannel(text, { speaking: !!playback.speaker, caption: playback.caption }); },
  onSpeechStart() {
    if (micEnabled && doubleClient.active) tableAttention = { actor: doubleClient.credentials!.memberId, until: performance.now() + 4000 };
    if (micEnabled && (busy || playback.speaker || pendingSpeeches)) void interrupt();
    if (micEnabled && joined && state.phase === 'playing' && !visibleModal()) beginListeningPreview();
  },
  onStatus(status) { el('speech-status').textContent = micEnabled ? status : ''; if (/paused|loading|stopped/i.test(status)) clearListeningPreview(); },
  onError(message) { microphoneAttempt++; micEnabled = false; friendVoice?.disable(); updateMic(); toast(message, 10000); },
}, { capture: () => sharedMicrophone.acquire(), release: stream => sharedMicrophone.release(stream) });
speech.setVolume(preferences.volume);
eveningUI = new EveningInterface({ releasePointer, modalChanged() { recognition.setPaused(state.phase !== 'playing' || visibleModal()); }, notice: toast });

function saveSessionReference() {
  if (!joined || !state.id || !token || doubleClient.active) return;
  try { sessionStorage.setItem('table-for-two-session', JSON.stringify({ id: state.id, token, seenCues: [...presentedCues].slice(-120) })); } catch { /* Optional browser storage. */ }
}
function updateMic() {
  btn('mic-toggle').setAttribute('aria-pressed', String(micEnabled));
  el('mic-label').textContent = micEnabled ? 'Mic on' : 'Mic off';
  if (!micEnabled) {
    clearListeningPreview();
    el('speech-status').textContent = '';
    if (el('turn-status').textContent?.startsWith('You: ')) el('turn-status').textContent = '';
  }
}
function cancelLocalPlayback() {
  generationEpoch++;
  captionReadAbort?.abort(); captionReadAbort = undefined;
  turnAbort?.abort(); turnAbort = undefined;
  speech.stop(); busy = false; pendingSpeeches = 0; speechQueue = Promise.resolve();
  playback = { speaker: null, amplitude: 0, emotion: 'neutral', caption: '' };
  el('caption').hidden = true; updateTypedSubmit();
}
function updateTypedSubmit() {
  const modelCommand = parseModelChatCommand(input('conversation-input').value), reset = modelCommand?.type === 'reset';
  const target = state.mode === 'double-date' ? (el<HTMLSelectElement>('conversation-target').value || 'table') as ConversationTarget : 'table';
  const arrival = dateArrival(state, doubleRoom, target), micArrival = dateArrival(state, doubleRoom, 'table');
  btn('send-turn').disabled = modelResetPending || ((busy || typedSubmissionPending) && !reset) || (!modelCommand && !arrival.ready);
  if (joined && micEnabled && !micArrival.ready && !pageSuspended) { microphoneAttempt++; recognition.stop(); friendVoice.disable(); micEnabled = false; updateMic(); }
  btn('mic-toggle').disabled = joined && !micEnabled && !micArrival.ready;
  const status = el('turn-status');
  const waiting = joined && state.phase === 'playing' && !arrival.ready ? `${arrival.waiting.join(' and ')} ${arrival.waiting.length > 1 ? 'are' : 'is'} joining you` : '';
  if (displayedArrivalStatus && status.textContent === displayedArrivalStatus && !waiting) status.textContent = '';
  if (waiting && (!status.textContent || status.textContent === displayedArrivalStatus)) status.textContent = waiting;
  displayedArrivalStatus = waiting;
}
async function interrupt() {
  cancelLocalPlayback();
  if (!joined) return;
  if (interruptPending) { await interruption; return; }
  interruptPending = true;
  interruption = (doubleClient.active ? doubleClient.interrupt() : request<{ state: DinnerState }>(sessionPath() + '/interrupt', {}).then(result => { applyState(result.state); })).catch(() => { /* Next request reports connection failures. */ }).finally(() => { interruptPending = false; });
  await interruption;
}
let captionDeliverySequence = 0;
async function presentCaption(utterance: SceneUtterance, generation: number, epoch: number) {
  if (epoch !== generationEpoch || !joined || state.phase !== 'playing' || !preferences.captions || document.hidden) return;
  const controller = new AbortController(); captionReadAbort?.abort(); captionReadAbort = controller;
  const deliveryId = `caption:${++captionDeliverySequence}`;
  caption(utterance);
  playback = { speaker: utterance.speaker, amplitude: 0, emotion: utterance.emotion, caption: utterance.text, actorId: utterance.actorId, deliveryId };
  const readable = () => !document.hidden && !el('caption').hidden && preferences.captions;
  const painted = await waitForCaptionPaint(controller.signal, document, readable, { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) });
  const completed = painted && await waitForCaptionReading(captionReadingMs(utterance.text), controller.signal, document, readable);
  if (captionReadAbort === controller) captionReadAbort = undefined;
  // A readable caption is real delivery. Enqueueing it, or interrupting it early, is not.
  if (epoch === generationEpoch && joined && state.phase === 'playing' && playback.deliveryId === deliveryId) {
    playback = { speaker: null, amplitude: 0, emotion: 'neutral', caption: '', deliveryId: null };
    clearCaptionLater(1000); recordDelivery(generation, utterance, completed, 0);
  }
}
function queueUtterance(utterance: SceneUtterance, generation: number, epoch: number, logLine = true) {
  if (!['date', 'other-date'].includes(utterance.speaker)) return;
  if (logLine) log(speakerName(utterance.speaker, utterance.actorId), utterance.text);
  pendingSpeeches++;
  speechQueue = speechQueue.then(async () => {
    if (epoch !== generationEpoch || !joined || state.phase !== 'playing' || document.hidden || pageSuspended) return;
    if (doubleClient.active && utterance.lineId) {
      const current = doubleRoom?.lines.find(line => line.id === utterance.lineId);
      if (!current || current.interrupted) return;
    }
    if (!preferences.speech || (!providers?.speech && !providers?.cachedSpeech)) {
      await presentCaption(utterance, generation, epoch);
      return;
    }
    currentSpeechGeneration = generation;
    await speech.play(utterance, signal => doubleClient.active && utterance.lineId ? doubleClient.speech(utterance.lineId, generation, signal) : fetch(sessionPath() + '/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ generation, utterance }), signal }));
  }).catch(async error => {
    if (epoch !== generationEpoch || (error as Error).name === 'AbortError') return;
    toast((error as Error).message);
    const status = (error as { status?: number }).status;
    if (status === 409 || status === 499) return;
    await presentCaption(utterance, generation, epoch);
  }).finally(() => { if (epoch === generationEpoch) pendingSpeeches = Math.max(0, pendingSpeeches - 1); });
}
async function sendTurn(raw: string, explicitTarget?: ConversationTarget, via: TurnVia = 'typed') {
  const text = raw.trim();
  const resetEpoch = modelResetEpoch;
  if (!text || !joined || pageSuspended || document.hidden || state.phase !== 'playing' || visibleModal() || modelResetPending) return false;
  let target: ConversationTarget = state.mode === 'double-date' ? explicitTarget ?? renderer.getConversationTarget(state) : 'table';
  const aimed = doubleRoom?.dates.find(date => date.id === target);
  if (aimed && (aimed.stance === 'leaving' || doubleRoom?.views[aimed.humanId].phase === 'ended')) target = 'table';
  if (!dateArrival(state, doubleRoom, target).ready) { updateTypedSubmit(); return false; }
  if (!doubleClient.active && !scenePresenceAvailable(state)) { toast('Give your date a moment. They’ll be back at the table shortly.'); return false; }
  if (text.length > 2000) { toast('Keep each turn under 2,000 characters.'); return false; }
  // Each wait is bounded so a slow unlock, interrupt or receipt cannot leave the mic feeling dead.
  // The server invalidates the previous generation when the turn arrives, so carrying on is safe.
  let stalled = false;
  const bounded = async (pending: Promise<unknown>) => { if (!(await settled(pending, TURN_WAIT_MS))) stalled = true; };
  await bounded(unlockAudio());
  await bounded(interruption);
  if (!joined || pageSuspended || document.hidden || state.phase !== 'playing' || visibleModal() || modelResetPending || resetEpoch !== modelResetEpoch || !dateArrival(state, doubleRoom, target).ready) return false;
  if (busy || pendingSpeeches || playback.speaker) await bounded(interrupt());
  const submissionEpoch = generationEpoch;
  await bounded(playbackReceipts);
  if (!joined || pageSuspended || document.hidden || state.phase !== 'playing' || visibleModal() || submissionEpoch !== generationEpoch || (interruptPending && !stalled) || modelResetPending || resetEpoch !== modelResetEpoch || !dateArrival(state, doubleRoom, target).ready) return false;
  if (doubleClient.active) {
    turnStartedAt = performance.now(); firstAudioMs = null;
    const submitted = doubleClient.turn(text, target, via);
    doubleTurnSubmissions.add(submitted);
    try { await submitted; return true; }
    catch (error) { toast((error as Error).message, 10000); return false; }
    finally { doubleTurnSubmissions.delete(submitted); }
  }
  const epoch = ++generationEpoch;
  const controller = new AbortController(); turnAbort = controller;
  busy = true; updateTypedSubmit();
  log('You', text); el('turn-status').textContent = `${getDate(state.dateId)!.name} is listening…`;
  turnStartedAt = performance.now(); firstAudioMs = null;
  let accepted = false, serverFailed = false, deadlineExpired = false, streamComplete = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const armDeadline = (model?: ClaudeModel) => {
    clearTimeout(deadline);
    deadline = setTimeout(() => { deadlineExpired = true; controller.abort(); }, Math.max(1, replyDeadlineMs(providers, model) - (performance.now() - turnStartedAt)));
  };
  armDeadline();
  const waitingNotice = setTimeout(() => { if (epoch === generationEpoch && busy) el('turn-status').textContent = 'Still waiting for a reply… You can pause to cancel.'; }, 10000);
  try {
    const response = await fetch(sessionPath() + '/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ turnId: crypto.randomUUID(), text, model: preferences.model, via }), signal: controller.signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(error.error || error.message || `Conversation unavailable (${response.status})`);
    }
    accepted = true;
    await consumeTurnResponse(response, controller.signal, event => {
      if (epoch !== generationEpoch) return;
      if (event.type === 'start') {
        activeGeneration = event.generation; armDeadline(event.model);
        el('turn-status').textContent = event.model === 'ai-horde' ? 'Waiting for a community reply…' : `${getDate(state.dateId)!.name} is thinking…`;
      }
      else if (event.type === 'utterance') { clearTimeout(waitingNotice); activeGeneration = event.generation; queueUtterance(event.utterance, event.generation, epoch); }
      else if (event.type === 'state') applyState(event.state);
      // Keep consuming the terminal snapshot and done after a provider failure.
      // The stream helper reports its recorded error once those events are applied.
      else if (event.type === 'error') serverFailed = true;
    });
    streamComplete = true;
    if (epoch === generationEpoch) el('turn-status').textContent = '';
    return true;
  } catch (error) {
    if (deadlineExpired && epoch === generationEpoch) {
      void interrupt();
      const message = 'The reply took too long. You can keep playing and try another turn.';
      toast(message, 10000); el('turn-status').textContent = 'Reply timed out · you can try again'; log('Connection', message, true);
      return !serverFailed && accepted;
    }
    if ((error as Error).name !== 'AbortError' && epoch === generationEpoch) {
      // A failed or incomplete reply no longer owns delivery. Stop both queued
      // captions and audio, including device fallback, without resetting dinner.
      cancelLocalPlayback();
      toast((error as Error).message, 10000); el('turn-status').textContent = 'Conversation paused · you can try again'; log('Connection', (error as Error).message, true);
      return false;
    }
    return !serverFailed && ((error as Error).name === 'AbortError' || epoch !== generationEpoch) ? accepted : false;
  } finally {
    clearTimeout(deadline); clearTimeout(waitingNotice);
    if (!streamComplete) controller.abort();
    if (epoch === generationEpoch) { busy = false; turnAbort = undefined; updateTypedSubmit(); }
  }
}
async function startDinner(blind = false) {
  if (startingDinner || joined || pageSuspended || document.hidden) return;
  const startEpoch = pageEpoch;
  userEnteredMenu = true;
  startingDinner = true;
  const navigation = [...el('arrival-screen').querySelectorAll<HTMLButtonElement>('button')];
  const previousDisabled = navigation.map(button => button.disabled);
  navigation.forEach(button => { button.disabled = true; });
  el('arrival-screen').setAttribute('aria-busy', 'true'); el('start-error').hidden = true;
  try {
    await unlockAudio(true);
    if (disposed || pageSuspended || document.hidden || startEpoch !== pageEpoch) return;
    const result = await request<{ state: DinnerState; token: string }>('/api/date/sessions', { ...(blind ? { mode: 'blind-date' } : { dateId: selectedDate }), model: preferences.model, sessionLimit: preferences.sessionLimit });
    token = result.token; state = result.state; joinUI();
    presentedCues = new Set(); saveSessionReference();
    applyState(state); void poll();
    if (!providers?.claude) el('turn-status').textContent = 'Conversation offline';
  } catch (error) { el('start-error').textContent = (error as Error).message; el('start-error').hidden = false; if (blind) toast((error as Error).message); }
  finally { startingDinner = false; navigation.forEach((button, index) => { button.disabled = previousDisabled[index]; }); el('arrival-screen').removeAttribute('aria-busy'); }
}
function joinUI() {
  clearListeningPreview();
  doubleLobby?.hide();
  joined = true; presentedEvents = new Set(); el('arrival-screen').hidden = true; el('dinner-hud').hidden = false;
  el('restaurant-app').classList.add('playing'); el('journal').hidden = true;
  if (selectedDate !== state.dateId) { selectedDate = state.dateId; rebuildRenderer(); }
  renderer.setPresentation('gameplay');
  closeTypedInput();
}
async function resumeStoredDinner() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('table-for-two-session') || 'null') as { id: string; token: string; seenCues?: string[] } | null;
    if (!saved?.id || !saved.token) return;
    token = saved.token;
    const result = await request<{ state: DinnerState }>('/api/date/sessions/' + encodeURIComponent(saved.id));
    if (result.state.phase === 'ended') { token = ''; sessionStorage.removeItem('table-for-two-session'); return; }
    state = result.state;
    presentedCues = new Set(saved.seenCues || []);
    if (state.phase === 'playing') state = (await request<{ state: DinnerState }>('/api/date/sessions/' + encodeURIComponent(saved.id) + '/command', { type: 'pause', paused: true })).state;
    selectedDate = state.dateId; renderer.setDate(selectedDate); joinUI(); applyState(state);
    if (state.phase === 'paused') el('pause-dialog').hidden = false;
    void poll();
  } catch (error) {
    token = '';
    if (pageSuspended || document.hidden || disposed) return;
    console.warn('Saved dinner could not be restored', error);
    toast('Your saved date could not be restored. Try reloading before starting another evening.', 10000);
  }
}
function showEnding() {
  if (endingPresented) return;
  endingPresented = true;
  cancelLocalPlayback(); clearTimeout(pollTimer);
  keys.clear(); releasePointer(); closeTypedInput(); recognition.stop(); friendVoice?.disable(); micEnabled = false; updateMic();
  el('ending-screen').hidden = false; el('pause-dialog').hidden = true;
  el('ending-copy').textContent = state.reason || `You shared an evening with ${getDate(state.dateId)!.name}. Some moments were smooth. Others made a better story.`;
  el('ending-cost').textContent = `${state.usage.claudeRequests} conversation turns · ${money(state.usage.totalCost)} estimated API usage`;
  el('ending-cost').hidden = !providers?.development;
  eveningUI.closeDialogs(); eveningUI.renderEnding(state); ambience.cue('ending');
  try { sessionStorage.removeItem('table-for-two-session'); } catch { /* Optional. */ }
}
function clearWalkingKeys() { keys.clear(); }
function releasePointer() {
  keys.clear(); dragging = false; mobile?.clear();
  if (document.pointerLockElement) { intentionalPointerRelease = true; document.exitPointerLock(); }
}
async function resumeDinner(after?: () => void) {
  if (!joined || pausePending || state.phase === 'ended') return;
  pausePending = true;
  const controls = el('pause-dialog').querySelectorAll<HTMLButtonElement>('button');
  controls.forEach(control => { control.disabled = true; });
  try {
    await unlockAudio(true);
    if (await command({ type: 'pause', paused: false })) {
      el('pause-dialog').hidden = true;
      recognition.setPaused(visibleModal() || document.hidden);
      after?.();
    }
  } finally {
    controls.forEach(control => { control.disabled = false; }); pausePending = false;
  }
}
function closeTypedInput(restoreFocus = false) {
  const form = el('conversation-form');
  if (form.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  form.hidden = true;
  btn('type-toggle').setAttribute('aria-expanded', 'false');
  if (restoreFocus) (btn('type-toggle').checkVisibility({ checkVisibilityCSS: true }) ? btn('type-toggle') : btn('mic-toggle')).focus();
}
function showTypedInput() {
  if (!joined || state.phase !== 'playing' || visibleModal()) return;
  releasePointer(); el('journal').hidden = true;
  btn('journal-toggle').setAttribute('aria-expanded', 'false');
  el('conversation-form').hidden = false;
  updateTypedSubmit();
  btn('type-toggle').setAttribute('aria-expanded', 'true');
  const target = el<HTMLSelectElement>('conversation-target');
  if (doubleClient.active && target) { const aimed = renderer.getConversationTarget(state); target.value = [...target.options].some(option => option.value === aimed) ? aimed : 'table'; }
  updateTypedSubmit();
  input('conversation-input').focus();
}
async function pauseDinner() {
  if (!joined || state.phase === 'ended' || pausePending) return;
  pausePending = true;
  el('journal').hidden = true; btn('journal-toggle').setAttribute('aria-expanded', 'false');
  releasePointer(); closeTypedInput(); el('pause-dialog').hidden = false; recognition.setPaused(true);
  const controls = el('pause-dialog').querySelectorAll<HTMLButtonElement>('button');
  controls.forEach(control => { control.disabled = true; });
  try { await interrupt(); await command({ type: 'pause', paused: true }); }
  finally {
    controls.forEach(control => { control.disabled = false; });
    pausePending = false;
    if (state.phase === 'playing') el('pause-dialog').hidden = true;
    if (!el('pause-dialog').hidden) menuNavigation.focusInitial();
  }
}
// The scene is a seated conversation. Table props never own input or trigger scripts.
function rebuildRenderer() {
  renderer?.dispose();
  renderer = new RestaurantRenderer(el('restaurant-scene'), selectedDate);
  if (renderer.softwareRendering && !softwareNoticeShown && !navigator.webdriver) {
    softwareNoticeShown = true;
    toast('Your browser is drawing the game without your graphics card, so it will run slowly. Turn on hardware acceleration in its settings (Chrome: Settings › System) and relaunch.', 14000);
  }
  renderer.setPresentation(joined ? 'gameplay' : 'selection');
  document.querySelector<HTMLElement>('.selection-stage-label strong')!.textContent = getDate(selectedDate)!.name;

}
if (!document.hidden && document.hasFocus()) rebuildRenderer();

const friendAudio = document.createElement('audio');
friendAudio.id = 'friend-audio'; friendAudio.hidden = true; document.body.append(friendAudio);
friendVoice = new VoiceChat({
  audio: friendAudio, partnerLabel: 'your friend',
  capture: () => sharedMicrophone.acquire(), releaseCapture: stream => sharedMicrophone.release(stream),
  iceServers: () => doubleRoom?.voice.iceServers ?? [],
  send(message) {
    if (!doubleClient.active) return;
    if (message.type === 'voice-enable' || message.type === 'voice-signal') {
      void doubleClient.command(message).catch(error => {
        // Closing a peer can leave one last candidate in flight. Its old epoch is expected to be rejected.
        if (message.type === 'voice-signal' && (message.epoch !== doubleRoom?.voice.epoch || doubleRoom?.phase !== 'playing')) return;
        toast((error as Error).message);
      });
    }
  },
  onStatus(status) {
    btn('friend-audio-unlock').hidden = !status.playbackBlocked;
    btn('mic-toggle').title = doubleRoom ? status.message : 'Toggle microphone';
    if (status.phase === 'error') toast(status.message);
  },
});
btn('friend-audio-unlock').addEventListener('click', () => void friendVoice.playRemote());
const doubleClient = new DoubleDateClient({
  onState(room) {
    const previousRoomPhase = doubleRoom?.phase;
    if (doubleRoom?.id !== room.id) { loggedDoubleLines.clear(); el('conversation-log').replaceChildren(); }
    doubleRoom = room;
    for (const line of room.lines) if (!loggedDoubleLines.has(line.id)) {
      loggedDoubleLines.add(line.id);
      const human = room.members.find(member => member.id === line.speaker);
      const date = room.dates.find(actor => actor.id === line.speaker);
      log(human?.name ?? (date ? getDate(date.dateId)!.name : line.speaker === 'waiter' ? 'Eli · your waiter' : 'The neighboring diner'), line.text);
    }
    while (loggedDoubleLines.size > 300) loggedDoubleLines.delete(loggedDoubleLines.values().next().value!);
    (window as Window & { __doubleDateState?: DoubleDateRoomState }).__doubleDateState = room;
    const localId = doubleClient.credentials!.memberId;
    doubleLobby.update(room, localId);
    if (room.pauseReason === 'reconnect') { microphoneAttempt++; recognition.stop(); friendVoice.disable(); micEnabled = false; updateMic(); }
    const playerId = localId === 'h1' ? 'p1' : 'p2';
    friendVoice.update({ room: room.id, phase: room.phase, pauseReason: room.pauseReason ?? null,
      players: room.members.map(member => ({ id: member.id === 'h1' ? 'p1' : 'p2', connected: member.connected })),
      voice: { epoch: room.voice.epoch, enabled: { p1: room.voice.enabled.h1, p2: room.voice.enabled.h2 } },
    }, playerId);
    const localDate = room.dates.find(date => date.humanId === localId);
    if (localDate) {
      const next = localDoubleDateView(room, localId);
      if (selectedDate !== next.dateId) { selectedDate = next.dateId; renderer.setDate(selectedDate); }
      if (room.phase !== 'waiting') {
        if (!joined) { state = next; joinUI(); }
        if (next.phase !== 'ended' && !el('ending-screen').hidden) { endingPresented = false; el('ending-screen').hidden = true; el('dinner-hud').hidden = false; renderer.setPresentation('gameplay'); }
        applyState(next);
        if (room.phase === 'ended' && previousRoomPhase !== 'ended' && endingPresented) eveningUI.renderEnding(next);
      } else { state = next; renderer.setPresentation('selection'); }
    }
    if (room.phase === 'waiting') { el('arrival-screen').hidden = true; if (doubleLobby.element.hidden) doubleLobby.show('room'); }
    else doubleLobby.hide();
    btn('back-to-table').hidden = room.phase === 'ended' || room.views[localId].phase !== 'ended';
    busy = !!room.processing;
    updateTypedSubmit();
    if (busy) el('turn-status').textContent = 'Listening…';
    else if (el('turn-status').textContent === 'Listening…') el('turn-status').textContent = '';
    const target = el<HTMLSelectElement>('conversation-target');
    target.hidden = false;
    const previous = target.value || 'table';
    const choices: [string, string][] = [['table', 'Everyone'], ...room.dates.filter(date => room.views[date.humanId].phase !== 'ended' && date.stance !== 'leaving').map(date => [date.id, getDate(date.dateId)!.name] as [string, string]), ...room.members.filter(member => member.id !== localId).map(member => [member.id, member.name] as [string, string])];
    if (target.dataset.choices !== JSON.stringify(choices)) {
      target.replaceChildren(...choices.map(([value, name]) => new Option(name, value)));
      target.value = choices.some(([value]) => value === previous) ? previous : 'table';
      target.dataset.choices = JSON.stringify(choices);
    }
  },
  onLines(lines) { for (const line of lines) presentDoubleLine(line); },
  onGeneration() { cancelLocalPlayback(); },
  onSignals(signals) { for (const signal of signals) void friendVoice.handleSignal({ type: 'voice-signal', from: signal.from === 'h1' ? 'p1' : 'p2', epoch: signal.epoch, signal: signal.signal }); },
  onConnection(connected) { if (!connected) { friendVoice.disconnect(); recognition.stop(); micEnabled = false; updateMic(); } },
  onError(message) { if (!joined && !doubleLobby.element.hidden) doubleLobby.showError(message); else toast(message, 10000); },
  onExpired(message) { returnToModes(message); },
});
function presentDoubleLine(line: DoubleDialogueLine) {
  if (!doubleRoom) return;
  if (line.speaker === 'h1' || line.speaker === 'h2') {
    tableAttention = { actor: line.speaker, until: performance.now() + Math.min(6000, 1000 + line.text.length * 28) };
    const member = doubleRoom.members.find(member => member.id === line.speaker);
    if (line.speaker !== doubleClient.credentials?.memberId && !playback.speaker) {
      clearTimeout(captionTimer); el('caption-speaker').textContent = member?.name ?? 'Friend';
      el('caption-text').textContent = line.text; el('caption').hidden = !preferences.captions; clearCaptionLater(5000);
    }
    return;
  }
  if (line.generation !== doubleRoom.generation) return;
  const date = doubleRoom.dates.find(date => date.id === line.speaker);
  const localId = doubleClient.credentials!.memberId;
  queueUtterance({ speaker: date ? date.humanId === localId ? 'date' : 'other-date' : line.speaker as 'waiter' | 'diner',
    actorId: line.speaker, dateId: date?.dateId, lineId: line.id, text: line.text, emotion: line.emotion, clipId: line.clipId }, line.generation, generationEpoch, false);
}
function returnToModes(message: string) {
  cancelLocalPlayback(); clearTimeout(pollTimer); microphoneAttempt++;
  recognition.stop(); friendVoice.disconnect(); micEnabled = false; updateMic();
  eveningUI.closeDialogs(); closeTypedInput(); releasePointer();
  joined = false; token = ''; doubleRoom = undefined; tableAttention = undefined; endingPresented = false;
  for (const id of ['pause-dialog', 'ending-screen', 'settings-dialog', 'journal', 'dinner-hud']) el(id).hidden = true;
  el('restaurant-app').classList.remove('playing'); doubleLobby.hide();
  state = preview(selectedDate); renderer.setDate(selectedDate); renderer.setPresentation('selection');
  el('conversation-target').hidden = true; el('arrival-screen').hidden = false; el('arrival-screen').dataset.screen = 'mode';
  el('conversation-log').replaceChildren();
  const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url);
  toast(message, 12000); menuNavigation.focusInitial();
}
async function leaveDoubleLobby() {
  await doubleClient.leave(); doubleRoom = undefined; friendVoice.disconnect();
  doubleLobby.hide(); state = preview(selectedDate); renderer.setDate(selectedDate); renderer.setPresentation('selection');
  el('conversation-target').hidden = true; el('arrival-screen').hidden = false; el('arrival-screen').dataset.screen = 'mode';
  const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null, '', url);
}
doubleLobby = new DoubleDateLobby(el('restaurant-app'), {
  async create(name) { await doubleClient.create(name, preferences.model, preferences.sessionLimit); },
  async join(code, name) { await doubleClient.join(code, name); },
  async choose(dateId) { await doubleClient.command({ type: 'choose-date', dateId }); },
  async ready(ready) { await doubleClient.command({ type: 'ready', ready }); },
  async start() {
    const startEpoch = pageEpoch;
    await unlockAudio(true);
    if (disposed || pageSuspended || document.hidden || startEpoch !== pageEpoch) return;
    await doubleClient.command({ type: 'start' });
  },
  async copyInvite() { try { await navigator.clipboard.writeText(doubleClient.inviteUrl()); toast('Invite copied.'); } catch { toast('Invite code: ' + doubleRoom?.code, 12000); } },
  back: leaveDoubleLobby,
});
mobile = new MobileControls(el('restaurant-app'), {
  talk: showTypedInput,
  closeTalk() { closeTypedInput(); }, mic() { btn('mic-toggle').click(); },
  pause() { void pauseDinner(); }, release: releasePointer, notice: toast,
});
async function restoreSession() {
  if (await doubleClient.restore()) return;
  if (pageSuspended || document.hidden || disposed) return;
  const invite = new URL(location.href).searchParams.get('invite');
  if (invite) { el('arrival-screen').hidden = true; doubleLobby.setInviteCode(invite); doubleLobby.show('join'); menuNavigation.refresh('gameplay'); return; }
  await resumeStoredDinner();
}

btn('title-start').addEventListener('click', () => { userEnteredMenu = true; el('arrival-screen').dataset.screen = 'mode'; menuNavigation.focusInitial(); });
btn('mode-solo').addEventListener('click', () => { doubleLobby.hide(); state = preview(selectedDate); renderer.setDate(selectedDate); el('arrival-screen').dataset.screen = 'select'; menuNavigation.focusInitial(); });
btn('mode-double').addEventListener('click', () => { el('arrival-screen').hidden = true; doubleLobby.show('entry'); menuNavigation.focusInitial(); });
btn('mode-blind').addEventListener('click', () => void startDinner(true));
btn('mode-back').addEventListener('click', () => { el('arrival-screen').dataset.screen = 'title'; menuNavigation.focusInitial(); });
btn('select-back').addEventListener('click', () => { el('arrival-screen').dataset.screen = 'mode'; menuNavigation.focusInitial(); });
document.querySelectorAll<HTMLButtonElement>('[data-date]').forEach(card => card.addEventListener('click', () => {
  selectedDate = card.dataset.date as DateId; state = preview(selectedDate); renderer.setDate(selectedDate);
  document.querySelector<HTMLElement>('.selection-stage-label strong')!.textContent = getDate(selectedDate)!.name;
  el('restaurant-app').classList.remove('selection-changing');
  void el('restaurant-app').offsetWidth;
  el('restaurant-app').classList.add('selection-changing');
  document.querySelectorAll<HTMLButtonElement>('[data-date]').forEach(other => { const selected = other === card; other.classList.toggle('selected', selected); other.setAttribute('aria-pressed', String(selected)); });
}));
btn('start-date').addEventListener('click', () => void startDinner());
async function applyModelChatCommand(command: ModelChatCommand, controlEpoch: number) {
  if (command.type === 'invalid') { toast('That model command is not valid.'); return; }
  if (command.type === 'status') {
    const current = doubleClient.active ? doubleRoom?.model ?? preferences.model : preferences.model;
    const selected = preferences.modelSource === 'chat-command' || doubleClient.active ? current : state.conversationModel ?? current;
    toast(`Conversation model: ${conversationModelName(selected)}${state.conversationModel && selected !== state.conversationModel ? ' (next turn)' : ''}.`);
    return;
  }
  if (!providers) { toast('Still connecting to the restaurant. Try again in a moment.'); return; }
  if (command.type === 'reset') {
    try {
      await interruption;
      if (doubleClient.active) {
        // A dispatched turn must be accepted before reset can discard it.
        // This waits only for its HTTP acknowledgement, never its AI reply.
        await Promise.allSettled([...doubleTurnSubmissions]);
        await doubleClient.command({ type: 'reset-model' });
      }
      else {
        cancelLocalPlayback();
        const result = await request<{ state: DinnerState }>(sessionPath() + '/reset-model', {});
        applyState(result.state);
      }
      if (doubleClient.active) cancelLocalPlayback();
      preferences.model = providers.defaultModel;
      delete preferences.modelSource;
      savePreferences();
      el('turn-status').textContent = '';
      toast(`Conversation reset to ${conversationModelName(providers.defaultModel)}. Keep playing.`);
    } catch (error) { toast((error as Error).message); }
    return;
  }
  if (!providers.models.includes(command.model)) { toast(command.model === DOLPHIN_LLM_MODEL ? 'Dolphin direct is unavailable on this server.' : 'That model is unavailable on this server.'); return; }
  try {
    if (doubleClient.active) await doubleClient.command({ type: 'set-model', model: command.model });
    if (controlEpoch !== modelResetEpoch) return;
    preferences.model = command.model;
    preferences.modelSource = 'chat-command';
    savePreferences();
    toast(`${conversationModelName(command.model)} selected for the next turn.`);
  } catch (error) { toast((error as Error).message); }
}
el<HTMLFormElement>('conversation-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = input('conversation-input').value.trim();
  const modelCommand = parseModelChatCommand(text);
  if (!text || !joined || state.phase !== 'playing' || visibleModal() || modelResetPending || (typedSubmissionPending && modelCommand?.type !== 'reset')) return;
  if (text.length > 2000) { toast('Keep each turn under 2,000 characters.'); return; }
  const target = doubleClient.active ? el<HTMLSelectElement>('conversation-target').value as ConversationTarget : undefined;
  if (!modelCommand && !dateArrival(state, doubleRoom, target).ready) { updateTypedSubmit(); return; }
  const submission = ++typedSubmissionEpoch;
  const complete = () => { if (submission === typedSubmissionEpoch) { typedSubmissionPending = false; modelResetPending = false; updateTypedSubmit(); } };
  if (modelCommand) {
    typedSubmissionPending = true; modelResetPending = modelCommand.type === 'reset'; input('conversation-input').value = ''; closeTypedInput(); updateTypedSubmit();
    if (modelResetPending) modelResetEpoch++;
    const controlEpoch = modelResetEpoch;
    // Keep short model controls ordered, without waiting for the AI reply itself.
    modelControlQueue = modelControlQueue.catch(() => {}).then(() => applyModelChatCommand(modelCommand, controlEpoch));
    void modelControlQueue.finally(complete);
    return;
  }
  typedSubmissionPending = true; input('conversation-input').value = ''; closeTypedInput(); updateTypedSubmit();
  void sendTurn(text, target, 'typed').then(sent => {
    if (submission === typedSubmissionEpoch && !sent && !input('conversation-input').value.trim()) {
      input('conversation-input').value = text;
      if (state.phase === 'playing' && !visibleModal()) showTypedInput();
    }
  }).catch(error => { if (submission === typedSubmissionEpoch) { if (!input('conversation-input').value.trim()) input('conversation-input').value = text; toast((error as Error).message); } })
    .finally(complete);
});
input('conversation-input').addEventListener('input', updateTypedSubmit);
el<HTMLSelectElement>('conversation-target').addEventListener('change', updateTypedSubmit);
btn('type-toggle').addEventListener('click', () => { if (el('conversation-form').hidden) showTypedInput(); else closeTypedInput(true); });
btn('mic-toggle').addEventListener('click', async () => {
  const attempt = ++microphoneAttempt;
  if (micEnabled) { recognition.stop(); friendVoice.disable(); micEnabled = false; updateMic(); return; }
  if (visibleModal() || state.phase !== 'playing' || document.hidden || !dateArrival(state, doubleRoom, 'table').ready) return;
  await unlockAudio();
  if (attempt !== microphoneAttempt || document.hidden || visibleModal() || state.phase !== 'playing' || !dateArrival(state, doubleRoom, 'table').ready) return;
  micEnabled = true; updateMic();
  try { await Promise.all([recognition.start(), doubleClient.active ? friendVoice.enable() : Promise.resolve()]); if (attempt === microphoneAttempt && !micEnabled) { recognition.stop(); friendVoice.disable(); } }
  catch (error) { if (attempt !== microphoneAttempt) return; recognition.stop(); friendVoice.disable(); micEnabled = false; updateMic(); toast((error as Error).message, 10000); }
});
btn('pause-open').addEventListener('click', () => void pauseDinner());
btn('resume-date').addEventListener('click', () => void resumeDinner());
btn('finish-date').addEventListener('click', async () => { if (doubleClient.active && state.doubleDate?.role === 'wingman') { try { await doubleClient.command({ type: 'view-ending' }); } catch (error) { toast((error as Error).message); } return; } await interrupt(); await command({ type: 'finish' }); });
btn('back-to-table').addEventListener('click', async () => { if (!doubleClient.active) return; try { await doubleClient.command({ type: 'return-to-table' }); } catch (error) { toast((error as Error).message); } });
btn('new-date').addEventListener('click', async () => { if (doubleClient.active) await doubleClient.leave(true); location.href = '/'; });
btn('journal-toggle').addEventListener('click', () => { const open = el('journal').hidden; el('journal').hidden = !open; btn('journal-toggle').setAttribute('aria-expanded', String(open)); if (open) { releasePointer(); closeTypedInput(); } });
btn('journal-close').addEventListener('click', () => { el('journal').hidden = true; btn('journal-toggle').setAttribute('aria-expanded', 'false'); });
input('speech-enabled').checked = preferences.speech; input('captions-enabled').checked = preferences.captions;
const ambientSetting = document.createElement('label'); ambientSetting.className = 'setting-row';
const ambientCopy = document.createElement('span'); ambientCopy.textContent = 'Restaurant ambience';
const ambientDescription = document.createElement('small'); ambientDescription.textContent = 'Rain, the other tables, and quiet lounge piano'; ambientCopy.append(ambientDescription);
const ambientToggle = document.createElement('input'); ambientToggle.type = 'checkbox'; ambientToggle.id = 'ambience-enabled'; ambientToggle.checked = preferences.ambience;
ambientSetting.append(ambientCopy, ambientToggle); el('settings-title').insertAdjacentElement('afterend', ambientSetting);
ambientToggle.addEventListener('change', () => { preferences.ambience = ambientToggle.checked; ambience.setEnabled(preferences.ambience); savePreferences(); });
// How the date seems: a small heart that fills as they warm up. On unless the player turns it off.
const interestSetting = document.createElement('label'); interestSetting.className = 'setting-row';
const interestCopy = document.createElement('span'); interestCopy.textContent = 'Show how your date seems';
const interestDescription = document.createElement('small'); interestDescription.textContent = 'A small heart that fills as they warm to you'; interestCopy.append(interestDescription);
const interestToggle = document.createElement('input'); interestToggle.type = 'checkbox'; interestToggle.id = 'interest-cue-enabled'; interestToggle.checked = preferences.interestCue !== false;
interestSetting.append(interestCopy, interestToggle); ambientSetting.insertAdjacentElement('afterend', interestSetting);
interestToggle.addEventListener('change', () => { preferences.interestCue = interestToggle.checked; interestCue.update(state, preferences.interestCue); savePreferences(); });
input('voice-volume').value = String(preferences.volume); input('session-limit').value = String(preferences.sessionLimit);
btn('settings-open').addEventListener('click', async () => {
  if (settingsClosing || !el('settings-dialog').hidden) return;
  const sessionId = state.id, shouldPause = joined && state.phase === 'playing' && !doubleClient.active;
  releasePointer(); closeTypedInput(); settingsPaused = false; el('settings-dialog').hidden = false;
  recognition.setPaused(true); renderUsage(); renderProviders();
  settingsOpening = (async () => {
    if (shouldPause) {
      await interrupt();
      if (joined && state.id === sessionId && state.phase !== 'ended') settingsPaused = await command({ type: 'pause', paused: true });
    }
  })();
  await settingsOpening;
});
btn('pause-settings').addEventListener('click', () => btn('settings-open').click());
for (const [id, action] of [
  ['pause-talk', () => showTypedInput()],
  ['pause-journal', () => btn('journal-toggle').click()],
] as const) btn(id).addEventListener('click', async () => {
  await resumeDinner(action);
});
btn('settings-close').addEventListener('click', async () => {
  if (settingsClosing || el('settings-dialog').hidden) return;
  settingsClosing = true; btn('settings-close').disabled = true;
  const sessionId = state.id;
  try {
    await settingsOpening;
    if (joined && state.id === sessionId && settingsPaused && state.phase !== 'ended' && !await command({ type: 'pause', paused: false })) return;
    settingsPaused = false; el('settings-dialog').hidden = true;
  } finally {
    settingsClosing = false; btn('settings-close').disabled = false;
    recognition.setPaused(state.phase !== 'playing' || visibleModal() || !doubleClient.active && !scenePresenceAvailable(state));
  }
});
btn('settings-save').addEventListener('click', async () => {
  const value = Number(input('session-limit').value);
  const ceiling = Math.min(20, providers?.sessionLimit ?? 20);
  if (!Number.isFinite(value) || value < .05 || value > ceiling) { el('settings-saved').textContent = `Choose a dinner limit between $0.05 and the server ceiling of $${ceiling}.`; return; }
  preferences.sessionLimit = value; savePreferences();
  el('settings-saved').textContent = 'Saved. The limit applies to a new dinner.';
});
input('speech-enabled').addEventListener('change', () => { preferences.speech = input('speech-enabled').checked; if (!preferences.speech) speech.stop(); savePreferences(); });
input('captions-enabled').addEventListener('change', () => {
  preferences.captions = input('captions-enabled').checked;
  // Re-enabling captions cannot make an interrupted reading interval continuous.
  if (!preferences.captions) captionReadAbort?.abort();
  el('caption').hidden = !preferences.captions || !el('caption-text').textContent;
  savePreferences();
});
input('voice-volume').addEventListener('input', () => { preferences.volume = Number(input('voice-volume').value); speech.setVolume(preferences.volume); savePreferences(); });
document.addEventListener('keydown', event => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement)?.tagName);
  if (event.key === 'Escape') {
    event.preventDefault(); clearWalkingKeys();
    if (event.repeat) return;
    if (!el('ending-screen').hidden) return;
    if (!el('conversation-form').hidden && !visibleModal()) closeTypedInput(true);
    else if (!el('settings-dialog').hidden) btn('settings-close').click();
    else if (eveningUI.isDialogOpen) eveningUI.closeDialogs();
    else if (!el('journal').hidden) btn('journal-close').click();
    else if (!el('pause-dialog').hidden) btn('resume-date').click();
    else if (!joined) { if (startingDinner) return; if (!doubleLobby.element.hidden) { void leaveDoubleLobby(); return; } if (el('arrival-screen').dataset.screen === 'select') btn('select-back').click(); else if (el('arrival-screen').dataset.screen === 'mode') btn('mode-back').click(); }
    else if (eveningUI.dismissPrompt()) return;
    else void pauseDinner();
    return;
  }
  if (menuNavigation.handle(event)) { clearWalkingKeys(); return; }
  if (startingDinner || typing || !joined || visibleModal() || state.phase !== 'playing' || mobile?.menuScope) return;
  const key = event.key.toLowerCase();
  if (key === 'j' && !event.repeat) { event.preventDefault(); btn('journal-toggle').click(); return; }
  if (!el('journal').hidden) return;
  if (key === 'm' && !event.repeat) { event.preventDefault(); btn('mic-toggle').click(); return; }
  if (key === 't' && !event.repeat) { event.preventDefault(); showTypedInput(); }
});
function suspendPage() {
  if (disposed) return;
  if (pageSuspended) { pageEpoch++; doubleClient.suspend(); return; }
  pageSuspended = true; pageEpoch++; commandEpoch++;
  renderer?.setActive(false);
  if (!joined && !userEnteredMenu) restoreAttempted = false;
  pageRequests.abort(); clearTimeout(pollTimer); clearTimeout(connectionTimer);
  if (frameHandle) cancelAnimationFrame(frameHandle); frameHandle = 0;
  releasePointer(); cancelLocalPlayback(); microphoneAttempt++;
  recognition.stop(); friendVoice.disconnect(); sharedMicrophone.suspend(); speech.suspend(); ambience.suspend();
  micEnabled = false; updateMic();
  const double = doubleClient.active;
  doubleClient.suspend();
  if (double) return;
  if (!joined || state.phase === 'ended') return;
  const path = sessionPath() + '/command', sessionToken = token;
  const pause = () => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ type: 'pause', paused: true }), keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
  backgroundPause = backgroundPause ? backgroundPause.then(pause) : pause();
}
async function resumePage() {
  if (!pageSuspended || disposed) return;
  const epoch = ++pageEpoch;
  const double = doubleClient.active;
  await Promise.all([doubleClient.resume(), backgroundPause]);
  if (disposed || document.hidden || epoch !== pageEpoch) return;
  pageSuspended = false; pageRequests = new AbortController(); backgroundPause = undefined;
  if (!renderer) rebuildRenderer(); else { renderer.setActive(true); renderer.resize(); }
  lastFrame = performance.now(); scheduleFrame();
  if (!double && joined && state.phase !== 'ended') { clearTimeout(pollTimer); void poll(); }
  else if (!double && (!providers || !joined && !userEnteredMenu && !restoreAttempted)) void connectRestaurant();
}
const pageActivity = new PageActivity(suspendPage, () => { void resumePage(); });
window.addEventListener('blur', () => pageActivity.focus(false));
window.addEventListener('focus', () => pageActivity.focus(true));
document.addEventListener('visibilitychange', () => pageActivity.visibility(document.hidden));
window.addEventListener('resize', () => renderer?.resize());
window.addEventListener('pagehide', event => {
  pageActivity.page(false);
  if (event.persisted) return;
  disposed = true; pageRequests.abort(); clearTimeout(pollTimer); clearTimeout(connectionTimer);
  speech.dispose(); recognition.dispose(); ambience.dispose(); friendVoice.dispose(); sharedMicrophone.dispose(); doubleClient.dispose();
  mobile?.dispose(); renderer?.dispose();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (disposed) { location.reload(); return; }
  pageActivity.visibility(document.hidden); pageActivity.focus(document.hasFocus()); pageActivity.page(true);
});
const perfStats = new URLSearchParams(location.search).has('stats') ? createPerfStats(document.body, () => renderer.diagnostics()) : null;
const frameCap = createFrameCap();
function scheduleFrame() { if (!frameHandle && !disposed && !pageSuspended && !document.hidden) frameHandle = requestAnimationFrame(frame); }
function frame(now: number) {
  frameHandle = 0;
  if (disposed || pageSuspended || document.hidden || !renderer) return;
  scheduleFrame();
  if (!frameCap.shouldRender(now)) return;
  const frameStart = performance.now();
  const dt = Math.min(.06, (now - lastFrame) / 1000); lastFrame = now;
  menuNavigation.refresh(el('conversation-form').hidden ? 'gameplay' : 'typing');
  renderer.setTableFocus(null);
  if (state.doubleDate) state.doubleDate.speakingActor = tableAttention && tableAttention.until > now ? tableAttention.actor : null;
  if (!joined || !micEnabled || busy || state.phase !== 'playing' || visibleModal() || document.hidden || pageSuspended) clearListeningPreview();
  else {
    const cue = listeningPreview.sample(now);
    if (cue && cue.target !== currentListeningTarget()) clearListeningPreview();
    else renderer.setListeningPreview(cue);
  }
  renderer.setDateThinking(busy && !playback.speaker);
  renderer.update(dt, state, playback);
  updateTypedSubmit();
  el('scene-loading').hidden = renderer.isReady;
  const controlsBlocked = menuInputOpen() || !el('conversation-form').hidden || pageSuspended || document.hidden;
  mobile?.update({ joined, playing: state.phase === 'playing' && renderer.isReady && !pageSuspended, blocked: controlsBlocked, modal: visibleModal(), typing: !el('conversation-form').hidden, seated: true, micEnabled, interactionLabel: null });
  perfStats?.sample(now, performance.now() - frameStart);
}
// The DOM menus are ready before shader preparation or the first rendered frame.
menuNavigation.refresh('gameplay');
scheduleFrame();
if (document.hidden) pageActivity.visibility(true);
if (!document.hasFocus()) pageActivity.focus(false);
async function connectRestaurant(attempt = 0) {
  try {
    const status = await request<ProviderStatus>('/api/date/status');
    if (disposed || pageSuspended || document.hidden) return;
    providers = status; renderProviders();
    if (!joined && !startingDinner) el('start-error').hidden = true;
    if (!restoreAttempted && !joined && !startingDinner && !userEnteredMenu) { restoreAttempted = true; await restoreSession(); }
  } catch {
    if (disposed || pageSuspended || document.hidden) return;
    if (!joined) { el('start-error').textContent = attempt < 4 ? 'Opening the restaurant…' : 'The restaurant could not connect. Reload to try again.'; el('start-error').hidden = false; }
    if (attempt < 4) connectionTimer = setTimeout(() => void connectRestaurant(attempt + 1), 1500 * (attempt + 1));
  }
}
void connectRestaurant();
