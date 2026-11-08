import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARCADE, CLAW, DESK, LOUNGE, POOL, VENUE } from '../../shared/venue';
import { createVenueMaterials } from './materials';

/** Render-only architecture. Simulation remains entirely in the shared room state. */
export function buildEnvironment() {
  const root=new THREE.Group();root.name='cinematic-venue';const cameraObstacles:THREE.Object3D[]=[];
  const m=createVenueMaterials();const geometries=new Set<THREE.BufferGeometry>();const extraMaterials:THREE.Material[]=[];const extraTextures:THREE.Texture[]=[];
  function mesh(g:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root){geometries.add(g);const o=new THREE.Mesh(g,material);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function box(w:number,h:number,d:number,material:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root){return mesh(new THREE.BoxGeometry(w,h,d),material,x,y,z,parent);}
  function rounded(w:number,h:number,d:number,r:number,material:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root){return mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w*.45,h*.45,d*.45)),material,x,y,z,parent);}
  function cylinder(top:number,bottom:number,h:number,material:THREE.Material,x:number,y:number,z:number,parent:THREE.Object3D=root,segments=12){return mesh(new THREE.CylinderGeometry(top,bottom,h,segments),material,x,y,z,parent);}
  function bar(a:THREE.Vector3,b:THREE.Vector3,r:number,material:THREE.Material,parent:THREE.Object3D=root){const v=new THREE.Vector3().subVectors(b,a);const o=cylinder(r,r,v.length(),material,0,0,0,parent,8);o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;}
  function signTexture(title:string,subtitle:string,background:string,foreground:string){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=192;const c=canvas.getContext('2d');if(!c)throw new Error('Canvas is unavailable');
    c.fillStyle=background;c.fillRect(0,0,512,192);c.strokeStyle=foreground;c.lineWidth=6;c.strokeRect(10,10,492,172);
    c.fillStyle=foreground;c.textAlign='center';c.font='bold 74px Georgia, serif';c.fillText(title,256,90,466);
    c.font='bold 25px Georgia, serif';c.fillText(subtitle,256,145,465);
    const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;extraTextures.push(t);const material=new THREE.MeshStandardMaterial({map:t,roughness:.8});extraMaterials.push(material);return material;
  }
  function wall(w:number,h:number,d:number,x:number,y:number,z:number){const o=box(w,h,d,m.plaster,x,y,z);o.castShadow=false;cameraObstacles.push(o);return o;}
  const midZ=(VENUE.minZ+VENUE.maxZ)/2,H=5.5;
  // Walls match the collision planes; each remains a solid camera obstacle.
  box(VENUE.width,.08,VENUE.depth,m.carpet,0,-.045,midZ);
  wall(VENUE.width,H,.25,0,H/2,VENUE.minZ);
  wall(VENUE.width,H,.25,0,H/2,VENUE.maxZ);
  wall(.25,H,VENUE.depth,VENUE.minX,H/2,midZ);
  wall(.25,H,VENUE.depth,VENUE.maxX,H/2,midZ);
  const ceiling=box(VENUE.width,.16,VENUE.depth,m.ceiling,0,H+.02,midZ);ceiling.castShadow=false;cameraObstacles.push(ceiling);
  // Lower walnut paneling, a fine picture rail and quiet upper plaster.
  // Do not divide the entire room into full-height dark timber squares.
  for(const z of [VENUE.minZ+.16,VENUE.maxZ-.16]){
    box(VENUE.width-.3,1.15,.12,m.walnutDark,0,.575,z);box(VENUE.width-.3,.09,.18,m.walnut,0,1.16,z);box(VENUE.width-.3,.10,.16,m.walnutDark,0,.07,z);
    box(VENUE.width-.3,.08,.14,m.walnut,0,5.35,z);
    const faceZ=z+(z<0?.075:-.075);
    box(VENUE.width-.4,.025,.024,m.walnut,0,.22,faceZ);box(VENUE.width-.4,.025,.024,m.walnut,0,.96,faceZ);
    for(let x=VENUE.minX+1;x<VENUE.maxX;x+=1.5)box(.035,.76,.024,m.walnut,x,.59,faceZ);
  }
  for(const x of [VENUE.minX+.16,VENUE.maxX-.16]){
    box(.12,1.15,VENUE.depth-.3,m.walnutDark,x,.575,midZ);box(.18,.09,VENUE.depth-.3,m.walnut,x,1.16,midZ);box(.16,.10,VENUE.depth-.3,m.walnutDark,x,.07,midZ);box(.14,.08,VENUE.depth-.3,m.walnut,x,5.35,midZ);
    const faceX=x+(x<0?.075:-.075);
    box(.024,.025,VENUE.depth-.4,m.walnut,faceX,.22,midZ);box(.024,.025,VENUE.depth-.4,m.walnut,faceX,.96,midZ);
    for(let z=VENUE.minZ+1;z<VENUE.maxZ;z+=1.5)box(.024,.76,.035,m.walnut,faceX,.59,z);
  }
  for(let x=VENUE.minX+3;x<VENUE.maxX;x+=6)box(.085,.065,VENUE.depth-.3,m.walnut,x,5.43,midZ);
  // Back bar windows are part of the wall, with a cool exterior color.
  for(const x of [-9.8,9.8]){
    box(1.75,2.6,.07,m.walnutDark,x,3.15,VENUE.minZ+.17);box(1.48,2.33,.035,m.nightGlass,x,3.15,VENUE.minZ+.22);
    box(.045,2.3,.05,m.brass,x,3.15,VENUE.minZ+.25);box(1.48,.045,.05,m.brass,x,3.15,VENUE.minZ+.25);
  }
  for(const x of [-7.8,7.8]){
    box(.18,.47,.07,m.brass,x,3.45,VENUE.minZ+.18);
    const shade=rounded(.14,.31,.11,.055,m.light,x,3.45,VENUE.minZ+.24);shade.castShadow=false;
  }
  for(const [x,title,subtitle] of [[-5.7,'LANES','SHOES  •  GAMES  •  GOOD COMPANY'],[4.7,'NEW YEAR’S EVE','A LITTLE LUCK AFTER DARK']] as const){
    box(2.55,.97,.10,m.walnutDark,x,2.65,VENUE.minZ+.18);
    const face=mesh(new THREE.PlaneGeometry(2.38,.82),signTexture(title,subtitle,'#4b3029','#ead5ab'),x,2.65,VENUE.minZ+.245);face.castShadow=false;
  }
  // An entrance set into the front wall reads as joinery, not a traversable exit.
  {
    const z=VENUE.maxZ-.16;
    box(3.4,3.3,.08,m.walnutDark,0,1.7,z);
    for(const x of [-.77,.77]){
      box(1.42,3.08,.045,m.nightGlass,x,1.7,z-.055);
      box(1.32,.06,.06,m.brass,x,.31,z-.09);box(1.32,.06,.06,m.brass,x,2.98,z-.09);
      box(.05,3.02,.06,m.brass,x-.65,1.65,z-.09);box(.05,3.02,.06,m.brass,x+.65,1.65,z-.09);
      bar(new THREE.Vector3(x+(x<0?.42:-.42),1.05,z-.13),new THREE.Vector3(x+(x<0?.42:-.42),1.48,z-.13),.028,m.brass);
    }
    box(3.55,.14,.22,m.walnut,0,3.38,z);
  }
  // Warm pendants: actual pendant cords, shades and bulbs, no extra dynamic lights.
  function pendant(x:number,z:number){cylinder(.018,.018,1.12,m.dark,x,4.85,z);const s=cylinder(.16,.42,.24,m.brass,x,4.2,z);s.castShadow=false;const bulb=mesh(new THREE.SphereGeometry(.16,12,8),m.light,x,4.08,z);bulb.castShadow=false;}
  for(const [x,z] of [[VENUE.laneX-3.3,3],[VENUE.laneX,-5],[POOL.centerX,POOL.centerZ],[LOUNGE.tableX,LOUNGE.z],[CLAW.centerX,-5]] as const)pendant(x,z);

  // Honey maple bowling surface and approach, continuous at the server floor height.
  const laneBack=VENUE.minZ+.32,laneFront=4.4,laneLength=laneFront-laneBack;
  box(4,.025,laneLength,m.maple,VENUE.laneX,.015,(laneBack+laneFront)/2);
  box(8.6,.018,6.6,m.walnut,VENUE.laneX-.3,.005,7.1);
  const laneRails=[VENUE.laneX-2.1,VENUE.laneX+2.1];
  for(const x of laneRails){rounded(.32,.7,13.4,.08,m.walnutDark,x,.35,-6.1);box(.22,.05,13.35,m.brass,x,.715,-6.1);}
  for(let i=-2;i<=2;i++){const marker=mesh(new THREE.ConeGeometry(.075,.18,3),m.walnutDark,VENUE.laneX+i*.55,.037,-2.3);marker.rotation.x=Math.PI/2;marker.rotation.z=Math.PI;}
  box(4,.02,.035,m.walnutDark,VENUE.laneX,.04,VENUE.laneStartZ);
  // Fixed ball-return housing straddles the lane rail, not a walkable route.
  rounded(.72,.7,1.65,.19,m.walnutDark,VENUE.laneX+2.02,.35,-.35);rounded(.66,.34,1.25,.14,m.cream,VENUE.laneX+2.02,.78,-.35);
  box(.48,.07,.8,m.dark,VENUE.laneX+2.02,.965,-.45);
  for(const [i,color] of ['#5e3734','#4a5f56','#c09869'].entries()){const ballmat=new THREE.MeshStandardMaterial({color,roughness:.34});extraMaterials.push(ballmat);mesh(new THREE.SphereGeometry(.12,12,8),ballmat,VENUE.laneX+2.02,1.04,-.72+i*.27);}

  // Shoe counter stays inside its exact shared footprint and 1.1 m height.
  {
    const {x,z,half:[hx,hy,hz]}=DESK,top=hy*2;
    cameraObstacles.push(rounded(hx*2,.11,hz*2,.045,m.walnut,x,top-.055,z));
    cameraObstacles.push(box(hx*2-.12,top-.12,.12,m.walnutDark,x,(top-.12)/2,z-hz+.06));
    for(const xx of [x-hx+.09,x+hx-.09])box(.13,top-.12,hz*2-.12,m.walnutDark,xx,(top-.12)/2,z);
    for(const y of [.12,top*.48])box(hx*2-.13,.06,hz*2-.16,m.walnut,x,y,z);
    const spacing=(hx*2-.25)/6;
    for(let i=0;i<=6;i++)box(.045,top*.82,hz*2-.18,m.walnutDark,x-hx+.12+i*spacing,top*.48,z);
    // Shoes sit on the shelves, made as toes, heels and sole rather than flat markers.
    for(let row=0;row<2;row++)for(let i=0;i<6;i++){
      const px=x-hx+.12+(i+.5)*spacing,py=row?top*.51:.15;
      rounded(spacing*.62,.09,.28,.045,i%2?m.cream:m.shoe,px,py+.045,z+.12);
      box(spacing*.65,.025,.3,m.dark,px,py+.01,z+.12);
      box(spacing*.2,.06,.14,m.walnutDark,px-spacing*.2,py+.1,z+.06);
    }
    box(.9,.018,.3,m.paper,x+.95,top+.01,z-.15);box(.7,.026,.08,m.walnutDark,x+.95,top+.02,z-.15);
  }
  // Paired upholstered booths: visible cushions stay within the shared bench bodies.
  function booth(x:number,outer:-1|1){
    const [hx,,hz]=LOUNGE.benchHalf,z=LOUNGE.z;
    rounded(hx*2-.06,.35,hz*2-.08,.1,m.walnutDark,x,.24,z);
    rounded(hx*2-.08,.20,hz*2-.10,.09,m.leather,x,.55,z);
    const bx=x+outer*(hx-.15);cameraObstacles.push(rounded(.27,.65,hz*2-.10,.11,m.leatherDark,bx,.88,z));
    rounded(.16,.54,hz*2-.18,.065,m.leather,bx-outer*.09,.9,z);
    for(let zz=z-hz+.7;zz<z+hz-.2;zz+=1.1){
      box(hx*2-.16,.012,.014,m.leatherDark,x,.66,zz);box(.016,.45,.025,m.leatherDark,bx-outer*.18,.9,zz);
    }
    for(const zz of [z-hz+.24,z+hz-.24])for(const xx of [x-hx+.18,x+hx-.18])cylinder(.06,.08,.15,m.walnutDark,xx,.075,zz);
    for(let zz=z-hz+.55;zz<z+hz;zz+=.8){const button=mesh(new THREE.SphereGeometry(.025,8,6),m.brass,bx-outer*.18,.93,zz);button.scale.set(.35,1,1);}
  }
  booth(LOUNGE.leftX,-1);booth(LOUNGE.rightX,1);
  {
    const x=LOUNGE.tableX,z=LOUNGE.z,[hx,hy,hz]=LOUNGE.tableHalf,top=hy*2;
    rounded(hx*2,.11,hz*2,.06,m.walnut,x,top-.055,z);
    for(const dx of [-hx+.25,hx-.25])for(const dz of [-hz+.25,hz-.25]){
      const a=new THREE.Vector3(x+dx,top-.12,z+dz),b=new THREE.Vector3(x+dx*1.05,.06,z+dz*1.04);bar(a,b,.045,m.walnutDark);
    }
    box(.42,.022,.3,m.paper,x+.45,top+.015,z-.35);
  }

  // Pool table surrounds the isolated pool simulation. Felt top is one ball radius below its centers.
  {
    const x=POOL.centerX,z=POOL.centerZ,[hx,,hz]=POOL.tableHalf,deck=POOL.height-POOL.radius;
    const apronH=.24,legH=deck-apronH+.03;
    for(const dx of [-hx+.4,hx-.4])for(const dz of [-hz+.34,hz-.34]){
      rounded(.22,legH,.22,.04,m.walnutDark,x+dx,legH/2,z+dz);box(.24,.04,.24,m.brass,x+dx,.06,z+dz);
    }
    // Keep the wood apron top below the cloth; coplanar faces flicker badly
    // in the activity camera as it looks across the table.
    rounded(hx*2,apronH,hz*2,.06,m.walnutDark,x,deck-apronH/2-.025,z);
    box(POOL.maxX-POOL.minX,.04,POOL.maxZ-POOL.minZ,m.felt,x,deck-.02,z);
    const railY=deck+.10,railH=.2,span=(POOL.maxX-POOL.minX)/2-POOL.cushionOpening*2;
    for(const zz of [POOL.minZ-.09,POOL.maxZ+.09])for(const sign of [-1,1])rounded(span,railH,.25,.06,m.walnut,x+sign*((POOL.maxX-POOL.minX)/4),railY,zz);
    for(const xx of [POOL.minX-.10,POOL.maxX+.10])rounded(.25,railH,(POOL.maxZ-POOL.minZ)-2*POOL.cushionOpening,.06,m.walnut,xx,railY,z);
    for(const xx of [POOL.minX,POOL.centerX,POOL.maxX])for(const zz of [POOL.minZ,POOL.maxZ]){const pocket=cylinder(POOL.pocketRadius,POOL.pocketRadius,.012,m.black,xx,deck+.01,zz,root,18);pocket.castShadow=false;}
    for(const dx of [-2,-1,0,1,2])for(const zz of [POOL.minZ-.1,POOL.maxZ+.1])box(.035,.012,.035,m.brass,x+dx,railY+.11,zz);
  }

  // Two period cabinets are housed wholly within the arcade collision body.
  for(const [index,dx] of [-1.15,1.15].entries()){
    const x=ARCADE.centerX+dx,z=ARCADE.centerZ;
    cameraObstacles.push(rounded(1.55,2.38,1.8,.09,m.walnutDark,x,1.19,z));
    box(1.28,.9,.05,m.dark,x,1.57,z+ARCADE.half[2]-.28);
    box(1.1,.67,.025,m.nightGlass,x,1.57,z+ARCADE.half[2]-.24);
    box(1.32,.26,.3,m.walnut,x,.98,z+ARCADE.half[2]-.18);
    cylinder(.045,.045,.12,m.dark,x-.32,1.16,z+ARCADE.half[2]-.15);
    for(const bx of [.06,.2,.34])cylinder(.035,.035,.025,m.brass,x+bx,1.13,z+ARCADE.half[2]-.15);
    box(1.3,.32,.06,m.cream,x,2.15,z+ARCADE.half[2]-.23);
    const marquee=mesh(new THREE.PlaneGeometry(1.23,.26),signTexture(index===0?'STAR RUN':'AFTER HOURS','ARCADE','#5a302e','#ead7af'),x,2.15,z+ARCADE.half[2]-.19);marquee.castShadow=false;
    box(.5,.22,.06,m.dark,x,.35,z+ARCADE.half[2]-.23);
  }
  // Transparent-sided prize cabinet; moving crane and prize are supplied by renderer state.
  {
    const x=CLAW.centerX,z=CLAW.centerZ,hx=CLAW.cabinetHalfX,hz=CLAW.cabinetHalfZ;
    cameraObstacles.push(rounded(hx*2,CLAW.bedY,hz*2,.08,m.leatherDark,x,CLAW.bedY/2,z));
    box(hx*2-.15,.06,hz*2-.15,m.cream,x,CLAW.bedY+.03,z);
    const top=4.12;for(const xx of [x-hx,x+hx])for(const zz of [z-hz,z+hz])box(.075,top-CLAW.bedY,.075,m.brass,xx,(top+CLAW.bedY)/2,zz);
    box(hx*2,.1,.10,m.brass,x,top,z-hz);box(hx*2,.1,.10,m.brass,x,top,z+hz);
    for(const xx of [x-hx,x+hx])box(.1,.1,hz*2,m.brass,xx,top,z);
    box(hx*2-.1,top-CLAW.bedY-.1,.025,m.glass,x,(top+CLAW.bedY)/2,z-hz+.04);
    for(const xx of [x-hx+.04,x+hx-.04])box(.025,top-CLAW.bedY-.1,hz*2-.1,m.glass,xx,(top+CLAW.bedY)/2,z);
    rounded(.7,.44,.05,.04,m.dark,x,.6,z+hz+.04);box(.38,.05,.03,m.brass,x,.64,z+hz+.075);
    box(hx*2,.36,.12,m.walnutDark,x,4.28,z+hz);box(hx*1.7,.23,.04,m.cream,x,4.28,z+hz+.08);
    const marquee=mesh(new THREE.PlaneGeometry(hx*1.65,.21),signTexture('LUCKY DIP','PLAY TOGETHER','#5a302e','#ead7af'),x,4.28,z+hz+.105);marquee.castShadow=false;
    // Flush landing bay beside the machine: its small inner outline is the
    // actual server release-center region, not an invented collidable hatch.
    const bayX=(CLAW.surpriseMinX+CLAW.hatchMaxX)/2,bayZ=(CLAW.hatchMinZ+CLAW.maxZ)/2;
    const bw=1.9,bd=1.8;
    box(bw,.018,bd,m.walnutDark,bayX,.006,bayZ);
    for(const xx of [bayX-bw/2,bayX+bw/2])box(.035,.012,bd,m.brass,xx,.02,bayZ);
    for(const zz of [bayZ-bd/2,bayZ+bd/2])box(bw,.012,.035,m.brass,bayX,.02,zz);
    const gw=CLAW.hatchMaxX-CLAW.surpriseMinX,gd=CLAW.maxZ-CLAW.hatchMinZ;
    for(const xx of [CLAW.surpriseMinX,CLAW.hatchMaxX])box(.025,.012,gd,m.cream,xx,.03,bayZ);
    for(const zz of [CLAW.hatchMinZ,CLAW.maxZ])box(gw,.012,.025,m.cream,bayX,.03,zz);
    const label=mesh(new THREE.PlaneGeometry(.82,.3),signTexture('DROP','LANDING BAY','#5a302e','#ead7af'),x-hx-.055,.53,bayZ);label.rotation.y=-Math.PI/2;label.castShadow=false;
  }

  // Three modest draped paper garlands, placed on the back wall for NYE.
  for(const center of [-7,0,7]){
    const width=4.8;let last:THREE.Vector3|undefined;
    for(let i=0;i<=12;i++){
      const t=i/12,x=center-width/2+t*width,y=4.68-.16*Math.sin(t*Math.PI),point=new THREE.Vector3(x,y,VENUE.minZ+.25);
      if(last)bar(last,point,.006,m.brass);last=point;
      if(i>0&&i<12&&i%2===0){const f=mesh(new THREE.ConeGeometry(.065,.13,3),m.paper,x,y-.075,VENUE.minZ+.23);f.rotation.z=Math.PI;}
    }
  }
  // Wall clock follows story time. The persistent HUD remains the readable primary clock.
  const clockCanvas=document.createElement('canvas');clockCanvas.width=512;clockCanvas.height=256;const clockCtx=clockCanvas.getContext('2d');if(!clockCtx)throw new Error('Canvas is unavailable');
  const clockTexture=new THREE.CanvasTexture(clockCanvas);clockTexture.colorSpace=THREE.SRGBColorSpace;extraTextures.push(clockTexture);
  const clockMaterial=new THREE.MeshStandardMaterial({map:clockTexture,roughness:.7,emissive:'#564126',emissiveIntensity:.18});extraMaterials.push(clockMaterial);
  box(2.1,1.05,.12,m.walnutDark,0,3.65,VENUE.minZ+.18);box(1.96,.91,.025,clockMaterial,0,3.65,VENUE.minZ+.26);
  let lastMinute=-1;function clock(seconds:number){const minute=Math.floor(seconds/60);if(minute===lastMinute)return;lastMinute=minute;const hour=Math.floor(minute/60)%24,mins=((minute%60)+60)%60;
    clockCtx!.fillStyle='#292623';clockCtx!.fillRect(0,0,512,256);clockCtx!.strokeStyle='#c8a36a';clockCtx!.lineWidth=7;clockCtx!.strokeRect(12,12,488,232);clockCtx!.fillStyle='#dfbb7b';clockCtx!.font='bold 25px Georgia';clockCtx!.textAlign='center';clockCtx!.fillText('NEW YEAR’S EVE',256,66);clockCtx!.font='bold 108px Georgia';clockCtx!.fillStyle='#f0d7a4';clockCtx!.fillText(`${hour%12||12}:${String(mins).padStart(2,'0')}`,256,184);clockTexture.needsUpdate=true;}
  clock(VENUE.startTime);
  // Merge only static, opaque siblings with compatible vertex attributes.
  // Collision-aware camera walls and transparent glass retain their own meshes;
  // the same material objects (including the live clock texture) remain in use.
  const obstacles=new Set(cameraObstacles),groups=new Map<string,THREE.Mesh[]>();
  for(const child of root.children){
    if(!(child instanceof THREE.Mesh)||obstacles.has(child)||Array.isArray(child.material)||child.material.transparent)continue;
    const attrs=Object.keys(child.geometry.attributes).sort().map(name=>{const a=child.geometry.getAttribute(name);return `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`;}).join('|');
    const key=`${child.material.uuid}:${Number(child.castShadow)}:${Number(child.receiveShadow)}:${attrs}`;
    const group=groups.get(key);if(group)group.push(child);else groups.set(key,[child]);
  }
  for(const group of groups.values()){
    if(group.length<2)continue;
    const copies=group.map(part=>{part.updateMatrix();const g=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();g.applyMatrix4(part.matrix);return g;});
    const combined=mergeGeometries(copies,false);copies.forEach(g=>g.dispose());if(!combined)continue;
    const first=group[0],batched=new THREE.Mesh(combined,first.material);batched.name='venue-static-batch';batched.castShadow=first.castShadow;batched.receiveShadow=first.receiveShadow;root.add(batched);geometries.add(combined);
    for(const part of group){root.remove(part);geometries.delete(part.geometry);part.geometry.dispose();}
  }
  return {root,cameraObstacles,clock,dispose(){geometries.forEach(g=>g.dispose());extraMaterials.forEach(a=>a.dispose());extraTextures.forEach(t=>t.dispose());m.dispose();root.clear();}};
}
