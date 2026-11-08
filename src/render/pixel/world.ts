import type { ObjectState, PoolState, Quat, RoomState, Vec3 } from '../../shared/protocol';
import { ARCADE, CLAW, DESK, FLIPPERS, LOUNGE, POOL, VENUE } from '../../shared/venue';
import { pixelText } from './font';

export const P = {
  ink: '#211914', shadow: '#2a1a18', darkWood: '#3c271d', wood: '#67422b', woodLight: '#926040',
  brass: '#bd8b4e', gold: '#dfb873', cream: '#f1dcb3', ivory: '#ead4ab',
  carpet: '#532b29', carpetDark: '#412322', carpetLight: '#6c3831',
  red: '#803a30', redLight: '#ad5842', redDark: '#512820',
  lane: '#bd8549', laneLight: '#d7a465', laneDark: '#885632',
  felt: '#38584b', feltLight: '#54725a', night: '#26302c', glass: '#526257',
} as const;
export type PixelPoint = { x: number; y: number };
export type PixelView = { ctx: CanvasRenderingContext2D; width: number; height: number; unit: number; project: (x: number, y: number, z: number) => PixelPoint };
export type PixelItem = { depth: number; draw: () => void };
const round = Math.round;
export function pixel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) { c.fillStyle = color; c.fillRect(round(x), round(y), Math.max(1, round(w)), Math.max(1, round(h))); }
/** Integer scanline polygons avoid antialiased Canvas edges when enlarged. */
export function pixelPoly(c: CanvasRenderingContext2D, points: PixelPoint[], color: string) {
  if (points.length < 3) return; const p = points.map(q => ({x: round(q.x), y: round(q.y)}));
  const minY = Math.max(0, Math.min(...p.map(q => q.y))), maxY = Math.min(c.canvas.height - 1, Math.max(...p.map(q => q.y)));
  c.fillStyle = color;
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], b = p[i]; if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) intersections.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    intersections.sort((a,b)=>a-b);
    for(let i=0;i+1<intersections.length;i+=2){const left=Math.ceil(intersections[i]),right=Math.floor(intersections[i+1]);if(right>=left)c.fillRect(left,y,right-left+1,1);}
  }
}
export function pixelLine(c: CanvasRenderingContext2D, a: PixelPoint, b: PixelPoint, color: string, thickness = 1) {
  let x=round(a.x),y=round(a.y);const x1=round(b.x),y1=round(b.y),dx=Math.abs(x1-x),sx=x<x1?1:-1,dy=-Math.abs(y1-y),sy=y<y1?1:-1;let e=dx+dy;c.fillStyle=color;
  for(let guard=0;guard<10000;guard++){c.fillRect(x-Math.floor(thickness/2),y-Math.floor(thickness/2),thickness,thickness);if(x===x1&&y===y1)break;const e2=e*2;if(e2>=dy){e+=dy;x+=sx;}if(e2<=dx){e+=dx;y+=sy;}}
}
function face(v: PixelView, pts: Vec3[], color: string) { pixelPoly(v.ctx,pts.map(p=>v.project(...p)),color); }
function edge(v: PixelView, a: Vec3, b: Vec3, color: string, size = 1) { pixelLine(v.ctx,v.project(...a),v.project(...b),color,size); }
function disc(c: CanvasRenderingContext2D, x:number,y:number,rx:number,ry:number,color:string) { const ix=round(x),iy=round(y),a=Math.max(1,round(rx)),b=Math.max(1,round(ry));c.fillStyle=color;for(let yy=-b;yy<=b;yy++){const hw=Math.floor(a*Math.sqrt(Math.max(0,1-(yy*yy)/(b*b))));c.fillRect(ix-hw,iy+yy,hw*2+1,1);} }
function rectWorld(v:PixelView,x0:number,x1:number,z0:number,z1:number,y:number,color:string){face(v,[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]],color)}
function solid(v:PixelView,x0:number,x1:number,z0:number,z1:number,y0:number,y1:number,front:string,top:string,side:string){
  face(v,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],front);
  face(v,[[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],side);
  face(v,[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],top);
  edge(v,[x0,y1,z1],[x1,y1,z1],P.ink);edge(v,[x1,y0,z1],[x1,y1,z1],P.ink);
}
function sign(v:PixelView,x:number,y:number,z:number,w:number,h:number,color:string){const c=v.ctx,p=v.project(x,y,z),u=v.unit;pixel(c,p.x-w*u/2-1,p.y-h*u-1,w*u+2,h*u+2,P.ink);pixel(c,p.x-w*u/2,p.y-h*u,w*u,h*u,color);}

/** Floor, cutaway walls and fixed lane are rendered before the depth-sorted objects. */
export function drawPixelArchitecture(v: PixelView) {
  // Continue the carpet through the cutaway foreground so the camera never
  // reveals an artificial black band while following the players.
  const c=v.ctx;c.fillStyle=P.carpet;c.fillRect(0,0,v.width,v.height);
  const {minX:x0,maxX:x1,minZ:z0,maxZ:z1}=VENUE;
  face(v,[[x0,0,z0],[x1,0,z0],[x1,5.5,z0],[x0,5.5,z0]],'#b9aa86');
  face(v,[[x0,0,z0],[x0,0,z1],[x0,5.5,z1],[x0,5.5,z0]],P.darkWood);
  face(v,[[x1,0,z0],[x1,0,z1],[x1,5.5,z1],[x1,5.5,z0]],'#493020');
  face(v,[[x0,0,z0],[x1,0,z0],[x1,1.1,z0],[x0,1.1,z0]],P.darkWood);
  for(let x=x0+.8;x<=x1-.8;x+=1.6){edge(v,[x,.08,z0+.02],[x,5.45,z0+.02],'#4c2f20',3);edge(v,[x+.08,1.2,z0+.04],[x+.08,5.28,z0+.04],'#805039');}
  edge(v,[x0,1.15,z0+.06],[x1,1.15,z0+.06],P.brass);edge(v,[x0,5.4,z0+.06],[x1,5.4,z0+.06],P.brass);
  for(let z=z0+1;z<z1;z+=2.4){edge(v,[x0+.02,0,z],[x0+.02,5.5,z],'#2e2119');edge(v,[x1-.02,0,z],[x1-.02,5.5,z],'#302219');}
  // Warm ceiling band, studs and short hanging pennants make the wall feel enclosed.
  face(v,[[x0,5.1,z0],[x1,5.1,z0],[x1,5.5,z0],[x0,5.5,z0]],P.darkWood);
  for(let x=x0+2;x<=x1-2;x+=3){const a=v.project(x,5.05,z0+.08);pixel(c,a.x,a.y,2,3,P.gold);pixel(c,a.x+1,a.y+3,1,1,P.redLight);}
  // A single bowling mural and night windows, all on the back wall.
  for(const [x,label] of [[VENUE.laneX+2.8,'BOWL'],[POOL.centerX+2.4,'POOL'],[CLAW.centerX,'PRIZES']] as const){
    sign(v,x,.6,z0+.1,label==='PRIZES'?2.4:2,.65,'#3b2520');
    const m=v.project(x,.6,z0+.12);pixelText(c,label,Math.round(m.x),Math.round(m.y-v.unit*.52),P.cream,'center');
  }
  // Restrained NYE paper balloons hang together above the prize area.
  const balloon=v.project(ARCADE.centerX,.8,z0+.14);
  for(const [dx,dy,col] of [[-5,-10,P.redLight],[0,-13,P.gold],[5,-10,P.cream]] as const){disc(c,balloon.x+dx,balloon.y+dy,3,4,col);pixelLine(c,{x:balloon.x+dx,y:balloon.y+dy+4},{x:balloon.x,y:balloon.y},P.brass);}
  for(const x of [x0+2,ARCADE.centerX-1]){const q=v.project(x,.7,z0+.14);pixel(c,q.x-5,q.y-13,10,13,P.darkWood);pixel(c,q.x-4,q.y-12,8,11,P.cream);pixel(c,q.x-2,q.y-10,4,4,P.red);pixel(c,q.x-3,q.y-4,6,1,P.brass);}
  for(const x of [x0+2,x1-2]){const p=v.project(x,1.45,z0+.13);pixel(c,p.x-8,p.y-33,16,33,P.brass);pixel(c,p.x-7,p.y-32,14,31,P.night);pixel(c,p.x-1,p.y-31,1,29,P.woodLight);pixel(c,p.x-6,p.y-14,12,1,P.woodLight);pixel(c,p.x-4,p.y-25,1,1,P.cream);}
  // Floor continues under the cutaway edge; pattern stays grounded to world space.
  face(v,[[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1]],P.carpet);
  for(const x of [x0,x1])edge(v,[x,.03,z0],[x,.03,z1],P.brass,2);
  for(let z=z0+1;z<=z1;z+=1.5)for(let x=x0+1;x<=x1-1;x+=1.6){const q=v.project(x+(Math.round(z)%2?.8:0),.01,z);pixel(c,q.x,q.y,2,1,P.carpetLight);}
  // Inlaid brass strips define the central circulation path without blocking it.
  for(const x of [-3,3])edge(v,[x,.015,-4.5],[x,.015,z1-.2],'#713c33');
  // Maple zone around lane and shoe desk, with a dark inlaid edge.
  rectWorld(v,VENUE.laneX-5,VENUE.laneX+4,-1.5,z1-.6,.01,P.laneDark);rectWorld(v,VENUE.laneX-4.8,VENUE.laneX+3.8,-1.4,z1-.8,.02,'#95613b');
  for(let x=VENUE.laneX-4.5;x< VENUE.laneX+3.8;x+=.48)edge(v,[x,.03,-1.4],[x,.03,z1-.8],'#805332');
  // Bowling approach and lane share server x/z coordinates.
  rectWorld(v,VENUE.laneX-2.15,VENUE.laneX+2.15,z0+.15,4.45,.035,P.ink);
  rectWorld(v,VENUE.laneX-2,VENUE.laneX+2,z0+.2,4.4,.04,P.lane);
  for(let x=VENUE.laneX-1.8;x<VENUE.laneX+2;x+=.4)edge(v,[x,.05,z0+.3],[x,.05,4.3],P.laneLight);
  edge(v,[VENUE.laneX-2,.06,VENUE.laneStartZ],[VENUE.laneX+2,.06,VENUE.laneStartZ],P.darkWood);
  for(let x=VENUE.laneX-1.4;x<=VENUE.laneX+1.4;x+=.7){const q=v.project(x,.07,-2.5);pixel(c,q.x-1,q.y,3,2,P.laneDark);}
  // Physically positioned gutter rails, not full-height walls.
  for(const x of [VENUE.laneX-2.1,VENUE.laneX+2.1])solid(v,x-.16,x+.16,z0+.2,.6,0,.7,'#523b2b','#bb966b','#3b2b23');
}

function drawPool(v:PixelView,balls:readonly PoolState['balls'][number][]) {
  const {centerX:x,centerZ:z,tableHalf:[hx,,hz]}=POOL;
  const ground=v.project(x,0,z+.2);disc(v.ctx,ground.x,ground.y+2,hx*v.unit,3,P.shadow);
  for(const xx of [x-hx+.5,x+hx-.5])for(const zz of [z-hz+.5,z+hz-.5])solid(v,xx-.16,xx+.16,zz-.15,zz+.15,0,1.0,P.darkWood,P.wood,P.ink);
  solid(v,x-hx,x+hx,z-hz,z+hz,.7,1.6,'#593927','#b38a58','#3d2d22');
  rectWorld(v,POOL.minX,POOL.maxX,POOL.minZ,POOL.maxZ,1.63,P.felt);
  for(const xx of [POOL.minX,POOL.centerX,POOL.maxX])for(const zz of [POOL.minZ,POOL.maxZ]){const q=v.project(xx,1.66,zz);disc(v.ctx,q.x,q.y,2,1,P.ink);}
  for(const b of balls){const q=v.project(...b.position),r=Math.max(1,round(POOL.radius*v.unit));disc(v.ctx,q.x,q.y,r,r,['#f0dfbe','#d8b267','#628270','#bd674a','#735759','#c99055','#954a38'][b.id%7]);pixel(v.ctx,q.x-1,q.y-1,1,1,P.cream);}
  for(const dx of [-2,-1,0,1,2]){const q=v.project(x+dx,1.15,z+hz+.01);pixel(v.ctx,q.x,q.y,2,2,P.brass);}
}
function drawDesk(v:PixelView){
  const x=DESK.x,z=DESK.z,[hx,hy,hz]=DESK.half;solid(v,x-hx,x+hx,z-hz,z+hz,0,hy*2,'#603a2b','#c7a171','#402b21');
  const c=v.ctx;
  const step=(hx*2-.24)/6,height=hy*2;
  for(let row=0;row<2;row++)for(let i=0;i<6;i++){const a=v.project(x-hx+.12+i*step,height*(.14+row*.35),z+hz+.01),b=v.project(x-hx+.12+(i+.82)*step,height*(.37+row*.35),z+hz+.01);const l=Math.min(a.x,b.x),t=Math.min(a.y,b.y),w=Math.max(2,Math.abs(b.x-a.x)),h=Math.max(2,Math.abs(b.y-a.y));pixel(c,l,t,w,h,P.ink);pixel(c,l+1,t+h-3,Math.max(2,w-2),2,P.cream);pixel(c,l+2,t+h-4,Math.max(2,w*.45),1,P.redLight);}
  const label=v.project(x,height*.87,z+hz+.02);pixel(c,label.x-11,label.y,22,2,P.gold);
}
function arcade(v:PixelView,x:number,index:number){const c=v.ctx,p=v.project(x,0,ARCADE.centerZ+ARCADE.half[2]),u=v.unit/16;const box=(xx:number,yy:number,w:number,h:number,col:string)=>pixel(c,p.x+xx*u,p.y+yy*u,w*u,h*u,col);box(-11,-42,22,42,P.ink);box(-10,-41,20,40,['#704633','#803d2d','#634330'][index]);box(-9,-39,18,6,P.brass);box(-8,-31,16,15,'#242b26');box(-7,-30,14,12,P.glass);box(-7,-22,14,4,P.red);box(-10,-14,20,3,P.laneLight);box(-6,-13,2,2,P.red);box(1,-13,2,2,P.cream);box(5,-13,2,2,P.gold);box(-4,-7,8,5,P.darkWood);}
function drawClawBack(v:PixelView){const x=CLAW.centerX,z=CLAW.centerZ,hx=CLAW.cabinetHalfX,hz=CLAW.cabinetHalfZ;face(v,[[x-hx,CLAW.bedY,z-hz],[x+hx,CLAW.bedY,z-hz],[x+hx,4.15,z-hz],[x-hx,4.15,z-hz]],P.glass);edge(v,[x-hx,CLAW.bedY,z-hz],[x-hx,4.15,z-hz],P.gold,2);edge(v,[x+hx,CLAW.bedY,z-hz],[x+hx,4.15,z-hz],P.gold,2);rectWorld(v,x-hx,x+hx,z-hz,z+hz,CLAW.bedY,'#c29669');}
function drawClawFront(v:PixelView){const x=CLAW.centerX,z=CLAW.centerZ,hx=CLAW.cabinetHalfX,hz=CLAW.cabinetHalfZ;solid(v,x-hx,x+hx,z-hz,z+hz,0,CLAW.bedY,P.red,'#bd9065',P.redDark);edge(v,[x-hx,CLAW.bedY,z+hz],[x-hx,4.35,z+hz],P.brass,2);edge(v,[x+hx,CLAW.bedY,z+hz],[x+hx,4.35,z+hz],P.brass,2);sign(v,x,4.7,z+hz,2.5,.38,P.redDark);const p=v.project(x,.5,z+hz+.02);pixel(v.ctx,p.x-3,p.y-4,6,4,P.ink);pixel(v.ctx,p.x-2,p.y-3,4,1,P.gold);}
function deskReturn(v:PixelView){const c=v.ctx,p=v.project(VENUE.laneX+3.1,0,VENUE.laneStartZ+.55),u=v.unit/16;const box=(x:number,y:number,w:number,h:number,col:string)=>pixel(c,p.x+x*u,p.y+y*u,w*u,h*u,col);disc(c,p.x,p.y,14*u,3*u,P.shadow);box(-9,-18,18,18,P.ink);box(-8,-23,16,20,P.cream);box(-7,-18,14,13,P.red);box(-7,-22,14,4,P.darkWood);for(const [i,col]of[[0,P.red],[1,P.felt],[2,P.gold]]as const)disc(c,p.x+(-5+i*5)*u,p.y-23*u,3*u,3*u,col);box(-5,-13,10,1,P.gold);box(-5,-9,10,1,P.redDark);}

function boothSpan(v:PixelView,x:number,outer:-1|1,za:number,zb:number){const hx=LOUNGE.benchHalf[0],a=x-hx,b=x+hx,outerX=outer<0?a:b,inner=outerX-outer*.25;
  face(v,[[a,.12,za],[a,.12,zb],[a,.55,zb],[a,.55,za]],P.redDark);
  rectWorld(v,a+.05,b-.05,za,zb,.68,P.red);
  face(v,[[outerX,.48,za],[outerX,.48,zb],[outerX,1.2,zb],[outerX,1.2,za]],P.redDark);
  face(v,[[inner,.6,za],[inner,.6,zb],[inner,1.14,zb],[inner,1.14,za]],P.red);
  rectWorld(v,Math.min(outerX,inner),Math.max(outerX,inner),za,zb,1.2,P.redLight);
  const back=LOUNGE.z-LOUNGE.benchHalf[2],front=LOUNGE.z+LOUNGE.benchHalf[2];for(let z=back+1.45;z<front;z+=1.45)if(z>=za&&z<zb){edge(v,[inner,.73,z],[inner,1.04,z],P.redDark);}
}
function boothEnd(v:PixelView,x:number,z:number){const hx=LOUNGE.benchHalf[0];face(v,[[x-hx,.12,z],[x+hx,.12,z],[x+hx,.70,z],[x-hx,.70,z]],P.red);edge(v,[x-hx,.70,z],[x+hx,.70,z],P.redLight);const p=v.project(x,.30,z);pixel(v.ctx,p.x-1,p.y,2,1,P.gold);}
function tableSpan(v:PixelView,za:number,zb:number){const x=LOUNGE.tableX,hx=LOUNGE.tableHalf[0];rectWorld(v,x-hx,x+hx,za,zb,1.09,P.laneLight);rectWorld(v,x-hx+.1,x+hx-.1,za,zb,1.1,'#a4714c');}
function loungeTableLeg(v:PixelView){const x=LOUNGE.tableX,z=LOUNGE.z;solid(v,x-.17,x+.17,z-.17,z+.17,0,1.04,P.darkWood,P.wood,P.ink);}
function lamp(v:PixelView,x:number,z:number){const c=v.ctx,p=v.project(x,4.5,z);pixel(c,p.x,p.y-8,1,8,P.brass);pixel(c,p.x-5,p.y,11,2,P.ink);pixel(c,p.x-4,p.y-2,9,2,P.brass);pixel(c,p.x-2,p.y+1,5,1,P.cream);}

/** Painter items are split at character depths instead of masking people through furniture. */
export function pixelVenueItems(v:PixelView,poolBalls:readonly PoolState['balls'][number][],depths:readonly number[]):PixelItem[]{
 const items:PixelItem[]=[{depth:VENUE.minZ+.6,draw:()=>{for(const x of [VENUE.laneX,POOL.centerX,ARCADE.centerX])lamp(v,x,VENUE.minZ+2)}},{depth:POOL.centerZ,draw:()=>drawPool(v,poolBalls)},
  {depth:ARCADE.centerZ,draw:()=>{arcade(v,ARCADE.centerX-1.3,0);arcade(v,ARCADE.centerX+1.3,2)}},{depth:CLAW.centerZ-CLAW.cabinetHalfZ,draw:()=>drawClawBack(v)},{depth:CLAW.centerZ+CLAW.cabinetHalfZ,draw:()=>drawClawFront(v)},
  {depth:VENUE.laneStartZ+.55,draw:()=>deskReturn(v)},{depth:DESK.z,draw:()=>drawDesk(v)}];
 const spans=(a:number,b:number)=>{const vals=[a,...depths.filter(z=>Number.isFinite(z)&&z>a&&z<b),b].sort((x,y)=>x-y);const cuts=vals.filter((z,i)=>!i||z-vals[i-1]>.00001);return cuts.slice(0,-1).map((z,i)=>[z,cuts[i+1]] as const)};
 const back=LOUNGE.z-LOUNGE.benchHalf[2],front=LOUNGE.z+LOUNGE.benchHalf[2];
 for(const [x,outer]of[[LOUNGE.leftX,-1],[LOUNGE.rightX,1]]as const){items.push({depth:back,draw:()=>boothEnd(v,x,back)});for(const [a,b]of spans(back,front))items.push({depth:(a+b)/2,draw:()=>boothSpan(v,x,outer,a,b)});items.push({depth:front,draw:()=>boothEnd(v,x,front)});}
 const tback=LOUNGE.z-LOUNGE.tableHalf[2],tfront=LOUNGE.z+LOUNGE.tableHalf[2];for(const [a,b]of spans(tback,tfront))items.push({depth:(a+b)/2,draw:()=>tableSpan(v,a,b)});items.push({depth:LOUNGE.z,draw:()=>loungeTableLeg(v)});
 return items;
}

/** Draw a server-owned flipper from its pivot and local x-axis, never from key state. */
export function pixelFlipper(v:PixelView,object:ObjectState){
 const [x,y,z,w]=object.rotation,sign=object.id.endsWith('left')?1:-1,ax=sign*(1-2*(y*y+z*z)),az=sign*2*(x*z-w*y),length=FLIPPERS.halfLength*2;
 const [px,py,pz]=object.position,p0=v.project(px,py+FLIPPERS.halfHeight,pz),p1=v.project(px+ax*length,py+FLIPPERS.halfHeight,pz+az*length);
 pixelLine(v.ctx,p0,p1,P.ink,Math.max(4,round(v.unit*FLIPPERS.halfWidth*2)+2));pixelLine(v.ctx,p0,p1,P.cream,Math.max(2,round(v.unit*FLIPPERS.halfWidth*2)));pixelLine(v.ctx,p0,p1,P.red,1);disc(v.ctx,p0.x,p0.y,2,2,P.brass);
}
export function objectAxis(q:Quat):Vec3{const[x,y,z,w]=q;return[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];}
