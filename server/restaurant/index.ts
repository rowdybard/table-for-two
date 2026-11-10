import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { DATES, getDate, MODEL_RATES } from '../../src/restaurant/content';
import { AUTHORED_UTTERANCES } from '../../src/restaurant/authored';
import { createBlindDate } from '../../src/restaurant/blind-date';
import { soloSystem } from './conversation-prompt';
import type { RestaurantScenarioId } from '../../src/restaurant/scenario-types';
import { restaurantScenarioContext } from '../../src/restaurant/scenarios';
import type { ClaudeModel, CostUsage, DateId, DinnerCommand, DinnerState, Emotion, ProviderStatus, SceneTurn, SceneUtterance, TurnEvent, TurnRequest } from '../../src/restaurant/types';
import { EVENING_ACTIONS, INTERACTION_TARGETS } from '../../src/restaurant/types';
import { DinnerScene, emptyUsage } from './scene';
import { ACTIONS, anthropicAdapter, DateApiError, elevenLabsAdapter, EMOTIONS, SOCIAL_SIGNALS, speechText, type ClaudeAdapter, type ClaudeChunk, type ClaudeRequest, type SpeechAdapter, type SpeechRequest, type TokenUsage } from './providers';
import { edgeSpeechAdapter, edgeSettings, EDGE_MODEL, EDGE_VOICES } from './edge-speech';
import { validAgendaAssessment } from './agendas';
import { validBoundaryAssessment } from './boundaries';
import { alternatingMessages, deferrableCue, dialogueLoopContext, tableNow } from './dialogue-policy';
import { openRouterAdapter, openRouterSchemaInstructions } from './openrouter';
import { hordeAdapter } from './horde';
import { dolphinLlmAdapter } from './dolphin-llm';
import { DOLPHIN_MODEL, DOLPHIN_LLM_MODEL, HORDE_MODEL, isEarnedModel } from '../../src/restaurant/types';
import { TURN_SCHEMA } from './providers';
import { isSilentDialogueLine } from './providers';
import { TABLETOP_ACTIONS } from '../../src/restaurant/tabletop';
import { scenePresenceAvailable } from '../../src/restaurant/scenario-care';
import { scenarioMechanicsContext } from './scenario-effects';
import { needsAdultConversation, type ConversationRoutingContext } from './conversation-routing';
import { MEMORY_REJECT, mergeMemoryForDelivery, retireSharedPremise } from './memory';
import { QUIET_GAP_SECONDS, conversationMessages, deliveryLabel, heardPrefix, turnNote, type TurnFlow } from './turn-note';
import { tableFacts } from './table-facts';

export type { ClaudeAdapter, SpeechAdapter } from './providers';
export interface BudgetRecord { day: string; spent: number; reserved: number }
export interface RestaurantPaidAccount { usage: CostUsage; sessionLimit: number; reserved: number }
/** Internal service boundary: callers share this server's ledger and provider adapters. */
export interface RestaurantServices {
  modelFor?(requested: ClaudeModel, state: DinnerState, context?: ConversationRoutingContext): ClaudeModel;
  status(): ProviderStatus;
  now(): number;
  createAccount(limit?: number): RestaurantPaidAccount;
  streamClaude(account: RestaurantPaidAccount, request: ClaudeRequest, signal: AbortSignal): AsyncIterable<ClaudeChunk>;
  streamSpeech(account: RestaurantPaidAccount, request: { text: string; emotion: Emotion; voice: DateId | 'waiter' | 'diner' }, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface RestaurantOptions {
  env?: NodeJS.ProcessEnv; claude?: ClaudeAdapter; dolphin?: ClaudeAdapter; dolphinLlm?: ClaudeAdapter; horde?: ClaudeAdapter; speech?: SpeechAdapter;
  now?: () => number; autoTick?: boolean; requestTimeoutMs?: number; clipsDirectory?: string; development?: boolean; ledgerPath?: string | false;
  budgetStore?: { load(): Promise<BudgetRecord | null>; save(record: BudgetRecord): Promise<void> };
  storyRate?: number; scenarioId?: RestaurantScenarioId;
}
type TurnRecord = { fingerprint: string; events: TurnEvent[]; subscribers: Set<ServerResponse>; finished: boolean; pending?: ServerResponse };
type GenerationRecord = { lines: SceneUtterance[]; playback: Map<string, { completed: boolean; playedSeconds: number }>; interrupted: boolean; entry?: { role: 'assistant'; content: string }; pendingMemory?: { value: string; humanText: string; lines: SceneUtterance[] } };
type Session = { scene: DinnerScene; token: string; model: ClaudeModel; generation: number; controller?: AbortController; speechControllers: Set<AbortController>; turns: Map<string, TurnRecord>; allowed: Map<string, SceneUtterance>; generations: Map<number, GenerationRecord>; capturedCues: Set<string>; history: { role: 'user' | 'assistant'; content: string }[]; reserved: number; touched: number; activeTurn?: string; turnStarted: number; trimmed?: boolean; lastHeardAt?: number; replyGeneration?: number };
type Clip = { id: string; text: string; emotion: SceneUtterance['emotion']; voiceId: string; model: string; file: string; provider?: SpeechRequest['provider']; settings?: SpeechRequest['settings'] };
const models: ClaudeModel[] = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const HISTORY_ENTRIES = 60, HISTORY_BYTES = 20_000;
const numberEnv = (env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) => { const v = Number(env[key]); return env[key] && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; };
const keyFor = (u: SceneUtterance) => JSON.stringify([u.speaker, u.text, u.emotion]);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const apiError = (status: number, code: string, message: string) => new DateApiError(status, code, message);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));

export function validateUtterance(value: unknown, index: number): SceneUtterance {
  const invalid = (field: string) => new DateApiError(502, 'invalid_dialogue', 'The date returned an invalid line. Please try another turn.', { field, index });
  if (!object(value) || !exactKeys(value, ['speaker', 'text', 'emotion', 'clipId'])) throw invalid('utterance_shape');
  if (typeof value.text !== 'string' || !value.text.trim()) throw invalid('utterance_text_empty');
  if (value.text.length > 420) throw invalid('utterance_text_length');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.text)) throw invalid('utterance_text_controls');
  if (!EMOTIONS.includes(value.emotion as any)) throw invalid('utterance_emotion');
  if (value.speaker !== 'date') throw invalid('utterance_speaker');
  const text = value.text.trim();
  const authored = AUTHORED_UTTERANCES.find(u => u.speaker === value.speaker && u.text === text && u.emotion === value.emotion);
  return { speaker: value.speaker as SceneUtterance['speaker'], text, emotion: value.emotion as SceneUtterance['emotion'], ...(authored ? { clipId: authored.clipId } : {}) };
}
function enforceDateSpeechBudget(lines: readonly SceneUtterance[]) {
  if (lines.filter(line => line.speaker === 'date').map(line => line.text).join(' ').length > 420) throw new DateApiError(502, 'invalid_dialogue', 'The date returned too much dialogue for one reply.', { field: 'date_response_length' });
}
export function validateTurn(value: unknown): SceneTurn {
  const invalid = (field: string) => new DateApiError(502, 'invalid_dialogue', 'The date returned an invalid response. Please try another turn.', { field });
  if (!object(value) || !exactKeys(value, ['utterances', 'emotion', 'action', 'memory', 'social', 'agenda'])) throw invalid('turn_shape');
  if (!Array.isArray(value.utterances)) throw invalid('utterances_type');
  if (value.utterances.length < 1 || value.utterances.length > 2) throw invalid('utterances_count');
  if (!EMOTIONS.includes(value.emotion as any)) throw invalid('turn_emotion');
  if (!ACTIONS.includes(value.action as any)) throw invalid('turn_action');
  if (typeof value.memory !== 'string') throw invalid('memory_type');
  if (value.memory.length > MEMORY_REJECT) throw invalid('memory_length');
  if (value.social !== undefined && (!object(value.social) || !exactKeys(value.social, ['signal', 'reason', 'wantsToLeave', 'boundary']) || !SOCIAL_SIGNALS.includes(value.social.signal as any) || typeof value.social.reason !== 'string' || value.social.reason.length > 180 || typeof value.social.wantsToLeave !== 'boolean' || value.social.boundary !== undefined && !validBoundaryAssessment(value.social.boundary))) throw apiError(502, 'invalid_dialogue', 'The date returned an invalid social reaction.');
  if (value.agenda !== undefined && !validAgendaAssessment(value.agenda)) throw apiError(502, 'invalid_dialogue', 'The date returned an invalid understanding assessment.');
  const utterances = value.utterances.filter((line, index) => index === 0 || !isSilentDialogueLine(line, ['date', 'waiter', 'diner'])).map(validateUtterance);
  enforceDateSpeechBudget(utterances);
  return { utterances, emotion: value.emotion as SceneTurn['emotion'], action: value.action as SceneTurn['action'], memory: value.memory, ...(value.social ? { social: value.social as unknown as NonNullable<SceneTurn['social']> } : {}), ...(value.agenda ? { agenda: value.agenda as NonNullable<SceneTurn['agenda']> } : {}) };
}

/** Extract complete utterance objects while the enclosing JSON object is still streaming. */
export function completeUtterances(text: string): unknown[] {
  const start = /"utterances"\s*:\s*\[/.exec(text); if (!start) return [];
  let quoted = false, escaped = false, depth = 0, begin = -1; const result: unknown[] = [];
  for (let i = start.index + start[0].length; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; continue; }
    if (c === '{') { if (depth++ === 0) begin = i; }
    else if (c === '}') { if (--depth === 0 && begin >= 0) { try { result.push(JSON.parse(text.slice(begin, i + 1))); } catch { throw apiError(502, 'invalid_dialogue', 'The date returned damaged dialogue.'); } if (result.length > 2) throw apiError(502, 'invalid_dialogue', 'The date returned too many speakers.'); } }
    else if (c === ']' && depth === 0) return result;
  }
  return result;
}

export function validateCommand(value: unknown): DinnerCommand {
  if (!object(value) || typeof value.type !== 'string') throw apiError(400, 'invalid_command', 'Invalid scene command.');
  if (value.type === 'move' && exactKeys(value, ['type', 'x', 'z', 'yaw']) && [value.x, value.z, value.yaw].every(x => typeof x === 'number' && Number.isFinite(x))) return value as unknown as DinnerCommand;
  if (value.type === 'pause' && exactKeys(value, ['type', 'paused']) && typeof value.paused === 'boolean') return value as unknown as DinnerCommand;
  if (value.type === 'scenario' && exactKeys(value, ['type', 'choice']) && typeof value.choice === 'string' && value.choice.length > 0 && value.choice.length < 80) return value as unknown as DinnerCommand;
  if (value.type === 'finish' && exactKeys(value, ['type'])) return { type: 'finish' };
  if (value.type === 'tabletop' && exactKeys(value, ['type', 'action']) && (TABLETOP_ACTIONS as readonly unknown[]).includes(value.action)) return value as unknown as DinnerCommand;
  if (value.type === 'interact' && exactKeys(value, ['type', 'target', 'choice']) && (INTERACTION_TARGETS as readonly unknown[]).includes(value.target) && (value.choice === undefined || (typeof value.choice === 'string' && value.choice.length < 120))) return value as unknown as DinnerCommand;
  if (value.type === 'evening' && exactKeys(value, ['type', 'action', 'choice']) && (EVENING_ACTIONS as readonly unknown[]).includes(value.action) && (value.choice === undefined || typeof value.choice === 'string' && value.choice.length < 120)) return value as unknown as DinnerCommand;
  throw apiError(400, 'invalid_command', 'Invalid scene command.');
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw apiError(415, 'content_type', 'Send application/json.');
  if (Number(req.headers['content-length'] || 0) > 48 * 1024) { req.resume(); throw apiError(413, 'body_limit', 'This request is too large.'); }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { const b = Buffer.from(chunk); length += b.length; if (length > 48 * 1024) throw apiError(413, 'body_limit', 'This request is too large.'); chunks.push(b); }
  let data: unknown; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw apiError(400, 'invalid_json', 'Invalid JSON request.'); }
  if (!object(data)) throw apiError(400, 'invalid_json', 'Expected a JSON object.'); return data;
}
function json(res: ServerResponse, status: number, value: unknown) { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); }
function errorResponse(res: ServerResponse, error: unknown) {
  const e = error instanceof DateApiError ? error : apiError(500, 'server_error', 'The date service had a problem. Please try again.');
  if (res.headersSent) { if (!res.destroyed && !res.writableEnded) res.end(); } else json(res, e.status, { error: e.message, message: e.message, code: e.code });
}
const costOf = (model: ClaudeModel, u: TokenUsage) => { const r = MODEL_RATES[model]; return (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite) / 1e6; };

export async function attachRestaurantServer(_http: Server, opts: RestaurantOptions = {}) {
  await RAPIER.init();
  const env = opts.env ?? process.env, now = opts.now ?? Date.now;
  const hordeDefault = env.DATE_CONVERSATION_PROVIDER === 'aihorde';
  const hordeEarned = env.DATE_EARNED_PROVIDER === 'aihorde';
  const hordeConfigured = hordeDefault || hordeEarned || env.DATE_ALLOW_MODEL_SELECTION === '1' || !!opts.horde;
  const anthropic = opts.claude ?? anthropicAdapter(env), dolphin = opts.dolphin ?? openRouterAdapter(env), directDolphin = opts.dolphinLlm ?? dolphinLlmAdapter(env), horde = opts.horde ?? hordeAdapter({ ...env, DATE_EARNED_PROVIDER: 'aihorde', AI_HORDE_TRANSPORT: env.AI_HORDE_TRANSPORT || 'native' });
  const anthropicConfigured = !!env.ANTHROPIC_API_KEY || !!opts.claude, dolphinConfigured = !hordeDefault && !hordeEarned && (!!env.OPENROUTER_API_KEY || !!opts.dolphin);
  const directDolphinConfigured = !!env.DOLPHIN_LLM_API_KEY?.trim() || !!opts.dolphinLlm;
  const earnedModel = directDolphinConfigured ? DOLPHIN_LLM_MODEL : hordeEarned || (!dolphinConfigured && hordeConfigured) ? HORDE_MODEL : DOLPHIN_MODEL;
  const claude: ClaudeAdapter = { stream(request, signal) { return (request.model === DOLPHIN_LLM_MODEL ? directDolphin : request.model === HORDE_MODEL ? horde : request.model === DOLPHIN_MODEL ? dolphin : anthropic).stream(request, signal); } };
  // Only an explicitly configured legacy Horde route prewarms its worker list.
  // Enabling private model commands alone must not contact an unused provider.
  if (hordeDefault || hordeEarned) void horde.prepare?.().catch(() => {});
  // Injected adapters keep the legacy paid-accounting test contract unless the
  // caller explicitly asks to exercise free Edge accounting. Production always
  // defaults to Edge, even when an unused ElevenLabs key is still configured.
  const speechProvider = opts.speech && env.DATE_SPEECH_PROVIDER !== 'edge' ? 'elevenlabs' : env.DATE_SPEECH_PROVIDER === 'elevenlabs' ? 'elevenlabs' : env.DATE_SPEECH_PROVIDER === 'none' ? 'none' : 'edge';
  const speech = opts.speech ?? (speechProvider === 'edge' ? edgeSpeechAdapter() : elevenLabsAdapter(env));
  const sessionLimit = numberEnv(env, 'DATE_SESSION_LIMIT_USD', 2, .01, 100), dailyLimit = numberEnv(env, 'DATE_DAILY_LIMIT_USD', 10, .01, 1000);
  const maxTokens = Math.floor(numberEnv(env, 'DATE_MAX_OUTPUT_TOKENS', 700, 200, 1500)), timeoutMs = opts.requestTimeoutMs ?? numberEnv(env, 'DATE_REQUEST_TIMEOUT_MS', 25_000, 1000, 60_000);
  const timeoutFor = (model: ClaudeModel) => model === HORDE_MODEL ? opts.requestTimeoutMs ?? numberEnv(env, 'AI_HORDE_TIMEOUT_MS', 60_000, 1000, 120_000) : timeoutMs;
  const speechRate = speechProvider === 'edge' || speechProvider === 'none' ? 0 : numberEnv(env, 'DATE_SPEECH_COST_PER_1K', .04, .001, 10) / 1000;
  const development = opts.development ?? env.NODE_ENV !== 'production';
  const defaultModel: ClaudeModel = hordeDefault ? HORDE_MODEL : models[0];
  // An explicitly free server cannot be switched into a paid route by a client.
  const selectableModels = hordeDefault ? [HORDE_MODEL] : [...(development || env.DATE_ALLOW_MODEL_SELECTION === '1' ? models : [defaultModel]), ...(directDolphinConfigured ? [DOLPHIN_LLM_MODEL] : []), ...(dolphinConfigured ? [DOLPHIN_MODEL] : []), ...(hordeConfigured ? [HORDE_MODEL] : [])];
  const modelFor = (requested: ClaudeModel, state: DinnerState, context?: ConversationRoutingContext): ClaudeModel => {
    if (hordeDefault) {
      if (requested !== HORDE_MODEL) throw apiError(400, 'invalid_model', 'This server uses the free AI Horde conversation route.');
      return HORDE_MODEL;
    }
    const unlocked = state.phase === 'playing' && !!state.evening.chemistry?.unlocked && !state.evening.care.romanceClosed && !state.evening.farewell.ending;
    // Explicit provider selection never changes this couple's romantic progress.
    if (isEarnedModel(requested) && requested !== DOLPHIN_LLM_MODEL && !unlocked) throw apiError(409, requested === HORDE_MODEL ? 'horde_locked' : 'dolphin_locked', 'This date has not reached mutual chemistry yet.');
    if (unlocked && (directDolphinConfigured || hordeConfigured || dolphinConfigured) && requested === models[0] && context && needsAdultConversation(context)) return earnedModel;
    return requested;
  };
  const speechModel = speechProvider === 'edge' ? EDGE_MODEL : env.DATE_SPEECH_MODEL || 'eleven_v4_turbo';
  const speechVoice = (voice: keyof typeof EDGE_VOICES) => speechProvider === 'edge' ? env[`DATE_EDGE_VOICE_${voice.toUpperCase()}`] || EDGE_VOICES[voice] : env[`DATE_VOICE_${voice.toUpperCase()}`] || getDate(voice)?.voiceId || (voice === 'waiter' ? 'pNInz6obpgDQGcFmaJgB' : 'VR6AewLTigWG4xSOukaG');
  const speechRequest = (text: string, emotion: Emotion, voice: keyof typeof EDGE_VOICES): SpeechRequest => ({ text, emotion, voiceId: speechVoice(voice), model: speechModel, provider: speechProvider === 'none' ? 'elevenlabs' : speechProvider, ...(speechProvider === 'edge' ? { settings: edgeSettings(emotion) } : {}) });
  const speechCacheKey = (request: SpeechRequest) => createHash('sha256').update(JSON.stringify([request.provider, request.voiceId, request.model, request.emotion, request.text, speechText(request), request.settings ?? { outputFormat: 'mp3_44100_128' }])).digest('hex');
  const sessions = new Map<string, Session>(), audioCache = new Map<string, Buffer>(); let audioBytes = 0;
  const clipsDirectory = resolve(opts.clipsDirectory || resolve('server/restaurant/clips')); let clips: Clip[] = [];
  try { const parsed = JSON.parse(await readFile(resolve(clipsDirectory, 'manifest.json'), 'utf8')); if (Array.isArray(parsed.clips)) clips = parsed.clips.filter((c: any) => typeof c.id === 'string' && typeof c.text === 'string' && typeof c.voiceId === 'string' && typeof c.file === 'string' && typeof c.model === 'string' && EMOTIONS.includes(c.emotion)); } catch { /* Pre-generated clips are optional, never fabricated. */ }
  const clipForSpeech = (request: SpeechRequest) => clips.find(c => (c.provider ?? 'elevenlabs') === request.provider && c.text === request.text && c.emotion === request.emotion && c.voiceId === request.voiceId && c.model === request.model && (request.provider !== 'edge' || JSON.stringify(c.settings) === JSON.stringify(request.settings)));
  let daily = { day: new Date(now()).toISOString().slice(0, 10), spent: 0, reserved: 0 }, closed = false;
  const ledgerPath = opts.ledgerPath === false ? undefined : resolve(opts.ledgerPath || env.DATE_BUDGET_LEDGER_FILE || 'server/restaurant/runtime/budget.json');
  if (ledgerPath || opts.budgetStore) { try { const saved = opts.budgetStore ? await opts.budgetStore.load() : JSON.parse(await readFile(ledgerPath!, 'utf8')); if (saved && saved.day === daily.day && typeof saved.spent === 'number' && typeof saved.reserved === 'number' && Number.isFinite(saved.spent) && Number.isFinite(saved.reserved) && saved.spent >= 0 && saved.reserved >= 0) daily.spent = saved.spent + saved.reserved; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw apiError(503, 'budget_ledger', 'The saved AI budget ledger could not be read. Check the server runtime directory.'); } }
  let ledgerWrite: Promise<void> = Promise.resolve();
  const persistLedger = () => { if (!ledgerPath && !opts.budgetStore) return Promise.resolve(); const snapshot = { ...daily }; ledgerWrite = ledgerWrite.catch(() => {}).then(async () => { if (opts.budgetStore) { await opts.budgetStore.save(snapshot); return; } await mkdir(dirname(ledgerPath!), { recursive: true }); await writeFile(ledgerPath + '.tmp', JSON.stringify(snapshot)); await rename(ledgerPath + '.tmp', ledgerPath!); }); return ledgerWrite; };
  const refreshDay = () => { const day = new Date(now()).toISOString().slice(0, 10); if (day !== daily.day) daily = { day, spent: 0, reserved: 0 }; };
  const sessionAccount = (session: Session): RestaurantPaidAccount => ({ usage: session.scene.state.usage, sessionLimit: session.scene.state.sessionLimit, get reserved() { return session.reserved; }, set reserved(value) { session.reserved = value; } });
  const reserveAccount = async (account: RestaurantPaidAccount, amount: number) => { refreshDay(); if (account.usage.totalCost + account.reserved + amount > account.sessionLimit) throw apiError(402, 'session_limit', 'This date reached its spending limit. Raise the server limit for a new date, or continue without live voices.'); if (daily.spent + daily.reserved + amount > dailyLimit) throw apiError(402, 'daily_limit', 'The server reached its daily AI spending limit.'); account.reserved += amount; daily.reserved += amount; await persistLedger(); return daily.day; };
  const remainingReservation = (total: number, released: number) => { const remaining = Math.max(0, total - released); return remaining < Number.EPSILON * Math.max(1, total, released) ? 0 : remaining; };
  const settleAccount = (account: RestaurantPaidAccount, reserved: number, actual: number, day: string) => { account.reserved = remainingReservation(account.reserved, reserved); if (day === daily.day) daily.reserved = remainingReservation(daily.reserved, reserved); daily.spent += actual; void persistLedger().catch(() => {}); };
  const reserve = (session: Session, amount: number) => reserveAccount(sessionAccount(session), amount);
  const settle = (session: Session, reserved: number, actual: number, day: string) => settleAccount(sessionAccount(session), reserved, actual, day);
  // The last sixty entries (about thirty exchanges) stay verbatim, rendered as a plain transcript at send time;
  // the model's own notebook carries what came before. The byte cap measures the stored JSON, so it binds on
  // long speeches before the entry count does. Once anything has been dropped the window never starts on the
  // date's own line, and the model is told earlier talk is not shown (TRIMMED_NOTE) rather than that it just began.
  const boundHistory = (s: Session) => {
    let dropped = false;
    if (s.history.length > HISTORY_ENTRIES) { s.history = s.history.slice(-HISTORY_ENTRIES); dropped = true; }
    while (s.history.length > 2 && Buffer.byteLength(JSON.stringify(s.history), 'utf8') > HISTORY_BYTES) { s.history.shift(); dropped = true; }
    if (!dropped) return;
    while (s.history.length > 1 && s.history[0].role === 'assistant') s.history.shift();
    s.trimmed = true;
  };
  const updatePlaybackHistory = (s: Session, record: GenerationRecord) => {
    if (!record.lines.length) return;
    const content = JSON.stringify({ spokenResponse: record.lines.map(line => { const playback = record.playback.get(keyFor(line)); return { speaker: line.speaker, text: line.text, delivery: deliveryLabel(line.text, playback, record.interrupted), playedSeconds: playback?.playedSeconds ?? 0 }; }) });
    if (record.entry) record.entry.content = content;
    else { record.entry = { role: 'assistant', content }; s.history.push(record.entry); }
    boundHistory(s);
  };
  const commitHeardMemory = (s: Session, generation: number, record: GenerationRecord) => {
    const pending = record.pendingMemory;
    if (!pending || record.interrupted || generation !== s.generation || !pending.lines.length || new Set(pending.lines.map(keyFor)).size !== pending.lines.length || !pending.lines.every(line => record.playback.get(keyFor(line))?.completed)) return;
    s.scene.state.memory = mergeMemoryForDelivery(pending.value, s.scene.state.memory, true, pending.humanText);
    record.pendingMemory = undefined;
  };
  // Abandoning a reply that was still being written also ends the wait for it, so the evening does not stay hushed for a line that will never arrive.
  const invalidate = (s: Session) => { s.scene.director.boundaries.clearPending(); s.scene.director.chemistry.clearPending(); const old = s.generations.get(s.generation); if (old) { old.interrupted = true; updatePlaybackHistory(s, old); } if (s.controller) { s.controller.abort(); s.scene.director.replyEnded(); } s.controller = undefined; for (const c of s.speechControllers) c.abort(); // an abandoned reply no longer holds the table's silence
    s.speechControllers.clear(); s.allowed.clear(); s.generation++; s.scene.state.generation = s.generation; s.generations.set(s.generation, { lines: [], playback: new Map(), interrupted: false }); if (s.generations.size > 40) s.generations.delete(s.generations.keys().next().value!); };
  const captureCues = (s: Session, fromConversation = false) => {
    const fresh = s.scene.state.evening.cues.filter(cue => !s.capturedCues.has(cue.id));
    if (!fresh.length) return;
    // A new authored scene is newer than the pending model's context. Interrupt
    // that generation first, so its late completion cannot erase the scene's
    // memory or emotion, and its audio cannot outrank a health/boundary moment.
    // Social cues produced by this model completion belong to the valid turn.
    // Routine pacing (a plate arriving, a scripted aside) waits for the reply instead: the next
    // tick or the completed turn captures it, so the human's question is still answered.
    if (!fromConversation && s.controller) { if (fresh.every(cue => deferrableCue(cue.key))) return; invalidate(s); }
    const generation = s.generations.get(s.generation)!;
    for (const cue of fresh) {
      s.capturedCues.add(cue.id);
      for (const line of cue.utterances) {
        s.allowed.set(keyFor(line), line);
        if (!generation.lines.some(known => keyFor(known) === keyFor(line))) generation.lines.push(line);
      }
    }
  };
  const status = (): ProviderStatus => ({ claude: anthropicConfigured || dolphinConfigured || directDolphinConfigured || hordeConfigured, anthropic: anthropicConfigured, dolphin: dolphinConfigured || directDolphinConfigured, horde: hordeConfigured, conversationTimeoutMs: timeoutMs, hordeTimeoutMs: timeoutFor(HORDE_MODEL), speech: !!opts.speech || speechProvider === 'edge' || speechProvider === 'elevenlabs' && !!env.ELEVENLABS_API_KEY, speechProvider, speechModel, speechCostPer1K: speechRate * 1000, cachedSpeech: clips.some(clip => (clip.provider ?? 'elevenlabs') === (speechProvider === 'none' ? 'elevenlabs' : speechProvider) && clip.model === speechModel), development, models: selectableModels, defaultModel, sessionLimit, ...(!anthropicConfigured && !dolphinConfigured && !directDolphinConfigured && !hordeConfigured ? { message: 'Configure a server conversation key for live dialogue. Scene interactions and free voice options remain available.' } : {}) });
  function authorize(req: IncomingMessage, id: string) {
    const s = sessions.get(id); if (!s) throw apiError(404, 'session_missing', 'This date session is no longer available.');
    const token = (req.headers.authorization || '').replace(/^Bearer /, ''); const a = Buffer.from(tokenHash(token)), b = Buffer.from(s.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw apiError(401, 'unauthorized', 'This date requires its session token.'); s.touched = now(); return s;
  }
  const emit = (record: TurnRecord, event: TurnEvent) => { record.events.push(event); for (const res of record.subscribers) { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n'); } };
  const subscribe = (res: ServerResponse, record: TurnRecord, s: Session) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.flushHeaders();
    for (const event of record.events) res.write(JSON.stringify(event) + '\n');
    if (record.finished) return res.end();
    record.subscribers.add(res);
    res.on('close', () => { record.subscribers.delete(res); if (!record.finished && !record.subscribers.size && (!record.pending || record.pending.destroyed) && s.turns.get(s.activeTurn || '') === record) s.controller?.abort(); });
  };
  async function generate(s: Session, request: TurnRequest, record: TurnRecord, controller: AbortController, reservation: number, day: string, system: string, messages: { role: 'user' | 'assistant'; content: string }[], estimatedInput: number) {
    const generation = s.generation, started = now(); let text = '', emitted = 0, reportedInput = false, reportedOutput = false;
    const counts: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const timer = setTimeout(() => controller.abort(apiError(504, 'timeout', request.model === HORDE_MODEL ? 'The community AI queue took too long. Please try another turn shortly.' : 'The date took too long to respond. Please try again.')), timeoutFor(request.model));
    emit(record, { type: 'start', generation, model: request.model }); s.scene.state.usage.claudeRequests++;
    try {
      for await (const chunk of claude.stream({ model: request.model, system, messages, maxTokens }, controller.signal)) {
        if (controller.signal.aborted || generation !== s.generation) throw apiError(499, 'interrupted', 'Response interrupted.');
        if (chunk.type === 'usage') { Object.assign(counts, chunk.usage); reportedInput ||= chunk.usage.inputTokens !== undefined; reportedOutput ||= chunk.usage.outputTokens !== undefined && text.length > 0; }
        else {
          text += chunk.text; if (text.length > 12_000) throw apiError(502, 'invalid_dialogue', 'The date returned an oversized response.');
          const lines = completeUtterances(text);
          while (emitted < lines.length) { const index = emitted++; if (index > 0 && isSilentDialogueLine(lines[index], ['date', 'waiter', 'diner'])) continue; const u = validateUtterance(lines[index], index); enforceDateSpeechBudget([...s.generations.get(generation)!.lines, u]); s.allowed.set(keyFor(u), u); s.generations.get(generation)!.lines.push(u); emit(record, { type: 'utterance', generation, index, utterance: u }); }
        }
      }
      if (controller.signal.aborted || generation !== s.generation) throw apiError(499, 'interrupted', 'Response interrupted.');
      let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw apiError(502, 'invalid_dialogue', 'The date returned incomplete dialogue. Please try another turn.'); }
      const turn = validateTurn(parsed), genRecord = s.generations.get(generation)!;
      s.scene.applyTurn({ ...turn, memory: mergeMemoryForDelivery(turn.memory, s.scene.state.memory, false, request.text) }, request.text);
      genRecord.pendingMemory = { value: turn.memory, humanText: request.text, lines: turn.utterances.filter(line => line.speaker === 'date') };
      commitHeardMemory(s, generation, genRecord); captureCues(s, true); updatePlaybackHistory(s, genRecord);
      s.scene.state.usage.responseMs = now() - started;
    } catch (error) {
      const e = controller.signal.aborted ? controller.signal.reason instanceof DateApiError ? controller.signal.reason : apiError(499, 'interrupted', 'Response interrupted.') : error instanceof DateApiError ? error : apiError(502, 'claude_provider', 'The conversation could not finish this turn. Your date is still playable.');
      if (generation === s.generation) { s.allowed.clear(); for (const c of s.speechControllers) c.abort(); }
      const gen = s.generations.get(generation); if (gen) { gen.interrupted = true; updatePlaybackHistory(s, gen); }
      if (e.code === 'conversation_refusal' && !controller.signal.aborted && generation === s.generation) {
        const refused = [...s.history].reverse().find(entry => entry.role === 'user' && entry.content === request.text);
        if (refused) refused.content = '[A provider-limited topic was redirected back to dinner. No personal boundary strike occurred.]';
        s.scene.state.usage.responseMs = now() - started;
      }
      emit(record, { type: 'error', message: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
    } finally {
      clearTimeout(timer);
      // Usage received from Anthropic is authoritative. If an interrupted transport
      // withheld final accounting, retain a conservative estimate rather than free usage.
      if (!reportedInput && (text || controller.signal.aborted)) counts.inputTokens = estimatedInput;
      if (!reportedOutput && text) counts.outputTokens = Math.max(counts.outputTokens, Math.ceil(text.length / 3));
      const charged = costOf(request.model, counts), u = s.scene.state.usage;
      u.inputTokens += counts.inputTokens; u.outputTokens += counts.outputTokens; u.cacheReadTokens += counts.cacheReadTokens; u.cacheWriteTokens += counts.cacheWriteTokens; u.claudeCost += charged; u.totalCost = u.claudeCost + u.speechCost;
      settle(s, reservation, charged, day);
      if (s.controller === controller) { s.controller = undefined; s.activeTurn = undefined; s.scene.director.replyEnded(); }
      emit(record, { type: 'state', state: s.scene.snapshot() }); emit(record, { type: 'done', generation }); record.finished = true;
      for (const res of record.subscribers) if (!res.destroyed && !res.writableEnded) res.end(); record.subscribers.clear();
    }
  }

  async function streamSpeech(req: IncomingMessage, res: ServerResponse, s: Session, data: Record<string, unknown>) {
    if (!Number.isSafeInteger(data.generation) || data.generation !== s.generation || !object(data.utterance)) throw apiError(409, 'stale_generation', 'That line was interrupted.');
    if (data.utterance.speaker !== 'date') throw apiError(400, 'unknown_utterance', 'Only this date’s generated lines can be voiced.');
    const u = validateUtterance(data.utterance, data.utterance.speaker === 'date' ? 0 : 1);
    if (!s.allowed.has(keyFor(u))) throw apiError(400, 'unknown_utterance', 'Only this date’s generated lines can be voiced.');
    if (!s.generations.get(s.generation)?.lines.some(line => keyFor(line) === keyFor(u))) s.generations.get(s.generation)?.lines.push(u);
    if (s.scene.state.phase !== 'playing') throw apiError(409, 'inactive_session', 'Resume the date before playing a voice.');
    const request = speechRequest(u.text, u.emotion, u.speaker === 'date' ? s.scene.state.dateId : u.speaker as 'waiter' | 'diner');
    const cacheKey = speechCacheKey(request);
    let cached = audioCache.get(cacheKey);
    const clip = clipForSpeech(request);
    if (!cached && clip) { const path = resolve(clipsDirectory, clip.file); if (path.startsWith(clipsDirectory + sep)) { try { cached = await readFile(path); } catch {} } }
    if (cached) { s.scene.state.usage.cacheHits++; res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-speech-cache': clip ? 'clip' : 'hit' }); res.end(cached); return; }
    if (!status().speech) throw apiError(503, 'speech_unconfigured', 'Server character voices are disabled. Device voices and captions remain available.');
    if (s.speechControllers.size >= 2) throw apiError(429, 'speech_busy', 'Wait for the current character line to finish.');
    const requestedGeneration = s.generation;
    const amount = speechText(request).length * speechRate, day = amount ? await reserve(s, amount) : daily.day, controller = new AbortController(), chunks: Buffer[] = []; let total = 0, complete = false, billed = false;
    if (s.generation !== requestedGeneration || s.scene.state.phase !== 'playing' || s.speechControllers.size >= 2) { if (amount) settle(s, amount, 0, day); throw apiError(409, 'stale_generation', 'That line was interrupted before synthesis.'); }
    s.speechControllers.add(controller); const generation = s.generation, timer = setTimeout(() => controller.abort(), timeoutMs);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      billed = true; // Submitted characters are conservatively billed even if playback is canceled.
      for await (const bytes of speech.stream(request, controller.signal)) {
        if (controller.signal.aborted || generation !== s.generation) throw apiError(499, 'interrupted', 'Speech interrupted.');
        if (!res.headersSent) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store', 'x-speech-cache': 'miss' }); s.scene.state.usage.firstAudioMs = s.turnStarted ? now() - s.turnStarted : null; }
        const buffer = Buffer.from(bytes); total += buffer.length; if (total > 5 * 1024 * 1024) throw apiError(502, 'speech_limit', 'This audio line exceeded the size limit.'); chunks.push(buffer); if (!res.destroyed) res.write(buffer);
      }
      if (controller.signal.aborted || generation !== s.generation || !total) throw apiError(502, 'speech_empty', 'The voice service returned no complete audio.');
      complete = true;
      while (audioBytes + total > 32 * 1024 * 1024 && audioCache.size) { const first = audioCache.keys().next().value!; audioBytes -= audioCache.get(first)!.length; audioCache.delete(first); }
      audioCache.set(cacheKey, Buffer.concat(chunks)); audioBytes += total; if (!res.destroyed) res.end();
    } finally {
      clearTimeout(timer); controller.abort(); s.speechControllers.delete(controller); const actual = billed ? amount : 0;
      if (amount) settle(s, amount, actual, day); if (billed) { const usage = s.scene.state.usage; if (speechProvider !== 'edge' || total > 0) usage.speechCharacters += speechText(request).length; usage.speechCost += actual; usage.totalCost = usage.claudeCost + usage.speechCost; }
      if (!complete && res.headersSent && !res.destroyed) res.destroy();
    }
  }

  const services: RestaurantServices = {
    modelFor,
    status,
    now,
    createAccount(limit = sessionLimit) {
      if (!Number.isFinite(limit) || limit < .01) throw apiError(400, 'invalid_limit', 'Choose a positive room spending limit.');
      return { usage: emptyUsage(), sessionLimit: Math.min(sessionLimit, limit), reserved: 0 };
    },
    async *streamClaude(account, request, signal) {
      if (closed) throw apiError(503, 'server_closed', 'The date server is shutting down.');
      if (!status().claude) throw apiError(503, 'claude_unconfigured', 'Live conversation is unavailable. Scene interactions remain playable.');
      if (!selectableModels.includes(request.model)) throw apiError(400, 'invalid_model', 'That model is unavailable on this server.');
      const bounded = { ...request, maxTokens: Math.min(maxTokens, Math.max(200, request.maxTokens)) };
      const estimatedInput = Buffer.byteLength(bounded.system + JSON.stringify(bounded.messages) + (isEarnedModel(request.model) || request.model === HORDE_MODEL ? openRouterSchemaInstructions(request.outputSchema ?? TURN_SCHEMA) : ''), 'utf8') + 512;
      const amount = costOf(request.model, { inputTokens: estimatedInput, outputTokens: bounded.maxTokens, cacheReadTokens: 0, cacheWriteTokens: estimatedInput });
      const day = await reserveAccount(account, amount);
      if (signal.aborted || closed) { settleAccount(account, amount, 0, day); throw apiError(499, 'interrupted', 'Conversation interrupted.'); }
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutFor(request.model))]);
      const counts: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let text = '', reportedInput = false, reportedOutput = false;
      const started = now(); account.usage.claudeRequests++;
      try {
        for await (const chunk of claude.stream(bounded, combined)) {
          if (combined.aborted || closed) throw apiError(499, 'interrupted', 'Conversation interrupted.');
          if (chunk.type === 'usage') { Object.assign(counts, chunk.usage); reportedInput ||= chunk.usage.inputTokens !== undefined; reportedOutput ||= chunk.usage.outputTokens !== undefined && text.length > 0; }
          else { text += chunk.text; if (text.length > 16_000) throw apiError(502, 'invalid_dialogue', 'The response was too large.'); }
          yield chunk;
        }
      } finally {
        if (!reportedInput && (text || combined.aborted)) counts.inputTokens = estimatedInput;
        if (!reportedOutput && text) counts.outputTokens = Math.max(counts.outputTokens, Math.ceil(text.length / 3));
        const usage = account.usage, charged = costOf(request.model, counts);
        usage.inputTokens += counts.inputTokens; usage.outputTokens += counts.outputTokens;
        usage.cacheReadTokens += counts.cacheReadTokens; usage.cacheWriteTokens += counts.cacheWriteTokens;
        usage.claudeCost += charged; usage.totalCost = usage.claudeCost + usage.speechCost; usage.responseMs = now() - started;
        settleAccount(account, amount, charged, day);
      }
    },
    async *streamSpeech(account, data, signal) {
      if (closed || signal.aborted) throw apiError(499, 'interrupted', 'Speech interrupted.');
      if (!data.text.trim() || data.text.length > 420 || !EMOTIONS.includes(data.emotion)) throw apiError(400, 'invalid_speech', 'This line cannot be voiced.');
      const request = speechRequest(data.text, data.emotion, data.voice), voiceId = request.voiceId;
      const cacheKey = speechCacheKey(request);
      let cached = audioCache.get(cacheKey);
      const clip = clipForSpeech(request);
      if (!cached && clip) { const path = resolve(clipsDirectory, clip.file); if (path.startsWith(clipsDirectory + sep)) { try { cached = await readFile(path); } catch {} } }
      if (cached) { account.usage.cacheHits++; yield cached; return; }
      if (!status().speech) throw apiError(503, 'speech_unconfigured', 'Character voices are unavailable. Captions remain playable.');
      const amount = speechText(request).length * speechRate, day = amount ? await reserveAccount(account, amount) : daily.day;
      if (signal.aborted || closed) { if (amount) settleAccount(account, amount, 0, day); throw apiError(499, 'interrupted', 'Speech interrupted.'); }
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), chunks: Buffer[] = [];
      let total = 0, completed = false;
      try {
        for await (const bytes of speech.stream(request, combined)) {
          if (combined.aborted || closed) throw apiError(499, 'interrupted', 'Speech interrupted.');
          const chunk = Buffer.from(bytes); total += chunk.length;
          if (total > 5 * 1024 * 1024) throw apiError(502, 'speech_limit', 'The voice response exceeded its size limit.');
          chunks.push(chunk); yield chunk;
        }
        if (!total || combined.aborted) throw apiError(502, 'speech_empty', 'The voice service returned no complete audio.');
        completed = true;
      } finally {
        // Submitted characters remain billed when either listener barges in.
        if (speechProvider !== 'edge' || total > 0) account.usage.speechCharacters += speechText(request).length;
        account.usage.speechCost += amount; account.usage.totalCost = account.usage.claudeCost + account.usage.speechCost;
        if (amount) settleAccount(account, amount, amount, day);
        if (completed) {
          while (audioBytes + total > 32 * 1024 * 1024 && audioCache.size) { const first = audioCache.keys().next().value!; audioBytes -= audioCache.get(first)!.length; audioCache.delete(first); }
          audioCache.set(cacheKey, Buffer.concat(chunks)); audioBytes += total;
        }
      }
    },
  };

  async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (closed) throw apiError(503, 'server_closed', 'The date server is shutting down.');
    if (req.method === 'POST' && req.headers.origin) { let origin: URL; try { origin = new URL(req.headers.origin); } catch { throw apiError(403, 'origin', 'Invalid request origin.'); } if (origin.host !== req.headers.host) throw apiError(403, 'origin', 'Open the date on this server to use its API.'); }
    if (req.method === 'GET' && url.pathname === '/api/date/status') { json(res, 200, status()); return; }
    if (req.method === 'POST' && url.pathname === '/api/date/sessions') {
      if (sessions.size >= 100) throw apiError(429, 'session_capacity', 'The date server is full. Please try again shortly.');
      const data = await body(req), blindMode = data.mode === 'blind-date';
      if ((data.mode !== undefined && !['ai-date', 'blind-date'].includes(data.mode as string)) || (!blindMode && !getDate(String(data.dateId))) || (blindMode && data.dateId !== undefined) || (data.seed !== undefined && (!blindMode || typeof data.seed !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.seed))) || (data.model !== undefined && !selectableModels.includes(data.model as ClaudeModel)) || !exactKeys(data, ['dateId', 'model', 'sessionLimit', 'mode', 'seed'])) throw apiError(400, 'invalid_session', 'Select a valid date, mode and model.');
      if (data.sessionLimit !== undefined && (typeof data.sessionLimit !== 'number' || !Number.isFinite(data.sessionLimit) || data.sessionLimit < .01)) throw apiError(400, 'invalid_limit', 'Choose a positive session limit.');
      const blind = blindMode ? createBlindDate((data.seed as string | undefined) ?? randomBytes(16).toString('hex')) : undefined;
      const scene = new DinnerScene(blind?.dateId ?? data.dateId as DinnerState['dateId'], Math.min(sessionLimit, (data.sessionLimit as number | undefined) ?? sessionLimit), { storyRate: opts.storyRate, scenarioId: opts.scenarioId, ...(blind ? { blindDate: { seed: blind.seed }, variation: blind.traits.spontaneity % 3 } : {}) });
      const token = randomBytes(24).toString('hex');
      if (isEarnedModel(data.model) && data.model !== DOLPHIN_LLM_MODEL && data.model !== defaultModel) throw apiError(409, data.model === HORDE_MODEL ? 'horde_locked' : 'dolphin_locked', 'Start with Haiku and build mutual chemistry first.');
      const s: Session = { scene, token: tokenHash(token), model: (data.model as ClaudeModel) || defaultModel, generation: 0, speechControllers: new Set(), turns: new Map(), allowed: new Map(), generations: new Map(), capturedCues: new Set(), history: [], reserved: 0, touched: now(), turnStarted: 0 };
      s.generations.set(0, { lines: [], playback: new Map(), interrupted: false }); sessions.set(scene.state.id, s);
      captureCues(s);
      json(res, 201, { state: scene.snapshot(), token }); return;
    }
    const match = /^\/api\/date\/sessions\/([a-f0-9]{24})(?:\/(command|turn|interrupt|reset-model|speech|playback))?$/.exec(url.pathname);
    if (!match) throw apiError(404, 'route_missing', 'Unknown date endpoint.');
    const s = authorize(req, match[1]), route = match[2];
    if (!route && req.method === 'GET') { json(res, 200, { state: s.scene.snapshot() }); return; }
    if (req.method !== 'POST') throw apiError(405, 'method', 'Use POST for this date action.');
    if (route === 'interrupt') { invalidate(s); json(res, 200, { state: s.scene.snapshot() }); return; }
    const data = await body(req);
    if (route === 'reset-model') {
      if (!exactKeys(data, [])) throw apiError(400, 'invalid_model_reset', 'Reset the conversation model without extra options.');
      invalidate(s);
      s.model = defaultModel;
      s.scene.state.conversationModel = modelFor(defaultModel, s.scene.state);
      json(res, 200, { state: s.scene.snapshot() }); return;
    }
    if (route === 'playback') {
      if (!Number.isSafeInteger(data.generation) || typeof data.completed !== 'boolean' || typeof data.playedSeconds !== 'number' || !Number.isFinite(data.playedSeconds) || data.playedSeconds < 0 || data.playedSeconds > 300 || typeof data.text !== 'string' || !['date', 'waiter', 'diner'].includes(data.speaker as string) || !exactKeys(data, ['generation', 'speaker', 'text', 'completed', 'playedSeconds'])) throw apiError(400, 'invalid_playback', 'Invalid playback receipt.');
      const generation = s.generations.get(data.generation as number);
      let line = generation?.lines.find(line => line.speaker === data.speaker && line.text === data.text);
      if (!line && generation) { line = s.scene.state.evening.cues.flatMap(cue => cue.utterances).find(line => line.speaker === data.speaker && line.text === data.text); if (line) generation.lines.push(line); }
      if (!generation || !line) throw apiError(409, 'unknown_playback', 'That line does not belong to this date.');
      const old = generation.playback.get(keyFor(line)); generation.playback.set(keyFor(line), { completed: old?.completed || data.completed, playedSeconds: Math.max(old?.playedSeconds || 0, data.playedSeconds) }); updatePlaybackHistory(s, generation);
      if (data.completed) s.lastHeardAt = now();
      if (data.completed && !generation.interrupted && data.generation === s.generation) { s.scene.acknowledge(line); commitHeardMemory(s, data.generation as number, generation); }
      json(res, 200, { state: s.scene.snapshot() }); return;
    }
    if (route === 'command') {
      const command = validateCommand(data);
      try { s.scene.command(command, now()); } catch (e) { throw apiError(409, 'scene_action', e instanceof Error ? e.message : 'That action is not available.'); }
      if (command.type === 'pause') s.lastHeardAt = undefined; // time spent paused is not a quiet table
      if (s.scene.state.phase !== 'playing') invalidate(s); captureCues(s); json(res, 200, { state: s.scene.snapshot() }); return;
    }
    if (route === 'speech') { await streamSpeech(req, res, s, data); return; }
    if (route !== 'turn') throw apiError(404, 'route_missing', 'Unknown date endpoint.');
    if (typeof data.turnId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.turnId) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2000 || !selectableModels.includes(data.model as ClaudeModel) || !exactKeys(data, ['turnId', 'text', 'model', 'via']) || (data.via !== undefined && data.via !== 'voice' && data.via !== 'typed')) throw apiError(400, 'invalid_turn', 'Use a short transcript, unique turn ID, and supported Claude model.');
    const request = { turnId: data.turnId, text: data.text.trim(), model: data.model, ...(data.via ? { via: data.via } : {}) } as TurnRequest, fingerprint = JSON.stringify([request.text, request.model]);
    const existing = s.turns.get(request.turnId);
    if (existing) { if (existing.fingerprint !== fingerprint) throw apiError(409, 'turn_conflict', 'This turn ID already contains another transcript.'); subscribe(res, existing, s); return; }
    if (s.scene.state.phase !== 'playing') throw apiError(409, 'inactive_session', 'Resume your date before speaking.');
    if (!scenePresenceAvailable(s.scene.state)) throw apiError(409, 'date_away', 'Give your date time to return to the table.');
    if (!status().claude) throw apiError(503, 'claude_unconfigured', 'Add ANTHROPIC_API_KEY to enable live conversation.');
    if (s.turns.size >= 250) throw apiError(429, 'turn_limit', 'This date reached its conversation limit. Start another date to continue.');
    s.scene.state.memory = retireSharedPremise(s.scene.state.memory, request.text);
    request.model = modelFor(request.model, s.scene.state, { text: request.text, recentTurns: s.history });
    s.scene.state.conversationModel = request.model;
    const previous = s.generations.get(s.generation); if (previous) updatePlaybackHistory(s, previous);
    const scene = s.scene.snapshot(), system = soloSystem({ dateId: scene.dateId, blindDate: scene.blindDate, model: request.model });
    const recentDelivered = [...s.generations.values()].flatMap(generation => generation.lines.filter(line => generation.playback.get(keyFor(line))?.completed)).slice(-8);
    const date = getDate(scene.dateId)!.name, e = scene.evening;
    // How the words arrived. The date's last reply is the generation the previous human turn opened (an interrupt
    // before this turn has already moved on to a new, empty one): was it cut off mid-line, or never heard at all?
    const replied = s.replyGeneration === undefined ? undefined : s.generations.get(s.replyGeneration), spoken = replied?.lines.filter(line => line.speaker === 'date') ?? [];
    const progress = (line: SceneUtterance) => replied?.playback.get(keyFor(line));
    const cutOff = spoken.filter(line => { const p = progress(line); return !!p && !p.completed && p.playedSeconds > 0; }).at(-1);
    const lastDateLine = [...s.generations.values()].flatMap(generation => generation.lines.filter(line => line.speaker === 'date').map(line => ({ line, heard: !!generation.playback.get(keyFor(line))?.completed }))).at(-1);
    const quiet = s.lastHeardAt === undefined ? 0 : Math.round((now() - s.lastHeardAt) / 1000);
    const keptTalking = s.replyGeneration !== undefined && !cutOff && spoken.every(line => !progress(line)?.completed && !progress(line)?.playedSeconds);
    const flow: TurnFlow = {
      ...(cutOff ? { talkedOver: { heard: heardPrefix(cutOff.text, progress(cutOff)!.playedSeconds) } } : {}),
      ...(keptTalking ? { keptTalking: true } : {}),
      // A quiet table is one where nobody was speaking; talking over a line or past a reply that never played is the opposite.
      ...(quiet >= QUIET_GAP_SECONDS && !cutOff && !keptTalking ? { quietSeconds: quiet } : {}),
      pendingQuestion: s.scene.director.pendingQuestion,
      ...(lastDateLine?.heard ? { lastDateLine: lastDateLine.line.text } : {}),
    };
    const note = turnNote({ scene, dateName: date, humanText: request.text, via: request.via, tableNow: tableNow(scene, date), memory: scene.memory, facts: tableFacts(s.scene.state), agenda: s.scene.director.agenda.promptContext(), boundaries: s.scene.director.boundaries.promptContext(), avoid: dialogueLoopContext(recentDelivered, request.text).avoidUnpromptedTopics, mechanics: scenarioMechanicsContext(scene), scenario: e.scenario, recentDelivered, flow, previousHuman: s.history.filter(entry => entry.role === 'user').slice(-3).map(entry => entry.content) });
    const messages = conversationMessages(s.history, !!s.trimmed, date, note);
    // One token per UTF-8 byte plus framing is a conservative upper bound even
    // for non-English transcripts; characters/4 would under-reserve some scripts.
    const estimatedInput = Buffer.byteLength(system + JSON.stringify(messages) + (isEarnedModel(request.model) || request.model === HORDE_MODEL ? openRouterSchemaInstructions(TURN_SCHEMA) : ''), 'utf8') + 512, reservation = costOf(request.model, { inputTokens: estimatedInput, outputTokens: maxTokens, cacheReadTokens: 0, cacheWriteTokens: estimatedInput });
    const record: TurnRecord = { fingerprint, events: [], subscribers: new Set(), finished: false, pending: res }; s.turns.set(request.turnId, record);
    // Claim the turn before the persistence await. Otherwise a pause/interrupt
    // during disk I/O could be followed by an unwanted paid request.
    invalidate(s); const generation = s.generation, controller = new AbortController(); s.controller = controller; s.activeTurn = request.turnId; s.turnStarted = now();
    const releaseOwnership = () => { if (s.controller === controller) { s.controller = undefined; s.activeTurn = undefined; } };
    res.on('close', () => { if (!record.finished && !record.subscribers.size && s.controller === controller) controller.abort(); });
    let day: string;
    try { day = await reserve(s, reservation); }
    catch (error) { releaseOwnership(); record.pending = undefined; const e = error instanceof DateApiError ? error : apiError(503, 'budget_ledger', 'The AI budget ledger could not be saved.'); emit(record, { type: 'error', message: e.message, code: e.code }); record.finished = true; for (const subscriber of record.subscribers) subscriber.end(); record.subscribers.clear(); throw e; }
    if (controller.signal.aborted || generation !== s.generation || !scenePresenceAvailable(s.scene.state) || closed) { releaseOwnership(); record.pending = undefined; settle(s, reservation, 0, day); const e = apiError(409, 'interrupted', 'This turn was interrupted before the provider request started.'); emit(record, { type: 'error', message: e.message, code: e.code }); record.finished = true; for (const subscriber of record.subscribers) subscriber.end(); record.subscribers.clear(); throw e; }
    s.history.push({ role: 'user', content: request.text }); boundHistory(s); s.replyGeneration = generation; s.lastHeardAt = now(); s.scene.director.noteHumanTurn(request.text);
    record.pending = undefined; if (!res.destroyed) subscribe(res, record, s);
    void generate(s, request, record, controller, reservation, day, system, messages, estimatedInput);
  }
  let last = now();
  const tick = (elapsed?: number, current = now()) => {
    if (closed) return;
    const dt = Math.max(0, Math.min(.1, elapsed ?? (current - last) / 1000)); last = current;
    for (const [id, s] of sessions) {
      if (current - s.touched > 60 * 60 * 1000) { invalidate(s); s.scene.free(); sessions.delete(id); continue; }
      const wasPlaying = s.scene.state.phase === 'playing'; s.scene.step(dt, current); if (wasPlaying && s.scene.state.phase === 'ended') invalidate(s); captureCues(s);
    }
  };
  const timer = opts.autoTick === false ? undefined : setInterval(() => tick(), 1000 / 60);
  timer?.unref();
  return {
    services,
    tick,
    handle(req: IncomingMessage, res: ServerResponse): boolean { const url = new URL(req.url || '/', 'http://localhost'); if (!url.pathname.startsWith('/api/date/')) return false; void dispatch(req, res, url).catch(e => errorResponse(res, e)); return true; },
    async close() { closed = true; if (timer) clearInterval(timer); for (const s of sessions.values()) { invalidate(s); s.scene.free(); } sessions.clear(); audioCache.clear(); await ledgerWrite.catch(() => {}); },
  };
}
