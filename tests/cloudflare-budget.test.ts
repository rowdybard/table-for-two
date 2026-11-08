import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remoteBudgetStore, validBudget } from '../deployment/cloudflare/budget';

test('remote deployment ledger preserves reservations and a private process epoch without fabricating empty state', async () => {
  const record = { day: '2026-11-08', spent: .1, reserved: .02 }, requests: Request[] = [];
  const fake: typeof fetch = async (input, init) => { const request = new Request(input, init); requests.push(request); return request.method === 'GET' ? Response.json(record) : Response.json({ saved: true }); };
  const store = remoteBudgetStore(fake, 'http://budget.internal/ledger', 'process-epoch');
  assert.deepEqual(await store.load(), record); await store.save({ ...record, spent: .12, reserved: 0 });
  assert.equal(requests.length, 2); assert.ok(requests.every(request => request.headers.get('x-budget-epoch') === 'process-epoch'));
  assert.deepEqual(await requests[1].json(), { ...record, spent: .12, reserved: 0 });
  for (const bad of [{ ...record, spent: -1 }, { ...record, reserved: Infinity }, { ...record, injected: true }, { ...record, day: 'tomorrow' }]) assert.equal(validBudget(bad), false);
});

test('remote deployment ledger outages, damaged state and failed persistence all fail closed', async () => {
  for (const response of [new Response('offline', { status: 503 }), Response.json({ spent: 0, reserved: 0 }), Response.json({ day: '2026-11-08', spent: '0', reserved: 0 })]) {
    await assert.rejects(remoteBudgetStore(async () => response).load());
  }
  await assert.rejects(remoteBudgetStore(async () => new Response('failed', { status: 503 })).save({ day: '2026-11-08', spent: .1, reserved: .02 }));
  let requested = false;
  await assert.rejects(remoteBudgetStore(async () => { requested = true; return Response.json({}); }).save({ day: '2026-11-08', spent: NaN, reserved: 0 }));
  assert.equal(requested, false);
  assert.equal(await remoteBudgetStore(async () => Response.json(null)).load(), null, 'a successful empty ledger is distinct from an outage');
});
