import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterKind } from './CharacterBody';

const PI = Math.PI;
const TAU = 2 * PI;
const mix = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type Guide = (t: number) => THREE.Vector3;
type SkullSurface = (angle: number, y: number) => THREE.Vector3;

function randomStream(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Eight independently combed tufts. Full density at the roots, separate fibres at the tips.
// All characters use the same cutout atlas, including in the depth pass.
let atlas: THREE.CanvasTexture | undefined;
let hairlineMask: THREE.CanvasTexture | undefined;
let atlasOwners = 0;
function acquireAtlas() {
  atlasOwners++;
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const random = randomStream(839041);
  for (let slot = 0; slot < 8; slot++) {
    const left = (slot % 4) * 128,
      top = Math.floor(slot / 4) * 256;
    for (let i = 0; i < 238; i++) {
      const u = random() * 2 - 1,
        jitter = random(),
        wave = random() * TAU;
      const length = 0.78 + 0.2 * random() - 0.08 * Math.abs(u);
      const first = 0.055 * random() + 0.02 * Math.abs(u);
      const value = Math.round(125 + 117 * random());
      ctx.strokeStyle = 'rgb(' + value + ',' + value + ',' + value + ')';
      ctx.lineWidth = 0.55 + random() * 1.65;
      ctx.beginPath();
      for (let j = 0; j <= 18; j++) {
        const t = mix(first, length, j / 18),
          end = smooth(t, 0.51, 1);
        const bundle = Math.sin(Math.round(u * 5) * 2.7 + slot + t * 3);
        const spread = u * (1 - 0.36 * end) + 0.1 * bundle * end;
        const bend = Math.sin(t * 5 + wave) * (1.2 + 1.9 * jitter) + Math.sin(t * 6 + slot) * 1.6;
        const x = left + 64 + 55 * spread + bend;
        const y = top + 3 + t * 245;
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  atlas.name = 'groom-eight-fibre-clumps';
  return atlas;
}
function releaseAtlas() {
  if (--atlasOwners === 0) {
    atlas?.dispose();
    hairlineMask?.dispose();
    atlas = hairlineMask = undefined;
  }
}

function rootMask() {
  if (hairlineMask) return hairlineMask;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!,
    rand = randomStream(42985);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 512, 119);
  for (let i = 0; i < 1380; i++) {
    const x = rand() * 512,
      end = 120 + rand() * 7;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.5 + rand() * 1.05;
    ctx.beginPath();
    ctx.moveTo(x, 117);
    ctx.lineTo(x + Math.sin(x * 0.025) * 2, end);
    ctx.stroke();
  }
  hairlineMask = new THREE.CanvasTexture(c);
  hairlineMask.name = 'groom-follicle-margin';
  hairlineMask.wrapS = THREE.RepeatWrapping;
  return hairlineMask;
}

const colours = {
  mira: ['#53392f', '#633e32', '#785344'],
  jules: ['#282728', '#504644', '#6c5e56'],
  dev: ['#302221', '#51372d', '#654536'],
  waiter: ['#302925', '#4d4039', '#675448'],
  diner: ['#49342e', '#715044', '#886652'],
  friend: ['#30272d', '#544049', '#6b5358'],
} as const;

/** A convex, three-column ribbon. Vertices share the underlying groom normal so
 * adjacent clumps light as a mass, while a small crosswise bend catches the rim. */
class Cards {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colours: number[] = [];
  private triangles: number[] = [];
  constructor(
    private readonly colour: THREE.Color,
    private readonly random: () => number,
  ) {}
  tint(hex: string) {
    this.colour.set(hex);
  }

  add(
    path: Guide,
    width: number,
    normalAt: (point: THREE.Vector3, t: number) => THREE.Vector3,
    rows = 13,
    taper = 0.7,
    softRoot = 0.18,
  ) {
    const start = this.positions.length / 3;
    const slot = Math.floor(this.random() * 8);
    const brightness = 0.78 + this.random() * 0.42;
    const points = Array.from({ length: rows + 1 }, (_, i) => path(i / rows));
    let lastAcross: THREE.Vector3 | undefined;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows,
        point = points[i];
      const tangent = points[Math.min(i + 1, rows)]
        .clone()
        .sub(points[Math.max(0, i - 1)])
        .normalize();
      const outward = normalAt(point, t);
      const across = new THREE.Vector3().crossVectors(tangent, outward).normalize();
      if (across.lengthSq() < 0.2) across.copy(lastAcross ?? v(1, 0, 0));
      if (lastAcross && across.dot(lastAcross) < 0) across.negate();
      lastAcross = across;
      const normal = new THREE.Vector3().crossVectors(across, tangent).normalize();
      if (normal.dot(outward) < 0) normal.negate();
      const root = mix(0.07, 1, smooth(t, 0, softRoot));
      const half = width * root * (0.83 + 0.17 * Math.sin(Math.PI * t)) * (1 - taper * smooth(t, 0.51, 1));
      for (const a of [-1, 0, 1]) {
        const p = point
          .clone()
          .addScaledVector(across, a * half)
          .addScaledVector(normal, (1 - a * a) * width * 0.1);
        const n = outward
          .clone()
          .lerp(normal, 0.13)
          .addScaledVector(across, a * 0.07)
          .normalize();
        const light = brightness * (0.77 + 0.25 * smooth(t, 0, 0.31)) * (a ? 0.95 : 1.04);
        this.positions.push(p.x, p.y, p.z);
        this.normals.push(n.x, n.y, n.z);
        this.colours.push(this.colour.r * light, this.colour.g * light, this.colour.b * light);
        this.uvs.push(((slot % 4) + 0.5 + a * 0.49) / 4, 1 - (Math.floor(slot / 4) + 0.012 + t * 0.966) / 2);
      }
      if (i < rows)
        for (let j = 0; j < 2; j++) {
          const a = start + i * 3 + j;
          this.triangles.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
        }
    }
  }

  mesh(material: THREE.Material, name: string) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.triangles);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'hair-cards-' + name;
    return mesh;
  }
}

const ellipsoid = (angle: number, polar: number) =>
  v(Math.sin(angle) * Math.sin(polar), Math.cos(polar), Math.cos(angle) * Math.sin(polar));
function boundary(angle: number) {
  const a = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  return (
    1.075 +
    0.07 * Math.exp(-((a / 0.29) ** 2)) +
    0.34 * smooth(a, 0.36, 0.98) +
    0.31 * smooth(a, 1.0, 1.28) -
    0.23 * smooth(a, 1.3, 1.57) +
    0.69 * smooth(a, 1.6, 2.65)
  );
}

/** The first millimetres of a pulled-back hairline lie on the skin. Painting this
 * transition onto the head UVs keeps the forehead continuous in profile as well. */
export function paintPulledBackRoots(ctx: CanvasRenderingContext2D, minY: number, headHeight: number) {
  const { width, height } = ctx.canvas;
  const rand = randomStream(4751);
  const pixelsPerMetre = height / headHeight;
  const margin = (angle: number) => {
    const polar = boundary(angle) + 0.009 * Math.sin(angle * 12) + 0.004 * Math.sin(angle * 27);
    const y = 0.010 + 0.136 * Math.cos(polar);
    return height * (1 - (y - minY) / headHeight);
  };
  // These are the root tones relative to the skin albedo in the face texture.
  for (let x = 0; x < width; x++) {
    const angle = (x / width - 0.5) * TAU;
    const edge = margin(angle);
    const gradient = ctx.createLinearGradient(0, edge - 0.007 * pixelsPerMetre, 0, edge + 0.0008 * pixelsPerMetre);
    gradient.addColorStop(0, '#63473d');
    gradient.addColorStop(0.50, '#664b40');
    gradient.addColorStop(0.77, 'rgba(99,73,63,.75)');
    gradient.addColorStop(1, 'rgba(99,73,63,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, 1, edge + 2);
  }
  for (let i = 0; i < 3400; i++) {
    const x = rand() * width, angle = (x / width - 0.5) * TAU;
    const start = margin(angle) + (rand() * 0.0020 - 0.0008) * pixelsPerMetre;
    const length = (0.004 + rand() * 0.011) * pixelsPerMetre;
    const drift = 1.7 * Math.sin(angle) + (rand() - 0.5) * 1.4;
    ctx.lineWidth = 0.26 + rand() * 0.52;
    ctx.strokeStyle = 'rgba(79,64,63,' + (0.28 + rand() * 0.43) + ')';
    ctx.beginPath();
    ctx.moveTo(x, start);
    ctx.quadraticCurveTo(x + drift, start - length * 0.36, x + 1.7 * drift, start - length);
    ctx.stroke();
  }
}
function scalp(unit: THREE.Vector3, width: number, lift: number) {
  const radial = Math.hypot(unit.x, unit.z);
  const front = unit.z > 0 ? radial * (unit.z / Math.max(0.00001, radial)) ** 0.43 : unit.z;
  return v(
    unit.x * (0.083 * width + lift),
    0.01 + unit.y * (0.136 + lift),
    -0.003 + front * ((front > 0 ? 0.093 : 0.099) + lift),
  );
}
const scalpNormal = (p: THREE.Vector3) => v(p.x / 0.083, (p.y - 0.01) / 0.136, (p.z + 0.003) / 0.096).normalize();
function fitRoots(p: THREE.Vector3, angle: number, amount: number, skull: SkullSurface) {
  if (amount > 0) p.lerp(skull(angle, p.y).addScaledVector(scalpNormal(p), 0.0007), amount);
  return p;
}
function fittedScalp(dir: THREE.Vector3, width: number, skull: SkullSurface, lift: number) {
  const angle = Math.atan2(dir.x, dir.z);
  const distanceToEdge = boundary(angle) - Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
  const p = scalp(dir, width, 0);
  fitRoots(p, angle, 1 - smooth(distanceToEdge, 0.025, 0.36), skull);
  return p.addScaledVector(scalpNormal(p), lift);
}

function undercoatFibres() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!, rand = randomStream(3839);
  ctx.fillStyle = '#c7bbb4'; ctx.fillRect(0,0,c.width,c.height);
  for(let i=0;i<1400;i++) {
    const x = rand()*512, bend = Math.sin(x/512*TAU)*4;
    ctx.strokeStyle = rand()<.55 ? 'rgba(57,46,41,.47)' : 'rgba(249,242,229,.30)';
    ctx.lineWidth = .35+rand()*.88; ctx.beginPath(); ctx.moveTo(x,128);
    ctx.bezierCurveTo(x+bend,94,x+bend*2,49,x+bend*2,0); ctx.stroke();
  }
  const result = new THREE.CanvasTexture(c); result.wrapS = THREE.RepeatWrapping;
  result.colorSpace = THREE.SRGBColorSpace; result.name='groom-combed-foundation'; return result;
}
function undercoat(width: number, colour: THREE.Color, skull: SkullSurface, pulled: boolean) {
  const rows = 15,
    cols = 72,
    pos: number[] = [],
    normal: number[] = [],
    colors: number[] = [],
    uv: number[] = [],
    ix: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const angle = (i / cols) * TAU - PI,
        t = j / rows;
      const inset = pulled ? 0.010 : 0.005;
      const dir = ellipsoid(angle, (0.002 + t * 0.998) * (boundary(angle) - inset + (pulled ? 0.009 : 0.013) * Math.sin(angle * 21)));
      const p = pulled ? fittedScalp(dir,width,skull,0) : scalp(dir,width,0);
      const n = scalpNormal(p);
      const tint = 0.84 + 0.12 * Math.sin(angle * 59 + t * 2) + 0.07 * Math.cos(angle * 35 - t * 3);
      pos.push(p.x, p.y, p.z);
      normal.push(n.x, n.y, n.z);
      colors.push(colour.r * tint, colour.g * tint, colour.b * tint);
      uv.push((i / cols) * 2, 1 - t);
      if (j < rows && i < cols) {
        const a = j * (cols + 1) + i,
          b = a + cols + 1;
        ix.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ix);
  return g;
}

/** Crown fibres follow the direction of combing, from hairline to the ponytail tie. */
function pulledBack(cards: Cards, width: number, rand: () => number, skull: SkullSurface) {
  const end = v(-0.15, 0.42, -0.9).normalize();
  for (let i = 0; i < 120; i++) {
    const angle = ((i + rand() * 0.55) / 120) * TAU - PI;
    const polar = boundary(angle) - 0.011 + (rand() - 0.5) * 0.014;
    const bias = rand(),
      start = ellipsoid(angle, polar);
    cards.add(
      (t) => {
        const dir = start.clone().lerp(end, t);
        dir.y += Math.sin(PI * t) * 0.34 * Math.max(0, start.z);
        dir.x += Math.sign(angle) * Math.sin(PI * t) * (0.03 + 0.045 * bias);
        return fittedScalp(dir.normalize(), width, skull, 0.0010 + 0.0028 * Math.sin(PI * t) + bias * 0.0005);
      },
      0.0058 + rand() * 0.0038,
      scalpNormal,
      17,
      0.2,
      0.036,
    );
  }
  // Sparse shorter fibres leave a gradual density change on the forehead and temples.
  for (let i = 0; i < 32; i++) {
    const a = mix(-1.46, 1.46, (i + rand()) / 32),
      edge = boundary(a) - 0.010 + rand() * 0.016;
    const bend = (rand() - 0.5) * 0.070;
    cards.add(
      (t) => {
        const angle = a + bend * Math.sin(PI * t) + 0.024 * t * Math.sign(a);
        return fittedScalp(ellipsoid(angle, edge - 0.16 * t), width, skull, 0.0009);
      },
      0.00017 + rand() * 0.00024,
      scalpNormal,
      6,
      0.6,
    );
  }
}
function sidePart(cards: Cards, width: number, kind: CharacterKind, rand: () => number) {
  const bob = kind === 'jules',
    hero = bob || kind === 'dev';
  const count = bob ? 54 : hero ? 46 : 29;
  const part = bob ? 0.26 : kind === 'waiter' ? 0.4 : kind === 'friend' ? -0.13 : -0.38;
  for (const side of [-1, 1])
    for (let i = 0; i < count; i++) {
      const p = (i + rand() * 0.7) / count,
        front = (1 - p) ** 2,
        jitter = rand();
      const z = mix(0.875, -0.78, p);
      const rootX = part * Math.sqrt(1 - z * z);
      const rootDir = v(rootX, Math.sqrt(1 - z * z - rootX * rootX), z);
      const angle = side * mix(bob ? 0.72 : side > 0 ? 0.6 : 0.75, PI, p);
      const reach = boundary(angle) + (bob ? 0.18 : 0.06) + jitter * 0.07;
      const endDir = ellipsoid(angle, reach);
      const traverse = (t: number) => {
        const dir = rootDir.clone().lerp(endDir, t);
        dir.y += Math.sin(PI * t) * (0.19 + 0.11 * front);
        dir.z += Math.sin(PI * t) * (0.27 * front + 0.045);
        dir.x += side * Math.sin(PI * t) * (bob ? 0.06 : 0.19) * front;
        const lift =
          0.0015 +
          0.003 * jitter +
          Math.sin(PI * t) * (0.003 + (bob ? 0.006 : kind === 'waiter' ? 0.009 : 0.016) * front);
        return scalp(dir.normalize(), width, lift);
      };
      const shoulder = traverse(1);
      // Longer panels turn under the jaw on the heavy side; the other side tucks behind the ear.
      const a = angle + side * (bob ? 0.09 + 0.12 * front : 0.035);
      const tucked = side === 1 ? front : 0;
      const endY = bob
        ? -0.084 - 0.03 * front + 0.07 * tucked + (jitter - 0.5) * 0.014
        : shoulder.y - 0.018 - front * 0.008;
      const tip = v(
        Math.sin(a) * (0.088 * width - 0.007 * tucked),
        endY,
        -0.007 + (Math.cos(a) > 0 ? Math.cos(a) ** 0.52 : Math.cos(a)) * 0.094,
      );
      if (!bob) {
        tip.x += 0.009 * front;
        tip.z += 0.0025 * front;
      }
      const lastTangent = shoulder.clone().sub(traverse(0.92));
      const middle = shoulder.clone().addScaledVector(lastTangent, 0.95);
      middle.y = mix(shoulder.y, endY, 0.32);
      middle.x += side * (bob ? 0.005 : 0);
      const lower = new THREE.QuadraticBezierCurve3(shoulder, middle, tip);
      const split = bob ? 0.62 : 0.8;
      cards.add(
        (t) => (t <= split ? traverse(t / split) : lower.getPoint((t - split) / (1 - split))),
        bob ? 0.0105 : hero ? 0.0095 : 0.012,
        (point) => {
          const n = scalpNormal(point);
          if (bob && point.y < 0.035) {
            n.y *= 0.18;
            n.normalize();
          }
          return n;
        },
        bob ? 19 : hero ? 14 : 11,
        bob ? 0.7 : 0.85,
      );
    }
}

function sweptForelock(cards: Cards, width: number, rand: () => number, tuckRoots: boolean) {
  for (let i = 0; i < 22; i++) {
    const row = i / 21,
      jitter = rand();
    const guide = new THREE.CatmullRomCurve3([
      v(-0.39, 0.79, 0.49 - 0.35 * row),
      v(-0.29, 0.84, 0.54 - 0.18 * row),
      v(0.01, 0.76, 0.68 + 0.08 * row),
      v(0.24 + 0.23 * row, 0.59, 0.76),
      v(0.18 + 0.43 * row, 0.3 + 0.21 * row, 0.88 - 0.13 * row),
    ]);
    cards.add(
      (t) => {
        const tuck = tuckRoots ? 0.017 * (1 - smooth(t, 0.32, 0.80)) : 0;
        return scalp(guide.getPoint(t).normalize(), width, 0.002 + 0.006 * Math.sin(Math.PI * t) + 0.0015 * jitter - tuck);
      },
      0.0042 + 0.002 * rand(),
      scalpNormal,
      16,
      0.92,
    );
  }
}

function tendril(cards: Cards, coords: number[][], width: number, spread: number, count: number, rand: () => number) {
  for (let i = 0; i < count; i++) {
    const shift = (rand() - 0.5) * spread,
      offset = (rand() - 0.5) * spread;
    const path = new THREE.CatmullRomCurve3(
      coords.map(([x, y, z], k) => v(x + shift + k * shift * 0.14, y + offset * (k ? 1 : 0.1), z + 0.3 * offset)),
    );
    cards.add(
      (t) => path.getPoint(t),
      width * (0.55 + rand() * 0.75),
      (point) => v(point.x * 4, 0.09, 1).normalize(),
      17,
      0.95,
    );
  }
}

/** The fall starts at a real tie pivot and passes over the shoulder in one S-curve. */
function ponytail(cards: Cards, rand: () => number) {
  const tie = v(-0.021, 0.068, -0.096);
  const curve = new THREE.CatmullRomCurve3([
    tie,
    v(-0.042, 0.072, -0.125),
    v(-0.077, 0.032, -0.145),
    v(-0.101, -0.045, -0.122),
    v(-0.116, -0.112, -0.061),
    v(-0.12, -0.153, 0.021),
    v(-0.12, -0.169, 0.085),
    v(-0.107, -0.216, 0.13),
    v(-0.096, -0.27, 0.135),
    v(-0.089, -0.295, 0.129),
  ]);
  // Parallel transport keeps the fibre cross-section continuous around the shoulder.
  const frames = curve.computeFrenetFrames(64, false);
  for (let i = 0; i < 66; i++) {
    const a = (i / 66) * TAU + rand() * 0.11,
      end = 0.79 + 0.21 * rand(),
      layer = 0.56 + 0.46 * rand();
    const get = (t: number) => {
      const u = t * end,
        circle = a + 0.72 * u + 0.12 * Math.sin(u * 7 + a);
      const frame = Math.min(64, Math.round(u * 64));
      const out = frames.normals[frame]
        .clone()
        .multiplyScalar(Math.cos(circle))
        .addScaledVector(frames.binormals[frame], Math.sin(circle))
        .normalize();
      const r = (0.014 + 0.013 * smooth(u, 0.01, 0.19)) * (1 - 0.9 * smooth(u, 0.49, 1)) * layer;
      return { p: curve.getPointAt(u).addScaledVector(out, r).sub(tie), out };
    };
    cards.add(
      (t) => get(t).p,
      0.009 + 0.003 * rand(),
      (_p, t) => get(t).out,
      22,
      0.85,
    );
  }
  return tie;
}

export function createCharacterHair(kind: CharacterKind, width: number, skull: SkullSurface) {
  const group = new THREE.Group(),
    palette = colours[kind];
  const rand = randomStream(1989 + kind.charCodeAt(0) * 701);
  const base = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: kind === 'mira' ? undercoatFibres() : null,
    roughness: 0.76,
    alphaMap: rootMask(),
    alphaTest: 0.37,
    alphaToCoverage: true,
  });
  let foundation = undercoat(width, new THREE.Color(palette[0]), skull, kind === 'mira');
  const material = new THREE.MeshPhysicalMaterial({
    map: acquireAtlas(),
    vertexColors: true,
    alphaTest: 0.31,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.65,
    anisotropy: 0.4,
    anisotropyRotation: PI / 2,
    specularIntensity: 0.13,
  });
  const cards = new Cards(new THREE.Color(palette[1]), rand);
  let tail: THREE.Mesh | undefined;
  if (kind === 'mira') {
    pulledBack(cards, width, rand, skull);
    // Two loose sections driven by the side part; fine separate ends frame the cheek.
    tendril(
      cards,
      [
        [-0.017, 0.107, 0.071],
        [-0.048, 0.088, 0.085],
        [-0.071, 0.052, 0.071],
        [-0.077, 0.003, 0.053],
        [-0.067, -0.045, 0.053],
        [-0.07, -0.08, 0.049],
      ],
      0.0065,
      0.011,
      10,
      rand,
    );
    cards.tint(palette[2]);
    tendril(
      cards,
      [
        [0.019, 0.108, 0.071],
        [0.052, 0.09, 0.082],
        [0.074, 0.043, 0.067],
        [0.08, 0.008, 0.031],
        [0.076, -0.033, 0.021],
      ],
      0.0024,
      0.006,
      7,
      rand,
    );
    const strands = new Cards(new THREE.Color(palette[1]), rand);
    const tie = ponytail(strands, rand);
    tail = strands.mesh(material, 'ponytail');
    tail.position.copy(tie);
    group.add(tail);
    const band = new THREE.TorusGeometry(0.0158, 0.0027, 6, 22);
    band.rotateY(0.53);
    band.translate(tie.x, tie.y, tie.z);
    const bandColor = new THREE.Color('#4b3031'),
      rgb: number[] = [],
      bandUV = band.getAttribute('uv');
    for (let i = 0; i < bandUV.count; i++) {
      rgb.push(bandColor.r, bandColor.g, bandColor.b);
      bandUV.setXY(i, 0.5, 0.6);
    }
    band.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
    const combined = mergeGeometries([foundation, band])!;
    foundation.dispose();
    band.dispose();
    foundation = combined;
  } else {
    sidePart(cards, width, kind, rand);
    cards.tint(palette[2]);
    if (kind === 'jules') {
      tendril(
        cards,
        [
          [0.017, 0.111, 0.068],
          [-0.015, 0.104, 0.084],
          [-0.049, 0.082, 0.088],
          [-0.076, 0.038, 0.067],
          [-0.083, -0.036, 0.053],
          [-0.069, -0.107, 0.042],
        ],
        0.003,
        0.01,
        12,
        rand,
      );
    } else if (kind === 'dev' || kind === 'diner') {
      sweptForelock(cards, width, rand, kind === 'dev');
    }
  }
  const under = new THREE.Mesh(foundation, base);
  under.name = 'hair-foundation';
  group.add(under, cards.mesh(material, 'crown'));
  let lastYaw = 0,
    swing = 0;
  return {
    group,
    update(dt: number, yaw: number, time: number) {
      if (!tail || dt <= 0) return;
      const step = Math.min(dt, 0.08);
      swing = THREE.MathUtils.clamp(swing * Math.exp(-step * 6) - (yaw - lastYaw) * 0.65, -0.095, 0.095);
      tail.rotation.y = swing;
      tail.rotation.z = 0.009 * Math.sin(time * 1.6) + swing * 0.13;
      lastYaw = yaw;
    },
    dispose() {
      base.map?.dispose();
      base.dispose();
      material.dispose();
      releaseAtlas();
    },
  };
}
