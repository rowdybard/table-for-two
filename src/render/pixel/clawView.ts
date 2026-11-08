import type { ObjectState, PlayerId, RoomState, Vec3 } from '../../shared/protocol';
import { CLAW } from '../../shared/venue';
import { drawPixelCharacter } from './characters';
import { pixelText } from './font';
import { pixel, pixelLine, pixelPoly, type PixelPoint } from './world';

type View = { c: CanvasRenderingContext2D; unit: number; project: (x:number,y:number,z:number)=>PixelPoint };
const C = { ink:'#211914', dark:'#352520', walnut:'#65402b', wood:'#8c5a3c', wine:'#78392f', red:'#a65340', cream:'#ead6b2', brass:'#d4a96d', gold:'#edca87', glass:'#526b63', glassDark:'#39534e', bed:'#bd8a69', bedLight:'#d9ab7c', hatch:'#252524', shadow:'#2b201d' };
function plane(v:View,points:Vec3[],color:string){pixelPoly(v.c,points.map(p=>v.project(...p)),color);}
function path(v:View,points:Vec3[],color:string,thickness=1){for(let i=1;i<points.length;i++)pixelLine(v.c,v.project(...points[i-1]),v.project(...points[i]),color,thickness);}
function dashed(v:View,a:Vec3,b:Vec3,color:string){for(let i=0;i<12;i+=2){const t=i/12,u=(i+1)/12;path(v,[[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u]],color);}}
function disc(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string){const rr=Math.max(1,Math.round(r)),cx=Math.round(x),cy=Math.round(y);c.fillStyle=color;for(let dy=-rr;dy<=rr;dy++){const dx=Math.floor(Math.sqrt(Math.max(0,rr*rr-dy*dy)));c.fillRect(cx-dx,cy+dy,2*dx+1,1);}}
function screenLine(c:CanvasRenderingContext2D,a:PixelPoint,b:PixelPoint,color:string,size=1){pixelLine(c,a,b,color,size);}
function prize(v:View,o:ObjectState){
  const p=v.project(...o.position),r=(o.kind==='giant-prize'?CLAW.giantRadius:CLAW.prizeRadius)*v.unit;
  const [x,y,z,w]=o.rotation,axis:Vec3=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)];
  const q=v.project(o.position[0]+axis[0],o.position[1]+axis[1],o.position[2]+axis[2]);
  const angle=Math.hypot(q.x-p.x,q.y-p.y)>.001?Math.atan2(q.y-p.y,q.x-p.x):0;
  const at=(dx:number,dy:number):PixelPoint=>({x:p.x+dx*Math.cos(angle)-dy*Math.sin(angle),y:p.y+dx*Math.sin(angle)+dy*Math.cos(angle)});
  const ground=v.project(o.position[0],o.position[1]>CLAW.bedY && Math.abs(o.position[0]-CLAW.centerX)<CLAW.cabinetHalfX && Math.abs(o.position[2]-CLAW.centerZ)<CLAW.cabinetHalfZ?CLAW.bedY+.02:.02,o.position[2]);
  pixel(v.c,ground.x-r*.7,ground.y,r*1.4,Math.max(1,r*.18),C.shadow);
  for(const side of [-1,1]){const e=at(side*r*.68,-r*.65);disc(v.c,e.x,e.y,r*.28,C.ink);disc(v.c,e.x,e.y,r*.20,'#ba805a');}
  disc(v.c,p.x,p.y,r+1,C.ink);disc(v.c,p.x,p.y,r,'#bc875f');
  const highlight=at(-r*.25,-r*.30);disc(v.c,highlight.x,highlight.y,r*.52,'#dfb382');
  const muzzle=at(0,r*.28);disc(v.c,muzzle.x,muzzle.y,r*.33,'#f0d3a3');
  for(const side of [-1,1]){const eye=at(side*r*.28,-r*.08);disc(v.c,eye.x,eye.y,Math.max(1,r*.055),C.ink);}
  const nose=at(0,r*.19);disc(v.c,nose.x,nose.y,Math.max(1,r*.08),C.ink);
}
function crane(v:View,state:RoomState){
  const h=state.claw,p=v.project(h.x,h.y,h.z),top=v.project(h.x,4.06,h.z),s=v.unit;
  screenLine(v.c,top,p,C.ink,3);screenLine(v.c,top,p,C.cream,1);
  const spread=h.prizeHeld?.13:.24;
  for(const sign of [-1,1]){const a={x:p.x+sign*s*.06,y:p.y+s*.02},b={x:p.x+sign*s*spread,y:p.y+s*.2},d={x:p.x+sign*s*(spread-.05),y:p.y+s*.38};
    screenLine(v.c,a,b,C.ink,Math.max(2,Math.round(s*.09)));screenLine(v.c,b,d,C.ink,Math.max(2,Math.round(s*.09)));
    screenLine(v.c,a,b,C.brass,Math.max(1,Math.round(s*.045)));screenLine(v.c,b,d,C.brass,Math.max(1,Math.round(s*.045)));
  }
  disc(v.c,p.x,p.y,Math.max(2,s*.10),C.ink);disc(v.c,p.x,p.y,Math.max(1,s*.065),C.gold);
}

/** Source-authored cutaway; coordinates and moving parts come from the shared machine state. */
export function drawPixelClawView(c:CanvasRenderingContext2D,width:number,height:number,cssWidth:number,cssHeight:number,state:RoomState,localId:PlayerId,time:number):void {
  if(width<=0||height<=0||cssWidth<=0||cssHeight<=0)return;
  const panelCss=cssWidth>=1100?294:268,usable=Math.max(110,width-panelCss*width/cssWidth),clockBottom=100*height/cssHeight;
  const unit=Math.max(8,Math.min((usable-28)/5.8,(height-clockBottom-51)/4.9));
  const ox=usable*.63,oy=Math.min(height-31,clockBottom+unit*4.55);
  const v:View={c,unit,project:(x,y,z)=>({x:ox+(x-CLAW.centerX)*unit+(z-CLAW.centerZ)*unit*.48,y:oy+(x-CLAW.centerX)*unit*.11+(z-CLAW.centerZ)*unit*.32-y*unit*.90})};
  const x0=CLAW.centerX-CLAW.cabinetHalfX,x1=CLAW.centerX+CLAW.cabinetHalfX,z0=CLAW.centerZ-CLAW.cabinetHalfZ,z1=CLAW.centerZ+CLAW.cabinetHalfZ,bed=CLAW.bedY,top=4.12;
  c.save();c.imageSmoothingEnabled=false;
  pixel(c,0,0,width,height,C.ink);pixel(c,0,0,usable,height,C.dark);pixel(c,0,0,usable,clockBottom+25,C.walnut);
  for(let x=0;x<usable;x+=24){pixel(c,x,0,1,clockBottom+24,C.ink);pixel(c,x+2,0,1,clockBottom+24,C.wood);}
  pixel(c,0,clockBottom+23,usable,2,C.brass);pixel(c,0,clockBottom+25,usable,3,C.wine);
  for(let y=clockBottom+38;y<height;y+=15)for(let x=(y%30?9:1);x<usable;x+=24)pixel(c,x,y,2,1,'#5e3b30');
  // Shadow and rear glass remain behind the machine and its real prize.
  const shadow=v.project(CLAW.centerX,0,CLAW.centerZ);pixel(c,shadow.x-unit*1.8,shadow.y,unit*3.6,Math.max(2,unit*.14),C.shadow);
  plane(v,[[x0,bed,z0],[x1,bed,z0],[x1,top,z0],[x0,top,z0]],C.glassDark);
  plane(v,[[x0+.07,bed+.06,z0+.01],[x1-.07,bed+.06,z0+.01],[x1-.07,top-.08,z0+.01],[x0+.07,top-.08,z0+.01]],C.glass);
  plane(v,[[x1,bed,z0],[x1,bed,z1],[x1,top,z1],[x1,top,z0]],'#667b6d');
  path(v,[[x0+.17,3.78,z0+.02],[x0+.8,3.78,z0+.02]],'#9db4a1');
  // Side opening is a genuinely wide hole: the whole 1.5m prize fits inside it.
  const hatchX=CLAW.centerX-2.15, hatchZ=CLAW.centerZ+.5;
  plane(v,[[hatchX-1.05,bed-.09,hatchZ-1],[hatchX+1.05,bed-.09,hatchZ-1],[hatchX+1.05,bed-.09,hatchZ+1],[hatchX-1.05,bed-.09,hatchZ+1]],C.brass);
  plane(v,[[hatchX-.95,bed-.07,hatchZ-.9],[hatchX+.95,bed-.07,hatchZ-.9],[hatchX+.95,bed-.07,hatchZ+.9],[hatchX-.95,bed-.07,hatchZ+.9]],C.hatch);
  // The outer cabinet has an open front; there is no opaque glass over the prize.
  plane(v,[[x0,0,z1],[x1,0,z1],[x1,bed,z1],[x0,bed,z1]],C.wine);
  plane(v,[[x1,0,z0],[x1,0,z1],[x1,bed,z1],[x1,bed,z0]],'#59342b');
  plane(v,[[x0+.13,.15,z1+.01],[x1-.13,.15,z1+.01],[x1-.13,1.18,z1+.01],[x0+.13,1.18,z1+.01]],C.red);
  path(v,[[x0+.22,1.08,z1+.02],[x1-.22,1.08,z1+.02]],C.brass,2);
  plane(v,[[x0,bed,z0],[x1,bed,z0],[x1,bed,z1],[x0,bed,z1]],C.bedLight);
  plane(v,[[x0+.08,bed+.01,z0+.08],[x1-.08,bed+.01,z0+.08],[x1-.08,bed+.01,z1-.08],[x0+.08,bed+.01,z1-.08]],C.bed);
  // Mark the actual allowed release region, and show both live axis projections.
  const guide:Vec3[]=[[CLAW.surpriseMinX,bed-.035,CLAW.hatchMinZ],[CLAW.hatchMaxX,bed-.035,CLAW.hatchMinZ],[CLAW.hatchMaxX,bed-.035,CLAW.maxZ],[CLAW.surpriseMinX,bed-.035,CLAW.maxZ],[CLAW.surpriseMinX,bed-.035,CLAW.hatchMinZ]];
  for(let i=1;i<guide.length;i++)dashed(v,guide[i-1],guide[i],C.gold);
  const h=state.claw,markerY=bed+.04,minX=h.phase==='surprise'||h.phase==='won'?CLAW.surpriseMinX:CLAW.minX;
  dashed(v,[minX,markerY,h.z],[CLAW.maxX,markerY,h.z],C.cream);dashed(v,[h.x,markerY,CLAW.minZ],[h.x,markerY,CLAW.maxZ],C.cream);
  const mark=v.project(h.x,markerY,h.z);pixel(c,mark.x-2,mark.y,5,1,C.gold);pixel(c,mark.x,mark.y-2,1,5,C.gold);
  const head=v.project(h.x,h.y,h.z);screenLine(c,head,mark,'#c19c6b');
  // Back and right framing, placed behind the moving claw and toy.
  for(const [x,z] of [[x0,z0],[x1,z0],[x1,z1]] as const)path(v,[[x,bed,z],[x,top,z]],C.brass,Math.max(2,Math.round(unit*.07)));
  path(v,[[x0,top,z0],[x1,top,z0],[x1,top,z1]],C.brass,Math.max(2,Math.round(unit*.08)));
  path(v,[[minX,4.06,h.z],[CLAW.maxX,4.06,h.z]],C.cream);path(v,[[h.x,4.06,CLAW.minZ],[h.x,4.06,CLAW.maxZ]],C.brass);
  const toy=state.objects.find(o=>o.kind==='claw-prize'||o.kind==='giant-prize');if(toy)prize(v,toy);crane(v,state);
  // Marquee stays below the clock; the control panel remains unobstructed at right.
  const title=v.project(CLAW.centerX,4.34,z0), titleY=Math.max(clockBottom+3,title.y-5),titleW=93;
  pixel(c,title.x-titleW/2-2,titleY-2,titleW+4,13,C.ink);pixel(c,title.x-titleW/2,titleY,titleW,9,C.wine);
  pixelText(c,'THE PRIZE DROP',title.x,titleY+1,C.cream,'center');
  const bottom=Math.min(height-18,oy+unit*.12),left=30,right=usable-30;
  const xOperator=h.operators.x,zOperator=h.operators.z;
  const fallback=state.players.map(p=>p.id),leftPerson=xOperator??fallback.find(id=>id!==zOperator),rightPerson=zOperator??fallback.find(id=>id!==leftPerson);
  if(leftPerson&&state.players.some(p=>p.id===leftPerson))drawPixelCharacter(c,left,bottom,leftPerson,'side',1,0,time);
  if(rightPerson&&state.players.some(p=>p.id===rightPerson))drawPixelCharacter(c,right,bottom,rightPerson,'side',-1,0,time);
  const playerName=(id:PlayerId|null)=>id?(state.players.find(p=>p.id===id)?.name??'PLAYER').slice(0,8):'WAIT';
  pixelText(c,`A/D ${playerName(xOperator)}`,left,bottom+4,xOperator===localId?C.cream:C.brass,'center');
  pixelText(c,`W/S ${playerName(zOperator)}`,right,bottom+4,zOperator===localId?C.cream:C.brass,'center');
  c.restore();
}
