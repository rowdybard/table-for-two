import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DinnerState } from '../types';
import { createProceduralMaterial } from './ProceduralMaterials';
import { receiveShadows, tagContactShadow } from './PlaceSettingShadows';
import { GLOW_LINEAR, LAMP_SHADE_EMISSIVE, VENUE_ENV } from './VenueContract';

type ScenarioCare = NonNullable<DinnerState['evening']['scenarioCare']>;
const extrasOnTable = (care: ScenarioCare | undefined) => !!care?.extraOrder.items.some(item => item.status === 'served' || item.status === 'shared' || item.status === 'boxed');

/** Keep shared desserts and their supporting objects in distinct spaces. Extra dishes hold the centre, so a dessert parks beside them. */
export function dessertLayout(state: DinnerState) {
  const own=state.evening.dessert.status==='served',other=state.doubleDate?.otherView?.evening.dessert.status==='served';
  const dual=!!state.doubleDate&&own&&!!other;
  const extras=extrasOnTable(state.evening.scenarioCare)||extrasOnTable(state.doubleDate?.otherView?.evening.scenarioCare);
  return {own,other:!!other,dual,extras,park:dual||((own||!!other)&&extras)};
}

/**
 * Place-setting layout in setting-local metres. The diner sits on the +z side; settings across the table
 * are turned by PI, so every diner has the fork on their left and the napkin beyond it.
 */
export const PLACE_SETTING = {
  napkin: { x: -.305, y: .004, z: -.05, size: [.072, .008, .17] as const, foldedScaleZ: .55 },
  fork: { x: -.235, z: .013 }, knife: { x: .22, z: -.00575 }, spoon: { x: .265, z: .003 },
  /**
   * Finished: fork and knife parallel across the right of the plate, handles toward four o'clock. `d` is each piece's
   * distance from the plate centre and `along` slides it toward its handle, so a rigid piece bridges the well touching
   * the porcelain at both ends: the fork on the rising rim (clear of a risotto mound), the knife on the rim's crest.
   */
  rest: { yaw: .5, fork: { d: .12, along: .012, y: .0273 }, knife: { d: .152, along: 0, y: .029 } },
} as const;
/** Real proportions of the lathed dinner plate: well .012, rim .029, standing on its foot ring. */
const PLATE_PROFILE = [[0,.005],[.105,.005],[.126,.007],[.165,.016],[.182,.021],[.181,.027],[.171,.029],[.145,.023],[.125,.014],[.105,.012],[0,.012]] as const;
const PLATE_TOP = PLATE_PROFILE.slice(6).reverse();
/** Height of the plate's upper surface at radius r (setting-local). */
export function plateSurfaceY(r: number) {
  for (let i = 1; i < PLATE_TOP.length; i++) { const [r0, y0] = PLATE_TOP[i - 1]!, [r1, y1] = PLATE_TOP[i]!; if (r <= r1) return y0 + (y1 - y0) * Math.max(0, r - r0) / (r1 - r0); }
  return PLATE_TOP.at(-1)![1];
}
/** A knocked-over glass lies on its side; its flared body rests along the cloth. */
export const SPILLED_GLASS = { tilt: -(Math.PI / 2 - .04), y: .8245 } as const;
/** Outer silhouette of the water glass as radius, height pairs: base edge, foot ring, flared wall, rim ring. */
const GLASS_EDGE = [.038, 0, .041, .006, .047, .146, .0478, .15] as const;
/** Height of the glass origin above the cloth that keeps a glass tipped by `tilt` (about z) on its lowest edge while it tips or rights itself. */
export function glassRestLift(tilt: number) {
  const s = Math.abs(Math.sin(tilt)), c = Math.cos(tilt); let lift = 0;
  for (let i = 0; i < GLASS_EDGE.length; i += 2) lift = Math.max(lift, GLASS_EDGE[i]! * s - GLASS_EDGE[i + 1]! * c);
  return lift;
}
export const DOUBLE_DATE_GLASS_Z = -1.80;
/** Cleared Double glasses wait at the table's outer edge, clear of the carafe and of each other. */
export const CLEARED_GLASS_DOUBLE = { x: .78, z: -1.12 } as const;
/**
 * Lamp and bread-basket spots [x, z], the same in Solo and Double. Each move is a short slide over open linen: the lamp
 * steps back-left out of the extra-dish grid; the basket comes forward-right when a dessert parks at the far right, and
 * waits in that far-right corner when service clears the space.
 */
const SHARED_SPOTS = { lamp: { rest: [-.20, -1.12], clear: [-.37, -1.30] }, basket: { rest: [.34, -1.28], clear: [.50, -1.55], park: [.45, -.83] } } as const;

/** Home position beside the plate, or the finished pose resting across the rim. */
function layCutlery(piece: THREE.Object3D, home: { x: number; z: number }, rested: { d: number; along: number; y: number }, crossed: boolean) {
  const yaw = PLACE_SETTING.rest.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
  // The piece's handle points along its local +z, which the yaw turns to (sin, cos).
  if (crossed) { piece.position.set(c * rested.d + s * rested.along, rested.y, -s * rested.d + c * rested.along); piece.rotation.y = yaw; }
  else { piece.position.set(home.x, 0, home.z); piece.rotation.y = 0; }
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
  private readonly dateGlasses: { group: THREE.Group; x: number; z: number; double: boolean; held: number }[] = [];
  /** Where each date's own fork is (place-setting group → home, rim of the plate, or in their hand). */
  private readonly dateForks = new Map<THREE.Group, 'table' | 'plate' | 'hand'>();
  private readonly heldPoint = new THREE.Vector3();
  private readonly heldAxis = new THREE.Vector3();
  private readonly vase = new THREE.Group();
  private readonly lampLight: THREE.PointLight;
  private readonly lampShade: THREE.MeshStandardMaterial;
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  constructor() {
    const mat = (color: string, roughness = .7, metalness = 0) => { const m = new THREE.MeshStandardMaterial({color, roughness, metalness}); this.materials.push(m); return m; };
    const surface = (kind: 'ceramic'|'linen', color: string, scale: number) => { const m = createProceduralMaterial(kind, color, { roughness: kind === 'ceramic' ? .38 : .95, bumpScale: scale }); this.materials.push(m); for (const t of [m.map,m.bumpMap,m.roughnessMap]) if (t) this.textures.push(t); return m; };
    const ceramic = surface('ceramic', '#f4ead7', .0004), linen = surface('linen', '#b87678', .0005);
    ceramic.userData.venueEnv = VENUE_ENV.glaze;
    const steel = mat('#d9d8d3', .2, 1), gold = mat('#d2ad6a', .3, 1), dark = mat('#544c3a');
    steel.userData.venueEnv = gold.userData.venueEnv = VENUE_ENV.metal;
    const glass = new THREE.MeshStandardMaterial({color:'#daeae5',roughness:.05,metalness:.08,transparent:true,opacity:.14,depthWrite:false,side:THREE.DoubleSide});
    glass.userData.venueGlass = true; glass.userData.venueEnv = VENUE_ENV.glass;
    const water = new THREE.MeshStandardMaterial({color:'#9ec6c1',roughness:.05,transparent:true,opacity:.38,depthWrite:false});
    water.userData.venueEnv = VENUE_ENV.water;
    this.materials.push(glass,water);
    const cork = mat('#b9996e', .95), crust = mat('#b77a42', .9), crumb = mat('#e5c78e', 1), green = mat('#536c47', .9), pink = mat('#df9aa4', .83), yellow = mat('#c89b54', .8);
    const geo = (key:string, make:()=>THREE.BufferGeometry) => { let g=this.geometry.get(key); if(!g){g=make();this.geometry.set(key,g);} return g; };
    const add = (parent:THREE.Object3D,g:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0) => {const o=new THREE.Mesh(g,m);o.position.set(x,y,z); parent.add(o); return o;};
    const profile = (pts: readonly (readonly number[])[]) => pts.map(p=>new THREE.Vector2(p[0]!,p[1]!));
    const lathe = (key:string, pts:readonly (readonly number[])[], seg=32) => geo(key,()=>new THREE.LatheGeometry(profile(pts),seg));
    const ring = (parent:THREE.Object3D,r:number,t:number,y:number,material:THREE.Material) => {const o=add(parent,geo(`ring${r}:${t}`,()=>new THREE.TorusGeometry(r,t,6,32)),material,0,y,0);o.rotation.x=Math.PI/2;return o;};
    /** Bake transformed parts into one geometry (one draw); the temporary parts are released. */
    const merged = (key: string, parts: () => THREE.BufferGeometry[]) => geo(key, () => { const list = parts(); const g = mergeGeometries(list)!; list.forEach(part => part.dispose()); g.computeBoundingBox(); g.computeBoundingSphere(); return g; });
    const placed = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    const flatTorus = (r: number, t: number, y: number) => placed(new THREE.TorusGeometry(r, t, 6, 32), 0, y, 0, 1, 1, 1, Math.PI / 2);
    // Flatware is 6 mm thick and lies on the cloth; each piece is one mesh centred on its footprint.
    const handle = (z: number) => placed(new THREE.CapsuleGeometry(.009, .12, 3, 8), 0, .003, z, 1, 1, 1 / 3, Math.PI / 2);
    const centred = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); const b = g.boundingBox!; return g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); };
    const combine = (parts: THREE.BufferGeometry[]) => { const g = mergeGeometries(parts)!; parts.forEach(part => part.dispose()); return centred(g); };
    const forkGeo = merged('fork', () => [combine([handle(.037), placed(new THREE.BoxGeometry(.035, .005, .025), 0, .0025, -.045), ...[0, 1, 2, 3].map(i => placed(new THREE.BoxGeometry(.004, .004, .046), (i - 1.5) * .009, .002, -.077))])]);
    const knifeGeo = merged('knife', () => [combine([handle(.038), placed(new THREE.BoxGeometry(.022, .004, .105), 0, .002, -.066, 1, 1, 1, 0, -.035)])]);
    const spoonGeo = merged('spoon', () => [combine([handle(.036), placed(new THREE.SphereGeometry(1, 12, 8), 0, .0035, -.072, .014, .0035, .027)])]);
    const plateGeo = merged('plate', () => [new THREE.LatheGeometry(profile(PLATE_PROFILE), 48), flatTorus(.098, .004, .004)]);
    // The two gold rim marks are painted on: they follow the rim's slope, a fraction of a millimetre proud of the glaze,
    // so cutlery resting across the rim lies on the porcelain rather than on them, whichever way the plate is turned.
    const markR = .163, markSlope = Math.atan2(plateSurfaceY(markR + .006) - plateSurfaceY(markR - .006), .012);
    const plateMarkGeo = merged('plate-mark', () => [-.006, .006].map(dx => placed(new THREE.BoxGeometry(.003, .0002, .012), dx, plateSurfaceY(markR) + .00025, -markR, 1, 1, 1, markSlope, dx * 4, 0)));
    const napkinGeo = geo('napkin', () => new THREE.BoxGeometry(...PLACE_SETTING.napkin.size));
    const foldGeo = geo('napkin-fold', () => new THREE.BoxGeometry(PLACE_SETTING.napkin.size[0] - .006, .004, PLACE_SETTING.napkin.size[2] / 2));
    const grainGeo = geo('grain', () => new THREE.SphereGeometry(.0018, 5, 4));
    const place = (parent:THREE.Group,x:number,z:number) => {
      const group=new THREE.Group();group.position.set(x,.782,z);if(z<-1.15)group.rotation.y=Math.PI;parent.add(group);
      const plate=new THREE.Group();group.add(plate);
      const body=add(plate,plateGeo,ceramic);receiveShadows(body);receiveShadows(add(plate,plateMarkGeo,gold));
      tagContactShadow(plate,{rx:.2,rz:.2,opacity:.55});
      // Seasoning settles on the plate's sloping rim, beyond the food.
      const seasoning=(material:THREE.Material,seed:number) => {const grains=new THREE.InstancedMesh(grainGeo,material,18), transform=new THREE.Object3D();for(let i=0;i<18;i++){const a=i*2.4+seed,r=.12+(i%5)*.006;transform.position.set(Math.cos(a)*r,plateSurfaceY(r)+.0016,Math.sin(a)*r);transform.updateMatrix();grains.setMatrixAt(i,transform.matrix);}grains.visible=false;plate.add(grains);return grains;};
      const salt=seasoning(ceramic,0),pepper=seasoning(dark,1);
      const n=PLACE_SETTING.napkin,napkin=new THREE.Group(); napkin.position.set(n.x,n.y,n.z);group.add(napkin);
      add(napkin,napkinGeo,linen);add(napkin,foldGeo,linen,0,n.size[1]/2+.002,-.02);receiveShadows(napkin);
      tagContactShadow(napkin,{rx:.045,rz:.095,opacity:.5,y0:n.y});
      const cutlery=new THREE.Group();group.add(cutlery);
      const s=PLACE_SETTING;
      const fork=add(cutlery,forkGeo,steel,s.fork.x,0,s.fork.z),knife=add(cutlery,knifeGeo,steel,s.knife.x,0,s.knife.z),spoon=add(cutlery,spoonGeo,steel,s.spoon.x,0,s.spoon.z);
      tagContactShadow(fork,{rx:.024,rz:.11,opacity:.45});tagContactShadow(knife,{rx:.017,rz:.12,opacity:.45});tagContactShadow(spoon,{rx:.019,rz:.11,opacity:.45});
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
      tagContactShadow(group,{rx:.06,rz:.06,opacity:.45,cy:.075});
      return w;};
    this.water=makeGlass(this.playerGlass);this.playerGlass.position.set(.49,.782,-.77);this.root.add(this.playerGlass);
    const dateGlass=new THREE.Group();makeGlass(dateGlass); dateGlass.position.set(-.42,.782,-1.7);this.solo.add(dateGlass);this.dateGlasses.push({group:dateGlass,x:0,z:-1.7,double:false,held:0});
    for(const x of [-.57,.57]) {const g=new THREE.Group();makeGlass(g);g.position.set(x-.25,.782,DOUBLE_DATE_GLASS_Z);this.doubles.add(g);this.dateGlasses.push({group:g,x,z:DOUBLE_DATE_GLASS_Z,double:true,held:0});}
    // The carafe uses a hollow profile and a separate finite water volume.
    const carafe=this.carafe;carafe.position.set(-.56,.782,-1.50);this.shared.add(carafe);
    add(carafe,lathe('carafe',[[.045,0],[.062,.012],[.064,.14],[.055,.205],[.031,.265],[.028,.30],[.034,.31],[.031,.315],[.024,.3],[.026,.265],[.05,.20],[.058,.14],[.056,.018],[.043,.008]],40),glass);
    ring(carafe,.032,.002,.313,glass);this.carafeWater=add(carafe,geo('carafe-water',()=>new THREE.CylinderGeometry(.056,.056,.16,28)),water,0,.09,0);
    tagContactShadow(carafe,{rx:.075,rz:.075,opacity:.5,cy:.127});
    // Brass stem, translucent woven shade and warm practical light.
    const lamp=this.lamp;lamp.position.set(-.20,.782,-1.12);this.shared.add(lamp);
    add(lamp,lathe('lamp',[[0,0],[.047,0],[.049,.009],[.037,.019],[.018,.03],[.012,.12],[.025,.13]],32),gold);
    this.lampShade=surface('linen','#f4dfbd',.0004);this.lampShade.side=THREE.DoubleSide;this.lampShade.emissive.set('#c68c51');this.lampShade.emissiveIntensity=LAMP_SHADE_EMISSIVE[2];
    add(lamp,geo('shade',()=>new THREE.CylinderGeometry(.053,.085,.105,32,1,true)),this.lampShade,0,.165,0);add(lamp,merged('shade-rings',()=>[flatTorus(.085,.002,.112),flatTorus(.053,.002,.217)]),gold);
    const glow=new THREE.MeshBasicMaterial({toneMapped:false});glow.color.setRGB(...GLOW_LINEAR);this.materials.push(glow);this.flame=add(lamp,geo('bulb',()=>new THREE.SphereGeometry(.015,12,8)),glow,0,.155,0);
    this.lampLight=new THREE.PointLight('#ffd6a5',.75,1.7,2);this.lampLight.position.set(0,.16,0);lamp.add(this.lampLight);
    tagContactShadow(lamp,{rx:.06,rz:.06,opacity:.55});
    // Low floral arrangement keeps faces clear. One mesh per material: vase, stems and leaves, petals, hearts.
    this.vase.position.set(-.48,.782,-1.08);this.shared.add(this.vase);
    const stems:THREE.BufferGeometry[]=[],petals:THREE.BufferGeometry[]=[],hearts:THREE.BufferGeometry[]=[];
    for(let i=0;i<3;i++){const x=(i-1)*.025;stems.push(placed(new THREE.CylinderGeometry(.002,.002,.17,7),(i-1)*.018,.195,0,1,1,1,0,0,(i-1)*.12),placed(new THREE.SphereGeometry(1,10,7),x,.19,.01,.032,.007,.012,0,0,(i-1)*.4));
      for(let p=0;p<5;p++){const a=p*Math.PI*2/5;petals.push(placed(new THREE.SphereGeometry(1,10,7),x+Math.cos(a)*.017,.285+Math.sin(a)*.017,0,.014,.021,.006,0,0,a-Math.PI/2));}
      hearts.push(placed(new THREE.SphereGeometry(1,10,7),x,.285,.007,.008,.008,.005));}
    const vaseParts=[add(this.vase,lathe('vase',[[0,0],[.045,0],[.055,.018],[.057,.075],[.045,.12],[.032,.145],[.034,.15],[.028,.15],[.027,.13]],32),ceramic),
      add(this.vase,merged('vase-stems',()=>stems),green),add(this.vase,merged('vase-petals',()=>petals),pink),add(this.vase,merged('vase-hearts',()=>hearts),yellow)];
    receiveShadows(vaseParts[0]!);tagContactShadow(this.vase,{rx:.07,rz:.07,opacity:.55});
    // Cork basket and hand-scored rolls. Only the roll bodies cast; the scoring is surface detail.
    const basket=this.basket;basket.position.set(.34,.782,-1.28);this.shared.add(basket);
    const weave=add(basket,merged('basket',()=>[new THREE.LatheGeometry(profile([[0,0],[.105,0],[.115,.015],[.13,.055],[.125,.06],[.11,.02],[0,.012]]),32),flatTorus(.126,.004,.055)]),cork);
    receiveShadows(weave);tagContactShadow(basket,{rx:.14,rz:.14,opacity:.5});
    const scoreGeo=merged('scores',()=>[-1,0,1].map(j=>placed(new THREE.BoxGeometry(.004,.002,.043),j*.018,.026,0,1,1,1,0,.25,0)));
    for(let i=0;i<4;i++){const roll=new THREE.Group();roll.position.set((i%2-.5)*.09,.045,(Math.floor(i/2)-.5)*.065);basket.add(roll);const bread=add(roll,geo('roll',()=>new THREE.SphereGeometry(1,16,10)),crust);bread.scale.set(.055,.027,.038);add(roll,scoreGeo,crumb);receiveShadows(roll);this.bread.push(roll);}
    for(const [i,label] of ['SALT','PEPPER'].entries()){
      const shaker=new THREE.Group();shaker.position.set(.66+i*.085,.7795,-.91);this.shared.add(shaker);
      const body=add(shaker,geo('shaker',()=>new THREE.CylinderGeometry(.023,.027,.075,16)),ceramic,0,.04,0);
      const top=add(shaker,geo('shaker-top',()=>new THREE.CylinderGeometry(.023,.023,.009,16)),steel,0,.081,0);
      receiveShadows(body);
      const holes=new THREE.InstancedMesh(geo('shaker-hole',()=>new THREE.CylinderGeometry(.0015,.0015,.0007,7)),dark,5), dot=new THREE.Object3D();
      for(let n=0;n<5;n++){const a=n*Math.PI*2/5;dot.position.set(Math.cos(a)*.009,.086,Math.sin(a)*.009);dot.updateMatrix();holes.setMatrixAt(n,dot.matrix);}shaker.add(holes);
      const mark=document.createElement('canvas');mark.width=mark.height=128;const ink=mark.getContext('2d')!;ink.fillStyle='#66594e';ink.textAlign='center';ink.textBaseline='middle';ink.font='bold 82px Georgia';ink.fillText(i?'P':'S',64,70);
      const markTexture=new THREE.CanvasTexture(mark);markTexture.colorSpace=THREE.SRGBColorSpace;this.textures.push(markTexture);
      const markMaterial=new THREE.MeshBasicMaterial({map:markTexture,transparent:true,opacity:.75,depthWrite:false});this.materials.push(markMaterial);
      add(shaker,geo('shaker-mark',()=>new THREE.PlaneGeometry(.025,.025)),markMaterial,0,.043,.026);
      shaker.userData.label=label;tagContactShadow(shaker,{rx:.03,rz:.03,opacity:.45,y0:-.0025,cy:.047});this.shakers.push(shaker);
    }
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=1024;const c=canvas.getContext('2d')!;c.fillStyle='#eee2c9';c.fillRect(0,0,768,1024);c.strokeStyle='#9d7658';c.lineWidth=4;c.strokeRect(28,28,712,968);c.strokeRect(39,39,690,946);c.textAlign='center';c.fillStyle='#655043';c.font='italic 30px Georgia';c.fillText('an evening at',384,125);c.font='bold 59px Georgia';c.fillText('TABLE FOR TWO',384,195);c.font='24px Georgia';c.fillText('DINNER',384,260);c.strokeStyle='#b79a7a';c.beginPath();c.moveTo(145,285);c.lineTo(623,285);c.stroke();
    [['ROASTED TOMATO RIGATONI','basil · parmesan'],['LEMON & HERB CHICKEN','roasted greens · jus'],['WILD MUSHROOM RISOTTO','thyme · aged cheese'],['SOMETHING SWEET','ask about tonight’s dessert']].forEach(([title,detail],i)=>{const y=370+i*145;c.font='bold 25px Georgia';c.fillText(title!,384,y);c.font='italic 22px Georgia';c.fillText(detail!,384,y+40);});c.font='italic 20px Georgia';c.fillText('made with care, shared with pleasure',384,945);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;this.textures.push(texture);const paper=new THREE.MeshStandardMaterial({map:texture,roughness:.96,side:THREE.DoubleSide});this.materials.push(paper);
    this.menu=add(this.root,geo('menu',()=>new THREE.PlaneGeometry(.23,.32)),paper,-.34,.783,-.75);this.menu.rotation.set(-Math.PI/2,0,-.17);this.menu.receiveShadow=true;
    const target=(name:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,r:number)=>{const m=add(this.root,new THREE.BoxGeometry(sx,sy,sz),new THREE.MeshBasicMaterial({visible:false,transparent:true,opacity:0,colorWrite:false,depthWrite:false}),x,y,z);this.materials.push(m.material as THREE.Material);m.userData.target=name;m.userData.inspectRadius=r;this.targets.push(m);return m;};
    target('glass',.49,.88,-.77,.16,.21,.16,.12);target('carafe',-.56,.96,-1.50,.17,.36,.17,.19);target('bread',.34,.85,-1.28,.25,.14,.2,.18);target('salt',.66,.84,-.91,.075,.12,.075,.09);target('pepper',.745,.84,-.91,.075,.12,.075,.09);target('cutlery',-.235,.82,-.64,.09,.09,.25,.16);target('lamp',-.20,.92,-1.12,.19,.28,.19,.18);target('vase',-.48,.95,-1.08,.16,.34,.16,.18);target('plate',0,.82,-.64,.32,.08,.32,.22);
  }
  /** The date's own glass for a seat (pair x; Solo is 0), or undefined when that table is not in use. */
  private dateGlassAt(pairX:number,double:boolean){return this.dateGlasses.find(glass=>glass.double===double&&(!double||glass.x===pairX));}
  /** World position of a date's glass where it stands on the cloth. */
  dateGlassRest(pairX:number,double:boolean,out:THREE.Vector3){const glass=this.dateGlassAt(pairX,double);if(!glass)return null;
    out.set(glass.group.position.x,.782,glass.group.position.z);glass.group.parent!.updateWorldMatrix(true,false);return glass.group.parent!.localToWorld(out);}
  /**
   * The date lifts their glass: `weight` 0 leaves it standing, 1 puts it at `world` tipped by `tilt` toward `toward`.
   * Presentation only; the glass is never emptied or moved for gameplay.
   */
  holdDateGlass(pairX:number,double:boolean,held:{weight:number;position:THREE.Vector3;tilt:number;toward:THREE.Vector3}|null){
    const glass=this.dateGlassAt(pairX,double);if(!glass)return;
    glass.held=held?.weight??0;if(!held||held.weight<=0){glass.group.position.y=.782;glass.group.quaternion.identity();return;}
    const parent=glass.group.parent!;parent.updateWorldMatrix(true,false);
    const rest=this.heldPoint.set(glass.group.position.x,.782,glass.group.position.z);
    const lifted=parent.worldToLocal(this.heldAxis.copy(held.position));
    glass.group.position.lerpVectors(rest,lifted,held.weight);
    // Tip the rim toward the drinker's mouth: rotate about the horizontal axis perpendicular to the way they face.
    const toward=parent.worldToLocal(this.heldPoint.copy(held.toward)).sub(glass.group.position);toward.y=0;
    if(toward.lengthSq()>1e-6){toward.normalize();glass.group.quaternion.setFromAxisAngle(this.heldAxis.set(0,1,0).cross(toward).normalize(),held.tilt*held.weight);}
  }
  setDateFork(pairX:number,double:boolean,where:'table'|'plate'|'hand'){
    for(const p of this.placeGroups)if(p.z<-1.15&&p.group.parent===(double?this.doubles:this.solo)&&(!double||p.x===pairX))this.dateForks.set(p.group,where);
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
    this.playerGlass.position.x=glassesCleared?(double?Math.sign(x)*CLEARED_GLASS_DOUBLE.x:.57):layout.park&&!double?.68:double?x+.25:.49;
    this.playerGlass.position.z=glassesCleared?(double?CLEARED_GLASS_DOUBLE.z:-.65):layout.park&&!double?-.67:double?-.48:-.77;
    this.playerGlass.rotation.z=THREE.MathUtils.lerp(this.playerGlass.rotation.z,spilled?SPILLED_GLASS.tilt:state.glassRaised||toast?-.1:0,ease);
    // Tipping over (or back) rolls on the glass's lowest edge instead of swinging its foot through the cloth.
    this.playerGlass.position.y=Math.max(THREE.MathUtils.lerp(this.playerGlass.position.y,spilled?SPILLED_GLASS.y:state.glassRaised||toast?1.05:.782,ease),.782+glassRestLift(this.playerGlass.rotation.z));
    const fill=tt ? THREE.MathUtils.clamp(tt.glassFill/4,0,1) : state.evening.care.water.status==='served'?1:.55;this.water.scale.y=Math.max(.001,fill);this.water.position.y=.01+.055*fill;this.water.visible=fill>.001;
    const cf=tt?THREE.MathUtils.clamp(tt.shared.carafeFill/6,0,1):.8;this.carafeWater.scale.y=Math.max(.001,cf);this.carafeWater.position.y=.01+.08*cf;this.carafeWater.visible=cf>.001;
    this.bread.forEach((b,i)=>b.visible=i<(tt?.shared.breadRemaining??4));const level=tt?.shared.lampLevel??2;this.lampLight.intensity=[.12,.42,.75][level]??.75;this.lampShade.emissiveIntensity=LAMP_SHADE_EMISSIVE[level]??LAMP_SHADE_EMISSIVE[2];this.flame.visible=level>0;const vaseAngle=(tt?.shared.vaseTurn??0)*Math.PI/6;this.vase.rotation.y+=Math.atan2(Math.sin(vaseAngle-this.vase.rotation.y),Math.cos(vaseAngle-this.vase.rotation.y))*ease;
    const otherCare=state.doubleDate?.otherView?.evening.scenarioCare;
    for(const glass of this.dateGlasses){const care=glass.x===x?state.evening.scenarioCare:otherCare;const cleared=glass.double===double&&!!care?.cleanup.glassesCleared;
      glass.group.position.x=cleared?(double?Math.sign(glass.x)*.90:-.62):(glass.double?glass.x-.25:-.42);
      glass.group.position.z=cleared?(double?-1.7:-1.65):glass.z;
      // A glass the date is drinking from follows their hand (holdDateGlass); otherwise it stands on the cloth.
      if(!glass.held){glass.group.position.y=.782;glass.group.quaternion.identity();}
    }
    const otherTabletop=(state.doubleDate?.otherView?.evening as (typeof state.evening & {tabletop?: typeof tt}) | undefined)?.tabletop;
    const s=PLACE_SETTING,rest=s.rest;
    for(const p of this.placeGroups){
      const active=p.group.parent===(double?this.doubles:this.solo)&&p.z===z;
      const placeState=active?(p.x===x?tt:double&&p.x===-x?otherTabletop:undefined):undefined;
      const placeEvening=p.x===x?state.evening:state.doubleDate?.otherView?.evening;
      const plateAngle=(placeState?.plateTurn??0)*Math.PI/6;p.plate.rotation.y+=Math.atan2(Math.sin(plateAngle-p.plate.rotation.y),Math.cos(plateAngle-p.plate.rotation.y))*ease;
      // The place-setting napkin is the dates'. Each human's own napkin is EveningTable's linen one, which both Double observers see alike.
      p.napkin.visible=!active;
      // Crossed means finished: fork and knife lie side by side across the rim; the spoon keeps its place.
      const crossed=!!placeState?.cutleryCrossed; const fork=p.cutlery.children[0]!,knife=p.cutlery.children[1]!;
      // A date's fork moves to the rim once they start eating, and is in their hand during a bite.
      const dateFork=this.dateForks.get(p.group)??'table';
      layCutlery(fork,s.fork,rest.fork,crossed||dateFork==='plate');layCutlery(knife,s.knife,rest.knife,crossed);
      fork.visible=dateFork!=='hand';
      p.napkin.scale.z=placeState?.napkinFolded?s.napkin.foldedScaleZ:1;
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
    // Make room without making table objects disappear. The shared dessert plate fits between the lamp and the bread;
    // extra dishes take the centre and a cleared space empties it, so the lamp steps aside; a parked dessert takes the basket's corner.
    const spaceCleared=!!state.evening.scenarioCare?.service.spaceCleared||!!otherCare?.service.spaceCleared;
    const lampSpot=layout.extras||spaceCleared?SHARED_SPOTS.lamp.clear:SHARED_SPOTS.lamp.rest, basketSpot=layout.park?SHARED_SPOTS.basket.park:spaceCleared?SHARED_SPOTS.basket.clear:SHARED_SPOTS.basket.rest;
    this.lamp.position.x=THREE.MathUtils.lerp(this.lamp.position.x,lampSpot[0],ease);this.lamp.position.z=THREE.MathUtils.lerp(this.lamp.position.z,lampSpot[1],ease);
    this.basket.position.x=THREE.MathUtils.lerp(this.basket.position.x,basketSpot[0],ease);this.basket.position.z=THREE.MathUtils.lerp(this.basket.position.z,basketSpot[1],ease);
    for(const t of this.targets){const n=t.userData.target;if(n==='glass')t.position.set(this.playerGlass.position.x,.88+this.playerGlass.position.y-.782,this.playerGlass.position.z);if(n==='plate')t.position.set(x,.82,z);if(n==='cutlery'){if(tt?.cutleryCrossed)t.position.set(x+.11,.82,z-.06);else t.position.set(x+s.fork.x,.82,z);}if(n==='carafe')t.position.set(this.carafe.position.x,.96+this.carafe.position.y-.782,this.carafe.position.z);if(n==='salt'||n==='pepper'){const shaker=this.shakers[n==='salt'?0:1]!;t.position.set(shaker.position.x,.84+shaker.position.y-.7795,shaker.position.z);}if(n==='lamp')t.position.set(this.lamp.position.x,.92,this.lamp.position.z);if(n==='bread')t.position.set(this.basket.position.x,.85,this.basket.position.z);t.visible=state.seated&&!state.evening.bill.settlement&&state.evening.scenario?.phase!=='active';}
  }
  dispose(){this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.geometry.forEach(g=>g.dispose());this.targets.forEach(t=>t.geometry.dispose());}
}
