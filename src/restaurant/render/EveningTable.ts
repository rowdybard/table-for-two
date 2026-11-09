import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MENU } from '../content';
import type { DinnerState } from '../types';
import { castSpotShadow, receiveSpotShadow, tagContactShadow } from './PlaceSettingShadows';
import { createProceduralMaterial } from './ProceduralMaterials';
import { CLEARED_GLASS_DOUBLE, dessertLayout, SPILLED_GLASS } from './TabletopProps';
import { VENUE_ENV } from './VenueContract';

type FoodSurface = 'crumb' | 'sauce' | 'pasta' | 'roast' | 'rice' | 'cream' | 'cork' | 'leaf';
type FoodMaps = { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture };
/**
 * Small deterministic marks are authored in code; color maps tint the existing food colors. The marks depend
 * only on the kind, so every dish of a kind shares one set: colour at 256 px, roughness and relief at 128 px.
 */
function foodMaps(kind: FoodSurface): FoodMaps {
  const size = 256, make = (pixels: number) => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = pixels; const ctx = canvas.getContext('2d')!; ctx.scale(pixels / size, pixels / size); return { canvas, ctx }; };
  const albedo = make(size), surface = make(128), relief = make(128);
  albedo.ctx.fillStyle = '#f4f2ec'; albedo.ctx.fillRect(0, 0, size, size);
  surface.ctx.fillStyle = kind === 'sauce' || kind === 'cream' ? '#a0a0a0' : '#dedede'; surface.ctx.fillRect(0, 0, size, size);
  relief.ctx.fillStyle = '#808080'; relief.ctx.fillRect(0, 0, size, size);
  let seed = 1579 + kind.length * 719;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const count = kind === 'cork' ? 1200 : kind === 'cream' ? 160 : 650;
  for (let i = 0; i < count; i++) {
    const x = random() * size, y = random() * size, r = kind === 'cork' ? .6 + random() * 2.5 : .35 + random() * 1.2;
    const tone = kind === 'cork' ? 178 + Math.floor(random() * 65) : 205 + Math.floor(random() * 44);
    albedo.ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
    albedo.ctx.beginPath(); albedo.ctx.ellipse(x, y, kind === 'rice' ? r * 2.8 : r, r, kind === 'rice' ? random() * Math.PI : 0, 0, Math.PI * 2); albedo.ctx.fill();
    relief.ctx.fillStyle = i % 2 ? '#707070' : '#999999'; relief.ctx.beginPath(); relief.ctx.arc(x, y, r, 0, Math.PI * 2); relief.ctx.fill();
    surface.ctx.fillStyle = i % 2 ? '#bcbcbc' : '#ededed'; surface.ctx.fillRect(x, y, r * 2, r);
  }
  if (kind === 'pasta') for (let x = 0; x < size; x += 13) { albedo.ctx.fillStyle = '#c9c6bb33'; albedo.ctx.fillRect(x, 0, 2, size); relief.ctx.fillStyle = '#a5a5a5'; relief.ctx.fillRect(x, 0, 2, size); }
  if (kind === 'sauce' || kind === 'cream') for (let i = 0; i < 9; i++) {
    albedo.ctx.strokeStyle = '#fffefa22'; albedo.ctx.lineWidth = 2 + random() * 5; albedo.ctx.beginPath();
    albedo.ctx.moveTo(-20, i * 33); albedo.ctx.bezierCurveTo(70, i * 33 - 25, 180, i * 33 + 24, 276, i * 33 - 5); albedo.ctx.stroke();
  }
  if (kind === 'roast') for (let i = 0; i < 28; i++) { albedo.ctx.fillStyle = '#4b3d2a18'; albedo.ctx.beginPath(); albedo.ctx.ellipse(random() * size, random() * size, 4 + random() * 12, 1 + random() * 3, -.35, 0, Math.PI * 2); albedo.ctx.fill(); }
  if (kind === 'leaf') {
    for (const ctx of [albedo.ctx, relief.ctx]) {
      ctx.strokeStyle = ctx === albedo.ctx ? '#fffde94d' : '#b5b5b5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(256, 128);
      for (let x = 25; x < 245; x += 31) { ctx.moveTo(x, 128); ctx.lineTo(x - 22, 30); ctx.moveTo(x, 128); ctx.lineTo(x - 22, 226); } ctx.stroke();
    }
  }
  const texture = (canvas: HTMLCanvasElement, isColor: boolean) => { const t = new THREE.CanvasTexture(canvas); t.name = `authored-food-${kind}`; t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  return { map: texture(albedo.canvas, true), roughnessMap: texture(surface.canvas, false), bumpMap: texture(relief.canvas, false) };
}
function foodMaterial(color: string, kind: FoodSurface, cache: Map<FoodSurface, FoodMaps>) {
  let maps = cache.get(kind); if (!maps) { maps = foodMaps(kind); cache.set(kind, maps); }
  const material = new THREE.MeshStandardMaterial({ color, ...maps,
    roughness: kind === 'sauce' ? .43 : kind === 'cream' ? .58 : kind === 'leaf' ? .69 : .86, bumpScale: kind === 'cork' ? .0008 : kind === 'crumb' ? .00045 : .00018 });
  material.name = `authored-table-${kind}`; if (kind === 'leaf') material.side = THREE.DoubleSide;
  return material;
}

/** Pointed, cupped blade with a raised midrib, matching the former garnish's small footprint. */
function garnishLeaf(halfLength: number, halfWidth: number, curl: number) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const rows = 12, columns = 4;
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const t = row / rows, across = column / columns * 2 - 1;
    const width = Math.sin(Math.PI * t) ** .85 * halfWidth;
    positions.push((t * 2 - 1) * halfLength, Math.sin(Math.PI * t) * curl * (1 - Math.abs(across) * .78) + Math.pow(t, 3) * curl * .35, across * width);
    uv.push(t, column / columns);
    if (row < rows && column < columns) { const a = row * (columns + 1) + column, b = a + columns + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

/** A shallow, irregular smear follows the porcelain instead of reading as a thick disk. */
function sauceSmear() {
  const positions=[0,0,0], uv=[.5,.5], indices:number[]=[];
  const count=48;
  for(let i=0;i<count;i++){const a=i/count*Math.PI*2, r=.106*(1+.07*Math.sin(a*3+.4)+.035*Math.sin(a*7));positions.push(Math.cos(a)*r,0,Math.sin(a)*r);uv.push(.5+Math.cos(a)*r*4,.5+Math.sin(a)*r*4);}
  for(let i=0;i<count;i++)indices.push(0,(i+1)%count+1,i+1);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}

/**
 * The wine stain lies on open linen, never on paper or under a prop. Solo: between the plates, clear of the order ticket
 * and the bill folio. Double: beside the human's place, rotated lengthwise, clear of the menu and napkin. Its height sits
 * apart from the paper props (.783) and from a spilled-water puddle (.783-.7843), so overlapping decals never z-fight.
 */
const WINE_STAIN = { y: .7836, solo: { x: .04, z: -.96 }, double: { dx: .055, z: -.72 } } as const;
/**
 * The cleaning cloth lies beside the stain, never on it: in solo toward the bill, which arrives where a used cloth would
 * wait; in Double on the outer side of the lengthwise stain, between it and the table edge, clear of the napkin.
 */
const CLEANUP_CLOTH = { solo: { x: .29, z: -.86 }, double: { dx: .19, z: -.66 } } as const;
/** An offered taste rests on the date's plate, toward the human. */
const OFFERED_BITE = { dx: .105, y: .818, dz: .105 } as const;
/** Extra dishes in a 2x2 grid at the table centre, shifted left so the fourth stays clear of the bill folio at x .31. */
const EXTRA_SLOTS = { x: [-.155, .075], z: [-1.26, -1.04] } as const;

/** Visible courses and tabletop tools follow server state; this class never resolves an activity. */
export class EveningTable {
  readonly root = new THREE.Group();
  readonly targets: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly meals: THREE.Group[][] = [[], [], [], []];
  private readonly dessert = new THREE.Group();
  private readonly otherDessert = new THREE.Group();
  private readonly dessertVariants: THREE.Group[][] = [[], []];
  private readonly ticket = new THREE.Group();
  private readonly ticketCanvas: HTMLCanvasElement;
  private readonly ticketTexture: THREE.CanvasTexture;
  private ticketSignature = '';
  private readonly wineStain = new THREE.Group();
  private readonly extraOrders: { root: THREE.Group; serving: THREE.Group; carton: THREE.Group; dishes: THREE.Group[] }[] = [];
  private readonly cleanupCloth = new THREE.Group();
  private cleanupStain!: THREE.Mesh;
  private readonly offeredBites: THREE.Group[] = [];
  private readonly friendGlass = new THREE.Group();
  private friendWater!: THREE.Mesh;
  private readonly napkin: THREE.Mesh;
  private readonly napkinFold: THREE.Mesh;
  private readonly friendNapkin: THREE.Mesh;
  private readonly friendNapkinFold: THREE.Mesh;

  constructor() {
    const mat = (color: string, roughness = .8, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.push(m); return m; };
    const own = <T extends THREE.Material>(material: T) => { this.materials.push(material); return material; };
    const maps = new Map<FoodSurface, FoodMaps>(), food = (color: string, kind: FoodSurface) => own(foodMaterial(color, kind, maps));
    const cream = own(createProceduralMaterial('ceramic', '#eee3c8', { roughness: .42, bumpScale: .0002 })); cream.userData.venueEnv = VENUE_ENV.glaze;
    const brown = food('#78523a', 'roast'), gold = mat('#d2ad6a', .3, 1); gold.userData.venueEnv = VENUE_ENV.metal;
    const red = food('#a15a42', 'sauce'), pasta = food('#d6a053', 'pasta'), rice = food('#d1bc8f', 'rice');
    const roast = food('#c78b56', 'roast'), leaf = food('#547652', 'leaf'), softCream = food('#eee3c8', 'cream');
    const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m; };
    // Shared hollow ridged rigatoni geometry remains readable from the inspection camera.
    const pastaProfile: THREE.Vector2[] = [new THREE.Vector2(.008, -.022), new THREE.Vector2(.011, -.022)];
    for (let ridge = 0; ridge <= 8; ridge++) pastaProfile.push(new THREE.Vector2(ridge % 2 ? .0103 : .0112, -.022 + ridge * .0055));
    pastaProfile.push(new THREE.Vector2(.008, .022), new THREE.Vector2(.008, -.022));
    const rigatoni = new THREE.LatheGeometry(pastaProfile, 10);rigatoni.computeBoundingBox();
    const saucedPasta=own(pasta.clone()); saucedPasta.color.set('#bd7950');
    const sauceGeometry=sauceSmear();
    const grill=mat('#9a694c',.9), lemon=mat('#ebd787',.78), riceGrain=new THREE.CapsuleGeometry(.0013,.005,2,5);
    const mushroomShape=new THREE.Shape();mushroomShape.moveTo(-.017,0);mushroomShape.quadraticCurveTo(-.016,.013,0,.014);mushroomShape.quadraticCurveTo(.016,.013,.017,0);mushroomShape.lineTo(.006,0);mushroomShape.lineTo(.005,-.012);mushroomShape.quadraticCurveTo(0,-.014,-.005,-.012);mushroomShape.lineTo(-.006,0);mushroomShape.closePath();
    const mushroomGeometry=new THREE.ShapeGeometry(mushroomShape,8);
    const roastPiece = new THREE.SphereGeometry(1, 18, 12), grillMark = new THREE.BoxGeometry(.033, .0015, .0025);
    const rp=roastPiece.getAttribute('position');for(let i=0;i<rp.count;i++){const x=rp.getX(i),y=rp.getY(i),z=rp.getZ(i);rp.setXYZ(i,x*(1-.16*z+.045*Math.sin(z*6)),y*(.9+.08*z),z);}roastPiece.computeVertexNormals();roastPiece.computeBoundingBox();
    const parmesan = new THREE.BoxGeometry(.014, .0018, .007);
    const garnish = garnishLeaf(.033, .009, .008), riceMound = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI*2, 0, Math.PI/2), morsel = new THREE.SphereGeometry(1, 10, 8), herbGeometry = garnishLeaf(.025, .012, .005);
    for (let plate = 0; plate < 4; plate++) for (let meal = 0; meal < 3; meal++) {
      const group = new THREE.Group(); group.position.set(0, .782, plate % 2 === 0 ? -.64 : -1.67);
      if (meal === 0) {
        const sauce = mesh(group, sauceGeometry, red, 0, .014, 0); sauce.userData.course = true;
        for (let i = 0; i < 14; i++) { const a = i * 2.399, r = .018 + (i % 5) * .017 + (i % 3) * .003;
          const p = mesh(group, rigatoni, i%3===0?saucedPasta:pasta, Math.cos(a) * r, .033 + (i % 3) * .006, Math.sin(a) * r * .85);
          p.rotation.set(.65 + (i % 3) * .14, a, .55 + (i % 4) * .12);p.updateMatrix();const pastaBounds=rigatoni.boundingBox!.clone().applyMatrix4(p.matrix);p.position.y+=.012-pastaBounds.min.y+(i%4===3?.003:0);p.userData.bite = i; }
        for (let i = 0; i < 6; i++) { const a=i*2.1, r=.025+(i%3)*.025, shaving=mesh(group, parmesan, softCream, Math.cos(a)*r, .047 + (i%2)*.005, Math.sin(a)*r); shaving.rotation.y=a; shaving.userData.bite=i*2; }
        for (let i = 0; i < 2; i++) { const basil=mesh(group, herbGeometry, leaf, -.012+i*.03, .055, .015-i*.025); basil.rotation.y=i*1.4; basil.userData.bite=i*6; }
      } else if (meal === 1) {
        for (let i = 0; i < 3; i++) {
          // The roast pieces sit on the plate's well (.012), with their grill marks on top.
          const p = mesh(group, roastPiece, roast, (i - 1) * .038, .034 + i*.001, -.015 + i * .014); p.scale.set(.035 + i*.003, .022, .075 - i*.008); p.rotation.y = -.38+i*.1; p.userData.bite = i * 5;
          for (let j = 0; j < 3; j++) { const line = mesh(group, grillMark, grill, (i - 1) * .038, .053 + i*.001, -.04 + j * .022 + i * .014); line.rotation.y = -.38+i*.1; line.userData.bite = i * 5; }
        }
        for (let i = 0; i < 5; i++) { const p = mesh(group, garnish, leaf, -.065 + i * .03, .014, .078 + (i%2)*.014); p.rotation.y = (i - 2) * .45; p.userData.bite = i * 3; }
        const lemonWedge=mesh(group,new THREE.CylinderGeometry(.025,.025,.006,16,1,false,0,Math.PI*.7),lemon,.077,.017,.065); lemonWedge.rotation.y=.4;lemonWedge.userData.bite=8;
      } else {
        const mound = mesh(group, riceMound, rice, 0, .012, 0); mound.scale.set(.115, .035, .11); mound.userData.course = true;
        const grains=new THREE.InstancedMesh(riceGrain,rice,36), transform=new THREE.Object3D();
        for(let i=0;i<36;i++){const a=i*2.399,r=.018+(i%6)*.014,h=.012+.034*Math.sqrt(Math.max(0,1-(r/.11)**2));transform.position.set(Math.cos(a)*r,h,Math.sin(a)*r*.9);transform.rotation.set(Math.PI/2,0,a);transform.updateMatrix();grains.setMatrixAt(i,transform.matrix);} grains.userData.course=true;group.add(grains);
        for (let i=0;i<7;i++){const a=i*2.399+.3,r=.025+(i%4)*.018,h=.018+.034*Math.sqrt(Math.max(0,1-(r/.11)**2));const slice=mesh(group,mushroomGeometry,brown,Math.cos(a)*r,h,Math.sin(a)*r*.9);slice.rotation.set(-Math.PI/2,0,a);slice.userData.bite=i*2;}
      }
      const herb = mesh(group, herbGeometry, leaf, .025, meal===0?.052:meal===1?.055:.049, .018); herb.rotation.y = -.3; herb.userData.course = true;
      receiveSpotShadow(group); group.visible = false; this.meals[plate]!.push(group); this.root.add(group);
    }
    // One shared dessert plate with two spoons. Each dessert is its own small build; spoonfuls take pieces away.
    const plateGeometry=new THREE.CylinderGeometry(.125,.118,.012,28),dollopGeometry=new THREE.SphereGeometry(1,12,8),mintGeometry=garnishLeaf(.012,.006,.003);
    // A dessert spoon is one mesh lying flat on the plate: bowl and handle both touch the porcelain.
    const spoonParts=[new THREE.SphereGeometry(1,10,8).scale(.013,.005,.019).translate(0,.005,.045),new THREE.BoxGeometry(.008,.003,.075).translate(0,.0015,0)];
    const spoonGeometry=mergeGeometries(spoonParts)!;spoonParts.forEach(part=>part.dispose());
    const chocolate=food('#4a2a1f','crumb'),posset=own(new THREE.MeshStandardMaterial({color:'#f3e3a6',roughness:.5})),ramekin=own(new THREE.MeshStandardMaterial({color:'#d9e6e2',roughness:.05,transparent:true,opacity:.3,depthWrite:false,side:THREE.DoubleSide}));
    ramekin.userData.venueGlass=true;ramekin.userData.venueEnv=VENUE_ENV.glass;
    const shortbread=food('#dcc08a','crumb'),strawberry=food('#b8322f','sauce'),zest=mat('#e9d35c',.6);
    const makeDessert=(root:THREE.Group,variants:THREE.Group[])=>{
      const plate=mesh(root,plateGeometry,cream,0,.006,0);plate.userData.centralTray=true;castSpotShadow(plate);receiveSpotShadow(plate);
      tagContactShadow(plate,{rx:.15,rz:.15,opacity:.5,y0:.006});
      for(let side=0;side<2;side++){const spoon=new THREE.Group();spoon.position.set(side?.1:-.1,.012,side?.035:-.035);spoon.rotation.y=side?-.5:2.65;
        castSpotShadow(mesh(spoon,spoonGeometry,gold,0,0,0));root.add(spoon);}
      // Lemon posset: a glass ramekin of set cream, a shortbread finger and a curl of zest.
      const lemon=new THREE.Group();const cup=mesh(lemon,new THREE.CylinderGeometry(.036,.03,.04,20,1,true),ramekin,0,.032,0);cup.userData.course=true;
      const fill=mesh(lemon,new THREE.CylinderGeometry(.034,.029,.03,20),posset,0,.027,0);fill.userData.course=true;
      const finger=mesh(lemon,new THREE.BoxGeometry(.06,.009,.016),shortbread,.055,.0165,.02);finger.rotation.y=-.4;finger.userData.bite=1;
      const curl=mesh(lemon,new THREE.TorusGeometry(.007,.0018,5,10,4.5),zest,0,.044,0);curl.rotation.x=-Math.PI/2;curl.userData.bite=0;
      // Chocolate fondant: a dark dome, vanilla cream and mint.
      const fondant=new THREE.Group();const cake=mesh(fondant,new RoundedBoxGeometry(.062,.046,.062,2,.014),chocolate,0,.035,0);cake.userData.course=true;
      const dollop=mesh(fondant,dollopGeometry,softCream,.045,.024,.03);dollop.scale.set(.022,.012,.018);dollop.userData.bite=0;
      const mint=mesh(fondant,mintGeometry,leaf,.01,.0582,0);mint.rotation.y=.35;mint.userData.bite=2;
      // Strawberries and cream: halved berries around a soft dollop.
      const berries=new THREE.Group();const creamDollop=mesh(berries,dollopGeometry,softCream,0,.0275,0);creamDollop.scale.set(.03,.016,.026);creamDollop.userData.course=true;
      for(let i=0;i<6;i++){const a=i*1.05,berry=mesh(berries,dollopGeometry,strawberry,Math.cos(a)*.052,.0235,Math.sin(a)*.052);berry.scale.set(.016,.012,.013);berry.rotation.y=a;berry.userData.bite=i%4;}
      // Every piece is authored from the plate's top (.012), so the variants sit at the plate origin.
      for(const group of [lemon,fondant,berries]){receiveSpotShadow(group);group.visible=false;root.add(group);variants.push(group);}
      this.root.add(root);
    };
    makeDessert(this.dessert,this.dessertVariants[0]!);makeDessert(this.otherDessert,this.dessertVariants[1]!);
    // A spill stays on the linen as a small mark after the incident; it is a
    // view of the scenario state, rather than a second source of game state.
    const wine = own(new THREE.MeshStandardMaterial({color:'#692938',roughness:.4,transparent:true,opacity:.64,depthWrite:false}));
    const winePatch=sauceSmear();
    [[0,0,.12,.065],[.14,.04,.018,.012],[-.14,-.04,.013,.009]].forEach(([x,z,sx,sz]) => {
      const mark=mesh(this.wineStain,winePatch,wine,x!,WINE_STAIN.y,z!);mark.scale.set(sx!/.106,1,sz!/.106);
    });
    this.wineStain.visible = false; this.root.add(this.wineStain);
    // Actual extra courses, not a stack of empty placeholder plates. Each dish or
    // takeaway carton follows one server-owned order line and can be removed by service.
    const plateExtra=new THREE.CylinderGeometry(.102,.096,.008,24),rimExtra=new THREE.TorusGeometry(.098,.0025,5,24);
    const cartonMaterial=own(createProceduralMaterial('linen','#c5ad83',{roughness:.98,bumpScale:.0003}));
    const cartonBase=new THREE.BoxGeometry(.125,.052,.105),cartonLid=new RoundedBoxGeometry(.13,.012,.11,2,.004);
    const cb=cartonBase.getAttribute('position');for(let j=0;j<cb.count;j++)if(cb.getY(j)<0){cb.setX(j,cb.getX(j)*.84);cb.setZ(j,cb.getZ(j)*.84);}cartonBase.computeVertexNormals();
    const cartonBand=new THREE.BoxGeometry(.033,.0015,.108);
    for(let slot=0;slot<4;slot++){
      const root=new THREE.Group(),serving=new THREE.Group(),carton=new THREE.Group(),dishes:THREE.Group[]=[];
      root.position.set(EXTRA_SLOTS.x[slot%2]!, .782, EXTRA_SLOTS.z[slot<2?0:1]!);this.root.add(root);root.add(serving,carton);serving.position.y=-.012;carton.position.y=-.009;
      mesh(serving,plateExtra,cream,0,.016,0);const rim=mesh(serving,rimExtra,cream,0,.021,0);rim.rotation.x=Math.PI/2;
      for(let dish=0;dish<3;dish++){
        const food=new THREE.Group();serving.add(food);dishes.push(food);
        if(dish===0){const smear=mesh(food,sauceGeometry,red,0,.022,0);smear.scale.set(.82,1,.82);
          for(let n=0;n<6;n++){const a=n*2.4,p=mesh(food,rigatoni,n%3?saucedPasta:pasta,Math.cos(a)*.045,.036+(n%2)*.004,Math.sin(a)*.045);p.scale.setScalar(.85);p.rotation.set(.8,a,.65);p.updateMatrix();p.position.y+=.020-rigatoni.boundingBox!.clone().applyMatrix4(p.matrix).min.y;}}
        else if(dish===1){for(let n=0;n<2;n++){const p=mesh(food,roastPiece,roast,(n-.5)*.035,.034,0);p.scale.set(.034,.018,.061);p.rotation.y=-.25+n*.16;p.updateMatrix();p.position.y+=.020-roastPiece.boundingBox!.clone().applyMatrix4(p.matrix).min.y;}}
        else {const mound=mesh(food,riceMound,rice,0,.020,0);mound.scale.set(.075,.02,.07);for(let n=0;n<3;n++){const m=mesh(food,mushroomGeometry,brown,(n-1)*.023,.040,(n%2)*.018);m.scale.setScalar(.65);m.rotation.x=-Math.PI/2;}}
        const garnishMesh=mesh(food,herbGeometry,leaf,0,.048,.01);garnishMesh.scale.setScalar(.65);
      }
      mesh(carton,cartonBase,cartonMaterial,0,.035,0);mesh(carton,cartonLid,cartonMaterial,0,.066,0);mesh(carton,cartonBand,cream,0,.073,0);
      castSpotShadow(serving.children[0]!,serving.children[1]!,carton);receiveSpotShadow(root);tagContactShadow(root,{rx:.12,rz:.12,opacity:.5});
      root.visible=false;this.extraOrders.push({root,serving,carton,dishes});
    }
    const cleanFabric=own(createProceduralMaterial('linen','#e4d7be',{roughness:1,bumpScale:.0004}));
    mesh(this.cleanupCloth,new RoundedBoxGeometry(.105,.008,.075,2,.004),cleanFabric,0,.786,0);
    mesh(this.cleanupCloth,new RoundedBoxGeometry(.087,.004,.034,2,.002),cleanFabric,0,.793,-.017);
    this.cleanupStain=mesh(this.cleanupCloth,new THREE.CircleGeometry(.017,16),wine,0,.796,.012);this.cleanupStain.rotation.x=-Math.PI/2;
    receiveSpotShadow(this.cleanupCloth);tagContactShadow(this.cleanupCloth,{rx:.066,rz:.048,opacity:.4});
    this.cleanupCloth.visible=false;this.root.add(this.cleanupCloth);
    for (let pair = 0; pair < 2; pair++) {
      const bite = new THREE.Group();
      for (const material of [pasta, roast, rice]) {
        const morsel = mesh(bite, new THREE.SphereGeometry(1, 10, 8), material, 0, 0, 0);
        morsel.scale.set(.025, .012, .019);
      }
      receiveSpotShadow(bite); bite.visible = false; this.offeredBites.push(bite); this.root.add(bite);
    }
    const glass = own(new THREE.MeshStandardMaterial({ color: '#d8e7e2', roughness: .05, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide }));
    glass.userData.venueGlass = true; glass.userData.venueEnv = VENUE_ENV.glass;
    const water = own(new THREE.MeshStandardMaterial({ color: '#92b5ae', roughness: .05, transparent: true, opacity: .38, depthWrite: false }));
    water.userData.venueEnv = VENUE_ENV.water;
    const friendProfile = [[.038, 0], [.041, .006], [.047, .146], [.046, .15], [.043, .15], [.037, .012], [.034, .009], [0, .009]].map(([r,y]) => new THREE.Vector2(r, y));
    mesh(this.friendGlass, new THREE.LatheGeometry(friendProfile, 32), glass, 0, 0, 0);
    for (const [radius, y] of [[.046, .15], [.039, .006]]) { const rim = mesh(this.friendGlass, new THREE.TorusGeometry(radius, .002, 6, 32), glass, 0, y, 0); rim.rotation.x = Math.PI / 2; }
    this.friendWater = mesh(this.friendGlass, new THREE.CylinderGeometry(.043, .036, .08, 20), water, 0, .042, 0);
    tagContactShadow(this.friendGlass, { rx: .06, rz: .06, opacity: .45, cy: .075 });
    this.friendGlass.visible = false; this.root.add(this.friendGlass);
    const bellBase = mesh(this.root, new THREE.CylinderGeometry(.049, .055, .012, 20), gold, .61, .788, -1.13);
    const bell = mesh(this.root, new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold, .61, .793, -1.13); bell.scale.set(.04, .033, .04);
    const bellKnob = mesh(this.root, new THREE.CylinderGeometry(.008, .008, .016, 10), gold, .61, .835, -1.13);
    castSpotShadow(bellBase, bell, bellKnob); tagContactShadow(bellBase, { rx: .065, rz: .065, opacity: .45, y0: .006 });
    // A plain linen napkin at the player's place: it wipes a spill and folds, nothing more.
    const linen = own(createProceduralMaterial('linen', '#ebe2cc', { roughness: 1, bumpScale: .0004 }));
    this.napkin = mesh(this.root, new THREE.PlaneGeometry(.16, .16), linen, .39, .783, -.50); this.napkin.rotation.x = -Math.PI / 2; this.napkin.rotation.z = -.12; this.napkin.receiveShadow = true;
    this.napkinFold = mesh(this.napkin, new THREE.PlaneGeometry(.16, .08), linen, 0, .04, .002); this.napkinFold.visible = false;
    // In Double the friend's napkin lies where the friend sees their own, so both humans see each napkin in one place.
    this.friendNapkin = mesh(this.root, this.napkin.geometry, linen, -.84, .783, -.80); this.friendNapkin.rotation.x = -Math.PI / 2; this.friendNapkin.rotation.z = -.12; this.friendNapkin.receiveShadow = true;
    this.friendNapkinFold = mesh(this.friendNapkin, this.napkinFold.geometry, linen, 0, .04, .002); this.friendNapkinFold.visible = false; this.friendNapkin.visible = false;
    const ticketCanvas = document.createElement('canvas'); this.ticketCanvas = ticketCanvas; ticketCanvas.width = 256; ticketCanvas.height = 384;
    const tc = ticketCanvas.getContext('2d')!; tc.fillStyle = '#f4ead4'; tc.fillRect(0, 0, 256, 384); tc.fillStyle = '#4d4d38'; tc.font = 'bold 26px monospace'; tc.textAlign = 'center'; tc.fillText('TABLE 02', 128, 62); tc.font = '17px monospace'; tc.fillText('ORDER TICKET', 128, 105);
    tc.textAlign = 'left'; tc.font = '15px monospace'; ['DINNER SERVICE', '--------------------', '1  RIGATONI', '1  RISOTTO', '--------------------', 'THANK YOU'].forEach((line, i) => tc.fillText(line, 29, 150 + i * 33));
    const ticketTexture = new THREE.CanvasTexture(ticketCanvas); this.ticketTexture = ticketTexture; ticketTexture.colorSpace = THREE.SRGBColorSpace;
    const ticketMat = new THREE.MeshStandardMaterial({ map: ticketTexture, roughness: 1 }); this.materials.push(ticketMat);
    const ticket = mesh(this.ticket, new THREE.PlaneGeometry(.13, .2), ticketMat, .34, .783, -1.03); ticket.rotation.set(-Math.PI / 2, 0, -.16); ticket.receiveShadow = true; this.root.add(this.ticket);
    const target = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const m = mesh(this.root, new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }), x, y, z); m.userData.target = name; this.targets.push(m); };
    target('ticket', .34, .85, -1.03, .17, .1, .24); target('napkin', .30, .85, -.5, .24, .1, .24);
    target('dessert', .06, .86, -1.16, .3, .14, .3); target('service-bell', .61, .85, -1.13, .13, .15, .13); target('window', -6.43, 1.8, -.8, .16, 1.65, 2.6);
    target('meal', 0, .875, -.64, .34, .15, .34);
  }

  update(state: DinnerState) {
    const e = state.evening;
    const wingman = state.doubleDate?.role === 'wingman';
    const foreignIncident=!!state.doubleDate?.incidentOwner && state.doubleDate.incidentOwner!==state.doubleDate.localHumanId;
    const interactionEvening = wingman || foreignIncident ? state.doubleDate?.otherView?.evening ?? e : e;
    const doubleX = state.doubleDate ? (state.doubleDate.localHumanId === 'h1' ? -.57 : .57) : 0;
    const humanPlateZ = state.doubleDate ? -.32 : -.64;
    const datePlateZ = state.doubleDate ? -1.98 : -1.67;
    const scenario = state.doubleDate?.scenario ?? e.scenario;
    const scenarioView=state.doubleDate?.scenario?.target && state.doubleDate.scenario.target!==state.doubleDate.localHumanId ? state.doubleDate.otherView ?? state : state;
    const scenarioCare=scenarioView.evening.scenarioCare;
    this.wineStain.visible = scenarioCare?.cleanup.wine === 'wet' || (scenarioCare?.cleanup.wine !== 'clean' && !!scenario && ((scenario.id === 'wine-spill' && scenario.phase === 'active') || scenario.effects.wineStain));
    const stainX = state.doubleDate?.scenario?.target === 'h2' ? .57 : state.doubleDate ? -.57 : 0, stainSide = Math.sign(stainX);
    // In Double the stain runs lengthwise on the open linen between the menu and the napkin.
    this.wineStain.position.set(state.doubleDate ? stainX + stainSide * WINE_STAIN.double.dx : WINE_STAIN.solo.x, 0, state.doubleDate ? WINE_STAIN.double.z : WINE_STAIN.solo.z);
    this.wineStain.rotation.y = state.doubleDate ? Math.PI / 2 : 0;
    const items=scenarioCare?.extraOrder.items ?? [];
    this.extraOrders.forEach((extra,index)=>{const item=items[index];const status=item?.status;
      extra.root.visible=status==='served'||status==='shared'||status==='boxed';extra.serving.visible=status==='served'||status==='shared';extra.carton.visible=status==='boxed';
      const choice=Math.max(0,MENU.indexOf(item?.dish??''));extra.dishes.forEach((dish,i)=>dish.visible=i===choice);
    });
    const cloth=scenarioCare?.cleanup.cloth??'none';this.cleanupCloth.visible=cloth!=='none';this.cleanupStain.visible=cloth==='used';
    this.cleanupCloth.position.set(state.doubleDate?stainX+stainSide*CLEANUP_CLOTH.double.dx:CLEANUP_CLOTH.solo.x,0,state.doubleDate?CLEANUP_CLOTH.double.z:CLEANUP_CLOTH.solo.z);
    this.offeredBites.forEach((bite, pair) => {
      const view = pair === 0 ? state : state.doubleDate?.otherView;
      const offer = view?.evening.care.tasteOffer;
      bite.visible = !!offer && offer.result === 'accepted' && view?.evening.main.status === 'served' && !view?.evening.scenarioCare?.kitchen.held;
      bite.position.set((pair === 0 ? doubleX : -doubleX) + OFFERED_BITE.dx, OFFERED_BITE.y, datePlateZ + OFFERED_BITE.dz);
      const dish = Math.max(0, MENU.indexOf(offer?.dish || ''));
      bite.children.forEach((piece, index) => { piece.visible = index === dish; });
    });
    const friendEvening = state.doubleDate?.otherView?.evening;
    this.friendGlass.visible = !!state.doubleDate;
    const friendCleared=!!friendEvening?.scenarioCare?.cleanup.glassesCleared;
    // The friend's glass mirrors the local glass: same cleared spot on their side, same spilled pose.
    const friendSpilled = friendEvening?.incident?.event === 'spilled-drink' && (!state.doubleDate?.incidentOwner || state.doubleDate.incidentOwner!==state.doubleDate.localHumanId);
    this.friendGlass.position.set(friendCleared?Math.sign(-doubleX)*CLEARED_GLASS_DOUBLE.x:-doubleX+.25, friendSpilled ? SPILLED_GLASS.y : .782, friendCleared?CLEARED_GLASS_DOUBLE.z:-.48);
    this.friendGlass.rotation.z = friendSpilled ? SPILLED_GLASS.tilt : 0;
    const friendTabletop = (friendEvening as (typeof friendEvening & { tabletop?: { glassFill: number; napkinFolded?: boolean } }))?.tabletop;
    const friendWaterLevel = friendTabletop ? THREE.MathUtils.clamp(friendTabletop.glassFill / 4, 0, 1) : friendEvening?.care.water.status === 'served' ? 1 : .55;
    this.friendWater.scale.y = Math.max(.001, friendWaterLevel); this.friendWater.position.y = .002 + .04 * friendWaterLevel; this.friendWater.visible = friendWaterLevel > .001;
    for (let plate = 0; plate < 4; plate++) {
      const otherPair = plate >= 2;
      const view = otherPair ? state.doubleDate?.otherView : state;
      const course = view?.evening.main;
      const chosen = Math.max(0, MENU.indexOf((plate % 2 === 0 ? course?.servedDish || view?.order : course?.dateDish) || ''));
      this.meals[plate]!.forEach((group, index) => {
        group.position.set(otherPair ? -doubleX : doubleX, .782, plate % 2 === 0 ? humanPlateZ : datePlateZ);
        group.visible = !!course && course.status === 'served' && !view?.evening.scenarioCare?.kitchen.held && chosen === index;
        // A human's bite count belongs to their plate; it must not consume their date's meal.
        const bites=plate%2===0?(course?.bites??0):0;
        group.children.forEach(part => { part.visible = part.userData.bite === undefined || Number(part.userData.bite) >= bites * 4; if (part.userData.course) { part.userData.baseScaleY ??= part.scale.y; part.scale.y = part.userData.baseScaleY * Math.max(.15, 1 - bites * .22); } });
      });
    }
    const layout=dessertLayout(state), otherDessert=state.doubleDate?.otherView?.evening.dessert;
    this.dessert.visible=layout.own;this.otherDessert.visible=!!state.doubleDate&&layout.other;
    // Each human's napkin: Solo to the right of the place, Double at that human's outer corner of the table, seen alike by both.
    EveningTable.layNapkin(this.napkin, this.napkinFold, state.doubleDate ? Math.sign(doubleX) * .84 : .39, state.doubleDate ? -.80 : -.50, !!e.tabletop?.napkinFolded);
    this.friendNapkin.visible = !!state.doubleDate;
    if (state.doubleDate) EveningTable.layNapkin(this.friendNapkin, this.friendNapkinFold, -Math.sign(doubleX) * .84, -.80, !!friendTabletop?.napkinFolded);
    // Parked desserts leave the centre to extra dishes or to the other pair's dessert. A lone parked dessert goes right, clear of the carafe.
    const center=(other:boolean)=>{const side=other?-Math.sign(doubleX):Math.sign(doubleX);return {x:!layout.park?.06:layout.dual?(side<0?-.45:.47):state.doubleDate?.47:.53,z:layout.park?-1.55:-1.16};};
    const arrange=(root:THREE.Group,variants:THREE.Group[],value:typeof e.dessert|undefined,other:boolean)=>{
      const c=center(other);root.position.set(c.x,.782,c.z);
      const chosen=Math.max(0,['lemon','chocolate','berries'].indexOf(value?.choice??'')),bites=value?.bites??0;
      // Spoonfuls take real pieces away from the shared plate; the dessert is never hidden to fake progress.
      variants.forEach((variant,index)=>{variant.visible=index===chosen;variant.children.forEach(part=>{part.visible=part.userData.bite===undefined||Number(part.userData.bite)>=bites;if(part.userData.course){part.userData.baseScaleY??=part.scale.y;part.scale.y=part.userData.baseScaleY*Math.max(.2,1-bites*.2);}});});
    };
    arrange(this.dessert,this.dessertVariants[0]!,e.dessert,false);arrange(this.otherDessert,this.dessertVariants[1]!,otherDessert,true);
    this.ticket.visible = interactionEvening.incident?.event === 'wrong-order';
    this.ticket.position.set(state.doubleDate?-.34:0,0,state.doubleDate?.17:0);
    const ticketView = wingman || foreignIncident ? state.doubleDate?.otherView ?? state : state;
    const ticketName = state.doubleDate ? state.doubleDate.members.find(member => member.id === (wingman || foreignIncident ? (state.doubleDate!.localHumanId === 'h1' ? 'h2' : 'h1') : state.doubleDate!.localHumanId))?.name ?? 'GUEST' : 'GUEST';
    const ticketSignature = JSON.stringify([ticketName, ticketView.order, interactionEvening.main.dateDish]);
    if (ticketSignature !== this.ticketSignature) {
      this.ticketSignature = ticketSignature;
      const c=this.ticketCanvas.getContext('2d')!;c.fillStyle='#f4ead4';c.fillRect(0,0,256,384);c.fillStyle='#4d493d';c.textAlign='center';c.font='bold 22px monospace';c.fillText('TABLE FOR TWO',128,49);c.font='16px monospace';c.fillText('ORDER TICKET',128,82);
      c.textAlign='left';c.font='14px monospace';c.fillText('-------------------------',23,111);
      const print = (text:string,y:number) => { let size=16; c.font=`${size}px monospace`;while(c.measureText(text).width>210&&size>10){size--;c.font=`${size}px monospace`;}c.fillText(text,23,y); };
      print(ticketName.toUpperCase(),145);print('1  '+(ticketView.order || 'NOT ORDERED').toUpperCase(),177);print('DATE',225);print('1  '+(interactionEvening.main.dateDish || 'NOT ORDERED').toUpperCase(),257);
      c.font='14px monospace';c.fillText('-------------------------',23,294);c.textAlign='center';c.fillText('THANK YOU',128,337);this.ticketTexture.needsUpdate=true;
    }
    for (const target of this.targets) {
      const name = target.userData.target;
      if (name === 'meal') target.position.set(doubleX, .875, humanPlateZ);
      if (name === 'napkin') target.position.set(this.napkin.position.x, .85, this.napkin.position.z);
      if (name === 'ticket') target.position.set(.34+this.ticket.position.x,.85,-1.03+this.ticket.position.z);
      target.visible = name === 'window' || state.seated && scenario?.phase !== 'active' && (name === 'meal' ? !wingman && e.main.status === 'served' && !e.scenarioCare?.kitchen.held && !e.incident : name === 'ticket' ? this.ticket.visible : name === 'dessert' ? !wingman && this.dessert.visible && !e.scenarioCare?.kitchen.held : name === 'service-bell' ? interactionEvening.incident?.event === 'disruptive-diner' || (interactionEvening.incident?.event === 'wrong-order' && interactionEvening.incident.progress > 0) || (!interactionEvening.incident && (interactionEvening.care.water.status === 'none' || ((interactionEvening.tabletop?.shared.carafeFill ?? 6) === 0 && (interactionEvening.tabletop?.glassFill ?? 4) < 4)) && !interactionEvening.bill.requested) : name === 'napkin' && wingman ? interactionEvening.incident?.event === 'spilled-drink' : !interactionEvening.bill.settlement);
      if (name === 'dessert') { const c=center(false);target.position.set(c.x,.86,c.z); }
    }
  }

  private static layNapkin(napkin: THREE.Mesh, fold: THREE.Mesh, x: number, z: number, folded: boolean) {
    napkin.position.set(x, .783, z); napkin.scale.y = folded ? .62 : 1; napkin.rotation.z = folded ? .26 : -.12; fold.visible = folded;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>(), materials = new Set(this.materials);
    this.root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); const material = object.material as THREE.Material; materials.add(material); } if (object instanceof THREE.InstancedMesh) object.dispose(); });
    materials.forEach(material => { const m = material as THREE.MeshStandardMaterial; for (const texture of [m.map, m.roughnessMap, m.bumpMap, m.normalMap, m.metalnessMap, m.alphaMap, m.emissiveMap]) if (texture) textures.add(texture); });
    geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
  }
}

