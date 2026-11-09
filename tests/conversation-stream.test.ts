import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeTurnResponse, replyDeadlineMs } from '../src/restaurant/conversation-stream';
import type { TurnEvent } from '../src/restaurant/types';

const wire = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';

test('turn reader preserves split UTF-8 lines and actual selected-model metadata', async () => {
  const encoded = new TextEncoder().encode(wire([{ type: 'start', generation: 2, model: 'ai-horde' }, { type: 'utterance', generation: 2, index: 0, utterance: { speaker: 'date', text: 'Café? I’m listening.', emotion: 'warm' } }, { type: 'done', generation: 2 }]));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3)); controller.close(); } });
  const seen: TurnEvent[] = [];
  await consumeTurnResponse(new Response(stream), new AbortController().signal, event => seen.push(event));
  assert.equal(seen.length, 3); assert.equal(seen[0].type === 'start' && seen[0].model, 'ai-horde');
  assert.equal(seen[1].type === 'utterance' && seen[1].utterance.text, 'Café? I’m listening.');
});

test('a provider error still consumes terminal state and done before releasing the turn', async () => {
  const seen: string[] = [];
  await assert.rejects(consumeTurnResponse(new Response(wire([{ type: 'start', generation: 1 }, { type: 'error', message: 'Community queue unavailable.' }, { type: 'state', state: { id: 'same-evening' } }, { type: 'done', generation: 1 }])), new AbortController().signal, event => seen.push(event.type)), /Community queue unavailable/);
  assert.deepEqual(seen, ['start', 'error', 'state', 'done']);
});

test('EOF without a terminal event cannot silently report success', async () => {
  await assert.rejects(consumeTurnResponse(new Response(wire([{ type: 'start', generation: 1 }])), new AbortController().signal, () => {}), /reply was interrupted/);
  await assert.rejects(consumeTurnResponse(new Response('{broken}\n'), new AbortController().signal, () => {}), /unreadable reply/);
});

test('a headers/start-only stream cancels on the browser deadline and cannot emit late dialogue', async () => {
  let canceled = false, source: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { source = controller; controller.enqueue(new TextEncoder().encode(wire([{ type: 'start', generation: 1 }]))); }, cancel() { canceled = true; } });
  const controller = new AbortController(), seen: TurnEvent[] = [];
  const reading = consumeTurnResponse(new Response(stream), controller.signal, event => seen.push(event));
  await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
  await assert.rejects(reading, { name: 'AbortError' }); assert.equal(canceled, true);
  assert.deepEqual(seen.map(event => event.type), ['start']);
  assert.throws(() => source!.enqueue(new TextEncoder().encode(wire([{ type: 'done', generation: 1 }]))));
});

test('deadlines honor actual provider budgets and remain compatible with old start events', () => {
  assert.equal(replyDeadlineMs(undefined, 'claude-haiku-5-5'), 30000);
  assert.equal(replyDeadlineMs({ horde: true }), 65000);
  assert.equal(replyDeadlineMs({ horde: true, conversationTimeoutMs: 2500, hordeTimeoutMs: 6000 }, 'claude-haiku-5-5'), 7500);
  assert.equal(replyDeadlineMs({ horde: true, conversationTimeoutMs: 2500, hordeTimeoutMs: 6000 }, 'ai-horde'), 11000);
  assert.equal(replyDeadlineMs({ horde: true, hordeTimeoutMs: Infinity }, 'ai-horde'), 65000);
});

test('done releases the turn even when a proxy never closes the HTTP body', async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(wire([{ type: 'start', generation: 1 }, { type: 'done', generation: 1 }]))); }, cancel() { canceled = true; } });
  await consumeTurnResponse(new Response(stream), new AbortController().signal, () => {});
  assert.equal(canceled, true);
});
