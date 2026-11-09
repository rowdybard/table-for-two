import * as THREE from 'three';
import type { FacePose } from './FacialPerformance';
import type { CharacterKind } from './CharacterBody';
import { createCharacterHair, paintPulledBackRoots } from './CharacterHair';

export interface CharacterHead {
  root: THREE.Group;
  update(
    time: number,
    dt: number,
    pose: FacePose,
    speaking: boolean,
    amplitude: number,
    lookX: number,
    lookY: number,
    /** Inward iris shift in metres so both eyes converge on a near target. */
    converge?: number,
  ): void;
  dispose(): void;
}

const profiles = {
  mira: {
    width: 1,
    jaw: 0.94,
    nose: 0.018,
    lips: '#ae6670',
    eyes: '#78533d',
    brow: '#51392f',
    eyeTilt: 0.0016,
    browHeight: 0.037,
    lipWidth: 0.0335,
  },
  jules: {
    width: 1.015,
    jaw: 1.01,
    nose: 0.02,
    lips: '#aa7070',
    eyes: '#73877e',
    brow: '#493c38',
    eyeTilt: 0.0004,
    browHeight: 0.0355,
    lipWidth: 0.034,
  },
  dev: {
    width: 1.075,
    jaw: 1.11,
    nose: 0.023,
    lips: '#986159',
    eyes: '#70503b',
    brow: '#41322e',
    eyeTilt: 0.0009,
    browHeight: 0.035,
    lipWidth: 0.036,
  },
  waiter: {
    width: 1.02,
    jaw: 1.04,
    nose: 0.019,
    lips: '#a06c66',
    eyes: '#756450',
    brow: '#4c413a',
    eyeTilt: 0.0007,
    browHeight: 0.037,
    lipWidth: 0.033,
  },
  diner: {
    width: 1.055,
    jaw: 1.07,
    nose: 0.021,
    lips: '#9e645c',
    eyes: '#866042',
    brow: '#644839',
    eyeTilt: 0.0007,
    browHeight: 0.036,
    lipWidth: 0.0345,
  },
  friend: {
    width: 1.02,
    jaw: 1.02,
    nose: 0.019,
    lips: '#a26e70',
    eyes: '#706151',
    brow: '#4c3b3d',
    eyeTilt: 0.001,
    browHeight: 0.037,
    lipWidth: 0.034,
  },
} as const;
// Horizontal sections in metres: height, half-width, front, back.
const profile = [
  [-0.12, 0.01, 0.039, 0.015],
  [-0.113, 0.028, 0.061, 0.038],
  [-0.1, 0.043, 0.073, 0.052],
  [-0.081, 0.056, 0.075, 0.069],
  [-0.058, 0.066, 0.077, 0.078],
  [-0.034, 0.072, 0.079, 0.084],
  [-0.013, 0.077, 0.079, 0.088],
  [0.012, 0.077, 0.076, 0.09],
  [0.045, 0.075, 0.076, 0.09],
  [0.075, 0.072, 0.073, 0.084],
  [0.103, 0.061, 0.061, 0.071],
  [0.125, 0.04, 0.042, 0.052],
  [0.139, 0.003, 0.004, 0.007],
];
const bottom = profile[0][0],
  height = profile.at(-1)![0] - bottom;
const mix = THREE.MathUtils.lerp,
  smooth = THREE.MathUtils.smoothstep,
  clamp = THREE.MathUtils.clamp;
const bump = (x: number, center: number, width: number) => Math.exp(-(((x - center) / width) ** 2));
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function section(y: number, k: number) {
  let i = 0;
  while (i < profile.length - 2 && y > profile[i + 1][0]) i++;
  const t = clamp((y - profile[i][0]) / (profile[i + 1][0] - profile[i][0]), 0, 1);
  const a = profile[Math.max(0, i - 1)][k],
    b = profile[i][k],
    c = profile[i + 1][k],
    d = profile[Math.min(i + 2, profile.length - 1)][k];
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

function grid(cols: number, rows: number, reverse = false) {
  const g = new THREE.BufferGeometry(),
    index: number[] = [];
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((rows + 1) * (cols + 1) * 3), 3));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i,
        b = a + cols + 1;
      if (reverse) index.push(a, b, a + 1, a + 1, b, b + 1);
      else index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  g.setIndex(index);
  return g;
}
function inkTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function randomStream(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createCharacterHead(kind: CharacterKind, skinColor: string): CharacterHead {
  const root = new THREE.Group(),
    look = profiles[kind],
    materials: THREE.Material[] = [],
    textures: THREE.Texture[] = [];
  const rand = randomStream(9527 + kind.charCodeAt(0) * 11);
  function mat(options: THREE.MeshStandardMaterialParameters) {
    const result = new THREE.MeshStandardMaterial(options);
    materials.push(result);
    return result;
  }
  function add(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = root) {
    const piece = new THREE.Mesh(g, m);
    parent.add(piece);
    return piece;
  }
  const skinColorLinear = new THREE.Color(skinColor),
    flushColor = new THREE.Color('#c87b76');
  const depthColor = new THREE.Color('#966b66'),
    nostrilColor = new THREE.Color('#5b3a33');
  const lipColor = new THREE.Color(look.lips);
  const widthAt = (y: number) => section(y, 1) * look.width * mix(look.jaw, 1, smooth(y, -0.09, -0.014));
  const eyeX = 0.0352 * look.width,
    eyeY = 0.013,
    half = kind === 'dev' ? 0.0228 : 0.022,
    irisRadius = 0.0104;
  const mouthY = -0.0645;
  function detail(x: number, y: number) {
    const a = Math.abs(x);
    // Brow ridge, orbital hollow, cheeks, nasal bridge and cartilage are one skin surface.
    return (
      0.0057 * bump(a, 0.032, 0.022) * bump(y, 0.038, 0.012) -
      0.0063 * bump(a, eyeX, 0.022) * bump(y, 0.014, 0.017) +
      0.0057 * bump(a, 0.047, 0.017) * bump(y, -0.016, 0.019) -
      0.0028 * bump(a, 0.053, 0.014) * bump(y, -0.052, 0.025) +
      0.011 * bump(x, 0, 0.0085) * bump(y, 0.003, 0.039) +
      0.009 * bump(x, 0, 0.01) * bump(y, -0.02, 0.023) +
      look.nose * bump(x, 0, 0.0128) * bump(y, -0.032, 0.012) +
      0.0079 * bump(a, 0.013, 0.0056) * bump(y, -0.037, 0.0085) -
      0.0038 * bump(a, 0.009, 0.0047) * bump(y, -0.0405, 0.0038) +
      0.004 * bump(x, 0, 0.0045) * bump(y, -0.04, 0.009) +
      0.0024 * bump(a, 0.0045, 0.0026) * bump(y, -0.052, 0.008) +
      0.0038 * bump(x, 0, 0.029) * bump(y, mouthY, 0.015) -
      0.0024 * bump(x, 0, 0.019) * bump(y, -0.081, 0.006) +
      0.0048 * bump(x, 0, 0.022) * bump(y, -0.098, 0.013)
    );
  }
  function surface(x: number, y: number) {
    const c = Math.sqrt(Math.max(0.0001, 1 - (x / Math.max(0.001, widthAt(y))) ** 2));
    return section(y, 2) * c ** 0.58 + detail(x, y) * c ** 1.65;
  }
  function surfaceNormal(x: number, y: number) {
    const d = 0.00028;
    return vec(surface(x - d, y) - surface(x + d, y), surface(x, y - d) - surface(x, y + d), 2 * d).normalize();
  }
  const beardTone = new THREE.Color('#775c53');
  function skinTone(x: number, y: number, front: number, out: THREE.Color) {
    out.copy(skinColorLinear);
    if (front <= 0) return out;
    const a = Math.abs(x);
    out.lerp(
      flushColor,
      (0.2 * bump(a, 0.045, 0.025) * bump(y, -0.018, 0.02) + 0.12 * bump(x, 0, 0.019) * bump(y, -0.034, 0.012)) * front,
    );
    out.lerp(
      depthColor,
      (0.18 * bump(a, eyeX, 0.019) * bump(y, 0.007, 0.012) +
        0.15 * bump(a, 0.061, 0.012) * bump(y, 0.021, 0.038) +
        0.12 * bump(a, 0.019, 0.0035) * bump(y, -0.039, 0.006) +
        0.16 * bump(x, 0, 0.02) * bump(y, -0.081, 0.005)) *
        front,
    );
    out.lerp(nostrilColor, 0.82 * bump(a, 0.0102, 0.0043) * bump(y, -0.0405, 0.0019) * front);
    if (kind === 'dev') out.lerp(beardTone, 0.075 * smooth(-y, 0.045, 0.092) * (1 - 0.5 * bump(x, 0, 0.025)));
    return out;
  }

  const textureWidth = kind === 'mira' ? 1024 : 512;
  const complexion = inkTexture(textureWidth, 512, (ctx) => {
    const pixels = ctx.createImageData(textureWidth, 512);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = Math.round(249 + (rand() - 0.5) * 8);
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    // Subtle, uneven pigment over the bridge and malar cheeks.
    for (let i = 0; i < (kind === 'mira' ? 62 : 32); i++) {
      const x = (rand() - 0.5) * 0.125,
        y = -0.014 + (rand() - 0.5) * 0.038;
      const u = 0.5 + Math.asin(clamp(x / widthAt(y), -1, 1)) / (2 * Math.PI);
      ctx.fillStyle = 'rgba(130,82,69,' + (0.05 + 0.18 * rand()) + ')';
      ctx.beginPath();
      ctx.ellipse(
        u * textureWidth,
        512 * (1 - (y - bottom) / height),
        (0.22 + rand() * 0.58) * textureWidth / 512,
        0.4 + rand() * 0.85,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    if (kind === 'mira') paintPulledBackRoots(ctx, bottom, height);
  });
  textures.push(complexion);
  const skin = mat({ map: complexion, vertexColors: true, roughness: 0.61 });
  const lidSkin = mat({ vertexColors: true, roughness: 0.62 });
  const white = mat({ vertexColors: true, roughness: 0.41 });
  const lip = mat({ vertexColors: true, roughness: 0.5 }),
    mouth = mat({ color: '#502d30', roughness: 0.88 });
  const metal = mat({ color: kind === 'mira' ? '#c2a474' : '#b6b8bb', metalness: 0.77, roughness: 0.31 });

  const rows = 62,
    cols = 80,
    face = grid(cols, rows),
    pos = face.getAttribute('position'),
    pigment: number[] = [],
    uv: number[] = [];
  const tint = new THREE.Color();
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const f = j / rows,
        y = bottom + height * f;
      const azimuth = (i / cols - 0.5) * 2 * Math.PI,
        theta = azimuth - 0.4 * Math.sin(azimuth),
        c = Math.cos(theta);
      const x = widthAt(y) * Math.sin(theta);
      const z = c > 0 ? section(y, 2) * c ** 0.58 + detail(x, y) * c ** 1.65 : section(y, 3) * c;
      pos.setXYZ(j * (cols + 1) + i, x, y, z);
      uv.push(0.5 + theta / (2 * Math.PI), f);
      skinTone(x, y, c, tint);
      pigment.push(tint.r, tint.g, tint.b);
    }
  face.setAttribute('color', new THREE.Float32BufferAttribute(pigment, 3));
  face.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  face.computeVertexNormals();
  add(face, skin);
  // Skin that moves with the expression: cheeks lift into a smile, corners sink in a frown,
  // the brow ridge follows the brows, the glabella furrows and the chin drops with the jaw.
  const facePositions = pos.array as Float32Array,
    faceBase = facePositions.slice();
  const cheekLift: number[] = [], cheekOut: number[] = [], frownW: number[] = [], browW: number[] = [], glabellaW: number[] = [], chinW: number[] = [], sideOf: number[] = [];
  for (let v = 0; v < pos.count; v++) {
    const x = faceBase[v * 3], y = faceBase[v * 3 + 1], z = faceBase[v * 3 + 2], a = Math.abs(x);
    const front = z > 0.02 ? 1 : 0;
    cheekLift.push(front * bump(a, 0.047, 0.021) * bump(y, -0.03, 0.024));
    cheekOut.push(front * bump(a, 0.05, 0.02) * bump(y, -0.024, 0.02));
    frownW.push(front * bump(a, 0.031, 0.015) * bump(y, -0.072, 0.013));
    browW.push(front * bump(y, 0.04, 0.015) * bump(a, 0.03, 0.028));
    glabellaW.push(front * bump(x, 0, 0.011) * bump(y, 0.033, 0.013));
    chinW.push(front * smooth(-y, 0.07, 0.115));
    sideOf.push(Math.sign(x));
  }
  const faceNormalAttr = face.getAttribute('normal') as THREE.BufferAttribute;
  let faceMorphKey = NaN;
  function morphFace(smile: number, asymmetry: number, browLift: number, browAngle: number, jaw: number) {
    const key = smile * 5 + asymmetry * 2 + browLift * 900 + browAngle * 4 + jaw * 7;
    if (Number.isFinite(faceMorphKey) && Math.abs(faceMorphKey - key) < 0.01) return;
    faceMorphKey = key;
    const up = Math.max(0, smile), down = Math.max(0, -smile);
    for (let v = 0; v < pos.count; v++) {
      const bias = 1 + asymmetry * 0.35 * sideOf[v];
      facePositions[v * 3 + 1] =
        faceBase[v * 3 + 1] + 0.0042 * up * bias * cheekLift[v] - 0.0024 * down * frownW[v] + 0.55 * browLift * browW[v] - 0.0045 * jaw * chinW[v];
      facePositions[v * 3 + 2] = faceBase[v * 3 + 2] + 0.0026 * up * bias * cheekOut[v] - 0.012 * Math.max(0, browAngle) * glabellaW[v];
    }
    pos.needsUpdate = true;
    face.computeVertexNormals();
    faceNormalAttr.needsUpdate = true;
  }

  // Sculpt the helix, concha and lobe as a single shallow relief.
  for (const side of [-1, 1]) {
    const g = grid(24, 6, side < 0),
      ep = g.getAttribute('position'),
      colors: number[] = [];
    for (let j = 0; j <= 6; j++)
      for (let i = 0; i <= 24; i++) {
        const r = j / 6,
          a = (i / 24) * Math.PI * 2,
          y = -0.004 + Math.sin(a) * r * 0.021;
        const z = -0.007 + Math.cos(a) * r * 0.012 + 0.12 * (y + 0.004);
        const x =
          side *
          (0.074 * look.width +
            0.0072 * (1 - r * r) +
            0.007 * bump(r, 0.78, 0.14) +
            0.0045 * Math.max(0, -Math.sin(a)) * r);
        ep.setXYZ(j * 25 + i, x, y, z);
        tint
          .copy(skinColorLinear)
          .lerp(flushColor, 0.23)
          .lerp(depthColor, 0.34 * (1 - r));
        colors.push(tint.r, tint.g, tint.b);
      }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    add(g, lidSkin);
    if (kind === 'mira' || kind === 'jules') {
      const hoop = add(new THREE.TorusGeometry(kind === 'mira' ? 0.01 : 0.0068, 0.00105, 6, 24), metal);
      hoop.position.set(side * 0.079 * look.width, -0.032, -0.003);
      hoop.rotation.y = side * 0.55;
    }
  }

  const irisMap = inkTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
    g.addColorStop(0, '#30251f');
    g.addColorStop(0.3, look.eyes);
    g.addColorStop(0.62, look.eyes);
    g.addColorStop(0.8, '#2b2320');
    g.addColorStop(1, '#332f2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 170; i++) {
      const a = rand() * 2 * Math.PI,
        inner = 18 + rand() * 12,
        end = 43 + rand() * 16;
      ctx.strokeStyle = i % 3 ? '#ffe6bd28' : '#382c2b50';
      ctx.lineWidth = 0.5 + rand();
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * inner, 64 + Math.sin(a) * inner);
      ctx.lineTo(64 + Math.cos(a + 0.025) * end, 64 + Math.sin(a + 0.025) * end);
      ctx.stroke();
    }
    ctx.fillStyle = '#211c1b';
    ctx.beginPath();
    ctx.arc(64, 64, 22, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#fffbec';
    ctx.beginPath();
    ctx.ellipse(45, 41, 8.4, 7, -0.55, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#e6ddce86';
    ctx.beginPath();
    ctx.arc(84, 78, 3, 0, 2 * Math.PI);
    ctx.fill();
  });
  const browMap = inkTexture(192, 48, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.beginPath();
    ctx.moveTo(5, 26);
    ctx.bezierCurveTo(31, 14, 82, 10, 116, 14);
    ctx.bezierCurveTo(140, 15, 165, 21, 187, 28);
    ctx.bezierCurveTo(146, 21, 103, 18, 80, 21);
    ctx.bezierCurveTo(48, 23, 27, 30, 7, 31);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < 850; i++) {
      const u = rand(),
        x = 5 + u * 178,
        envelope = Math.sin(Math.PI * (u * 0.94 + 0.03)) ** 0.42 * (1 - 0.6 * u);
      const mid = 27 - 9 * Math.sin(Math.PI * u);
      const y = mid + (rand() - 0.5) * 30 * envelope;
      const rise = (5 + rand() * 5) * (1 - u),
        run = 2 + u * 7;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.27 + 0.56 * rand()) + ')';
      ctx.lineWidth = 0.8 + rand() * 1.1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + run * 0.3, y - rise * 0.8, x + run, y - rise);
      ctx.stroke();
    }
  });
  textures.push(irisMap, browMap);
  const irisMat = mat({ map: irisMap, roughness: 0.43 }),
    browMat = mat({ color: look.brow, map: browMap, alphaTest: 0.15, alphaToCoverage: true, roughness: 0.81 });
  const lidCounts = 24,
    lidRows = 5;
  function eye(side: number) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * eyeX, eyeY, 0);
    root.add(eyeGroup);
    const eyeball = new THREE.Group();
    eyeGroup.add(eyeball);
    const extent = (x: number) => Math.max(0, 1 - (x / half) ** 2);
    const edge = (x: number, upper: boolean) =>
      (upper ? 0.0076 : -0.0052) * extent(x) ** 0.9 + ((side * x) / half) * look.eyeTilt;
    const eyeZ = (x: number, y: number) =>
      surface(side * eyeX + x, eyeY + y) + 0.00065 + 0.0019 * Math.max(0, extent(x) - (y / 0.018) ** 2);
    const sclera = grid(lidCounts, 4),
      sp = sclera.getAttribute('position'),
      scleraColors: number[] = [];
    const scleraTone = new THREE.Color('#ebe3d9'),
      cornerTone = new THREE.Color('#ac8277');
    for (let j = 0; j <= 4; j++)
      for (let i = 0; i <= lidCounts; i++) {
        const x = mix(-half, half, i / lidCounts),
          y = mix(edge(x, false), edge(x, true), j / 4);
        sp.setXYZ(j * (lidCounts + 1) + i, x, y, eyeZ(x, y));
        tint.copy(scleraTone).lerp(cornerTone, Math.abs(x / half) ** 2.6 * (side * x < 0 ? 0.56 : 0.37));
        tint.multiplyScalar(1 - 0.15 * smooth(j / 4, 0.46, 1) - 0.05 * smooth(1 - j / 4, 0.68, 1));
        scleraColors.push(tint.r, tint.g, tint.b);
      }
    sclera.setAttribute('color', new THREE.Float32BufferAttribute(scleraColors, 3));
    sclera.computeVertexNormals();
    add(sclera, white, eyeball);
    const iris = grid(32, 2),
      ip = iris.getAttribute('position'),
      iu: number[] = [];
    // Polar disc in three concentric rings. The eyelid margin clips its circumference.
    const index: number[] = [];
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 32; i++) {
        const a = j * 33 + i;
        index.push(a, a + 33, a + 1, a + 33, a + 34, a + 1);
      }
    iris.setIndex(index);
    for (let j = 0; j <= 2; j++)
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        iu.push(0.5 + ((0.5 * j) / 2) * Math.cos(a), 0.5 + ((0.5 * j) / 2) * Math.sin(a));
      }
    iris.setAttribute('uv', new THREE.Float32BufferAttribute(iu, 2));
    add(iris, irisMat, eyeball);
    const lids = [false, true].map((upper) => {
      const g = grid(lidCounts, lidRows, !upper),
        p = g.getAttribute('position');
      const color = new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3);
      const normals = new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3);
      g.setAttribute('color', color);
      g.setAttribute('normal', normals);
      add(g, lidSkin, eyeGroup);
      const browInk = new THREE.Color(look.brow);
      const setPose = (open: number) => {
        for (let i = 0; i <= lidCounts; i++) {
          const x = mix(-half, half, i / lidCounts),
            e = extent(x),
            base = edge(x, upper),
            h = (upper ? 0.0074 : -0.0056) * e ** 0.72;
          const margin = base * open;
          for (let j = 0; j <= lidRows; j++) {
            const offset = [0, 0.13, 0.33, 0.61, 0.81, 1][j],
              y = mix(margin, base + h, offset),
              worldX = side * eyeX + x,
              worldY = eyeY + y;
            const normal = surfaceNormal(worldX, worldY);
            const z =
              mix(eyeZ(x, margin) + 0.00051, surface(worldX, worldY) + 0.00012, offset) +
              Math.sin(offset * Math.PI) * 0.00048 * e;
            const idx = j * (lidCounts + 1) + i;
            p.setXYZ(idx, x, y, z);
            normal.y += (upper ? 0.19 : -0.1) * Math.sin(Math.PI * offset) * e;
            normal.normalize();
            normals.setXYZ(idx, normal.x, normal.y, normal.z);
            skinTone(worldX, worldY, Math.sqrt(1 - (worldX / widthAt(worldY)) ** 2), tint).multiplyScalar(0.95);
            if (j === 0) tint.lerp(upper ? browInk : depthColor, (upper ? 0.97 : 0.5) * e ** 0.35);
            if (j === 1 && upper) tint.lerp(browInk, 0.72 * e ** 0.45);
            if (j === 3 && upper) tint.lerp(depthColor, 0.25 * e);
            color.setXYZ(idx, tint.r, tint.g, tint.b);
          }
        }
      };
      // Sample both extremes once. Blink frames only interpolate small buffers.
      setPose(0);
      const positionsClosed = p.array.slice(),
        normalsClosed = normals.array.slice();
      setPose(1.15);
      const positionsOpen = p.array.slice(),
        normalsOpen = normals.array.slice();
      return (open: number) => {
        const fraction = clamp(open / 1.15, 0, 1);
        for (let i = 0; i < positionsClosed.length; i++) {
          p.array[i] = mix(positionsClosed[i], positionsOpen[i], fraction);
          normals.array[i] = mix(normalsClosed[i], normalsOpen[i], fraction);
        }
        p.needsUpdate = normals.needsUpdate = true;
      };
    });
    const brow = new THREE.Group();
    brow.position.set(side * eyeX, look.browHeight, 0);
    root.add(brow);
    const bg = grid(16, 2, side < 0),
      bp = bg.getAttribute('position'),
      bu: number[] = [];
    for (let j = 0; j <= 2; j++)
      for (let i = 0; i <= 16; i++) {
        const t = i / 16,
          x = side * mix(-0.019, 0.0245, t),
          y = 0.0031 * Math.sin(Math.PI * t) - 0.001 * t + (j / 2 - 0.5) * (kind === 'dev' ? 0.0102 : 0.0085);
        bp.setXYZ(j * 17 + i, x, y, surface(side * eyeX + x, look.browHeight + y) + 0.00075);
        bu.push(t, j / 2);
      }
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
    bg.computeVertexNormals();
    add(bg, browMat, brow);
    let oldX = NaN,
      oldY = NaN,
      oldOpen = NaN;
    let oldSquint = NaN;
    return (open: number, squint: number, xLook: number, yLook: number, browAngle: number, lift: number, innerRaise: number, converge: number, dt: number) => {
      if (!Number.isFinite(oldOpen) || Math.abs(oldOpen - open) > 0.0005 || Math.abs(oldSquint - squint) > 0.004) {
        eyeball.scale.y = open;
        // The cheek pushes the lower lid up in a real smile; the upper lid keeps the blink.
        lids[0](open * (1 - 0.55 * squint));
        lids[1](open);
        oldOpen = open;
        oldSquint = squint;
      }
      const cx = clamp(xLook * 0.0048 - side * converge, -0.0042, 0.0042),
        cy = clamp(yLook * 0.0036, -0.0021, 0.0021) + 0.0002;
      if (!Number.isFinite(oldX) || Math.abs(oldX - cx) + Math.abs(oldY - cy) > 0.000045) {
        for (let j = 0; j <= 2; j++)
          for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2,
              radius = (j / 2) * irisRadius,
              x = cx + Math.cos(a) * radius;
            const raw = cy + Math.sin(a) * radius,
              y = clamp(raw, edge(x, false) + 0.00009, edge(x, true) - 0.00009);
            ip.setXYZ(j * 33 + i, x, y, eyeZ(x, y) + 0.00041);
            iris
              .getAttribute('uv')
              .setXY(j * 33 + i, 0.5 + ((x - cx) / irisRadius) * 0.5, 0.5 + ((y - cy) / irisRadius) * 0.5);
          }
        ip.needsUpdate = true;
        iris.getAttribute('uv').needsUpdate = true;
        iris.computeVertexNormals();
        oldX = cx;
        oldY = cy;
      }
      const blend = 1 - Math.exp(-dt * 9);
      brow.rotation.z = mix(brow.rotation.z, side * (browAngle - innerRaise * 0.16), blend);
      brow.position.y = mix(brow.position.y, look.browHeight + lift + innerRaise * 0.0016, blend);
    };
  }
  const eyes = [eye(-1), eye(1)];

  const mouthCols = 28;
  const lips = [false, true].map((upper) => {
    const g = grid(mouthCols, 4, !upper),
      colors: number[] = [];
    for (let j = 0; j <= 4; j++)
      for (let i = 0; i <= mouthCols; i++) {
        const t = j / 4,
          env = Math.sin((Math.PI * i) / mouthCols) ** 0.48;
        tint.copy(skinColorLinear).lerp(lipColor, env * (1 - 0.38 * smooth(t, 0.74, 1)) * (upper ? 0.89 : 1));
        tint.multiplyScalar(mix(upper ? 0.68 : 0.79, 1, smooth(t, 0, 0.5)));
        colors.push(tint.r, tint.g, tint.b);
      }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    add(g, lip);
    return g;
  });
  const gap = grid(mouthCols, 1);
  add(gap, mouth);
  const hair = createCharacterHair(kind, look.width, (angle, y) => {
    const x = widthAt(y) * Math.sin(angle);
    return vec(x, y, Math.cos(angle) > 0 ? surface(x, y) : section(y, 3) * Math.cos(angle));
  });
  root.add(hair.group);
  let lastVoice = NaN,
    lastShape = NaN,
    disposed = false;
  function update(
    time: number,
    dt: number,
    pose: FacePose,
    speaking: boolean,
    amplitude: number,
    lookX: number,
    lookY: number,
    converge = 0,
  ) {
    if (disposed) return;
    hair.update(dt, root.rotation.y, time);
    const smile = pose.smile;
    eyes.forEach((render) =>
      render(pose.eyeOpen, pose.squint, lookX + pose.gazeX, lookY + pose.gazeY, pose.browAngle, pose.browLift, pose.browInner, converge, dt),
    );
    morphFace(smile, pose.asymmetry, pose.browLift, pose.browAngle, pose.jaw);
    const voice = speaking ? clamp(amplitude * 0.86 + Math.max(0, Math.sin(time * 16)) * 0.06, 0, 1) : 0;
    // One scalar summarises the mouth shape so a still face costs nothing per frame.
    const shape = smile * 7 + pose.asymmetry * 3 + pose.press * 5 + pose.jaw * 11;
    if (Number.isFinite(lastVoice) && Math.abs(lastVoice - voice) < 0.004 && Math.abs(lastShape - shape) < 0.012) return;
    const press = pose.press,
      jaw = pose.jaw;
    for (let i = 0; i <= mouthCols; i++) {
      const t = (i / mouthCols) * 2 - 1,
        e = Math.max(0, 1 - t * t),
        corner = smile + pose.asymmetry * 0.3 * t,
        x = t * (look.lipWidth + 0.0032 * Math.max(0, smile) - 0.0008 * Math.max(0, -smile) + 0.0009 * press);
      const centre = 0.00085 * Math.abs(t) + corner * 0.0058 * t * t - 0.00045 * bump(t, 0, 0.3);
      const high = centre + (0.00027 * (1 - 0.6 * press) + voice * 0.0045 + jaw * 0.003) * e,
        low = centre - (0.00027 * (1 - 0.6 * press) + voice * 0.008 + jaw * 0.011) * e;
      const p = gap.getAttribute('position');
      p.setXYZ(i, x, mouthY + low, surface(x, mouthY + low) + 0.0016 * e + 0.0004);
      p.setXYZ(mouthCols + 1 + i, x, mouthY + high, surface(x, mouthY + high) + 0.0016 * e + 0.0004);
      lips.forEach((g, k) => {
        const upper = k === 1,
          margin = upper ? high : low;
        const thin = 1 - 0.38 * press;
        const thick = (upper ? 0.0068 * (1 - 0.3 * bump(t, 0, 0.18) + 0.17 * bump(Math.abs(t), 0.28, 0.17)) : -0.0076) * thin;
        for (let j = 0; j <= 4; j++) {
          const f = j / 4,
            y = mouthY + margin + e * thick * f;
          const depth = e * ((1 - f) * 0.0024 + Math.sin(Math.PI * f) * (upper ? 0.0017 : 0.0024)) * (1 - 0.25 * press);
          g.getAttribute('position').setXYZ(j * (mouthCols + 1) + i, x, y, surface(x, y) + depth + 0.00032);
        }
      });
    }
    for (const g of [...lips, gap]) {
      g.getAttribute('position').needsUpdate = true;
      g.computeVertexNormals();
    }
    lastShape = shape;
    lastVoice = voice;
  }
  update(0, 1 / 60, { smile: 0.12, asymmetry: 0, squint: 0.04, jaw: 0, press: 0, browAngle: 0, browLift: 0, browInner: 0, eyeOpen: 1, gazeX: 0, gazeY: 0, headPitch: 0, headYaw: 0, headRoll: 0, beat: 0, beatHand: 1 }, false, 0, 0, 0);
  return {
    root,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      hair.dispose();
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      root.clear();
    },
  };
}
