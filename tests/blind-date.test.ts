import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachRestaurantServer, type RestaurantOptions } from '../server/restaurant';
import { DinnerScene } from '../server/restaurant/scene';
import type { ClaudeAdapter, ClaudeRequest, SpeechAdapter } from '../server/restaurant/providers';
import { createBlindDate, getBlindDateCue } from '../src/restaurant/blind-date';
import { getDate, MENU } from '../src/restaurant/content';
import { CHARACTER_STORIES, STORY_CUE_KEYS } from '../src/restaurant/story';
import type { DinnerState, SceneTurn, TurnEvent } from '../src/restaurant/types';

const result: SceneTurn = { utterances: [{ speaker: 'date', text: 'That reminds me of an evening after work.', emotion: 'warm' }, { speaker: 'waiter', text: 'I will give you a moment with the menu.', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'The human asked about work.', social: { signal: 'curiosity', reason: 'The human listened to a personal detail.', wantsToLeave: false } };
async function boot(options: RestaurantOptions = {}) {
  let app: Awaited<ReturnType<typeof attachRestaurantServer>>;
  const http = createServer((req, res) => { if (!app.handle(req, res)) { res.statusCode = 404; res.end(); } });
  app = await attachRestaurantServer(http, { autoTick: false, ledgerPath: false, env: { DATE_SPEECH_PROVIDER: 'none' }, ...options });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, data?: unknown, token = '') => fetch(url + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const create = async (data: Record<string, unknown> = { mode: 'blind-date' }) => { const response = await request('/api/date/sessions', data); assert.equal(response.status, 201, await response.clone().text()); return await response.json() as { state: DinnerState; token: string }; };
  return { request, create, async close() { await app.close(); http.closeAllConnections(); await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); } };
}

test('seeded personalities are deterministic combinations independent from the reused three appearances', () => {
  const first = createBlindDate('late-train-92'); assert.deepEqual(createBlindDate('late-train-92'), first); assert.notDeepEqual(createBlindDate('late-train-93'), first);
  const profiles = Array.from({ length: 60 }, (_, index) => createBlindDate(`blind-${index}`));
  assert.equal(new Set(profiles.map(profile => profile.dateId)).size, 3);
  assert.ok(new Set(profiles.map(profile => profile.personality)).size > 50); assert.ok(new Set(profiles.map(profile => profile.biography.occupation)).size > 8); assert.ok(new Set(profiles.map(profile => profile.preferences)).size > 40);
  for (const profile of profiles) { assert.ok(getDate(profile.dateId)!.age >= 18); assert.ok(profile.boundaries.includes('physical contact')); assert.ok(profile.biography.disclosureRules.includes('preset')); assert.ok(profile.opening.length < 420); assert.ok(profile.personality.length > 400); }
});

test('blind creation generates a fresh seed without a paid call; explicit seeds replay appearance and personality', async t => {
  let calls = 0; const claude: ClaudeAdapter = { async *stream() { calls++; yield { type: 'text', text: JSON.stringify(result) }; } };
  const api = await boot({ claude }); t.after(() => api.close());
  const first = await api.create(), second = await api.create(); assert.equal(first.state.mode, 'blind-date'); assert.ok(first.state.blindDate?.seed); assert.notEqual(first.state.blindDate?.seed, second.state.blindDate?.seed); assert.equal(calls, 0); assert.equal(first.state.usage.claudeRequests, 0);
  const replay = await api.create({ mode: 'blind-date', seed: first.state.blindDate!.seed }); assert.equal(replay.state.dateId, first.state.dateId); assert.equal(replay.state.evening.variation, first.state.evening.variation); assert.deepEqual(replay.state.evening.cues, first.state.evening.cues); assert.equal(replay.state.participants[1].name, getDate(first.state.dateId)!.name);
  const solo = await api.create({ dateId: 'mira' }); assert.equal(solo.state.mode, 'ai-date'); assert.equal(solo.state.blindDate, undefined);
});

test('blind session validation rejects preset overrides, invalid seeds and unsupported modes', async t => {
  const api = await boot(); t.after(() => api.close());
  for (const request of [{ mode: 'blind-date', dateId: 'mira' }, { mode: 'blind-date', seed: '' }, { mode: 'blind-date', seed: 'x'.repeat(81) }, { mode: 'blind-date', seed: 'ignore\ncontract' }, { mode: 'double-date', dateId: 'mira' }, { dateId: 'mira', seed: 'not-a-blind-date' }]) assert.equal((await api.request('/api/date/sessions', request)).status, 400);
});

test('one blind turn uses its seeded biography, preserves cast selection, bills actual usage and deduplicates', async t => {
  const requests: ClaudeRequest[] = [];
  const claude: ClaudeAdapter = { async *stream(request) { requests.push(request); yield { type: 'usage', usage: { inputTokens: 100, cacheReadTokens: 10 } }; yield { type: 'text', text: JSON.stringify(result) }; yield { type: 'usage', usage: { outputTokens: 60 } }; } };
  const api = await boot({ claude }); t.after(() => api.close()); const { state, token } = await api.create({ mode: 'blind-date', seed: 'personality-replay' }), identity = createBlindDate(state.blindDate!.seed), path = `/api/date/sessions/${state.id}`;
  const turn = { turnId: 'one-turn', text: 'What do you enjoy about your work?', model: 'claude-haiku-5-5' };
  const text = await (await api.request(path + '/turn', turn, token)).text(), events = text.trim().split('\n').map(line => JSON.parse(line) as TurnEvent);
  assert.deepEqual(events.filter(event => event.type === 'utterance').map(event => event.utterance.speaker), ['date', 'waiter']); assert.equal(requests.length, 1); assert.ok(requests[0].system.includes(identity.biography.occupation)); assert.ok(requests[0].system.includes(identity.personality)); assert.ok(requests[0].system.includes(identity.boundaries)); assert.equal(requests[0].system.includes(CHARACTER_STORIES[state.dateId].occupation), false);
  const context = JSON.parse(requests[0].messages.at(-1)!.content); assert.ok(context.optionalReusableLines.every((line: any) => line.speaker !== 'date'));
  assert.equal(await (await api.request(path + '/turn', turn, token)).text(), text); assert.equal(requests.length, 1);
  const snapshot = (await (await api.request(path, undefined, token)).json()).state as DinnerState; assert.equal(snapshot.blindDate?.seed, identity.seed); assert.equal(snapshot.usage.claudeRequests, 1); assert.equal(snapshot.usage.inputTokens, 100); assert.equal(snapshot.usage.outputTokens, 60); assert.ok(snapshot.usage.totalCost > 0);
});

test('blind physical cues and course preferences never revert to the visual preset biography', async () => {
  await RAPIER.init();
  for (const seed of ['specific-occupation', 'another-occupation', 'third-occupation']) {
    const identity = createBlindDate(seed), scene = new DinnerScene(identity.dateId, 2, { blindDate: { seed } });
    try {
      assert.equal(scene.state.evening.cues[0].utterances[0].text, identity.opening); scene.state.seated = true;
      scene.command({ type: 'interact', target: 'menu', choice: MENU[0] }); assert.equal(scene.state.evening.main.dateDish, identity.biography.preferredMain);
      const lines = STORY_CUE_KEYS.flatMap(key => getBlindDateCue(identity, key)); assert.ok(lines.length >= STORY_CUE_KEYS.length); assert.equal(lines.some(line => /Ada|Inez|Leena|Second Helping|After Closing|photo show|cookbook/i.test(line.text)), false);
      const ordered = scene.state.evening.cues.find(cue => cue.key === 'ordered')!.utterances[0]; assert.ok(ordered.text.includes(identity.biography.preferredMain.toLowerCase()));
      scene.command({ type: 'finish' }); assert.equal(scene.state.evening.farewell.ending?.dateLine, getBlindDateCue(identity, 'ending-early-exit')[0].text);
    } finally { scene.free(); }
  }
});

test('blind welcome speech is authorized and cached by the same ElevenLabs service; preset biography lines are unavailable', async t => {
  let calls = 0; const speech: SpeechAdapter = { async *stream() { calls++; yield Buffer.from('ID3blind-opening'); } };
  const api = await boot({ speech }); t.after(() => api.close()); const { state, token } = await api.create({ mode: 'blind-date', seed: 'voice-replay' }), path = `/api/date/sessions/${state.id}`, opening = state.evening.cues[0].utterances[0];
  for (let i = 0; i < 2; i++) { const response = await api.request(path + '/speech', { generation: 0, utterance: opening }, token); assert.equal(response.status, 200); assert.equal(await response.text(), 'ID3blind-opening'); }
  assert.equal(calls, 1); assert.equal((await (await api.request(path, undefined, token)).json()).state.usage.cacheHits, 1);
  const preset = getDate(state.dateId)!; const unauthorized = await api.request(path + '/speech', { generation: 0, utterance: { speaker: 'date', text: preset.opening, emotion: 'neutral' } }, token); assert.equal(unauthorized.status, 400);
});
