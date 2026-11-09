import { WebSocket, type ClientOptions } from 'ws';
import type { ClaudeModel, SceneUtterance } from '../../src/restaurant/types';
import { AGENDA_SCHEMA } from './agendas';
import { BOUNDARY_SCHEMA } from './boundaries';

export class DateApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: { field: string; index?: number }) { super(message); } }
export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
export type ClaudeChunk = { type: 'text'; text: string } | { type: 'usage'; usage: Partial<TokenUsage> };
export interface ClaudeRequest { model: ClaudeModel; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens: number; outputSchema?: Record<string, unknown> }
export interface ClaudeAdapter { prepare?(): Promise<void>; stream(request: ClaudeRequest, signal: AbortSignal): AsyncIterable<ClaudeChunk> }
export type SpeechProvider = 'edge' | 'elevenlabs' | 'none';
export interface SpeechSettings { rate: string; pitch: string; volume: string; outputFormat: string }
export interface SpeechRequest { text: string; voiceId: string; model: string; emotion: SceneUtterance['emotion']; provider?: SpeechProvider; settings?: SpeechSettings }
export interface SpeechAdapter { stream(request: SpeechRequest, signal: AbortSignal): AsyncIterable<Uint8Array> }

const usage = (raw: Record<string, unknown>): Partial<TokenUsage> => {
  const result: Partial<TokenUsage> = {};
  for (const [source, target] of [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['cache_read_input_tokens', 'cacheReadTokens'], ['cache_creation_input_tokens', 'cacheWriteTokens']] as const) {
    const value = raw[source]; if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[target] = value;
  }
  return result;
};

/** The wire grammar supports minItems 0/1, but not upper array bounds. Keep the
 * original schema and server validation intact; do not mutate caller-owned schemas. */
export function anthropicOutputSchema(source: Record<string, unknown>): Record<string, unknown> {
  const schema = structuredClone(source);
  const visit = (node: Record<string, unknown>) => {
    delete node.maxItems;
    if (typeof node.minItems === 'number' && node.minItems > 1) node.minItems = 1;
    for (const key of ['properties', '$defs', 'definitions']) {
      const entries = node[key];
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        for (const child of Object.values(entries)) if (child && typeof child === 'object' && !Array.isArray(child)) visit(child as Record<string, unknown>);
      }
    }
    const items = node.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) visit(items as Record<string, unknown>);
    for (const key of ['anyOf', 'allOf', 'oneOf']) {
      if (Array.isArray(node[key])) for (const child of node[key]) if (child && typeof child === 'object' && !Array.isArray(child)) visit(child as Record<string, unknown>);
    }
  };
  visit(schema);
  return schema;
}

/** Text remains text through Claude. Speech is handled by a separate ElevenLabs connection. */
export function anthropicAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  return { async *stream(request, signal) {
    if (!request.model.startsWith('claude-')) throw new DateApiError(400, 'invalid_model', 'That model uses a different conversation provider.');
    if (!env.ANTHROPIC_API_KEY) throw new DateApiError(503, 'claude_unconfigured', 'Add ANTHROPIC_API_KEY to enable live conversation.');
    const override = request.model === 'claude-haiku-5-5' ? env.DATE_HAIKU_MODEL : env.DATE_SONNET_MODEL;
    const response = await fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: override || request.model, max_tokens: request.maxTokens, stream: true,
        thinking: request.model === 'claude-sonnet-5-5' ? { type: 'between_tools' } : { type: 'disabled' },
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }], messages: request.messages,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: anthropicOutputSchema(request.outputSchema ?? TURN_SCHEMA) } } }) });
    if (!response.ok || !response.body) {
      // Classify billing/access/configuration failures without returning upstream text or secrets.
      let detail = '';
      try {
        const error = await response.json() as { error?: { message?: unknown } };
        if (typeof error.error?.message === 'string') detail = error.error.message.toLowerCase();
      } catch { await response.body?.cancel().catch(() => {}); }
      if (response.status === 400 && /credit balance|insufficient.{0,20}credits|billing.{0,30}(?:credit|balance)/.test(detail)) {
        throw new DateApiError(402, 'claude_credits', 'Anthropic reports that the API credit balance is too low. Add API credits in Claude Console billing, then try again.');
      }
      if ((response.status === 400 || response.status === 404) && /model.{0,80}(?:not found|not exist|not available|unsupported|invalid)|(?:unsupported|invalid).{0,30}model/.test(detail)) {
        throw new DateApiError(502, 'claude_model', 'Anthropic could not use the configured model. Check this API account’s model access.');
      }
      if (response.status === 400) {
        const field = ['thinking', 'output_config', 'json_schema', 'max_tokens', 'cache_control'].find(name => detail.includes(name));
        if (field) throw new DateApiError(502, 'claude_request', `Anthropic rejected the ${field} request setting. The game’s provider configuration needs attention.`);
      }
      throw new DateApiError(response.status === 429 ? 429 : 502, 'claude_provider', response.status === 401 || response.status === 403 ? 'Claude rejected the server API key or model access. Check your Anthropic API account.' : response.status === 429 ? 'Claude is rate limited or out of API credits. Try again shortly.' : `Claude is unavailable (HTTP ${response.status}). Your date is still here.`);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', stopReason: string | undefined, stopped = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    function* consume(raw: string): Generator<ClaudeChunk> {
      const line = raw.trimEnd();
      if (!line.startsWith('data:')) return;
      let parsed: unknown;
      try { parsed = JSON.parse(line.slice(5).trimStart()); } catch { throw new DateApiError(502, 'claude_stream', 'Claude returned an unreadable stream. Please try another turn.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DateApiError(502, 'claude_stream', 'Claude returned an unreadable stream. Please try another turn.');
      const data = parsed as Record<string, any>;
      if (data.type === 'error') throw new DateApiError(502, 'claude_provider', 'Claude interrupted the response. Please try another turn.');
      if (data.type === 'message_start' && data.message?.usage) yield { type: 'usage', usage: usage(data.message.usage) };
      if (data.type === 'message_delta' && data.usage) yield { type: 'usage', usage: usage(data.usage) };
      if (data.type === 'message_delta' && data.delta?.stop_reason != null) {
        const reason = data.delta.stop_reason;
        if (reason === 'refusal') throw new DateApiError(422, 'conversation_refusal', 'This conversation needs a different direction.');
        if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') throw new DateApiError(502, 'claude_truncated', 'Claude could not finish this response within its limits. Please try another turn.');
        if (reason !== 'end_turn' && reason !== 'stop_sequence') throw new DateApiError(502, 'claude_stream', 'Claude could not complete this response. Please try another turn.');
        stopReason = reason;
      }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') yield { type: 'text', text: data.delta.text };
      if (data.type === 'message_stop') stopped = true;
    }
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read(); signal.throwIfAborted();
        buffer += decoder.decode(next.value, { stream: !next.done });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          signal.throwIfAborted();
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          yield* consume(line);
          if (stopped) break;
        }
        if (stopped) break;
        if (buffer.length > 64 * 1024) throw new DateApiError(502, 'claude_stream', 'Claude returned an oversized stream frame.');
        if (next.done) { if (buffer.trim()) yield* consume(buffer); break; }
      }
      if (!stopped || !stopReason) throw new DateApiError(502, 'claude_stream', 'Claude returned an incomplete stream. Please try another turn.');
    } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
  } };
}

export const EMOTIONS = ['neutral', 'amused', 'warm', 'flirtatious', 'embarrassed', 'annoyed', 'angry', 'defensive', 'surprised'] as const;
export const ACTIONS = ['follow', 'sit', 'order', 'reassure', 'finish', 'none'] as const;
export const SOCIAL_SIGNALS = ['none', 'kindness', 'curiosity', 'humor', 'pressure', 'repair'] as const;
/** A silent optional cast placeholder conveys no speech. Never relax primary,
 * speaker, emotion, shape or nonempty-line limits when normalizing one away. */
export function isSilentDialogueLine(value: unknown, speakers: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const line = value as Record<string, unknown>;
  return Object.keys(line).length === 3 && Object.keys(line).every(key => ['speaker', 'text', 'emotion'].includes(key))
    && typeof line.speaker === 'string' && speakers.includes(line.speaker)
    && typeof line.text === 'string' && !line.text.trim() && EMOTIONS.includes(line.emotion as any);
}
export const TURN_SCHEMA = { type: 'object', additionalProperties: false, required: ['utterances', 'emotion', 'action', 'memory', 'social', 'agenda'], properties: {
  utterances: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['speaker', 'text', 'emotion'], properties: { speaker: { type: 'string', enum: ['date', 'waiter', 'diner'] }, text: { type: 'string' }, emotion: { type: 'string', enum: EMOTIONS } } } },
  emotion: { type: 'string', enum: EMOTIONS }, action: { type: 'string', enum: ACTIONS }, memory: { type: 'string' },
  social: { type: 'object', additionalProperties: false, required: ['signal', 'reason', 'wantsToLeave', 'boundary'], properties: { signal: { type: 'string', enum: SOCIAL_SIGNALS }, reason: { type: 'string' }, wantsToLeave: { type: 'boolean' }, boundary: BOUNDARY_SCHEMA } },
  agenda: AGENDA_SCHEMA,
} };

const emotionTags: Record<SceneUtterance['emotion'], string> = { neutral: '', amused: '[amused]', warm: '[warmly]', flirtatious: '[playful]', embarrassed: '[hesitant]', annoyed: '[annoyed]', angry: '[angry]', defensive: '[defensive]', surprised: '[surprised]' };
export const speechText = (request: SpeechRequest) => request.provider === 'edge'
  ? request.text.replace(/\[(?:neutral|amused|warm|warmly|flirtatious|playful|embarrassed|hesitant|annoyed|angry|defensive|surprised|laughs?|sighs?)\]/gi, '').trim()
  : `${emotionTags[request.emotion]} ${request.text.replace(/[\[\]]/g, '')}`.trim();

/** v4 Turbo requires Text-to-Dialogue and exactly one registered voice per connection. */
export function elevenLabsAdapter(env: NodeJS.ProcessEnv = process.env, createSocket: (url: URL, options: ClientOptions) => WebSocket = (url, options) => new WebSocket(url, options)): SpeechAdapter {
  return { async *stream(request, signal) {
    if (!env.ELEVENLABS_API_KEY) throw new DateApiError(503, 'speech_unconfigured', 'Add ELEVENLABS_API_KEY for character voices. Captions remain available.');
    if (signal.aborted) throw signal.reason;
    const url = new URL('wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input'); url.searchParams.set('model_id', request.model); url.searchParams.set('output_format', 'mp3_44100_128');
    const ws = createSocket(url, { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, handshakeTimeout: 12_000, maxPayload: 2 * 1024 * 1024 });
    const chunks: Uint8Array[] = []; let final = false, failure: Error | undefined, wake: (() => void) | undefined, total = 0;
    const notify = () => { wake?.(); wake = undefined; };
    const abort = () => { failure = new DateApiError(499, 'interrupted', 'Speech interrupted.'); ws.terminate(); notify(); };
    signal.addEventListener('abort', abort, { once: true });
    ws.on('open', () => { if (signal.aborted) return abort(); ws.send(JSON.stringify({ voices: [request.voiceId] })); ws.send(JSON.stringify({ inputs: [{ text: speechText(request), voice_id: request.voiceId, new_turn: true }], flush: true })); ws.send(JSON.stringify({ close_socket: true })); });
    ws.on('message', data => {
      try {
        const frame = JSON.parse(data.toString());
        if (frame.error || frame.type === 'error') { failure = new DateApiError(502, 'speech_provider', 'ElevenLabs could not voice this line. Check credits, voice access, and API key.'); ws.close(); }
        if (typeof frame.audio === 'string') { const chunk = Buffer.from(frame.audio, 'base64'); total += chunk.byteLength; if (total > 5 * 1024 * 1024) throw new Error('audio limit'); chunks.push(chunk); }
        if (frame.is_final === true) { final = true; ws.close(); }
      } catch { failure = new DateApiError(502, 'speech_stream', 'The voice service returned invalid audio.'); ws.terminate(); }
      notify();
    });
    ws.on('error', () => { failure = new DateApiError(502, 'speech_provider', 'The voice service could not connect. Captions remain available.'); notify(); });
    ws.on('close', () => { if (!final && !failure) failure = new DateApiError(502, 'speech_stream', 'The voice service stopped before the line was complete.'); notify(); });
    try {
      for (;;) {
        while (chunks.length) yield chunks.shift()!;
        if (failure) throw failure;
        if (final) break;
        await new Promise<void>(resolve => { wake = resolve; });
      }
    } finally { signal.removeEventListener('abort', abort); if (ws.readyState !== WebSocket.CLOSED) ws.terminate(); }
  } };
}
