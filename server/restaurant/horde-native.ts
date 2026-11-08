import { HORDE_MODEL } from '../../src/restaurant/types';
import { openRouterSchemaInstructions } from './openrouter';
import { DateApiError, EMOTIONS, TURN_SCHEMA, type ClaudeAdapter, type ClaudeRequest } from './providers';

const base = 'https://aihorde.net/api/v2';
type Family = 'gemma4' | 'qwen';
/** Only reviewed model families enter automatic selection; worker-supplied names are never executable configuration. */
const pool: readonly { name: string; family: Family }[] = [
  { name: 'lmstudio/Qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive', family: 'qwen' },
  { name: 'koboldcpp/G4-MeroMero-26B-A4B-it-uncensored-heretic', family: 'gemma4' },
];
const validatedBridges = new Set(['AI Horde Worker', 'AI Horde Worker~aphrodite~oai', 'AI Horde Worker~aphrodite~kai', 'KoboldCppEmbedWorker', 'TabbyAPI']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const interrupted = () => new DateApiError(499, 'interrupted', 'Conversation interrupted.');
const unavailable = () => new DateApiError(503, 'horde_model', 'No suitable AI Horde worker is available for this conversation right now.');
const damaged = () => new DateApiError(502, 'horde_stream', 'AI Horde returned an unreadable or incomplete response. Please try another turn.');
const arrayPrefix = '{"utterances":[';
const soloPrefix = '{"utterances":[{"speaker":"date","text":"';

/** Text from the player cannot close a native prompt turn or open a thinking channel. */
const escapeTokens = (text: string) => text.replace(/<\|(?:im_start|im_end)\|>|<\|(?:turn|channel)>|<(?:turn|channel)\|>|<bos>|<\/?think>/g, value => value.replace('<', '＜'));

export function hordeNativePrompt(request: ClaudeRequest, family: Family): { prompt: string; stops: string[]; prefix: string } {
  const schema = request.outputSchema ?? TURN_SCHEMA;
  const utterances = record(schema.properties) && record(schema.properties.utterances) ? schema.properties.utterances : undefined;
  const needsSpeech = !!utterances && typeof utterances.minItems === 'number' && utterances.minItems > 0;
  const prefix = needsSpeech ? soloPrefix : arrayPrefix;
  const speechRule = needsSpeech
    ? 'For this response, return exactly ONE utterance from the date answering the latest human message. Omit optional waiter and diner reactions. Never return an empty utterances array. The utterance needs speaker, text and emotion.' : '';
  const system = escapeTokens(`${request.system}\n${openRouterSchemaInstructions(schema)}\nKeep the entire JSON object compact and complete within 512 output tokens. ${speechRule} Every emotion field must be exactly one of: ${EMOTIONS.join(', ')}. Use neutral when uncertain; never invent a new emotion label. When no boundary event occurs, use {"kind":"none","topic":"other","refusal":"","evidence":""}; never use "none" as a boundary topic.`);
  if (family === 'gemma4') {
    return { prompt: `<bos><|turn>system\n${system}<turn|>\n${request.messages.map(message => `<|turn>${message.role === 'assistant' ? 'model' : 'user'}\n${escapeTokens(message.content)}<turn|>\n`).join('')}<|turn>model\n<|channel>thought\n<channel|>${prefix}`, stops: ['<turn|>', '<|turn>'], prefix };
  }
  return { prompt: `<|im_start|>system\n${system}<|im_end|>\n${request.messages.map(message => `<|im_start|>${message.role}\n${escapeTokens(message.content)}<|im_end|>\n`).join('')}<|im_start|>assistant\n<think>\n\n</think>\n\n${prefix}`, stops: ['<|im_end|>', '<|im_start|>'], prefix };
}

function errorFor(status: number, body?: unknown): DateApiError {
  const code = record(body) && typeof body.rc === 'string' ? body.rc : '';
  if (status === 401 || code === 'InvalidAPIKey') return new DateApiError(502, 'horde_auth', 'AI Horde rejected the server API key. Check AI_HORDE_API_KEY.');
  if (code === 'KudosUpfront') return new DateApiError(503, 'horde_kudos', 'AI Horde needs more queue priority for this request. Please try another turn later.');
  if (status === 429 || ['TimeoutIP', 'TooManyPrompts'].includes(code)) return new DateApiError(429, 'horde_rate_limit', 'AI Horde is busy or rate limited. Please try another turn shortly.');
  if (status === 404 || code === 'NoEligibleWorker') return unavailable();
  if (status === 408 || status === 504) return new DateApiError(504, 'horde_timeout', 'AI Horde took too long to respond. Please try another turn.');
  if (status === 400 || status === 422) return new DateApiError(502, 'horde_request', 'AI Horde rejected the request settings. The server configuration needs attention.');
  return new DateApiError(status === 503 ? 503 : 502, 'horde_provider', 'AI Horde is unavailable. Your date is still here.');
}

async function jsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw damaged();
  const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw interrupted();
      const next = await reader.read();
      if (signal.aborted) throw interrupted();
      bytes += next.value?.byteLength ?? 0;
      if (bytes > 2 * 1024 * 1024) throw damaged();
      text += decoder.decode(next.value, { stream: !next.done });
      if (next.done) break;
    }
    try { return JSON.parse(text); } catch { throw damaged(); }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(interrupted()); return; }
  const abort = () => { clearTimeout(timer); reject(interrupted()); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
  signal.addEventListener('abort', abort, { once: true });
});

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(interrupted());
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

type Candidate = { name: string; family: Family; score: number; workers: string[] };
type Roster = { models: unknown[]; workers: unknown[]; at: number };

/** Native requests use the larger prompt-worker pool. Polling only reads this one job; it never starts another inference. */
export function hordeNativeAdapter(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): ClaudeAdapter {
  let cached: Roster | undefined, loading: Promise<Roster> | undefined;
  const roster = async (signal: AbortSignal) => {
    if (cached && Date.now() - cached.at < 15_000) return cached;
    if (!loading) {
      loading = (async () => {
        // Public metadata is shared across turns. One player's interruption must
        // not cancel another player's discovery or generation eligibility check.
        const discoverySignal = AbortSignal.timeout(4000);
        const responses = await Promise.all([fetcher(`${base}/status/models?type=text`, { signal: discoverySignal }), fetcher(`${base}/workers?type=text`, { signal: discoverySignal })]);
        const bodies = await Promise.all(responses.map(response => jsonBody(response, discoverySignal)));
        if (responses.some(response => !response.ok) || bodies.some(body => !Array.isArray(body))) throw unavailable();
        cached = { models: bodies[0] as unknown[], workers: bodies[1] as unknown[], at: Date.now() };
        return cached;
      })().finally(() => { loading = undefined; });
    }
    return abortable(loading, signal);
  };
  return {
    async prepare() { await roster(AbortSignal.timeout(4000)); },
    async *stream(request, signal) {
    const callerSignal = signal;
    const configuredTimeout = Number(env.AI_HORDE_TIMEOUT_MS?.trim() || 60_000);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.floor(Math.max(1000, Math.min(120_000, configuredTimeout))) : 60_000;
    signal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    if (signal.aborted) throw interrupted();
    if (request.model !== HORDE_MODEL) throw new DateApiError(400, 'horde_model', 'Select the configured AI Horde conversation route.');
    if (env.DATE_EARNED_PROVIDER !== 'aihorde' && env.DATE_CONVERSATION_PROVIDER !== 'aihorde') throw new DateApiError(503, 'horde_unconfigured', 'Enable the AI Horde conversation option on the server.');
    if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 16) throw new DateApiError(400, 'horde_request', 'Choose a valid conversation response length.');
    const maxTokens = Math.min(512, request.maxTokens), key = env.AI_HORDE_API_KEY?.trim() || '0000000000';
    const pinned = env.AI_HORDE_MODEL?.trim();
    const known = pinned ? pool.filter(model => model.name === pinned) : pool;
    if (!known.length) throw new DateApiError(503, 'horde_model', 'The configured native AI Horde model needs a reviewed prompt format.');
    let id: string | undefined, finished = false;
    try {
      const available = await roster(signal);
      if (signal.aborted) throw interrupted();
      const prompts = { gemma4: hordeNativePrompt(request, 'gemma4'), qwen: hordeNativePrompt(request, 'qwen') };
      // Match Horde's documented 3-characters-per-token admission estimate, rounded
      // up to a supported context size. context_fit=reject forbids silent truncation.
      const contexts = Object.fromEntries(Object.entries(prompts).map(([family, value]) => [family, Math.max(2048, 2 ** Math.ceil(Math.log2(Math.ceil(value.prompt.length / 3) + maxTokens)))])) as Record<Family, number>;
      const candidates: Candidate[] = [];
      for (const model of known) {
        const stat = available.models.find(value => record(value) && value.name === model.name);
        if (!record(stat) || !finite(stat.count) || stat.count < 1) continue;
        const workers = available.workers.filter(value => {
          if (!record(value)) return false;
          const bridge = typeof value.bridge_agent === 'string' ? value.bridge_agent.split(':', 1)[0] : '';
          const reviewedBackend = validatedBridges.has(bridge) || model.family === 'qwen' && bridge === 'reGen Minimal';
          return reviewedBackend && value.trusted === true && value.nsfw === true && value.online !== false && value.maintenance_mode !== true && value.flagged !== true && value.accepts_prompt_jobs !== false && Array.isArray(value.models) && value.models.includes(model.name) && finite(value.max_context_length) && value.max_context_length >= contexts[model.family] && finite(value.max_length) && value.max_length >= maxTokens;
        });
        const workerIds = workers.flatMap(value => record(value) && typeof value.id === 'string' && /^[a-f0-9-]{36}$/i.test(value.id) ? [value.id] : []);
        if (!workerIds.length) continue;
        const speed = finite(stat.performance) && stat.performance > 0 ? stat.performance : 1;
        candidates.push({ ...model, score: (finite(stat.eta) ? stat.eta : 300) + maxTokens / speed, workers: workerIds });
      }
      candidates.sort((a, b) => a.score - b.score);
      const fastest = candidates[0];
      if (!fastest) throw unavailable();
      const selected = candidates.filter(candidate => candidate.family === fastest.family).slice(0, 5);
      const selectedWorkers = [...new Set(selected.flatMap(candidate => candidate.workers))].slice(0, 5);
      const formatted = prompts[fastest.family];
      const headers = { apikey: key, 'content-type': 'application/json', 'Client-Agent': 'Table-for-Two:1:game' };
      const response = await fetcher(`${base}/generate/text/async`, { method: 'POST', signal, headers,
        body: JSON.stringify({ prompt: formatted.prompt, models: selected.map(candidate => candidate.name), workers: selectedWorkers, trusted_workers: true, validated_backends: fastest.family !== 'qwen', context_fit: 'reject', params: { n: 1, max_length: maxTokens, max_context_length: contexts[fastest.family], temperature: 0.2, stop_sequence: formatted.stops } }) });
      const submission = await jsonBody(response, signal);
      if (!response.ok) throw errorFor(response.status, submission);
      if (!record(submission) || typeof submission.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(submission.id)) throw damaged();
      id = submission.id;
      for (;;) {
        if (signal.aborted) throw interrupted();
        const statusResponse = await fetcher(`${base}/generate/text/status/${id}`, { signal, headers: { 'Client-Agent': headers['Client-Agent'] } });
        const status = await jsonBody(statusResponse, signal);
        if (!statusResponse.ok) throw errorFor(statusResponse.status, status);
        if (!record(status) || typeof status.done !== 'boolean' || typeof status.faulted !== 'boolean') throw damaged();
        if (status.faulted) { finished = true; throw errorFor(502); }
        if (status.done) {
          finished = true;
          if (!Array.isArray(status.generations) || status.generations.length !== 1 || !record(status.generations[0])) throw damaged();
          const generation = status.generations[0];
          if (generation.state === 'censored' || generation.state === 'csam') throw new DateApiError(422, 'conversation_refusal', 'This conversation response was declined.');
          if (typeof generation.text !== 'string' || generation.text.length > 16_000 || !selected.some(candidate => candidate.name === generation.model) || !selectedWorkers.includes(String(generation.worker_id))) throw damaged();
          let text = generation.text;
          const stop = formatted.stops.map(marker => text.indexOf(marker)).filter(index => index >= 0).sort((a, b) => a - b)[0];
          if (stop !== undefined) text = text.slice(0, stop);
          text = text.trim();
          // Some bridges return the complete prefixed object rather than only
          // its continuation. Preserve that object without duplicating our prefix.
          let completeObject = false;
          try { const value: unknown = JSON.parse(text); completeObject = record(value) && Array.isArray(value.utterances); } catch { /* A normal continuation is not a standalone JSON object. */ }
          // The only reconstructed text is our literal prefix, already sent to
          // the model. No generated field or assessment is repaired or supplied.
          yield { type: 'text', text: completeObject ? text : formatted.prefix + text };
          return;
        }
        if (status.is_possible === false && status.eligible_worker_threads === 0 && status.processing === 0) throw unavailable();
        await wait(signal);
      }
    } catch (error) {
      if (signal.aborted) {
        if (callerSignal.aborted) throw interrupted();
        throw new DateApiError(504, 'horde_timeout', 'AI Horde took too long to respond. Please try another turn.');
      }
      if (error instanceof DateApiError) throw error;
      throw errorFor(502);
    } finally {
      if (id && !finished) {
        const cancelSignal = AbortSignal.timeout(3000);
        await fetcher(`${base}/generate/text/status/${id}`, { method: 'DELETE', signal: cancelSignal, headers: { apikey: key, 'Client-Agent': 'Table-for-Two:1:game' } }).then(async response => { await response.body?.cancel().catch(() => {}); }).catch(() => {});
      }
    }
  } };
}
