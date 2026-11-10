import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dolphinLlmAdapter } from '../server/restaurant/dolphin-llm';
import { DateApiError, TURN_SCHEMA, type ClaudeChunk, type ClaudeRequest } from '../server/restaurant/providers';
import { DOLPHIN_LLM_MODEL } from '../src/restaurant/types';

const key = 'private-fixture-secret';
const request = (extra: Partial<ClaudeRequest> = {}): ClaudeRequest => ({ model: DOLPHIN_LLM_MODEL, system: 'A date conversation.', messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Nice to meet you.' }, { role: 'user', content: 'What next?' }], maxTokens: 700, ...extra });
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const text = (content: string, finish_reason: string | null = null) => event({ choices: [{ delta: { content }, finish_reason }] });
const done = 'data: [DONE]\n\n';
const collect = async (stream: AsyncIterable<ClaudeChunk>) => { const chunks: ClaudeChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };
const safe = (code: string, status: number) => (error: unknown) => error instanceof DateApiError && error.code === code && error.status === status && !error.message.includes(key) && !error.message.includes('private-player');

test('direct Dolphin sends only the documented endpoint a single JSON-mode request with full context', async () => {
  let calls = 0; const schema = structuredClone(TURN_SCHEMA), original = structuredClone(schema);
  const adapter = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key, OPENROUTER_API_KEY: 'different-key' }, (async (url: unknown, init: RequestInit) => {
    calls++; assert.equal(url, 'https://dolphinllm.com/v1/chat/completions'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${key}`);
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, 'uncensored'); assert.equal(body.max_tokens, 700); assert.equal(body.temperature, .8);
    assert.equal(body.stream, true); assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.provider, undefined); assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
    assert.deepEqual(body.messages.slice(1), request().messages); assert.ok(!(init.body as string).includes(key));
    return new Response(text('{"utterances":[]}', 'stop') + event({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 30 } }) + done);
  }) as typeof fetch);
  const result = await collect(adapter.stream(request({ outputSchema: schema }), new AbortController().signal));
  assert.equal(calls, 1); assert.deepEqual(schema, original);
  assert.deepEqual(result, [{ type: 'text', text: '{"utterances":[]}' }, { type: 'usage', usage: { inputTokens: 100, outputTokens: 30 } }]);
});

test('split UTF-8 and SSE frames preserve generated text and final usage', async () => {
  const wire = ': ping\r\n\r\n' + text('Héllo 🌊').replaceAll('\n', '\r\n') + text('', 'stop') + event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } }) + done;
  const bytes = new TextEncoder().encode(wire); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset)); } });
  const adapter = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(stream)) as typeof fetch);
  assert.deepEqual(await collect(adapter.stream(request(), new AbortController().signal)), [{ type: 'text', text: 'Héllo 🌊' }, { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }]);
});

test('HTTP failures are sanitized and never retry or redirect to another provider', async () => {
  for (const [status, code, mapped] of [[401, 'dolphin_auth', 502], [402, 'dolphin_credits', 402], [403, 'dolphin_access', 502], [429, 'dolphin_rate_limit', 429], [503, 'dolphin_provider', 503]] as const) {
    let calls = 0;
    const adapter = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => { calls++; return Response.json({ error: { message: key + ' private-player' } }, { status }); }) as typeof fetch);
    await assert.rejects(() => collect(adapter.stream(request(), new AbortController().signal)), safe(code, mapped)); assert.equal(calls, 1);
  }
});

test('terminal stop and DONE are both required; length, error, malformed and EOF fail closed', async () => {
  for (const wire of [done, text('ok', 'stop'), text('ok') + done, 'data: {bad}\n\n', text('ok', 'unknown') + done]) {
    const adapter = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(wire)) as typeof fetch);
    await assert.rejects(() => collect(adapter.stream(request(), new AbortController().signal)), safe('dolphin_stream', 502));
  }
  const truncated = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(text('partial', 'length') + done)) as typeof fetch);
  await assert.rejects(() => collect(truncated.stream(request(), new AbortController().signal)), safe('dolphin_truncated', 502));
  const failed = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(event({ error: { code: 429, message: key + ' private-player' } }))) as typeof fetch);
  await assert.rejects(() => collect(failed.stream(request(), new AbortController().signal)), safe('dolphin_rate_limit', 429));
});

test('abort cancels pending streams and invalid setup never calls fetch', async () => {
  let calls = 0, canceled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(text('partial'))); }, cancel() { canceled = true; } });
  const fetcher = (async () => { calls++; return new Response(body); }) as typeof fetch;
  const controller = new AbortController(), iterator = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, fetcher).stream(request(), controller.signal)[Symbol.asyncIterator]();
  await iterator.next(); const waiting = iterator.next(); controller.abort(); await assert.rejects(() => waiting, safe('interrupted', 499)); assert.equal(canceled, true);
  await assert.rejects(() => collect(dolphinLlmAdapter({}, fetcher).stream(request(), new AbortController().signal)), safe('dolphin_unconfigured', 503));
  await assert.rejects(() => collect(dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: '   ' }, fetcher).stream(request(), new AbortController().signal)), safe('dolphin_unconfigured', 503));
  await assert.rejects(() => collect(dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, fetcher).stream(request({ model: 'claude-haiku-5-5' }), new AbortController().signal)), safe('dolphin_model', 400));
  assert.equal(calls, 1);
});


test('successful and failed responses do not wait for a hung body cancellation', async () => {
  const stuckBody = (wire: string) => new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(wire)); },
    cancel() { return new Promise<void>(() => {}); },
  });
  const timeout = async <T>(promise: Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup hung')), 300); })]); }
    finally { clearTimeout(timer); }
  };
  const success = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(stuckBody(text('ok', 'stop') + done))) as typeof fetch);
  assert.deepEqual(await timeout(collect(success.stream(request(), new AbortController().signal))), [{ type: 'text', text: 'ok' }]);
  const failure = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(stuckBody('private-player'), { status: 401 })) as typeof fetch);
  await assert.rejects(timeout(collect(failure.stream(request(), new AbortController().signal))), safe('dolphin_auth', 502));
  const controller = new AbortController();
  const interrupted = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(stuckBody(text('partial')))) as typeof fetch);
  const iterator = interrupted.stream(request(), controller.signal)[Symbol.asyncIterator]();
  await iterator.next(); const pending = timeout(iterator.next()); controller.abort();
  await assert.rejects(pending, safe('interrupted', 499));
});

test('a terminal frame may contain final text but later text is rejected', async () => {
  const adapter = dolphinLlmAdapter({ DOLPHIN_LLM_API_KEY: key }, (async () => new Response(text('final', 'stop') + text('late') + done)) as typeof fetch);
  const seen: ClaudeChunk[] = [];
  await assert.rejects(async () => { for await (const chunk of adapter.stream(request(), new AbortController().signal)) seen.push(chunk); }, safe('dolphin_stream', 502));
  assert.deepEqual(seen, [{ type: 'text', text: 'final' }]);
});
