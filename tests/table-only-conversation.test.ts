import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachRestaurantServer, validateTurn } from '../server/restaurant';
import { DinnerScene } from '../server/restaurant/scene';
import { RESTAURANT } from '../src/restaurant/content';
import { soloSystem } from '../server/restaurant/conversation-prompt';
import type { ClaudeAdapter, ClaudeRequest } from '../server/restaurant/providers';
import type { SceneTurn, SceneUtterance } from '../src/restaurant/types';

const line: SceneUtterance = { speaker: 'date', text: 'Hello, how has your day been?', emotion: 'warm' };
const result: SceneTurn = { utterances: [line], emotion: 'warm', action: 'none', memory: 'HUMAN: enjoys books.\nTOLD THEM: nothing yet.\nOPEN: asked about their day.' };

test('the human starts seated, the date arrives, and no service or scripted scene interrupts', async () => {
  await RAPIER.init(); const scene = new DinnerScene('mira', 1);
  try {
    const before = scene.snapshot();
    assert.equal(before.seated, true); assert.equal(before.stage, 'seated');
    assert.deepEqual(before.participants[0].position, [RESTAURANT.seat[0], 0, RESTAURANT.seat[2] + .28]);
    assert.ok(Math.hypot(before.participants[1].position[0] - RESTAURANT.dateSeat[0], before.participants[1].position[2] - RESTAURANT.dateSeat[2]) > 1);
    scene.command({ type: 'move', x: 1, z: 0, yaw: 0 });
    assert.throws(() => scene.command({ type: 'interact', target: 'seat' }), /at the table/);
    assert.throws(() => scene.command({ type: 'interact', target: 'menu' }), /at the table/);
    for (let i = 0; i < 2400; i++) scene.step(1 / 60, i * 1000 / 60);
    const after = scene.snapshot();
    assert.equal(after.seated, true); assert.equal(after.order, null);
    assert.ok(Math.hypot(after.participants[1].position[0] - RESTAURANT.dateSeat[0], after.participants[1].position[2] - RESTAURANT.dateSeat[2]) < .4, 'date reaches the other chair');
    assert.deepEqual(after.evening.cues, []); assert.equal(after.evening.scenario, undefined); assert.equal(after.evening.incident, null);
    scene.command({ type: 'pause', paused: true }); assert.equal(scene.snapshot().phase, 'paused');
    scene.command({ type: 'pause', paused: false }); scene.command({ type: 'finish' });
    assert.equal(scene.snapshot().phase, 'ended'); assert.deepEqual(scene.snapshot().evening.cues, []);
  } finally { scene.free(); }
});

test('the real Solo turn sends no staff or agenda direction and streams only the date', async t => {
  const requests: ClaudeRequest[] = [];
  const claude: ClaudeAdapter = { async *stream(request) { requests.push(request); yield { type: 'text', text: JSON.stringify(result) }; } };
  let app: Awaited<ReturnType<typeof attachRestaurantServer>>;
  const http = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  app = await attachRestaurantServer(http, { claude, env: { DATE_SPEECH_PROVIDER: 'none' }, ledgerPath: false, autoTick: false });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const created = await (await fetch(`${base}/api/date/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateId: 'mira' }) })).json() as { state: { id: string; seated: boolean; evening: { cues: unknown[] } }; token: string };
  assert.equal(created.state.seated, true); assert.deepEqual(created.state.evening.cues, []);
  const turn = await fetch(`${base}/api/date/sessions/${created.state.id}/turn`, { method: 'POST', headers: { authorization: `Bearer ${created.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'first', text: 'I enjoy books.', model: 'claude-haiku-5-5' }) });
  const events = (await turn.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(requests.length, 1); assert.deepEqual(events.filter(event => event.type === 'utterance').map(event => event.utterance.speaker), ['date']);
  assert.ok(events.some(event => event.type === 'done')); assert.ok(!events.some(event => event.type === 'error'));
  assert.doesNotMatch(requests[0].system, /Eli the waiter|private goal|Add Eli/);
  assert.doesNotMatch(requests[0].messages.at(-1)!.content, /private goal|Eli has offered|menus/);
  assert.throws(() => validateTurn({ ...result, utterances: [line, { ...line, speaker: 'waiter' }] }), /invalid line/);
  assert.doesNotMatch(soloSystem({ dateId: 'mira', blindDate: undefined, model: 'claude-haiku-5-5' }), /Eli the waiter|private goal/);
});

test('ordinary kindness does not auto-award comfort; reciprocal delivered chemistry can develop without an agenda', async () => {
  await RAPIER.init(); const scene = new DinnerScene('mira', 1);
  try {
    const kind = { ...result, social: { signal: 'kindness' as const, reason: 'A kind remark.', wantsToLeave: false } };
    for (let i = 1; i <= 3; i++) { scene.state.generation = i; scene.applyTurn(kind, `Thank you for the kind thought number ${i}.`); scene.acknowledge(line); }
    assert.equal(scene.state.evening.stance, 'curious'); assert.equal(scene.state.evening.chemistry?.unlocked, false);
    const first = { speaker: 'date' as const, text: 'You are making me smile too.', emotion: 'flirtatious' as const };
    const second = { speaker: 'date' as const, text: 'I would like to keep talking with you.', emotion: 'flirtatious' as const };
    scene.state.generation = 4; scene.applyTurn({ ...result, utterances: [first] }, 'I really like your smile.'); scene.acknowledge(first);
    scene.state.generation = 5; scene.applyTurn({ ...result, utterances: [second] }, 'I would enjoy seeing you again.');
    assert.equal(scene.state.evening.chemistry?.unlocked, false, 'unheard speech is not chemistry');
    scene.acknowledge(second); assert.equal(scene.state.evening.chemistry?.unlocked, true); assert.equal(scene.state.evening.stance, 'comfortable');
  } finally { scene.free(); }
});
