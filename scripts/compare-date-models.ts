import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { anthropicAdapter, DateApiError, TURN_SCHEMA, type ClaudeAdapter, type ClaudeRequest, type TokenUsage } from '../server/restaurant/providers';
import { validateTurn } from '../server/restaurant/index';
import { MODEL_RATES } from '../src/restaurant/content';
import { DATE_EVALUATION_CASES, DATE_EVALUATION_RUBRIC, evaluationRequest } from '../src/restaurant/evaluation';
import type { ClaudeModel, SceneTurn } from '../src/restaurant/types';

if (existsSync('.env')) process.loadEnvFile('.env');
const models: ClaudeModel[] = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
const zeroUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const costOf = (model: ClaudeModel, u: TokenUsage) => {
  const r = MODEL_RATES[model];
  return (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite) / 1e6;
};
function reserve(request: ClaudeRequest) {
  // Byte count plus schema/framing allowance deliberately overestimates these short English prompts.
  const input = Buffer.byteLength(request.system + JSON.stringify(request.messages) + JSON.stringify(TURN_SCHEMA), 'utf8') + 1024;
  return costOf(request.model, { inputTokens: input, outputTokens: request.maxTokens, cacheReadTokens: 0, cacheWriteTokens: input });
}
async function compare(adapter: ClaudeAdapter, request: ClaudeRequest) {
  const usage = zeroUsage(), started = performance.now();
  let text = '', inputReported = false, outputReported = false, streamCompleted = false, response: SceneTurn | null = null, error: string | null = null;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    for await (const chunk of adapter.stream(request, controller.signal)) {
      if (chunk.type === 'text') { text += chunk.text; if (text.length > 24_000) throw new Error('Oversized response'); }
      else {
        for (const key of Object.keys(usage) as (keyof TokenUsage)[]) usage[key] = Math.max(usage[key], chunk.usage[key] ?? 0);
        inputReported ||= ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some(key => key in chunk.usage);
        outputReported ||= typeof chunk.usage.outputTokens === 'number' && chunk.usage.outputTokens > 0;
      }
    }
    streamCompleted = true;
    response = validateTurn(JSON.parse(text));
  } catch (e) { error = e instanceof DateApiError ? e.message : controller.signal.aborted ? 'Request timed out.' : 'Response or provider request failed validation.'; }
  finally { clearTimeout(timeout); }
  const usageComplete = streamCompleted && inputReported && outputReported;
  return { response, rawResponse: text, error, latencyMs: Math.round(performance.now() - started), usage, usageComplete,
    reportedCostUSD: costOf(request.model, usage), actualCostUSD: usageComplete ? costOf(request.model, usage) : null,
    accountedCostUSD: usageComplete ? costOf(request.model, usage) : reserve(request), ratings: { ...DATE_EVALUATION_RUBRIC }, reviewerNotes: '' };
}

async function main() {
  if (process.argv.slice(2).some(arg => !['--run', '--help'].includes(arg))) throw new Error('Use --run for paid calls, or no arguments for a dry run.');
  const limit = Number(process.env.DATE_EVAL_LIMIT_USD ?? .5);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10) throw new Error('DATE_EVAL_LIMIT_USD must be greater than 0 and at most 10.');
  const jobs = DATE_EVALUATION_CASES.flatMap(test => models.map(model => ({ test, request: evaluationRequest(test, model) })));
  const estimatedMaximum = jobs.reduce((sum, job) => sum + reserve(job.request), 0);
  console.log(`Date model comparison · ${jobs.length} requests · estimated reservation $${estimatedMaximum.toFixed(4)} · run cap $${limit.toFixed(2)}`);
  for (const test of DATE_EVALUATION_CASES) console.log(`${test.id} · ${test.dateId} · ${test.title}`);
  console.log(`Models: ${models.join(', ')}. Ratings: 0 = unrated; a human reviewer assigns 1–5. No automatic quality grades.`);
  if (!process.argv.includes('--run') || process.argv.includes('--help')) { console.log('Dry run: no API calls or report writes. Add --run to execute paid text-only comparisons.'); return; }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing. Add it to the environment or .env before using --run.');
  if ([process.env.DATE_HAIKU_MODEL, process.env.DATE_SONNET_MODEL].some((model, index) => model && model !== models[index])) throw new Error('Remove custom model overrides for this comparison; cost rates cover only the listed models.');
  if (estimatedMaximum > limit) throw new Error('The full comparison exceeds DATE_EVAL_LIMIT_USD; no requests were sent.');
  const adapter = anthropicAdapter();
  const results: (Awaited<ReturnType<typeof compare>> & { caseId: string; model: ClaudeModel; dateId: string; reviewFor: string; request: ClaudeRequest })[] = [];
  let accounted = 0;
  for (const { test, request } of jobs) {
    if (accounted + reserve(request) > limit) { console.log('Run cap reached; remaining comparisons were skipped.'); break; }
    const result = await compare(adapter, request);
    accounted += result.accountedCostUSD;
    results.push({ caseId: test.id, model: request.model, dateId: test.dateId, reviewFor: test.reviewFor, request, ...result });
    console.log(`${test.id} · ${request.model} · ${result.error ? 'review error' : 'complete'} · ${result.latencyMs} ms · reported $${result.reportedCostUSD.toFixed(5)}`);
  }
  const report = { createdAt: new Date().toISOString(), limitUSD: limit, estimatedMaximumUSD: estimatedMaximum, budgetAccountedUSD: accounted,
    actualTotalCostUSD: results.every(result => result.usageComplete) ? results.reduce((sum, result) => sum + result.reportedCostUSD, 0) : null,
    totalResponseMs: results.reduce((sum, result) => sum + result.latencyMs, 0), ratesUSDPerMillionTokens: MODEL_RATES,
    models: models.map(model => {
      const rows = results.filter(result => result.model === model), usage = zeroUsage();
      for (const row of rows) for (const key of Object.keys(usage) as (keyof TokenUsage)[]) usage[key] += row.usage[key];
      return { model, requests: rows.length, validResponses: rows.filter(row => row.response).length, usage,
        actualCostUSD: rows.length > 0 && rows.every(row => row.usageComplete) ? costOf(model, usage) : null,
        meanResponseMs: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length) : null };
    }),
    rubric: 'Manual only: 0 = unrated; 1 = poor; 3 = acceptable; 5 = excellent. Judge each case against reviewFor. Speech is not evaluated.',
    results };
  await mkdir(resolve('.qa'), { recursive: true });
  await writeFile(resolve('.qa/date-model-comparison.json'), JSON.stringify(report, null, 2));
  console.log('Saved .qa/date-model-comparison.json. Review dialogue and fill ratings manually.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Comparison failed.'); process.exitCode = 1; });
