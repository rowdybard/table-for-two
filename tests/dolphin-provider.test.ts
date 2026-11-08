import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTurn } from '../server/restaurant';
import { DateApiError, TURN_SCHEMA, type ClaudeChunk, type ClaudeRequest } from '../server/restaurant/providers';
import { DOLPHIN_MODEL_ID, openRouterAdapter, openRouterSchemaInstructions } from '../server/restaurant/openrouter';

const key = 'private-openrouter-secret', privateText = 'private-player-content';
const request = (extra: Partial<ClaudeRequest> = {}): ClaudeRequest => ({ model: DOLPHIN_MODEL_ID as ClaudeRequest['model'], system: 'Keep the date conversational.', messages: [{ role: 'user', content: 'Hello there.' }], maxTokens: 700, ...extra });
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const textEvent = (text: string, finish_reason: string | null = null) => event({ choices: [{ index: 0, delta: { content: text }, finish_reason }] });
const done = 'data: [DONE]\n\n';
const response = (body: string) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
const collect = async (stream: AsyncIterable<ClaudeChunk>) => { const chunks: ClaudeChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const validTurn = { utterances: [{ speaker: 'date', text: 'I’m listening. What caught your attention?', emotion: 'amused' }], emotion: 'amused', action: 'none', memory: 'We met at the restaurant.', social: { signal: 'none', reason: 'No boundary change.', wantsToLeave: false }, agenda: { signal: 'none', evidence: '', clue: '' } };
const safeError = (code: string, status: number) => (error: unknown) => error instanceof DateApiError && error.code === code && error.status === status && !error.message.includes(key) && !error.message.includes(privateText);

test('Dolphin uses one OpenRouter JSON-mode request with a textual schema and no Anthropic or fallback settings', async () => {
  let calls = 0;
  const schema = structuredClone(TURN_SCHEMA), before = structuredClone(schema);
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async (url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, DOLPHIN_MODEL_ID);
    assert.equal(body.max_tokens, 700);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true });
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[0].content.startsWith('Keep the date conversational.'));
    assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
    assert.ok(body.messages[0].content.includes('server validates'));
    assert.deepEqual(body.messages[1], { role: 'user', content: 'Hello there.' });
    for (const field of ['thinking', 'output_config', 'reasoning', 'reasoning_effort', 'models', 'transforms']) assert.equal(field in body, false);
    assert.equal((init.body as string).includes(key), false);
    return response(textEvent(JSON.stringify(validTurn), 'stop') + done);
  }) as typeof fetch);
  const chunks = await collect(adapter.stream(request({ outputSchema: schema }), new AbortController().signal));
  const text = chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('');
  assert.equal(validateTurn(JSON.parse(text)).utterances[0].text, validTurn.utterances[0].text);
  assert.deepEqual(schema, before);
  assert.equal(calls, 1);
  assert.ok(openRouterSchemaInstructions().includes(JSON.stringify(TURN_SCHEMA)));
});

test('split SSE bytes, CRLF, comments and multiline events preserve text and actual terminal usage', async () => {
  const text = JSON.stringify(validTurn);
  const wire = ': OPENROUTER PROCESSING\r\n\r\n' + textEvent(text.slice(0, 31)).replaceAll('\n', '\r\n')
    + `event: message\ndata: {"choices":[\ndata: {"index":0,"delta":{"content":${JSON.stringify(text.slice(31))}},"finish_reason":"stop"}]}\n\n`
    + event({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 48, prompt_tokens_details: { cached_tokens: 20 }, cost: .000067 } }) + done;
  const bytes = new TextEncoder().encode(wire);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) return controller.close(); const end = Math.min(bytes.length, offset + 7); controller.enqueue(bytes.slice(offset, end)); offset = end; } });
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => new Response(stream)) as typeof fetch);
  const chunks = await collect(adapter.stream(request(), new AbortController().signal));
  assert.equal(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''), text);
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'usage'), [{ type: 'usage', usage: { inputTokens: 100, cacheReadTokens: 20, outputTokens: 48 } }]);
});

test('JSON mode does not bypass the server speaker, action and extra-field validators', async () => {
  for (const turn of [{ ...validTurn, action: 'teleport' }, { ...validTurn, utterances: [{ ...validTurn.utterances[0], speaker: 'human' }] }, { ...validTurn, points: 100 }]) {
    const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => response(textEvent(JSON.stringify(turn), 'stop') + done)) as typeof fetch);
    const chunks = await collect(adapter.stream(request(), new AbortController().signal));
    const text = chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('');
    assert.throws(() => validateTurn(JSON.parse(text)));
  }
});

test('HTTP access, credit, rate and availability errors stay specific without exposing raw error data or retrying', async () => {
  for (const [status, code, resultStatus] of [[400, 'dolphin_request', 502], [401, 'dolphin_auth', 502], [402, 'dolphin_credits', 402], [403, 'dolphin_access', 502], [404, 'dolphin_model', 502], [408, 'dolphin_timeout', 504], [429, 'dolphin_rate_limit', 429], [500, 'dolphin_provider', 502], [503, 'dolphin_provider', 503]] as const) {
    let calls = 0;
    const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => {
      calls++;
      return Response.json({ error: { code: status, message: `${key} ${privateText}`, metadata: { raw: `${key} ${privateText}` } } }, { status });
    }) as typeof fetch);
    await assert.rejects(() => collect(adapter.stream(request(), new AbortController().signal)), safeError(code, resultStatus));
    assert.equal(calls, 1);
  }
  const limited = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => Response.json({ error: { metadata: { limit_source: 'openrouter_key_limit', raw: key } } }, { status: 403 })) as typeof fetch);
  await assert.rejects(() => collect(limited.stream(request(), new AbortController().signal)), safeError('dolphin_credits', 402));
});

test('explicit content-filter finishes and typed refusals are separate from character boundaries and retain reported usage', async () => {
  const chunks: ClaudeChunk[] = [];
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => response(event({ choices: [{ delta: {}, finish_reason: 'content_filter' }], usage: { prompt_tokens: 45, completion_tokens: 3 } }) + done)) as typeof fetch);
  await assert.rejects(async () => { for await (const chunk of adapter.stream(request(), new AbortController().signal)) chunks.push(chunk); }, safeError('conversation_refusal', 422));
  assert.deepEqual(chunks, [{ type: 'usage', usage: { inputTokens: 45, outputTokens: 3 } }]);
  for (const error_type of ['refusal', 'content_policy_violation']) {
    const refused = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => Response.json({ error: { message: privateText, metadata: { error_type, raw: key } } }, { status: 403 })) as typeof fetch);
    await assert.rejects(() => collect(refused.stream(request(), new AbortController().signal)), safeError('conversation_refusal', 422));
  }
});

test('midstream errors are visible after usage and do not invoke a replacement provider', async () => {
  let calls = 0;
  const seen: ClaudeChunk[] = [];
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => {
    calls++;
    return response(event({ usage: { prompt_tokens: 20, completion_tokens: 4 }, error: { code: 429, message: key + privateText }, choices: [{ delta: {}, finish_reason: 'error' }] }));
  }) as typeof fetch);
  await assert.rejects(async () => { for await (const chunk of adapter.stream(request(), new AbortController().signal)) seen.push(chunk); }, safeError('dolphin_rate_limit', 429));
  assert.deepEqual(seen, [{ type: 'usage', usage: { inputTokens: 20, outputTokens: 4 } }]);
  assert.equal(calls, 1);
});

test('cancellation aborts a pending read and closes its body; abandoned consumers also close the stream', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(textEvent('{"utterances":['))); }, cancel() { canceled = true; } });
  const controller = new AbortController();
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async (_url: unknown, init: RequestInit) => { assert.equal(init.signal, controller.signal); return new Response(body); }) as typeof fetch);
  const iterator = adapter.stream(request(), controller.signal)[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.type, 'text');
  const next = iterator.next(); controller.abort();
  await assert.rejects(() => next, safeError('interrupted', 499));
  assert.equal(canceled, true);
  let abandoned = false;
  const otherBody = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(textEvent('first'))); }, cancel() { abandoned = true; } });
  const other = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => new Response(otherBody)) as typeof fetch);
  for await (const _chunk of other.stream(request(), new AbortController().signal)) break;
  assert.equal(abandoned, true);
});

test('missing credentials, another model and pre-aborted turns never make a request', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return response(done); }) as typeof fetch;
  await assert.rejects(() => collect(openRouterAdapter({}, fetcher).stream(request(), new AbortController().signal)), safeError('dolphin_unconfigured', 503));
  await assert.rejects(() => collect(openRouterAdapter({ OPENROUTER_API_KEY: key }, fetcher).stream(request({ model: 'claude-haiku-5-5' }), new AbortController().signal)), safeError('dolphin_model', 400));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collect(openRouterAdapter({ OPENROUTER_API_KEY: key }, fetcher).stream(request(), controller.signal)), safeError('interrupted', 499));
  assert.equal(calls, 0);
});

test('malformed, oversized and prematurely closed SSE streams produce sanitized failures', async () => {
  for (const wire of ['data: {bad-json}\n\n', 'data: ' + 'x'.repeat(64 * 1024 + 1) + '\n\n', textEvent('{"utterances":[')]) {
    const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => response(wire)) as typeof fetch);
    await assert.rejects(() => collect(adapter.stream(request(), new AbortController().signal)), safeError('dolphin_stream', 502));
  }
  const network = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => { throw new Error(key + privateText); }) as typeof fetch);
  await assert.rejects(() => collect(network.stream(request(), new AbortController().signal)), safeError('dolphin_provider', 502));
});

test('invalid cache figures do not double bill input, and complete empty/malformed text still fails normal JSON validation', async () => {
  const adapter = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => response(event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: -5, prompt_tokens_details: { cached_tokens: 20 } } }) + done)) as typeof fetch);
  assert.deepEqual(await collect(adapter.stream(request(), new AbortController().signal)), [{ type: 'usage', usage: { inputTokens: 10 } }]);
  for (const text of ['', 'Not a JSON response.']) {
    const invalid = openRouterAdapter({ OPENROUTER_API_KEY: key }, (async () => response(textEvent(text, 'stop') + done)) as typeof fetch);
    const chunks = await collect(invalid.stream(request(), new AbortController().signal));
    assert.throws(() => validateTurn(JSON.parse(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join(''))));
  }
});
