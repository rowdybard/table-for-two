import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { LaneGame, updatePinGroundDamping } from '../server/lane';
import { nearLane, STATIC_BOXES, VENUE } from '../src/shared/venue';
import type { ObjectState, PlayerId } from '../src/shared/protocol';
await RAPIER.init();
type Entity = { id: string; kind: ObjectState['kind']; body: RAPIER.RigidBody };

test('cooperative lane rotates actual kinematic colliders and changes a physical ball trajectory', () => {
  function simulate(activate: boolean) {
    const world = new RAPIER.World({x:0,y:0,z:0}); world.timestep=1/60; const entities:Entity[]=[];
    const lane = new LaneGame(world,entities); lane.join('p1'); lane.join('p2'); lane.warmups={p1:true,p2:true}; assert.ok(lane.selectMode('arcade',true));
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(VENUE.laneX-.8,.32,-3).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.ball(.3).setMass(4.5).setRestitution(.15),b); b.setLinvel({x:0,y:0,z:-6},true);
    let now=1000;
    for(let i=0;i<100;i++){if(activate && i>=9 && i<35)lane.setFlippers('p2',true,false,now,true); lane.step(1/60,now,true);world.step();now+=1000/60;}
    const p=b.translation();const r={x:p.x,z:p.z};world.free();return r;
  }
  const rest=simulate(false), fired=simulate(true);
  assert.ok(Math.hypot(rest.x-fired.x,rest.z-fired.z)>.08, `real physical actuation must change motion: ${JSON.stringify({rest,fired})}`);
});


test('paired flippers open a real path to the pins in the complete lane world', () => {
  function roll(open: boolean, dampFallen: boolean) {
    const world=new RAPIER.World({x:0,y:-9.81,z:0}); world.timestep=1/60;
    try {
      const floor=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,-.2,(VENUE.minZ+VENUE.maxZ)/2));
      world.createCollider(RAPIER.ColliderDesc.cuboid(VENUE.width/2,.2,VENUE.depth/2).setFriction(.8),floor);
      for(const box of STATIC_BOXES){const body=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...box.center));world.createCollider(RAPIER.ColliderDesc.cuboid(...box.half),body);}
      const pins:RAPIER.RigidBody[]=[];
      for(let row=0;row<4;row++)for(let col=0;col<=row;col++){
        const pin=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(VENUE.laneX+(col-row/2)*.42,.42,VENUE.pinZ-row*.38).setLinearDamping(.35).setAngularDamping(.35).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.cylinder(.4,.12).setMass(1.3).setFriction(.6),pin);pins.push(pin);
      }
      const ball=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(VENUE.laneX,.3,VENUE.laneStartZ).setLinearDamping(.14).setAngularDamping(.15).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.ball(.3).setMass(4.5).setRestitution(.15).setFriction(.7),ball);
      const entities:Entity[]=[],lane=new LaneGame(world,entities);lane.join('p1');lane.join('p2');lane.warmups={p1:true,p2:true};assert.ok(lane.selectMode('arcade',true));
      let now=1000;
      // Give the pilot time to hold both controls before the roll and to settle the fresh rack.
      for(let i=0;i<60;i++){if(open)lane.setFlippers('p2',true,true,now,true);lane.step(1/60,now,true);world.step();now+=1000/60;}
      const speed=4+.7*9;ball.setTranslation({x:VENUE.laneX,y:.3,z:VENUE.laneStartZ},true);ball.setRotation({x:0,y:0,z:0,w:1},true);
      ball.setLinvel({x:0,y:0,z:-speed},true);ball.setAngvel({x:-speed/.3,y:0,z:0},true);lane.beginRoll('p1');
      assert.equal(lane.canResetShot(true),false,'a moving shot cannot reset');
      let maxDown=0,minZ=VENUE.laneStartZ,settleSeconds=Infinity;
      for(let i=0;i<1800;i++){
        if(open&&lane.hasPendingRoll)lane.setFlippers('p2',true,true,now,true);
        lane.step(1/60,now,true);if(dampFallen)for(const pin of pins)updatePinGroundDamping(pin);world.step();now+=1000/60;minZ=Math.min(minZ,ball.translation().z);
        const down=pins.filter(pin=>{const q=pin.rotation();return Math.abs(q.x)>.4||Math.abs(q.z)>.4||pin.translation().y<.27;}).length;
        maxDown=Math.max(maxDown,down);
        const stopped=[ball,...pins].every(body=>{const v=body.linvel(),w=body.angvel();return Math.hypot(v.x,v.y,v.z)<.22&&Math.hypot(w.x,w.y,w.z)<.55;});
        lane.observe(stopped,1/60,down);
        if(!lane.hasPendingRoll){settleSeconds=i/60;break;}
      }
      // A real rigid body can wake after scoring; that must not revoke the completed frame.
      pins[0].setAngvel({x:0,y:2,z:0},true);
      const resetLatched=lane.canResetShot(true) && Math.hypot(...Object.values(pins[0].angvel()))>.55;
      return {maxDown,minZ,score:lane.score,settled:!lane.hasPendingRoll,settleSeconds,resetLatched};
    } finally {world.free();}
  }
  const closed=roll(false,false),baseline=roll(true,false),opened=roll(true,true);
  assert.equal(closed.maxDown,0); assert.ok(closed.minZ>VENUE.pinZ+1,'resting flippers intercept the centered roll');
  assert.ok(opened.minZ<VENUE.pinZ+.6,'both opened flippers allow the ball to reach the pin deck');
  assert.ok(opened.maxDown>0,'actual ball/pin collisions knock pins down'); assert.ok(opened.settled,'the shot eventually settles');
  assert.ok(opened.score>0,'the settled round records its physical pinfall');
  assert.equal(opened.score,baseline.score,'ground damping preserves this frame’s actual pinfall');
  assert.ok(opened.settleSeconds<baseline.settleSeconds,`fallen-pin damping should shorten settling: ${opened.settleSeconds} vs ${baseline.settleSeconds}`);
  assert.ok(opened.resetLatched,'a post-settle pin wake does not revoke reset eligibility');
});

test('ground damping applies only to fallen pins near the floor', () => {
  const world=new RAPIER.World({x:0,y:0,z:0});
  try {
    const pin=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,.42,0).setLinearDamping(.35).setAngularDamping(.35));
    updatePinGroundDamping(pin);assert.ok(Math.abs(pin.angularDamping()-.35)<.001);assert.ok(Math.abs(pin.linearDamping()-.35)<.001);
    pin.setTranslation({x:0,y:.12,z:0},true);pin.setRotation({x:Math.SQRT1_2,y:0,z:0,w:Math.SQRT1_2},true);
    updatePinGroundDamping(pin);assert.ok(Math.abs(pin.angularDamping()-1.5)<.001);assert.ok(Math.abs(pin.linearDamping()-.7)<.001);
    pin.setTranslation({x:0,y:.42,z:0},true);pin.setRotation({x:0,y:0,z:0,w:1},true);
    updatePinGroundDamping(pin);assert.ok(Math.abs(pin.angularDamping()-.35)<.001);assert.ok(Math.abs(pin.linearDamping()-.35)<.001);
  } finally {world.free();}
});

test('warmups unlock two distinct roles, score once, swap, and restart; classic suppresses automatic re-entry', () => {
  const world=new RAPIER.World({x:0,y:0,z:0}), entities:Entity[]=[], lane=new LaneGame(world,entities);
  try {
    lane.join('p1'); lane.join('p2'); assert.equal(lane.unlocked,false); assert.equal(lane.selectMode('arcade',true),false);
    lane.beginRoll('p1'); lane.settled(4); assert.deepEqual(lane.warmups,{p1:true,p2:false});
    lane.beginRoll('p2'); lane.settled(3); assert.equal(lane.unlocked,true); assert.ok(lane.reset(true));
    assert.equal(lane.mode,'arcade'); assert.equal(lane.round,1); assert.equal(lane.roller,'p1'); assert.equal(lane.pilot,'p2'); assert.equal(entities.filter(e=>e.kind==='lane-flipper').length,2);
    assert.equal(lane.canRoll('p2',true),false); assert.equal(lane.canRoll('p1',false),false); assert.equal(lane.canRoll('p1',true),true);
    assert.equal(lane.setFlippers('p1',true,true,1000,true),false); assert.equal(lane.setFlippers('p2',true,false,1000,true),true);
    lane.leave('p2'); assert.equal(lane.canRoll('p1',true),false); assert.equal(lane.setFlippers('p2',true,false,1001,true),false); lane.join('p2');
    lane.beginRoll('p1'); assert.equal(lane.reset(true),false); lane.settled(7); lane.settled(7); assert.equal(lane.score,7); assert.equal(lane.roundSettled,true);
    assert.ok(lane.reset(true)); assert.equal(lane.round,2); assert.equal(lane.roller,'p2'); assert.equal(lane.pilot,'p1'); assert.equal(lane.reset(true),false, 'duplicate reset cannot skip a round');
    lane.beginRoll('p2'); lane.settled(8); lane.settled(8); assert.equal(lane.score,15); assert.equal(lane.complete,true);
    assert.ok(lane.reset(true)); assert.equal(lane.score,0); assert.equal(lane.round,1); assert.equal(lane.complete,false);
    assert.ok(lane.selectMode('classic',true)); assert.equal(entities.filter(e=>e.kind==='lane-flipper').length,0);
    lane.beginRoll('p1'); lane.settled(2); assert.ok(lane.reset(true)); assert.equal(lane.mode,'classic'); assert.deepEqual(lane.warmups,{p1:true,p2:true});
    assert.ok(lane.selectMode('arcade',true)); assert.equal(lane.mode,'arcade');
  } finally {world.free();}
});

test('flipper intent expires, and clearing on interruption returns flippers to rest', () => {
  const world=new RAPIER.World({x:0,y:0,z:0}), entities:Entity[]=[], lane=new LaneGame(world,entities); world.timestep=1/60;
  try {
    lane.join('p1'); lane.join('p2'); lane.warmups={p1:true,p2:true}; lane.selectMode('arcade',true);
    const left=entities.find(e=>e.id==='lane-flipper-left')!.body; const initial=left.rotation().y;
    lane.setFlippers('p2',true,false,1000,true); for(let i=0;i<9;i++){lane.step(1/60,1000+i*16,true);world.step();}
    assert.ok(Math.abs(left.rotation().y-initial)>.1);
    lane.clearInputs(); for(let i=0;i<12;i++){lane.step(1/60,1200+i*16,true);world.step();}
    assert.ok(Math.abs(left.rotation().y-initial)<.01);
    lane.setFlippers('p2',true,false,2000,true); for(let i=0;i<9;i++){lane.step(1/60,2000+i*16,true);world.step();}
    for(let i=0;i<12;i++){lane.step(1/60,2300+i*16,true);world.step();}
    assert.ok(Math.abs(left.rotation().y-initial)<.01);
  } finally {world.free();}
});

import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachGameServer } from '../server/index';
import type { ServerMessage } from '../src/shared/protocol';
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
class Client {
  messages:ServerMessage[]=[];
  constructor(public ws:WebSocket){ws.on('message',data=>this.messages.push(JSON.parse(data.toString())));}
  send(msg:unknown){this.ws.send(JSON.stringify(msg));}
  async next<T extends ServerMessage['type']>(type:T,predicate:(m:Extract<ServerMessage,{type:T}>)=>boolean=()=>true,timeout=12000){
    const end=Date.now()+timeout;while(Date.now()<end){const i=this.messages.findIndex(m=>m.type===type&&predicate(m as Extract<ServerMessage,{type:T}>));if(i>=0)return this.messages.splice(i,1)[0] as Extract<ServerMessage,{type:T}>;await delay(20);}throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(this.messages.filter(m=>m.type==='error').slice(-4))} last lane ${JSON.stringify(this.messages.filter(m=>m.type==='state').slice(-1).map(m=>m.type==='state'?m.lane:null))}`);
  }
}
async function connect(port:number){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`),c=new Client(ws);await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return c;}

test('real room warms both players, then gates pilot and freezes flippers on pause',async t=>{
  const http=createServer(),server=await attachGameServer(http);await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await server.close();await new Promise<void>(resolve=>http.close(()=>resolve()));});
  const port=(http.address() as {port:number}).port,a=await connect(port);a.send({type:'join',name:'Alex'});const w=await a.next('welcome');
  const b=await connect(port);b.send({type:'join',room:w.room,name:'Sam'});await b.next('welcome');await a.next('state',s=>s.phase==='playing');
  async function walk(c:Client,id:PlayerId,x:number,z:number,done:(p:number[])=>boolean){
    const deadline=Date.now()+25000;while(true){c.messages.length=0;const s=await c.next('state'),p=s.players.find(p=>p.id===id)!.position;if(done(p))break;
      assert.ok(Date.now()<deadline,`could not reach lane: ${p}`);c.send({type:'input',x,z});await delay(100);}c.send({type:'input',x:0,z:0});
  }
  await walk(b,'p2',0,-1,p=>p[2]<3.6);await walk(b,'p2',-1,0,p=>p[0]<VENUE.laneX-1.3);
  await walk(a,'p1',0,-1,p=>p[2]<3.6);await walk(a,'p1',-1,0,p=>p[0]<VENUE.laneX+1.6);
  a.send({type:'lane-join'});b.send({type:'lane-join'});await a.next('state',s=>s.lane.participants.length===2);
  a.send({type:'bowl',aim:0,power:.9,spin:0});await a.next('state',s=>s.lane.bowler==='p1');
  const firstDone=await a.next('state',s=>s.lane.canReset && s.lane.warmups.p1,45000);
  assert.ok(nearLane(firstDone.players.find(p=>p.id==='p1')!.position), `roller was displaced: ${JSON.stringify(firstDone.players)}`);
  a.send({type:'reset-lane'});await a.next('state',s=>s.lane.canBowl && s.lane.mode==='classic');
  b.send({type:'bowl',aim:0,power:.9,spin:0});await a.next('state',s=>s.lane.bowler==='p2');
  await a.next('state',s=>s.lane.canReset && s.lane.warmups.p2,45000);
  a.send({type:'reset-lane'});const arcade=await a.next('state',s=>s.lane.mode==='arcade');assert.equal(arcade.lane.roller,'p1');assert.equal(arcade.lane.pilot,'p2');
  b.send({type:'bowl',aim:0,power:.9,spin:0});assert.match((await b.next('error')).message,/cannot bowl/i);
  a.send({type:'lane-flippers',left:true,right:false});assert.match((await a.next('error')).message,/cannot move flippers/i);
  const original=arcade.objects.find(o=>o.id==='lane-flipper-left')!.rotation;
  b.send({type:'lane-flippers',left:true,right:false});const moved=await a.next('state',s=>{const q=s.objects.find(o=>o.id==='lane-flipper-left')?.rotation;return !!q && Math.abs(q[1]-original[1])>.05;});
  assert.notDeepEqual(moved.objects.find(o=>o.id==='lane-flipper-left')!.rotation,original);
  a.send({type:'pause'});const paused=await a.next('state',s=>s.phase==='paused');await delay(300);a.messages.length=0;const still=await a.next('state',s=>s.phase==='paused');
  assert.deepEqual(still.objects.find(o=>o.id==='lane-flipper-left')!.rotation,paused.objects.find(o=>o.id==='lane-flipper-left')!.rotation);
  a.send({type:'resume'});b.send({type:'resume'});await a.next('state',s=>s.phase==='playing');
  await a.next('state',s=>{const q=s.objects.find(o=>o.id==='lane-flipper-left')?.rotation;return !!q && s.phase==='playing' && Math.abs(q[1]-original[1])<.02;});
});
