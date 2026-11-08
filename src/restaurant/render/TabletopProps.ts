import * as THREE from 'three';
import type { DinnerState } from '../types';
import { createProceduralMaterial } from './ProceduralMaterials';

/** Keep shared desserts, the board and their supporting objects in distinct spaces. */
export function dessertLayout(state: DinnerState) {
  const own=state.evening.dessert.status==='served',other=state.doubleDate?.otherView?.evening.dessert.status==='served';
  const board=state.doubleDate?.tableActivity && state.doubleDate.tableActivity.owner!==state.doubleDate.localHumanId ? state.doubleDate.otherView?.evening ?? state.evening : state.evening;
  const boardReserved=board.coasters.phase!=='idle'&&!board.bill.requested;
  const dual=!!state.doubleDate&&own&&!!other;
  return {own,other:!!other,dual,park:(own||!!other)&&(boardReserved||dual)};
}

/** Close-range tabletop meshes. Game rules remain in the dinner state. */
export class TabletopProps {
  readonly root = new THREE.Group();
  readonly targets: THREE.Mesh[] = [];
  readonly playerGlass = new THREE.Group();
  readonly menu: THREE.Mesh;
  readonly flame: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly solo = new THREE.Group();
  private readonly doubles = new THREE.Group();
  private readonly placeGroups: { group: THREE.Group; plate: THREE.Group; cutlery: THREE.Group; napkin: THREE.Group; salt: THREE.InstancedMesh; pepper: THREE.InstancedMesh; x: number; z: number }[] = [];
  private readonly water: THREE.Mesh;
  private readonly carafeWater: THREE.Mesh;
  private readonly bread: THREE.Group[] = [];
  private readonly shared = new THREE.Group();
  private readonly lamp = new THREE.Group();
  private readonly basket = new THREE.Group();
  private readonly carafe = new THREE.Group();
  private readonly shakers: THREE.Group[] = [];
  private readonly dateGlasses: { group: THREE.Group; x: number; z: number; double: boolean }[] = [];
  private readonly vase = new THREE.Group();
  private readonly lampLight: THREE.PointLight;
  private readonly lampShade: THREE.MeshStandardMaterial;
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  constructor() {
    const mat = (color: string, roughness = .7, metalness = 0) => { const m = new THREE.MeshStandardMaterial({color, roughness, metalness}); this.materials.push(m); return m; };
    const surface = (kind: 'ceramic'|'linen', color: string, scale: number) => { const m = createProceduralMaterial(kind, color, { roughness: kind === 'ceramic' ? .38 : .95, bumpScale: scale }); this.materials.push(m); for (const t of [m.map,m.bumpMap,m.roughnessMap]) if (t) this.textures.push(t); return m; };
    const ceramic = surface('ceramic', '#f4ead7', .0004), linen = surface('linen', '#b87678', .0005);
    const steel = mat('#c7c5b8', .24, .78), gold = mat('#b79a69', .3, .65), dark = mat('#544c3a');
    const glass = new THREE.MeshStandardMaterial({color:'#daeae5',roughness:.15,metalness:.08,transparent:true,opacity:.23,depthWrite:false,side:THREE.DoubleSide});
    const water = new THREE.MeshStandardMaterial({color:'#9ec6c1',roughness:.19,transparent:true,opacity:.46,depthWrite:false});
    this.materials.push(glass,water);
    const cork = mat('#b9996e', .95), crust = mat('#b77a42', .9), crumb = mat('#e5c78e', 1), green = mat('#536c47', .9), pink = mat('#df9aa4', .83), yellow = mat('#c89b54', .8);
    const geo = (key:string, make:()=>THREE.BufferGeometry) => { let g=this.geometry.get(key); if(!g){g=make();this.geometry.set(key,g);} return g; };
    const add = (parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0) => {const o=new THREE.Mesh(g,m);o.position.set(x,y,z); parent.add(o); return o;};
    const lathe = (key:string, pts:number[][], seg=32) => geo(key,()=>new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0]!,p[1]!)),seg));
    const ring = (parent:THREE.Object3D,r:number,t:number,y:number,material:THREE.Material) => {const o=add(parent,geo(`ring${r}:${t}`,()=>new THREE.TorusGeometry(r,t,6,32)),material,0,y,0);o.rotation.x=Math.PI/2;return o;};
    const plateGeo=lathe('plate',[[0,.012],[.105,.012],[.125,.014],[.145,.023],[.171,.029],[.181,.027],[.182,.021],[.165,.016],[.126,.007],[.105,.005],[0,.005]],48);
    const handleGeo=geo('handle',()=>new THREE.CapsuleGeometry(.009,.12,3,8));
    const tineGeo=geo('tine',()=>new THREE.BoxGeometry(.004,.004,.046));
    const napkinGeo=geo('napkin',()=>new THREE.BoxGeometry(.085,.012,.205));
    const place = (parent:THREE.Group,x:number,z:number) => {
      const group=new THREE.Group();group.position.set(x,.782,z);parent.add(group);
      const plate=new THREE.Group();group.add(plate);add(plate,plateGeo,ceramic);ring(plate,.098,.004,.004,ceramic);
      for (const dx of [-.006,.006]) {const mark=add(plate,geo('plate-mark',()=>new THREE.BoxGeometry(.003,.001,.022)),gold,dx,.030,-.163);mark.rotation.y=dx*4;}
      const seasoning=(material:THREE.Material,seed:number) => {const grains=new THREE.InstancedMesh(geo('grain',()=>new THREE.SphereGeometry(.0018,5,4)),material,18), transform=new THREE.Object3D();for(let i=0;i<18;i++){const a=i*2.4+seed,r=.12+(i%5)*.006;transform.position.set(Math.cos(a)*r,.031,Math.sin(a)*r);transform.updateMatrix();grains.setMatrixAt(i,transform.matrix);}grains.visible=false;plate.add(grains);return grains;};
      const salt=seasoning(ceramic,0),pepper=seasoning(dark,1);
      const napkin=new THREE.Group(); napkin.position.set(.265,.004,0);napkin.rotation.y=.12;group.add(napkin);
      add(napkin,napkinGeo,linen,0,0,0);const fold=add(napkin,geo('napkin-fold',()=>new THREE.BoxGeometry(.075,.004,.09)),linen,0,.008,-.05);fold.rotation.y=.08;
      const cutlery=new THREE.Group();group.add(cutlery);
      const fork=new THREE.Group(); fork.position.set(-.235,.006,.01);cutlery.add(fork);
      const fh=add(fork,handleGeo,steel,0,.003,.037);fh.rotation.x=Math.PI/2;
      add(fork,geo('fork-shoulder',()=>new THREE.BoxGeometry(.035,.005,.025)),steel,0,.003,-.045);
      for(let i=0;i<4;i++)add(fork,tineGeo,steel,(i-1.5)*.009,.003,-.077);
      const knife=new THREE.Group();knife.position.set(.22,.006,0);cutlery.add(knife);
      const kh=add(knife,handleGeo,steel,0,.003,.038);kh.rotation.x=Math.PI/2;
      const blade=add(knife,geo('blade',()=>new THREE.BoxGeometry(.022,.004,.105)),steel,0,.003,-.066);blade.rotation.y=-.035;
      const spoon=new THREE.Group(); spoon.position.set(.265,.006,0);cutlery.add(spoon);
      const sh=add(spoon,handleGeo,steel,0,.003,.036);sh.rotation.x=Math.PI/2;
      const bowl=add(spoon,geo('spoon-bowl',()=>new THREE.SphereGeometry(1,12,8)),steel,0,.004,-.072);bowl.scale.set(.014,.004,.027);
      this.placeGroups.push({group,plate,cutlery,napkin,salt,pepper,x,z});
    };
    for(const z of [-.64,-1.67])place(this.solo,0,z);
    for(const x of [-.57,.57])for(const z of [-.32,-1.98])place(this.doubles,x,z);
    this.doubles.visible=false;this.root.add(this.solo,this.doubles,this.shared);
    const glassBody=lathe('glass-body',[[.038,0],[.041,.006],[.047,.146],[.046,.15],[.043,.15],[.037,.012],[.034,.009],[0,.009]],32);
    const glassWater=geo('glass-water',()=>new THREE.CylinderGeometry(.042,.036,.11,24));
    const makeGlass=(group:THREE.Group) => {add(group,glassBody,glass);const w=add(group,glassWater,water,0,.065,0);ring(group,.046,.0018,.15,glass);ring(group,.039,.002,.006,glass);
      const droplet=geo('condensation',()=>new THREE.SphereGeometry(.0018,6,4));
      const droplets=new THREE.InstancedMesh(droplet,glass,12), transform=new THREE.Object3D();
      for(let i=0;i<12;i++){const a=i*2.4,h=.03+(i%5)*.022,r=.04+h*.04;transform.position.set(Math.cos(a)*r,h,Math.sin(a)*r);transform.scale.set(1,1.5,1);transform.updateMatrix();droplets.setMatrixAt(i,transform.matrix);}group.add(droplets);
      return w;};
    this.water=makeGlass(this.playerGlass);this.playerGlass.position.set(.49,.782,-.77);this.root.add(this.playerGlass);
    const dateGlass=new THREE.Group();makeGlass(dateGlass); dateGlass.position.set(-.42,.782,-1.7);this.solo.add(dateGlass);this.dateGlasses.push({group:dateGlass,x:0,z:-1.7,double:false});
    for(const x of [-.57,.57]) {const g=new THREE.Group();makeGlass(g);g.position.set(x-.25,.782,-1.86);this.doubles.add(g);this.dateGlasses.push({group:g,x,z:-1.86,double:true});}
    // The carafe uses a hollow profile and a separate finite water volume.
    const carafe=this.carafe;carafe.position.set(-.56,.782,-1.50);this.shared.add(carafe);
    add(carafe,lathe('carafe',[[.045,0],[.062,.012],[.064,.14],[.055,.205],[.031,.265],[.028,.30],[.034,.31],[.031,.315],[.024,.3],[.026,.265],[.05,.20],[.058,.14],[.056,.018],[.043,.008]],40),glass);
    ring(carafe,.032,.002,.313,glass);this.carafeWater=add(carafe,geo('carafe-water',()=>new THREE.CylinderGeometry(.056,.056,.16,28)),water,0,.09,0);
    // Brass stem, translucent woven shade and warm practical light.
    const lamp=this.lamp;lamp.position.set(-.20,.782,-1.12);this.shared.add(lamp);
    add(lamp,lathe('lamp',[[0,0],[.047,0],[.049,.009],[.037,.019],[.018,.03],[.012,.12],[.025,.13]],32),gold);
    this.lampShade=surface('linen','#f4dfbd',.0004);this.lampShade.side=THREE.DoubleSide;this.lampShade.emissive.set('#c68c51');this.lampShade.emissiveIntensity=.24;
    add(lamp,geo('shade',()=>new THREE.CylinderGeometry(.053,.085,.105,32,1,true)),this.lampShade,0,.165,0);ring(lamp,.085,.002,.112,gold);ring(lamp,.053,.002,.217,gold);
    const glow=new THREE.MeshBasicMaterial({color:'#ffdc9b'});this.materials.push(glow);this.flame=add(lamp,geo('bulb',()=>new THREE.SphereGeometry(.015,12,8)),glow,0,.155,0);
    this.lampLight=new THREE.PointLight('#ffd6a5',.75,1.7,2);this.lampLight.position.set(0,.16,0);lamp.add(this.lampLight);
    // Low floral arrangement keeps faces clear.
    this.vase.position.set(-.48,.782,-1.08);this.shared.add(this.vase);
    add(this.vase,lathe('vase',[[0,0],[.045,0],[.055,.018],[.057,.075],[.045,.12],[.032,.145],[.034,.15],[.028,.15],[.027,.13]],32),ceramic);
    const stemGeo=geo('stem',()=>new THREE.CylinderGeometry(.002,.002,.17,7));
    const leafGeo=geo('leaf',()=>new THREE.SphereGeometry(1,10,7));
    for(let i=0;i<3;i++){const stem=add(this.vase,stemGeo,green,(i-1)*.018,.195,0);stem.rotation.z=(i-1)*.12;const x=(i-1)*.025;
      const leaf=add(this.vase,leafGeo,green,x,.19,.01);leaf.scale.set(.032,.007,.012);leaf.rotation.z=(i-1)*.4;
      for(let p=0;p<5;p++){const a=p*Math.PI*2/5;const petal=add(this.vase,leafGeo,pink,x+Math.cos(a)*.017,.285+Math.sin(a)*.017,0);petal.scale.set(.014,.021,.006);petal.rotation.z=a-Math.PI/2;}const center=add(this.vase,leafGeo,yellow,x,.285,.007);center.scale.set(.008,.008,.005);
    }
    // Cork basket and hand-scored rolls.
    const basket=this.basket;basket.position.set(.34,.782,-1.28);this.shared.add(basket);
    add(basket,lathe('basket',[[0,0],[.105,0],[.115,.015],[.13,.055],[.125,.06],[.11,.02],[0,.012]],32),cork);ring(basket,.126,.004,.055,cork);
    for(let i=0;i<4;i++){const roll=new THREE.Group();roll.position.set((i%2-.5)*.09,.045,(Math.floor(i/2)-.5)*.065);basket.add(roll);const bread=add(roll,geo('roll',()=>new THREE.SphereGeometry(1,16,10)),crust);bread.scale.set(.055,.027,.038);for(let j=-1;j<=1;j++){const score=add(roll,geo('score',()=>new THREE.BoxGeometry(.004,.002,.043)),crumb,j*.018,.026,0);score.rotation.y=.25;}this.bread.push(roll);}
    for(const [i,label] of ['SALT','PEPPER'].entries()){
      const shaker=new THREE.Group();shaker.position.set(.66+i*.085,.7795,-.91);this.shared.add(shaker);
      add(shaker,geo('shaker',()=>new THREE.CylinderGeometry(.023,.027,.075,16)),ceramic,0,.04,0);
      add(shaker,geo('shaker-top',()=>new THREE.CylinderGeometry(.023,.023,.009,16)),steel,0,.081,0);
      const holes=new THREE.InstancedMesh(geo('shaker-hole',()=>new THREE.CylinderGeometry(.0015,.0015,.0007,7)),dark,5), dot=new THREE.Object3D();
      for(let n=0;n<5;n++){const a=n*Math.PI*2/5;dot.position.set(Math.cos(a)*.009,.086,Math.sin(a)*.009);dot.updateMatrix();holes.setMatrixAt(n,dot.matrix);}shaker.add(holes);
      const mark=document.createElement('canvas');mark.width=mark.height=128;const ink=mark.getContext('2d')!;ink.fillStyle='#66594e';ink.textAlign='center';ink.textBaseline='middle';ink.font='bold 82px Georgia';ink.fillText(i?'P':'S',64,70);
      const markTexture=new THREE.CanvasTexture(mark);markTexture.colorSpace=THREE.SRGBColorSpace;this.textures.push(markTexture);
      const markMaterial=new THREE.MeshBasicMaterial({map:markTexture,transparent:true,opacity:.75,depthWrite:false});this.materials.push(markMaterial);
      add(shaker,geo('shaker-mark',()=>new THREE.PlaneGeometry(.025,.025)),markMaterial,0,.043,.026);
      shaker.userData.label=label;this.shakers.push(shaker);
    }
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=1024;const c=canvas.getContext('2d')!;c.fillStyle='#eee2c9';c.fillRect(0,0,768,1024);c.strokeStyle='#9d7658';c.lineWidth=4;c.strokeRect(28,28,712,968);c.strokeRect(39,39,690,946);c.textAlign='center';c.fillStyle='#655043';c.font='italic 30px Georgia';c.fillText('an evening at',384,125);c.font='bold 59px Georgia';c.fillText('TABLE FOR TWO',384,195);c.font='24px Georgia';c.fillText('DINNER',384,260);c.strokeStyle='#b79a7a';c.beginPath();c.moveTo(145,285);c.lineTo(623,285);c.stroke();
    [['ROASTED TOMATO RIGATONI','basil · parmesan'],['LEMON & HERB CHICKEN','roasted greens · jus'],['WILD MUSHROOM RISOTTO','thyme · aged cheese'],['SOMETHING SWEET','ask about tonight’s dessert']].forEach(([title,detail],i)=>{const y=370+i*145;c.font='bold 25px Georgia';c.fillText(title!,384,y);c.font='italic 22px Georgia';c.fillText(detail!,384,y+40);});c.font='italic 20px Georgia';c.fillText('made with care, shared with pleasure',384,945);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;this.textures.push(texture);const paper=new THREE.MeshStandardMaterial({map:texture,roughness:.96,side:THREE.DoubleSide});this.materials.push(paper);
    this.menu=add(this.root,geo('menu',()=>new THREE.PlaneGeometry(.23,.32)),paper,-.34,.783,-.75);this.menu.rotation.set(-Math.PI/2,0,-.17);
    const target=(name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,r:number)=>{const m=add(this.root,new THREE.BoxGeometry(sx,sy,sz),new THREE.MeshBasicMaterial({transparent:true,opacity:0,colorWrite:false,depthWrite:false}),x,y,z);this.materials.push(m.material as THREE.Material);m.userData.target=name;m.userData.inspectRadius=r;this.targets.push(m);return m;};
    target('glass',.49,.88,-.77,.16,.21,.16,.12);target('carafe',-.56,.96,-1.50,.17,.36,.17,.19);target('bread',.34,.85,-1.28,.25,.14,.2,.18);target('salt',.66,.84,-.91,.075,.12,.075,.09);target('pepper',.745,.84,-.91,.075,.12,.075,.09);target('cutlery',-.235,.82,-.64,.09,.09,.25,.16);target('lamp',-.20,.92,-1.12,.19,.28,.19,.18);target('vase',-.48,.95,-1.08,.16,.34,.16,.18);target('plate',0,.82,-.64,.32,.08,.32,.22);
  }
  setDoubleDate(enabled:boolean){this.solo.visible=!enabled;this.doubles.visible=enabled;}
  update(state:DinnerState,dt:number,reducedMotion=false){
    const tt=(state.evening as typeof state.evening & {tabletop?: {glassFill:number;salt:number|boolean;pepper:number|boolean;cutleryCrossed:boolean;napkinFolded:boolean;plateTurn:number;shared:{carafeFill:number;breadRemaining:number;lampLevel:number;vaseTurn:number};lastAction:{sequence:number;action:string;at:number}|null}}).tabletop;
    const double=!!state.doubleDate,x=double?(state.doubleDate!.localHumanId==='h1'?-.57:.57):0,z=double?-.32:-.64;
    const incidentOwner=state.doubleDate?.incidentOwner;
    const ownsIncident=!state.doubleDate||(incidentOwner ? incidentOwner===state.doubleDate.localHumanId : state.doubleDate.role!=='wingman');
    const ease=reducedMotion?1:1-Math.exp(-Math.max(dt,0)*8), spilled=ownsIncident&&state.evening.incident?.event==='spilled-drink';
    const toast=!!state.evening.care.toast&&state.elapsed-state.evening.care.toast.at>=0&&state.elapsed-state.evening.care.toast.at<2.8;
    const layout=dessertLayout(state);
    const glassesCleared=!!state.evening.scenarioCare?.cleanup.glassesCleared;
    this.playerGlass.position.x=glassesCleared?(double?Math.sign(x)*.70:.57):layout.park&&!double?.68:double?x+.25:.49;
    this.playerGlass.position.z=glassesCleared?(double?-1.0:-.65):layout.park&&!double?-.67:double?-.48:-.77;
    this.playerGlass.position.y=THREE.MathUtils.lerp(this.playerGlass.position.y,state.glassRaised||toast?1.05:.782,ease);
    this.playerGlass.rotation.z=THREE.MathUtils.lerp(this.playerGlass.rotation.z,spilled?-.95:state.glassRaised||toast?-.1:0,ease);
    const fill=tt ? THREE.MathUtils.clamp(tt.glassFill/4,0,1) : state.evening.care.water.status==='served'?1:.55;this.water.scale.y=Math.max(.001,fill);this.water.position.y=.01+.055*fill;this.water.visible=fill>.001;
    const cf=tt?THREE.MathUtils.clamp(tt.shared.carafeFill/6,0,1):.8;this.carafeWater.scale.y=Math.max(.001,cf);this.carafeWater.position.y=.01+.08*cf;this.carafeWater.visible=cf>.001;
    this.bread.forEach((b,i)=>b.visible=i<(tt?.shared.breadRemaining??4));const level=tt?.shared.lampLevel??2;this.lampLight.intensity=[.12,.42,.75][level]??.75;this.lampShade.emissiveIntensity=[.035,.13,.24][level]??.24;this.flame.visible=level>0;const vaseAngle=(tt?.shared.vaseTurn??0)*Math.PI/6;this.vase.rotation.y+=Math.atan2(Math.sin(vaseAngle-this.vase.rotation.y),Math.cos(vaseAngle-this.vase.rotation.y))*ease;
    const otherCare=state.doubleDate?.otherView?.evening.scenarioCare;
    for(const glass of this.dateGlasses){const care=glass.x===x?state.evening.scenarioCare:otherCare;const cleared=glass.double===double&&!!care?.cleanup.glassesCleared;
      glass.group.position.x=cleared?(double?Math.sign(glass.x)*.90:-.62):(glass.double?glass.x-.25:-.42);
      glass.group.position.z=cleared?(double?-1.7:-1.65):glass.z;
    }
    const otherTabletop=(state.doubleDate?.otherView?.evening as (typeof state.evening & {tabletop?: typeof tt}) | undefined)?.tabletop;
    for(const p of this.placeGroups){
      const active=p.group.parent===(double?this.doubles:this.solo)&&p.z===z;
      const placeState=active?(p.x===x?tt:double&&p.x===-x?otherTabletop:undefined):undefined;
      const placeEvening=p.x===x?state.evening:state.doubleDate?.otherView?.evening;
      const plateAngle=(placeState?.plateTurn??0)*Math.PI/6;p.plate.rotation.y+=Math.atan2(Math.sin(plateAngle-p.plate.rotation.y),Math.cos(plateAngle-p.plate.rotation.y))*ease;
      p.napkin.visible=!(active&&p.x===x);
      const crossed=!!placeState?.cutleryCrossed; const fork=p.cutlery.children[0]!,knife=p.cutlery.children[1]!;
      fork.position.x=crossed?-.035:-.235;fork.rotation.y=crossed?-.65:0;knife.position.x=crossed?.035:.22;knife.rotation.y=crossed?.65:0;
      p.napkin.rotation.y=placeState?.napkinFolded?.55:.12;p.napkin.scale.z=placeState?.napkinFolded?.65:1;
      p.salt.visible=!!placeState?.salt&&placeEvening?.main.status==='served';p.pepper.visible=!!placeState?.pepper&&placeEvening?.main.status==='served';
    }
    // The shared props respond to either human's most recent action, using scene time.
    const localAction=tt?.lastAction, remoteAction=otherTabletop?.lastAction;
    const remote=!!remoteAction&&(!localAction||remoteAction.at>localAction.at);
    const action=remote?remoteAction:localAction, age=action?state.elapsed-action.at:99;
    const beat=age>=0&&age<1.2&&!reducedMotion?Math.sin(Math.PI*age/1.2):0;
    const pouring=action?.action==='pour-water'?beat:0;
    this.carafe.rotation.z=-.42*pouring;this.carafe.position.y=.782+.055*pouring;
    this.carafe.position.x=(layout.dual?-.68:-.56)+.085*pouring;this.carafe.position.z=layout.dual?-1.0:-1.50;
    const actorX=remote?-x:x;
    this.shakers.forEach((shaker,i)=>{const shaking=action?.action===(i?'pepper-meal':'salt-meal')?beat:0;shaker.position.x=.66+i*.085+(actorX-(.66+i*.085))*.22*shaking;shaker.position.z=-.91+(z+.91)*.22*shaking;shaker.position.y=.7795+.065*shaking;shaker.rotation.z=shaking*Math.sin(age*28)*.3;});
    // Make room for the shared board or dessert without making table objects disappear.
    const boardEvening=state.doubleDate?.tableActivity && state.doubleDate.tableActivity.owner!==state.doubleDate.localHumanId ? state.doubleDate.otherView?.evening ?? state.evening : state.evening;
    const extraItems=[...(state.evening.scenarioCare?.extraOrder.items??[]),...(otherCare?.extraOrder.items??[])];
    const clear=['aiming','rolling'].includes(boardEvening.coasters.phase)||layout.own||layout.other||extraItems.some(item=>['served','shared','boxed'].includes(item.status))||!!state.evening.scenarioCare?.service.spaceCleared||!!otherCare?.service.spaceCleared;
    this.lamp.position.x=THREE.MathUtils.lerp(this.lamp.position.x,clear?(double?-.18:-.36):-.20,ease);this.lamp.position.z=THREE.MathUtils.lerp(this.lamp.position.z,clear?(double?-1.65:-1.88):-1.12,ease);
    this.basket.position.x=THREE.MathUtils.lerp(this.basket.position.x,layout.park?.45:clear?.50:.34,ease);this.basket.position.z=THREE.MathUtils.lerp(this.basket.position.z,layout.park?-.83:clear?-1.55:-1.28,ease);
    for(const t of this.targets){const n=t.userData.target;if(n==='glass')t.position.set(this.playerGlass.position.x,.88+this.playerGlass.position.y-.782,this.playerGlass.position.z);if(n==='plate')t.position.set(x,.82,z);if(n==='cutlery')t.position.set(x+(tt?.cutleryCrossed?-.035:-.235),.82,z);if(n==='carafe')t.position.set(this.carafe.position.x,.96+this.carafe.position.y-.782,this.carafe.position.z);if(n==='salt'||n==='pepper'){const shaker=this.shakers[n==='salt'?0:1]!;t.position.set(shaker.position.x,.84+shaker.position.y-.7795,shaker.position.z);}if(n==='lamp')t.position.set(this.lamp.position.x,.92,this.lamp.position.z);if(n==='bread')t.position.set(this.basket.position.x,.85,this.basket.position.z);t.visible=state.seated&&!state.evening.bill.settlement&&state.evening.scenario?.phase!=='active';}
  }
  dispose(){this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());}
}



