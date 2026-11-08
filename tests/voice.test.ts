import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer } from '../server/index';
import { validateVoiceSignal } from '../server/voice';
import type { ServerMessage, VoiceSignal } from '../src/shared/protocol';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
class Client {
  messages: ServerMessage[] = [];
  constructor(public ws: WebSocket) { ws.on('message', data => this.messages.push(JSON.parse(data.toString()))); }
  send(value: unknown) { this.ws.send(JSON.stringify(value)); }
  async next<T extends ServerMessage['type']>(type: T, predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { const i = this.messages.findIndex(m => m.type === type && predicate(m as Extract<ServerMessage, { type: T }>)); if (i >= 0) return this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>; await delay(10); }
    throw new Error(`Timed out waiting for ${type}`);
  }
}
async function connect(port: number) { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const c = new Client(ws); await new Promise<void>((resolve,reject) => { ws.once('open',resolve); ws.once('error',reject); }); return c; }
const offer: VoiceSignal = { kind: 'description', description: { type: 'offer', sdp: 'v=0\r\n' } };
const answer: VoiceSignal = { kind: 'description', description: { type: 'answer', sdp: 'v=0\r\n' } };
const candidate: VoiceSignal = { kind: 'candidate', candidate: { candidate: 'candidate:abc', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null } };

test('voice payload validation limits size, shape, roles and candidate metadata', () => {
  assert.deepEqual(validateVoiceSignal(offer,'p1'),offer); assert.equal(validateVoiceSignal(offer,'p2'),null);
  assert.deepEqual(validateVoiceSignal(answer,'p2'),answer); assert.equal(validateVoiceSignal(answer,'p1'),null);
  assert.deepEqual(validateVoiceSignal(candidate,'p1'),candidate);
  assert.equal(validateVoiceSignal({kind:'description',description:{type:'offer',sdp:'a'.repeat(12289)}},'p1'),null);
  assert.equal(validateVoiceSignal({kind:'description',description:{type:'offer',sdp:'é'.repeat(6145)}},'p1'),null);
  assert.equal(validateVoiceSignal({kind:'candidate',candidate:{candidate:'x'.repeat(2049),sdpMid:null,sdpMLineIndex:0}},'p2'),null);
  assert.equal(validateVoiceSignal({kind:'candidate',candidate:{candidate:'x',sdpMid:null,sdpMLineIndex:-1}},'p1'),null);
  assert.equal(validateVoiceSignal({kind:'candidate',candidate:{candidate:'x',sdpMid:3,sdpMLineIndex:null}},'p1'),null);
  assert.equal(validateVoiceSignal({kind:'candidate',candidate:{candidate:'x',sdpMid:null,sdpMLineIndex:null,spoof:'x'}},'p1'),null);
  assert.equal(validateVoiceSignal({kind:'description',description:{type:'offer',sdp:''}},'p1'),null);
});

test('voice opt in, isolated relay, role and epoch checks, pause, disable and reconnect', async t => {
  const http = createServer(), server = await attachGameServer(http); await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.close(); await new Promise<void>(resolve=>http.close(()=>resolve()));});
  const port = (http.address() as {port:number}).port;
  const a = await connect(port); a.send({type:'join',name:'Alex'}); const wa=await a.next('welcome');
  const waiting=await a.next('state',s=>s.phase==='waiting'); assert.deepEqual(waiting.voice,{enabled:{p1:false,p2:false},epoch:0});
  a.send({type:'voice-enable',enabled:true}); assert.match((await a.next('error')).message,/cannot enable/i);
  a.send({type:'voice-enable',enabled:false}); await delay(50); a.messages.length=0; assert.equal((await a.next('state')).voice.epoch,0);
  let b=await connect(port); b.send({type:'join',room:wa.room,name:'Sam'}); const wb=await b.next('welcome'); await a.next('state',s=>s.phase==='playing');
  const other=await connect(port); other.send({type:'join',name:'Other'}); await other.next('welcome'); await other.next('state');
  a.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===1 && s.voice.enabled.p1);
  a.send({type:'voice-signal',epoch:1,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  b.send({type:'voice-enable',enabled:true}); const ready=await a.next('state',s=>s.voice.epoch===2 && s.voice.enabled.p1 && s.voice.enabled.p2); assert.equal(ready.voice.epoch,2);
  await b.next('state',s=>s.voice.epoch===2);
  a.send({type:'voice-signal',epoch:1,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  a.send({type:'voice-signal',epoch:2,signal:answer}); assert.match((await a.next('error')).message,/invalid voice/i);
  b.send({type:'voice-signal',epoch:2,signal:offer}); assert.match((await b.next('error')).message,/invalid voice/i);
  a.send({type:'voice-signal',epoch:2,from:'p2',signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  a.send({type:'voice-signal',epoch:2,signal:{kind:'description',description:{type:'offer',sdp:'a'.repeat(12289)}}}); assert.match((await a.next('error')).message,/invalid voice/i);
  a.send({type:'voice-signal',epoch:2,signal:{kind:'candidate',candidate:{candidate:'x'.repeat(2049),sdpMid:null,sdpMLineIndex:null}}}); assert.match((await a.next('error')).message,/invalid voice/i);
  other.messages.length=0; a.send({type:'voice-signal',epoch:2,signal:offer}); assert.deepEqual(await b.next('voice-signal'),{type:'voice-signal',from:'p1',epoch:2,signal:offer});
  b.send({type:'voice-signal',epoch:2,signal:answer}); assert.deepEqual(await a.next('voice-signal'),{type:'voice-signal',from:'p2',epoch:2,signal:answer});
  b.send({type:'voice-signal',epoch:2,signal:candidate}); assert.deepEqual(await a.next('voice-signal'),{type:'voice-signal',from:'p2',epoch:2,signal:candidate});
  await delay(100); assert.equal(other.messages.some(m=>m.type==='voice-signal'),false,'another room receives no signaling');
  a.send({type:'pause'}); await a.next('state',s=>s.phase==='paused' && s.voice.epoch===3);
  a.send({type:'voice-signal',epoch:3,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  a.send({type:'resume'}); b.send({type:'resume'}); await a.next('state',s=>s.phase==='playing' && s.voice.epoch===3);
  a.send({type:'voice-signal',epoch:2,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  a.send({type:'voice-signal',epoch:3,signal:offer}); await b.next('voice-signal',m=>m.epoch===3);
  b.send({type:'voice-enable',enabled:false}); await a.next('state',s=>s.voice.epoch===4 && !s.voice.enabled.p2);
  a.send({type:'voice-signal',epoch:4,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  b.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===5 && s.voice.enabled.p2);
  b.ws.close(); const disconnected=await a.next('state',s=>s.pauseReason==='reconnect' && s.voice.epoch===6); assert.deepEqual(disconnected.voice.enabled,{p1:false,p2:false});
  b=await connect(port); b.send({type:'join',room:wa.room,token:wb.token,name:'Sam'}); await b.next('welcome'); await b.next('state',s=>s.pauseReason==='manual' && s.voice.epoch===6);
  a.send({type:'voice-enable',enabled:true}); assert.match((await a.next('error')).message,/cannot enable/i);
  a.send({type:'resume'}); b.send({type:'resume'}); await a.next('state',s=>s.phase==='playing' && s.voice.epoch===6);
  a.send({type:'voice-signal',epoch:5,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  a.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===7 && s.voice.enabled.p1 && !s.voice.enabled.p2);
  a.send({type:'voice-signal',epoch:7,signal:offer}); assert.match((await a.next('error')).message,/cannot signal/i);
  b.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===8 && s.voice.enabled.p1 && s.voice.enabled.p2);
  a.send({type:'voice-signal',epoch:8,signal:offer}); await b.next('voice-signal',m=>m.epoch===8 && m.from==='p1');
});

test('voice signaling has a separate per-socket rate limit', async t => {
  const http = createServer(), server = await attachGameServer(http); await new Promise<void>(resolve => http.listen(0,'127.0.0.1',resolve));
  t.after(async () => { await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const port = (http.address() as {port:number}).port;
  const a = await connect(port); a.send({type:'join',name:'Alex'}); const w = await a.next('welcome');
  const b = await connect(port); b.send({type:'join',room:w.room,name:'Sam'}); await b.next('welcome'); await a.next('state',s=>s.phase==='playing');
  a.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===1);
  b.send({type:'voice-enable',enabled:true}); await a.next('state',s=>s.voice.epoch===2);
  for (let i=0;i<41;i++) a.send({type:'voice-signal',epoch:2,signal:candidate});
  assert.match((await a.next('error')).message,/signaling rate limit/i);
  await delay(100); assert.equal(b.messages.filter(m=>m.type==='voice-signal').length,40);
});
