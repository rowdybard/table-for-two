import { DateApiError, TURN_SCHEMA, type ClaudeAdapter, type ClaudeChunk, type ClaudeRequest, type TokenUsage } from './providers';

export const DOLPHIN_MODEL_ID = 'cognitivecomputations/dolphin-mistral-24b-venice-edition' as const;
const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const maxFrameCharacters = 64 * 1024;
const maxStreamBytes = 4 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const interrupted = () => new DateApiError(499, 'interrupted', 'Conversation interrupted.');
const streamError = () => new DateApiError(502, 'dolphin_stream', 'Dolphin returned an unreadable or incomplete stream. Please try another turn.');

/** JSON mode is supported; strict JSON-schema decoding is not. Server validators remain authoritative. */
export function openRouterSchemaInstructions(schema: Record<string, unknown> = TURN_SCHEMA): string {
  return `Return exactly one JSON object conforming to every field, enum, bound and additionalProperties rule in this JSON schema. Put utterances first. Do not include Markdown or commentary outside JSON. The server validates the complete result before applying state updates. JSON schema: ${JSON.stringify(schema)}`;
}

function tokenUsage(raw: Record<string, unknown>): Partial<TokenUsage> {
  const result: Partial<TokenUsage> = {};
  const details = record(raw.prompt_tokens_details) ? raw.prompt_tokens_details : undefined;
  const cached = details?.cached_tokens;
  // OpenRouter prompt_tokens includes cache reads. The game's inputTokens field
  // follows Anthropic's uncached convention, so splitting avoids double billing.
  if (count(raw.prompt_tokens)) {
    const cacheRead = count(cached) && cached <= raw.prompt_tokens ? cached : 0;
    result.inputTokens = raw.prompt_tokens - cacheRead;
    if (count(cached) && cached <= raw.prompt_tokens) result.cacheReadTokens = cached;
  }
  if (count(raw.completion_tokens)) result.outputTokens = raw.completion_tokens;
  return result;
}

/** Classify stable fields only. Upstream messages/metadata can contain player text or secrets. */
function providerError(status: number, error?: unknown): DateApiError {
  const metadata = record(error) && record(error.metadata) ? error.metadata : undefined;
  const kind = metadata?.error_type;
  if (kind === 'refusal' || kind === 'content_policy_violation') return new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
  if (status === 402 || ['openrouter_guardrail_budget', 'openrouter_workspace_budget', 'openrouter_key_limit'].includes(String(metadata?.limit_source))) {
    return new DateApiError(402, 'dolphin_credits', 'OpenRouter reports insufficient credits or a reached key budget. Check the game’s OpenRouter account.');
  }
  if (status === 401) return new DateApiError(502, 'dolphin_auth', 'OpenRouter rejected the server API key. Check OPENROUTER_API_KEY.');
  if (status === 403) return new DateApiError(502, 'dolphin_access', 'OpenRouter denied this request. Check the server key’s permissions and account settings.');
  if (status === 404) return new DateApiError(502, 'dolphin_model', 'The configured Dolphin model is unavailable on OpenRouter.');
  if (status === 429 || kind === 'rate_limit_exceeded') return new DateApiError(429, 'dolphin_rate_limit', 'Dolphin is rate limited. Please try another turn shortly.');
  if (status === 408 || status === 504) return new DateApiError(504, 'dolphin_timeout', 'Dolphin took too long to respond. Please try another turn.');
  if (status === 400 || status === 422) return new DateApiError(502, 'dolphin_request', 'OpenRouter rejected the Dolphin request settings. The server configuration needs attention.');
  return new DateApiError(status === 503 ? 503 : 502, 'dolphin_provider', 'Dolphin is unavailable. Your date is still here.');
}

/** Exactly one fetch for the chosen model. No provider/model retry or fallback. */
export function openRouterAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  return { async *stream(request: ClaudeRequest, signal: AbortSignal) {
    if (signal.aborted) throw interrupted();
    if (String(request.model) !== DOLPHIN_MODEL_ID) throw new DateApiError(400, 'dolphin_model', 'Select the configured Dolphin model for this provider.');
    if (!env.OPENROUTER_API_KEY) throw new DateApiError(503, 'dolphin_unconfigured', 'Add OPENROUTER_API_KEY to enable the Dolphin conversation option.');
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: 'POST', signal,
        headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: DOLPHIN_MODEL_ID, max_tokens: request.maxTokens, stream: true,
          stream_options: { include_usage: true }, response_format: { type: 'json_object' },
          provider: { allow_fallbacks: false, require_parameters: true },
          messages: [{ role: 'system', content: `${request.system}\n${openRouterSchemaInstructions(request.outputSchema)}` }, ...request.messages] }) });
    } catch {
      if (signal.aborted) throw interrupted();
      throw providerError(502);
    }
    if (signal.aborted) { await response.body?.cancel().catch(() => {}); throw interrupted(); }
    if (!response.ok) {
      let error: unknown;
      try { const body: unknown = await response.json(); if (record(body)) error = body.error; } catch { await response.body?.cancel().catch(() => {}); }
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
      if (value.error !== undefined) {
        const code = record(value.error) && count(value.error.code) ? value.error.code : 502;
        throw providerError(code, value.error);
      }
      if (value.choices === undefined) return;
      if (!Array.isArray(value.choices) || value.choices.length > 1) throw streamError();
      for (const choice of value.choices) {
        if (!record(choice)) throw streamError();
        if (choice.finish_reason === 'content_filter') throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
        if (choice.finish_reason === 'error') throw providerError(502);
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
      if (!value.startsWith('data:')) return; // SSE comments, event names, IDs and heartbeats.
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
