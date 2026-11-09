import { MODEL_RATES } from '../../src/restaurant/content';
import { createHash } from 'node:crypto';
import { EVALUATION_MAX_TOKENS } from '../../src/restaurant/evaluation-runtime';
import { DEFAULT_HORDE_MODEL } from '../../server/restaurant/horde';
import { DATE_EVALUATION_RUBRIC, EVALUATION_REVIEW_GUIDE, EVALUATION_MODELS, EVALUATION_SCRIPTS, EvaluationConversation, type EvaluationScript } from '../../src/restaurant/evaluation';
import type { ClaudeModel } from '../../src/restaurant/types';
import { completeUtterances } from '../../server/restaurant';
import { DateApiError, TURN_SCHEMA, type ClaudeAdapter, type ClaudeRequest, type TokenUsage } from '../../server/restaurant/providers';

export interface EvaluationOptions { run: boolean; budgetUSD?: number; models: ClaudeModel[]; scripts: EvaluationScript[]; help: boolean }
const aliases: Record<string, ClaudeModel> = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', horde: 'ai-horde' };
export function parseEvaluationOptions(args: readonly string[]): EvaluationOptions {
  let run = false, help = false, budgetUSD: number | undefined, suite = 'all', ids: string[] | undefined;
  let models: ClaudeModel[] = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === '--run') { run = true; continue; }
    if (flag === '--help') { help = true; continue; }
    if (!['--budget', '--models', '--scripts', '--suite'].includes(flag)) throw new Error(`Unknown evaluation argument: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--budget') { if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error('Budget must be an explicit USD number.'); budgetUSD = Number(value); }
    if (flag === '--models') { models = value.split(',').map(model => aliases[model] ?? model as ClaudeModel); if (new Set(models).size !== models.length || models.some(model => !EVALUATION_MODELS.includes(model))) throw new Error('Choose distinct models: haiku, sonnet, horde.'); }
    if (flag === '--scripts') ids = value.split(',');
    if (flag === '--suite') suite = value;
  }
  if (!['all', 'short', 'continuity'].includes(suite)) throw new Error('Suite must be all, short or continuity.');
  if (budgetUSD !== undefined && (!Number.isFinite(budgetUSD) || budgetUSD < 0 || budgetUSD > 10)) throw new Error('Budget must be between $0 and $10.');
  if (run && !help && budgetUSD === undefined) throw new Error('--run requires an explicit --budget USD; no default or environment budget authorizes calls.');
  if (run && !help && budgetUSD === 0 && models.some(model => model !== 'ai-horde')) throw new Error('A $0 budget permits only --models horde.');
  if (ids && (new Set(ids).size !== ids.length || ids.some(id => !EVALUATION_SCRIPTS.some(script => script.id === id)))) throw new Error('Every selected script ID must exist and appear once.');
  const scripts = EVALUATION_SCRIPTS.filter(script => (suite === 'all' || script.suite === suite) && (!ids || ids.includes(script.id)));
  if (!scripts.length) throw new Error('The selection contains no scripts.');
  return { run: run && !help, budgetUSD, models, scripts, help };
}

const zeroUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export function evaluationCost(model: ClaudeModel, usage: TokenUsage): number {
  const rate = MODEL_RATES[model];
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output + usage.cacheReadTokens * rate.cacheRead + usage.cacheWriteTokens * rate.cacheWrite) / 1e6;
}
/** Conservative per-request reservation: UTF-8 bytes plus schema/framing, including a full cache write.
 * Actual provider invoices are not available here; incomplete usage keeps the entire reservation charged. */
export function evaluationReservation(request: ClaudeRequest): number {
  const input = Buffer.byteLength(request.system + JSON.stringify(request.messages) + JSON.stringify(request.outputSchema ?? TURN_SCHEMA), 'utf8') + 1024;
  return evaluationCost(request.model, { inputTokens: input, outputTokens: request.maxTokens, cacheReadTokens: 0, cacheWriteTokens: input });
}
export function evaluationPreview(options: Pick<EvaluationOptions, 'models' | 'scripts'>) {
  return { scripts: options.scripts.length, conversations: options.scripts.length * options.models.length,
    plannedRequests: options.models.length * options.scripts.reduce((sum, script) => sum + script.turns.length, 0), models: options.models,
    firstTurnReservationsUSD: options.models.reduce((sum, model) => sum + options.scripts.reduce((n, script) => n + evaluationReservation(new EvaluationConversation(script, model).request(0)), 0), 0),
    note: 'Later reservations depend on actual replies and are checked before each call. Dry run makes zero API calls and writes no report.' };
}

function latencySummary(values: (number | null)[]) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { samples: sorted.length, p50Ms: percentile(.5), p95Ms: percentile(.95) };
}

export interface EvaluationTurnReport {
  turn: number; human: string; target: string; input: string; via: string;
  request: ClaudeRequest; rawResponse: string; firstTextMs: number | null; firstUtteranceMs: number | null; totalResponseMs: number;
  utteranceCount: number; valid: boolean; error: { kind: 'provider' | 'validation' | 'timeout' | 'cancelled'; code: string; message: string } | null;
  usage: TokenUsage; usageComplete: boolean; estimatedCostUSD: number | null; reportedCostUSD: number; accountedCostUSD: number; reservationUSD: number;
  notebook: ReturnType<EvaluationConversation['reviewSnapshot']>;
}
export interface EvaluationRunOptions {
  scripts: EvaluationScript[]; models: ClaudeModel[]; budgetUSD: number;
  adapters: Partial<Record<ClaudeModel, ClaudeAdapter>>;
  timeoutMs?: number; signal?: AbortSignal; now?: () => number;
  /** Public source provenance only. Unknown or dirty revisions are not formal A/B evidence. */
  sourceRevision?: string; sourceTreeDirty?: boolean | null;
  evaluatedSourceRevision?: string; harnessRevision?: string; instrumentationSha256?: string | null;
  /** Only public route settings are copied into the report; credentials are never serialized. */
  providerEnvironment?: NodeJS.ProcessEnv;
  onProgress?(message: { scriptId: string; model: ClaudeModel; turn: number; valid: boolean; accountedCostUSD: number }): void;
}

export function evaluationModelSettings(models: readonly ClaudeModel[], env: NodeJS.ProcessEnv = {}, timeoutMs?: number) {
  return models.map(model => {
    const horde = model === 'ai-horde', native = horde && env.AI_HORDE_TRANSPORT === 'native';
    const pinned = env.AI_HORDE_MODEL?.trim() || null;
    const upstreamModel = horde ? pinned ?? (native ? null : DEFAULT_HORDE_MODEL) : model;
    const configuredTimeout = Number(env.AI_HORDE_TIMEOUT_MS?.trim() || 60_000);
    return { model, upstreamModel, transport: horde ? native ? 'horde-native' : 'horde-openai' : 'anthropic-messages',
      maxTokens: EVALUATION_MAX_TOKENS, effectiveMaxTokens: horde ? Math.min(512, EVALUATION_MAX_TOKENS) : EVALUATION_MAX_TOKENS,
      timeoutMs: timeoutMs ?? (horde ? 65000 : 30000),
      providerTimeoutMs: native ? Number.isFinite(configuredTimeout) ? Math.floor(Math.max(1000, Math.min(120_000, configuredTimeout))) : 60_000 : null,
      routingConfig: horde ? { selection: native && !pinned ? 'reviewed-native-pool' : pinned ? 'configured-model' : 'default-fixed-model',
        requestedModels: upstreamModel ? [upstreamModel] : null, actualWorkerObserved: false, contextFit: native ? 'reject' : 'grow',
        ...(!native ? { responseFormat: 'json_schema', schemaStrict: true } : {}) } : null };
  });
}

/** Cancels a stuck iterator without waiting forever for a provider that ignores AbortSignal. */
function nextChunk<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Evaluation request canceled.', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function runConversationEvaluation(options: EvaluationRunOptions) {
  if (!Number.isFinite(options.budgetUSD) || options.budgetUSD < 0 || options.budgetUSD > 10) throw new Error('An explicit valid evaluation budget is required.');
  if (options.budgetUSD === 0 && options.models.some(model => model !== 'ai-horde')) throw new Error('A zero budget cannot authorize paid models.');
  if (!options.models.length || new Set(options.models).size !== options.models.length || options.models.some(model => !EVALUATION_MODELS.includes(model) || !options.adapters[model])) throw new Error('Provide one adapter for every selected supported model.');
  const now = options.now ?? (() => performance.now());
  let accounted = 0, requests = 0, stopped = false;
  const results: { scriptId: string; title: string; mode: EvaluationScript['mode']; model: ClaudeModel; plannedTurns: number; status: 'complete' | 'budget_exhausted' | 'failed' | 'cancelled'; turns: EvaluationTurnReport[];
    reviewFor: string; review: { status: 'unrated'; ratings: typeof DATE_EVALUATION_RUBRIC; reviewerNotes: string; quotedLines: string[]; hardFailures: string[] | null };
    checkpoints: { afterTurn: number; mustRecall: string[]; mustNotClaim: string[]; status: 'unrated'; notebook: ReturnType<EvaluationConversation['reviewSnapshot']> | null }[] }[] = [];
  for (const script of options.scripts) for (const model of options.models) {
    const conversation = new EvaluationConversation(script, model), rows: EvaluationTurnReport[] = [];
    const result: typeof results[number] = { scriptId: script.id, title: script.title, mode: script.mode, model, plannedTurns: script.turns.length, status: 'complete', turns: rows, reviewFor: script.reviewFor,
      review: { status: 'unrated', ratings: { ...DATE_EVALUATION_RUBRIC }, reviewerNotes: '', quotedLines: [], hardFailures: null },
      checkpoints: (script.checkpoints ?? []).map(checkpoint => ({ ...checkpoint, status: 'unrated', notebook: null })) };
    results.push(result);
    for (let index = 0; index < script.turns.length; index++) {
      if (options.signal?.aborted) { result.status = 'cancelled'; stopped = true; break; }
      const request = conversation.request(index), reservation = evaluationReservation(request);
      if (stopped || accounted + reservation > options.budgetUSD) { result.status = 'budget_exhausted'; stopped = true; break; }
      const usage = zeroUsage(), started = now(), controller = new AbortController();
      let timedOut = false, malformedStream = false, text = '', firstText: number | null = null, firstUtterance: number | null = null, streamCompleted = false, inputReported = false, outputReported = false, error: EvaluationTurnReport['error'] = null, valid = false, utteranceCount = 0;
      const cancel = () => controller.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? (model === 'ai-horde' ? 65000 : 30000));
      let iterator: AsyncIterator<Awaited<ReturnType<ClaudeAdapter['stream']>> extends AsyncIterable<infer C> ? C : never> | undefined;
      requests++;
      try {
        iterator = options.adapters[model]!.stream(request, controller.signal)[Symbol.asyncIterator]();
        for (;;) {
          const next = await nextChunk(iterator, controller.signal);
          if (next.done) { streamCompleted = true; break; }
          const chunk = next.value;
          if (chunk.type === 'text') {
            if (firstText === null) firstText = now() - started;
            text += chunk.text;
            if (text.length > 24000) throw new DateApiError(502, 'evaluation_size', 'The response exceeded the evaluation size limit.');
            let utterances: unknown[];
            try { utterances = completeUtterances(text); } catch (error) { malformedStream = true; throw error; }
            if (firstUtterance === null && utterances.length) firstUtterance = now() - started;
          } else {
            for (const key of Object.keys(usage) as (keyof TokenUsage)[]) if (typeof chunk.usage[key] === 'number' && Number.isFinite(chunk.usage[key]) && chunk.usage[key]! >= 0) usage[key] = Math.max(usage[key], chunk.usage[key]!);
            inputReported ||= ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some(key => key in chunk.usage);
            outputReported ||= typeof chunk.usage.outputTokens === 'number' && chunk.usage.outputTokens > 0;
          }
        }
        try { const parsed = conversation.validate(text); utteranceCount = parsed.turn.utterances.length; conversation.commit(index, parsed); valid = true; }
        catch { error = { kind: 'validation', code: 'invalid_dialogue', message: 'The response failed the production dialogue validator.' }; }
      } catch (caught) {
        error = { kind: timedOut ? 'timeout' : options.signal?.aborted ? 'cancelled' : malformedStream ? 'validation' : 'provider', code: timedOut ? 'evaluation_timeout' : caught instanceof DateApiError ? caught.code : 'provider_request',
          message: timedOut ? 'The provider exceeded the evaluation deadline.' : options.signal?.aborted ? 'Evaluation canceled.' : caught instanceof DateApiError ? caught.message : 'The provider request did not complete.' };
      } finally {
        clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); controller.abort();
        if (!streamCompleted) void iterator?.return?.().catch(() => {});
      }
      const usageComplete = streamCompleted && inputReported && outputReported;
      const reportedCostUSD = evaluationCost(model, usage), accountedCostUSD = usageComplete ? reportedCostUSD : reservation;
      accounted += accountedCostUSD;
      const input = script.turns[index];
      rows.push({ turn: index + 1, human: input.human ?? 'h1', target: input.target ?? (script.mode === 'double' ? 'table' : 'date'), input: input.text, via: input.via ?? 'typed', request,
        rawResponse: text, firstTextMs: firstText === null ? null : Math.round(firstText), firstUtteranceMs: firstUtterance === null ? null : Math.round(firstUtterance), totalResponseMs: Math.round(now() - started),
        utteranceCount, valid, error, usage, usageComplete, estimatedCostUSD: usageComplete ? reportedCostUSD : null, reportedCostUSD, accountedCostUSD, reservationUSD: reservation, notebook: conversation.reviewSnapshot() });
      for (const checkpoint of result.checkpoints) if (checkpoint.afterTurn === index + 1) checkpoint.notebook = conversation.reviewSnapshot();
      options.onProgress?.({ scriptId: script.id, model, turn: index + 1, valid, accountedCostUSD: accounted });
      // No retries or fabricated continuation: a failed turn stops this script. Other independent scripts may run.
      if (!valid) { result.status = error?.kind === 'cancelled' ? 'cancelled' : 'failed'; break; }
    }
  }
  const modelSummaries = options.models.map(model => {
    const rows = results.filter(result => result.model === model).flatMap(result => result.turns), usage = zeroUsage();
    for (const row of rows) for (const key of Object.keys(usage) as (keyof TokenUsage)[]) usage[key] += row.usage[key];
    return { model, requests: rows.length, protocolValidResponses: rows.filter(row => row.valid).length,
      errors: Object.fromEntries(['provider', 'validation', 'timeout', 'cancelled'].map(kind => [kind, rows.filter(row => row.error?.kind === kind).length])),
      firstUtterance: latencySummary(rows.map(row => row.firstUtteranceMs)), totalResponse: latencySummary(rows.map(row => row.totalResponseMs)), usage,
      estimatedCostUSD: rows.length && rows.every(row => row.usageComplete) ? rows.reduce((sum, row) => sum + row.reportedCostUSD, 0) : null,
      accountedCostUSD: rows.reduce((sum, row) => sum + row.accountedCostUSD, 0), humanQualityStatus: 'unrated' as const };
  });
  const sourceRevision = /^[a-f0-9]{40,64}$/i.test(options.sourceRevision ?? '') ? options.sourceRevision!.toLowerCase() : 'unknown';
  const revision = (value: string | undefined) => /^[a-f0-9]{40,64}$/i.test(value ?? '') ? value!.toLowerCase() : 'unknown';
  return { createdAt: new Date().toISOString(), sourceRevision, sourceTreeDirty: typeof options.sourceTreeDirty === 'boolean' ? options.sourceTreeDirty : null,
    evaluatedSourceRevision: revision(options.evaluatedSourceRevision ?? sourceRevision), harnessRevision: revision(options.harnessRevision ?? sourceRevision),
    instrumentationSha256: /^[a-f0-9]{64}$/i.test(options.instrumentationSha256 ?? '') ? options.instrumentationSha256!.toLowerCase() : null,
    corpusSha256: createHash('sha256').update(JSON.stringify(options.scripts)).digest('hex'),
    selectedScripts: structuredClone(options.scripts),
    modelSettings: evaluationModelSettings(options.models, options.providerEnvironment, options.timeoutMs),
    budgetUSD: options.budgetUSD, accountedCostUSD: accounted, requests, plannedRequests: options.models.length * options.scripts.reduce((sum, script) => sum + script.turns.length, 0), modelSummaries,
    providerCallsPerHumanTurn: 1, automaticRetries: 0, speechMeasured: false, ratesUSDPerMillionTokens: MODEL_RATES, reviewGuide: structuredClone(EVALUATION_REVIEW_GUIDE), results };
}
