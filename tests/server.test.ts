import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer } from '../server/index';
import { CLAW, POOL, VENUE } from '../src/shared/venue';
import type { RoomState, ServerMessage } from '../src/shared/protocol';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
class Client {
  messages: ServerMessage[] = [];
  constructor(public ws: WebSocket) { ws.on('message', data => this.messages.push(JSON.parse(data.toString()))); }
  send(message: unknown) { this.ws.send(JSON.stringify(message)); }
  async next<T extends ServerMessage['type']>(type: T, predicate: (value: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeoutMs = 10000): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const i = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>));
      if (i >= 0) return this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      await delay(10);
    }
    throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(this.messages.slice(-4))}`);
  }
}
async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const client = new Client(ws);
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return client;
}
function position(state: RoomState) { return state.players.find(p => p.id === 'p1')!.position; }

test('authoritative room lifecycle, validation, movement, pause, communication and reconnect', async t => {
  const http = createServer(); const game = await attachGameServer(http);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const welcome = await a.next('welcome');
  const waiting = await a.next('state', s => s.phase === 'waiting'); assert.equal(waiting.players.length, 1);
  const b = await connect(port); b.send({ type: 'join', room: welcome.room, name: 'Sam' }); const second = await b.next('welcome');
  await a.next('state', s => s.phase === 'playing' && s.players.length === 2);
  const outsider = await connect(port); outsider.send({ type: 'join', room: welcome.room, name: 'Other' }); assert.match((await outsider.next('error')).message, /full/i);
  const forged = await connect(port); forged.send({ type: 'join', room: welcome.room, token: 'a'.repeat(48), name: 'Other' }); assert.match((await forged.next('error')).message, /token/i);
  const duplicate = await connect(port); duplicate.send({ type: 'join', room: welcome.room, token: second.token, name: 'Sam' }); assert.match((await duplicate.next('error')).message, /token/i);
  a.send({ type: 'bowl', aim: 999, power: 1, spin: 0 }); assert.match((await a.next('error')).message, /invalid/i);
  a.send({ type: 'bowl', aim: null, power: 1, spin: 0 }); assert.match((await a.next('error')).message, /invalid/i);
  a.send({ type: 'bowl', aim: 0, power: 1, spin: 0 }); assert.match((await a.next('error')).message, /cannot bowl/i);
  a.messages.length = 0; const start = position(await a.next('state'));
  a.send({ type: 'input', x: 1, z: 0 }); await delay(350);
  a.messages.length = 0; const moved = position(await a.next('state')); assert.ok(moved[0] > start[0] + .3);
  await delay(350); a.messages.length = 0; const stopped = position(await a.next('state')); assert.ok(Math.abs(stopped[0] - moved[0]) < .12, 'input expires without continued messages');
  a.send({ type: 'pause' }); await b.next('state', s => s.phase === 'paused' && s.pauseReason === 'manual');
  a.send({ type: 'resume' }); await b.next('state', s => s.phase === 'paused' && s.players.some(p => p.id === 'p1' && p.ready));
  b.send({ type: 'resume' }); await a.next('state', s => s.phase === 'playing');
  a.send({ type: 'chat', text: '<b>hello</b>' }); assert.equal((await b.next('chat')).text, '<b>hello</b>');
  b.ws.close(); await a.next('state', s => s.pauseReason === 'reconnect');
  const resumed = await connect(port); resumed.send({ type: 'join', room: welcome.room, token: second.token, name: 'Sam' }); assert.equal((await resumed.next('welcome')).playerId, 'p2');
  await resumed.next('state', s => s.phase === 'paused' && s.pauseReason === 'manual' && s.players.every(p => p.connected) && s.players.every(p => !p.ready));
  a.send({ type: 'resume' }); resumed.send({ type: 'resume' }); await a.next('state', s => s.phase === 'playing');
  resumed.send({ type: 'leave' }); assert.match((await a.next('ended')).message, /left/i);
  const retired = await connect(port); retired.send({ type: 'join', room: welcome.room, token: second.token, name: 'Sam' }); assert.match((await retired.next('error')).message, /not found/i);
});


test('walking to the lane enables a physical bowling roll', async t => {
  const http = createServer(); const game = await attachGameServer(http);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Bowler' }); await a.next('welcome');
  let latest = await a.next('state');
  async function move(x: number, z: number, done: (p: number[]) => boolean) {
    const deadline = Date.now() + 6000;
    while (!done(position(latest))) {
      assert.ok(Date.now() < deadline, `movement timed out: ${position(latest)}`);
      a.send({ type: 'input', x, z }); await delay(100);
      a.messages.length = 0; latest = await a.next('state');
    }
    a.send({ type: 'input', x: 0, z: 0 });
  }
  await move(0, -1, p => p[2] < 3.8);
  await move(-1, 0, p => p[0] < -7);
  a.send({ type: 'bowl', aim: 0, power: .8, spin: .2 });
  const rolled = await a.next('state', s => s.lane.bowler === 'p1');
  const initialZ = rolled.objects.find(o => o.kind === 'ball')!.position[2];
  const later = await a.next('state', s => s.objects.find(o => o.kind === 'ball')!.position[2] < initialZ - .5);
  assert.ok(later.objects.find(o => o.kind === 'ball')!.position[2] < initialZ);
});


test('center roll hits pins and opposite spin creates opposite lateral motion', async t => {
  const http = createServer(); const game = await attachGameServer(http);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  async function bowl(spin: number) {
    const c = await connect(port); c.send({ type: 'join', name: 'Bowler' }); await c.next('welcome');
    let current = await c.next('state');
    async function move(x: number, z: number, done: (p: number[]) => boolean) {
      const deadline = Date.now() + 6000;
      while (!done(position(current))) {
        assert.ok(Date.now() < deadline, `movement timed out: ${position(current)}`);
        c.send({ type: 'input', x, z }); await delay(100);
        c.messages.length = 0; current = await c.next('state');
      }
      c.send({ type: 'input', x: 0, z: 0 });
    }
    await move(0, -1, p => p[2] < 3.8);
    await move(-1, 0, p => p[0] < -7);
    c.messages.length = 0; c.send({ type: 'bowl', aim: 0, power: .8, spin });
    const crossing = await c.next('state', s => s.lane.bowler === 'p1' && s.objects.find(o => o.kind === 'ball')!.position[2] < -5);
    const lateral = crossing.objects.find(o => o.kind === 'ball')!.position[0];
    if (spin === 0) await c.next('state', s => s.lane.pinsDown > 0);
    return lateral;
  }
  const [left, center, right] = await Promise.all([bowl(-1), bowl(0), bowl(1)]);
  assert.ok(left < center - .01, `left=${left}, center=${center}, right=${right}`);
  assert.ok(right > center + .01, `left=${left}, center=${center}, right=${right}`);
});

test('cooperative claw needs both operators, moves a physical prize, and releases it into the venue', async t => {
  const options = { startClock: VENUE.endTime - 301, storyRate: 0 };
  const http = createServer(); const game = await attachGameServer(http, options);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  let b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); const bw = await b.next('welcome');
  await a.next('state', s => s.phase === 'playing');
  a.send({ type: 'claw-join' }); assert.match((await a.next('error')).message, /cannot join/i);
  async function walk(c: Client, id: 'p1' | 'p2', x: number, z: number, done: (p: number[]) => boolean) {
    const deadline = Date.now() + 40000; let progressAt = Date.now(); let previous: number[] | undefined;
    while (true) {
      c.messages.length = 0; const s = await c.next('state'); const p = s.players.find(p => p.id === id)!.position;
      if (done(p)) break;
      if (!previous || Math.hypot(p[0] - previous[0], p[2] - previous[2]) > .1) { previous = p; progressAt = Date.now(); }
      assert.ok(Date.now() < deadline && Date.now() - progressAt < 12000, `walk stopped making progress: ${p}`); c.send({ type: 'input', x, z }); await delay(100);
    }
    c.send({ type: 'input', x: 0, z: 0 });
  }
  await Promise.all([walk(a, 'p1', 0, -1, p => p[2] < 1), walk(b, 'p2', 0, -1, p => p[2] < 1)]);
  await walk(b, 'p2', 1, 0, p => p[0] > CLAW.centerX + 1.8);
  await walk(a, 'p1', 1, 0, p => p[0] > CLAW.centerX - .8);
  await Promise.all([walk(a, 'p1', 0, -1, p => p[2] < -.8), walk(b, 'p2', 0, -1, p => p[2] < -.8)]);
  a.send({ type: 'claw-join' }); await a.next('state', s => s.claw.operators.x === 'p1');
  a.send({ type: 'claw-ready', ready: true }); assert.match((await a.next('error')).message, /cannot ready/i);
  b.send({ type: 'claw-join' }); await a.next('state', s => s.claw.operators.z === 'p2');
  b.send({ type: 'claw-swap' }); await a.next('state', s => s.claw.operators.x === 'p2');
  a.send({ type: 'claw-swap' }); await a.next('state', s => s.claw.operators.x === 'p1');
  a.send({ type: 'claw-ready', ready: true }); assert.match((await a.next('error')).message, /cannot ready/i);
  a.send({ type: 'claw-move', direction: 1 }); b.send({ type: 'claw-move', direction: 1 });
  await a.next('state', s => s.claw.moved.x && s.claw.moved.z);
  a.send({ type: 'claw-move', direction: 0 }); b.send({ type: 'claw-move', direction: 0 });
  a.send({ type: 'claw-ready', ready: true }); await a.next('state', s => s.claw.ready.p1);
  a.send({ type: 'pause' }); await a.next('state', s => s.phase === 'paused' && !s.claw.ready.p1);
  a.send({ type: 'claw-move', direction: 1 }); assert.match((await a.next('error')).message, /cannot move/i);
  a.send({ type: 'resume' }); b.send({ type: 'resume' }); await a.next('state', s => s.phase === 'playing');
  b.ws.close(); await a.next('state', s => s.pauseReason === 'reconnect');
  b = await connect(port); b.send({ type: 'join', room: w.room, token: bw.token, name: 'Sam' }); await b.next('welcome');
  await b.next('state', s => s.phase === 'paused' && s.pauseReason === 'manual');
  a.send({ type: 'resume' }); b.send({ type: 'resume' }); await a.next('state', s => s.phase === 'playing');
  b.send({ type: 'claw-leave' }); await a.next('state', s => s.claw.operators.z === null);
  a.messages.length = 0; b.send({ type: 'claw-join' }); await a.next('state', s => s.claw.operators.z === 'p2');
  a.messages.length = 0; a.send({ type: 'claw-move', direction: -1 }); b.send({ type: 'claw-move', direction: -1 }); await a.next('state', s => s.claw.moved.x && s.claw.moved.z);
  a.send({ type: 'claw-move', direction: 0 }); b.send({ type: 'claw-move', direction: 0 });
  a.send({ type: 'claw-ready', ready: true }); await a.next('state', s => s.claw.ready.p1);
  a.send({ type: 'claw-move', direction: 1 }); await a.next('state', s => !s.claw.ready.p1 && s.claw.x > CLAW.initialX);
  a.send({ type: 'claw-move', direction: 0 });
  async function aimAxis(c: Client, axis: 'x' | 'z', target: number) {
    const deadline = Date.now() + 5000;
    while (true) {
      a.messages.length = 0; const s = await a.next('state'); const delta = target - s.claw[axis];
      if (Math.abs(delta) < .08) break;
      assert.ok(Date.now() < deadline, `claw ${axis} failed to align: ${s.claw[axis]}`);
      c.send({ type: 'claw-move', direction: delta > 0 ? 1 : -1 }); await delay(65);
    }
    c.send({ type: 'claw-move', direction: 0 });
  }
  await aimAxis(a, 'x', CLAW.prizeX); await aimAxis(b, 'z', CLAW.prizeZ);
  a.send({ type: 'claw-ready', ready: true }); await delay(350);
  a.messages.length = 0; const solo = await a.next('state'); assert.equal(solo.claw.phase, 'aiming'); assert.equal(solo.claw.attempts, 0);
  b.send({ type: 'claw-ready', ready: true }); await a.next('state', s => s.claw.phase === 'dropping');
  options.storyRate = 8;
  await a.next('state', s => s.clockSeconds >= VENUE.endTime - 300 && s.claw.phase === 'dropping' && s.ending.phase === 'waiting');
  options.storyRate = 0;
  const surprise = await a.next('state', s => s.claw.phase === 'surprise');
  assert.equal(surprise.ending.phase, 'choice');
  assert.equal(surprise.claw.prizeHeld, true); assert.ok(surprise.objects.some(o => o.kind === 'giant-prize'));
  const first = surprise.objects.find(o => o.kind === 'giant-prize')!.position[0];
  const deadline = Date.now() + 5000;
  while (true) {
    a.send({ type: 'claw-move', direction: -1 }); await delay(100); a.messages.length = 0;
    const s = await a.next('state'); if (s.claw.x <= CLAW.surpriseMinX + .2) break;
    assert.ok(Date.now() < deadline, 'claw failed to reach alternate exit');
  }
  a.send({ type: 'claw-move', direction: 0 });
  b.send({ type: 'claw-move', direction: -1 }); await a.next('state', s => s.claw.moved.z); b.send({ type: 'claw-move', direction: 0 });
  a.send({ type: 'claw-ready', ready: true }); b.send({ type: 'claw-ready', ready: true });
  await delay(250); a.messages.length = 0; const wrongDepth = await a.next('state');
  assert.equal(wrongDepth.claw.phase, 'surprise', 'left position alone must not release');
  await aimAxis(b, 'z', CLAW.maxZ - .05);
  const moved = await a.next('state', s => s.claw.x <= CLAW.surpriseMinX + .2 && s.objects.find(o => o.kind === 'giant-prize')!.position[0] < first - 1);
  assert.ok(moved.claw.prizeHeld);
  a.send({ type: 'claw-ready', ready: true }); b.send({ type: 'claw-ready', ready: true });
  const won = await a.next('state', s => s.claw.phase === 'won'); assert.equal(won.claw.prizeHeld, false);
  const released = won.objects.find(o => o.kind === 'giant-prize')!.position;
  const later = await a.next('state', s => { const p = s.objects.find(o => o.kind === 'giant-prize')!.position; return p[2] > released[2] + .3 || p[1] < released[1] - .3; });
  assert.ok(later.objects.some(o => o.kind === 'giant-prize'));
});

test('midnight choices are private, withdrawable, and require mutual consent', async t => {
  const http = createServer(); const game = await attachGameServer(http, { startClock: 24 * 3600 - 12, storyRate: 2 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice');
  a.send({ type: 'kiss-choice', choice: true }); await a.next('state', s => s.ending.ownChoice === true);
  b.messages.length = 0; const privateView = await b.next('state'); assert.deepEqual(privateView.ending, { phase: 'choice', ownChoice: null });
  a.send({ type: 'kiss-choice', choice: false }); await a.next('state', s => s.ending.ownChoice === false);
  b.send({ type: 'kiss-choice', choice: true }); await b.next('state', s => s.ending.ownChoice === true);
  await delay(6000); a.messages.length = 0; const noKiss = await a.next('state'); assert.equal(noKiss.ending.phase, 'choice');
  a.send({ type: 'kiss-choice', choice: true }); await a.next('state', s => s.ending.phase === 'kiss');
  b.messages.length = 0; const kiss = await b.next('state', s => s.ending.phase === 'kiss'); assert.equal(kiss.phase, 'playing');
});

test('midnight without two yes choices ends in the same celebration', async t => {
  const http = createServer(); const game = await attachGameServer(http, { startClock: 24 * 3600 - 1, storyRate: 8 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice'); a.send({ type: 'kiss-choice', choice: true });
  const [sa, sb] = await Promise.all([a.next('state', s => s.ending.phase === 'celebration', 40000), b.next('state', s => s.ending.phase === 'celebration', 40000)]);
  assert.equal(sa.ending.phase, 'celebration'); assert.equal(sb.ending.phase, 'celebration');
  assert.equal(sa.phase, 'playing'); assert.equal(sb.ending.ownChoice, null);
});

test('reconnection clears both unactivated midnight choices', async t => {
  const http = createServer(); const game = await attachGameServer(http, { startClock: 24 * 3600 - 120, storyRate: 0 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); const bw = await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice');
  a.send({ type: 'kiss-choice', choice: true }); b.send({ type: 'kiss-choice', choice: true });
  await a.next('state', s => s.ending.ownChoice === true); await b.next('state', s => s.ending.ownChoice === true);
  b.ws.close(); await a.next('state', s => s.pauseReason === 'reconnect' && s.ending.ownChoice === null);
  const rejoined = await connect(port); rejoined.send({ type: 'join', room: w.room, token: bw.token, name: 'Sam' }); await rejoined.next('welcome');
  const restored = await rejoined.next('state', s => s.pauseReason === 'manual');
  assert.deepEqual(restored.ending, { phase: 'choice', ownChoice: null });
  a.send({ type: 'resume' }); rejoined.send({ type: 'resume' });
  const resumed = await a.next('state', s => s.phase === 'playing' && s.ending.phase === 'choice' && s.ending.ownChoice === null);
  assert.equal(resumed.ending.phase, 'choice');
});


test('midnight waits for a bowling roll before resolving mutual consent', async t => {
  const options = { startClock: VENUE.endTime - 5, storyRate: 0 };
  const http = createServer(); const game = await attachGameServer(http, options);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as { port: number }).port;
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice');
  async function walk(x: number, z: number, done: (p: number[]) => boolean) {
    const deadline = Date.now() + 15000;
    while (true) {
      a.messages.length = 0; const p = position(await a.next('state'));
      if (done(p)) break;
      assert.ok(Date.now() < deadline, `walk timed out: ${p}`);
      a.send({ type: 'input', x, z }); await delay(100);
    }
    a.send({ type: 'input', x: 0, z: 0 });
  }
  await walk(0, -1, p => p[2] < 3.8); await walk(-1, 0, p => p[0] < -7);
  a.send({ type: 'bowl', aim: 0, power: .8, spin: 0 });
  await a.next('state', s => s.lane.bowler === 'p1' && !s.lane.canReset);
  a.send({ type: 'kiss-choice', choice: true }); b.send({ type: 'kiss-choice', choice: true });
  await a.next('state', s => s.ending.ownChoice === true); await b.next('state', s => s.ending.ownChoice === true);
  options.storyRate = 80;
  await a.next('state', s => s.clockSeconds >= VENUE.endTime && s.ending.phase === 'choice' && !s.lane.canReset);
  const finished = await a.next('state', s => s.ending.phase === 'kiss', 40000);
  assert.equal(finished.lane.canReset, true, 'the shot must settle before the kiss');
});

test('manual pause clears both private midnight choices before resuming', async t => {
  const options = { startClock: VENUE.endTime - 5, storyRate: 0 };
  const http = createServer(); const game = await attachGameServer(http, options);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as { port: number }).port;
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice');
  a.send({ type: 'kiss-choice', choice: true }); b.send({ type: 'kiss-choice', choice: true });
  await a.next('state', s => s.ending.ownChoice === true); await b.next('state', s => s.ending.ownChoice === true);
  a.send({ type: 'pause' });
  await a.next('state', s => s.phase === 'paused' && s.ending.ownChoice === null);
  await b.next('state', s => s.phase === 'paused' && s.ending.ownChoice === null);
  a.send({ type: 'kiss-choice', choice: true }); assert.match((await a.next('error')).message, /cannot choose/i);
  a.send({ type: 'resume' }); b.send({ type: 'resume' }); await a.next('state', s => s.phase === 'playing');
  options.storyRate = 80;
  await a.next('state', s => s.clockSeconds >= VENUE.endTime && s.ending.phase === 'choice' && s.ending.ownChoice === null);
  a.send({ type: 'kiss-choice', choice: true }); b.send({ type: 'kiss-choice', choice: true });
  await a.next('state', s => s.ending.phase === 'kiss');
});

test('a pool shot settles after both players leave and does not block the midnight choice', async t => {
  const options = { startClock: VENUE.endTime - 301, storyRate: 0 };
  const http = createServer(); const game = await attachGameServer(http, options);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as { port: number }).port;
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.phase === 'playing');
  async function walk(c: Client, id: 'p1' | 'p2') {
    const deadline = Date.now() + 20000;
    while (true) {
      c.messages.length = 0; const p = (await c.next('state')).players.find(p => p.id === id)!.position;
      if (p[2] < POOL.maxZ + 1.2) break;
      assert.ok(Date.now() < deadline, `pool walk timed out: ${p}`);
      c.send({ type: 'input', x: 0, z: -1 }); await delay(100);
    }
    c.send({ type: 'input', x: 0, z: 0 });
  }
  await Promise.all([walk(a, 'p1'), walk(b, 'p2')]);
  a.send({ type: 'pool-join' }); await a.next('state', s => s.pool.participants.includes('p1'));
  b.send({ type: 'pool-join' }); await a.next('state', s => s.pool.phase === 'aiming');
  a.send({ type: 'pool-shoot', angle: 0, power: 1 }); await a.next('state', s => s.pool.phase === 'rolling');
  a.send({ type: 'pool-leave' }); b.send({ type: 'pool-leave' });
  await a.next('state', s => s.pool.participants.length === 0);
  options.storyRate = 8;
  const active = await a.next('state', s => s.clockSeconds >= VENUE.endTime - 300 && s.ending.phase === 'waiting');
  const cue = active.pool.balls.find(ball => ball.id === 0)!.position;
  await delay(300); a.messages.length = 0;
  const moving = await a.next('state'); const nextCue = moving.pool.balls.find(ball => ball.id === 0)?.position;
  assert.ok(!nextCue || Math.hypot(nextCue[0] - cue[0], nextCue[2] - cue[2]) > .02, 'the unattended shot continues moving');
  await a.next('state', s => s.ending.phase === 'choice', 30000);
  options.storyRate = 1000;
  await a.next('state', s => s.clockSeconds >= VENUE.endTime && s.ending.phase === 'choice');
  a.send({ type: 'pool-join' }); await a.next('state', s => s.pool.participants.includes('p1'));
  b.send({ type: 'pool-join' }); await a.next('state', s => s.pool.phase === 'aiming' && s.pool.turn === 'p2');
  b.send({ type: 'pool-shoot', angle: 0, power: 1 });
  assert.match((await b.next('error')).message, /cannot shoot/i);
});


test('midnight blocks a new otherwise valid bowling roll while the choice is pending', async t => {
  const http = createServer(); const game = await attachGameServer(http, { startClock: VENUE.endTime, storyRate: 0 });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await game.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as { port: number }).port;
  const a = await connect(port); a.send({ type: 'join', name: 'Alex' }); const w = await a.next('welcome');
  const b = await connect(port); b.send({ type: 'join', room: w.room, name: 'Sam' }); await b.next('welcome');
  await a.next('state', s => s.ending.phase === 'choice');
  async function walk(x: number, z: number, done: (p: number[]) => boolean) {
    const deadline = Date.now() + 15000;
    while (true) {
      a.messages.length = 0; const p = position(await a.next('state'));
      if (done(p)) break;
      assert.ok(Date.now() < deadline, `walk timed out: ${p}`);
      a.send({ type: 'input', x, z }); await delay(100);
    }
    a.send({ type: 'input', x: 0, z: 0 });
  }
  await walk(0, -1, p => p[2] < 3.8); await walk(-1, 0, p => p[0] < -7);
  a.send({ type: 'bowl', aim: 0, power: .8, spin: 0 });
  assert.match((await a.next('error')).message, /cannot bowl/i);
  a.messages.length = 0; const state = await a.next('state');
  assert.equal(state.ending.phase, 'choice'); assert.equal(state.lane.bowler, null);
});
