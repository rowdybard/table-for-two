import { createHash, createHmac } from 'node:crypto';
import type { EvaluationScript } from '../../src/restaurant/evaluation-fixtures';
import { CHARACTER_STORIES } from '../../src/restaurant/story';

type Side = 'A' | 'B';
type Cast = 'mira' | 'jules' | 'dev';
type CastCode = 'cast-1' | 'cast-2' | 'cast-3';
type ObjectValue = Record<string, any>;
/** Same manual 1–5 fields as DATE_EVALUATION_RUBRIC, without importing the runtime/server harness. */
export const CONVERSATION_REVIEW_RUBRIC = ['naturalness', 'castVoice', 'specificity', 'humor', 'flirtation', 'emotionalAttunement', 'continuity', 'agency', 'boundaries', 'shareability'] as const;
export interface ReviewJudgment {
  rubric: Record<typeof CONVERSATION_REVIEW_RUBRIC[number], number | null>;
  relevance: { turn: number; addressesLatest: boolean | null; reason: string | null }[];
  castIdentity: CastCode | null;
  memorable: { earned: boolean | null; quote: string | null; reason: string | null };
  continuity: { afterTurn: number; passed: boolean | null; reason: string | null }[];
  hardFailures: string[] | null;
}
export interface ReviewPair {
  id: string; suite: 'short' | 'continuity'; mode: EvaluationScript['mode']; reviewFor: string;
  A: ObjectValue; B: ObjectValue;
  review: { preference: Side | 'tie' | null; reason: string | null; A: ReviewJudgment; B: ReviewJudgment };
}
export interface HumanReviewPacket {
  version: 1; packetId: string; reviewSlot: number;
  reviewer: { id: string | null; kind: 'human' | null; independent: boolean | null };
  instructions: readonly string[]; pairs: ReviewPair[];
}
export interface CoordinatorKey {
  version: 1; keyId: string; orderingCommitment: string;
  castReference: Record<CastCode, Cast>;
  reports: { baseline: string; candidate: string };
  provenance: { baseline: ObjectValue; candidate: ObjectValue; corpusSha256: string; modelSettings: ObjectValue[] };
  packets: { packetId: string; pairIds: string[] }[];
  pairs: { id: string; model: string; scriptId: string; suite: 'short' | 'continuity'; mode: EvaluationScript['mode']; cast: CastCode | null; complete: boolean; checkpointCount: number; candidateSide: Record<string, Side> }[];
}
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);
const hashValue = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const reviewSha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => reviewSha256(canonical(value));
function insist(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function validateReport(value: unknown, label: string) {
  insist(object(value), `${label}: expected an evaluation report.`);
  for (const field of ['sourceRevision', 'evaluatedSourceRevision', 'harnessRevision']) insist(revision(value[field]), `${label}: ${field} must be a known immutable revision.`);
  insist(value.sourceTreeDirty === false, `${label}: dirty or unknown source provenance is not paired-review evidence.`);
  insist(value.harnessRevision === value.sourceRevision, `${label}: harness and checkout provenance disagree.`);
  insist(value.instrumentationSha256 === null || hashValue(value.instrumentationSha256), `${label}: invalid instrumentation hash.`);
  insist(value.evaluatedSourceRevision === value.sourceRevision || hashValue(value.instrumentationSha256), `${label}: baseline instrumentation provenance is missing.`);
  insist(Array.isArray(value.selectedScripts) && value.selectedScripts.length > 0, `${label}: the complete selectedScripts manifest is required.`);
  insist(hashValue(value.corpusSha256) && reviewSha256(JSON.stringify(value.selectedScripts)) === value.corpusSha256, `${label}: corpus manifest/hash mismatch.`);
  insist(Array.isArray(value.modelSettings) && value.modelSettings.length > 0, `${label}: modelSettings are required.`);
  const settings = new Map<string, ObjectValue>();
  for (const setting of value.modelSettings) {
    insist(object(setting) && text(setting.model) && text(setting.upstreamModel) && !/^(?:unknown|auto)$/i.test(setting.upstreamModel), `${label}: a known requested upstream model is required; an unknown automatic pool cannot establish model parity.`);
    insist(Number.isSafeInteger(setting.maxTokens) && setting.maxTokens > 0 && Number.isFinite(setting.timeoutMs) && setting.timeoutMs > 0 && !settings.has(setting.model), `${label}: invalid or duplicate model settings.`);
    insist(['anthropic-messages', 'horde-openai', 'horde-native', 'openrouter-chat-completions', 'dolphinllm-chat-completions'].includes(setting.transport) && Number.isSafeInteger(setting.effectiveMaxTokens) && setting.effectiveMaxTokens > 0 && setting.effectiveMaxTokens <= setting.maxTokens, `${label}: transport/effective response limits are unknown.`);
    insist(setting.providerTimeoutMs === null || Number.isFinite(setting.providerTimeoutMs) && setting.providerTimeoutMs > 0, `${label}: provider timeout settings are unknown.`);
    insist(setting.routingConfig === null || object(setting.routingConfig), `${label}: routing settings are unknown.`);
    if (setting.transport === 'openrouter-chat-completions') {
      const routing = setting.routingConfig;
      insist(setting.upstreamModel === setting.model && object(routing) && routing.selection === 'fixed-model' && Array.isArray(routing.requestedModels)
        && routing.requestedModels.length === 1 && routing.requestedModels[0] === setting.upstreamModel
        && routing.responseFormat === 'json_object' && routing.allowFallbacks === false && routing.requireParameters === true,
      `${label}: OpenRouter requires a pinned upstream model and known routing/format settings.`);
    }
    if (setting.transport === 'dolphinllm-chat-completions') {
      const routing = setting.routingConfig;
      insist(setting.model === 'dolphinllm/uncensored' && setting.upstreamModel === 'uncensored' && object(routing)
        && routing.selection === 'fixed-endpoint-and-model-alias' && Array.isArray(routing.requestedModels)
        && routing.requestedModels.length === 1 && routing.requestedModels[0] === 'uncensored'
        && routing.endpoint === 'https://dolphinllm.com/v1/chat/completions' && routing.responseFormat === 'json_object'
        && routing.temperature === .8 && routing.actualBaseModelObserved === false && routing.actualProviderObserved === false,
      `${label}: Dolphin LLM requires its documented endpoint, model alias and route settings.`);
    }
    settings.set(setting.model, setting);
  }
  const scripts = new Map<string, EvaluationScript>();
  for (const script of value.selectedScripts) {
    insist(object(script) && text(script.id) && !scripts.has(script.id) && ['short', 'continuity'].includes(script.suite) && ['solo', 'blind', 'double'].includes(script.mode), `${label}: invalid or duplicate script.`);
    insist(['mira', 'jules', 'dev'].includes(script.dateId) && Array.isArray(script.turns) && script.turns.length === (script.suite === 'short' ? 8 : 30), `${label}: invalid planned turns.`);
    insist(script.turns.every((turn: unknown) => object(turn) && text(turn.text)), `${label}: missing planned input.`);
    scripts.set(script.id, script as EvaluationScript);
  }
  insist(Array.isArray(value.results), `${label}: results must be retained even when capture failed.`);
  const results = new Map<string, ObjectValue>();
  for (const result of value.results) {
    insist(object(result) && scripts.has(result.scriptId) && settings.has(result.model), `${label}: result is outside the manifest.`);
    const id = `${result.model}\0${result.scriptId}`, script = scripts.get(result.scriptId)!;
    insist(!results.has(id) && result.mode === script.mode && result.plannedTurns === script.turns.length && Array.isArray(result.turns), `${label}: duplicate or mismatched result.`);
    const seen = new Set<number>();
    for (const row of result.turns) {
      insist(object(row) && Number.isSafeInteger(row.turn) && row.turn >= 1 && row.turn <= script.turns.length && !seen.has(row.turn), `${label}: invalid or duplicate captured turn.`);
      seen.add(row.turn); const input = script.turns[row.turn - 1];
      insist(row.input === input.text && row.human === (input.human ?? 'h1') && row.target === (input.target ?? (script.mode === 'double' ? 'table' : 'date')) && row.via === (input.via ?? 'typed'), `${label}: captured inputs do not match the corpus.`);
      insist(object(row.request) && row.request.model === result.model && row.request.maxTokens === settings.get(result.model)!.maxTokens, `${label}: captured model/response limit mismatch.`);
      insist(typeof row.rawResponse === 'string' && typeof row.valid === 'boolean' && (row.error === null || object(row.error)), `${label}: capture validity/error evidence is missing.`);
      if (row.valid) {
        let parsed: any;
        try { parsed = JSON.parse(row.rawResponse); } catch { /* Rejected below. */ }
        insist(row.error === null && object(parsed) && Array.isArray(parsed.utterances) && parsed.utterances.every((line: unknown) => object(line) && typeof line.text === 'string' && typeof line.speaker === 'string'), `${label}: a claimed valid response has no readable transcript.`);
      }
    }
    results.set(id, result);
  }
  return { report: value, scripts, settings, results };
}

function anonymizer(script: EvaluationScript) {
  const ids = script.mode === 'double' ? script.dateIds ?? [script.dateId] : [script.dateId];
  const names = new Map(ids.map((id, index) => [id, script.mode === 'double' ? `Date ${index + 1}` : 'Date']));
  return (value: string) => value.replace(/\b(?:Mira|Jules|Dev)\b/gi, name => names.get(name.toLowerCase() as Cast) ?? 'Other date')
    .replace(/\bcognitivecomputations\/dolphin-mistral-24b-venice-edition\b/gi, '[provider]')
    .replace(/\bdolphinllm(?:\.com|\/uncensored)?\b/gi, '[provider]')
    .replace(/\b(?:Anthropic|OpenRouter|AI Horde|Horde|Claude|Haiku|Sonnet|Dolphin|Mistral)\b/gi, '[provider]');
}
function transcript(script: EvaluationScript, result: ObjectValue | undefined) {
  const scrub = anonymizer(script);
  const speaker = (id: string) => id === 'date' ? 'Date' : id === 'd1' ? 'Date 1' : id === 'd2' ? 'Date 2' : id === 'waiter' ? 'Waiter' : id === 'diner' ? 'Neighbor' : id;
  const turns = script.turns.map((input, index) => {
    const row = result?.turns.find((turn: ObjectValue) => turn.turn === index + 1);
    const delivery = script.turns[index + 1]?.previousDelivery ?? 'heard', nextListener = script.turns[index + 1]?.human ?? 'h1';
    let utterances: ObjectValue[] = [];
    try { utterances = JSON.parse(row?.rawResponse ?? '').utterances.filter((line: unknown) => object(line) && typeof line.text === 'string').map((line: ObjectValue) => {
      const listeners = script.mode === 'double' ? ['h1', 'h2'] : ['h1'];
      return { speaker: speaker(line.speaker), text: scrub(line.text), ...(typeof line.emotion === 'string' ? { emotion: line.emotion } : {}),
        fixtureDelivery: Object.fromEntries(listeners.map(listener => {
          const state = !row?.valid || row.error ? 'unheard' : script.mode === 'double' && listener !== nextListener ? 'heard' : delivery;
          const words = line.text.split(/\s+/).filter(Boolean), prefix = words.slice(0, Math.max(0, Math.min(words.length - 1, 2))).join(' ');
          return [listener, { state, playedSeconds: state === 'heard' ? 4 : state === 'interrupted' ? 1 : 0, heardPrefixEstimate: state === 'heard' ? scrub(line.text) : state === 'interrupted' ? scrub(prefix) : '' }];
        })) };
    }); } catch { /* Failed capture stays a visible failed slot; raw evidence remains in the immutable report. */ }
    return { turn: index + 1, human: { speaker: input.human ?? 'h1', target: input.target ?? (script.mode === 'double' ? 'table' : 'date'), text: scrub(input.text), via: input.via ?? 'typed' },
      capture: !row ? 'missing' : row.valid && !row.error ? 'valid' : 'failed',
      delivery: !row || !row.valid || row.error ? 'not delivered: capture incomplete' : delivery,
      utterances, error: row?.error ? { kind: row.error.kind, message: scrub(String(row.error.message)) } : null };
  });
  const checkpoints = (script.checkpoints ?? []).map(checkpoint => {
    const captured = result?.checkpoints?.find((item: ObjectValue) => item.afterTurn === checkpoint.afterTurn);
    const notebook = object(captured?.notebook) ? Object.fromEntries(Object.entries(captured.notebook).map(([human, snapshot]) => [human, object(snapshot) && typeof snapshot.memory === 'string' ? scrub(snapshot.memory) : null])) : null;
    return { afterTurn: checkpoint.afterTurn, owner: checkpoint.owner ?? null, mustRecall: checkpoint.mustRecall.map(scrub), mustNotClaim: checkpoint.mustNotClaim.map(scrub), notebook };
  });
  return { turns, checkpoints };
}
const judgment = (script: EvaluationScript): ReviewJudgment => ({ rubric: Object.fromEntries(CONVERSATION_REVIEW_RUBRIC.map(field => [field, null])) as ReviewJudgment['rubric'], relevance: script.turns.map((_turn, index) => ({ turn: index + 1, addressesLatest: null, reason: null })), castIdentity: null,
  memorable: { earned: null, quote: null, reason: null }, continuity: (script.checkpoints ?? []).map(checkpoint => ({ afterTurn: checkpoint.afterTurn, passed: null, reason: null })), hardFailures: null });
function packetDigest(packet: HumanReviewPacket) {
  const { reviewer: _reviewer, packetId: _id, ...body } = packet;
  return digest({ ...body, pairs: body.pairs.map(({ review: _review, ...pair }) => pair) });
}

/** No inference or ratings: the secret only counterbalances blinded ordering. */
export function prepareConversationReview(baseline: unknown, candidate: unknown, secret: string, reportHashes?: { baseline: string; candidate: string }) {
  insist(secret.length >= 32, 'Use at least 32 secret characters for blinded ordering.');
  const base = validateReport(baseline, 'Baseline'), next = validateReport(candidate, 'Candidate');
  insist(base.report.evaluatedSourceRevision !== next.report.evaluatedSourceRevision, 'This is one source revision, not a baseline/candidate comparison.');
  insist(base.report.corpusSha256 === next.report.corpusSha256 && canonical(base.report.selectedScripts) === canonical(next.report.selectedScripts), 'Baseline/candidate corpus or scripts differ.');
  insist(canonical(base.report.modelSettings) === canonical(next.report.modelSettings), 'Baseline/candidate models, upstream aliases or limits differ.');
  const randomKey = (domain: string) => createHmac('sha256', secret).update(domain).digest('hex');
  const pairs = [...base.settings.keys()].flatMap(model => [...base.scripts.values()].map(script => ({ id: randomKey(`pair:${model}:${script.id}`).slice(0, 20), model, script })));
  if (reportHashes) insist(hashValue(reportHashes.baseline) && hashValue(reportHashes.candidate), 'Report hashes must be SHA-256 values.');
  const key: CoordinatorKey = { version: 1, keyId: '', orderingCommitment: reviewSha256(secret), castReference: { 'cast-1': 'mira', 'cast-2': 'jules', 'cast-3': 'dev' }, reports: reportHashes ?? { baseline: digest(baseline), candidate: digest(candidate) },
    provenance: { baseline: Object.fromEntries(['sourceRevision', 'evaluatedSourceRevision', 'harnessRevision', 'instrumentationSha256'].map(field => [field, base.report[field]])), candidate: Object.fromEntries(['sourceRevision', 'evaluatedSourceRevision', 'harnessRevision', 'instrumentationSha256'].map(field => [field, next.report[field]])), corpusSha256: base.report.corpusSha256, modelSettings: structuredClone(base.report.modelSettings) }, packets: [],
    pairs: pairs.map(pair => {
      const a = base.results.get(`${pair.model}\0${pair.script.id}`), b = next.results.get(`${pair.model}\0${pair.script.id}`);
      const complete = [a, b].every(result => result?.status === 'complete' && result.turns.length === pair.script.turns.length && result.turns.every((turn: ObjectValue) => turn.valid && !turn.error) && (pair.script.checkpoints ?? []).every(checkpoint => result.checkpoints?.some((item: ObjectValue) => item.afterTurn === checkpoint.afterTurn && object(item.notebook))));
      return { id: pair.id, model: pair.model, scriptId: pair.script.id, suite: pair.script.suite, mode: pair.script.mode, cast: pair.script.suite === 'short' && pair.script.mode === 'solo' ? `cast-${['mira', 'jules', 'dev'].indexOf(pair.script.dateId) + 1}` as CastCode : null, complete, checkpointCount: pair.script.checkpoints?.length ?? 0, candidateSide: {} };
    }) };
  const packets = [0, 1].map(reviewer => {
    const sides = new Map<string, Side>();
    for (const model of base.settings.keys()) for (const suite of ['short', 'continuity']) {
      const group = pairs.filter(pair => pair.model === model && pair.script.suite === suite).sort((a, b) => randomKey(`balance:${a.id}`).localeCompare(randomKey(`balance:${b.id}`)));
      const offset = (parseInt(randomKey(`start:${model}:${suite}`).slice(0, 2), 16) + reviewer) % 2;
      group.forEach((pair, index) => sides.set(pair.id, (index + offset) % 2 ? 'A' : 'B'));
    }
    const packet: HumanReviewPacket = { version: 1, packetId: '', reviewSlot: reviewer + 1, reviewer: { id: null, kind: null, independent: null }, instructions: [
      'Complete this independently as a human before discussing or seeing the coordinator key. Leave anything unreviewed null.',
      'A/B order is blinded and balanced. Judge both sides; failed and missing capture slots are intentional evidence.',
      'For solo preset cases, use cast-1/cast-2/cast-3 from the coordinator’s separate character reference sheet. Do not guess a preset for Blind or Double.',
      'Quote an actual date line and explain why the memorable beat was earned. Mark hard failures explicitly; [] means reviewed with none found.',
      'Rubric scores are human 1–5 judgments (1 poor, 3 acceptable, 5 excellent). Fixture seconds/prefixes describe controlled delivery, not measured speech.',
    ], pairs: pairs.sort((a, b) => randomKey(`${reviewer}:packet:${a.id}`).localeCompare(randomKey(`${reviewer}:packet:${b.id}`))).map(pair => {
      const left = transcript(pair.script, base.results.get(`${pair.model}\0${pair.script.id}`)), right = transcript(pair.script, next.results.get(`${pair.model}\0${pair.script.id}`));
      return { id: pair.id, suite: pair.script.suite, mode: pair.script.mode, reviewFor: anonymizer(pair.script)(pair.script.reviewFor), A: sides.get(pair.id) === 'A' ? right : left, B: sides.get(pair.id) === 'A' ? left : right,
        review: { preference: null, reason: null, A: judgment(pair.script), B: judgment(pair.script) } };
    }) };
    packet.packetId = packetDigest(packet);
    for (const pair of key.pairs) pair.candidateSide[packet.packetId] = sides.get(pair.id)!;
    key.packets.push({ packetId: packet.packetId, pairIds: packet.pairs.map(pair => pair.id) });
    return packet;
  });
  const { keyId: _keyId, ...keyBody } = key;
  key.keyId = digest(keyBody);
  const reference = { version: 1, instructions: 'Shared cast reference for identification only. Score the anonymized conversations using these codes; this sheet contains no report or ordering key.',
    cast: Object.entries(key.castReference).map(([code, name]) => ({ code, name: name[0].toUpperCase() + name.slice(1), occupation: CHARACTER_STORIES[name].occupation, voice: CHARACTER_STORIES[name].voiceHabits.split(':')[0] })) };
  return { key, packets, reference };
}

/** Ratings are supplied by two independent humans, never inferred from text, validity or model output. */
export function gateConversationReview(key: CoordinatorKey, packets: readonly HumanReviewPacket[], reportHashes: { baseline: string; candidate: string }) {
  const { keyId, ...keyBody } = key;
  insist(hashValue(keyId) && digest(keyBody) === keyId, 'The coordinator key was altered.');
  insist(key.version === 1 && packets.length === 2 && key.packets.length === 2 && canonical(reportHashes) === canonical(key.reports), 'Two packets and the exact immutable baseline/candidate reports are required.');
  for (const packet of packets) {
    const expected = key.packets.find(item => item.packetId === packet.packetId);
    insist(expected && packetDigest(packet) === packet.packetId && canonical(packet.pairs.map(pair => pair.id)) === canonical(expected.pairIds), 'A review packet/transcript was altered, duplicated or does not belong to this key.');
  }
  const reviewers = packets.map(packet => typeof packet.reviewer.id === 'string' ? packet.reviewer.id.trim().toLowerCase() : '');
  if (reviewers.some(id => !id) || new Set(reviewers).size !== 2 || new Set(packets.map(packet => packet.packetId)).size !== 2 || packets.some(packet => packet.reviewer.kind !== 'human' || packet.reviewer.independent !== true)) {
    return { status: 'blocked', blockers: ['Two distinct human reviewers must attest independent review before any quality gate is calculated.'], failures: [], metrics: [], automaticJudging: false, speechMeasured: false };
  }
  const blockers: string[] = [], failures: string[] = [], identities = new Set<string>();
  const metrics = key.provenance.modelSettings.map(setting => ({ model: setting.model as string,
    identityEvidence: String(setting.transport).startsWith('horde') ? 'Matched requested upstream/configuration; the actual volunteer worker was not observed.' : setting.transport === 'openrouter-chat-completions' ? 'Matched requested upstream model and routing settings; the actual OpenRouter provider was not observed.' : setting.transport === 'dolphinllm-chat-completions' ? 'Matched documented endpoint and requested model alias; the actual base model and serving provider were not observed.' : 'Matched requested upstream model alias.',
    candidateWins: 0, baselineWins: 0, ties: 0, preference: null as number | null, preferences: [] as { reviewer: string; candidateWins: number; baselineWins: number; ties: number; preference: number | null }[], relevant: 0, relevanceTotal: 0, relevance: null as number | null, castCorrect: 0, castTotal: 0, castIdentification: null as number | null, memorable: [] as { reviewer: string; earned: number; denominator: number }[], continuityFailures: 0, hardFailures: 0 }));
  for (const packet of packets) {
    const expected = key.packets.find(item => item.packetId === packet.packetId);
    insist(expected && packetDigest(packet) === packet.packetId && canonical(packet.pairs.map(pair => pair.id)) === canonical(expected.pairIds), 'A review packet/transcript was altered, duplicated or does not belong to this key.');
    const identity = packet.reviewer.id?.trim().toLowerCase();
    if (!identity || packet.reviewer.kind !== 'human' || packet.reviewer.independent !== true || identities.has(identity)) blockers.push('Two distinct human reviewers must attest independent review.');
    if (identity) identities.add(identity);
    for (const metric of metrics) { metric.memorable.push({ reviewer: identity ?? 'unrated', earned: 0, denominator: 0 }); metric.preferences.push({ reviewer: identity ?? 'unrated', candidateWins: 0, baselineWins: 0, ties: 0, preference: null }); }
    for (const pair of packet.pairs) {
      const hidden = key.pairs.find(item => item.id === pair.id)!;
      insist(hidden, 'Unknown pair.');
      const metric = metrics.find(item => item.model === hidden.model)!, selected = hidden.candidateSide[packet.packetId], review = pair.review;
      if (!hidden.complete) blockers.push(`Incomplete capture: ${hidden.model}/${hidden.scriptId}.`);
      if (!review || !['A', 'B', 'tie'].includes(review.preference as string) || !text(review.reason)) blockers.push(`Missing/invalid preference: ${pair.id}.`);
      else if (review.preference === 'tie') { metric.ties++; metric.preferences.at(-1)!.ties++; }
      else if (review.preference === selected) { metric.candidateWins++; metric.preferences.at(-1)!.candidateWins++; }
      else { metric.baselineWins++; metric.preferences.at(-1)!.baselineWins++; }
      for (const side of ['A', 'B'] as const) {
        const rating = review?.[side], evidence = pair[side];
        if (!object(rating?.rubric) || canonical(Object.keys(rating.rubric).sort()) !== canonical([...CONVERSATION_REVIEW_RUBRIC].sort()) || Object.values(rating.rubric).some(score => !Number.isInteger(score) || Number(score) < 1 || Number(score) > 5)) blockers.push(`Missing/invalid manual rubric scores: ${pair.id}/${side}.`);
        if (!rating || !Array.isArray(rating.relevance) || rating.relevance.length !== evidence.turns.length || rating.relevance.some((row, index) => row.turn !== index + 1 || typeof row.addressesLatest !== 'boolean' || !text(row.reason))) blockers.push(`Missing/invalid relevance: ${pair.id}/${side}.`);
        if (hidden.cast && !['cast-1', 'cast-2', 'cast-3'].includes(rating?.castIdentity ?? '')) blockers.push(`Missing/invalid cast identification: ${pair.id}/${side}.`);
        const beat = rating?.memorable;
        if (hidden.suite === 'short' && (!beat || typeof beat.earned !== 'boolean' || !text(beat.reason) || beat.earned && (!text(beat.quote) || !evidence.turns.some((turn: ObjectValue) => turn.utterances.some((line: ObjectValue) => line.text.includes(beat.quote)))))) blockers.push(`Missing/invalid memorable evidence: ${pair.id}/${side}.`);
        if (!Array.isArray(rating?.continuity) || rating.continuity.length !== hidden.checkpointCount || rating.continuity.some((row, index) => row.afterTurn !== evidence.checkpoints[index].afterTurn || typeof row.passed !== 'boolean' || !text(row.reason))) blockers.push(`Missing/invalid continuity review: ${pair.id}/${side}.`);
        if (!Array.isArray(rating?.hardFailures) || rating.hardFailures.some(item => !text(item))) blockers.push(`Missing/invalid hard-failure review: ${pair.id}/${side}.`);
        if (side !== selected || !rating) continue;
        const relevance = Array.isArray(rating.relevance) ? rating.relevance.filter((row, index) => row.turn === index + 1 && typeof row.addressesLatest === 'boolean' && text(row.reason)) : [];
        metric.relevanceTotal += relevance.length;
        metric.relevant += relevance.filter(row => row.addressesLatest === true).length;
        if (hidden.cast && ['cast-1', 'cast-2', 'cast-3'].includes(rating.castIdentity ?? '')) { metric.castTotal++; if (rating.castIdentity === hidden.cast) metric.castCorrect++; }
        if (hidden.suite === 'short') { const count = metric.memorable.at(-1)!; count.denominator++; if (beat?.earned === true && text(beat.quote) && evidence.turns.some((turn: ObjectValue) => turn.utterances.some((line: ObjectValue) => line.text.includes(beat.quote)))) count.earned++; }
        metric.continuityFailures += rating.continuity?.filter(row => row.passed === false).length ?? 0;
        metric.hardFailures += rating.hardFailures?.length ?? 0;
      }
    }
  }
  if (identities.size !== 2 || new Set(packets.map(packet => packet.packetId)).size !== 2) blockers.push('Exactly two distinct reviewer packets are required.');
  for (const metric of metrics) {
    const selected = key.pairs.filter(pair => pair.model === metric.model);
    if (selected.filter(pair => pair.suite === 'short').length !== 60 || selected.filter(pair => pair.cast).length !== 36 || selected.filter(pair => pair.suite === 'continuity').length !== 6) blockers.push(`${metric.model}: formal gates require 60 short, 36 preset and six continuity cases.`);
    metric.preference = metric.candidateWins + metric.baselineWins ? metric.candidateWins / (metric.candidateWins + metric.baselineWins) : null;
    for (const count of metric.preferences) count.preference = count.candidateWins + count.baselineWins ? count.candidateWins / (count.candidateWins + count.baselineWins) : null;
    metric.relevance = metric.relevanceTotal ? metric.relevant / metric.relevanceTotal : null;
    metric.castIdentification = metric.castTotal ? metric.castCorrect / metric.castTotal : null;
    if (metric.preference === null || metric.preference < .7) failures.push(`${metric.model}: candidate preference is below 70% of non-ties.`);
    if (metric.relevance === null || metric.relevance < .9) failures.push(`${metric.model}: latest-turn relevance is below 90%.`);
    if (metric.castIdentification === null || metric.castIdentification < .8) failures.push(`${metric.model}: preset cast identification is below 80%.`);
    if (metric.memorable.some(count => count.denominator !== 60 || count.earned < 40)) failures.push(`${metric.model}: both reviewers need earned memorable evidence in at least 40/60 short cases.`);
    if (metric.continuityFailures || metric.hardFailures) failures.push(`${metric.model}: continuity or hard failures remain; averages cannot erase them.`);
  }
  return { status: blockers.length ? 'blocked' : failures.length ? 'fail' : 'pass', blockers: [...new Set(blockers)], failures: blockers.length ? [] : failures, metrics, automaticJudging: false, speechMeasured: false };
}
