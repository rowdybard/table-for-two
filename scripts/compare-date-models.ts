import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { anthropicAdapter, type ClaudeAdapter } from '../server/restaurant/providers';
import { hordeAdapter } from '../server/restaurant/horde';
import { openRouterAdapter } from '../server/restaurant/openrouter';
import { dolphinLlmAdapter } from '../server/restaurant/dolphin-llm';
import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL, type ClaudeModel } from '../src/restaurant/types';
import { evaluationPreview, parseEvaluationOptions, runConversationEvaluation } from './lib/conversation-evaluation';
import { evaluationProvenance } from './lib/evaluation-provenance';
import { CampaignLedger, campaignLedgerPath, readCampaignManifest } from './lib/campaign-ledger';

async function main() {
  const options = parseEvaluationOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: pnpm compare:models [--suite all|short|continuity|endurance|closing] [--scripts id,id] [--models haiku,sonnet,horde,dolphin,venice] [--run --budget USD] [--campaign]. Dolphin uses DOLPHIN_LLM_API_KEY; Venice uses OPENROUTER_API_KEY. Default is a dry run. $0 permits only Horde. Maximum explicit run budget is $10.');
  console.log(JSON.stringify(evaluationPreview(options), null, 2));
  if (!options.run) return; // Do not read credentials, create a provider, or write reports in a dry run.
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Campaign runs draw on the one shared ledger; it must already exist and match the manifest before any provider is created.
  let campaign: CampaignLedger | undefined;
  if (options.campaign) {
    const manifest = readCampaignManifest(resolve('docs/HAIKU_SIMULATION_CAMPAIGN.json'));
    if (options.models.some(model => !manifest.allowedModels.includes(model))) throw new Error(`This campaign allows only ${manifest.allowedModels.join(', ')}; no requests were sent.`);
    campaign = new CampaignLedger({ path: campaignLedgerPath(process.env, manifest as { sharedLedgerPath?: string }), manifest });
    console.log(`Campaign ledger before this run: ${JSON.stringify(campaign.totals())}`);
  }
  const anthropicModels = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;
  if (options.models.some(model => anthropicModels.some(selected => selected === model))) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is missing; no requests were sent.');
    if (anthropicModels.some((model, index) => options.models.includes(model) && [process.env.DATE_HAIKU_MODEL, process.env.DATE_SONNET_MODEL][index] && [process.env.DATE_HAIKU_MODEL, process.env.DATE_SONNET_MODEL][index] !== model)) throw new Error('Custom model aliases are not covered by evaluation pricing; no requests were sent.');
  }
  if (options.models.includes(DOLPHIN_MODEL) && !process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is missing; no requests were sent.');
  if (options.models.includes(DOLPHIN_LLM_MODEL) && !process.env.DOLPHIN_LLM_API_KEY?.trim()) throw new Error('DOLPHIN_LLM_API_KEY is missing; no requests were sent.');
  const provenance = evaluationProvenance();
  const adapters: Partial<Record<ClaudeModel, ClaudeAdapter>> = {};
  for (const model of options.models) adapters[model] = model === 'ai-horde' ? hordeAdapter({ ...process.env, DATE_CONVERSATION_PROVIDER: 'aihorde' }) : model === DOLPHIN_MODEL ? openRouterAdapter(process.env) : model === DOLPHIN_LLM_MODEL ? dolphinLlmAdapter(process.env) : anthropicAdapter(process.env);
  if (options.models.includes('ai-horde')) console.log('Horde is community hosted: volunteer hosts may inspect or retain these fictional prompts. No paid model is used as fallback.');
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  try {
    const report = await runConversationEvaluation({ scripts: options.scripts, models: options.models, budgetUSD: options.budgetUSD!, adapters, signal: controller.signal, campaign,
      ...provenance, providerEnvironment: process.env,
      onProgress(row) { console.log(`${row.scriptId} · ${row.model} · turn ${row.turn} · ${row.valid ? 'protocol valid; human review pending' : 'review error'} · accounted $${row.accountedCostUSD.toFixed(5)}`); } });
    if (campaign) console.log(`Campaign ledger after this run: ${JSON.stringify(campaign.totals())}`);
    await mkdir(resolve('.qa'), { recursive: true });
    await writeFile(resolve('.qa/date-model-comparison.json'), JSON.stringify(report, null, 2));
    console.log('Saved .qa/date-model-comparison.json. Human ratings remain unrated. Cost figures are estimates, not provider invoices. Speech latency was not measured.');
  } finally { process.removeListener('SIGINT', cancel); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed.'); process.exitCode = 1; });
