import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { anthropicAdapter, type ClaudeAdapter } from '../server/restaurant/providers';
import { createBaselineHordeAdapter } from './lib/baseline-horde-compat';
import type { ClaudeModel } from '../src/restaurant/types';
import { evaluationPreview, parseEvaluationOptions, runConversationEvaluation } from './lib/conversation-evaluation';
import { evaluationProvenance } from './lib/evaluation-provenance';

async function main() {
  const options = parseEvaluationOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: pnpm compare:models [--suite all|short|continuity] [--scripts id,id] [--models haiku,sonnet,horde] [--run --budget USD]. Default is a dry run. $0 permits only Horde. Maximum explicit run budget is $10.');
  console.log(JSON.stringify(evaluationPreview(options), null, 2));
  if (!options.run) return; // Do not read credentials, create a provider, or write reports in a dry run.
  if (existsSync('.env')) process.loadEnvFile('.env');
  if (options.models.some(model => model !== 'ai-horde')) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing; no requests were sent.');
    if ([process.env.DATE_HAIKU_MODEL, process.env.DATE_SONNET_MODEL].some((model, index) => model && model !== ['claude-haiku-5-5', 'claude-sonnet-5-5'][index])) throw new Error('Custom model aliases are not covered by evaluation pricing; no requests were sent.');
  }
  const provenance = evaluationProvenance();
  const adapters: Partial<Record<ClaudeModel, ClaudeAdapter>> = {};
  for (const model of options.models) adapters[model] = model === 'ai-horde' ? createBaselineHordeAdapter({ ...process.env, DATE_CONVERSATION_PROVIDER: 'aihorde' }) : anthropicAdapter(process.env);
  if (options.models.includes('ai-horde')) console.log('Horde is community hosted: volunteer hosts may inspect or retain these fictional prompts. No paid model is used as fallback.');
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const report = await runConversationEvaluation({ scripts: options.scripts, models: options.models, budgetUSD: options.budgetUSD!, adapters, signal: controller.signal,
      ...provenance, providerEnvironment: process.env,
      onProgress(row) { console.log(`${row.scriptId} · ${row.model} · turn ${row.turn} · ${row.valid ? 'protocol valid; human review pending' : 'review error'} · accounted $${row.accountedCostUSD.toFixed(5)}`); } });
    await mkdir(resolve('.qa'), { recursive: true });
    await writeFile(resolve('.qa/date-model-comparison.json'), JSON.stringify(report, null, 2));
    console.log('Saved .qa/date-model-comparison.json. Human ratings remain unrated. Cost figures are estimates, not provider invoices. Speech latency was not measured.');
  } finally { process.removeListener('SIGINT', cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed.'); process.exitCode = 1; });
