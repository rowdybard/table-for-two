import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getDate } from '../src/restaurant/content';
import { CHARACTER_STORIES } from '../src/restaurant/story';
import { createBlindDate } from '../src/restaurant/blind-date';
import { EVALUATION_SCRIPTS } from '../src/restaurant/evaluation';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import { DATE_DIALOGUE_INSTRUCTIONS, SPOKEN_REGISTER, VOICE_REMINDER, outputContract } from '../server/restaurant/dialogue-policy';
import { SKEPTICISM_INSTRUCTIONS } from '../server/restaurant/skepticism';
import { AGENDA_INSTRUCTIONS } from '../server/restaurant/agendas';
import { BOUNDARY_INSTRUCTIONS } from '../server/restaurant/boundaries';
import { roleplayInstructions } from '../server/restaurant/roleplay';
import { ACTIONS, EMOTIONS, SOCIAL_SIGNALS } from '../server/restaurant/providers';
import { presetDateSheet } from '../server/double-date/table-note';
import { DOUBLE_TURN_SCHEMA } from '../server/double-date/conversation';
import { evaluationProvenance } from '../scripts/lib/evaluation-provenance';
import { evaluationModelSettings } from '../scripts/lib/conversation-evaluation';
import { createBaselineHordeAdapter } from '../scripts/lib/baseline-horde-compat';
import { hordeAdapter } from '../server/restaurant/horde';
import { TURN_SCHEMA, type ClaudeChunk, type ClaudeRequest } from '../server/restaurant/providers';

const BASE = '05ff06a5e5727fc99d78fe64469460ab286a4d0a';
const normalize = (text: string) => text.replace(/\r\n/g, '\n');
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const original = (path: string) => normalize(git('show', `${BASE}:${path}`));
const current = (path: string) => normalize(readFileSync(path, 'utf8'));
const promptBlock = (text: string) => text.match(/  const prompt = \(s: Session, model: ClaudeModel\) => \{[\s\S]*?\n  \};/)![0];
const sheetBlock = (text: string) => text.match(/        const sheets: DateSheet\[\] = actors\.map\(id => \{[\s\S]*?\n        \}\);/)![0];

test('production changes are exclusively reversible pure extractions of the frozen baseline', () => {
  const index = 'server/restaurant/index.ts';
  assert.equal(current(index).replace("import { soloSystem } from './conversation-prompt';\n", '').replace(promptBlock(current(index)), promptBlock(original(index))), original(index));
  const conversation = 'server/double-date/conversation.ts';
  assert.equal(current(conversation)
    .replace('friendNames, presetDateSheet, renderDoubleHistory', 'friendNames, renderDoubleHistory')
    .replace('export const DOUBLE_TURN_SCHEMA = schema;\n', '')
    .replace('export const validateDoubleTurn = validate;\n', '')
    .replace(sheetBlock(current(conversation)), sheetBlock(original(conversation))), original(conversation));
  const note = 'server/double-date/table-note.ts';
  assert.equal(current(note)
    .replace("import { getDate } from '../../src/restaurant/content';\n", '')
    .replace("import { CHARACTER_STORIES } from '../../src/restaurant/story';\n", '')
    .replace("import type { DateId } from '../../src/restaurant/types';\n", '')
    .replace(/\n\/\*\* Pure extraction of the baseline director's original persona-sheet construction\. \*\/[\s\S]*?\n}\n/, ''), original(note));
  const allowed = new Set([index, conversation, note, 'server/restaurant/conversation-prompt.ts', 'src/restaurant/evaluation.ts', 'src/restaurant/evaluation-fixtures.ts', 'src/restaurant/evaluation-runtime.ts']);
  const changes = [...git('diff', '--name-only', BASE, '--', 'src', 'server').trim().split('\n'), ...git('ls-files', '--others', '--exclude-standard', '--', 'src', 'server').trim().split('\n')].filter(Boolean);
  assert.ok(changes.every(path => allowed.has(path)), `Unexpected production changes: ${changes.filter(path => !allowed.has(path))}`);
});

test('extracted Solo prompts exactly equal the original closure for every corpus identity and model', () => {
  const block = promptBlock(original('server/restaurant/index.ts'));
  const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')).replace('getDate(s.scene.state.dateId)!', 'getDate(s.scene.state.dateId)');
  // Execute the trusted frozen source expression, not a rewritten expected prompt or a running server.
  const oracle = new Function('getDate', 'createBlindDate', 'CHARACTER_STORIES', 'DATE_DIALOGUE_INSTRUCTIONS', 'SKEPTICISM_INSTRUCTIONS', 'AGENDA_INSTRUCTIONS', 'BOUNDARY_INSTRUCTIONS', 'roleplayInstructions', 'outputContract', 'EMOTIONS', 'ACTIONS', 'SOCIAL_SIGNALS', 'SPOKEN_REGISTER', 'VOICE_REMINDER', 's', 'model', body);
  for (const script of EVALUATION_SCRIPTS) for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'ai-horde'] as const) {
    const dateId = script.blindSeed ? createBlindDate(script.blindSeed).dateId : script.dateId;
    const input = { dateId, ...(script.blindSeed ? { blindDate: { seed: script.blindSeed } } : {}), model };
    const expected = oracle(getDate, createBlindDate, CHARACTER_STORIES, DATE_DIALOGUE_INSTRUCTIONS, SKEPTICISM_INSTRUCTIONS, AGENDA_INSTRUCTIONS, BOUNDARY_INSTRUCTIONS, roleplayInstructions, outputContract, EMOTIONS, ACTIONS, SOCIAL_SIGNALS, SPOKEN_REGISTER, VOICE_REMINDER, { scene: { state: input } }, model);
    assert.equal(soloSystem(input), expected, `${script.id}/${model}`);
  }
});

test('extracted Double sheets exactly equal the original runtime construction', () => {
  const block = sheetBlock(original('server/double-date/conversation.ts'));
  const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}')).replace('getDate(actor.dateId)!', 'getDate(actor.dateId)');
  const oracle = new Function('dateOf', 'CHARACTER_STORIES', 'getDate', 'id', body);
  for (const dateId of ['mira', 'jules', 'dev'] as const) for (const actorId of ['d1', 'd2'] as const) {
    const humanId = actorId === 'd1' ? 'h1' : 'h2';
    assert.deepEqual(presetDateSheet(actorId, humanId, dateId), oracle(() => ({ dateId, humanId }), CHARACTER_STORIES, getDate, actorId));
  }
});

test('baseline report provenance resolves the frozen evaluated code independently of the harness commit', () => {
  const provenance = evaluationProvenance();
  assert.equal(provenance.evaluatedSourceRevision, BASE);
  assert.equal(provenance.harnessRevision, provenance.sourceRevision);
  assert.match(provenance.instrumentationSha256 ?? '', /^[a-f0-9]{64}$/);
  const manifest = JSON.parse(current('docs/conversation-baseline-bench.json'));
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  assert.equal(hash(current(manifest.instrumentationPatch)), manifest.instrumentationSha256);
  for (const [path, expected] of Object.entries(manifest.copiedHarnessSha256)) assert.equal(hash(current(path)), expected, `${path} differs from the captured harness`);
  for (const [path, expected] of Object.entries(manifest.originalCopiedHarnessSha256)) assert.equal(hash(normalize(git('show', `${manifest.originalCopiedHarnessRevision}:${path}`))), expected, `${path} original harness differs`);
  assert.equal(hash(current(manifest.bridgeCompatibility.originalAdapterPath)), manifest.bridgeCompatibility.originalAdapterSha256);
  assert.equal(hash(current(manifest.bridgeCompatibility.shimPath)), manifest.bridgeCompatibility.shimSha256);
  assert.equal(hash(normalize(git('show', `${manifest.bridgeCompatibility.previousShimRevision}:${manifest.bridgeCompatibility.shimPath}`))), manifest.bridgeCompatibility.previousShimSha256);
  assert.equal(hash(current('src/restaurant/evaluation-fixtures.ts')), manifest.corpusFileSha256);
  const runtime = current('src/restaurant/evaluation-runtime.ts');
  assert.equal((runtime.match(/clampMemory\(turn\.memory, view\.memory\)/g) ?? []).length, 2);
  const restored = runtime.replaceAll('clampMemory(turn.memory, view.memory)', 'clampMemory(turn.memory, view.memory, input.text)');
  assert.equal(hash(restored), manifest.candidateRuntimeSha256, 'The compatibility adaptation must change only the two baseline memory calls.');
});

test('bench bridge changes only context fit and response format and reports its actual route settings', async () => {
  const env = { DATE_CONVERSATION_PROVIDER: 'aihorde', AI_HORDE_MODEL: 'koboldcpp/example', AI_HORDE_API_KEY: 'test-only' };
  const request: ClaudeRequest = { model: 'ai-horde', system: 'Frozen system instructions.', messages: [{ role: 'user', content: 'First message.' }, { role: 'assistant', content: 'Café.' }, { role: 'user', content: 'Follow-up.' }], maxTokens: 700, outputSchema: TURN_SCHEMA };
  const captured: { url: string; method: string | undefined; headers: HeadersInit | undefined; body: any; signal: AbortSignal | null | undefined }[] = [];
  const wire = 'data: {"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    captured.push({ url: String(url), method: init?.method, headers: init?.headers, body: JSON.parse(init!.body as string), signal: init?.signal });
    return new Response(wire);
  }) as typeof fetch;
  const signal = new AbortController().signal;
  const collect = async (adapter: ReturnType<typeof hordeAdapter>) => { const chunks: ClaudeChunk[] = []; for await (const chunk of adapter.stream(request, signal)) chunks.push(chunk); return chunks; };
  const original = await collect(hordeAdapter(env, fetcher)), compatible = await collect(createBaselineHordeAdapter(env, fetcher));
  assert.deepEqual(compatible, original); assert.equal(captured.length, 2);
  assert.equal(captured[0].body.horde.context_fit, 'reject'); assert.equal(captured[1].body.horde.context_fit, 'grow');
  assert.deepEqual(captured[0].body.response_format, { type: 'json_object' });
  assert.deepEqual(captured[1].body.response_format, { type: 'json_schema', json_schema: { name: 'date_turn', schema: TURN_SCHEMA, strict: true } });
  captured[0].body.horde.context_fit = 'grow';
  captured[0].body.response_format = captured[1].body.response_format;
  assert.deepEqual(captured[1], captured[0], 'all other headers, signal, system, history and routing options are identical');
  assert.equal(evaluationModelSettings(['ai-horde'], env)[0].routingConfig?.contextFit, 'grow');
  assert.equal(evaluationModelSettings(['ai-horde'], env)[0].routingConfig?.responseFormat, 'json_schema');
  assert.equal(evaluationModelSettings(['ai-horde'], env)[0].routingConfig?.schemaStrict, true);
  assert.equal(evaluationModelSettings(['ai-horde'], { ...env, AI_HORDE_TRANSPORT: 'native' })[0].routingConfig?.contextFit, 'reject');
  assert.equal('responseFormat' in evaluationModelSettings(['ai-horde'], { ...env, AI_HORDE_TRANSPORT: 'native' })[0].routingConfig!, false);
});

test('concurrent baseline bridge requests preserve their own schemas and the Solo fallback', async () => {
  const schemas: Record<string, unknown>[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string); schemas.push(body.response_format.json_schema.schema);
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }) as typeof fetch;
  const adapter = createBaselineHordeAdapter({ DATE_CONVERSATION_PROVIDER: 'aihorde' }, fetcher);
  const request: ClaudeRequest = { model: 'ai-horde', system: 'Frozen.', messages: [{ role: 'user', content: 'Hello.' }], maxTokens: 700 };
  const collect = async (input: ClaudeRequest) => { for await (const _ of adapter.stream(input, new AbortController().signal)) { /* consume */ } };
  await Promise.all([collect(request), collect({ ...request, outputSchema: DOUBLE_TURN_SCHEMA })]);
  assert.deepEqual(schemas, [TURN_SCHEMA, DOUBLE_TURN_SCHEMA]);
});

test('native Horde bypasses the bridge compatibility shim', async () => {
  const env = { DATE_CONVERSATION_PROVIDER: 'aihorde', AI_HORDE_TRANSPORT: 'native' };
  const calls: string[][] = [];
  for (const make of [hordeAdapter, createBaselineHordeAdapter]) {
    const seen: string[] = []; calls.push(seen);
    const adapter = make(env, (async (url: unknown) => { seen.push(String(url)); return Response.json([]); }) as typeof fetch);
    await adapter.prepare!();
  }
  assert.deepEqual(calls[0], calls[1]);
  assert.ok(calls[0].length > 0 && calls[0].every(url => !url.startsWith('https://oai.')));
});
