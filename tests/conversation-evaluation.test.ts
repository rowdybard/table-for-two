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
import { DOLPHIN_LLM_MODEL, DOLPHIN_MODEL } from '../src/restaurant/types';

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

test('Solo evaluation never clarifies an older heard line after a newer unheard or interrupted reply', () => {
  const lines = ['I have strong opinions about croissants.', 'I actually prefer pancakes today.'];
  for (const delivery of ['heard', 'unheard', 'interrupted'] as const) {
    const fixture = { ...script, turns: [{ text: 'Tell me your opinion.' }, { text: 'Tell me something else.', previousDelivery: 'heard' as const },
      { text: 'What do you mean?', via: 'voice' as const, previousDelivery: delivery, quietSeconds: 75 }] };
    const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
    for (const [index, text] of lines.entries()) {
      runtime.request(index);
      const turn = JSON.parse(response()); turn.utterances[0].text = text;
      runtime.commit(index, runtime.validate(JSON.stringify(turn)));
    }
    const note = runtime.request(2).messages.at(-1)!.content;
    assert.doesNotMatch(note, /asking about your last line.*croissants/);
    if (delivery === 'heard') {
      assert.match(note, /asking about your last line.*pancakes/);
      assert.match(note, /It was quiet for a minute or two/);
      assert.doesNotMatch(note, /kept talking before|still speaking/);
    } else {
      assert.doesNotMatch(note, /asking about your last line|It was quiet/);
      if (delivery === 'unheard') assert.match(note, /kept talking before your last reply reached them/);
      else assert.match(note, /still speaking; you were cut off/);
    }
  }
});

test('Solo evaluation treats only the last partially delivered line as the overlap and ignores subthreshold quiet gaps', () => {
  const fixture = { ...script, turns: [{ text: 'Tell me your opinion.' }, { text: 'Wait, let me explain.', via: 'voice' as const,
    previousDelivery: 'interrupted' as const, quietSeconds: 75 }, { text: 'That makes sense.', quietSeconds: 10 }] };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  runtime.request(0);
  const turn = JSON.parse(response());
  turn.utterances = [{ speaker: 'date', text: 'I enjoy cold weather.', emotion: 'warm' }, { speaker: 'date', text: 'Pancakes are best on a rainy morning.', emotion: 'warm' }];
  runtime.commit(0, runtime.validate(JSON.stringify(turn)));
  const overlap = runtime.request(1).messages.at(-1)!.content;
  assert.match(overlap, /cut off after.*Pancakes/);
  assert.doesNotMatch(overlap, /cut off after.*cold weather|It was quiet/);
  runtime.commit(1, runtime.validate(response()));
  assert.doesNotMatch(runtime.request(2).messages.at(-1)!.content, /It was quiet/);
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
  for (const url of ['https://api.anthropic.com/v1/messages', 'https://dolphinllm.com/v1/chat/completions']) {
    const result = spawnSync(process.execPath, ['--import', new URL('./fixtures/evaluation-network-guard.mjs', import.meta.url).href, '--eval', `Promise.resolve().then(() => fetch('${url}')).catch(() => {});`], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 86);
  }
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
  assert.equal(bridge.routingConfig?.contextFit, 'grow');
  assert.equal(bridge.routingConfig?.responseFormat, 'json_schema'); assert.equal(bridge.routingConfig?.schemaStrict, true);
  assert.equal(evaluationModelSettings(['ai-horde'])[0].upstreamModel, DEFAULT_HORDE_MODEL);
  const native = evaluationModelSettings(['ai-horde'], { ...env, AI_HORDE_TRANSPORT: 'native', AI_HORDE_TIMEOUT_MS: '999999' })[0];
  assert.equal(native.transport, 'horde-native'); assert.equal(native.providerTimeoutMs, 120000); assert.equal(native.upstreamModel, bridge.upstreamModel);
  assert.equal(native.routingConfig?.contextFit, 'reject');
  assert.equal('responseFormat' in native.routingConfig!, false); assert.equal('schemaStrict' in native.routingConfig!, false);
  const pool = evaluationModelSettings(['ai-horde'], { AI_HORDE_TRANSPORT: 'native' })[0];
  assert.equal(pool.upstreamModel, null); assert.equal(pool.routingConfig?.selection, 'reviewed-native-pool'); assert.equal(pool.routingConfig?.requestedModels, null);
  assert.ok(!JSON.stringify([bridge, native, pool]).includes('private-'));
});

test('Solo and Double acceptance retire a stopped optional premise while preserving a factual promise', () => {
  const notebook = 'HUMAN: grew up in Leeds\nTOLD THEM: learned to repair a radio\nOPEN: recommend a book next time; shared premise: we are rival fry diplomats';
  for (const original of [script, SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!]) {
    const fixture = { ...original, turns: original.turns.map((turn, index) => index === 1 ? { ...turn, human: 'h1' as const, text: 'Please stop joking about that. Change the subject.' } : { ...turn }) };
    const runtime = new EvaluationConversation(fixture, 'ai-horde');
    const bothDates = [{ speaker: 'd1', text: 'I will recommend a book.', emotion: 'warm' }, { speaker: 'd2', text: 'I will recommend one too.', emotion: 'warm' }];
    runtime.request(0); runtime.commit(0, runtime.validate(original.mode === 'double' ? doubleResponse(notebook, notebook, bothDates) : response(notebook)));
    assert.match(runtime.views.h1.memory, /shared premise:/);
    runtime.request(1); runtime.commit(1, runtime.validate(original.mode === 'double' ? doubleResponse(notebook, notebook) : response(notebook)));
    assert.ok(!runtime.views.h1.memory.includes('shared premise:'));
    assert.match(runtime.views.h1.memory, /grew up in Leeds/);
    assert.match(runtime.views.h1.memory, /recommend a book next time/);
    if (original.mode === 'double') { assert.match(runtime.views.h2.memory, /shared premise:/); assert.match(runtime.views.h2.memory, /recommend a book next time/); }
  }
});


test('Venice selection uses priced OpenRouter settings and keeps zero-budget runs free', async () => {
  assert.deepEqual(parseEvaluationOptions([]).models, ['claude-haiku-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(parseEvaluationOptions(['--models', 'venice']).models, [DOLPHIN_MODEL]);
  assert.deepEqual(parseEvaluationOptions(['--models', 'dolphin']).models, [DOLPHIN_LLM_MODEL]);
  assert.throws(() => parseEvaluationOptions(['--run', '--models', 'dolphin', '--budget', '0']), /only --models horde/);
  assert.throws(() => parseEvaluationOptions(['--models', 'dolphin,imaginary-model']), /distinct models/);
  let calls = 0;
  const adapter: ClaudeAdapter = { async *stream() { calls++; throw new Error('unexpected'); } };
  await assert.rejects(runConversationEvaluation({ scripts: [script], models: [DOLPHIN_MODEL], budgetUSD: 0, adapters: { [DOLPHIN_MODEL]: adapter } }), /zero budget/);
  assert.equal(calls, 0);
  const setting = evaluationModelSettings([DOLPHIN_MODEL], { OPENROUTER_API_KEY: 'secret-fixture' })[0];
  assert.equal(setting.upstreamModel, DOLPHIN_MODEL); assert.equal(setting.transport, 'openrouter-chat-completions');
  assert.equal(setting.maxTokens, 700); assert.equal(setting.effectiveMaxTokens, 700);
  assert.deepEqual(setting.routingConfig, { selection: 'fixed-model', requestedModels: [DOLPHIN_MODEL], responseFormat: 'json_object', allowFallbacks: false, requireParameters: true });
  assert.ok(!JSON.stringify(setting).includes('secret-fixture'));
});

test('Dolphin evaluation carries actual prior responses and notebook, prices usage, and does not fall back', async () => {
  const requests: ClaudeRequest[] = [];
  const adapter: ClaudeAdapter = { async *stream(request) {
    requests.push(request);
    yield { type: 'text', text: response('HUMAN: shares fries\nTOLD THEM: prefers honesty\nOPEN: ask about music') };
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40 } };
  } };
  const report = await runConversationEvaluation({ scripts: [script], models: [DOLPHIN_MODEL], budgetUSD: 1, adapters: { [DOLPHIN_MODEL]: adapter } });
  assert.equal(requests.length, 8); assert.equal(report.results[0].status, 'complete');
  assert.equal(requests[0].model, DOLPHIN_MODEL); assert.equal(requests[0].maxTokens, 700);
  const next = requests[1].messages.map(message => message.content).join('\n');
  assert.match(next, /HUMAN: shares fries/); assert.match(next, /I would like to hear your actual answer/);
  assert.equal(report.results[0].turns[0].reportedCostUSD, (100 * .20 + 40 * .90) / 1e6);
  assert.equal(report.automaticRetries, 0); assert.equal(report.providerCallsPerHumanTurn, 1);
  let fallbackCalls = 0, failedCalls = 0;
  const failed: ClaudeAdapter = { async *stream() { failedCalls++; throw new Error('offline'); } };
  const fallback: ClaudeAdapter = { async *stream() { fallbackCalls++; yield { type: 'text', text: response() }; } };
  const failure = await runConversationEvaluation({ scripts: [script], models: [DOLPHIN_MODEL], budgetUSD: 1, adapters: { [DOLPHIN_MODEL]: failed, 'ai-horde': fallback } });
  assert.equal(failedCalls, 1); assert.equal(fallbackCalls, 0); assert.equal(failure.results[0].status, 'failed');
});

test('direct Dolphin uses its own route, alias, explicit budget and input/output prices', async () => {
  const setting = evaluationModelSettings([DOLPHIN_LLM_MODEL], { DOLPHIN_LLM_API_KEY: 'secret-fixture' })[0];
  assert.equal(setting.upstreamModel, 'uncensored'); assert.equal(setting.transport, 'dolphinllm-chat-completions');
  assert.deepEqual(setting.routingConfig, { selection: 'fixed-endpoint-and-model-alias', requestedModels: ['uncensored'], endpoint: 'https://dolphinllm.com/v1/chat/completions', responseFormat: 'json_object', temperature: .8, actualBaseModelObserved: false, actualProviderObserved: false });
  assert.ok(!JSON.stringify(setting).includes('secret-fixture'));
  const calls: ClaudeRequest[] = [];
  const adapter: ClaudeAdapter = { async *stream(request) { calls.push(request); yield { type: 'text', text: response() }; yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 40 } }; } };
  const report = await runConversationEvaluation({ scripts: [script], models: [DOLPHIN_LLM_MODEL], budgetUSD: 1, adapters: { [DOLPHIN_LLM_MODEL]: adapter } });
  assert.equal(calls.length, 8); assert.equal(report.results[0].status, 'complete');
  assert.equal(report.results[0].turns[0].reportedCostUSD, (100 * .15 + 40 * .50) / 1e6);
  assert.equal(report.automaticRetries, 0); assert.equal(report.providerCallsPerHumanTurn, 1);
});

test('Dolphin CLI checks only the selected provider credentials after dry run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'date-dolphin-eval-'));
  const cli = resolve('scripts/compare-date-models.ts');
  const launch = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', new URL('./fixtures/evaluation-network-guard.mjs', import.meta.url).href, cli, '--scripts', script.id, ...args], { cwd: directory, env, encoding: 'utf8', timeout: 20000 });
  try {
    const empty = { ...process.env, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', DOLPHIN_LLM_API_KEY: '', DATE_HAIKU_MODEL: 'unpriced-alias' };
    const dry = launch(empty, '--models', 'venice'); assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /zero API calls/);
    const missing = launch(empty, '--models', 'venice', '--run', '--budget', '1'); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /OPENROUTER_API_KEY is missing/);
    const funded = launch({ ...empty, OPENROUTER_API_KEY: 'synthetic-key' }, '--models', 'venice', '--run', '--budget', '.0000001');
    assert.equal(funded.status, 0, funded.stderr); const report = JSON.parse(await readFile(join(directory, '.qa', 'date-model-comparison.json'), 'utf8'));
    assert.equal(report.requests, 0); assert.equal(report.results[0].status, 'budget_exhausted'); assert.ok(!JSON.stringify(report).includes('synthetic-key'));
    const anthropic = launch({ ...empty, OPENROUTER_API_KEY: 'synthetic-key' }, '--models', 'haiku', '--run', '--budget', '1');
    assert.notEqual(anthropic.status, 0); assert.match(anthropic.stderr, /ANTHROPIC_API_KEY is missing/);
    const unpriced = launch({ ...empty, ANTHROPIC_API_KEY: 'synthetic-key' }, '--models', 'haiku', '--run', '--budget', '1');
    assert.notEqual(unpriced.status, 0); assert.match(unpriced.stderr, /Custom model aliases are not covered/);
    const missingDirect = launch({ ...empty, OPENROUTER_API_KEY: 'synthetic-key' }, '--models', 'dolphin', '--run', '--budget', '1');
    assert.notEqual(missingDirect.status, 0); assert.match(missingDirect.stderr, /DOLPHIN_LLM_API_KEY is missing/);
    const direct = launch({ ...empty, DOLPHIN_LLM_API_KEY: 'synthetic-key' }, '--models', 'dolphin', '--run', '--budget', '.0000001');
    assert.equal(direct.status, 0, direct.stderr); const directReport = JSON.parse(await readFile(join(directory, '.qa', 'date-model-comparison.json'), 'utf8'));
    assert.equal(directReport.requests, 0); assert.equal(directReport.results[0].status, 'budget_exhausted');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('evaluation notebooks do not claim unheard Solo disclosures or promises', () => {
  const fixture = { ...script, turns: script.turns.map((turn, index) => index === 2 ? { ...turn, previousDelivery: 'unheard' as const } : { ...turn }) };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  const earlier = 'HUMAN: collects blue umbrellas\nTOLD THEM: grew up by the sea\nOPEN: promise to share a song';
  const proposed = 'HUMAN: collects blue umbrellas and likes jazz\nTOLD THEM: lived on Mars\nOPEN: promise to visit Mars';
  runtime.request(0); runtime.commit(0, runtime.validate(response(earlier)));
  runtime.request(1); runtime.commit(1, runtime.validate(response(proposed)));
  assert.match(runtime.views.h1.memory, /likes jazz/);
  assert.match(runtime.views.h1.memory, /grew up by the sea/); assert.match(runtime.views.h1.memory, /promise to share a song/);
  assert.doesNotMatch(runtime.views.h1.memory, /Mars/);
  const next = runtime.request(2).messages.map(item => item.content).join('\n');
  assert.match(next, /grew up by the sea/); assert.doesNotMatch(next, /Mars/);
});

test('Double evaluation commits each date’s new disclosures only when the paired listener heard them', () => {
  const original = SHORT_EVALUATION_SCRIPTS.find(item => item.mode === 'double')!;
  const fixture = { ...original, turns: original.turns.map((turn, index) => index === 2 ? { ...turn, human: 'h1' as const, previousDelivery: 'unheard' as const } : { ...turn }) };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  const both = [{ speaker: 'd1', text: 'I brought an old record.', emotion: 'warm' }, { speaker: 'd2', text: 'I enjoy walking by the sea.', emotion: 'warm' }];
  runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('HUMAN: Alex likes jazz\nTOLD THEM: brought a record\nOPEN: share a song', 'HUMAN: Casey likes tea\nTOLD THEM: likes the sea\nOPEN: choose a walk', both)));
  runtime.request(1); runtime.commit(1, runtime.validate(doubleResponse('HUMAN: Alex likes jazz and coffee\nTOLD THEM: owns a ship\nOPEN: promise a voyage', 'HUMAN: Casey likes tea and coffee\nTOLD THEM: likes the sea and cliffs\nOPEN: promise a walk', both)));
  assert.match(runtime.views.h1.memory, /likes jazz and coffee/); assert.match(runtime.views.h1.memory, /brought a record/); assert.doesNotMatch(runtime.views.h1.memory, /owns a ship|promise a voyage/);
  assert.match(runtime.views.h2.memory, /likes tea and coffee/); assert.match(runtime.views.h2.memory, /likes the sea and cliffs/); assert.match(runtime.views.h2.memory, /promise a walk/);
});

test('Double evaluation silence cannot establish either date’s unspoken disclosures', () => {
  const original = SHORT_EVALUATION_SCRIPTS.find(item => item.mode === 'double')!;
  const runtime = new EvaluationConversation(original, 'claude-haiku-5-5');
  const both = [{ speaker: 'd1', text: 'I brought an old record.', emotion: 'warm' }, { speaker: 'd2', text: 'I enjoy walking by the sea.', emotion: 'warm' }];
  runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('HUMAN: Alex likes jazz\nTOLD THEM: brought a record\nOPEN: share a song', 'HUMAN: Casey likes tea\nTOLD THEM: likes the sea\nOPEN: choose a walk', both)));
  runtime.request(1); runtime.commit(1, runtime.validate(doubleResponse('HUMAN: Alex likes jazz and coffee\nTOLD THEM: owns a ship\nOPEN: promise a voyage', 'HUMAN: Casey likes tea and coffee\nTOLD THEM: likes cliffs\nOPEN: promise a hike', [])));
  assert.match(runtime.views.h1.memory, /likes jazz and coffee/); assert.match(runtime.views.h1.memory, /brought a record/); assert.doesNotMatch(runtime.views.h1.memory, /owns a ship|promise a voyage/);
  assert.match(runtime.views.h2.memory, /likes tea and coffee/); assert.match(runtime.views.h2.memory, /likes the sea/); assert.doesNotMatch(runtime.views.h2.memory, /likes cliffs|promise a hike/);
});


test('an accepted Solo stop retires its shared premise before the provider can fail or respond', () => {
  const notebook = 'HUMAN: grew up in Leeds\nTOLD THEM: repaired a radio\nOPEN: promise to recommend a book; shared premise: rival fry diplomats';
  const fixture = { ...script, turns: script.turns.map((turn, index) => index === 1 ? { ...turn, text: 'Please stop joking about that. Change the subject.' } : { ...turn }) };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  runtime.request(0); runtime.commit(0, runtime.validate(response(notebook)));
  const first = runtime.request(1), second = runtime.request(1);
  assert.deepEqual(second, first, 'repeated construction of the same accepted turn is idempotent');
  assert.match(runtime.views.h1.memory, /grew up in Leeds/); assert.match(runtime.views.h1.memory, /repaired a radio/); assert.match(runtime.views.h1.memory, /promise to recommend a book/); assert.doesNotMatch(runtime.views.h1.memory, /shared premise/);
  // No commit models a failed or unheard provider response.
  const next = runtime.request(2).messages.map(item => item.content).join('\n');
  assert.match(next, /promise to recommend a book/); assert.doesNotMatch(next, /shared premise: rival fry diplomats/);
});

test('an accepted Double stop retires only the speaking pair’s premise even without a response', () => {
  const original = SHORT_EVALUATION_SCRIPTS.find(item => item.mode === 'double')!;
  const fixture = { ...original, turns: original.turns.map((turn, index) => index === 1 ? { ...turn, human: 'h1' as const, text: 'Please stop joking about that. Change the subject.' } : { ...turn }) };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  const first = 'HUMAN: Alex likes jazz\nTOLD THEM: repaired a radio\nOPEN: promise a book; shared premise: fry diplomats';
  const other = 'HUMAN: Casey likes tea\nTOLD THEM: likes the sea\nOPEN: promise a walk; shared premise: moon orchestra';
  const both = [{ speaker: 'd1', text: 'I repaired a radio.', emotion: 'warm' }, { speaker: 'd2', text: 'I like the sea.', emotion: 'warm' }];
  runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse(first, other, both)));
  runtime.request(1);
  assert.match(runtime.views.h1.memory, /Alex likes jazz/); assert.match(runtime.views.h1.memory, /repaired a radio/); assert.match(runtime.views.h1.memory, /promise a book/); assert.doesNotMatch(runtime.views.h1.memory, /shared premise/);
  assert.equal(runtime.views.h2.memory, other, 'the other couple has not asked to retire its premise');
  // No commit means the stop persists even if the provider failed.
  const next = runtime.request(2).messages.map(item => item.content).join('\n');
  assert.doesNotMatch(next, /shared premise: fry diplomats/); assert.match(next, /shared premise: moon orchestra/);
  const successful = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  successful.request(0); successful.commit(0, successful.validate(doubleResponse(first, other, both)));
  successful.request(1); successful.commit(1, successful.validate(doubleResponse(first, other, both)));
  assert.doesNotMatch(successful.views.h1.memory, /shared premise/);
  assert.match(successful.views.h2.memory, /shared premise: moon orchestra/, 'a successful response cannot erase the other pair’s premise');
});


test('Double evaluation clarification cites only the addressed date actually heard by this speaker', () => {
  const source = SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!;
  const lines = [{ speaker: 'd1', text: 'I have a very particular opinion about rain.', emotion: 'amused' }, { speaker: 'd2', text: 'I would rather be out walking in the sun.', emotion: 'warm' }];
  for (const [target, text, expected] of [
    ['d1', 'What do you mean?', 'Mira'], ['d2', 'What do you mean?', 'Jules'], ['h2', 'What do you mean?', null], ['d1', 'Jules, what do you mean?', 'Jules'],
  ] as const) {
    const fixture = { ...source, dateIds: ['mira', 'jules'] as const, turns: [{ text: 'Hello both of you.', human: 'h1' as const, target: 'table' as const }, { text, human: 'h1' as const, target }] };
    const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
    runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('', '', lines)));
    const note = runtime.request(1).messages.at(-1)!.content;
    if (expected) assert.match(note, new RegExp(`asking about ${expected}`));
    else assert.doesNotMatch(note, /asking about/);
  }
  for (const delivery of ['unheard', 'interrupted'] as const) {
    const fixture = { ...source, dateIds: ['mira', 'jules'] as const, turns: [{ text: 'Hello both of you.', human: 'h1' as const, target: 'table' as const }, { text: 'What do you mean?', human: 'h1' as const, target: 'd1' as const, via: 'voice' as const, previousDelivery: delivery }] };
    const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
    runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('', '', lines)));
    const note = runtime.request(1).messages.at(-1)!.content;
    assert.doesNotMatch(note, /asking about/);
    if (delivery === 'unheard') { assert.doesNotMatch(note, /heard only|talked over/); assert.match(note, /kept talking/); }
    else assert.match(note, /still speaking|cut off/);
  }
});

test('Double evaluation keeps friend names and incidental date mentions out of AI clarification attribution', () => {
  const source = SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!;
  const lines = [{ speaker: 'd1', text: 'I collect tiny railway maps.', emotion: 'amused' }, { speaker: 'd2', text: 'I keep the misprinted ones.', emotion: 'warm' }];
  for (const [humanNames, target, text, expected] of [
    [{ h1: 'Alex', h2: 'Mira' }, 'h2', 'Mira, what do you mean?', null],
    [{ h1: 'Alex', h2: 'Mira' }, 'table', 'Mira, what do you mean?', null],
    [{ h1: 'Alex', h2: 'Casey' }, 'table', 'Casey, what do you mean?', null],
    [{ h1: 'Alex', h2: 'Casey' }, 'd1', 'Jules said something about maps. What do you mean?', 'Mira'],
    [{ h1: 'Alex', h2: 'Casey' }, 'd1', 'Mira and Jules, what do you mean?', 'Mira'],
  ] as const) {
    const fixture = { ...source, dateIds: ['mira', 'jules'] as const, humanNames, turns: [{ text: 'Hello both of you.', human: 'h1' as const, target: 'table' as const }, { text, human: 'h1' as const, target }] };
    const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
    runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('', '', lines)));
    const note = runtime.request(1).messages.at(-1)!.content;
    if (expected) assert.match(note, new RegExp(`asking about ${expected}`));
    else assert.doesNotMatch(note, /asking about/, `${target}: ${text}`);
  }
});

test('Double evaluation does not attribute a friend’s unanswered line to an earlier AI reply', () => {
  const source = SHORT_EVALUATION_SCRIPTS.find(s => s.mode === 'double')!;
  const fixture = { ...source, dateIds: ['mira', 'jules'] as const, turns: [
    { text: 'Tell us something.', human: 'h1' as const, target: 'table' as const },
    { text: 'My house is a lighthouse, apparently.', human: 'h2' as const, target: 'table' as const },
    { text: 'What do you mean?', human: 'h1' as const, target: 'table' as const },
  ] };
  const runtime = new EvaluationConversation(fixture, 'claude-haiku-5-5');
  runtime.request(0); runtime.commit(0, runtime.validate(doubleResponse('', '', [{ speaker: 'd1', text: 'I collect tiny railway maps.', emotion: 'amused' }])));
  runtime.request(1); runtime.commit(1, runtime.validate(doubleResponse('', '', [])));
  assert.doesNotMatch(runtime.request(2).messages.at(-1)!.content, /asking about Mira|asking about Jules/);
});
