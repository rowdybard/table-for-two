import type { ObjectState, PlayerId, Quat, RoomState, Vec3 } from '../shared/protocol';
import { CLAW, FRIENDS, VENUE } from '../shared/venue';
import { poolLayout, poolWorldPoint } from './illustrated/poolView';
import { drawLaneView } from './pixel/laneView';
import { drawPixelPoolView } from './pixel/poolView';
import { drawPixelClawView } from './pixel/clawView';
import { drawPixelCharacter, type PixelDirection, type PixelPerson } from './pixel/characters';
import { drawPixelArchitecture, pixelVenueItems, pixelFlipper, pixel, pixelLine, objectAxis, P, type PixelView, type PixelItem } from './pixel/world';

type Focus = 'bowling'|'claw'|'pool'|null;
type Motion = { position: Vec3; speed:number; facing:1|-1; direction:PixelDirection };
const WORLD_UNIT=25, DEPTH_SCALE=.27;
/** Pixel-art presentation of the same authoritative room simulation. */
export class VenueRenderer {
  readonly canvas=document.createElement('canvas');
  private readonly ctx:CanvasRenderingContext2D;
  private readonly scene=document.createElement('canvas');
  private readonly sceneCtx:CanvasRenderingContext2D;
  private readonly observer:ResizeObserver;
  private state?:RoomState; private localId:PlayerId='p1';
  private width=1280; private height=800; private ratio=1; private time=0; private zoom=1;
  private cameraX=0; private cameraZ=VENUE.spawn.p1[2]; private inputEnabled=true; private focus:Focus=null;
  private poolAngle=0; private poolPower=.55; private disposed=false;
  private endingPhase='waiting'; private endingStarted=0;
  private motions=new Map<string,Motion>(); private rotations=new Map<string,Quat>();
  private friendNearby=new Map<PixelPerson,boolean>(); private friendWaveUntil=new Map<PixelPerson,number>();
  constructor(private readonly container:HTMLElement){
    const ctx=this.canvas.getContext('2d',{alpha:false}), sceneCtx=this.scene.getContext('2d',{alpha:false});
    if(!ctx||!sceneCtx)throw new Error('Canvas is unavailable'); this.ctx=ctx;this.sceneCtx=sceneCtx;
    this.canvas.setAttribute('aria-label','Pixel art bowling lounge on New Year’s Eve');this.canvas.tabIndex=-1;container.append(this.canvas);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.canvas.addEventListener('wheel',this.wheel,{passive:false});this.resize();
  }
  getMovementVector(horizontal:number,forward:number){return{x:horizontal,z:forward};}
  setActivityFocus(focus:Focus){this.focus=focus;}
  setInputEnabled(enabled:boolean){this.inputEnabled=enabled;}
  setPoolAim(angle:number,power:number){if(Number.isFinite(angle))this.poolAngle=angle;if(Number.isFinite(power))this.poolPower=Math.max(0,Math.min(1,power));}
  getPoolPoint(clientX:number,clientY:number){if(this.focus!=='pool'||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height||clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null;return poolWorldPoint(poolLayout(this.width,this.height),(clientX-r.left)*this.width/r.width,(clientY-r.top)*this.height/r.height);}
  private wheel=(e:WheelEvent)=>{if(!this.inputEnabled)return;e.preventDefault();this.zoom=Math.max(.8,Math.min(1.15,this.zoom-e.deltaY*.0005));};
  update(state:RoomState,localId:PlayerId,dt:number){
    this.state=state;this.localId=localId;if(state.ending.phase!==this.endingPhase){this.endingPhase=state.ending.phase;this.endingStarted=this.time;}
    const live=new Set<string>(),blend=1-Math.exp(-Math.min(.15,dt)*18);
    const motion=(id:string,pos:Vec3)=>{live.add(id);let m=this.motions.get(id);if(!m){m={position:[...pos],speed:0,facing:1,direction:'front'};this.motions.set(id,m);}const ox=m.position[0],oz=m.position[2];for(let i=0;i<3;i++)m.position[i]+=(pos[i]-m.position[i])*blend;const dx=m.position[0]-ox,dz=m.position[2]-oz;m.speed+=(Math.min(1,Math.hypot(dx,dz)/Math.max(.001,dt)/VENUE.playerSpeed)-m.speed)*blend;if(Math.abs(dx)>.002)m.facing=dx<0?-1:1;if(Math.hypot(dx,dz)>.002)m.direction=Math.abs(dz)>Math.abs(dx)*1.2?(dz<0?'back':'front'):'side';};
    state.players.forEach(p=>motion(`player:${p.id}`,p.position));state.objects.forEach(o=>{motion(o.id,o.position);const old=this.rotations.get(o.id);if(!old){this.rotations.set(o.id,[...o.rotation]);return;}const dot=old.reduce((s,n,i)=>s+n*o.rotation[i],0),sign=dot<0?-1:1;for(let i=0;i<4;i++)old[i]+=(o.rotation[i]*sign-old[i])*blend;const len=Math.hypot(...old)||1;for(let i=0;i<4;i++)old[i]/=len;});
    state.pool.balls.forEach(b=>motion(`pool:${b.id}`,b.position));motion('claw-anchor',[state.claw.x,state.claw.y,state.claw.z]);
    for(const id of this.motions.keys())if(!live.has(id))this.motions.delete(id);for(const id of this.rotations.keys())if(!live.has(id))this.rotations.delete(id);
  }
  private smoothState(state:RoomState):RoomState {const claw=this.motions.get('claw-anchor')?.position;return {...state,players:state.players.map(p=>({...p,position:this.motions.get(`player:${p.id}`)?.position??p.position})),objects:state.objects.map(o=>({...o,position:this.motions.get(o.id)?.position??o.position,rotation:this.rotations.get(o.id)??o.rotation})),pool:{...state.pool,balls:state.pool.balls.map(b=>({...b,position:this.motions.get(`pool:${b.id}`)?.position??b.position}))},claw:claw?{...state.claw,x:claw[0],y:claw[1],z:claw[2]}:state.claw};}
  render(dt:number){
    if(this.disposed)return;this.time+=Math.min(.15,dt);const c=this.ctx,state=this.state?this.smoothState(this.state):undefined;
    c.setTransform(this.ratio,0,0,this.ratio,0,0);c.clearRect(0,0,this.width,this.height);
    const lc=this.sceneCtx,w=this.scene.width,h=this.scene.height;lc.imageSmoothingEnabled=false;
    if(state&&this.focus==='pool')drawPixelPoolView(lc,w,h,this.width,this.height,state.pool,this.localId,this.poolAngle,this.poolPower,this.time,state.players);
    else if(state&&this.focus==='claw')drawPixelClawView(lc,w,h,this.width,this.height,state,this.localId,this.time);
    else if(state&&this.focus==='bowling')drawLaneView(lc,w,h,state,this.localId,this.time,(this.width<1100?268:294)*w/this.width);
    else this.drawExploration(lc,w,h,state,dt);
    const endingAge=this.time-this.endingStarted;
    const cinematic=!!state && ['kiss','celebration'].includes(state.ending.phase) && endingAge<5.5;
    if(cinematic)this.drawCelebration(lc,w,h,endingAge);
    c.imageSmoothingEnabled=false;c.drawImage(this.scene,0,0,this.width,this.height);
    if(this.focus===null&&state&&!cinematic){c.font='600 11px Segoe UI, sans-serif';c.textAlign='center';c.textBaseline='middle';for(const p of state.players){const point=this.project(p.position[0],0,p.position[2],w,h);const x=point.x*this.width/w,y=(point.y-34*WORLD_UNIT/16.5*this.zoom)*this.height/h;if(x<0||x>this.width||y<10||y>this.height-10)continue;const label=p.id===this.localId?`${p.name} · you`:p.name;const lw=c.measureText(label).width+12;c.fillStyle='#30211c';c.fillRect(Math.round(x-lw/2),Math.round(y-8),Math.round(lw),16);c.fillStyle='#f1dcb3';c.fillText(label,x,y);}}
  }
  private project(x:number,y:number,z:number,w:number,h:number){const u=WORLD_UNIT*this.zoom;return{x:w*.5+(x-this.cameraX)*u+(z-this.cameraZ)*u*.04,y:h*.77+(z-this.cameraZ)*u*DEPTH_SCALE-y*u};}
  private drawExploration(c:CanvasRenderingContext2D,w:number,h:number,state:RoomState|undefined,dt:number){
    const local=state?.players.find(p=>p.id===this.localId),partner=state?.players.find(p=>p.id!==this.localId&&p.connected);
    const age=this.time-this.endingStarted,kissing=state?.ending.phase==='kiss'&&age<5.5&&state.players.length===2;
    const midpoint=kissing ? {x:(state.players[0].position[0]+state.players[1].position[0])/2,z:(state.players[0].position[2]+state.players[1].position[2])/2} : null;
    let tx=local?.position[0]??0,tz=local?.position[2]??VENUE.spawn.p1[2];
    if(midpoint){tx=midpoint.x;tz=midpoint.z;}
    else {
      if(local&&partner){
        const dx=partner.position[0]-local.position[0],dz=partner.position[2]-local.position[2];
        if(Math.hypot(dx,dz)<8){tx=(tx+partner.position[0])*.5;tz=Math.max(tz,partner.position[2]);}
        else if(Math.abs(dx)<w*.4/(WORLD_UNIT*this.zoom)&&Math.abs(dz)<16){
          // Keep an on-screen partner's feet above the lower HUD while
          // the local player approaches a more distant station.
          const visibleFront=Math.max(1,(h*.23-24)/(WORLD_UNIT*this.zoom*DEPTH_SCALE));
          tz=Math.max(tz,partner.position[2]-visibleFront);
        }
      }
      tx-=this.width<1100?1.65:1;
    }
    const b=1-Math.exp(-Math.min(.15,dt)*8);this.cameraX+=(tx-this.cameraX)*b;this.cameraZ+=(tz-this.cameraZ)*b;
    // Keep both staged characters in the viewport from the first frame, even across a large venue.
    if(midpoint&&age<.18){this.cameraX=tx;this.cameraZ=tz;}
    const v:PixelView={ctx:c,width:w,height:h,unit:WORLD_UNIT*this.zoom,project:(x,y,z)=>this.project(x,y,z,w,h)};drawPixelArchitecture(v);
    const items:PixelItem[]=[],labels:number[]=[],staged:(()=>void)[]=[];
    const addPerson=(x:number,z:number,person:PixelPerson,direction:PixelDirection,facing:1|-1,speed=0,wave=false,kiss=false,onTop=false)=>{
      labels.push(z);const draw=()=>{const p=v.project(x,0,z);drawPixelCharacter(c,p.x,p.y,person,direction,facing,speed,this.time,v.unit/16.5,wave,kiss);};
      if(onTop)staged.push(draw);else items.push({depth:z,draw});
    };
    const friend=(x:number,z:number,person:'mira'|'dev',facing:1|-1)=>{const near=!!local&&Math.hypot(local.position[0]-x,local.position[2]-z)<3.4;if(near&&!this.friendNearby.get(person))this.friendWaveUntil.set(person,this.time+1.5);this.friendNearby.set(person,near);addPerson(x,z,person,'side',facing,0,near&&this.time<(this.friendWaveUntil.get(person)??0));};
    friend(FRIENDS.mira[0],FRIENDS.mira[2],'mira',1);friend(FRIENDS.dev[0],FRIENDS.dev[2],'dev',-1);
    if(!state?.players.length){addPerson(VENUE.spawn.p1[0],VENUE.spawn.p1[2],'p1','side',1);addPerson(VENUE.spawn.p2[0],VENUE.spawn.p2[2],'p2','side',-1);}
    for(const p of state?.players??[]){
      const m=this.motions.get(`player:${p.id}`);let x=p.position[0],z=p.position[2],direction=m?.direction??'front',facing=m?.facing??1;
      if(midpoint){
        const amount=Math.min(1,age/1.2,Math.max(0,(5.5-age)/1.2));
        const maxX=w*.36/v.unit,maxZ=h*.11/(v.unit*DEPTH_SCALE);
        const startX=Math.max(-maxX,Math.min(maxX,x-midpoint.x)),startZ=Math.max(-maxZ,Math.min(maxZ,z-midpoint.z));
        x=midpoint.x+startX*(1-amount)+(p.id==='p1'?-.25:.25)*amount;z=midpoint.z+startZ*(1-amount);
        direction='side';facing=p.id==='p1'?1:-1;
        addPerson(x,z,p.id,direction,facing,0,false,age>=1&&age<4.5,true);continue;
      }
      if((m?.speed??0)<.05){const other=state!.players.find(q=>q.id!==p.id&&q.connected);if(other){const dx=other.position[0]-x,dz=other.position[2]-z;if(Math.hypot(dx,dz)<7){if(Math.abs(dx)>.2)facing=dx<0?-1:1;direction=Math.abs(dz)>Math.abs(dx)*1.4?(dz<0?'back':'front'):'side';}}}
      addPerson(x,z,p.id,direction,facing,m?.speed??0);
    }
    items.push(...pixelVenueItems(v,state?.pool.balls??[],labels));
    const objects=state?.players.length?state.objects:this.previewPins();for(const o of objects)items.push({depth:o.position[2],draw:()=>this.drawObject(v,o)});
    const claw=state?.claw??{x:CLAW.initialX,y:CLAW.restY,z:CLAW.initialZ};items.push({depth:claw.z+.01,draw:()=>{const a=v.project(claw.x,4.1,claw.z),b=v.project(claw.x,claw.y,claw.z);pixelLine(c,a,b,P.cream);pixel(c,b.x-2,b.y-1,5,3,P.gold);pixelLine(c,{x:b.x-2,y:b.y+1},{x:b.x-4,y:b.y+5},P.brass);pixelLine(c,{x:b.x+2,y:b.y+1},{x:b.x+4,y:b.y+5},P.brass);}});
    items.sort((a,b)=>a.depth-b.depth);for(const item of items)item.draw();for(const draw of staged)draw();
  }
  private drawCelebration(c:CanvasRenderingContext2D,w:number,h:number,age:number){
    const reduced=typeof window.matchMedia==='function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const colors=[P.cream,P.gold,P.red];
    for(let i=0;i<(reduced?16:32);i++){const x=(i*73+13)%Math.max(1,w),y=(i*47+(reduced?0:Math.floor(age*(12+i%5))))%Math.max(1,h);pixel(c,x,y,i%3===0?2:1,i%2===0?2:1,colors[i%colors.length]);}
  }
  private drawObject(v:PixelView,o:ObjectState){
    if(o.kind==='lane-flipper'){pixelFlipper(v,o);return;}const p=v.project(...o.position),c=v.ctx;
    if(o.kind==='pin'){const a=objectAxis(o.rotation),top=v.project(o.position[0]+a[0]*.4,o.position[1]+a[1]*.4,o.position[2]+a[2]*.4),bottom=v.project(o.position[0]-a[0]*.4,o.position[1]-a[1]*.4,o.position[2]-a[2]*.4);pixelLine(c,top,bottom,P.ink,5);pixelLine(c,top,bottom,P.cream,3);pixel(c,top.x-1,top.y+2,3,1,P.red);return;}
    const radius=o.kind==='ball'?.3:o.kind==='giant-prize'?.75:.35,r=Math.max(2,Math.round(radius*v.unit));for(let y=-r;y<=r;y++){const d=Math.floor(Math.sqrt(Math.max(0,r*r-y*y)));pixel(c,p.x-d,p.y+y,d*2+1,1,P.ink);}for(let y=-r+1;y<r;y++){const d=Math.floor(Math.sqrt(Math.max(0,(r-1)*(r-1)-y*y)));pixel(c,p.x-d,p.y+y,d*2+1,1,o.kind==='ball'?P.red:o.kind==='beach-ball'?P.cream:P.gold);}pixel(c,p.x-r*.45,p.y-r*.55,Math.max(1,r*.4),1,P.cream);
    if(o.kind==='ball'){
      const [qx,qy,qz,qw]=o.rotation;
      for(const [hx,hy,hz] of [[-.22,.16,.96],[.18,.16,.97],[0,-.18,.98]]){
        const tx=2*(qy*hz-qz*hy),ty=2*(qz*hx-qx*hz),tz=2*(qx*hy-qy*hx);
        const rx=hx+qw*tx+(qy*tz-qz*ty),ry=hy+qw*ty+(qz*tx-qx*tz),rz=hz+qw*tz+(qx*ty-qy*tx);
        if(rz>0)pixel(c,p.x+(rx+rz*.04)*r,p.y+(-ry+rz*DEPTH_SCALE)*r,1,1,P.ink);
      }
    }
    if(o.kind==='claw-prize'||o.kind==='giant-prize'){pixel(c,p.x-r*.8,p.y-r*.9,Math.max(2,r*.35),Math.max(2,r*.35),P.brass);pixel(c,p.x+r*.45,p.y-r*.9,Math.max(2,r*.35),Math.max(2,r*.35),P.brass);pixel(c,p.x-r*.35,p.y-1,1,1,P.ink);pixel(c,p.x+r*.3,p.y-1,1,1,P.ink);pixel(c,p.x-1,p.y+r*.3,3,1,P.ink);}
  }
  private previewPins():ObjectState[]{const objects:ObjectState[]=[];for(let row=0;row<4;row++)for(let col=0;col<=row;col++)objects.push({id:`preview-${row}-${col}`,kind:'pin',position:[VENUE.laneX+(col-row/2)*.45,.4,VENUE.pinZ-row*.45],rotation:[0,0,0,1]});return objects;}
  private resize(){this.width=Math.max(1,this.container.clientWidth);this.height=Math.max(1,this.container.clientHeight);this.ratio=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(this.width*this.ratio);this.canvas.height=Math.round(this.height*this.ratio);this.canvas.style.width=`${this.width}px`;this.canvas.style.height=`${this.height}px`;this.scene.width=Math.ceil(this.width/3);this.scene.height=Math.ceil(this.height/3);}
  dispose(){if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.canvas.removeEventListener('wheel',this.wheel);this.canvas.remove();this.motions.clear();this.rotations.clear();}
}
