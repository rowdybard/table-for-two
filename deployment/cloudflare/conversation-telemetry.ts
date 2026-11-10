type ConversationModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'dolphinllm/uncensored' | 'cognitivecomputations/dolphin-mistral-24b-venice-edition' | 'ai-horde';
type Provider = 'anthropic' | 'dolphinllm' | 'openrouter' | 'horde' | 'unknown';
export interface ConversationFailure { model: ConversationModel | 'unknown'; provider: Provider; code: string; field?: string; index?: number }
const providers: Record<ConversationModel, Provider> = {
  'claude-haiku-5-5': 'anthropic', 'claude-sonnet-5-5': 'anthropic', 'dolphinllm/uncensored': 'dolphinllm',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition': 'openrouter', 'ai-horde': 'horde',
};
const codes = new Set(['invalid_dialogue', 'claude_provider', 'claude_credits', 'claude_model', 'claude_request', 'claude_stream', 'claude_truncated', 'claude_unconfigured', 'dolphin_auth', 'dolphin_credits', 'dolphin_access', 'dolphin_rate_limit', 'dolphin_timeout', 'dolphin_request', 'dolphin_provider', 'dolphin_model', 'dolphin_unconfigured', 'dolphin_stream', 'dolphin_truncated', 'horde_provider', 'horde_model', 'horde_stream', 'horde_timeout', 'horde_unavailable', 'conversation_refusal', 'invalid_model', 'interrupted', 'timeout', 'daily_limit', 'session_limit', 'budget_ledger']);
const fields = new Set(['utterance_shape', 'utterance_text_empty', 'utterance_text_length', 'utterance_text_controls', 'utterance_emotion', 'utterance_speaker', 'date_response_length', 'turn_shape', 'utterances_type', 'utterances_count', 'turn_emotion', 'turn_action', 'memory_type', 'memory_length']);
const maximumLineBytes = 64 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Observe each bounded line in the original stream; never retain or emit dialogue content. */
export function observeConversationFailures(response: Response, report: (failure: ConversationFailure) => void): Response {
  if (response.status === 101 || !response.body || !/^application\/x-ndjson(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) return response;
  let selected: ConversationModel | 'unknown' = 'unknown', size = 0, oversize = false;
  const buffer = new Uint8Array(maximumLineBytes);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  const line = () => {
    try {
      if (!oversize && size) {
        const value: unknown = JSON.parse(decoder.decode(buffer.subarray(0, size)));
        if (object(value) && value.type === 'start') selected = typeof value.model === 'string' && Object.hasOwn(providers, value.model) ? value.model as ConversationModel : 'unknown';
        if (object(value) && value.type === 'error') {
          const failure: ConversationFailure = { model: selected, provider: selected === 'unknown' ? 'unknown' : providers[selected], code: typeof value.code === 'string' && codes.has(value.code) ? value.code : 'unknown' };
          if (object(value.details) && typeof value.details.field === 'string' && fields.has(value.details.field)) {
            failure.field = value.details.field;
            if (Number.isSafeInteger(value.details.index) && (value.details.index as number) >= 0 && (value.details.index as number) <= 1) failure.index = value.details.index as number;
          }
          try { report(failure); } catch { /* Diagnostics must never affect delivery. */ }
        }
      }
    } catch { /* Malformed, non-UTF8 or non-JSON lines are not diagnostics. */ }
    buffer.fill(0, 0, size); size = 0; oversize = false;
  };
  const append = (bytes: Uint8Array) => {
    if (oversize) return;
    if (size + bytes.byteLength > maximumLineBytes) { buffer.fill(0, 0, size); size = 0; oversize = true; return; }
    if (bytes.byteLength) { buffer.set(bytes, size); size += bytes.byteLength; }
  };
  const observe = (chunk: Uint8Array) => {
    let from = 0;
    for (let i = 0; i < chunk.byteLength; i++) if (chunk[i] === 10) { append(chunk.subarray(from, i)); line(); from = i + 1; }
    append(chunk.subarray(from));
  };
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { controller.enqueue(chunk); try { observe(chunk); } catch { buffer.fill(0, 0, size); size = 0; oversize = true; } },
    flush() { try { if (size || oversize) line(); } catch { /* Ignore diagnostic failures. */ } },
  }));
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
