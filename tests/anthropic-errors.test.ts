import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicAdapter, anthropicOutputSchema, DateApiError, TURN_SCHEMA } from '../server/restaurant/providers';

test('wire schemas omit unsupported array bounds without weakening the original contract', async () => {
  const source = { type: 'object', additionalProperties: false, properties: {
    utterances: { type: 'array', minItems: 0, maxItems: 2, items: { type: 'string' } },
    dateUpdates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', additionalProperties: false, properties: { maxItems: { type: 'string' } } } },
  } };
  const converted = anthropicOutputSchema(source) as typeof source;
  assert.equal(converted.properties.utterances.minItems, 0);
  assert.equal(converted.properties.dateUpdates.minItems, 1);
  assert.equal('maxItems' in converted.properties.utterances, false);
  assert.equal('maxItems' in converted.properties.dateUpdates, false);
  assert.deepEqual(converted.properties.dateUpdates.items.properties.maxItems, { type: 'string' });
  assert.equal(source.properties.dateUpdates.minItems, 2);
  assert.equal(source.properties.dateUpdates.maxItems, 2);
  assert.equal(TURN_SCHEMA.properties.utterances.maxItems, 2);
  let payload: Record<string, any> | undefined;
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'private-server-secret' }, (async (_url: unknown, init: RequestInit) => {
    payload = JSON.parse(init.body as string);
    return new Response('data: {"type":"message_stop"}\n\n');
  }) as typeof fetch);
  for await (const _chunk of adapter.stream({ model: 'claude-haiku-5-5', system: '', messages: [], maxTokens: 500, outputSchema: source }, new AbortController().signal)) {}
  assert.deepEqual(payload?.output_config.format.schema, converted);
});

test('Anthropic credit failures are visible without exposing raw provider messages or keys', async () => {
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'private-server-secret' }, (async () => Response.json({ error: { message: 'Your credit balance is too low. private-server-secret' } }, { status: 400 })) as typeof fetch);
  await assert.rejects(async () => {
    for await (const _chunk of adapter.stream({ model: 'claude-haiku-5-5', system: '', messages: [], maxTokens: 500 }, new AbortController().signal)) {}
  }, error => error instanceof DateApiError && error.status === 402 && error.code === 'claude_credits' && !error.message.includes('private-server-secret'));
});

test('Anthropic request setting and model-access failures remain distinct from billing', async () => {
  for (const [status, message, code] of [[400, 'thinking setting is unsupported; private-server-secret', 'claude_request'], [404, 'model is not found; private-server-secret', 'claude_model']] as const) {
    const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'private-server-secret' }, (async () => Response.json({ error: { message } }, { status })) as typeof fetch);
    await assert.rejects(async () => {
      for await (const _chunk of adapter.stream({ model: 'claude-haiku-5-5', system: '', messages: [], maxTokens: 500 }, new AbortController().signal)) {}
    }, error => error instanceof DateApiError && error.code === code && !error.message.includes('private-server-secret'));
  }
});

test('a streamed Anthropic refusal preserves usage and becomes a distinct content-limit event without a retry', async () => {
  let calls = 0;
  const adapter = anthropicAdapter({ ANTHROPIC_API_KEY: 'private-server-secret' }, (async () => {
    calls++;
    return new Response([
      'data: {"type":"message_start","message":{"usage":{"input_tokens":57,"output_tokens":0}}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}',
      'data: {"type":"message_stop"}',
    ].join('\n\n'));
  }) as typeof fetch);
  let inputTokens = 0;
  await assert.rejects(async () => {
    for await (const chunk of adapter.stream({ model: 'claude-haiku-5-5', system: '', messages: [], maxTokens: 500 }, new AbortController().signal)) if (chunk.type === 'usage') inputTokens += chunk.usage.inputTokens ?? 0;
  }, error => error instanceof DateApiError && error.code === 'conversation_refusal' && !error.message.includes('private-server-secret'));
  assert.equal(inputTokens, 57); assert.equal(calls, 1);
});
