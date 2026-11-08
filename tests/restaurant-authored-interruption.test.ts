import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { attachRestaurantServer, type ClaudeAdapter, type RestaurantOptions } from '../server/restaurant';
import { MENU } from '../src/restaurant/content';
import type { DinnerCommand, DinnerState, SceneTurn, SceneUtterance, TurnEvent } from '../src/restaurant/types';
import type { ClaudeRequest } from '../server/restaurant/providers';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const staleLine: SceneUtterance = { speaker: 'date', text: 'Before anything changed, I had another thought.', emotion: 'flirtatious' };
const staleTurn: SceneTurn = { utterances: [staleLine], emotion: 'flirtatious', action: 'none', memory: 'STALE_MODEL_MEMORY', social: { signal: 'none', reason: '', wantsToLeave: false } };
const decode = (text: string) => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as TurnEvent);

function heldProvider() {
  const ready = deferred(), release = deferred(); let aborted = false, calls = 0; const requests: ClaudeRequest[] = [];
  const claude: ClaudeAdapter = { async *stream(request, signal) {
    requests.push(request); calls++;
    if (calls > 1) { yield { type: 'text', text: JSON.stringify({ ...staleTurn, emotion: 'warm', memory: 'A valid later player turn.' }) }; return; }
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    yield { type: 'usage', usage: { inputTokens: 45, cacheReadTokens: 7 } };
    const prefix = '{"utterances":[' + JSON.stringify(staleLine);
    yield { type: 'text', text: prefix };
    ready.resolve();
    // Deliberately emulate a provider transport delivering a late completion.
    await release.promise;
    yield { type: 'text', text: JSON.stringify(staleTurn).slice(prefix.length) };
  } };
  return { claude, ready, release, requests, get aborted() { return aborted; }, get calls() { return calls; } };
}

async function boot(claude: ClaudeAdapter, options: RestaurantOptions = {}, blind = false) {
  let clock = 1000;
  const http = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  const app = await attachRestaurantServer(http, { env: {}, ledgerPath: false, now: () => clock, autoTick: true, claude, requestTimeoutMs: 5000, scenarioId: 'family-visit', ...options });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const created = await fetch(base + '/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(blind ? { mode: 'blind-date', seed: 'authored-interruption' } : { dateId: 'mira' }) }).then(response => response.json());
  const path = base + `/api/date/sessions/${created.state.id}`;
  const request = (suffix: string, value?: unknown) => fetch(path + suffix, { method: value === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${created.token}`, ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const snapshot = async () => (await (await request('')).json()).state as DinnerState;
  const command = (value: DinnerCommand) => request('/command', value);
  async function advance() { clock += 100; await delay(20); }
  async function takeSeat() {
    for (let i = 0; i < 45; i++) {
      if ((await snapshot()).participants[0].position[2] < 1.5) break;
      assert.equal((await command({ type: 'move', x: 0, z: -1, yaw: 0 })).status, 200); await advance();
    }
    assert.equal((await command({ type: 'interact', target: 'seat' })).status, 200);
  }
  return { request, snapshot, command, advance, takeSeat, async close() { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); } };
}

test('a successful authored care action cancels pending stale dialogue, while movement, no-ops and rejected commands do not', async t => {
  for (const blind of [false, true]) {
    const held = heldProvider(), api = await boot(held.claude, {}, blind);
    t.after(() => { held.release.resolve(); return api.close(); });
    await api.takeSeat();
    const response = await api.request('/turn', { turnId: 'before-water', text: 'What do you like about this place?', model: 'claude-haiku-5-5' });
    const completion = response.text(); await held.ready.promise;
    const generation = (await api.snapshot()).generation;
    assert.equal((await api.command({ type: 'move', x: 0, z: 0, yaw: .3 })).status, 200);
    assert.equal((await api.command({ type: 'interact', target: 'service-bell' })).status, 200);
    assert.equal((await api.command({ type: 'evening', action: 'offer-taste' })).status, 409);
    assert.equal(held.aborted, false); assert.equal((await api.snapshot()).generation, generation);
    assert.equal((await api.request('/playback', { generation, speaker: staleLine.speaker, text: staleLine.text, completed: false, playedSeconds: .25 })).status, 200);
    const changed = await (await api.command({ type: 'evening', action: 'request-water' })).json();
    assert.equal(changed.state.generation, generation + 1); assert.equal(held.aborted, true); assert.equal(held.calls, 1);
    assert.match(changed.state.memory, /Asked Eli for fresh water/);
    held.release.resolve();
    const events = decode(await completion);
    assert.ok(events.some(event => event.type === 'error' && event.code === 'interrupted'));
    const state = await api.snapshot();
    assert.match(state.memory, /Asked Eli for fresh water/); assert.notEqual(state.emotion, 'flirtatious');
    assert.equal(state.usage.inputTokens, 45); assert.equal(state.usage.cacheReadTokens, 7); assert.ok(state.usage.outputTokens > 0); assert.equal(state.usage.claudeRequests, 1);
    assert.equal((await api.request('/speech', { generation, utterance: staleLine })).status, 409);
    const next = await api.request('/turn', { turnId: 'after-water', text: 'Thanks. Let’s carry on.', model: 'claude-haiku-5-5' });
    await next.text();
    const history = held.requests[1].messages.map(message => message.content).join('\n');
    assert.match(history, /interrupted partway/); assert.match(history, /Asked Eli for fresh water/);
    assert.equal(held.calls, 2, 'only the two completed human turns call Claude');
  }
});

test('a timed health scene outranks held model completion and registers its cue in the new generation', async t => {
  const held = heldProvider(); let voices = 0;
  const api = await boot(held.claude, { scenarioId: 'allergic-reaction', storyRate: 120, speech: { async *stream() { voices++; yield Buffer.from('authored-health-audio'); } } });
  t.after(() => { held.release.resolve(); return api.close(); });
  await api.takeSeat();
  assert.equal((await api.command({ type: 'interact', target: 'menu', choice: MENU[0] })).status, 200);
  for (let i = 0; i < 10 && (await api.snapshot()).evening.main.status !== 'served'; i++) await api.advance();
  assert.equal((await api.snapshot()).evening.incident?.event, 'wrong-order');
  assert.equal((await api.command({ type: 'evening', action: 'inspect-ticket' })).status, 200);
  assert.equal((await api.command({ type: 'evening', action: 'return-order' })).status, 200);
  assert.equal((await api.snapshot()).evening.incident, null, 'the serving interruption is complete before the held model starts');
  const response = await api.request('/turn', { turnId: 'before-health', text: 'Tell me about your week.', model: 'claude-haiku-5-5' });
  const completion = response.text(); await held.ready.promise;
  const generation = (await api.snapshot()).generation;
  for (let i = 0; i < 10 && (await api.snapshot()).evening.scenario?.phase !== 'active'; i++) await api.advance();
  const state = await api.snapshot();
  assert.equal(state.evening.scenario?.id, 'allergic-reaction'); assert.equal(state.evening.scenario.phase, 'active');
  assert.equal(state.evening.scenario.effects.service, 'help'); assert.equal(state.emotion, 'surprised');
  assert.equal(state.generation, generation + 1); assert.equal(held.aborted, true); assert.equal(held.calls, 1);
  const health = state.evening.cues.find(cue => cue.key === 'scenario-allergic-reaction-opening')!.utterances[0];
  assert.equal((await api.request('/speech', { generation, utterance: staleLine })).status, 409);
  const speech = await api.request('/speech', { generation: state.generation, utterance: health });
  assert.equal(speech.status, 200); assert.equal(await speech.text(), 'authored-health-audio'); assert.equal(voices, 1);
  held.release.resolve(); assert.ok(decode(await completion).some(event => event.type === 'error' && event.code === 'interrupted'));
  const after = await api.snapshot();
  assert.notEqual(after.memory, staleTurn.memory); assert.equal(after.emotion, 'surprised'); assert.equal(after.usage.inputTokens, 45);
});

test('valid model social repair and boundary cues do not interrupt their own completed turn', async t => {
  let calls = 0; const reactions = ['set', 'repeat', 'repair', 'set', 'repeat', 'repeat'] as const;
  const refusal = 'Please let me choose my own food. Do not order for me.';
  const texts = ['Shall I choose your food?', 'I am ordering for you anyway.', 'You are right. I accept that your order is your choice.', 'Would you like help choosing?', 'I am choosing your dinner against your wishes.', 'I am still choosing for you despite your answer.'];
  const claude: ClaudeAdapter = { async *stream(request) {
    const kind = reactions[calls++], signal = kind === 'set' ? 'none' : kind === 'repeat' ? 'pressure' : 'repair';
    const humanText = JSON.parse(request.messages.at(-1)!.content).playerSaid;
    yield { type: 'text', text: JSON.stringify({ utterances: [{ speaker: 'date', text: kind === 'set' ? refusal : `An actual ${signal} response.`, emotion: 'defensive' }], emotion: 'defensive', action: 'none', memory: `Completed reaction ${calls}.`, social: { signal, reason: `An actual ${signal} moment.`, wantsToLeave: calls === reactions.length, boundary: { kind, topic: 'food-drink', refusal, evidence: humanText } } }) };
  } };
  const api = await boot(claude); t.after(() => api.close());
  for (let i = 0; i < reactions.length; i++) {
    const response = await api.request('/turn', { turnId: `social-${i}`, text: texts[i], model: 'claude-haiku-5-5' });
    const events = decode(await response.text());
    assert.equal(events.some(event => event.type === 'error'), false);
    const state = await api.snapshot(); assert.equal(state.generation, i + 1); assert.equal(state.memory, `Completed reaction ${i + 1}.`);
    assert.equal(state.emotion, 'defensive');
    if (reactions[i] === 'set') {
      const receipt = await api.request('/playback', { generation: state.generation, speaker: 'date', text: refusal, completed: true, playedSeconds: 2 });
      assert.equal(receipt.status, 200);
      if (i === 0) { assert.equal(state.evening.stance, 'curious'); assert.equal(state.evening.cues.some(cue => cue.key === 'boundary-warning'), false, 'the actual refusal is the first warning'); }
    }
  }
  const state = await api.snapshot();
  assert.ok(state.evening.cues.some(cue => cue.key === 'repair'));
  assert.equal(state.evening.farewell.ending?.kind, 'walked-away'); assert.equal(calls, reactions.length);
});
