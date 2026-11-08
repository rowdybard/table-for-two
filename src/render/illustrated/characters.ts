type CharacterVariant = 'alex' | 'sam' | 'mira' | 'dev';
type CharacterOptions = {
  x: number; y: number; scale: number; facing: -1 | 1; walk: number; time: number;
  variant: CharacterVariant; mood?: 'idle' | 'wave' | 'kiss';
  direction?: 'front' | 'back' | 'side'; pose?: 'relaxed' | 'lean' | 'talk';
};
type Point = [number, number];
type Palette = {
  skin: string; skinLight: string; skinShadow: string; hair: string; hairLight: string;
  top: string; topLight: string; topShadow: string; shirt: string; pants: string; pantsLight: string; shoe: string;
};
const palettes: Record<CharacterVariant, Palette> = {
  alex: {skin:'#bd8065',skinLight:'#e3aa8a',skinShadow:'#995c4d',hair:'#302a2a',hairLight:'#68504a',top:'#8d4545',topLight:'#b66758',topShadow:'#663b3d',shirt:'#e9d4b4',pants:'#343b3e',pantsLight:'#56605c',shoe:'#342c2a'},
  sam: {skin:'#875347',skinLight:'#b8785d',skinShadow:'#633d38',hair:'#282729',hairLight:'#5b4943',top:'#e0d0b6',topLight:'#f3e7d0',topShadow:'#b8a890',shirt:'#f1e5ce',pants:'#406c67',pantsLight:'#69938a',shoe:'#48352e'},
  mira: {skin:'#d49b7b',skinLight:'#efbda0',skinShadow:'#b87963',hair:'#9b4b38',hairLight:'#c97851',top:'#ab7b35',topLight:'#d1a657',topShadow:'#805b30',shirt:'#eed3a0',pants:'#554f42',pantsLight:'#7b7460',shoe:'#46372e'},
  dev: {skin:'#ac765f',skinLight:'#d6a184',skinShadow:'#865448',hair:'#302b2c',hairLight:'#6c5147',top:'#713e47',topLight:'#98605d',topShadow:'#503039',shirt:'#e2d1b9',pants:'#494046',pantsLight:'#6d5c5d',shoe:'#342b2b'},
};
const outline = '#4b3633';
function fillPath(c: CanvasRenderingContext2D, fill: string | CanvasGradient, path: () => void, stroke = '', width = 1) {
  c.beginPath(); path(); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
}
function stroke(c: CanvasRenderingContext2D, color: string, width: number, points: Point[]) {
  c.beginPath(); c.moveTo(...points[0]); for (const p of points.slice(1)) c.lineTo(...p);
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function oval(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2); c.fillStyle=color; c.fill();
}
function grad(c: CanvasRenderingContext2D, x1:number,y1:number,x2:number,y2:number, a:string,b:string) {
  const g=c.createLinearGradient(x1,y1,x2,y2); g.addColorStop(0,a); g.addColorStop(1,b); return g;
}
function shoe(c: CanvasRenderingContext2D, x:number,y:number, p:Palette, backView:boolean) {
  fillPath(c,p.shoe,()=>{c.moveTo(x-7,y-6);c.quadraticCurveTo(x+1,y-7,x+7,y-4);c.lineTo(x+(backView?9:14),y-1);c.quadraticCurveTo(x+16,y+2,x+11,y+3);c.lineTo(x-8,y+3);c.quadraticCurveTo(x-10,y+1,x-7,y-6);c.closePath();},'#453631',.8);
  stroke(c,'#a98c72',.85,[[x-7,y+1.4],[x+11,y+1.4]]);
}
function leg(c: CanvasRenderingContext2D, hip:Point,knee:Point,foot:Point,p:Palette,wide:number,far:boolean) {
  const shade=grad(c,hip[0]-12,hip[1],hip[0]+15,hip[1],far?p.pants:p.pantsLight,p.pants);
  fillPath(c,shade,()=>{
    c.moveTo(hip[0]-wide*.58,hip[1]);c.quadraticCurveTo(knee[0]-wide*.57,knee[1]-17,knee[0]-wide*.49,knee[1]);
    c.quadraticCurveTo(foot[0]-wide*.57,foot[1]-20,foot[0]-wide*.59,foot[1]-3);
    c.quadraticCurveTo(foot[0],foot[1]-1,foot[0]+wide*.61,foot[1]-3);
    c.quadraticCurveTo(foot[0]+wide*.48,foot[1]-22,knee[0]+wide*.51,knee[1]);
    c.quadraticCurveTo(hip[0]+wide*.62,hip[1]+19,hip[0]+wide*.57,hip[1]);c.closePath();
  },'#4e403a',.85);
  stroke(c,far?'rgba(236,221,191,.13)':'rgba(240,224,192,.24)',1.1,[[knee[0]+2,knee[1]+5],[foot[0]+2,foot[1]-12]]);
  stroke(c,'rgba(42,38,37,.16)',1,[[knee[0]-wide*.25,knee[1]-3],[knee[0]-wide*.02,knee[1]+1]]);
}
function hand(c: CanvasRenderingContext2D,x:number,y:number,p:Palette,raised=false) {
  c.save(); c.translate(x,y); if(raised)c.rotate(-.45);
  fillPath(c,grad(c,-5,-4,5,10,p.skinLight,p.skin),()=>{
    c.moveTo(-5,-5);c.quadraticCurveTo(-7,-1,-5,5);c.lineTo(-3,10);c.quadraticCurveTo(-2,12,0,10);
    c.lineTo(2,11);c.quadraticCurveTo(5,10,5,7);c.lineTo(6,0);c.quadraticCurveTo(5,-4,3,-5);c.closePath();
  },p.skinShadow,.75);
  stroke(c,p.skinShadow,.6,[[-2,4],[-1,8]]);c.restore();
}
function sleeve(c:CanvasRenderingContext2D,shoulder:Point,elbow:Point,wrist:Point,p:Palette,far:boolean,cloth?:string) {
  const color=cloth??p.top;
  c.beginPath();c.moveTo(...shoulder);c.quadraticCurveTo(elbow[0],elbow[1]-5,elbow[0],elbow[1]);c.lineTo(...wrist);
  c.lineCap='round';c.lineJoin='round';c.strokeStyle='rgba(68,48,45,.55)';c.lineWidth=17;c.stroke();
  c.strokeStyle=color;c.lineWidth=15;c.stroke();
  c.beginPath();c.moveTo(shoulder[0]-3,shoulder[1]+3);c.quadraticCurveTo(elbow[0]-3,elbow[1]-4,elbow[0]-3,elbow[1]+1);c.lineTo(wrist[0]-3,wrist[1]-2);
  c.strokeStyle=far?'rgba(45,34,34,.10)':'rgba(255,235,207,.16)';c.lineWidth=4;c.stroke();
  stroke(c,'rgba(68,48,45,.32)',1,[[elbow[0]-4,elbow[1]-2],[elbow[0]+3,elbow[1]+1]]);
}
function hairBack(c:CanvasRenderingContext2D,p:Palette,v:CharacterVariant) {
  const color=grad(c,-18,-240,18,-198,p.hairLight,p.hair);
  if(v==='sam') {
    fillPath(c,color,()=>{c.moveTo(-19,-224);c.quadraticCurveTo(-22,-238,-10,-241);c.quadraticCurveTo(0,-246,10,-241);c.quadraticCurveTo(22,-237,20,-224);c.lineTo(17,-204);c.quadraticCurveTo(0,-195,-16,-204);c.closePath();});
    for(const [x,y,r] of [[-15,-227,7],[-10,-237,7],[0,-240,7],[10,-237,7],[16,-228,7],[-16,-216,6],[16,-215,6]])oval(c,x,y,r,r,p.hair);
    for(const [x,y] of [[-11,-232],[0,-238],[11,-231],[-15,-220],[13,-219]]) { c.beginPath();c.arc(x,y,3.5,3.7,5.6);c.strokeStyle=p.hairLight;c.lineWidth=1.4;c.stroke(); }
  } else if(v==='mira') {
    fillPath(c,color,()=>{c.moveTo(-19,-225);c.quadraticCurveTo(-20,-242,0,-242);c.quadraticCurveTo(19,-242,19,-225);c.lineTo(22,-205);c.quadraticCurveTo(19,-199,11,-199);c.lineTo(-17,-199);c.quadraticCurveTo(-23,-207,-19,-225);c.closePath();},'#764737',.7);
    stroke(c,'rgba(241,166,119,.35)',1.5,[[-13,-229],[-9,-237],[0,-239],[8,-237]]);
  } else {
    fillPath(c,color,()=>{c.moveTo(-18,-224);c.quadraticCurveTo(-22,-239,-6,-242);c.quadraticCurveTo(9,-245,18,-235);c.quadraticCurveTo(23,-229,18,-218);c.lineTo(15,-204);c.quadraticCurveTo(0,-199,-15,-204);c.closePath();},'#3f3432',.65);
    if(v==='dev') {for(const [x,y] of [[-13,-232],[-5,-239],[4,-237],[12,-233]]){c.beginPath();c.arc(x,y,4,3.4,5.6);c.strokeStyle=p.hairLight;c.lineWidth=1.5;c.stroke();}}
    else stroke(c,'rgba(200,156,124,.25)',1.5,[[-12,-232],[-6,-237],[4,-238],[10,-234]]);
  }
}
function face(c:CanvasRenderingContext2D,p:Palette,v:CharacterVariant,direction:'front'|'back'|'side',mood:'idle'|'wave'|'kiss',time:number) {
  hairBack(c,p,v);
  if(direction==='back') return;
  // The face turns toward the facing direction; the far cheek and eye recede.
  oval(c,-14,-218,4,5.5,p.skinShadow);oval(c,-14,-218,2.8,4.1,p.skin);
  const skin=grad(c,-13,-231,16,-204,p.skinLight,p.skin);
  fillPath(c,skin,()=>{c.moveTo(-13,-229);c.quadraticCurveTo(-11,-238,1,-237);c.quadraticCurveTo(14,-237,15,-227);
    c.lineTo(15,-221);c.quadraticCurveTo(16,-217,18,-215);c.quadraticCurveTo(18,-213,15,-212);
    c.lineTo(14,-206);c.quadraticCurveTo(9,-200,3,-200);c.quadraticCurveTo(-8,-201,-12,-210);c.closePath();},p.skinShadow,.7);
  fillPath(c,p.hair,()=>{c.moveTo(-15,-226);c.quadraticCurveTo(-16,-241,-2,-242);c.quadraticCurveTo(12,-244,17,-232);c.lineTo(16,-227);c.quadraticCurveTo(7,-229,2,-234);c.quadraticCurveTo(-5,-228,-15,-226);c.closePath();});
  if(v==='sam') for(const [x,y,r] of [[-11,-231,5],[-5,-237,5],[2,-239,5],[9,-236,5],[14,-230,4]])oval(c,x,y,r,r,p.hair);
  if(v==='mira') stroke(c,'rgba(241,169,129,.45)',1.3,[[-11,-232],[-5,-237],[1,-238],[7,-235]]);
  if(v==='sam') {c.beginPath();c.ellipse(-16,-212,2.5,4,0,0,Math.PI*2);c.strokeStyle='#dbbb78';c.lineWidth=1.5;c.stroke();}
  // Small features remain separated at approximately 250 pixels of rendered height.
  const blink=mood==='kiss'||(Math.sin(time*.46 + (v==='sam'?1.7:0))>.9994);
  if(direction!=='side') {
    stroke(c,p.hair,.95,[[-8,-225],[-4,-226],[-1,-225]]);
    if(blink) stroke(c,'#553e39',.95,[[-8,-222],[-4,-221],[-1,-222]]);
    else {fillPath(c,'#ead8c7',()=>{c.moveTo(-8,-222);c.quadraticCurveTo(-4,-224,-1,-222);c.quadraticCurveTo(-4,-220,-8,-222);c.closePath();});oval(c,-3,-222,1.05,1.25,'#403332');}
  }
  stroke(c,p.hair,.9,[[8,-225],[11,-226],[13,-225]]);
  if(blink) stroke(c,'#553e39',.95,[[8,-222],[11,-221.5],[13,-222]]);
  else {fillPath(c,'#ead8c7',()=>{c.moveTo(8,-222);c.quadraticCurveTo(11,-223.5,13,-222);c.quadraticCurveTo(11,-220.5,8,-222);c.closePath();});oval(c,11.7,-222,.9,1.15,'#403332');}
  stroke(c,p.skinShadow,.85,[[7,-221],[7,-217],[9,-216]]);
  if(mood==='kiss') {oval(c,9,-209,1.7,1.1,'#915b55');}
  else {c.beginPath();c.moveTo(1,-211);c.quadraticCurveTo(6,-207,11,-211);c.strokeStyle='#80504b';c.lineWidth=1.05;c.lineCap='round';c.stroke();}
  oval(c,-7,-215,3,1.7,'rgba(179,99,87,.18)');
}

/** Paint a hand-drawn adult at the world foot anchor; the character is about 240 art pixels tall. */
export function drawCharacter(c: CanvasRenderingContext2D, o: CharacterOptions):void {
  const p=palettes[o.variant], direction=o.direction??'front', pose=o.pose??'relaxed', mood=o.mood??'idle';
  const walk=Math.max(0,Math.min(1,o.walk)), cycle=Math.sin(o.time*7.2)*walk;
  const phase=o.variant==='alex'?0:o.variant==='sam'?1.3:o.variant==='mira'?2.6:4.2;
  const breathing=Math.sin(o.time*1.15+phase)*.55*(1-walk);
  const bodyLean=(pose==='lean'?.105:o.variant==='sam'?-.035:o.variant==='mira'?.04:-.02)*(1-walk*.6);
  const hip=o.variant==='sam'?2:o.variant==='mira'?-2:0;
  const farFoot:Point=[-15+hip-cycle*13,-3-Math.max(0,cycle)*8];
  const nearFoot:Point=[14+hip+cycle*13,-3-Math.max(0,-cycle)*8];
  const farKnee:Point=[-12+hip-cycle*7,-54], nearKnee:Point=[9+hip+cycle*7,-52+(1-walk)*2];
  c.save();c.translate(o.x,o.y);c.scale(o.scale*o.facing*(direction==='side'?.84:1),o.scale);
  oval(c,0,3,30+walk*3,5.5,'rgba(32,24,24,.14)');
  if(farFoot[1]>-5)oval(c,farFoot[0]+2,1,12,2.2,'rgba(35,25,24,.20)');
  if(nearFoot[1]>-5)oval(c,nearFoot[0]+2,1,12,2.2,'rgba(35,25,24,.20)');
  leg(c,[-8+hip,-111],farKnee,farFoot,p,o.variant==='sam'?21:19,true);shoe(c,...farFoot,p,direction==='back');
  leg(c,[8+hip,-111],nearKnee,nearFoot,p,o.variant==='sam'?22:20,false);shoe(c,...nearFoot,p,direction==='back');
  c.save();c.translate(hip*.5,-110-Math.abs(cycle)*1.8+breathing);c.rotate(bodyLean);c.translate(0,110);
  const swing=cycle*8;
  const backElbow:Point=[-30-swing*.4,-153],backWrist:Point=[-27-swing,-126];
  sleeve(c,[-22,-180],backElbow,backWrist,p,true,o.variant==='dev'?p.shirt:undefined);hand(c,backWrist[0],backWrist[1]+5,p);
  // Neck and torso are wide enough to read as adult anatomy beneath layered garments.
  fillPath(c,grad(c,-8,-211,9,-190,p.skinLight,p.skin),()=>{c.moveTo(-7,-207);c.lineTo(8,-207);c.lineTo(9,-192);c.quadraticCurveTo(0,-187,-9,-193);c.closePath();},p.skinShadow,.7);
  const shoulder=o.variant==='alex'?29:o.variant==='sam'?28:26;
  const bottom=o.variant==='sam'?27:o.variant==='mira'?25:24;
  fillPath(c,grad(c,-shoulder,-184,shoulder,-118,p.topLight,p.topShadow),()=>{
    c.moveTo(-11,-194);c.quadraticCurveTo(-shoulder+3,-191,-shoulder,-179);c.lineTo(-shoulder+3,-151);
    c.lineTo(-bottom,-115);c.quadraticCurveTo(0,-107,bottom,-115);c.lineTo(shoulder-5,-152);
    c.lineTo(shoulder-3,-178);c.quadraticCurveTo(shoulder-5,-190,10,-194);c.quadraticCurveTo(1,-186,-11,-194);c.closePath();
  },'rgba(69,49,43,.65)',1);
  if(direction==='back') {
    c.beginPath();c.moveTo(-22,-178);c.quadraticCurveTo(0,-169,21,-178);c.strokeStyle='rgba(61,43,40,.27)';c.lineWidth=1;c.stroke();
    if(o.variant==='alex'){stroke(c,'#d8c2a5',2,[[-23,-118],[23,-118]]);stroke(c,'#d8c2a5',.9,[[-22,-122],[22,-122]]);}
    if(o.variant==='sam')stroke(c,'rgba(87,73,62,.3)',1,[[2,-172],[1,-124]]);
    if(o.variant==='mira')stroke(c,'#7c5a35',2,[[-23,-124],[23,-124]]);
    if(o.variant==='dev')stroke(c,'rgba(225,194,164,.25)',1,[[-17,-141],[-10,-136]]);
  } else if(o.variant==='alex') {
    fillPath(c,p.shirt,()=>{c.moveTo(-9,-192);c.lineTo(1,-180);c.lineTo(10,-192);c.lineTo(7,-118);c.lineTo(-7,-118);c.closePath();});
    fillPath(c,p.topShadow,()=>{c.moveTo(-11,-191);c.lineTo(-1,-180);c.lineTo(-8,-176);c.lineTo(-16,-189);c.closePath();});
    fillPath(c,p.topShadow,()=>{c.moveTo(10,-191);c.lineTo(1,-180);c.lineTo(9,-176);c.lineTo(16,-187);c.closePath();});
    stroke(c,'#e5cab0',2,[[-24,-118],[24,-118]]);stroke(c,'#e5cab0',1,[[-23,-122],[23,-122]]);
    stroke(c,'rgba(235,205,178,.65)',1.5,[[-18,-142],[-10,-139]]);stroke(c,'rgba(235,205,178,.65)',1.5,[[12,-141],[19,-144]]);
    for(const y of [-169,-157,-145,-133])oval(c,8,y,1,1,'#dec6a3');
  } else if(o.variant==='sam') {
    fillPath(c,p.shirt,()=>{c.moveTo(-11,-193);c.lineTo(0,-182);c.lineTo(11,-193);c.lineTo(7,-169);c.lineTo(-8,-169);c.closePath();});
    stroke(c,'#ad9b83',1,[[0,-181],[0,-125]]);for(const y of [-174,-163,-152,-141])oval(c,2,y,.8,.8,'#9d8b76');
    stroke(c,'rgba(114,92,77,.28)',1.1,[[-20,-137],[-13,-132],[-16,-125]]);stroke(c,'rgba(114,92,77,.25)',1,[[18,-151],[12,-143]]);
  } else if(o.variant==='mira') {
    fillPath(c,'#d6ad69',()=>{c.moveTo(-9,-192);c.lineTo(0,-181);c.lineTo(10,-192);c.lineTo(6,-119);c.lineTo(-6,-119);c.closePath();});
    stroke(c,'#73502f',2,[[-23,-125],[23,-125]]);oval(c,1,-125,3,2,'#e9cc87');stroke(c,'rgba(92,59,39,.38)',1.2,[[-20,-153],[-12,-147],[-14,-141]]);
  } else {
    fillPath(c,p.shirt,()=>{c.moveTo(-10,-193);c.lineTo(0,-181);c.lineTo(10,-193);c.lineTo(8,-116);c.lineTo(-8,-116);c.closePath();});
    fillPath(c,p.topShadow,()=>{c.moveTo(-13,-192);c.lineTo(-3,-178);c.lineTo(-5,-115);c.lineTo(-24,-116);c.lineTo(-21,-168);c.closePath();});
    fillPath(c,p.topShadow,()=>{c.moveTo(12,-192);c.lineTo(3,-178);c.lineTo(5,-115);c.lineTo(24,-116);c.lineTo(21,-168);c.closePath();});
    stroke(c,'rgba(223,190,159,.45)',1,[[10,-146],[18,-146]]);for(const y of [-162,-149,-136])oval(c,4,y,.9,.9,'#cea983');
  }
  // Layered hair and facial planes sit above the clothing collar.
  face(c,p,o.variant,direction,mood,o.time);
  let gesture=Math.max(0,(Math.sin(o.time*.65+phase)-.78)/.22)*.35*(1-walk);
  if(pose==='talk')gesture=(.65+.14*Math.sin(o.time*2+phase))*(1-walk);
  const elbow:Point=[27+swing*.3,-153-gesture*2],wrist:Point=[23+swing-gesture*8,-126-gesture*17];
  if(mood==='wave') {
    const wave=Math.sin(o.time*4)*2; const handAt:Point=[38+wave,-181];
    sleeve(c,[21,-182],[32,-160],handAt,p,false,o.variant==='dev'?p.shirt:undefined);hand(c,handAt[0],handAt[1]+3,p,true);
  } else {
    sleeve(c,[21,-182],elbow,wrist,p,false,o.variant==='dev'?p.shirt:undefined);hand(c,wrist[0],wrist[1]+5,p,pose==='talk'&&gesture>.4);
  }
  c.restore();c.restore();
}
