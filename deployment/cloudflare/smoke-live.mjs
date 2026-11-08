import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const base = new URL(process.argv[2] || 'https://table-for-two.maxpug17.workers.dev').origin;
assert.equal(new URL(base).protocol, 'https:');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (path, options = {}) => fetch(base + path, { ...options, signal: AbortSignal.timeout(60_000) });
const post = async (path, value, token, origin = base) => {
  const response = await request(path, { method: 'POST', headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${await response.clone().text()}`);
  return response.json();
};
const read = async (path, token) => {
  const response = await request(path, { headers: { authorization: `Bearer ${token}` } });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`); return response.json();
};
const coldStart = performance.now();
let health;
for (let attempt = 0; attempt < 5; attempt++) {
  health = await request('/healthz');
  if (health.ok) break;
  assert.equal(health.status, 503); await pause(1000);
}
assert.ok(health.ok, 'The deployed Node container could not start.');
const coldHealthMs = Math.round(performance.now() - coldStart), warmStart = performance.now();
assert.equal((await request('/healthz')).status, 200);
const warmHealthMs = Math.round(performance.now() - warmStart);
const index = await request('/');
assert.ok(index.ok); assert.match(await index.text(), /Table for Two/);
assert.equal(index.headers.get('cross-origin-opener-policy'), 'same-origin');
assert.equal(index.headers.get('cross-origin-embedder-policy'), 'require-corp');
const manifest = await request('/manifest.webmanifest');
assert.ok(manifest.ok); assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
assert.equal((await manifest.json()).orientation, 'landscape');
assert.equal((await request('/__server/game-server.mjs')).status, 404);
const status = await request('/api/date/status').then(response => response.json());
assert.equal(status.claude, false, 'This initial release is expected to have no Anthropic key yet.');
assert.equal(status.speech, true); assert.equal(status.speechProvider, 'edge'); assert.equal(status.speechCostPer1K, 0);
const rejected = await request('/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: JSON.stringify({ dateId: 'mira' }) });
assert.equal(rejected.status, 403);

const solo = await post('/api/date/sessions', { dateId: 'mira' });
const soloPath = `/api/date/sessions/${solo.state.id}`;
assert.equal(solo.state.mode, 'ai-date'); assert.equal((await request(soloPath)).status, 401);
const speechStart = performance.now();
const speech = await request(soloPath + '/speech', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, authorization: `Bearer ${solo.token}` },
  body: JSON.stringify({ generation: 0, utterance: { speaker: 'waiter', text: 'Welcome in. Your table is ready whenever you are.', emotion: 'warm' } }) });
assert.ok(speech.ok, `Deployed Edge greeting: HTTP ${speech.status} ${await speech.clone().text()}`);
assert.match(speech.headers.get('content-type'), /audio\/mpeg/);
const audio = new Uint8Array(await speech.arrayBuffer());
assert.ok(audio.length > 1000 && (new TextDecoder().decode(audio.slice(0, 3)) === 'ID3' || audio[0] === 255), 'The greeting did not return MP3 audio.');
const speechMs = Math.round(performance.now() - speechStart);
const voiced = (await read(soloPath, solo.token)).state;
assert.ok(voiced.usage.speechCharacters > 0); assert.equal(voiced.usage.speechCost, 0); assert.equal(voiced.usage.claudeRequests, 0);

async function walkToTable(path, token, command = value => value, statePosition = state => state.participants[0].position) {
  let state = (await read(path, token)).state;
  const initial = statePosition(state)[2];
  for (let attempt = 0; attempt < 60 && statePosition(state)[2] > 1.45; attempt++) {
    state = (await post(path + '/command', command({ type: 'move', x: 0, z: -1, yaw: 0 }), token)).state;
    await pause(90);
  }
  state = (await post(path + '/command', command({ type: 'move', x: 0, z: 0, yaw: 0 }), token)).state;
  assert.ok(statePosition(state)[2] < initial - 2, 'Authoritative movement did not reach the table.');
  return (await post(path + '/command', command({ type: 'interact', target: 'seat' }), token)).state;
}
assert.equal((await walkToTable(soloPath, solo.token)).seated, true);
const blind = await post('/api/date/sessions', { mode: 'blind-date', seed: 'deployment-smoke' });
assert.equal(blind.state.blindDate.seed, 'deployment-smoke');
assert.equal((await walkToTable(`/api/date/sessions/${blind.state.id}`, blind.token)).seated, true);
const host = await post('/api/double-date/rooms', { name: 'Release host' });
const friend = await post('/api/double-date/rooms/join', { code: host.state.code, name: 'Release friend' });
const roomPath = `/api/double-date/rooms/${host.roomId}`;
for (const [player, dateId] of [[host, 'mira'], [friend, 'jules']]) {
  await post(roomPath + '/command', { type: 'choose-date', dateId }, player.token);
  await post(roomPath + '/command', { type: 'ready', ready: true }, player.token);
}
assert.equal((await post(roomPath + '/command', { type: 'start' }, host.token)).state.phase, 'playing');
// Keep both browser-equivalent seats alive while each player approaches a chair.
let room;
for (let attempt = 0; attempt < 60; attempt++) {
  const states = await Promise.all([host, friend].map(player => post(roomPath + '/command', { type: 'scene', command: { type: 'move', x: 0, z: -1, yaw: 0 } }, player.token)));
  room = states[1].state;
  if (room.members.every(member => member.position[2] < 1.45)) break;
  await pause(90);
}
for (const player of [host, friend]) {
  await post(roomPath + '/command', { type: 'scene', command: { type: 'move', x: 0, z: 0, yaw: 0 } }, player.token);
  room = (await post(roomPath + '/command', { type: 'scene', command: { type: 'interact', target: 'seat' } }, player.token)).state;
}
assert.ok(room.members.every(member => member.seated && member.connected)); assert.equal(room.usage.claudeRequests, 0);
for (const player of [host, friend]) await post(roomPath + '/leave', {}, player.token);
for (const player of [solo, blind]) await post(`/api/date/sessions/${player.state.id}/command`, { type: 'pause', paused: true }, player.token);
console.log(JSON.stringify({ base, coldHealthMs, warmHealthMs, speechMs, speechBytes: audio.length, speechCost: 0, claudeConfigured: false, modes: ['solo', 'blind', 'double'], navigationAndSeating: true, originAndBearer: true, privateBundleBlocked: true, manifestAndIsolationHeaders: true }));
