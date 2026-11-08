import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import { PoolGame } from '../server/pool';
import { attachGameServer } from '../server/index';
import { POOL } from '../src/shared/venue';
import type { ServerMessage } from '../src/shared/protocol';

await RAPIER.init();
type PrivatePool = { balls: { id: number; body: RAPIER.RigidBody }[] };
function body(game: PoolGame, id: number) { return (game as unknown as PrivatePool).balls.find(b => b.id === id)!.body; }
function settle(game: PoolGame) { for (let i = 0; i < 2000 && game.snapshot().phase === 'rolling'; i++) game.step(); assert.notEqual(game.snapshot().phase, 'rolling', 'balls settle in bounded time'); }

test('pool validates turns, produces ball collisions, and preserves the rack on leaving', () => {
  const game = new PoolGame(); try {
    assert.equal(game.join('p1'), true); assert.equal(game.snapshot().phase, 'waiting');
    assert.equal(game.shoot('p1', 0, 1), false); assert.equal(game.join('p2'), true);
    assert.equal(game.shoot('p2', 0, 1), false); assert.equal(game.shoot('p1', NaN, 1), false); assert.equal(game.shoot('p1', 4, 1), false); assert.equal(game.shoot('p1', -4, 1), false); assert.equal(game.shoot('p1', 0, .01), false); assert.equal(game.shoot('p1', 0, Infinity), false); assert.equal(game.shoot('p1', -Infinity, .5), false); assert.equal(game.join('p1'), false); assert.equal(game.snapshot().participants.length, 2);
    const before = body(game, 1).translation(); assert.equal(game.shoot('p1', 0, 1), true); assert.equal(game.shoot('p1', 0, 1), false);
    for (let i = 0; i < 120; i++) game.step();
    const after = body(game, 1).translation(); assert.ok(Math.hypot(after.x-before.x, after.z-before.z) > .05, 'cue physically moves the racked object ball');
    const beforeLeave = game.snapshot().balls; game.leave('p2'); assert.equal(game.snapshot().phase, 'waiting'); for (let i = 0; i < 60; i++) game.step(); assert.notDeepEqual(game.snapshot().balls, beforeLeave, 'a shot continues after leaving');
    assert.equal(game.join('p2'), true); assert.equal(game.snapshot().phase, 'rolling'); settle(game);
    const s = game.snapshot(); assert.equal(s.turn, 'p2'); assert.equal(s.shots, 1); assert.equal(s.lastShot?.playerId, 'p1'); assert.equal(game.pass('p1'), false); assert.equal(game.pass('p2'), true); assert.equal(game.snapshot().turn, 'p1');
    game.leave('p1'); assert.equal(game.snapshot().phase, 'waiting'); assert.equal(game.snapshot().turn, 'p1');
    assert.equal(game.join('p1'), true); assert.equal(game.snapshot().phase, 'aiming'); assert.equal(game.snapshot().turn, 'p1');
  } finally { game.free(); }
});

test('cushions reflect real moving balls and pocketed cue respots after settling', () => {
  const game = new PoolGame(); try {
    game.join('p1'); game.join('p2'); const cue = body(game, 0);
    cue.setTranslation({ x: POOL.centerX - 1.5, y: POOL.height, z: POOL.centerZ }, true);
    assert.ok(game.shoot('p1', Math.PI/2, .8));
    let previous = cue.translation().z, turned = false;
    for (let i = 0; i < 180; i++) { game.step(); const z = cue.translation().z; if (z < previous - .002) turned = true; previous = z; }
    assert.ok(turned, 'side cushion reverses the cue ball'); assert.ok(previous < POOL.maxZ); settle(game);
    cue.setTranslation({ x: POOL.centerX, y: POOL.height, z: POOL.minZ + .27 }, true);
    assert.ok(game.shoot('p2', -Math.PI/2, .3)); settle(game);
    const state = game.snapshot(); assert.equal(state.lastShot?.scratch, true); assert.ok(state.balls.some(b => b.id === 0));
    const respot = state.balls.find(b => b.id === 0)!.position; assert.ok(respot[0] > POOL.minX && respot[0] < POOL.maxX && respot[2] > POOL.minZ && respot[2] < POOL.maxZ);
    for (const b of state.balls.filter(b => b.id !== 0)) assert.ok(Math.hypot(b.position[0]-respot[0],b.position[2]-respot[2]) > .22);
  } finally { game.free(); }
});

test('pocketed object balls count towards a shared win and rerack resets the table', () => {
  const game = new PoolGame(); try {
    game.join('p1'); game.join('p2');
    for (let id = 1; id <= 6; id++) body(game, id).setTranslation({ x: POOL.centerX + id * .001, y: POOL.height, z: POOL.minZ + .04 }, true);
    body(game, 0).setTranslation({ x: POOL.centerX, y: POOL.height, z: POOL.maxZ - .07 }, true);
    assert.ok(game.shoot('p1', Math.PI / 2, .1)); settle(game);
    const s = game.snapshot(); assert.equal(s.phase, 'won'); assert.equal(s.pocketed, 6); assert.equal(s.lastShot?.potted, 6);
    assert.equal(s.lastShot?.scratch, true); assert.ok(s.balls.some(b => b.id === 0), 'cue respots even when the last object is pocketed');
    game.leave('p2'); assert.equal(game.snapshot().phase, 'waiting'); assert.equal(game.rerack('p1'), false);
    game.join('p2'); assert.equal(game.snapshot().phase, 'won'); assert.equal(game.rerack('p1'), true);
    assert.equal(game.snapshot().balls.length, 7); assert.equal(game.snapshot().pocketed, 0); assert.equal(game.snapshot().phase, 'aiming');
  } finally { game.free(); }
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
class Client {
  messages: ServerMessage[] = [];
  constructor(public ws: WebSocket) { ws.on('message', data => this.messages.push(JSON.parse(data.toString()))); }
  send(message: unknown) { this.ws.send(JSON.stringify(message)); }
  async next<T extends ServerMessage['type']>(type: T, predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const i = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>)); if (i >= 0) return this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>; await delay(20); }
    throw new Error(`Timed out waiting for ${type}`);
  }
}
async function connect(port: number) { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), c = new Client(ws); await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }); return c; }

test('WebSocket pool checks proximity, pause, disconnect, reconnect, leave, and turn', async t => {
  const http = createServer(), server = await attachGameServer(http); await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as { port: number }).port;
  const a = await connect(port); a.send({type:'join',name:'Alex'}); const wa = await a.next('welcome');
  let b = await connect(port); b.send({type:'join',room:wa.room,name:'Sam'}); const wb = await b.next('welcome');
  await a.next('state', s => s.phase === 'playing'); a.send({type:'pool-join'}); assert.match((await a.next('error')).message,/cannot join/i);
  async function walk(c: Client, id:'p1'|'p2', x:number,z:number,done:(p:number[])=>boolean) {
    const deadline=Date.now()+35000; let progress=Date.now(), prev:number[]|undefined;
    while (true) { c.messages.length=0; const s=await c.next('state'); const p=s.players.find(p=>p.id===id)!.position; if(done(p)) break;
      if(!prev || Math.hypot(prev[0]-p[0],prev[2]-p[2])>.1) {prev=p;progress=Date.now();}
      assert.ok(Date.now()<deadline && Date.now()-progress<12000,`walk stuck ${p}`); c.send({type:'input',x,z}); await delay(100); }
    c.send({type:'input',x:0,z:0});
  }
  await Promise.all([walk(a,'p1',0,-1,p=>p[2]<POOL.maxZ + 1.2),walk(b,'p2',0,-1,p=>p[2]<POOL.maxZ + 1.2)]);
  a.send({type:'pool-join'}); await a.next('state',s=>s.pool.participants.includes('p1')); b.send({type:'pool-join'}); await a.next('state',s=>s.pool.phase==='aiming');
  b.send({type:'pool-shoot',angle:0,power:1}); assert.match((await b.next('error')).message,/cannot shoot/i);
  a.send({type:'pool-shoot',angle:0,power:1}); await a.next('state',s=>s.pool.phase==='rolling'); a.send({type:'pool-shoot',angle:0,power:1}); assert.match((await a.next('error')).message,/cannot shoot/i);
  a.send({type:'pause'}); const paused=await a.next('state',s=>s.phase==='paused'); await delay(400); a.messages.length=0; const still=await a.next('state',s=>s.phase==='paused'); assert.deepEqual(still.pool.balls,paused.pool.balls);
  a.send({type:'resume'}); b.send({type:'resume'}); await a.next('state',s=>s.phase==='playing' && s.pool.phase==='rolling');
  b.ws.close(); await a.next('state',s=>s.pauseReason==='reconnect'); b=await connect(port); b.send({type:'join',room:wa.room,token:wb.token,name:'Sam'}); await b.next('welcome'); await b.next('state',s=>s.pauseReason==='manual');
  a.send({type:'resume'}); b.send({type:'resume'}); await a.next('state',s=>s.phase==='playing' && s.pool.phase==='rolling');
  b.send({type:'pool-leave'}); await a.next('state',s=>s.pool.phase==='waiting'); b.send({type:'pool-join'}); await a.next('state',s=>s.pool.phase==='rolling');
});
