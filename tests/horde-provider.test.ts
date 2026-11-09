import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTurn } from '../server/restaurant';
import { DEFAULT_HORDE_MODEL, hordeAdapter } from '../server/restaurant/horde';
import { DateApiError, TURN_SCHEMA, type ClaudeChunk, type ClaudeRequest } from '../server/restaurant/providers';
import { HORDE_MODEL } from '../src/restaurant/types';

const privateKey = 'private-horde-key', privateText = 'private-player-content';
const env = { DATE_EARNED_PROVIDER: 'aihorde' };
const request = (extra: Partial<ClaudeRequest> = {}): ClaudeRequest => ({ model: HORDE_MODEL, system: 'Keep the date conversational.', messages: [{ role: 'user', content: 'Hello there.' }], maxTokens: 700, ...extra });
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const textEvent = (text: string, finish_reason: string | null = null) => event({ choices: [{ index: 0, delta: { content: text }, finish_reason }] });
const done = 'data: [DONE]\n\n';
const response = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
const collect = async (stream: AsyncIterable<ClaudeChunk>) => { const chunks: ClaudeChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const safeError = (code: string, status: number) => (error: unknown) => error instanceof DateApiError && error.code === code && error.status === status && !error.message.includes(privateKey) && !error.message.includes(privateText);
const validTurn = { utterances: [{ speaker: 'date', text: 'I’m listening. What caught your attention?', emotion: 'amused' }], emotion: 'amused', action: 'none', memory: 'We met at the restaurant.', social: { signal: 'none', reason: 'No boundary change.', wantsToLeave: false }, agenda: { signal: 'none', evidence: '', clue: '' } };

test('Horde sends one anonymous JSON-mode request, preserves the schema and caps the free reply', async () => {
  let calls = 0;
  const schema = structuredClone(TURN_SCHEMA), before = structuredClone(schema);
  const adapter = hordeAdapter(env, (async (url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://oai.aihorde.net/v1/chat/completions');
    assert.equal(init.method, 'POST');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer 0000000000');
    assert.equal(headers['X-Title'], 'Table for Two');
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, DEFAULT_HORDE_MODEL);
    assert.equal(body.max_tokens, 512);
    assert.equal(body.stream, true);
    assert.equal(body.reasoning_effort, 'none');
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.horde, { conformance: 'best_effort', include_reasoning: false, context_fit: 'grow', trusted_workers: true, validated_backends: true, availability_mode: 'fail_fast' });
    assert.ok(body.messages[0].content.startsWith('Keep the date conversational.'));
    assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
    assert.ok(body.messages[0].content.includes('server validates'));
    assert.deepEqual(body.messages[1], { role: 'user', content: 'Hello there.' });
    for (const field of ['provider', 'thinking', 'output_config', 'models', 'transforms']) assert.equal(field in body, false);
    return response(textEvent(JSON.stringify(validTurn), 'stop') + done);
  }) as typeof fetch);
  const chunks = await collect(adapter.stream(request({ outputSchema: schema }), new AbortController().signal));
  assert.equal(validateTurn(JSON.parse(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''))).utterances[0].text, validTurn.utterances[0].text);
  assert.deepEqual(schema, before);
  assert.equal(calls, 1);
});

test('Horde grows context without truncating or reordering conversation messages', async () => {
  const messages: ClaudeRequest['messages'] = [
    { role: 'user', content: 'Remember the radio I repaired in Leeds. '.repeat(600) },
    { role: 'assistant', content: 'You repaired a radio in Leeds.' },
    { role: 'user', content: 'What did I repair?' },
  ];
  let calls = 0;
  const adapter = hordeAdapter(env, (async (_url: unknown, init: RequestInit) => {
    calls++;
    const body = JSON.parse(init.body as string);
    assert.equal(body.horde.context_fit, 'grow');
    assert.equal('max_context_length' in body.horde, false);
    assert.deepEqual(body.messages.slice(1), messages);
    return response(textEvent('{}', 'stop') + done);
  }) as typeof fetch);
  const before = structuredClone(messages);
  await collect(adapter.stream(request({ messages }), new AbortController().signal));
  assert.deepEqual(messages, before); assert.equal(calls, 1);
});

test('server-only Horde credentials and model override remain out of the request messages', async () => {
  const adapter = hordeAdapter({ ...env, AI_HORDE_API_KEY: privateKey, AI_HORDE_MODEL: 'koboldcpp/other-model' }, (async (_url: unknown, init: RequestInit) => {
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${privateKey}`);
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'koboldcpp/other-model');
    assert.equal(body.max_tokens, 240);
    assert.equal((init.body as string).includes(privateKey), false);
    return response(textEvent('{}', 'stop') + done);
  }) as typeof fetch);
  await collect(adapter.stream(request({ maxTokens: 240 }), new AbortController().signal));
});

test('split SSE bytes and heartbeats preserve response text and reported terminal usage', async () => {
  const text = JSON.stringify(validTurn);
  const wire = ': waiting for a worker\r\n\r\n' + textEvent(text.slice(0, 31)).replaceAll('\n', '\r\n')
    + `event: message\ndata: {"choices":[\ndata: {"index":0,"delta":{"content":${JSON.stringify(text.slice(31))}},"finish_reason":"stop"}]}\n\n`
    + event({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 48, prompt_tokens_details: { cached_tokens: 20 } } }) + done;
  const bytes = new TextEncoder().encode(wire); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) return controller.close(); const end = Math.min(bytes.length, offset + 7); controller.enqueue(bytes.slice(offset, end)); offset = end; } });
  const chunks = await collect(hordeAdapter(env, (async () => new Response(stream)) as typeof fetch).stream(request(), new AbortController().signal));
  assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''), text);
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'usage'), [{ type: 'usage', usage: { inputTokens: 100, cacheReadTokens: 20, outputTokens: 48 } }]);
});

test('HTTP and streamed Horde failures are sanitized, specific and never retried', async () => {
  for (const [status, upstreamCode, code, resultStatus] of [
    [400, 'UnsupportedChatParameter', 'horde_request', 502], [400, 'PromptExceedsContext', 'horde_context', 503], [401, 'InvalidAPIKey', 'horde_auth', 502],
    [403, 'KudosUpfront', 'horde_kudos', 503], [403, 'PermissionDenied', 'horde_access', 502],
    [404, 'no_worker_supports_features', 'horde_model', 503], [503, 'no_eligible_worker', 'horde_model', 503],
    [429, 'TooManyPrompts', 'horde_rate_limit', 429], [408, 'ChatRequestTimeout', 'horde_timeout', 504],
    [503, 'FrontAtCapacity', 'horde_provider', 503], [500, 'ChatRequestFaulted', 'horde_provider', 502],
  ] as const) {
    let calls = 0;
    const adapter = hordeAdapter({ ...env, AI_HORDE_API_KEY: privateKey }, (async () => {
      calls++;
      return Response.json({ error: { code: upstreamCode, message: privateKey + privateText, metadata: { raw: privateText } } }, { status, headers: { 'x-should-retry': 'false' } });
    }) as typeof fetch);
    await assert.rejects(() => collect(adapter.stream(request(), new AbortController().signal)), safeError(code, resultStatus));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const seen: ClaudeChunk[] = [];
  const adapter = hordeAdapter(env, (async () => {
    calls++;
    return response(event({ choices: [], usage: { prompt_tokens: 45, completion_tokens: 3 } }) + event({ error: { code: 'ChatRequestTimeout', message: privateText } }) + done);
  }) as typeof fetch);
  await assert.rejects(async () => { for await (const chunk of adapter.stream(request(), new AbortController().signal)) seen.push(chunk); }, safeError('horde_timeout', 504));
  assert.deepEqual(seen, [{ type: 'usage', usage: { inputTokens: 45, outputTokens: 3 } }]);
  assert.equal(calls, 1);
});

test('provider refusals remain distinct from incomplete output and character boundaries', async () => {
  for (const frame of [event({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }), event({ choices: [{ delta: { refusal: privateText }, finish_reason: null }] }), event({ error: { code: 'content_policy_violation', message: privateText } })]) {
    await assert.rejects(() => collect(hordeAdapter(env, (async () => response(frame + done)) as typeof fetch).stream(request(), new AbortController().signal)), safeError('conversation_refusal', 422));
  }
  await assert.rejects(() => collect(hordeAdapter(env, (async () => response(textEvent('{"utterances":[', 'length') + done)) as typeof fetch).stream(request(), new AbortController().signal)), safeError('horde_truncated', 502));
  for (const turn of [{ ...validTurn, action: 'teleport' }, { ...validTurn, utterances: [{ ...validTurn.utterances[0], speaker: 'human' }] }, { ...validTurn, points: 100 }]) {
    const chunks = await collect(hordeAdapter(env, (async () => response(textEvent(JSON.stringify(turn), 'stop') + done)) as typeof fetch).stream(request(), new AbortController().signal));
    assert.throws(() => validateTurn(JSON.parse(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''))));
  }
});

test('disabled, wrong-model and pre-aborted Horde turns create no request', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return response(done); }) as typeof fetch;
  await assert.rejects(() => collect(hordeAdapter({ AI_HORDE_API_KEY: privateKey }, fetcher).stream(request(), new AbortController().signal)), safeError('horde_unconfigured', 503));
  await assert.rejects(() => collect(hordeAdapter(env, fetcher).stream(request({ model: 'claude-haiku-5-5' }), new AbortController().signal)), safeError('horde_model', 400));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collect(hordeAdapter(env, fetcher).stream(request(), controller.signal)), safeError('interrupted', 499));
  assert.equal(calls, 0);
});

test('cancellation and abandoned Horde consumers close the upstream stream', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(textEvent('{"utterances":['))); }, cancel() { canceled = true; } });
  const controller = new AbortController();
  const adapter = hordeAdapter(env, (async (_url: unknown, init: RequestInit) => { assert.equal(init.signal, controller.signal); return new Response(body); }) as typeof fetch);
  const iterator = adapter.stream(request(), controller.signal)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.type, 'text');
  const next = iterator.next(); controller.abort();
  await assert.rejects(() => next, safeError('interrupted', 499));
  assert.equal(canceled, true);
  let abandoned = false;
  const otherBody = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(textEvent('first'))); }, cancel() { abandoned = true; } });
  for await (const _chunk of hordeAdapter(env, (async () => new Response(otherBody)) as typeof fetch).stream(request(), new AbortController().signal)) break;
  assert.equal(abandoned, true);
});

test('malformed, oversized, truncated and network responses fail without exposing upstream content', async () => {
  for (const wire of ['data: {bad-json}\n\n', 'data: ' + 'x'.repeat(64 * 1024 + 1) + '\n\n', textEvent('{"utterances":['), event({ choices: [{ delta: { content: { secret: privateText } } }] })]) {
    await assert.rejects(() => collect(hordeAdapter(env, (async () => response(wire)) as typeof fetch).stream(request(), new AbortController().signal)), safeError('horde_stream', 502));
  }
  const network = hordeAdapter(env, (async () => { throw new Error(privateKey + privateText); }) as typeof fetch);
  await assert.rejects(() => collect(network.stream(request(), new AbortController().signal)), safeError('horde_provider', 502));
  const usage = await collect(hordeAdapter(env, (async () => response(event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: -1, prompt_tokens_details: { cached_tokens: 20 } } }) + done)) as typeof fetch).stream(request(), new AbortController().signal));
  assert.deepEqual(usage, [{ type: 'usage', usage: { inputTokens: 10 } }]);
});
