import { HORDE_MODEL } from '../../src/restaurant/types';
import { hordeNativeAdapter } from './horde-native';
import { openRouterSchemaInstructions } from './openrouter';
import { DateApiError, type ClaudeAdapter, type ClaudeChunk, type ClaudeRequest, type TokenUsage } from './providers';

export const DEFAULT_HORDE_MODEL = 'koboldcpp/G4-MeroMero-26B-A4B-it-uncensored-heretic';
/** Grow to an eligible worker's context limit without dropping conversation turns. */
export const HORDE_BRIDGE_CONTEXT_FIT = 'grow';
const endpoint = 'https://oai.aihorde.net/v1/chat/completions';
const maxFrameCharacters = 64 * 1024;
const maxStreamBytes = 4 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const interrupted = () => new DateApiError(499, 'interrupted', 'Conversation interrupted.');
const streamError = () => new DateApiError(502, 'horde_stream', 'AI Horde returned an unreadable or incomplete response. Please try another turn.');

function tokenUsage(raw: Record<string, unknown>): Partial<TokenUsage> {
  const result: Partial<TokenUsage> = {};
  const details = record(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined;
  if (count(raw.prompt_tokens)) {
    const cached = details?.cached_tokens;
    const cacheRead = count(cached) && cached <= raw.prompt_tokens ? cached : 0;
    result.inputTokens = raw.prompt_tokens - cacheRead;
    if (count(cached) && cached <= raw.prompt_tokens) result.cacheReadTokens = cached;
  }
  if (count(raw.completion_tokens)) result.outputTokens = raw.completion_tokens;
  return result;
}

/** Use stable codes only: volunteer workers' error text may contain private dialogue. */
function providerError(status: number, error?: unknown): DateApiError {
  const code = record(error) && typeof error.code === 'string' ? error.code : '';
  if (['content_policy_violation', 'content_filter', 'refusal'].includes(code)) return new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
  if (status === 401 || code === 'InvalidAPIKey') return new DateApiError(502, 'horde_auth', 'AI Horde rejected the server API key. Check AI_HORDE_API_KEY.');
  if (code === 'KudosUpfront') return new DateApiError(503, 'horde_kudos', 'AI Horde needs more queue priority for this request. Please try another turn later.');
  if (status === 429 || ['TooManyPrompts', 'TimeoutIP', 'rate_limit_exceeded'].includes(code)) return new DateApiError(429, 'horde_rate_limit', 'AI Horde is busy or rate limited. Please try another turn shortly.');
  if (status === 408 || status === 504 || ['ChatRequestTimeout', 'wait_budget_exceeded', 'request_timeout'].includes(code)) return new DateApiError(504, 'horde_timeout', 'AI Horde took too long to respond. Please try another turn.');
  if (code === 'PromptExceedsContext') return new DateApiError(503, 'horde_context', 'AI Horde could not fit this conversation within an available worker’s context. Try a shorter message or another model.');
  if (status === 404 || ['model_not_found', 'no_eligible_worker', 'no_worker_supports_features'].includes(code)) return new DateApiError(503, 'horde_model', 'No AI Horde worker can serve the configured model and response settings right now.');
  if (status === 400 || status === 422) return new DateApiError(502, 'horde_request', 'AI Horde rejected the request settings. The server configuration needs attention.');
  if (status === 403) return new DateApiError(502, 'horde_access', 'AI Horde denied this request. Check the server account settings.');
  return new DateApiError(status === 503 ? 503 : 502, 'horde_provider', 'AI Horde is unavailable. Your date is still here.');
}

/** One volunteer-hosted request; no retry, model substitution or paid fallback. */
export function hordeAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  if (env.AI_HORDE_TRANSPORT === 'native') return hordeNativeAdapter(env, fetcher);
  return { async *stream(request: ClaudeRequest, signal: AbortSignal) {
    if (signal.aborted) throw interrupted();
    if (request.model !== HORDE_MODEL) throw new DateApiError(400, 'horde_model', 'Select the configured AI Horde conversation route.');
    if (env.DATE_EARNED_PROVIDER !== 'aihorde' && env.DATE_CONVERSATION_PROVIDER !== 'aihorde') throw new DateApiError(503, 'horde_unconfigured', 'Enable the AI Horde conversation option on the server.');
    if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 16) throw new DateApiError(400, 'horde_request', 'Choose a valid conversation response length.');
    const model = env.AI_HORDE_MODEL?.trim() || DEFAULT_HORDE_MODEL;
    const key = env.AI_HORDE_API_KEY?.trim() || '0000000000';
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: 'POST', signal,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'X-Title': 'Table for Two' },
        body: JSON.stringify({ model, max_tokens: Math.min(512, request.maxTokens), stream: true,
          stream_options: { include_usage: true }, response_format: { type: 'json_object' }, reasoning_effort: 'none',
          horde: { conformance: 'best_effort', include_reasoning: false, context_fit: HORDE_BRIDGE_CONTEXT_FIT, trusted_workers: true, validated_backends: true, availability_mode: 'fail_fast' },
          messages: [{ role: 'system', content: `${request.system}\n${openRouterSchemaInstructions(request.outputSchema)}` }, ...request.messages] }) });
    } catch {
      if (signal.aborted) throw interrupted();
      throw providerError(502);
    }
    if (signal.aborted) { await response.body?.cancel().catch(() => {}); throw interrupted(); }
    if (!response.ok) {
      let error: unknown;
      try { const body: unknown = await response.json(); if (record(body)) error = body.error; } catch { await response.body?.cancel().catch(() => {}); }
      if (signal.aborted) throw interrupted();
      throw providerError(response.status, error);
    }
    if (!response.body) throw streamError();

    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', eventData: string[] = [], eventCharacters = 0, streamBytes = 0, doneMarker = false, terminal = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    function* frame(data: string): Generator<ClaudeChunk> {
      if (data.trim() === '[DONE]') { doneMarker = true; return; }
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw streamError(); }
      if (!record(value)) throw streamError();
      if (record(value.usage)) {
        const usage = tokenUsage(value.usage);
        if (Object.keys(usage).length) yield { type: 'usage', usage };
      }
      if (value.error !== undefined) throw providerError(record(value.error) && count(value.error.status) ? value.error.status : 502, value.error);
      if (value.choices === undefined) return;
      if (!Array.isArray(value.choices) || value.choices.length > 1) throw streamError();
      for (const choice of value.choices) {
        if (!record(choice)) throw streamError();
        if (choice.finish_reason === 'content_filter') throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
        if (choice.finish_reason === 'error') throw providerError(502);
        if (choice.finish_reason === 'length') throw new DateApiError(502, 'horde_truncated', 'AI Horde could not finish this response within the free response limit. Please try another turn.');
        if (typeof choice.finish_reason === 'string' && choice.finish_reason) terminal = true;
        if (choice.delta === undefined || choice.delta === null) continue;
        if (!record(choice.delta)) throw streamError();
        if (typeof choice.delta.refusal === 'string' && choice.delta.refusal) throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
        if (choice.delta.content !== undefined && choice.delta.content !== null && typeof choice.delta.content !== 'string') throw streamError();
        if (typeof choice.delta.content === 'string' && choice.delta.content) yield { type: 'text', text: choice.delta.content };
      }
    }
    function* line(raw: string): Generator<ClaudeChunk> {
      const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (!value) {
        if (eventData.length) {
          const data = eventData.join('\n'); eventData = []; eventCharacters = 0;
          yield* frame(data);
        }
        return;
      }
      if (!value.startsWith('data:')) return;
      const data = value.slice(5).replace(/^ /, '');
      eventCharacters += data.length;
      if (eventCharacters > maxFrameCharacters) throw streamError();
      eventData.push(data);
    }
    try {
      for (;;) {
        if (signal.aborted) throw interrupted();
        const next = await reader.read();
        if (signal.aborted) throw interrupted();
        streamBytes += next.value?.byteLength ?? 0;
        if (streamBytes > maxStreamBytes) throw streamError();
        buffer += decoder.decode(next.value, { stream: !next.done });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (raw.length > maxFrameCharacters) throw streamError();
          yield* line(raw);
          if (doneMarker) return;
        }
        if (buffer.length > maxFrameCharacters) throw streamError();
        if (next.done) {
          if (buffer) yield* line(buffer);
          if (eventData.length) yield* line('');
          if (!doneMarker && !terminal) throw streamError();
          return;
        }
      }
    } catch (error) {
      if (signal.aborted) throw interrupted();
      if (error instanceof DateApiError) throw error;
      throw providerError(502);
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } };
}
