import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(fileURLToPath(import.meta.url));
const withEdge = process.env.SMOKE_EDGE === '1';
const artifact = JSON.parse(await readFile(join(project, '.cloudflare/deploy-artifact.json'), 'utf8'));
const backend = artifact.files.find(file => file.path === '/__server/game-server.mjs').file;
let ledgerReads = 0;
const ledger = createServer((request, response) => {
  assert.equal(request.headers['x-budget-epoch'], 'smoke-process');
  if (request.method === 'GET') { ledgerReads++; response.writeHead(200, { 'content-type': 'application/json' }); response.end('null'); }
  else response.writeHead(500).end();
});
await new Promise(resolve => ledger.listen(0, '127.0.0.1', resolve));
const lease = createServer(); await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve));
const port = lease.address().port; await new Promise(resolve => lease.close(resolve));
const child = spawn(process.execPath, [backend], { windowsHide: true, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), BUDGET_EPOCH: 'smoke-process', BUDGET_BRIDGE_URL: `http://127.0.0.1:${ledger.address().port}/ledger`, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', ELEVENLABS_API_KEY: '', DATE_SPEECH_PROVIDER: withEdge ? 'edge' : 'none' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, output || 'The packaged Node runtime did not start.'); assert.equal(ledgerReads, 1);
  const status = await fetch(base + '/api/date/status').then(response => response.json()); assert.equal(status.claude, false); assert.equal(status.anthropic, false); assert.equal(status.dolphin, false); assert.equal(status.defaultModel, 'claude-haiku-5-5'); assert.equal(status.speech, withEdge);
  const post = async (path, value, token) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://preview.example', 'x-forwarded-host': 'preview.example', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(value) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  };
  const solo = await post('/api/date/sessions', { dateId: 'mira' }); assert.equal(solo.state.mode, 'ai-date');
  if (withEdge) {
    const response = await fetch(base + `/api/date/sessions/${solo.state.id}/speech`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://preview.example', 'x-forwarded-host': 'preview.example', authorization: `Bearer ${solo.token}` }, body: JSON.stringify({ generation: 0, utterance: { speaker: 'waiter', text: 'Welcome in. Your table is ready whenever you are.', emotion: 'warm' } }) });
    assert.ok(response.ok, `Bundled Edge greeting failed: HTTP ${response.status} ${await response.clone().text()}`);
    assert.match(response.headers.get('content-type'), /audio\/mpeg/); assert.ok((await response.arrayBuffer()).byteLength > 1000);
    const voiced = await fetch(base + `/api/date/sessions/${solo.state.id}`, { headers: { authorization: `Bearer ${solo.token}` } }).then(response => response.json());
    assert.ok(voiced.state.usage.speechCharacters > 0); assert.equal(voiced.state.usage.speechCost, 0); assert.equal(voiced.state.usage.claudeRequests, 0);
    console.log('Bundled free Edge greeting returned MP3 audio with zero speech cost and no Claude request.');
  }
  const blind = await post('/api/date/sessions', { mode: 'blind-date', seed: 'deployment-smoke' }); assert.equal(blind.state.blindDate.seed, 'deployment-smoke');
  const host = await post('/api/double-date/rooms', { name: 'Host' }), friend = await post('/api/double-date/rooms/join', { code: host.state.code, name: 'Friend' });
  for (const [seat, dateId] of [[host, 'mira'], [friend, 'jules']]) { await post(`/api/double-date/rooms/${seat.roomId}/command`, { type: 'choose-date', dateId }, seat.token); await post(`/api/double-date/rooms/${seat.roomId}/command`, { type: 'ready', ready: true }, seat.token); }
  const started = await post(`/api/double-date/rooms/${host.roomId}/command`, { type: 'start' }, host.token); assert.equal(started.state.phase, 'playing');
  assert.equal(started.state.model, 'claude-haiku-5-5');
  assert.ok(started.state.members.every(member => member.connected)); assert.equal(started.state.usage.claudeRequests, 0);
  console.log('Packaged Node runtime: durable-ledger startup, public-origin proxy, Solo/Blind/Double APIs and unconfigured provider status passed.');
} finally {
  child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  ledger.closeAllConnections(); await new Promise(resolve => ledger.close(resolve));
}
