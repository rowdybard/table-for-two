import * as THREE from 'three';
import type { TableFocus } from '../RestaurantRenderer';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MENU } from '../content';
import type { DinnerState } from '../types';
import { createProceduralMaterial } from './ProceduralMaterials';
import { dessertLayout } from './TabletopProps';

type FoodSurface = 'crumb' | 'sauce' | 'pasta' | 'roast' | 'rice' | 'cream' | 'cork' | 'leaf';
/** Small deterministic marks are authored in code; color maps tint the existing food colors. */
function foodMaterial(color: string, kind: FoodSurface) {
  const size = 256, make = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; return { canvas, ctx: canvas.getContext('2d')! }; };
  const albedo = make(), surface = make(), relief = make();
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
  const texture = (canvas: HTMLCanvasElement, isColor: boolean) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const material = new THREE.MeshStandardMaterial({ color, map: texture(albedo.canvas, true), roughnessMap: texture(surface.canvas, false), bumpMap: texture(relief.canvas, false),
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

/** Visible courses and tabletop tools follow server state; this class never resolves an activity. */
export class EveningTable {
  readonly root = new THREE.Group();
  readonly targets: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly meals: THREE.Group[][] = [[], [], [], []];
  private readonly dessert = new THREE.Group();
  private readonly otherDessert = new THREE.Group();
  private readonly portions: THREE.Group[] = [];
  private readonly otherPortions: THREE.Group[] = [];
  private readonly dessertColor = foodMaterial('#e2bd63', 'crumb');
  private readonly otherDessertColor = this.dessertColor.clone();
  private readonly coasterBoard = new THREE.Group();
  private readonly coasterStack = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly ring = new THREE.Group();
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
  private readonly napkinTexture: THREE.CanvasTexture;
  private readonly napkinCanvas = document.createElement('canvas');
  private napkinSignature = '';

  constructor() {
    const mat = (color: string, roughness = .8, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.push(m); return m; };
    const own = <T extends THREE.Material>(material: T) => { this.materials.push(material); return material; };
    const cream = own(createProceduralMaterial('ceramic', '#eee3c8', { roughness: .42, bumpScale: .0002 }));
    const brown = own(foodMaterial('#78523a', 'roast')), green = mat('#547652'), gold = mat('#bda16c', .35, .5);
    const red = own(foodMaterial('#a15a42', 'sauce')), pasta = own(foodMaterial('#d6a053', 'pasta')), rice = own(foodMaterial('#d1bc8f', 'rice'));
    const roast = own(foodMaterial('#c78b56', 'roast')), leaf = own(foodMaterial('#547652', 'leaf')), softCream = own(foodMaterial('#eee3c8', 'cream'));
    const frameWood = own(createProceduralMaterial('wood', '#78523a', { roughness: .72, bumpScale: .0006 }));
    const boardWood = own(createProceduralMaterial('wood', '#d4c29b', { roughness: .77, bumpScale: .00035 }));
    const greenCork = own(foodMaterial('#547652', 'cork')), brownCork = own(foodMaterial('#a27c51', 'cork'));
    this.materials.push(this.dessertColor,this.otherDessertColor);
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
          const p = mesh(group, roastPiece, roast, (i - 1) * .038, .031 + i*.001, -.015 + i * .014); p.scale.set(.035 + i*.003, .022, .075 - i*.008); p.rotation.y = -.38+i*.1; p.userData.bite = i * 5;
          for (let j = 0; j < 3; j++) { const line = mesh(group, grillMark, grill, (i - 1) * .038, .050 + i*.001, -.04 + j * .022 + i * .014); line.rotation.y = -.38+i*.1; line.userData.bite = i * 5; }
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
      group.visible = false; this.meals[plate]!.push(group); this.root.add(group);
    }
    const trayGeometry=new THREE.CylinderGeometry(.18,.18,.018,24),cakeGeometry=new RoundedBoxGeometry(.07,.043,.07,2,.012),dollopGeometry=new THREE.SphereGeometry(1,12,8),mintGeometry=garnishLeaf(.012,.006,.003);
    const makeDessert=(root:THREE.Group,portions:THREE.Group[],color:THREE.Material)=>{
      const tray=mesh(root,trayGeometry,cream,.06,.791,-1.16);tray.userData.centralTray=true;
      for(let piece=0;piece<4;piece++){const group=new THREE.Group();mesh(group,cakeGeometry,color,0,.02,0);
        const dollop=mesh(group,dollopGeometry,softCream,0,.047,0);dollop.scale.set(.025,.012,.02);
        const mint=mesh(group,mintGeometry,leaf,.01,.06,0);mint.rotation.y=.35;portions.push(group);root.add(group);}
      this.root.add(root);
    };
    makeDessert(this.dessert,this.portions,this.dessertColor);makeDessert(this.otherDessert,this.otherPortions,this.otherDessertColor);
    // A spill stays on the linen as a small mark after the incident; it is a
    // view of the scenario state, rather than a second source of game state.
    const wine = own(new THREE.MeshStandardMaterial({color:'#692938',roughness:.4,transparent:true,opacity:.64,depthWrite:false}));
    const winePatch=sauceSmear();
    [[0,0,.12,.065],[.14,.04,.018,.012],[-.14,-.04,.013,.009]].forEach(([x,z,sx,sz]) => {
      const mark=mesh(this.wineStain,winePatch,wine,x!, .784,z!);mark.scale.set(sx!/.106,1,sz!/.106);
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
      root.position.set(slot%2? .115:-.115, .782, slot<2?-1.26:-1.04);this.root.add(root);root.add(serving,carton);serving.position.y=-.012;carton.position.y=-.009;
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
      root.visible=false;this.extraOrders.push({root,serving,carton,dishes});
    }
    const cleanFabric=own(createProceduralMaterial('linen','#e4d7be',{roughness:1,bumpScale:.0004}));
    mesh(this.cleanupCloth,new RoundedBoxGeometry(.105,.008,.075,2,.004),cleanFabric,0,.786,0);
    mesh(this.cleanupCloth,new RoundedBoxGeometry(.087,.004,.034,2,.002),cleanFabric,0,.793,-.017);
    this.cleanupStain=mesh(this.cleanupCloth,new THREE.CircleGeometry(.017,16),wine,0,.796,.012);this.cleanupStain.rotation.x=-Math.PI/2;
    this.cleanupCloth.visible=false;this.root.add(this.cleanupCloth);
    for (let pair = 0; pair < 2; pair++) {
      const bite = new THREE.Group();
      for (const material of [pasta, roast, rice]) {
        const morsel = mesh(bite, new THREE.SphereGeometry(1, 10, 8), material, 0, 0, 0);
        morsel.scale.set(.025, .012, .019);
      }
      bite.visible = false; this.offeredBites.push(bite); this.root.add(bite);
    }
    const glass = own(new THREE.MeshStandardMaterial({ color: '#d8e7e2', roughness: .18, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }));
    const water = own(new THREE.MeshStandardMaterial({ color: '#92b5ae', roughness: .2, transparent: true, opacity: .31, depthWrite: false }));
    const friendProfile = [[.038, 0], [.041, .006], [.047, .146], [.046, .15], [.043, .15], [.037, .012], [.034, .009], [0, .009]].map(([r,y]) => new THREE.Vector2(r, y));
    mesh(this.friendGlass, new THREE.LatheGeometry(friendProfile, 32), glass, 0, 0, 0);
    for (const [radius, y] of [[.046, .15], [.039, .006]]) { const rim = mesh(this.friendGlass, new THREE.TorusGeometry(radius, .002, 6, 32), glass, 0, y, 0); rim.rotation.x = Math.PI / 2; }
    this.friendWater = mesh(this.friendGlass, new THREE.CylinderGeometry(.043, .036, .08, 20), water, 0, .042, 0);
    this.friendGlass.visible = false; this.root.add(this.friendGlass);
    mesh(this.coasterBoard, new RoundedBoxGeometry(.5, .025, .6, 2, .012), frameWood, .06, .7945, -1.16);
    mesh(this.coasterBoard, new THREE.BoxGeometry(.465, .005, .565), boardWood, .06, .8095, -1.16);
    for (const r of [.139, .0824, .0412]) {
      const ring = mesh(this.ring, new THREE.TorusGeometry(r, .002, 4, 24), r < .05 ? red : green, 0, 0, 0); ring.rotation.x = -Math.PI / 2;
    }
    this.coasterBoard.add(this.ring);
    this.disc = mesh(this.coasterBoard, new THREE.CylinderGeometry(.018, .018, .009, 20), greenCork, .06, .8165, -.94);
    for (let i = 0; i < 3; i++) mesh(this.coasterStack, new THREE.CylinderGeometry(.046, .046, .008, 20), i % 2 ? greenCork : brownCork, .68, .786 + i * .008, -1.31);
    this.coasterBoard.scale.set(.86,1,.78);this.coasterBoard.position.set(.06*(1-.86),0,-1.16*(1-.78));
    this.root.add(this.coasterBoard, this.coasterStack);
    mesh(this.root, new THREE.CylinderGeometry(.049, .055, .012, 20), gold, .61, .788, -1.13);
    const bell = mesh(this.root, new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold, .61, .793, -1.13); bell.scale.set(.04, .033, .04);
    mesh(this.root, new THREE.CylinderGeometry(.008, .008, .016, 10), gold, .61, .835, -1.13);
    this.napkinCanvas.width = 512; this.napkinCanvas.height = 512;
    this.napkinTexture = new THREE.CanvasTexture(this.napkinCanvas); this.napkinTexture.colorSpace = THREE.SRGBColorSpace;
    const paper = new THREE.MeshStandardMaterial({ map: this.napkinTexture, roughness: 1 }); this.materials.push(paper);
    this.napkin = mesh(this.root, new THREE.PlaneGeometry(.16, .16), paper, .40, .783, -.48); this.napkin.rotation.x = -Math.PI / 2; this.napkin.rotation.z = -.12;
    this.napkinFold = mesh(this.napkin, new THREE.PlaneGeometry(.16, .08), paper, 0, .04, .002); this.napkinFold.visible = false;
    const ticketCanvas = document.createElement('canvas'); this.ticketCanvas = ticketCanvas; ticketCanvas.width = 256; ticketCanvas.height = 384;
    const tc = ticketCanvas.getContext('2d')!; tc.fillStyle = '#f4ead4'; tc.fillRect(0, 0, 256, 384); tc.fillStyle = '#4d4d38'; tc.font = 'bold 26px monospace'; tc.textAlign = 'center'; tc.fillText('TABLE 02', 128, 62); tc.font = '17px monospace'; tc.fillText('ORDER TICKET', 128, 105);
    tc.textAlign = 'left'; tc.font = '15px monospace'; ['DINNER SERVICE', '--------------------', '1  RIGATONI', '1  RISOTTO', '--------------------', 'THANK YOU'].forEach((line, i) => tc.fillText(line, 29, 150 + i * 33));
    const ticketTexture = new THREE.CanvasTexture(ticketCanvas); this.ticketTexture = ticketTexture; ticketTexture.colorSpace = THREE.SRGBColorSpace;
    const ticketMat = new THREE.MeshStandardMaterial({ map: ticketTexture, roughness: 1 }); this.materials.push(ticketMat);
    const ticket = mesh(this.ticket, new THREE.PlaneGeometry(.13, .2), ticketMat, .34, .783, -1.03); ticket.rotation.set(-Math.PI / 2, 0, -.16); this.root.add(this.ticket);
    const target = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const m = mesh(this.root, new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, colorWrite: false, depthWrite: false }), x, y, z); m.userData.target = name; this.targets.push(m); };
    target('ticket', .34, .85, -1.03, .17, .1, .24); target('napkin', .30, .85, -.5, .24, .1, .24); target('coasters', .68, .86, -1.31, .18, .15, .18);
    target('dessert', .06, .86, -1.16, .38, .14, .38); target('service-bell', .61, .85, -1.13, .13, .15, .13); target('window', -6.43, 1.8, -.8, .16, 1.65, 2.6);
    target('meal', 0, .875, -.64, .34, .15, .34);
  }

  update(state: DinnerState, focus: TableFocus = null) {
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
    const stainX = state.doubleDate?.scenario?.target === 'h2' ? .57 : state.doubleDate ? -.57 : 0;
    this.wineStain.position.set(stainX + .17, 0, state.doubleDate ? -.72 : -.96);
    const items=scenarioCare?.extraOrder.items ?? [];
    this.extraOrders.forEach((extra,index)=>{const item=items[index];const status=item?.status;
      extra.root.visible=status==='served'||status==='shared'||status==='boxed';extra.serving.visible=status==='served'||status==='shared';extra.carton.visible=status==='boxed';
      const choice=Math.max(0,MENU.indexOf(item?.dish??''));extra.dishes.forEach((dish,i)=>dish.visible=i===choice);
    });
    const cloth=scenarioCare?.cleanup.cloth??'none';this.cleanupCloth.visible=cloth!=='none';this.cleanupStain.visible=cloth==='used';
    this.cleanupCloth.position.set(state.doubleDate?stainX+(stainX>0?-.20:.20):.29,0,state.doubleDate?-.75:-1.0);
    this.offeredBites.forEach((bite, pair) => {
      const view = pair === 0 ? state : state.doubleDate?.otherView;
      const offer = view?.evening.care.tasteOffer;
      bite.visible = !!offer && offer.result === 'accepted' && view?.evening.main.status === 'served' && !view?.evening.scenarioCare?.kitchen.held;
      bite.position.set((pair === 0 ? doubleX : -doubleX) + .085, .851, datePlateZ + .07);
      const dish = Math.max(0, MENU.indexOf(offer?.dish || ''));
      bite.children.forEach((piece, index) => { piece.visible = index === dish; });
    });
    const friendEvening = state.doubleDate?.otherView?.evening;
    this.friendGlass.visible = !!state.doubleDate;
    const friendCleared=!!friendEvening?.scenarioCare?.cleanup.glassesCleared;
    this.friendGlass.position.set(friendCleared?Math.sign(-doubleX)*.70:-doubleX+.25, .782, friendCleared?-1.0:-.48);
    this.friendGlass.rotation.z = friendEvening?.incident?.event === 'spilled-drink' && (!state.doubleDate?.incidentOwner || state.doubleDate.incidentOwner!==state.doubleDate.localHumanId) ? -.95 : 0;
    const friendTabletop = (friendEvening as (typeof friendEvening & { tabletop?: { glassFill: number } }))?.tabletop;
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
    const boardEvening = state.doubleDate?.tableActivity && state.doubleDate.tableActivity.owner !== state.doubleDate.localHumanId
      ? state.doubleDate.otherView?.evening ?? e : e;
    const board = boardEvening.coasters;
    const playingCoasters = ['aiming', 'rolling'].includes(board.phase) && !boardEvening.bill.requested;
    this.coasterBoard.visible = playingCoasters || focus === 'coasters'; this.coasterStack.visible = !this.coasterBoard.visible;
    this.disc.position.set(.06 + board.disc.x / .9 * .465, .8165, -1.16 + board.disc.z / 1.1 * .565);
    this.ring.position.set(.06 + board.target.x / .9 * .465, .814, -1.16 + board.target.z / 1.1 * .565);
    const layout=dessertLayout(state), otherDessert=state.doubleDate?.otherView?.evening.dessert;
    this.dessert.visible=layout.own&&focus!=='dessert';this.otherDessert.visible=!!state.doubleDate&&layout.other;
    this.napkin.visible = focus !== 'napkin';
    this.napkin.position.set(state.doubleDate ? Math.sign(doubleX) * .84 : .40, .783, state.doubleDate ? -.80 : -.48);
    const folded = !!e.tabletop?.napkinFolded; this.napkin.scale.y = folded ? .62 : 1; this.napkin.rotation.z = folded ? .26 : -.12; this.napkinFold.visible = folded;
    const shade=(choice:string|null|undefined)=>choice==='chocolate'?'#70412d':choice==='berries'?'#bd6251':'#e2bd63';
    this.dessertColor.color.set(shade(e.dessert.choice));this.otherDessertColor.color.set(shade(otherDessert?.choice));
    const center=(other:boolean)=>{const side=other?-Math.sign(doubleX):Math.sign(doubleX);return {x:layout.park?(layout.dual?(side<0?-.45:.47):.50):.06,z:layout.park?-1.55:-1.16};};
    const arrange=(root:THREE.Group,portions:THREE.Group[],value:typeof e.dessert|undefined,other:boolean)=>{
      const c=center(other),pairX=other?-doubleX:doubleX;root.children[0]!.position.set(c.x,.791,c.z);
      portions.forEach((portion,piece)=>{const assigned=value?.portions.find(p=>p.piece===piece);portion.visible=true;
        portion.position.set(assigned?pairX+(piece%2?.045:-.045):c.x+(piece%2?.065:-.065),assigned?.7955:.8015,assigned?(assigned.plate==='you'?humanPlateZ:datePlateZ)+(piece<2?-.04:.04):c.z+(piece<2?-.065:.065));});
    };
    arrange(this.dessert,this.portions,e.dessert,false);arrange(this.otherDessert,this.otherPortions,otherDessert,true);
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
    const signature = JSON.stringify([state.dateId, e.napkin.points, e.napkin.complete]);
    if (signature !== this.napkinSignature) {
      this.napkinSignature = signature;
      const c = this.napkinCanvas.getContext('2d')!; c.fillStyle = '#e9dfc5'; c.fillRect(0, 0, 512, 512); c.strokeStyle = '#bead8b'; c.lineWidth = 2; c.strokeRect(18, 18, 476, 476);
      // Warp and weft remain behind the unchanged authored and human pen strokes.
      for (let p = 2; p < 512; p += 5) { c.fillStyle = '#fffaf120'; c.fillRect(p, 0, 1, 512); c.fillStyle = '#958d7915'; c.fillRect(0, p, 512, 1); }
      c.strokeStyle = '#a36c55'; c.lineWidth = 5; c.beginPath();
      if (state.dateId === 'mira') { for (let i = 0; i <= 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? 40 : 82, x = 158 + Math.sin(a) * r, y = 230 + Math.cos(a) * r; if (!i) c.moveTo(x, y); else c.lineTo(x, y); } }
      else if (state.dateId === 'jules') { c.moveTo(100, 330); c.bezierCurveTo(120, 160, 240, 130, 260, 105); c.bezierCurveTo(270, 240, 150, 280, 100, 330); c.lineTo(230, 145); }
      else { c.arc(170, 230, 80, 0, Math.PI * 2); c.moveTo(90, 230); c.lineTo(250, 230); c.moveTo(170, 150); c.lineTo(170, 310); }
      c.stroke(); c.strokeStyle = '#3a6049'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath();
      e.napkin.points.forEach((point, i) => { if (i) c.lineTo(point[0] * 512, point[1] * 512); else c.moveTo(point[0] * 512, point[1] * 512); }); c.stroke(); this.napkinTexture.needsUpdate = true;
    }
    for (const target of this.targets) {
      const name = target.userData.target;
      if (name === 'meal') target.position.set(doubleX, .875, humanPlateZ);
      if (name === 'napkin') target.position.set(this.napkin.position.x, .85, this.napkin.position.z);
      if (name === 'ticket') target.position.set(.34+this.ticket.position.x,.85,-1.03+this.ticket.position.z);
      target.visible = name === 'window' || state.seated && scenario?.phase !== 'active' && (name === 'meal' ? !wingman && e.main.status === 'served' && !e.scenarioCare?.kitchen.held && !e.incident : name === 'ticket' ? this.ticket.visible : name === 'dessert' ? !wingman && this.dessert.visible : name === 'coasters' ? wingman ? !!state.doubleDate?.tableActivity && state.doubleDate.tableActivity.owner !== state.doubleDate.localHumanId : !!state.order && !e.bill.requested : name === 'service-bell' ? interactionEvening.incident?.event === 'disruptive-diner' || (interactionEvening.incident?.event === 'wrong-order' && interactionEvening.incident.progress > 0) || (!interactionEvening.incident && (interactionEvening.care.water.status === 'none' || ((interactionEvening.tabletop?.shared.carafeFill ?? 6) === 0 && (interactionEvening.tabletop?.glassFill ?? 4) < 4)) && !interactionEvening.bill.requested) : name === 'napkin' && wingman ? interactionEvening.incident?.event === 'spilled-drink' : !interactionEvening.bill.settlement);
      if (name === 'dessert') { const c=center(false);target.position.set(c.x,.86,c.z); }
      if (name === 'coasters') target.position.set(playingCoasters ? .06 : .68, .86, playingCoasters ? -1.16 : -1.31);
    }
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>(), materials = new Set(this.materials);
    this.root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); const material = object.material as THREE.Material; materials.add(material); } if (object instanceof THREE.InstancedMesh) object.dispose(); });
    materials.forEach(material => { const m = material as THREE.MeshStandardMaterial; for (const texture of [m.map, m.roughnessMap, m.bumpMap, m.normalMap, m.metalnessMap, m.alphaMap, m.emissiveMap]) if (texture) textures.add(texture); });
    geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
  }
}

