import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDate } from '../src/restaurant/content';
import { createBlindDate } from '../src/restaurant/blind-date';
import { CONTINUITY_EVALUATION_SCRIPTS, DATE_EVALUATION_RUBRIC, EVALUATION_SCRIPTS, SHORT_EVALUATION_SCRIPTS, EvaluationConversation } from '../src/restaurant/evaluation';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { DateApiError, TURN_SCHEMA, type ClaudeAdapter, type ClaudeRequest } from '../server/restaurant/providers';
import { DOUBLE_TURN_SCHEMA } from '../server/double-date/conversation';
import { evaluationModelSettings, evaluationPreview, evaluationReservation, parseEvaluationOptions, runConversationEvaluation } from '../scripts/lib/conversation-evaluation';
import { DEFAULT_HORDE_MODEL } from '../server/restaurant/horde';

const none = () => ({ signal: 'none', reason: 'No change in boundaries.', wantsToLeave: false, boundary: { kind: 'none', topic: 'other', refusal: '', evidence: '' } });
const agenda = () => ({ signal: 'none', evidence: '', clue: '' });
const response = (memory = 'HUMAN: nothing yet\nTOLD THEM: nothing yet\nOPEN: nothing yet') => JSON.stringify({ utterances: [{ speaker: 'date', text: 'I would like to hear your actual answer.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory, social: none(), agenda: agenda() });
const doubleResponse = (memory1 = 'HUMAN: Alex likes walks.', memory2 = 'HUMAN: Casey likes films.', utterances: unknown[] = [{ speaker: 'd1', text: 'I can have my own opinion about that.', emotion: 'amused' }]) => JSON.stringify({ utterances, dateUpdates: [{ actorId: 'd1', emotion: 'amused', memory: memory1, social: none(), agenda: agenda() }, { actorId: 'd2', emotion: 'neutral', memory: memory2, social: none(), agenda: agenda() }] });
const script = SHORT_EVALUATION_SCRIPTS[0];

test('the authored corpus contains sixty eight-turn scripts and six thirty-turn continuity cases', () => {
  assert.equal(SHORT_EVALUATION_SCRIPTS.length, 60);
  for (const dateId of ['mira', 'jules', 'dev']) assert.equal(SHORT_EVALUATION_SCRIPTS.filter(s => s.mode === 'solo' && s.dateId === dateId).length, 12);
  assert.equal(SHORT_EVALUATION_SCRIPTS.filter(s => s.mode === 'blind').length, 12);
  assert.equal(SHORT_EVALUATION_SCRIPTS.filter(s => s.mode === 'double').length, 12);
  assert.equal(CONTINUITY_EVALUATION_SCRIPTS.length, 6);
  assert.equal(EVALUATION_SCRIPTS.reduce((sum, s) => sum + s.turns.length, 0), 660);
  assert.equal(new Set(EVALUATION_SCRIPTS.map(s => s.id)).size, 66);
  assert.equal(new Set(EVALUATION_SCRIPTS.map(s => s.title)).size, 66);
  for (const s of EVALUATION_SCRIPTS) {
    assert.equal(s.turns.length, s.suite === 'short' ? 8 : 30);
    assert.equal(new Set(s.turns.map(t => t.text)).size, s.turns.length, `${s.id} repeats its own input`);
    assert.ok(s.reviewFor.length > 40);
    assert.ok(s.turns.every(t => t.text.length > 8 && t.text.length <= 2000));
    if (s.mode === 'blind') assert.ok(s.blindSeed);
    if (s.mode === 'double') { assert.equal(new Set(s.dateIds).size, 2); assert.deepEqual([...new Set(s.turns.map(t => t.human))].sort(), ['h1', 'h2']); assert.ok(s.turns.every(t => t.target)); }
    if (s.suite === 'continuity') assert.ok(s.checkpoints?.some(c => c.afterTurn === 30 && c.mustRecall.length > 0 && c.mustNotClaim.length > 0));
  }
});

test('Solo and seeded Blind use the production system, structured schema and prose note', () => {
  for (const s of [script, SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'blind')!]) {
    const runtime = new EvaluationConversation(s, 'claude-haiku-5-5'), request = runtime.request(0), view = runtime.views.h1;
    assert.equal(request.system, soloSystem({ dateId: view.dateId, blindDate: view.blindDate, model: request.model }));
    assert.deepEqual(request.outputSchema, TURN_SCHEMA);
    assert.equal(request.maxTokens, 700);
    assert.ok(request.messages.at(-1)!.content.includes(s.turns[0].text));
    assert.ok(request.messages.at(-1)!.content.includes('Right now:'));
    assert.ok(request.messages.at(-1)!.content.includes('Your notes'));
    if (s.blindSeed) { assert.equal(view.dateId, createBlindDate(s.blindSeed).dateId); assert.ok(request.system.includes(createBlindDate(s.blindSeed).personality)); }
  }
});

test('an actual notebook and delivered transcript enter the next request without being replaced by fixture answers', () => {
  const runtime = new EvaluationConversation(script, 'claude-haiku-5-5');
  runtime.request(0);
  const raw = response('HUMAN: the human shares fries\nTOLD THEM: likes an honest answer\nOPEN: a real question');
  runtime.commit(0, runtime.validate(raw));
  const next = runtime.request(1), rendered = next.messages.map(m => m.content).join('\n');
  assert.ok(rendered.includes('HUMAN: the human shares fries'));
  assert.ok(rendered.includes(`${getDate(script.dateId)!.name}: I would like to hear your actual answer.`));
  assert.ok(rendered.includes(script.turns[0].text));
  assert.ok(rendered.includes(script.turns[1].text));
  assert.ok(!rendered.includes('"spokenResponse"'));
});

test('interrupted delivery stays explicitly partial in the next note and transcript', () => {
  const s = SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'mira-interrupted-story')!, runtime = new EvaluationConversation(s, 'ai-horde');
  runtime.request(0); runtime.commit(0, runtime.validate(response()));
  const next = runtime.request(1).messages.map(m => m.content).join('\n');
  assert.match(next, /cut off/);
  assert.match(next, /heard only|heard roughly/);
  assert.equal(runtime.views.h1.evening.agenda!.clues.length, 0);
});

test('Double uses its production contract, disambiguates member names and preserves an offstage notebook', () => {
  const sameName = SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'double-names')!;
  const named = new EvaluationConversation(sameName, 'claude-haiku-5-5').request(0);
  assert.match(named.messages.at(-1)!.content, /Alex \(first friend\)/);
  assert.match(named.messages.at(-1)!.content, /Alex \(second friend\)/);
  assert.deepEqual(named.outputSchema, DOUBLE_TURN_SCHEMA);
  const s = SHORT_EVALUATION_SCRIPTS.find(s => s.id === 'double-wingman')!, runtime = new EvaluationConversation(s, 'claude-haiku-5-5');
  runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('HUMAN: own original private detail.')));
  const before = runtime.views.h1.memory, departed = runtime.request(2);
  assert.match(departed.messages.at(-1)!.content, /has left the table/);
  const schema = departed.outputSchema as typeof DOUBLE_TURN_SCHEMA;
  assert.ok(!schema.properties.utterances.items.properties.speaker.enum.includes('d1'));
  runtime.commit(2, runtime.validate(doubleResponse('HUMAN: fabricated later detail.', 'HUMAN: actual remaining detail.', [{ speaker: 'd2', text: 'We can keep talking.', emotion: 'warm' }])));
  assert.equal(runtime.views.h1.memory, before);
  assert.equal(runtime.views.h2.memory, 'HUMAN: actual remaining detail.');
});

test('explicit run budgets and distinct valid selections are mandatory before any provider can be constructed', () => {
  assert.throws(() => parseEvaluationOptions(['--run']), /explicit --budget/);
  assert.throws(() => parseEvaluationOptions(['--run', '--budget', '0']), /only --models horde/);
  assert.throws(() => parseEvaluationOptions(['--budget', 'NaN']), /explicit USD/);
  assert.throws(() => parseEvaluationOptions(['--budget', '11']), /between/);
  assert.throws(() => parseEvaluationOptions(['--models', 'haiku,haiku']), /distinct/);
  assert.throws(() => parseEvaluationOptions(['--scripts', 'imaginary']), /must exist/);
  const options = parseEvaluationOptions(['--run', '--budget', '0', '--models', 'horde', '--scripts', script.id]);
  assert.equal(options.budgetUSD, 0); assert.equal(options.models[0], 'ai-horde');
  assert.equal(evaluationPreview(options).plannedRequests, 8);
  assert.equal(parseEvaluationOptions(['--run', '--help']).run, false);
});

test('the CLI dry run creates no reports, does not read a credential file and cannot make a provider call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'date-eval-dry-'));
  try {
    await mkdir(join(directory, '.qa')); await writeFile(join(directory, '.qa', 'date-model-comparison.json'), 'existing report');
    await mkdir(join(directory, '.env')); // Any attempted credential-file read would fail with EISDIR.
    const env = { ...process.env, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', ELEVENLABS_API_KEY: '', AI_HORDE_API_KEY: '' };
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', new URL('./fixtures/evaluation-network-guard.mjs', import.meta.url).href, resolve('scripts/compare-date-models.ts'), '--scripts', script.id, '--models', 'haiku'], { cwd: directory, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /zero API calls/);
    assert.equal(await readFile(join(directory, '.qa', 'date-model-comparison.json'), 'utf8'), 'existing report');
    assert.deepEqual((await readdir(directory)).sort(), ['.env', '.qa']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('one call per scripted turn records first utterance separately from completion and leaves human quality unrated', async () => {
  let clock = 0; const requests: ClaudeRequest[] = [];
  const adapter: ClaudeAdapter = { async *stream(request) {
    requests.push(request); const start = clock, raw = response();
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 0 } };
    clock = start + 7; yield { type: 'text', text: raw.slice(0, 30) };
    clock = start + 17; yield { type: 'text', text: raw.slice(30) };
    clock = start + 25; yield { type: 'usage', usage: { outputTokens: 40 } };
  } };
  const report = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: 1, adapters: { 'claude-haiku-5-5': adapter }, now: () => clock });
  assert.equal(requests.length, 8); assert.equal(report.requests, 8); assert.equal(report.automaticRetries, 0);
  assert.equal(report.results[0].status, 'complete');
  assert.deepEqual(report.results[0].turns.map(row => [row.firstTextMs, row.firstUtteranceMs, row.totalResponseMs]), Array.from({ length: 8 }, () => [7, 17, 25]));
  assert.ok(report.results[0].turns.every(row => row.valid && row.usageComplete && row.estimatedCostUSD !== null));
  assert.deepEqual(report.results[0].review.ratings, DATE_EVALUATION_RUBRIC);
  assert.equal(report.results[0].review.status, 'unrated'); assert.equal(report.results[0].review.hardFailures, null);
  assert.equal(report.speechMeasured, false);
  assert.deepEqual(report.modelSummaries[0].firstUtterance, { samples: 8, p50Ms: 17, p95Ms: 17 });
  assert.deepEqual(report.modelSummaries[0].totalResponse, { samples: 8, p50Ms: 25, p95Ms: 25 });
  assert.equal(report.modelSummaries[0].humanQualityStatus, 'unrated');
});

test('a too-small paid budget makes zero calls and a free model never falls back to a paid adapter', async () => {
  let paid = 0, free = 0;
  const paidAdapter: ClaudeAdapter = { async *stream() { paid++; yield { type: 'text', text: response() }; } };
  const denied = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: .0000001, adapters: { 'claude-haiku-5-5': paidAdapter } });
  assert.equal(paid, 0); assert.equal(denied.requests, 0); assert.equal(denied.results[0].status, 'budget_exhausted');
  const freeAdapter: ClaudeAdapter = { async *stream() { free++; yield { type: 'text', text: response() }; } };
  const report = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': freeAdapter, 'claude-haiku-5-5': paidAdapter } });
  assert.equal(free, 8); assert.equal(paid, 0); assert.equal(report.accountedCostUSD, 0);
});

test('damaged dialogue stops that script once, preserves raw evidence and conservatively accounts incomplete usage', async () => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; yield { type: 'text', text: '{"utterances":[]}' }; } };
  const report = await runConversationEvaluation({ scripts: [script], models: ['claude-haiku-5-5'], budgetUSD: 1, adapters: { 'claude-haiku-5-5': adapter } });
  const row = report.results[0].turns[0];
  assert.equal(calls, 1); assert.equal(report.results[0].status, 'failed');
  assert.equal(row.rawResponse, '{"utterances":[]}'); assert.equal(row.error?.kind, 'validation');
  assert.equal(row.estimatedCostUSD, null); assert.equal(row.accountedCostUSD, evaluationReservation(row.request));
  assert.equal(row.valid, false); assert.equal(row.notebook.h1.memory, '');
});

test('an adapter that ignores abort cannot hang evaluation or cause an automatic retry', async () => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; await new Promise<void>(() => {}); yield { type: 'text', text: response() }; } };
  const report = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': adapter }, timeoutMs: 5 });
  assert.equal(calls, 1); assert.equal(report.results[0].turns[0].error?.kind, 'timeout');
  assert.equal(report.results[0].status, 'failed'); assert.equal(report.results[0].turns[0].firstUtteranceMs, null);
});

test('provider failures are distinct from quality grades and Double silence remains a valid unrated response', async () => {
  const failure: ClaudeAdapter = { async *stream() { throw new DateApiError(503, 'horde_model', 'No volunteer worker is currently available.'); } };
  const failed = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': failure } });
  assert.equal(failed.results[0].turns[0].error?.code, 'horde_model'); assert.equal(failed.results[0].turns[0].error?.kind, 'provider');
  const double = SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!;
  const silent: ClaudeAdapter = { async *stream() { yield { type: 'text', text: doubleResponse('', '', []) }; } };
  const report = await runConversationEvaluation({ scripts: [double], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': silent } });
  assert.equal(report.results[0].status, 'complete');
  assert.ok(report.results[0].turns.every(row => row.valid && row.firstUtteranceMs === null && row.utteranceCount === 0));
  assert.deepEqual(report.results[0].review.ratings, DATE_EVALUATION_RUBRIC);
});

test('all 660 authored turns execute through stateful production builders with injected providers only', async () => {
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream(request) {
    calls++;
    const isDouble = Object.hasOwn(request.outputSchema?.properties ?? {}, 'dateUpdates');
    yield { type: 'text', text: isDouble ? doubleResponse() : response() };
  } };
  const report = await runConversationEvaluation({ scripts: EVALUATION_SCRIPTS, models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': adapter } });
  assert.equal(calls, 660); assert.equal(report.requests, 660); assert.equal(report.results.length, 66);
  assert.ok(report.results.every(result => result.status === 'complete' && result.turns.length === result.plannedTurns));
  assert.ok(report.results.every(result => result.review.status === 'unrated' && Object.values(result.review.ratings).every(rating => rating === null)));
  assert.ok(report.results.filter(result => result.checkpoints.length).every(result => result.checkpoints.every(checkpoint => checkpoint.notebook !== null && checkpoint.status === 'unrated')));
  assert.equal(report.accountedCostUSD, 0);
});

test('the CI provider guard prevents a request before network access and fails even when the application catches it', () => {
  const result = spawnSync(process.execPath, ['--import', new URL('./fixtures/evaluation-network-guard.mjs', import.meta.url).href, '--eval', "Promise.resolve().then(() => fetch('https://api.anthropic.com/v1/messages')).catch(() => {});"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 86);
});

test('report provenance is injected and baseline comparison remains explicitly unrated', async () => {
  const adapter: ClaudeAdapter = { async *stream() { yield { type: 'text', text: response() }; } };
  const sourceRevision = 'a'.repeat(40);
  const known = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': adapter }, sourceRevision, sourceTreeDirty: false });
  assert.equal(known.sourceRevision, sourceRevision); assert.equal(known.sourceTreeDirty, false);
  assert.equal(known.evaluatedSourceRevision, sourceRevision); assert.equal(known.harnessRevision, sourceRevision); assert.equal(known.instrumentationSha256, null);
  assert.match(known.corpusSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(known.selectedScripts, [script]); assert.notEqual(known.selectedScripts[0], script);
  assert.deepEqual(known.modelSettings, evaluationModelSettings(['ai-horde']));
  assert.equal(known.reviewGuide.baselineComparison.status, 'unrated');
  assert.equal(known.reviewGuide.baselineComparison.baselineReport, null);
  assert.equal(known.reviewGuide.baselineComparison.candidateReport, null);
  const unknown = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': adapter }, sourceRevision: 'not-a-revision' });
  assert.equal(unknown.sourceRevision, 'unknown'); assert.equal(unknown.sourceTreeDirty, null);
  assert.equal(unknown.corpusSha256, known.corpusSha256);
  const baseline = await runConversationEvaluation({ scripts: [script], models: ['ai-horde'], budgetUSD: 0, adapters: { 'ai-horde': adapter }, sourceRevision,
    evaluatedSourceRevision: 'b'.repeat(40), harnessRevision: sourceRevision, instrumentationSha256: 'c'.repeat(64) });
  assert.equal(baseline.evaluatedSourceRevision, 'b'.repeat(40)); assert.equal(baseline.harnessRevision, sourceRevision);
  assert.equal(baseline.instrumentationSha256, 'c'.repeat(64)); assert.equal(baseline.reviewGuide.baselineComparison.status, 'unrated');
});

test('model settings record requested Horde identities and transport caps without serializing credentials', () => {
  const env = { AI_HORDE_MODEL: '  fictional/configured-model  ', AI_HORDE_API_KEY: 'private-fixture-key', ANTHROPIC_API_KEY: 'private-paid-key' };
  const bridge = evaluationModelSettings(['ai-horde'], env)[0];
  assert.equal(bridge.upstreamModel, 'fictional/configured-model'); assert.equal(bridge.transport, 'horde-openai');
  assert.equal(bridge.maxTokens, 700); assert.equal(bridge.effectiveMaxTokens, 512);
  assert.deepEqual(bridge.routingConfig?.requestedModels, ['fictional/configured-model']); assert.equal(bridge.routingConfig?.actualWorkerObserved, false);
  assert.equal(evaluationModelSettings(['ai-horde'])[0].upstreamModel, DEFAULT_HORDE_MODEL);
  const native = evaluationModelSettings(['ai-horde'], { ...env, AI_HORDE_TRANSPORT: 'native', AI_HORDE_TIMEOUT_MS: '999999' })[0];
  assert.equal(native.transport, 'horde-native'); assert.equal(native.providerTimeoutMs, 120000); assert.equal(native.upstreamModel, bridge.upstreamModel);
  const pool = evaluationModelSettings(['ai-horde'], { AI_HORDE_TRANSPORT: 'native' })[0];
  assert.equal(pool.upstreamModel, null); assert.equal(pool.routingConfig?.selection, 'reviewed-native-pool'); assert.equal(pool.routingConfig?.requestedModels, null);
  assert.ok(!JSON.stringify([bridge, native, pool]).includes('private-'));
});

test('Solo and Double acceptance retire a stopped optional premise while preserving a factual promise', () => {
  const notebook = 'HUMAN: grew up in Leeds\nTOLD THEM: learned to repair a radio\nOPEN: recommend a book next time; shared premise: we are rival fry diplomats';
  for (const original of [script, SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!]) {
    const fixture = { ...original, turns: original.turns.map((turn, index) => index === 1 ? { ...turn, text: 'Please stop joking about that. Change the subject.' } : { ...turn }) };
    const runtime = new EvaluationConversation(fixture, 'ai-horde');
    runtime.request(0); runtime.commit(0, runtime.validate(original.mode === 'double' ? doubleResponse(notebook, notebook) : response(notebook)));
    assert.match(runtime.views.h1.memory, /shared premise:/);
    runtime.request(1); runtime.commit(1, runtime.validate(original.mode === 'double' ? doubleResponse(notebook, notebook) : response(notebook)));
    assert.ok(!runtime.views.h1.memory.includes('shared premise:'));
    assert.match(runtime.views.h1.memory, /grew up in Leeds/);
    assert.match(runtime.views.h1.memory, /recommend a book next time/);
    if (original.mode === 'double') { assert.ok(!runtime.views.h2.memory.includes('shared premise:')); assert.match(runtime.views.h2.memory, /recommend a book next time/); }
  }
});
