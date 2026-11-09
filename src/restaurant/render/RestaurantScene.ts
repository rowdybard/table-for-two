import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createProceduralMaterial, type SurfaceKind } from './ProceduralMaterials';
import { createBotanicalPlant, createLeafBladeGeometry } from './RestaurantFoliage';
import { applyEnvironmentSurface } from './EnvironmentAssets';
import { createNightExterior } from './NightExterior';
import { RestaurantPropKit } from './RestaurantPropKit';
import { dessertLayout, TabletopProps } from './TabletopProps';
import type { DinnerState } from '../types';

const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 24);
const ball = new THREE.SphereGeometry(1, 16, 12);
const white = new THREE.Color('#f5edda');

export interface RestaurantSet {
  root: THREE.Group;
  diningRoot: THREE.Group;
  targets: THREE.Object3D[];
  food: THREE.Group;
  menu: THREE.Mesh;
  bill: THREE.Group;
  spill: THREE.Group;
  playerGlass: THREE.Group;
  flame: THREE.Mesh;
  setDoubleDate(enabled: boolean): void;
  update(time: number, reducedMotion: boolean): void;
  updateTabletop(state: DinnerState, dt: number, reducedMotion?: boolean): void;
  dispose(): void;
}

class Builder {
  readonly root = new THREE.Group();
  readonly batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];
  mat(color: string, roughness = .82, metalness = 0) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(material);
    return material;
  }
  surface(kind: SurfaceKind, color: string, roughness = .85, metersPerTile?: number) {
    const material = createProceduralMaterial(kind, color, { roughness, metersPerTile });
    this.materials.push(material);
    for (const texture of [material.map, material.roughnessMap, material.bumpMap]) if (texture) this.textures.push(texture);
    applyEnvironmentSurface(material, kind, metersPerTile);
    return material;
  }
  add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rz = 0) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const transformed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    transformed.applyMatrix4(matrix);
    // Project at a consistent physical scale before batching. Dropping UVs would
    // erase every authored surface map, and stretching unit-box UVs would turn
    // linen into giant stripes on the larger tables and banquettes.
    const metersPerTile = material.userData.metersPerTile as number | undefined;
    const position = transformed.getAttribute('position'), normal = transformed.getAttribute('normal');
    const uv = new Float32Array(position.count * 2);
    if (metersPerTile) {
      for (let i = 0; i < position.count; i++) {
        const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        uv[i * 2] = (ny >= nx && ny >= nz ? x : nx > nz ? z : x) / metersPerTile;
        uv[i * 2 + 1] = (ny >= nx && ny >= nz ? z : y) / metersPerTile;
      }
    }
    transformed.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    transformed.deleteAttribute('uv1');
    const list = this.batches.get(material) ?? [];
    list.push(transformed);
    this.batches.set(material, list);
  }
  cube(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rz = 0) {
    this.add(box, mat, x, y, z, sx, sy, sz, ry, rz);
  }
  round(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, radius = .04, ry = 0) {
    const geometry = new RoundedBoxGeometry(sx, sy, sz, 2, radius);
    this.add(geometry, mat, x, y, z, 1, 1, 1, ry);
    geometry.dispose();
  }
  sphere(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    this.add(ball, mat, x, y, z, sx, sy, sz);
  }
  tube(mat: THREE.Material, x: number, y: number, z: number, radius: number, height: number) {
    this.add(cylinder, mat, x, y, z, radius, height, radius);
  }
  bake() {
    this.batches.forEach((geometries, mat) => {
      const combined = mergeGeometries(geometries, false);
      if (combined) {
        const mesh = new THREE.Mesh(combined, mat);
        mesh.name = `restaurant-${mat.name || 'solid-surface'}`;
        mesh.castShadow = mat.userData.shadowCaster !== false && !mat.transparent;
        mesh.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
        this.root.add(mesh);
      }
      geometries.forEach(geometry => geometry.dispose());
    });
    this.batches.clear();
  }
  sign(text: string, detail: string, x: number, y: number, z: number, width: number, height: number, background: string, ink: string, ry = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = Math.round(1024 * height / width);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    let fontSize = Math.round(canvas.height * .25);
    ctx.font = `500 ${fontSize}px Georgia, serif`;
    while (ctx.measureText(text).width > canvas.width - 100 && fontSize > 10) {
      fontSize -= 2;
      ctx.font = `500 ${fontSize}px Georgia, serif`;
    }
    ctx.fillText(text, 512, canvas.height * (detail ? .49 : .61));
    ctx.font = `${Math.round(canvas.height * .075)}px Arial, sans-serif`;
    ctx.fillText(detail, 512, canvas.height * .71);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.push(texture);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: .82 });
    this.materials.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.root.add(mesh);
    return mesh;
  }
}

export function createRestaurantScene(): RestaurantSet {
  const b = new Builder();
  const diningRoot = new THREE.Group(); diningRoot.name = 'dining-station'; b.root.add(diningRoot);
  const plaster = b.surface('plaster', '#e3d6c2', .95);
  const ceiling = b.surface('plaster', '#8f7a67', .95, .85);
  ceiling.userData.shadowCaster = false;
  const wood = b.surface('wood', '#816046', .77);
  const woodEdge = b.surface('wood', '#9b7454', .73);
  const green = b.surface('wood', '#76513d', .77, .9);
  const tileLight = b.surface('tile', '#c7c2b5', .76);
  const tileDark = b.surface('tile', '#9d9e94', .8);
  const burgundy = b.surface('velvet', '#92555e', .96);
  const burgundyLight = b.surface('velvet', '#ad7076', .95);
  const brass = b.mat('#b49c68', .38, .5);
  const dark = b.mat('#232d2d', .8);
  const linen = b.surface('linen', '#e9dfc7', .93);
  const ceramic = b.surface('ceramic', '#f5eddb', .5);
  const silver = b.mat('#b9b9ac', .27, .65);
  const leaf = b.mat('#4e6843');
  leaf.side = THREE.DoubleSide;
  const petal = b.mat('#dfa0aa', .88); petal.side = THREE.DoubleSide;
  const pot = b.surface('terracotta', '#b98164', .94);
  const soil = b.mat('#332e23', 1);
  const glassMat = new THREE.MeshStandardMaterial({ color: '#b8d5cc', roughness: .2, transparent: true, opacity: .22, depthWrite: false });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#92b5ae', roughness: .2, transparent: true, opacity: .31, depthWrite: false });
  const glow = new THREE.MeshBasicMaterial({ color: '#ffdb94' });
  const night = new THREE.MeshStandardMaterial({ color: '#253a4a', emissive: '#172d43', emissiveIntensity: .32, roughness: .3 });
  b.materials.push(glassMat, waterMat, glow, night);
  const props = new RestaurantPropKit(b.root);

  b.cube(wood, 0, -.12, 0, 13.5, .2, 14.5);
  for (let ix = 0; ix < 28; ix++) for (let iz = 0; iz < 30; iz++) {
    b.cube((ix + iz) % 2 ? tileLight : tileDark, (ix - 13.5) * .47, -.011, (iz - 14.5) * .47, .459, .025, .459);
  }
  b.cube(ceiling, 0, 3.48, 0, 13.5, .18, 14.5);
  for (const x of [-6.72, 6.72]) {
    if (x > 0) b.cube(plaster, x, 1.77, 0, .17, 3.5, 14.5);
    else {
      b.cube(plaster, x, .535, 0, .17, 1.07, 14.5);
      b.cube(plaster, x, 3.245, 0, .17, .55, 14.5);
      for (const [start, end] of [[-7.25, -6.21], [-3.09, -2.36], [.76, 1.64], [4.76, 7.25]])
        b.cube(plaster, x, 2.02, (start + end) / 2, .17, 1.9, end - start);
    }
    b.cube(green, x - Math.sign(x) * .09, .48, 0, .05, .95, 14.4);
    b.cube(woodEdge, x - Math.sign(x) * .13, .97, 0, .065, .07, 14.4);
  }
  b.cube(plaster, 0, .55, -7.22, 13.5, 1.1, .17);
  b.cube(plaster, 0, 3.26, -7.22, 13.5, .52, .17);
  for (const [start, end] of [[-6.75, -5.92], [-2.88, 2.88], [5.92, 6.75]])
    b.cube(plaster, (start + end) / 2, 2.05, -7.22, end - start, 1.9, .17);
  b.cube(green, 0, .48, -7.10, 13.5, .95, .07);
  b.cube(woodEdge, 0, .97, -7.04, 13.5, .07, .08);
  b.cube(plaster, -4.4, 1.77, 7.21, 4.7, 3.5, .17);
  b.cube(plaster, 4.4, 1.77, 7.21, 4.7, 3.5, .17);
  b.cube(wood, 0, 3.04, 7.15, 4.2, .75, .2);
  b.cube(wood, 0, 1.35, 7.12, 2.1, 2.7, .1);
  for (const side of [-1, 1]) {
    b.cube(night, side * .52, 1.65, 7.045, .88, 1.8, .035);
    b.cube(brass, side * .12, 1.15, 6.98, .025, .27, .035);
  }
  b.sign('Table for Two', '', 0, 2.95, 6.98, 2.15, .5, '#3c4e43', '#d4bd84', Math.PI);
  b.cube(burgundy, 0, .008, 5.95, 2.8, .02, 1.5);
  for (const x of [-1.28, 1.28]) b.cube(brass, x, .021, 5.95, .018, .004, 1.32);

  // Rain-blue windows provide cool contrast and depth against the warm interior.
  for (const z of [-4.65, -.8, 3.2]) {
    for (const edge of [-1, 1]) {
      b.cube(wood, -6.59, 2.02, z + edge * 1.615, .12, 2.1, .11);
      b.cube(wood, -6.59, 2.02 + edge * .995, z, .12, .11, 3.34);
    }
    b.cube(woodEdge, -6.45, 2.02, z, .05, 1.92, .055);
    b.cube(woodEdge, -6.45, 1.95, z, .05, .055, 3.16);
    b.cube(woodEdge, -6.44, 1.04, z, .28, .09, 3.4);
  }
  for (const x of [-4.4, 4.4]) {
    for (const edge of [-1, 1]) {
      b.cube(wood, x + edge * 1.575, 2.05, -7.07, .11, 2.1, .16);
      b.cube(wood, x, 2.05 + edge * 1.005, -7.07, 3.26, .11, .16);
    }
    b.cube(woodEdge, x, 2.05, -6.93, .055, 1.93, .06);
    b.cube(woodEdge, x, 1.98, -6.93, 3.08, .055, .06);
  }

  // Continuous burgundy booths down the sides; their footprints match the shared layout.
  for (const side of [-1, 1]) {
    const x = side * 4.8;
    b.round(burgundy, x, .28, 1, 1.16, .56, 4.76, .075);
    b.round(burgundyLight, x - side * .13, .5, 1, .93, .14, 4.75, .06);
    b.round(burgundy, x + side * .42, .91, 1, .3, .98, 4.8, .09);
    for (let z = -1.1; z < 3.3; z += .48) {
      b.cube(woodEdge, x + side * .585, .86, z, .025, .8, .027);
      b.sphere(brass, x - side * .44, .91, z, .01, .01, .01);
    }
    b.cube(wood, x, .12, 1, 1.12, .24, 4.7);
  }

  function chair(x: number, z: number, ry = 0, builder = b) {
    const local = (px: number, pz: number) => ({ x: x + px * Math.cos(ry) + pz * Math.sin(ry), z: z - px * Math.sin(ry) + pz * Math.cos(ry) });
    for (const sx of [-.2, .2]) for (const sz of [-.18, .18]) {
      const p = local(sx, sz);
      builder.cube(wood, p.x, .23, p.z, .045, .46, .045, ry);
    }
    builder.round(woodEdge, x, .455, z, .52, .1, .5, .04, ry);
    builder.round(burgundyLight, x, .51, z, .49, .085, .46, .035, ry);
    const back = local(0, -.23);
    builder.round(wood, back.x, .84, back.z, .53, .67, .09, .08, ry);
    const pad = local(0, -.172);
    builder.round(burgundy, pad.x, .88, pad.z, .45, .49, .055, .075, ry);
  }
  function table(x: number, z: number, radius: number, main = false, builder = b) {
    builder.tube(dark, x, .035, z, .35, .06);
    builder.tube(brass, x, .37, z, .055, .68);
    if (main) {
      const profile = [[0, 0], [radius - .025, 0], [radius, .014], [radius, .058], [radius - .015, .072], [0, .072]].map(([r, y]) => new THREE.Vector2(r, y));
      const top = new THREE.LatheGeometry(profile, 64);
      builder.add(top, woodEdge, x, .71, z); top.dispose();
    } else {
      builder.tube(wood, x, .723, z, radius, .08);
      builder.tube(linen, x, .77, z, radius + .018, .025);
    }
    const verts: number[] = [];
    const indices: number[] = [];
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const r = radius + .018 + (ring === 2 ? .025 : 0);
      verts.push(x + Math.sin(a) * r, .782 - (ring === 0 ? 0 : ring === 1 ? .045 : .22 + Math.cos(a * 8) * .025), z + Math.cos(a) * r);
    }
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 64; i++) {
      const p = ring * 65 + i;
      indices.push(p, p + 65, p + 1, p + 1, p + 65, p + 66);
    }
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    skirt.setIndex(indices);
    skirt.computeVertexNormals();
    if (!main) builder.add(skirt, linen, 0, 0, 0);
    skirt.dispose();
    if (!main) {
      builder.tube(ceramic, x, .8, z + .37, .16, .018);
      builder.tube(ceramic, x, .8, z - .37, .16, .018);
      builder.tube(brass, x + .2, .86, z, .04, .14);
      builder.sphere(glow, x + .2, .955, z, .014, .03, .014);
    }
  }
  const soloFurniture = new Builder(), doubleFurniture = new Builder();
  table(0, -1.15, .9, true, soloFurniture);
  chair(0, -2.25, 0, soloFurniture);
  chair(0, .1, Math.PI, soloFurniture);
  table(0, -1.15, 1.30, true, doubleFurniture);
  for (const x of [-.57, .57]) {
    chair(x, -2.5, 0, doubleFurniture);
    chair(x, .2, Math.PI, doubleFurniture);
  }
  soloFurniture.bake(); doubleFurniture.bake(); doubleFurniture.root.visible = false;
  diningRoot.add(soloFurniture.root, doubleFurniture.root);
  for (const x of [-3.5, 3.5]) {
    table(x, -3.5, .8);
    chair(x, -4.6);
    chair(x, -2.4, Math.PI);
  }
  for (const z of [-.15, 2.1]) {
    table(-3.38, z, .62);
    table(3.38, z, .62);
    chair(-2.4, z, -Math.PI / 2);
    chair(2.4, z, Math.PI / 2);
  }

  // Open service counter and shelves at the far end give the dining room a lived-in backdrop.
  b.round(wood, 0, .55, -5.7, 3.7, 1.1, .8, .025);
  b.round(woodEdge, 0, 1.12, -5.7, 3.85, .12, .9, .025);
  for (const x of [-1.35, -.45, .45, 1.35]) {
    b.round(wood, x, .56, -5.274, .84, .86, .03, .012);
    b.cube(brass, x + .28, .62, -5.249, .014, .18, .018);
  }
  b.cube(dark, 0, .07, -5.27, 3.57, .09, .02);
  b.cube(wood, 0, 1.94, -7.02, 3.5, 1.85, .12);
  b.cube(green, 0, 1.97, -6.94, 3.2, 1.6, .045);
  for (const y of [1.44, 2.05]) {
    b.round(woodEdge, 0, y, -6.68, 3.4, .065, .53, .012);
    b.cube(glow, 0, y - .038, -6.79, 2.98, .006, .012);
  }
  const barWash = new THREE.PointLight('#ffce9f', 1.15, 3, 2);
  barWash.position.set(0, 2.45, -5.68); b.root.add(barWash);
  const bottleMats = [b.mat('#52644c', .4), b.mat('#503a32', .4), b.mat('#a47b4c', .4)];
  const bottles = [
    [-1.39, 1.49, .24, .041], [-1.20, 1.49, .31, .050], [-1.00, 1.49, .20, .044],
    [.62, 1.49, .28, .049], [.81, 1.49, .22, .041], [1.33, 1.49, .32, .051],
    [-1.28, 2.1, .28, .047], [-1.07, 2.1, .22, .041], [.18, 2.1, .30, .048],
    [.39, 2.1, .25, .043], [1.32, 2.1, .23, .045],
  ];
  for (const [i, [x, y, height, radius]] of bottles.entries()) {
    b.tube(bottleMats[i % 3]!, x, y + height / 2, -6.69, radius, height);
    b.tube(bottleMats[i % 3]!, x, y + height + .037, -6.69, radius * .46, .074);
    b.tube(i % 3 ? dark : brass, x, y + height + .079, -6.69, radius * .48, .012);
    b.cube(linen, x, y + height * .47, -6.69 + radius + .001, radius * 1.1, height * .34, .003);
  }
  for (const [x, y] of [[-.52, 1.49], [-.35, 1.49], [.88, 2.1]]) {
    for (let glass = 0; glass < 2; glass++) {
      b.tube(glassMat, x, y + .05 + glass * .082, -6.69, .039, .095);
      b.tube(silver, x, y + .098 + glass * .082, -6.69, .0395, .0025);
    }
  }
  b.sign('Table for Two', '', 0, 2.97, -6.9, 3.75, .75, '#303b32', '#e4c994');
  for (const x of [-1.8, 1.8]) {
    b.cube(brass, x, 2.97, -6.85, .035, .78, .035);
    b.sphere(brass, x, 3.37, -6.85, .045, .045, .045);
  }

  function plant(x: number, z: number, index: number, height = 1.1) {
    const fallback = new THREE.Group();
    const vessel = new THREE.CylinderGeometry(.205, .154, .38, 32, 1, true);
    const body = new THREE.Mesh(vessel, pot); body.position.y = .2; fallback.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.202, .015, 6, 32), pot);
    rim.rotation.x = Math.PI / 2; rim.position.y = .385; fallback.add(rim);
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(.19, .19, .014, 24), soil);
    ground.position.y = .358; fallback.add(ground);
    const foliage = createBotanicalPlant(index % 2 ? 'parlor-palm' : 'rubber-tree', height, index * .7);
    fallback.add(foliage.root); b.materials.push(...foliage.materials); b.textures.push(...foliage.textures);
    props.place('plant', fallback, x, 0, z, index < 2 ? 1.55 : 1.3, index * 1.1);
  }
  [[-5.9, -6.3], [5.9, -6.3], [-5.95, 5.9], [5.9, 5.9]].forEach((p, i) => plant(p[0]!, p[1]!, i));

  function pendant(x: number, z: number) {
    b.tube(dark, x, 3.2, z, .012, .55);
    b.tube(brass, x, 2.9, z, .08, .1);
    const shade = new THREE.LatheGeometry([[.09, .20], [.15, .19], [.24, .12], [.30, .015], [.30, 0]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
    b.add(shade, ceramic, x, 2.64, z);
    shade.dispose();
    b.tube(glow, x, 2.65, z, .285, .018);
  }
  for (const p of [[0, -1.15], [-3.5, -3.5], [3.5, -3.5], [-3.38, 1.2], [3.38, 1.2]]) pendant(p[0]!, p[1]!);

  // Table props stay separate from the baked room so their appearance can follow dinner state.
  const tabletop = new TabletopProps();
  diningRoot.add(tabletop.root);
  const { menu, playerGlass, flame } = tabletop;

  const food = new THREE.Group();
  const pastaMat = b.mat('#c88b4d', .7);
  const sauce = b.mat('#944c32');
  for (const z of [-.64, -1.67]) {
    const dish = new THREE.Group();
    dish.userData.plate = z > -1 ? 'you' : 'date';
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(.14, .11, .045, 24), ceramic);
    bowl.position.set(0, .84, z);
    dish.add(bowl);
    const sauceMesh = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .012, 24), sauce);
    sauceMesh.position.set(0, .867, z);
    sauceMesh.userData.courseFood = true;
    dish.add(sauceMesh);
    for (let i = 0; i < 12; i++) {
      const piece = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .045, 6), pastaMat);
      const a = i * 2.4;
      piece.position.set(Math.cos(a) * .07 * (i % 3 / 3 + .3), .88 + (i % 2) * .01, z + Math.sin(a) * .07);
      piece.rotation.set(.8, a, .7);
      piece.userData.bitePiece = i;
      dish.add(piece);
    }
    const herb = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), leaf);
    herb.position.set(.02, .899, z);
    herb.scale.set(.032, .006, .015);
    herb.userData.courseFood = true;
    dish.add(herb);
    food.add(dish);
  }
  food.visible = false;
  diningRoot.add(food);
  const bill = new THREE.Group();
  const folio = new THREE.Mesh(new RoundedBoxGeometry(.17, .025, .25, 2, .012), wood);
  // Clear of the bread basket: the folio lies lengthwise across the right of the table.
  folio.position.set(.31, .795, -1.04);
  folio.rotation.y = Math.PI / 2;
  const receipt = new THREE.Mesh(new THREE.PlaneGeometry(.13, .18), ceramic);
  receipt.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  receipt.position.set(.31, .808, -1.04);
  bill.add(folio, receipt);
  bill.visible = false;
  diningRoot.add(bill);
  const spill = new THREE.Group();
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(.2, 24), waterMat);
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(.37, .783, -.98);
  puddle.scale.set(1, .65, 1);
  spill.add(puddle);
  spill.visible = false;
  diningRoot.add(spill);

  const targets: THREE.Object3D[] = [];
  function target(name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    hit.position.set(x, y, z);
    hit.userData.target = name;
    (name === 'exit' ? b.root : diningRoot).add(hit);
    targets.push(hit);
  }
  target('seat', 0, .61, .1, .65, .7, .65);
  target('menu', -.34, .83, -.75, .3, .1, .4);
  target('bill', .31, .85, -1.04, .30, .13, .24);
  target('exit', 0, 1.4, 6.95, 2.1, 2.8, .2);
  targets.push(...tabletop.targets);

  const exterior = createNightExterior();
  b.root.add(exterior.root);
  b.bake();
  return {
    root: b.root, diningRoot, targets, food, menu, bill, spill, playerGlass, flame,
    setDoubleDate(enabled) { soloFurniture.root.visible = !enabled; doubleFurniture.root.visible = enabled; tabletop.setDoubleDate(enabled); },
    update(time, reducedMotion) { exterior.update(time, reducedMotion); },
    updateTabletop(state, dt, reducedMotion) {
      tabletop.update(state, dt, reducedMotion);
      const x = state.doubleDate ? (state.doubleDate.localHumanId === 'h1' ? -.57 : .57) : 0;
      const parked=dessertLayout(state).park;
      menu.position.set(state.doubleDate ? (x>0&&parked?.03:Math.sign(x)*.36) : -.42, .783, state.doubleDate ? (x>0&&parked?-.62:-.76) : -.75);
      const menuTarget = targets.find(item => item.userData.target === 'menu');
      if (menuTarget) { menuTarget.position.set(menu.position.x, .83, menu.position.z); menuTarget.userData.inspectRadius = .2; }
    },
    dispose() {
      props.dispose(); exterior.dispose(); tabletop.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      b.root.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) geometries.add(object.geometry); if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(geometry => geometry.dispose());
      b.materials.forEach(mat => mat.dispose());
      targets.forEach(object => { if (object instanceof THREE.Mesh) (object.material as THREE.Material).dispose(); });
      b.textures.forEach(texture => texture.dispose());
    },
  };
}


