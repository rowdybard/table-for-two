import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { EVALUATION_SCRIPTS } from '../src/restaurant/evaluation-fixtures';
import { gateConversationReview, prepareConversationReview, reviewSha256, type CoordinatorKey, type HumanReviewPacket } from '../scripts/lib/conversation-review';

const model = 'claude-haiku-5-5', secret = 'a private test ordering seed, never a human rating';
function report(candidate: boolean, all = false): any {
  const scripts = structuredClone(all ? EVALUATION_SCRIPTS : EVALUATION_SCRIPTS.slice(0, 2));
  const revision = (candidate ? 'b' : 'a').repeat(40);
  return { sourceRevision: revision, sourceTreeDirty: false, evaluatedSourceRevision: candidate ? revision : '1'.repeat(40), harnessRevision: revision,
    instrumentationSha256: candidate ? null : 'c'.repeat(64), selectedScripts: scripts, corpusSha256: reviewSha256(JSON.stringify(scripts)),
    modelSettings: [{ model, upstreamModel: model, transport: 'anthropic-messages', maxTokens: 700, effectiveMaxTokens: 700, timeoutMs: 30000, providerTimeoutMs: null, routingConfig: null }],
    results: scripts.map(script => ({ scriptId: script.id, title: script.title, mode: script.mode, model, plannedTurns: script.turns.length, status: 'complete',
      turns: script.turns.map((input, index) => ({ turn: index + 1, input: input.text, human: input.human ?? 'h1', target: input.target ?? (script.mode === 'double' ? 'table' : 'date'), via: input.via ?? 'typed',
        request: { model, maxTokens: 700, system: 'HIDDEN SYSTEM BOOKKEEPING', messages: [] }, valid: true, error: null,
        rawResponse: JSON.stringify({ utterances: [{ speaker: script.mode === 'double' ? 'd1' : 'date', text: `${candidate ? 'Peach' : 'Pear'} reply: Mira likes this specific detail.`, emotion: 'warm' }], memory: 'PRIVATE INITIAL QUALITY BOOKKEEPING' }) })),
      checkpoints: (script.checkpoints ?? []).map(checkpoint => ({ ...checkpoint, notebook: { h1: { dateId: script.dateId, memory: 'HUMAN: owns a blue bicycle. TOLD THEM: a record story. OPEN: none.', agenda: { private: true } } } })) })) };
}
function prepared(all = false) { return prepareConversationReview(report(false, all), report(true, all), secret); }
/** Synthetic human-shaped rows exercise arithmetic only; these are not actual human quality evidence. */
function syntheticRatings(key: CoordinatorKey, original: HumanReviewPacket[]) {
  const packets = structuredClone(original);
  packets.forEach((packet, index) => {
    packet.reviewer = { id: `Synthetic test reviewer ${index + 1}`, kind: 'human', independent: true };
    for (const pair of packet.pairs) {
      const hidden = key.pairs.find(item => item.id === pair.id)!;
      pair.review.preference = hidden.candidateSide[packet.packetId]; pair.review.reason = 'Synthetic arithmetic fixture only.';
      for (const side of ['A', 'B'] as const) {
        const rating = pair.review[side];
        for (const field of Object.keys(rating.rubric) as (keyof typeof rating.rubric)[]) rating.rubric[field] = 4;
        rating.relevance.forEach(row => { row.addressesLatest = true; row.reason = 'Synthetic latest-turn judgment.'; });
        rating.castIdentity = hidden.cast;
        const quote = pair[side].turns[0].utterances[0]?.text;
        rating.memorable = { earned: !!quote, quote: quote ?? null, reason: 'Synthetic evidence check.' };
        rating.continuity.forEach(row => { row.passed = true; row.reason = 'Synthetic checkpoint judgment.'; });
        rating.hardFailures = [];
      }
    }
  });
  return packets;
}

test('packets are deterministically blinded, counterbalanced, unrated, and separate from the coordinator key', () => {
  const before = report(false, true), after = report(true, true), frozen = JSON.stringify([before, after]);
  const first = prepareConversationReview(before, after, secret), again = prepareConversationReview(before, after, secret);
  assert.deepEqual(first, again); assert.equal(JSON.stringify([before, after]), frozen);
  assert.notDeepEqual(first.packets, prepareConversationReview(before, after, secret + ' changed').packets);
  assert.notEqual(first.packets[0].packetId, first.packets[1].packetId);
  assert.deepEqual(first.reference.cast.map(item => item.name), ['Mira', 'Jules', 'Dev']);
  assert.equal(first.reference.cast.length, 3); assert.ok(first.reference.cast.every(item => item.occupation && item.voice));
  assert.equal('provenance' in first.reference, false); assert.equal('candidateSide' in first.reference, false);
  for (const packet of first.packets) {
    const serialized = JSON.stringify(packet);
    for (const hidden of ['Mira', 'Jules', 'Dev', 'claude-', 'Haiku', 'sourceRevision', 'HIDDEN SYSTEM', 'PRIVATE INITIAL', 'accountedCostUSD']) assert.equal(serialized.includes(hidden), false, hidden);
    assert.equal(packet.reviewer.id, null); assert.equal(packet.reviewer.independent, null);
    for (const pair of packet.pairs) {
      assert.equal(pair.review.preference, null); assert.equal(pair.review.A.castIdentity, null);
      assert.equal(pair.review.B.memorable.earned, null); assert.equal(pair.review.A.hardFailures, null);
      assert.ok(Object.values(pair.review.A.rubric).every(score => score === null));
      assert.ok(pair.review.A.relevance.every(row => row.addressesLatest === null));
      assert.ok(pair.review.B.continuity.every(row => row.passed === null));
    }
    for (const suite of ['short', 'continuity']) {
      const sides = first.key.pairs.filter(pair => pair.suite === suite).map(pair => pair.candidateSide[packet.packetId]);
      assert.equal(sides.filter(side => side === 'A').length, sides.filter(side => side === 'B').length);
    }
  }
  for (const pair of first.key.pairs) assert.notEqual(pair.candidateSide[first.packets[0].packetId], pair.candidateSide[first.packets[1].packetId]);
  const unrated = gateConversationReview(first.key, first.packets, first.key.reports);
  assert.equal(unrated.status, 'blocked'); assert.deepEqual(unrated.metrics, [], 'no gate arithmetic is manufactured before independent human review');
});

test('dirty/unknown provenance, corpus/input/model/response-limit mismatches and unknown upstream pools are rejected', () => {
  const cases: ((value: any) => void)[] = [
    value => { value.sourceTreeDirty = true; }, value => { value.sourceTreeDirty = null; }, value => { value.sourceRevision = 'unknown'; },
    value => { value.harnessRevision = 'unknown'; }, value => { value.evaluatedSourceRevision = 'unknown'; },
    value => { value.corpusSha256 = '0'.repeat(64); }, value => { value.selectedScripts[0].turns[0].text = 'Different input.'; },
    value => { value.results[0].turns[0].input = 'A changed captured input.'; },
    value => { value.results[0].turns[0].request.maxTokens = 512; },
    value => { value.modelSettings[0].maxTokens = 512; }, value => { value.modelSettings[0].upstreamModel = 'another-model'; },
    value => { value.modelSettings[0].effectiveMaxTokens = 512; }, value => { value.modelSettings[0].transport = 'horde-openai'; },
    value => { value.modelSettings[0].upstreamModel = null; }, value => { value.modelSettings[0].model = 'ai-horde'; },
  ];
  for (const mutate of cases) { const changed = report(true); mutate(changed); assert.throws(() => prepareConversationReview(report(false), changed, secret)); }
  const missingInstrumentation = report(false); missingInstrumentation.instrumentationSha256 = null;
  assert.throws(() => prepareConversationReview(missingInstrumentation, report(true), secret), /instrumentation/);
  assert.throws(() => prepareConversationReview(report(true), report(true), secret), /one source revision/);
});

test('matched pinned Horde configurations are reviewable while actual worker identity remains explicitly unobserved', () => {
  const before = report(false), after = report(true);
  for (const value of [before, after]) {
    value.modelSettings = [{ model: 'ai-horde', upstreamModel: 'koboldcpp/reviewed-fixed-model', transport: 'horde-openai', maxTokens: 700, effectiveMaxTokens: 512, timeoutMs: 65000, providerTimeoutMs: 60000,
      routingConfig: { selection: 'configured-model', requestedModels: ['koboldcpp/reviewed-fixed-model'], actualWorkerObserved: false, contextFit: 'reject' } }];
    for (const result of value.results) { result.model = 'ai-horde'; for (const row of result.turns) row.request.model = 'ai-horde'; }
  }
  assert.doesNotThrow(() => prepareConversationReview(before, after, secret));
});

test('matched pinned OpenRouter settings prepare blinded, unrated packets; mismatches and unknown routing are rejected', () => {
  const before = report(false), after = report(true);
  const dolphin = 'cognitivecomputations/dolphin-mistral-24b-venice-edition';
  for (const value of [before, after]) {
    value.modelSettings = [{ model: dolphin, upstreamModel: dolphin, transport: 'openrouter-chat-completions', maxTokens: 700, effectiveMaxTokens: 700, timeoutMs: 30000, providerTimeoutMs: null,
      routingConfig: { selection: 'fixed-model', requestedModels: [dolphin], responseFormat: 'json_object', allowFallbacks: false, requireParameters: true } }];
    for (const result of value.results) for (const row of result.turns) {
      result.model = dolphin; row.request.model = dolphin;
      row.rawResponse = JSON.stringify({ utterances: [{ speaker: 'date', text: `OpenRouter ${dolphin} Dolphin`, emotion: 'neutral' }] });
    }
  }
  const prepared = prepareConversationReview(before, after, secret);
  assert.equal(prepared.key.provenance.modelSettings[0].upstreamModel, dolphin);
  for (const packet of prepared.packets) {
    assert.equal(packet.reviewer.id, null);
    assert.ok(packet.pairs.every(pair => pair.review.preference === null));
    assert.doesNotMatch(JSON.stringify(packet), /openrouter|dolphin|cognitivecomputations|mistral/i);
  }
  const gated = gateConversationReview(prepared.key, prepared.packets, prepared.key.reports);
  assert.equal(gated.status, 'blocked'); assert.deepEqual(gated.metrics, []); assert.equal(gated.automaticJudging, false);
  const synthetic = gateConversationReview(prepared.key, syntheticRatings(prepared.key, prepared.packets), prepared.key.reports);
  assert.match(synthetic.metrics[0].identityEvidence, /actual OpenRouter provider was not observed/);
  for (const mutate of [
    (setting: any) => { setting.upstreamModel = 'other/model'; },
    (setting: any) => { setting.routingConfig.requestedModels = ['other/model']; },
    (setting: any) => { setting.routingConfig.responseFormat = 'json_schema'; },
    (setting: any) => { setting.routingConfig.allowFallbacks = true; },
    (setting: any) => { setting.routingConfig.requireParameters = false; },
    (setting: any) => { setting.effectiveMaxTokens = 512; },
    (setting: any) => { setting.upstreamModel = 'auto'; },
    (setting: any) => { setting.routingConfig = null; },
  ]) {
    const changed = structuredClone(after); mutate(changed.modelSettings[0]);
    assert.throws(() => prepareConversationReview(before, changed, secret));
  }
  const unknownBefore = structuredClone(before), unknownAfter = structuredClone(after);
  unknownBefore.modelSettings[0].routingConfig = null; unknownAfter.modelSettings[0].routingConfig = null;
  assert.throws(() => prepareConversationReview(unknownBefore, unknownAfter, secret), /known routing/);
  const wrongBefore = structuredClone(before), wrongAfter = structuredClone(after);
  for (const value of [wrongBefore, wrongAfter]) {
    value.modelSettings[0].upstreamModel = 'other/model'; value.modelSettings[0].routingConfig.requestedModels = ['other/model'];
  }
  assert.throws(() => prepareConversationReview(wrongBefore, wrongAfter, secret), /pinned upstream/);
});

test('direct Dolphin pairs retain the requested alias and disclose unknown base model and provider', () => {
  const before = report(false), after = report(true), direct = 'dolphinllm/uncensored';
  for (const value of [before, after]) {
    value.modelSettings = [{ model: direct, upstreamModel: 'uncensored', transport: 'dolphinllm-chat-completions', maxTokens: 700, effectiveMaxTokens: 700, timeoutMs: 30000, providerTimeoutMs: null,
      routingConfig: { selection: 'fixed-endpoint-and-model-alias', requestedModels: ['uncensored'], endpoint: 'https://dolphinllm.com/v1/chat/completions', responseFormat: 'json_object', temperature: .8, actualBaseModelObserved: false, actualProviderObserved: false } }];
    for (const result of value.results) { result.model = direct; for (const row of result.turns) { row.request.model = direct; row.rawResponse = JSON.stringify({ utterances: [{ speaker: 'date', text: 'DolphinLLM at dolphinllm.com', emotion: 'neutral' }] }); } }
  }
  const prepared = prepareConversationReview(before, after, secret);
  for (const packet of prepared.packets) { assert.equal(packet.reviewer.id, null); assert.ok(packet.pairs.every(pair => pair.review.preference === null)); assert.doesNotMatch(JSON.stringify(packet), /dolphinllm/i); }
  const unrated = gateConversationReview(prepared.key, prepared.packets, prepared.key.reports);
  assert.equal(unrated.status, 'blocked'); assert.equal(unrated.automaticJudging, false); assert.deepEqual(unrated.metrics, []);
  const synthetic = gateConversationReview(prepared.key, syntheticRatings(prepared.key, prepared.packets), prepared.key.reports);
  assert.match(synthetic.metrics[0].identityEvidence, /base model and serving provider were not observed/);
  for (const mutate of [
    (setting: any) => { setting.upstreamModel = 'another'; },
    (setting: any) => { setting.routingConfig.endpoint = 'https://other.invalid'; },
    (setting: any) => { setting.routingConfig.temperature = .7; },
    (setting: any) => { setting.routingConfig.responseFormat = 'json_schema'; },
    (setting: any) => { setting.routingConfig.actualBaseModelObserved = true; },
  ]) {
    const changed = structuredClone(after); mutate(changed.modelSettings[0]);
    assert.throws(() => prepareConversationReview(before, changed, secret));
  }
});

test('failed, absent and interrupted turns remain explicit slots and block a pass', () => {
  const before = report(false), after = report(true);
  before.selectedScripts[0].turns[1].previousDelivery = 'interrupted'; after.selectedScripts[0].turns[1].previousDelivery = 'interrupted';
  before.corpusSha256 = reviewSha256(JSON.stringify(before.selectedScripts)); after.corpusSha256 = reviewSha256(JSON.stringify(after.selectedScripts));
  after.results[0].status = 'failed'; after.results[0].turns = [after.results[0].turns[0], { ...after.results[0].turns[1], valid: false, error: { kind: 'provider', message: 'Haiku failed to finish.' } }];
  after.results.splice(1, 1);
  const data = prepareConversationReview(before, after, secret), packet = data.packets[0];
  const hidden = data.key.pairs.find(pair => pair.scriptId === before.selectedScripts[0].id)!, pair = packet.pairs.find(pair => pair.id === hidden.id)!;
  const candidate = pair[hidden.candidateSide[packet.packetId]], baseline = pair[hidden.candidateSide[packet.packetId] === 'A' ? 'B' : 'A'];
  assert.equal(candidate.turns.length, 8); assert.equal(candidate.turns[1].capture, 'failed'); assert.equal(candidate.turns[2].capture, 'missing');
  assert.equal(candidate.turns[1].delivery, 'not delivered: capture incomplete'); assert.equal(baseline.turns[0].delivery, 'interrupted');
  assert.equal(baseline.turns[0].utterances[0].fixtureDelivery.h1.playedSeconds, 1);
  assert.equal(baseline.turns[0].utterances[0].fixtureDelivery.h1.heardPrefixEstimate.split(' ').length, 2);
  assert.equal(candidate.turns[1].error.message.includes('Haiku'), false);
  const result = gateConversationReview(data.key, syntheticRatings(data.key, data.packets), data.key.reports);
  assert.equal(result.status, 'blocked'); assert.ok(result.blockers.some(item => item.startsWith('Incomplete capture:')));
});

test('only complete independent supplied rows can pass, with per-reviewer 40/60 memorable evidence', () => {
  const data = prepared(true), packets = syntheticRatings(data.key, data.packets);
  const result = gateConversationReview(data.key, packets, data.key.reports);
  assert.equal(result.status, 'pass'); assert.equal(result.automaticJudging, false);
  assert.deepEqual(result.metrics[0].memorable.map(count => [count.earned, count.denominator]), [[60, 60], [60, 60]]);
  const short = packets[0].pairs.filter(pair => pair.suite === 'short');
  for (const pair of short.slice(39)) pair.review[data.key.pairs.find(item => item.id === pair.id)!.candidateSide[packets[0].packetId]].memorable = { earned: false, quote: null, reason: 'No earned beat in this synthetic fixture.' };
  const uneven = gateConversationReview(data.key, packets, data.key.reports);
  assert.equal(uneven.status, 'fail'); assert.ok(uneven.failures.some(item => item.includes('40/60')));
});

test('ties are excluded from preference arithmetic and hard/continuity failures cannot be averaged away', () => {
  const data = prepared(true), packets = syntheticRatings(data.key, data.packets);
  for (const packet of packets) for (const pair of packet.pairs) pair.review.preference = 'tie';
  const rated = packets[0].pairs.slice(0, 10);
  rated.forEach((pair, index) => { const candidate = data.key.pairs.find(item => item.id === pair.id)!.candidateSide[packets[0].packetId]; pair.review.preference = index < 7 ? candidate : candidate === 'A' ? 'B' : 'A'; });
  const result = gateConversationReview(data.key, packets, data.key.reports);
  assert.equal(result.status, 'pass'); assert.equal(result.metrics[0].preference, .7); assert.equal(result.metrics[0].ties, 122);
  assert.deepEqual(result.metrics[0].preferences.map(row => [row.candidateWins, row.baselineWins, row.ties]), [[7, 3, 56], [0, 0, 66]]);
  const long = packets[0].pairs.find(pair => pair.review.A.continuity.length)!;
  const side = data.key.pairs.find(item => item.id === long.id)!.candidateSide[packets[0].packetId];
  long.review[side].continuity[0].passed = false; long.review[side].hardFailures = ['A synthetic cross-couple fact was transferred.'];
  const failed = gateConversationReview(data.key, packets, data.key.reports);
  assert.equal(failed.status, 'fail'); assert.ok(failed.failures.some(item => item.includes('cannot erase')));
});

test('missing rows, invented quotes, duplicate reviewers, altered packets and changed report bytes cannot pass', () => {
  const data = prepared(true);
  const missing = syntheticRatings(data.key, data.packets); missing[0].pairs[0].review.A.relevance[0].addressesLatest = null;
  assert.equal(gateConversationReview(data.key, missing, data.key.reports).status, 'blocked');
  const invented = syntheticRatings(data.key, data.packets); invented[0].pairs[0].review.A.memorable.quote = 'A quote nobody actually said.';
  assert.equal(gateConversationReview(data.key, invented, data.key.reports).status, 'blocked');
  const invalidScore = syntheticRatings(data.key, data.packets); invalidScore[0].pairs[0].review.A.rubric.humor = 6;
  assert.equal(gateConversationReview(data.key, invalidScore, data.key.reports).status, 'blocked');
  const duplicate = syntheticRatings(data.key, data.packets); duplicate[1].reviewer.id = duplicate[0].reviewer.id;
  assert.deepEqual(gateConversationReview(data.key, duplicate, data.key.reports).metrics, []);
  const changed = syntheticRatings(data.key, data.packets); changed[0].pairs[0].A.turns[0].human.text = 'An edited comparison input.';
  assert.throws(() => gateConversationReview(data.key, changed, data.key.reports), /altered/);
  assert.throws(() => gateConversationReview(data.key, syntheticRatings(data.key, data.packets), { ...data.key.reports, candidate: '0'.repeat(64) }), /exact immutable/);
  const changedKey = structuredClone(data.key); changedKey.provenance.modelSettings = [];
  assert.throws(() => gateConversationReview(changedKey, syntheticRatings(data.key, data.packets), data.key.reports), /key was altered/);
  const partial = prepared();
  assert.equal(gateConversationReview(partial.key, syntheticRatings(partial.key, partial.packets), partial.key.reports).status, 'blocked', 'a favorable small batch is not a complete gate');
});

test('review CLI help is an offline read-only default', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/review-conversations.ts', '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /Offline only/); assert.match(result.stdout, /never overwritten/);
});

test('offline CLI separates private keys, refuses overwrites and binds review to exact report bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'conversation-review-'));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('conversation-review-'));
    await rm(directory, { recursive: true, force: true });
  });
  const baseline = join(directory, 'baseline.json'), candidate = join(directory, 'candidate.json'), seedFile = join(directory, 'seed.txt');
  const packets = join(directory, 'human'), key = join(directory, 'private', 'key.json');
  await writeFile(baseline, JSON.stringify(report(false))); await writeFile(candidate, JSON.stringify(report(true))); await writeFile(seedFile, secret);
  const command = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/review-conversations.ts', ...args], { encoding: 'utf8', timeout: 10000 });
  const args = ['--baseline', baseline, '--candidate', candidate];
  const prepared = command('prepare', ...args, '--packets', packets, '--key', key, '--seed-file', seedFile);
  assert.equal(prepared.status, 0, prepared.stderr);
  const originalKey = await readFile(key, 'utf8'), originalPacket = await readFile(join(packets, 'reviewer-1.json'), 'utf8');
  assert.equal(JSON.parse(originalPacket).reviewer.kind, null); assert.equal(JSON.parse(await readFile(join(packets, 'cast-reference.json'), 'utf8')).cast.length, 3);
  assert.equal(command('prepare', ...args, '--packets', packets, '--key', key).status, 1);
  assert.equal(await readFile(key, 'utf8'), originalKey); assert.equal(await readFile(join(packets, 'reviewer-1.json'), 'utf8'), originalPacket);
  assert.equal(command('prepare', ...args, '--packets', join(directory, 'other-human'), '--key', join(directory, 'other-human', '..secret-key.json')).status, 1, 'a dot-prefixed filename inside the public directory is still rejected');
  const reviews = [join(packets, 'reviewer-1.json'), join(packets, 'reviewer-2.json')].join(',');
  const unrated = command('gate', ...args, '--key', key, '--reviews', reviews);
  assert.equal(unrated.status, 1); assert.equal(JSON.parse(unrated.stdout).status, 'blocked');
  await writeFile(candidate, (await readFile(candidate, 'utf8')) + '\n');
  const edited = command('gate', ...args, '--key', key, '--reviews', reviews);
  assert.equal(edited.status, 1); assert.match(edited.stderr, /exact immutable/);
});
