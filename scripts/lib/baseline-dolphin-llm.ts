import { DateApiError, type ClaudeAdapter, type ClaudeChunk, type ClaudeRequest, type TokenUsage } from '../../server/restaurant/providers';
import { openRouterSchemaInstructions } from '../../server/restaurant/openrouter';
import { DOLPHIN_LLM_MODEL } from './baseline-direct-model';

const endpoint = 'https://dolphinllm.com/v1/chat/completions';
const maxFrameCharacters = 64 * 1024;
const maxStreamBytes = 4 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const interrupted = () => new DateApiError(499, 'interrupted', 'Conversation interrupted.');
const streamError = () => new DateApiError(502, 'dolphin_stream', 'Dolphin returned an unreadable or incomplete stream. Please try another turn.');

function tokenUsage(raw: Record<string, unknown>): Partial<TokenUsage> {
  const result: Partial<TokenUsage> = {};
  if (count(raw.prompt_tokens)) result.inputTokens = raw.prompt_tokens;
  if (count(raw.completion_tokens)) result.outputTokens = raw.completion_tokens;
  return result;
}

/** Classify stable fields only. Upstream messages/metadata can contain player text or secrets. */
function providerError(status: number): DateApiError {
  if (status === 401) return new DateApiError(502, 'dolphin_auth', 'Dolphin LLM rejected the server API key. Check DOLPHIN_LLM_API_KEY.');
  if (status === 402) return new DateApiError(402, 'dolphin_credits', 'Dolphin LLM reports insufficient credit.');
  if (status === 403) return new DateApiError(502, 'dolphin_access', 'Dolphin LLM denied access to this account.');
  if (status === 429) return new DateApiError(429, 'dolphin_rate_limit', 'Dolphin LLM is rate limited. Please try another turn shortly.');
  if (status === 408 || status === 504) return new DateApiError(504, 'dolphin_timeout', 'Dolphin LLM took too long to respond. Please try another turn.');
  if (status === 400 || status === 422) return new DateApiError(502, 'dolphin_request', 'Dolphin LLM rejected the request settings.');
  return new DateApiError(status === 503 ? 503 : 502, 'dolphin_provider', 'Dolphin LLM is unavailable. Your date is still here.');
}

/** Exactly one fetch for the chosen model. No provider/model retry or fallback. */
export function dolphinLlmAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  return { async *stream(request: ClaudeRequest, signal: AbortSignal) {
    if (signal.aborted) throw interrupted();
    if (request.model !== DOLPHIN_LLM_MODEL) throw new DateApiError(400, 'dolphin_model', 'Select the configured Dolphin model for this provider.');
    const apiKey = env.DOLPHIN_LLM_API_KEY?.trim();
    if (!apiKey) throw new DateApiError(503, 'dolphin_unconfigured', 'Add DOLPHIN_LLM_API_KEY to enable the Dolphin conversation option.');
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: 'POST', signal, redirect: 'error',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'uncensored', max_tokens: request.maxTokens, temperature: 0.8, stream: true,
          stream_options: { include_usage: true }, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: `${request.system}\n${openRouterSchemaInstructions(request.outputSchema)}` }, ...request.messages] }) });
    } catch {
      if (signal.aborted) throw interrupted();
      throw providerError(502);
    }
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw interrupted(); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw providerError(response.status);
    }
    if (!response.body) throw streamError();

    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', eventData: string[] = [], eventCharacters = 0, streamBytes = 0, doneMarker = false, terminal = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    function* frame(data: string): Generator<ClaudeChunk> {
      if (data.trim() === '[DONE]') { if (!terminal) throw streamError(); doneMarker = true; return; }
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw streamError(); }
      if (!record(value)) throw streamError();
      if (record(value.usage)) {
        const usage = tokenUsage(value.usage);
        if (Object.keys(usage).length) yield { type: 'usage', usage };
      }
      if (value.error !== undefined) {
        const code = record(value.error) && count(value.error.code) ? value.error.code : 502;
        throw providerError(code);
      }
      if (value.choices === undefined) return;
      if (!Array.isArray(value.choices) || value.choices.length > 1) throw streamError();
      for (const choice of value.choices) {
        if (!record(choice)) throw streamError();
        if (choice.finish_reason === 'content_filter') throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
        if (choice.finish_reason === 'error') throw providerError(502);
        if (choice.finish_reason === 'length') throw new DateApiError(502, 'dolphin_truncated', 'Dolphin LLM returned an incomplete response.');
        if (choice.finish_reason != null && choice.finish_reason !== 'stop') throw streamError();
        if (choice.delta !== undefined && choice.delta !== null) {
          if (!record(choice.delta)) throw streamError();
          if (typeof choice.delta.refusal === 'string' && choice.delta.refusal) throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
          if (choice.delta.content !== undefined && choice.delta.content !== null && typeof choice.delta.content !== 'string') throw streamError();
          if (typeof choice.delta.content === 'string' && choice.delta.content) {
            if (terminal) throw streamError();
            yield { type: 'text', text: choice.delta.content };
          }
        }
        if (choice.finish_reason === 'stop') terminal = true;
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
          if (!doneMarker) throw streamError();
          return;
        }
      }
    } catch (error) {
      if (signal.aborted) throw interrupted();
      if (error instanceof DateApiError) throw error;
      throw providerError(502);
    } finally {
      signal.removeEventListener('abort', cancel);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } };
}
