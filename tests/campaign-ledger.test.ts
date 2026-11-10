import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DOLPHIN_LLM_MODEL } from '../src/restaurant/types';
import { CAMPAIGNS, CampaignBudgetError, CampaignLedger, campaignLedgerPath, readCampaignManifest, type CampaignLedgerFile, type CampaignManifest } from '../scripts/lib/campaign-ledger';
import { runConversationEvaluation, parseEvaluationOptions } from '../scripts/lib/conversation-evaluation';
import { SHORT_EVALUATION_SCRIPTS } from '../src/restaurant/evaluation';
import type { ClaudeAdapter } from '../server/restaurant/providers';

const manifest: CampaignManifest = { campaignId: 'test-campaign', totalLimitUSD: 10, allowedModels: ['claude-haiku-5-5'] };
const fresh = (limit = 10) => { const path = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'budget.json'), m = { ...manifest, totalLimitUSD: limit }; CampaignLedger.init({ path, manifest: m }); return { path, manifest: m, ledger: new CampaignLedger({ path, manifest: m, lockWaitMs: 5000 }) }; };
const code = (work: () => unknown) => { try { work(); } catch (error) { return error instanceof CampaignBudgetError ? error.code : `other:${error}`; } return 'ok'; };
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as CampaignLedgerFile;

test('the committed manifest is Haiku only with a ten dollar ceiling', () => {
  const real = readCampaignManifest(resolve('docs/HAIKU_SIMULATION_CAMPAIGN.json'));
  assert.equal(real.totalLimitUSD, 10); assert.deepEqual(real.allowedModels, ['claude-haiku-5-5']);
  assert.equal(real.fallbackModelsAllowed, false); assert.equal(real.automaticProviderRetriesAllowed, false); assert.equal(real.automatedAiJudgeAllowed, false);
  assert.equal(campaignLedgerPath({ HAIKU_CAMPAIGN_LEDGER: '/x/budget.json' }, { sharedLedgerPath: 'C:/elsewhere' }), '/x/budget.json');
  assert.equal(code(() => campaignLedgerPath({}, {})), 'ledger_missing');
});

test('a run never creates or resets the ledger, and init never overwrites one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-')), path = join(dir, 'budget.json');
  assert.equal(code(() => new CampaignLedger({ path, manifest }).reserve('claude-haiku-5-5', .01, 'x')), 'ledger_missing');
  assert.equal(existsSync(path), false, 'a refused reservation creates nothing');
  CampaignLedger.init({ path, manifest });
  new CampaignLedger({ path, manifest }).reserve('claude-haiku-5-5', 1, 'spent');
  assert.equal(code(() => CampaignLedger.init({ path, manifest })), 'ledger_mismatch');
  assert.equal(read(path).entries.length, 1, 'the spent ledger is untouched');
  assert.equal(code(() => new CampaignLedger({ path, manifest: { ...manifest, campaignId: 'other' } }).totals()), 'ledger_mismatch');
  assert.equal(code(() => new CampaignLedger({ path, manifest: { ...manifest, totalLimitUSD: 20 } }).reserve('claude-haiku-5-5', 1, 'x')), 'ledger_mismatch', 'a raised limit is not honoured');
  writeFileSync(path, '{ broken');
  assert.equal(code(() => new CampaignLedger({ path, manifest }).reserve('claude-haiku-5-5', .01, 'x')), 'ledger_corrupt');
});

test('reservations are refused for other models and before the ceiling is passed', () => {
  const { ledger, path } = fresh(1);
  for (const model of ['claude-sonnet-5-5', 'dolphinllm/uncensored', 'ai-horde', 'claude-fable-5-2']) assert.equal(code(() => ledger.reserve(model, .01, 'x')), 'model_not_allowed', model);
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', 0, 'x')), 'invalid_amount');
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', Number.NaN, 'x')), 'invalid_amount');
  const a = ledger.reserve('claude-haiku-5-5', .6, 'a');
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', .5, 'b')), 'ceiling', 'an open reservation counts');
  assert.equal(read(path).entries.length, 1, 'the refused request left no entry');
  ledger.settle(a, .1);
  const b = ledger.reserve('claude-haiku-5-5', .5, 'b');
  ledger.settle(b, null);
  assert.equal(read(path).entries[1].status, 'retained'); assert.equal(read(path).entries[1].chargedUSD, .5, 'unknown usage keeps the whole reservation');
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', .41, 'c')), 'ceiling');
  ledger.reserve('claude-haiku-5-5', .4, 'exactly the remainder');
  assert.equal(ledger.totals().remainingUSD, 0);
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', .000001, 'one more')), 'ceiling');
  assert.equal(code(() => ledger.settle('nope', 0)), 'unknown_reservation');
  assert.equal(ledger.settle(a, 9).chargedUSD, .1, 'a settled entry cannot be rewritten');
});

test('tiny charges never round down under the ceiling', () => {
  const { ledger } = fresh(.001);
  for (let i = 0; i < 10; i++) ledger.settle(ledger.reserve('claude-haiku-5-5', .0001, `r${i}`), .0001);
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', .0000001, 'x')), 'ceiling');
  assert.equal(ledger.totals().chargedUSD, .001);
});

test('a held lock refuses the request instead of being broken', () => {
  const { path, manifest: m } = fresh();
  writeFileSync(`${path}.lock`, 'other');
  assert.equal(code(() => new CampaignLedger({ path, manifest: m, lockWaitMs: 150 }).reserve('claude-haiku-5-5', .01, 'x')), 'ledger_locked');
  assert.equal(existsSync(`${path}.lock`), true); assert.equal(read(path).entries.length, 0);
});

test('concurrent processes share one ceiling', async () => {
  const { path } = fresh(1);
  const worker = `import { CampaignLedger } from ${JSON.stringify(resolve('scripts/lib/campaign-ledger.ts'))};
    const ledger = new CampaignLedger({ path: process.argv[2], manifest: ${JSON.stringify({ ...manifest, totalLimitUSD: 1 })} });
    let ok = 0; for (let i = 0; i < 20; i++) { try { ledger.reserve('claude-haiku-5-5', .01, 'w'); ok++; } catch (error) { if (error.code !== 'ceiling') throw error; } }
    console.log(ok);`;
  const file = join(mkdtempSync(join(tmpdir(), 'ledger-worker-')), 'worker.ts'); writeFileSync(file, worker);
  const runs = await Promise.all(Array.from({ length: 8 }, () => new Promise<number>((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', file, path], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = '';
    child.stdout.on('data', chunk => out += chunk); child.stderr.on('data', chunk => err += chunk);
    child.on('close', status => status === 0 ? done(Number(out.trim())) : fail(new Error(err)));
  })));
  // 8 processes ask for 160 one-cent reservations against one dollar: exactly 100 may succeed.
  assert.equal(runs.reduce((sum, n) => sum + n, 0), 100);
  assert.equal(read(path).entries.length, 100);
  assert.equal(existsSync(`${path}.lock`), false);
});

const none = () => ({ signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false, boundary: { kind: 'none', topic: 'other', refusal: '', evidence: '' } });
const reply = JSON.stringify({ utterances: [{ speaker: 'date', text: 'I would like to hear your actual answer.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'HUMAN: nothing yet\nTOLD THEM: nothing yet\nOPEN: nothing yet', social: none(), agenda: { signal: 'none', evidence: '', clue: '' } });
const script = SHORT_EVALUATION_SCRIPTS.find(item => item.mode === 'solo')!;
const adapter = (calls: { n: number }, usage = true): ClaudeAdapter => ({ async *stream() { calls.n++; yield { type: 'text', text: reply }; if (usage) yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } }; } }) as unknown as ClaudeAdapter;

test('the evaluation runner reserves before every request, settles reported usage and stops at the shared ceiling', async () => {
  const { ledger, path } = fresh(), calls = { n: 0 };
  const report = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: 10, adapters: { 'claude-haiku-5-5': adapter(calls) }, campaign: ledger });
  assert.equal(calls.n, script.turns.length); assert.deepEqual(report.campaignLedger, { enforced: true, stoppedBy: null });
  const file = read(path);
  assert.equal(file.entries.length, script.turns.length); assert.ok(file.entries.every(entry => entry.status === 'settled' && entry.model === 'claude-haiku-5-5'));
  assert.ok(Math.abs(ledger.totals().chargedUSD - report.accountedCostUSD) < 1e-5, 'the ledger and the report agree');
  assert.match(file.entries[0].label, new RegExp(`^${script.id}#1$`));

  const unknown = fresh(), silent = { n: 0 };
  const kept = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: 10, adapters: { 'claude-haiku-5-5': adapter(silent, false) }, campaign: unknown.ledger });
  assert.ok(read(unknown.path).entries.every(entry => entry.status === 'retained' && entry.chargedUSD === entry.reservedUSD), 'missing usage keeps each reservation');
  assert.ok(Math.abs(unknown.ledger.totals().chargedUSD - kept.accountedCostUSD) < 1e-5);

  // A nearly spent shared ledger stops the run even though this invocation's own --budget is generous.
  const tight = fresh(.0001), blocked = { n: 0 };
  const stopped = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: 10, adapters: { 'claude-haiku-5-5': adapter(blocked) }, campaign: tight.ledger });
  assert.equal(blocked.n, 0, 'no request was dispatched'); assert.equal(stopped.requests, 0);
  assert.equal(stopped.results[0].status, 'budget_exhausted'); assert.match(stopped.campaignLedger!.stoppedBy!, /^ceiling:/);

  // Another model is refused by the ledger before dispatch, whatever the caller passed.
  const other = fresh(), sonnet = { n: 0 };
  const refused = await runConversationEvaluation({ scripts: [script], models: ['claude-sonnet-5-5'], budgetUSD: 10, adapters: { 'claude-sonnet-5-5': adapter(sonnet) }, campaign: other.ledger });
  assert.equal(sonnet.n, 0); assert.match(refused.campaignLedger!.stoppedBy!, /^model_not_allowed:/); assert.equal(read(other.path).entries.length, 0);
});

test('the campaign flag is parsed, and the command refuses other models and a missing ledger before any request', () => {
  assert.equal(parseEvaluationOptions(['--campaign', '--models', 'haiku']).campaign, true);
  assert.equal(parseEvaluationOptions(['--models', 'haiku']).campaign, false);
  const dir = mkdtempSync(join(tmpdir(), 'ledger-cli-')), env = { ...process.env, ANTHROPIC_API_KEY: '', HAIKU_CAMPAIGN_LEDGER: join(dir, 'budget.json') };
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/compare-date-models.ts'), ...args], { cwd: resolve('.'), env, encoding: 'utf8' });
  const wrongModel = run('--campaign', '--run', '--budget', '1', '--models', 'haiku,sonnet', '--scripts', script.id);
  assert.notEqual(wrongModel.status, 0); assert.match(wrongModel.stderr, /allows only claude-haiku-5-5; no requests were sent/);
  const noLedger = run('--campaign', '--run', '--budget', '1', '--models', 'haiku', '--scripts', script.id);
  assert.notEqual(noLedger.status, 0); assert.match(noLedger.stderr, /ledger does not exist; no request was sent/);
  const tool = (command: string) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/haiku-campaign-ledger.ts'), command], { cwd: resolve('.'), env, encoding: 'utf8' });
  assert.equal(tool('init').status, 0); assert.notEqual(tool('init').status, 0, 'a second init is refused');
  assert.match(tool('status').stdout, /"remainingUSD": 10/);
});

test('the Dolphin campaign has its own ten cent manifest and ledger, and refuses Haiku and overspend', async () => {
  const real = readCampaignManifest(resolve(CAMPAIGNS.dolphin.manifest));
  assert.equal(real.totalLimitUSD, .1); assert.deepEqual(real.allowedModels, [DOLPHIN_LLM_MODEL]);
  assert.equal(real.fallbackModelsAllowed, false); assert.equal(real.automaticProviderRetriesAllowed, false); assert.equal(real.automatedAiJudgeAllowed, false);
  assert.deepEqual(parseEvaluationOptions(['--campaign', 'dolphin', '--models', 'dolphin']).campaignName, 'dolphin');
  assert.equal(parseEvaluationOptions(['--campaign', '--models', 'haiku']).campaignName, 'haiku');
  assert.throws(() => parseEvaluationOptions(['--campaign', 'sonnet']), /haiku or dolphin/);
  // The Haiku ledger variable never stands in for the Dolphin one.
  assert.equal(code(() => campaignLedgerPath({ HAIKU_CAMPAIGN_LEDGER: '/x/haiku.json' }, {}, CAMPAIGNS.dolphin.ledgerEnv)), 'ledger_missing');
  assert.equal(campaignLedgerPath({ DOLPHIN_CAMPAIGN_LEDGER: '/x/dolphin.json' }, {}, CAMPAIGNS.dolphin.ledgerEnv), '/x/dolphin.json');

  const path = join(mkdtempSync(join(tmpdir(), 'ledger-dolphin-')), 'budget.json');
  CampaignLedger.init({ path, manifest: real });
  const ledger = new CampaignLedger({ path, manifest: real, lockWaitMs: 5000 });
  assert.equal(code(() => ledger.reserve('claude-haiku-5-5', .01, 'x')), 'model_not_allowed');
  assert.equal(code(() => ledger.reserve(DOLPHIN_LLM_MODEL, .11, 'x')), 'ceiling');
  // A Haiku-campaign ledger cannot be opened with the Dolphin manifest, and the reverse.
  const haiku = fresh();
  assert.equal(code(() => new CampaignLedger({ path: haiku.path, manifest: real }).reserve(DOLPHIN_LLM_MODEL, .001, 'x')), 'ledger_mismatch');

  // The runner stops at ten cents: each request reports far more usage than the reservation guessed.
  const calls = { n: 0 };
  const greedy: ClaudeAdapter = { async *stream() { calls.n++; yield { type: 'text', text: reply }; yield { type: 'usage', usage: { inputTokens: 300_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 } }; } } as unknown as ClaudeAdapter;
  const report = await runConversationEvaluation({ scripts: [script], models: [DOLPHIN_LLM_MODEL], budgetUSD: 1, adapters: { [DOLPHIN_LLM_MODEL]: greedy }, campaign: ledger });
  assert.equal(calls.n, 2, 'the third request would pass the ceiling and is never sent');
  assert.match(report.campaignLedger!.stoppedBy!, /^ceiling:/); assert.ok(ledger.totals().committedUSD <= .1);

  const env = { ...process.env, DOLPHIN_LLM_API_KEY: '', DOLPHIN_CAMPAIGN_LEDGER: join(mkdtempSync(join(tmpdir(), 'ledger-dolphin-cli-')), 'budget.json'), HAIKU_CAMPAIGN_LEDGER: haiku.path };
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/compare-date-models.ts'), ...args], { cwd: resolve('.'), env, encoding: 'utf8' });
  const wrongModel = run('--campaign', 'dolphin', '--run', '--budget', '1', '--models', 'haiku', '--scripts', script.id);
  assert.notEqual(wrongModel.status, 0); assert.match(wrongModel.stderr, /allows only dolphinllm\/uncensored; no requests were sent/);
  const noLedger = run('--campaign', 'dolphin', '--run', '--budget', '1', '--models', 'dolphin', '--scripts', script.id);
  assert.notEqual(noLedger.status, 0); assert.match(noLedger.stderr, /ledger does not exist; no request was sent/);
  assert.equal(read(haiku.path).entries.length, 0, 'the Haiku ledger is untouched');
});
