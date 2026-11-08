import type { ObjectState, PlayerId, RoomState, Vec3 } from '../../shared/protocol';
import { FLIPPERS, VENUE } from '../../shared/venue';
import { pixelText } from './font';
import { drawPixelCharacter } from './characters';

type Screen = { x: number; y: number; unit: number };
type DrawEntity = { depth: number; draw: () => void };
const C = { ink:'#201d22', wall:'#392b2b', wallLight:'#54372e', wood:'#a86d3f', woodLight:'#d5a368', woodDark:'#654129', cream:'#ecd7ae', rust:'#873e38', red:'#aa5144', brass:'#d4a969', felt:'#426b62', shadow:'#302629', slate:'#41484a' };
const px = (n:number) => Math.round(n);
function rect(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,color:string) {
  if(w<=0||h<=0)return; c.fillStyle=color;c.fillRect(px(x),px(y),Math.max(1,px(w)),Math.max(1,px(h)));
}
function pixelLine(c:CanvasRenderingContext2D,x0:number,y0:number,x1:number,y1:number,width:number,color:string) {
  let x=px(x0),y=px(y0);const tx=px(x1),ty=px(y1),dx=Math.abs(tx-x),sx=x<tx?1:-1,dy=-Math.abs(ty-y),sy=y<ty?1:-1;let error=dx+dy;
  const r=Math.max(1,px(width));c.fillStyle=color;
  for(let i=0;i<4096;i++){c.fillRect(x-Math.floor(r/2),y-Math.floor(r/2),r,r);if(x===tx&&y===ty)break;const e=2*error;if(e>=dy){error+=dy;x+=sx;}if(e<=dx){error+=dx;y+=sy;}}
}
function dot(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string) {
  const radius=Math.max(1,px(r));c.fillStyle=color;
  for(let yy=-radius;yy<=radius;yy++){const half=Math.floor(Math.sqrt(Math.max(0,radius*radius-yy*yy)));c.fillRect(px(x)-half,px(y)+yy,half*2+1,1);}
}
function name(state:RoomState,id:PlayerId|null) { return state.players.find(p=>p.id===id)?.name ?? '—'; }

/** Draw the authoritative lane into logical pixel coordinates. panelWidth is the right-hand UI width in those same coordinates. */
export function drawLaneView(c:CanvasRenderingContext2D,width:number,height:number,state:RoomState,localId:PlayerId,time:number,panelWidth=0):void {
  if(width<=0||height<=0)return;
  c.save();c.imageSmoothingEnabled=false;
  const usable=Math.max(120,width-Math.max(0,panelWidth)), cx=px(usable*.51);
  const top=px(Math.max(68,height*.29)), bottom=px(height*.89), length=Math.max(20,bottom-top);
  const halfFar=Math.max(11,Math.min(usable*.13,height*.11)),halfNear=Math.max(halfFar+6,Math.min(usable*.31,height*.31));
  const zFar=-12.8,zNear=1.2;
  const halfAt=(t:number)=>halfFar+(halfNear-halfFar)*t;
  const project=(x:number,y:number,z:number):Screen=>{
    const linear=(z-zFar)/(zNear-zFar), t=Math.pow(Math.max(0,Math.min(1,linear)),.8), half=halfAt(t), unit=half/2.1;
    return {x:cx+(x-VENUE.laneX)*unit,y:top+t*length-y*unit*.76,unit};
  };
  // The close view retains the walnut wall and neighboring alley around the playfield.
  rect(c,0,0,width,height,C.ink);rect(c,0,0,usable,height,C.wall);
  rect(c,0,0,usable,top*.72,C.wallLight);rect(c,0,top*.70,usable,Math.max(2,height*.015),C.brass);
  rect(c,0,top*.74,usable,Math.max(2,height*.025),C.rust);
  for(let x=px(usable*.06);x<usable;x+=Math.max(24,px(usable*.13))){rect(c,x,0,2,top*.7,'#2a2324');rect(c,x+3,2,1,top*.65,'#75503a');}
  // The title sits below the persistent clock rather than behind it.
  const boardW=Math.max(94,Math.min(usable*.43,190)), boardX=cx-boardW/2, boardY=Math.max(35,height*.15), boardH=25;
  rect(c,boardX-3,boardY-3,boardW+6,boardH+6,C.ink);rect(c,boardX,boardY,boardW,boardH,C.slate);
  rect(c,boardX+2,boardY+2,boardW-4,1,C.brass);
  pixelText(c,state.lane.mode==='arcade'?'PINBALL LANES':'THE BOWLING LANE',cx,boardY+5,C.cream,'center');
  pixelText(c,'MIDNIGHT BOWL',cx,boardY+15,C.brass,'center');
  // Two working-style shaded wall lamps give the side space a place in the alley.
  for(const lx of [Math.max(16,boardX-24),Math.min(usable-16,boardX+boardW+24)]) {
    rect(c,lx-1,boardY-7,2,12,C.ink);rect(c,lx-7,boardY+3,14,3,C.ink);
    rect(c,lx-5,boardY+1,10,3,C.brass);rect(c,lx-3,boardY+4,6,3,C.cream);
    rect(c,lx-6,boardY+8,12,2,'#765039');
  }
  // Oxblood side carpet, plank-lit at the edge of the next lane.
  rect(c,0,top,usable,height-top,C.wall);
  for(let y=top+7;y<bottom;y+=18)for(let x=8;x<usable;x+=25)rect(c,x+(Math.floor(y/18)%2)*8,y,2,1,'#624036');
  // A cropped neighboring lane recedes to the same vanishing area.
  for(let yy=0;yy<=length;yy++) {
    const t=yy/length,h=halfAt(t), right=cx-h-17-12*t,left=Math.max(0,right-2*h);
    if(right>0)rect(c,left,top+yy,right-left,1,yy%9===0?'#916039':'#7d5033');
  }
  for(let i=1;i<=5;i++) {
    const f=i/6;
    pixelLine(c,cx-halfFar-17-2*halfFar*f,top,cx-halfNear-29-2*halfNear*f,bottom,1,'#9a6840');
  }
  pixelLine(c,cx-halfFar-17,top,cx-halfNear-29,bottom,3,C.ink);
  pixelLine(c,cx-halfFar-15,top,cx-halfNear-27,bottom,2,C.brass);
  pixelLine(c,cx-halfFar-23,top,cx-halfNear-45,bottom,1,C.wood);
  // Near-black gutters and amber rails surround the actual physical lane.
  for(let yy=0;yy<=length;yy++) {
    const t=yy/length,h=halfAt(t), gutter=2+t*4;
    rect(c,cx-h-gutter-2,top+yy,2*h+2*gutter+4,1,C.ink);
    rect(c,cx-h-gutter,top+yy,2*h+2*gutter,1,C.woodDark);
    rect(c,cx-h,top+yy,2*h,1,yy%9===0?'#b67c48':C.wood);
    rect(c,cx-h-gutter,top+yy,Math.max(1,gutter*.6),1,C.brass);rect(c,cx+h+gutter*.4,top+yy,Math.max(1,gutter*.6),1,C.brass);
  }
  // Perspective-aligned plank joins, uninterrupted at the pin deck.
  for(let n=-7;n<=7;n++) {
    const a=project(VENUE.laneX+n*.25,.03,zFar),b=project(VENUE.laneX+n*.25,.03,zNear);
    pixelLine(c,a.x,a.y,b.x,b.y,1,n%2?'#bb8550':'#9d633d');
  }
  const foulL=project(VENUE.laneX-2,.04,VENUE.laneStartZ),foulR=project(VENUE.laneX+2,.04,VENUE.laneStartZ);
  pixelLine(c,foulL.x,foulL.y,foulR.x,foulR.y,Math.max(1,foulL.unit*.04),C.woodDark);
  // Approach markers are permanent lane markings, not indicators of a shot outcome.
  for(let x=-1.2;x<=1.2;x+=.4){const p=project(VENUE.laneX+x,.04,-2.6);rect(c,p.x-1,p.y-1,2,2,'#794c32');}
  const entities:DrawEntity[]=[];
  for(const o of state.objects) {
    if(o.kind==='pin') entities.push({depth:o.position[2],draw:()=>drawPin(c,o,project)});
    else if(o.kind==='ball') entities.push({depth:o.position[2],draw:()=>drawBall(c,o,project)});
    else if(o.kind==='lane-flipper' && state.lane.mode==='arcade') entities.push({depth:o.position[2],draw:()=>drawFlipper(c,o,project)});
  }
  entities.sort((a,b)=>a.depth-b.depth);for(const e of entities)e.draw();
  // A recognizable physical ball return sits beside the neighboring lane.
  const floorY=Math.min(height-18,bottom-1), returnX=Math.max(7,cx-halfNear-55),returnY=floorY-18;
  rect(c,returnX-2,returnY-3,35,24,C.ink);rect(c,returnX,returnY,31,20,C.woodDark);
  rect(c,returnX+2,returnY+2,27,4,C.woodLight);rect(c,returnX+3,returnY+7,25,8,C.ink);
  for(const [i,color] of [C.rust,C.slate,C.felt].entries()) dot(c,returnX+8+i*7,returnY+10,2,color);
  rect(c,returnX+4,returnY+16,23,2,C.brass);
  // The pilot operates a small brass-trimmed control stand beside the near edge.
  const podX=Math.min(usable-32,cx+halfNear+8),podY=floorY-20;
  rect(c,podX-2,podY-2,29,25,C.ink);rect(c,podX,podY,25,21,C.woodDark);
  rect(c,podX+2,podY+2,21,7,C.slate);rect(c,podX+4,podY+4,5,3,C.felt);rect(c,podX+13,podY+4,5,3,C.rust);
  rect(c,podX+2,podY+10,21,2,C.brass);rect(c,podX+4,podY+17,17,2,'#493128');
  // The real pair stands outside the ball path. Roles follow the server, not a local guess.
  const roller=state.lane.roller ?? state.players[0]?.id ?? null;
  const pilot=state.lane.pilot ?? state.players.find(p=>p.id!==roller)?.id ?? null;
  const rollerX=Math.max(returnX+42,cx-halfNear-13), pilotX=Math.min(usable-10,podX+34);
  if(roller && state.players.some(p=>p.id===roller)) {
    drawPixelCharacter(c,rollerX,floorY,roller,'side',1,0,time);
    // A relaxed reach toward the ball return, rather than a duplicate ball on the lane.
    pixelLine(c,rollerX-3,floorY-16,returnX+29,floorY-12,2,roller==='p1'?'#9a4a3d':'#d9bd8f');
    rect(c,returnX+28,floorY-13,2,2,roller==='p1'?'#e2ac82':'#ad7358');
  }
  if(pilot && state.players.some(p=>p.id===pilot)) {
    drawPixelCharacter(c,pilotX,floorY,pilot,'side',-1,0,time);
    if(state.lane.mode==='arcade') {
      pixelLine(c,pilotX-3,floorY-16,podX+19,podY+7,2,pilot==='p1'?'#9a4a3d':'#d9bd8f');
      rect(c,podX+18,podY+6,2,2,pilot==='p1'?'#e2ac82':'#ad7358');
    }
  }
  c.restore();
  void localId;
}

function drawPin(c:CanvasRenderingContext2D,o:ObjectState,project:(x:number,y:number,z:number)=>Screen) {
  const [x,y,z,w]=o.rotation,axis:Vec3=[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];
  const [px0,py0,pz0]=o.position;if(pz0 < -12.8 || pz0>1.2) return;
  const a=project(px0-axis[0]*.36,py0-axis[1]*.36,pz0-axis[2]*.36);
  const b=project(px0+axis[0]*.36,py0+axis[1]*.36,pz0+axis[2]*.36);
  const mid=project(px0,py0,pz0), thick=Math.max(2,mid.unit*.18);
  pixelLine(c,a.x+1,a.y+1,b.x+1,b.y+1,thick+2,C.ink);
  pixelLine(c,a.x,a.y,b.x,b.y,thick,C.cream);
  const stripeX=a.x+(b.x-a.x)*.70,stripeY=a.y+(b.y-a.y)*.70;
  dot(c,stripeX,stripeY,Math.max(1,thick*.34),C.red);
  dot(c,a.x,a.y,Math.max(1,thick*.42),'#d1bea0');
}
function drawBall(c:CanvasRenderingContext2D,o:ObjectState,project:(x:number,y:number,z:number)=>Screen) {
  const [x,y,z]=o.position;if(z < -12.8 || z>1.2)return;const p=project(x,y,z),ground=project(x,.02,z),r=Math.max(2,p.unit*.3);
  rect(c,ground.x-r,ground.y,2*r,Math.max(1,r*.32),'#493a31');
  dot(c,p.x,p.y,r+1,C.ink);dot(c,p.x,p.y,r,C.rust);dot(c,p.x-r*.3,p.y-r*.35,Math.max(1,r*.3),'#ce8c72');
  // Finger holes turn with the authoritative ball rotation rather than a scripted spin.
  const a=2*Math.atan2(o.rotation[2],o.rotation[3]);
  for(const [hx,hy] of [[-.15,-.19],[.15,-.19],[0,.06]]) {
    const xx=hx*Math.cos(a)-hy*Math.sin(a), yy=hx*Math.sin(a)+hy*Math.cos(a);
    rect(c,p.x+xx*r,p.y+yy*r,Math.max(1,r*.12),Math.max(1,r*.12),C.ink);
  }
}
function drawFlipper(c:CanvasRenderingContext2D,o:ObjectState,project:(x:number,y:number,z:number)=>Screen) {
  const [x,y,z]=o.position,[qx,qy,qz,qw]=o.rotation,sign=o.id.endsWith('left')?1:-1;
  const axisX=1-2*(qy*qy+qz*qz),axisZ=2*(qx*qz-qw*qy),length=FLIPPERS.halfLength*2*sign;
  const a=project(x,y,z),b=project(x+axisX*length,y,z+axisZ*length);
  const thick=Math.max(2,(a.unit+b.unit)*FLIPPERS.halfWidth);
  pixelLine(c,a.x,a.y,b.x,b.y,thick+2,C.ink);pixelLine(c,a.x,a.y,b.x,b.y,thick,C.red);
  pixelLine(c,a.x,a.y-1,b.x,b.y-1,Math.max(1,thick*.22),C.brass);dot(c,a.x,a.y,Math.max(1,thick*.32),C.cream);
}
