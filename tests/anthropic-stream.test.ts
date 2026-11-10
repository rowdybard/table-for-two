import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anthropicAdapter, DateApiError, type ClaudeChunk, type ClaudeRequest } from '../server/restaurant/providers';

const request: ClaudeRequest = { model: 'claude-haiku-5-5', system: 'fixture', messages: [{ role: 'user', content: 'Hello.' }], maxTokens: 700 };
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
const start = sse({ type: 'message_start', message: { usage: { input_tokens: 41, cache_read_input_tokens: 12 } } });
const text = sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"memory":"Café"}' } });
const delta = (stop_reason: string) => sse({ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 17 } });
const stop = sse({ type: 'message_stop' });
const collect = async (wire: string, chunkSize = 8) => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    const bytes = new TextEncoder().encode(wire);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize)); controller.close(); } }));
  }) as typeof fetch;
  const chunks: ClaudeChunk[] = [];
  try { for await (const chunk of anthropicAdapter({ ANTHROPIC_API_KEY: 'fixture' }, fetcher).stream(request, new AbortController().signal)) chunks.push(chunk); }
  catch (error) { return { chunks, calls, error }; }
  return { chunks, calls, error: undefined };
};

test('complete Anthropic streams preserve split UTF-8 and usage for both supported stop reasons', async () => {
  for (const reason of ['end_turn', 'stop_sequence']) {
    const result = await collect(start + text + delta(reason) + stop, 3);
    assert.equal(result.error, undefined); assert.equal(result.calls, 1);
    assert.deepEqual(result.chunks, [ { type: 'usage', usage: { inputTokens: 41, cacheReadTokens: 12 } }, { type: 'text', text: '{"memory":"Café"}' }, { type: 'usage', usage: { outputTokens: 17 } } ]);
  }
});

test('the final terminal event is recognized even without a trailing newline', async () => {
  const result = await collect(start + text + delta('end_turn') + stop.trimEnd());
  assert.equal(result.error, undefined);
  assert.equal(result.chunks.filter(chunk => chunk.type === 'text').length, 1);
});

test('complete-looking JSON still fails when provider completion or stop reason is missing', async () => {
  for (const wire of [start + text, start + text + delta('end_turn'), start + text + stop]) {
    const result = await collect(wire);
    assert.ok(result.error instanceof DateApiError && result.error.code === 'claude_stream');
    assert.equal(result.calls, 1);
  }
});

test('truncation, refusal, provider errors and unsupported stop reasons fail without retry', async () => {
  for (const [wire, code] of [
    [delta('max_tokens') + stop, 'claude_truncated'],
    [delta('model_context_window_exceeded') + stop, 'claude_truncated'],
    [delta('refusal') + stop, 'conversation_refusal'],
    [delta('tool_use') + stop, 'claude_stream'],
    [delta('pause_turn') + stop, 'claude_stream'],
    [sse({ type: 'error', error: { message: 'private fixture text' } }), 'claude_provider'],
  ] as const) {
    const result = await collect(start + text + wire);
    assert.ok(result.error instanceof DateApiError && result.error.code === code);
    assert.ok(!result.error.message.includes('private fixture text'));
    assert.equal(result.calls, 1);
  }
});

test('message_stop completes without waiting for a proxy to close the body', async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(start + text + delta('end_turn') + stop)); }, cancel() { canceled = true; } });
  const chunks: ClaudeChunk[] = [];
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'fixture' }, (async () => new Response(stream)) as typeof fetch);
  for await (const chunk of adapter.stream(request, new AbortController().signal)) chunks.push(chunk);
  assert.equal(chunks.filter(chunk => chunk.type === 'text').length, 1); assert.equal(canceled, true);
});

test('aborting a headers-only body cancels its reader and settles without late text', async () => {
  let canceled = false, calls = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(start)); }, cancel() { canceled = true; } });
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'fixture' }, (async () => { calls++; return new Response(stream); }) as typeof fetch);
  const controller = new AbortController(), chunks: ClaudeChunk[] = [];
  const read = (async () => { for await (const chunk of adapter.stream(request, controller.signal)) chunks.push(chunk); })();
  await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
  await assert.rejects(read, { name: 'AbortError' }); assert.equal(canceled, true); assert.equal(calls, 1);
  assert.equal(chunks.some(chunk => chunk.type === 'text'), false);
});

test('aborting between already-buffered events never yields a late line', async () => {
  const controller = new AbortController(), chunks: ClaudeChunk[] = [];
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'fixture' }, (async () => new Response(start + text + delta('end_turn') + stop)) as typeof fetch);
  const read = (async () => {
    for await (const chunk of adapter.stream(request, controller.signal)) { chunks.push(chunk); controller.abort(); }
  })();
  await assert.rejects(read, { name: 'AbortError' });
  assert.equal(chunks.some(chunk => chunk.type === 'text'), false);
});
