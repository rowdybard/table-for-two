import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeConversationFailures, type ConversationFailure } from '../deployment/cloudflare/conversation-telemetry';

const json = (value: unknown) => JSON.stringify(value) + '\n';
function response(bytes: Uint8Array, size = 3) {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (offset >= bytes.length) controller.close(); else { const end = Math.min(offset + size, bytes.length); controller.enqueue(bytes.slice(offset, end)); offset = end; } } });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}

test('split UTF-8 conversation bytes pass through exactly while only safe error fields are reported', async () => {
  const wire = json({ type: 'start', model: 'claude-haiku-5-5' }) + json({ type: 'utterance', utterance: { text: 'Private café 🌊 and bearer-token' } })
    + json({ type: 'error', code: 'invalid_dialogue', message: 'Private café bearer-token', details: { field: 'utterance_speaker', index: 1, secret: 'private' } })
    + json({ type: 'state', state: { memory: 'private-memory' } }) + json({ type: 'done' });
  const bytes = new TextEncoder().encode(wire), seen: ConversationFailure[] = [];
  const observed = observeConversationFailures(response(bytes, 1), item => seen.push(item));
  assert.equal(observed.headers.get('cache-control'), 'no-store');
  assert.deepEqual(new Uint8Array(await observed.arrayBuffer()), bytes);
  assert.deepEqual(seen, [{ model: 'claude-haiku-5-5', provider: 'anthropic', code: 'invalid_dialogue', field: 'utterance_speaker', index: 1 }]);
  assert.ok(!JSON.stringify(seen).includes('private')); assert.ok(!JSON.stringify(seen).includes('bearer-token'));
});

test('unknown fields, codes and model identities cannot be smuggled into telemetry', async () => {
  const wire = json({ type: 'start', model: 'private-model' }) + json({ type: 'error', code: 'player_secret', details: { field: 'private-message', index: 42 }, message: 'private-message' })
    + json({ type: 'start', model: 'dolphinllm/uncensored' }) + json({ type: 'error', code: 'invalid_dialogue', details: { field: 'memory_length', index: -1 } });
  const seen: ConversationFailure[] = []; await observeConversationFailures(response(new TextEncoder().encode(wire)), item => seen.push(item)).arrayBuffer();
  assert.deepEqual(seen, [{ model: 'unknown', provider: 'unknown', code: 'unknown' }, { model: 'dolphinllm/uncensored', provider: 'dolphinllm', code: 'invalid_dialogue', field: 'memory_length' }]);
});

test('oversized and malformed lines are discarded without affecting bytes or subsequent diagnostics', async () => {
  const bytes = new TextEncoder().encode('x'.repeat(65537) + '\n' + '{not JSON}\n' + json({ type: 'start', model: 'ai-horde' }) + json({ type: 'error', code: 'horde_provider' }));
  const seen: ConversationFailure[] = [];
  assert.deepEqual(new Uint8Array(await observeConversationFailures(response(bytes, 513), value => seen.push(value)).arrayBuffer()), bytes);
  assert.deepEqual(seen, [{ model: 'ai-horde', provider: 'horde', code: 'horde_provider' }]);
});

test('a throwing diagnostics sink and non-NDJSON responses never disrupt delivery', async () => {
  const bytes = new TextEncoder().encode(json({ type: 'error', code: 'invalid_dialogue' }) + json({ type: 'done' }));
  const result = observeConversationFailures(response(bytes), () => { throw new Error('sink failed'); });
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  const other = new Response('unchanged', { headers: { 'content-type': 'text/plain' } });
  assert.equal(observeConversationFailures(other, () => { throw new Error('unexpected'); }), other);
  assert.equal(await other.text(), 'unchanged');
});
