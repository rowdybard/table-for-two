import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFabricMaterial, disposeProceduralMaterial } from './ProceduralMaterials';
import { batchGarmentPieces, builds, dressTorso } from './CharacterWardrobe';

export type CharacterKind = 'mira' | 'jules' | 'dev' | 'waiter' | 'diner' | 'friend';
export interface BodyPerformance {
  guarded: boolean; comfortable: boolean; speaking: boolean; amplitude: number; shared: boolean; phoneActive: boolean;
  /** Seated forward lean from the current feeling, in radians; positive leans in. */
  leanBias?: number;
  /** Speech beat gesture envelope 0..1 and which hand carries it (-1 left, 1 right, 0 both). */
  beat?: number;
  beatHand?: -1 | 0 | 1;
  /**
   * Seated hand overrides in the body's own space (index 0 is the -x hand), blended over the resting pose by
   * weight. Used for the date's business at the table: bites, sips, a hand at the chin.
   */
  arms?: readonly { target: THREE.Vector3; orientation: THREE.Quaternion; weight: number; bend?: THREE.Vector3 }[];
  /** Small vertical shake of the shoulders (a laugh), metres. */
  bounce?: number;
  /** Props held in the +x hand. */
  fork?: boolean;
  phone?: boolean;
  /** The -x hand is closed around a glass. */
  gripGlass?: boolean;
}
export interface CharacterBodyRig {
  root: THREE.Group;
  skinColor: string;
  /** Head centre in the body's local space, including its subtle lean and breathing. */
  headAnchor: THREE.Vector3;
  setSeated(value: boolean): void;
  update(time: number, dt: number, walkingSpeed: number, performance: BodyPerformance): void;
  dispose(): void;
}
interface Ring { y: number; rx: number; rz: number; cx?: number; cz?: number; power?: number; opening?: number; front?: number; crease?: number }
interface Chain {
  root: THREE.Group; upper: THREE.Bone; lower: THREE.Bone; end: THREE.Bone;
  upperLength: number; lowerLength: number; hand?: THREE.Mesh; grip?: THREE.Mesh; phone?: THREE.Group; fork?: THREE.Group;
}
const DATES: readonly CharacterKind[] = ['mira', 'jules', 'dev'];
const DOWN = new THREE.Vector3(0, -1, 0);
const REST: BodyPerformance = { guarded: false, comfortable: false, speaking: false, amplitude: 0, shared: false, phoneActive: false };
const PALETTES = {
  mira: { skin: '#d0a28e', jacket: '#783240', top: '#e9d6be', pants: '#323039', trim: '#883b46', shoe: '#44272c' },
  jules: { skin: '#c9b0a0', jacket: '#344459', top: '#b6c1a7', pants: '#354253', trim: '#405264', shoe: '#573d35' },
  dev: { skin: '#af856d', jacket: '#2c6265', top: '#d3bc92', pants: '#46494d', trim: '#294d50', shoe: '#563d32' },
  waiter: { skin: '#bfa38c', jacket: '#333946', top: '#e0d9c9', pants: '#2c303a', trim: '#242a32', shoe: '#29282b' },
  diner: { skin: '#b8997e', jacket: '#6f687c', top: '#a6967e', pants: '#34323b', trim: '#4d485b', shoe: '#464047' },
  friend: { skin: '#bd927d', jacket: '#68718a', top: '#e7dbcf', pants: '#30313c', trim: '#495269', shoe: '#373740' },
} satisfies Record<CharacterKind, Record<string, string>>;

/** Elliptical/superelliptical cloth sections, joined as one continuous surface. */
function loft(rings: Ring[], segments = 32, openFront = false, cap = true) {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const minY = Math.min(...rings.map(r => r.y)), maxY = Math.max(...rings.map(r => r.y));
  for (const ring of rings) for (let i = 0; i <= segments; i++) {
    const opening = openFront ? ring.opening ?? .4 : 0;
    const a = (openFront ? Math.PI / 2 + opening : 0) + i / segments * (Math.PI * 2 - opening * 2);
    const cos = Math.cos(a), sin = Math.sin(a), power = ring.power ?? .86;
    const x = (ring.cx ?? 0) + Math.sign(cos) * Math.abs(cos) ** power * ring.rx;
    const front = sin > 0 ? ring.front ?? 1 : 1;
    const crease = sin > 0 ? (ring.crease ?? 0) * Math.exp(-Math.pow(cos / .13, 2)) : 0;
    const z = (ring.cz ?? 0) + Math.sign(sin) * Math.abs(sin) ** power * ring.rz * front + crease;
    positions.push(x, ring.y, z);
    uvs.push(i / segments, (ring.y - minY) / Math.max(.001, maxY - minY));
  }
  const ascending = rings.at(-1)!.y >= rings[0]!.y;
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * (segments + 1) + i, b = a + segments + 1;
    if (ascending) indices.push(a, b, a + 1, a + 1, b, b + 1);
    else indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (cap && !openFront) for (const r of [0, rings.length - 1]) {
    const ring = rings[r]!, centre = positions.length / 3;
    positions.push(ring.cx ?? 0, ring.y, ring.cz ?? 0); uvs.push(.5, .5);
    const offset = r * (segments + 1);
    for (let i = 0; i < segments; i++) {
      if ((r === 0) === ascending) indices.push(centre, offset + i, offset + i + 1);
      else indices.push(centre, offset + i + 1, offset + i);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function skinnedGeometry(rings: Ring[], joint: number, segments = 20) {
  const geometry = loft(rings, segments);
  const positions = geometry.getAttribute('position'), weights: number[] = [], indices: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const distance = -positions.getY(i), lower = THREE.MathUtils.smoothstep(distance, joint - .066, joint + .066);
    const wrist = THREE.MathUtils.smoothstep(distance, .477, .539);
    weights.push(1 - lower, lower * (1 - wrist), wrist, 0); indices.push(0, 1, 2, 0);
  }
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  return geometry;
}

function boneChain(upperLength: number, lowerLength: number): Chain {
  const root = new THREE.Group(), upper = new THREE.Bone(), lower = new THREE.Bone(), end = new THREE.Bone();
  lower.position.y = -upperLength; end.position.y = -lowerLength; upper.add(lower); lower.add(end);
  root.add(upper);
  return { root, upper, lower, end, upperLength, lowerLength };
}

function bindSkin(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], bones: THREE.Bone[]) {
  const mesh = new THREE.SkinnedMesh(geometry, material); parent.add(mesh);
  parent.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton(bones); mesh.bind(skeleton); mesh.frustumCulled = false;
  return skeleton;
}

/** Analytical two-bone pose. Deformation stays continuous across elbows and knees. */
function poseChain(rig: Chain, target: THREE.Vector3, preferredBend: THREE.Vector3, endOrientation: THREE.Quaternion, wristFollow = 0) {
  const distance = THREE.MathUtils.clamp(target.length(), .045, rig.upperLength + rig.lowerLength - .0008);
  const direction = target.clone().normalize();
  const bend = preferredBend.clone().addScaledVector(direction, -preferredBend.dot(direction)).normalize();
  if (bend.lengthSq() < .01) bend.set(0, 0, 1);
  const along = (rig.upperLength ** 2 + distance ** 2 - rig.lowerLength ** 2) / (2 * distance);
  const elbow = direction.clone().multiplyScalar(along).addScaledVector(bend, Math.sqrt(Math.max(0, rig.upperLength ** 2 - along ** 2)));
  rig.upper.quaternion.setFromUnitVectors(DOWN, elbow.clone().normalize());
  const lowerDirection = target.clone().sub(elbow).normalize();
  const lowerWorld = new THREE.Quaternion().setFromUnitVectors(DOWN, lowerDirection);
  rig.lower.quaternion.copy(rig.upper.quaternion).invert().multiply(lowerWorld);
  if (wristFollow > 0) {
    const handDirection = DOWN.clone().applyQuaternion(endOrientation);
    const following = handDirection.clone().lerp(lowerDirection, wristFollow).normalize();
    endOrientation.premultiply(new THREE.Quaternion().setFromUnitVectors(handDirection, following));
  }
  rig.end.quaternion.copy(lowerWorld).invert().multiply(endOrientation);
}

function palmGeometry(side: number, gripping = false) {
  // Each finger continues directly out of its metacarpal. Across the palm the
  // four contour strips share edges, then split at the webbing into rounded fingers.
  const pos: number[] = [], uv: number[] = [], ix: number[] = [];
  const spans = 7, lengths = [.063, .069, .064, .051];
  for (let finger = 0; finger < 4; finger++) {
    const length = lengths[finger]!;
    const curl = gripping ? .036 : -.009 - .0025 * finger;
    // Height, palm half-width, palm thickness, finger radius, split, bend.
    const rings = [
      [.007, .0243, .0126, .008, 0, 0], [-.009, .0249, .014, .008, 0, 0],
      [-.027, .0295, .0152, .008, 0, 0], [-.050, .0332, .0147, .0083, 0, 0],
      [-.065, .0334, .0124, .0083, .10, 0], [-.075, .0323, .0107, .008, .52, .025],
      [-.084, .032, .009, .0078, 1, .065],
      [-.076 - length * .32, .032, .008, .0071, 1, .19],
      [-.076 - length * .53, .032, .0075, .0072, 1, .44],
      [-.076 - length * .69, .032, .0070, .0062, 1, .67],
      [-.076 - length * .85, .0318, .0062, .0060, 1, .88],
      [-.076 - length * .95, .0317, .0047, .0050, 1, .98],
      [-.076 - length, .0317, .0012, .0014, 1, 1],
    ];
    for (const face of [-1, 1]) {
      const start = pos.length / 3;
      for (let r = 0; r < rings.length; r++) for (let i = 0; i <= spans; i++) {
        const [y, width, depth, radius, split, bend] = rings[r]! as [number, number, number, number, number, number];
        const u = i / spans, local = -Math.cos(Math.PI * u), across = (finger + (local + 1) / 2) / 2 - 1;
        const centre = (finger - 1.5) * width * .5;
        const x = side * (centre + local * (split < 1 ? width * .25 : radius));
        const web = Math.sqrt(Math.max(0, 1 - across * across)) * depth;
        const fingerDepth = Math.sin(Math.PI * u) * radius * .92;
        const z = curl * bend + face * THREE.MathUtils.lerp(web, fingerDepth, split);
        pos.push(x, y - (1 - split) * .0025 * Math.sin(Math.PI * u), z);
        uv.push((across + 1) * .5, r / (rings.length - 1));
        if (i < spans && r < rings.length - 1) {
          const a = start + r * (spans + 1) + i, b = a + spans + 1;
          if (side * face > 0) ix.push(a, b, a + 1, a + 1, b, b + 1);
          else ix.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
  }
  const palm = new THREE.BufferGeometry();
  palm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  palm.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  palm.setIndex(ix); palm.computeVertexNormals();
  const thumb = loft([
    { y: -.018, rx: .012, rz: .011, cx: -side * .019, cz: -.004 },
    { y: -.037, rx: .0125, rz: .011, cx: -side * .028, cz: -.004 },
    { y: -.051, rx: .0105, rz: .0095, cx: -side * .037, cz: gripping ? .005 : -.005 },
    { y: -.066, rx: .0084, rz: .008, cx: -side * (gripping ? .037 : .044), cz: gripping ? .022 : -.0075 },
    { y: -.078, rx: .0066, rz: .007, cx: -side * (gripping ? .028 : .0445), cz: gripping ? .027 : -.009 },
    { y: -.084, rx: .003, rz: .0035, cx: -side * (gripping ? .026 : .043), cz: gripping ? .027 : -.0095 },
  ], 14);
  const parts = [palm, thumb];
  const result = mergeGeometries(parts, false)!; parts.forEach(part => part.dispose()); return result;
}

const hipX = (kind: CharacterKind) => builds[kind].hips * .507;

/** The two pattern halves meet along a curved rise and share the pelvis and both leg bones.
 *  Their inseams close into individual trouser legs below the crotch. */
function trousers(kind: CharacterKind) {
  const b = builds[kind], flare = kind === 'mira', wide = kind === 'jules';
  const ankle = flare ? .061 : wide ? .059 : .047;
  const rows = [
    [.088, ankle, ankle * 1.23], [.098, ankle + .001, ankle * 1.22], [.118, ankle + .001, ankle * 1.21],
    [.144, ankle + .003, ankle * 1.24], [.169, ankle, ankle * 1.13], [.205, ankle - .002, ankle * 1.08],
    [.28, wide ? .058 : .050, .057], [.35, wide ? .06 : .051, .058], [.397, wide ? .061 : .050, .058],
    [.425, wide ? .062 : .052, .061], [.449, wide ? .063 : .053, .061], [.474, wide ? .066 : .055, .065],
    [.535, wide ? .071 : .061, .069], [.632, wide ? .078 : .071, .077],
    [.725, hipX(kind) * .92, .083], [.778, hipX(kind) * .99, .092],
    [.812, hipX(kind), .098], [.842, hipX(kind), .105], [.874, hipX(kind), .108],
    [.903, hipX(kind), .109], [.932, hipX(kind), .107], [.961, hipX(kind), .102],
    [.986, hipX(kind), .102], [1.015, hipX(kind), .099], [1.046, hipX(kind), .099],
    [1.067, hipX(kind), .099], [1.074, hipX(kind), .098],
  ];
  const pos: number[] = [], uv: number[] = [], ix: number[] = [], bones: number[] = [], weights: number[] = [];
  const seg = 32;
  for (const side of [-1, 1]) {
    const start = pos.length / 3;
    for (let r = 0; r < rows.length; r++) for (let s = 0; s <= seg; s++) {
      const [y, legWidth, depth] = rows[r]! as [number, number, number];
      const u = s / seg, angle = u * Math.PI * 2, rise = THREE.MathUtils.smoothstep(y, .812, .94);
      const front = Math.sin(angle), radial = -Math.cos(angle);
      const hipWidth = THREE.MathUtils.lerp(b.hips, b.waist + .006, THREE.MathUtils.smoothstep(y, .937, 1.062));
      const expanded = THREE.MathUtils.lerp(hipX(kind) + radial * legWidth, hipWidth * Math.sin(Math.PI * u), rise);
      const x = side * expanded;
      const fly = THREE.MathUtils.smoothstep(y, .812, .877);
      const outline = THREE.MathUtils.lerp(front, Math.cos(Math.PI * u), front < 0 ? rise : fly);
      const pleat = Math.exp(-((u - .22) ** 2) / .0011) * (1 - THREE.MathUtils.smoothstep(y, 1.04, 1.073));
      const back = Math.max(0, -outline) * .011 * rise * (1 - THREE.MathUtils.smoothstep(y, .965, 1.055));
      const z = outline * (depth + back) + pleat * (wide ? .008 : .004) - .009;
      const breakAtAnkle = .008 * Math.sin(angle + side * .8) * Math.exp(-((y - .144) ** 2) / .0016);
      pos.push(x, y + breakAtAnkle, z); uv.push((side < 0 ? u : 1 - u) * .52, (y - .08) * 1.40);
      const upper = THREE.MathUtils.smoothstep(y, .395, .484);
      const pelvis = THREE.MathUtils.smoothstep(y, .809, .965);
      const seamBlend = (1 - THREE.MathUtils.smoothstep(expanded, 0, .047)) * THREE.MathUtils.smoothstep(y, .789, .817) * .5;
      const ownHip = side < 0 ? 1 : 3, otherHip = side < 0 ? 3 : 1;
      bones.push(0, ownHip, ownHip + 1, otherHip);
      weights.push(pelvis, (1 - pelvis) * upper * (1 - seamBlend), (1 - pelvis) * (1 - upper), (1 - pelvis) * upper * seamBlend);
      if (s < seg && r < rows.length - 1) {
        const a = start + r * (seg + 1) + s, c = a + seg + 1;
        if (side > 0) ix.push(a, a + 1, c, a + 1, c + 1, c);
        else ix.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bones, 4));
  geometry.setIndex(ix); geometry.computeVertexNormals();
  // Smooth the sewn rise only. Leave the pressed creases on the trouser fronts.
  const normals = geometry.getAttribute('normal'), half = rows.length * (seg + 1), normal = new THREE.Vector3();
  for (let r = 0; r < rows.length; r++) {
    const above = rows[r]![0]! >= .812;
    for (const s of [0, seg]) {
      const a = r * (seg + 1) + s, b = above ? a + half : r * (seg + 1) + seg - s;
      for (const offset of above ? [0] : [0, half]) {
        normal.fromBufferAttribute(normals, a + offset).add(new THREE.Vector3().fromBufferAttribute(normals, b + offset)).normalize();
        normals.setXYZ(a + offset, normal.x, normal.y, normal.z); normals.setXYZ(b + offset, normal.x, normal.y, normal.z);
      }
    }
  }
  const basePos = geometry.getAttribute('position'), baseWeights = geometry.getAttribute('skinWeight');
  const colors = new Array<number>(pos.length).fill(1), detailNormals = Array.from(normals.array);
  // Cut and pressed pocket edges use the very same surface and weights as the
  // trouser rise, so sitting cannot pull the welts through the underlying cloth.
  const seam = (side: number, path: (t: number) => [number, number], acrossU: number, acrossY: number, width: number) => {
    const start = pos.length / 3, steps = 14, sideStart = side < 0 ? 0 : half;
    const ownHip = side < 0 ? 1 : 3, otherHip = side < 0 ? 3 : 1;
    for (let row = 0; row <= steps; row++) {
      const [u, y] = path(row / steps);
      for (let col = 0; col < 4; col++) {
        const offset = col / 3 - .5;
        const lateral = THREE.MathUtils.clamp(u + acrossU * offset, 0, 1) * seg, h = y + acrossY * offset;
        let section = rows.length - 2;
        while (section > 0 && h < rows[section]![0]!) section--;
        const fraction = THREE.MathUtils.clamp((h - rows[section]![0]!) / (rows[section + 1]![0]! - rows[section]![0]!), 0, 1);
        const column = Math.min(seg - 1, Math.floor(lateral)), blend = lateral - column;
        const a = sideStart + section * (seg + 1) + column, b = a + seg + 1;
        const addresses = [a, a + 1, b, b + 1], contribution = [(1-fraction)*(1-blend), (1-fraction)*blend, fraction*(1-blend), fraction*blend];
        const point = new THREE.Vector3(), normal = new THREE.Vector3(), scratch = new THREE.Vector3(), weight = [0,0,0,0];
        for (let j = 0; j < 4; j++) {
          const index = addresses[j]!, amount = contribution[j]!;
          point.addScaledVector(scratch.fromBufferAttribute(basePos, index), amount);
          normal.addScaledVector(scratch.fromBufferAttribute(normals, index), amount);
          for (let k = 0; k < 4; k++) weight[k] = weight[k]! + baseWeights.getComponent(index, k) * amount;
        }
        normal.normalize(); point.addScaledVector(normal, ([.20, .48, 1, .20][col]! * width) + .00075);
        pos.push(point.x, point.y, point.z); detailNormals.push(normal.x,normal.y,normal.z);
        uv.push((side < 0 ? u : 1-u)*.52, (h-.08)*1.4);
        bones.push(0, ownHip, ownHip + 1, otherHip); weights.push(...weight);
        const shade = [.72, .62, 1.13, .95][col]!;
        colors.push(shade, shade, shade);
      }
    }
    const p0 = new THREE.Vector3().fromArray(pos, start * 3);
    const dv = new THREE.Vector3().fromArray(pos, (start + 4) * 3).sub(p0);
    const du = new THREE.Vector3().fromArray(pos, (start + 1) * 3).sub(p0);
    const forward = dv.cross(du).dot(new THREE.Vector3().fromArray(detailNormals, start * 3)) > 0;
    for (let r = 0; r < steps; r++) for (let c = 0; c < 3; c++) {
      const i = start + r * 4 + c, j = i + 4;
      if (forward) ix.push(i,j,i+1,i+1,j,j+1);
      else ix.push(i,i+1,j,i+1,j+1,j);
    }
  };
  for (const side of [-1,1]) {
    seam(side, t => [.204 + .190 * t, 1.046 - .095 * t], .011, 0, .0016);
    seam(side, t => [.649 + .203 * t, .990 - .005 * t], 0, .009, .0022);
  }
  seam(1, t => [.016 + .037 * Math.sin(Math.PI * t), 1.046 - .125 * t], .006, 0, .0009);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(detailNormals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(bones, 4));
  geometry.setIndex(ix);
  return geometry;
}

/** Sleeve heads follow the deltoid. Localized fabric folds deform with the two-bone elbow. */
function armGeometry(kind: CharacterKind, side: number) {
  const b = builds[kind], short = kind === 'dev', slack = kind === 'jules' ? .010 : .004;
  const shoulder = b.arm + slack;
  const sections: Ring[] = [
    { y: .046, rx: .013, rz: .023, cx: -side * .031 }, { y: .036, rx: shoulder * .62, rz: shoulder * .70, cx: -side * .017 },
    { y: .020, rx: shoulder * .9, rz: shoulder * .94, cx: -side * .006 },
    { y: -.008, rx: shoulder, rz: shoulder * 1.04 }, { y: -.051, rx: shoulder * 1.02, rz: shoulder * 1.02 },
    { y: -.091, rx: shoulder * .95, rz: shoulder * .97, cx: side * .002 }, { y: -.153, rx: shoulder * .9, rz: shoulder * .96 },
  ];
  if (short) {
    sections.push({ y: -.179, rx: b.arm * .97, rz: b.arm * 1.03 }, { y: -.192, rx: b.arm * .96, rz: b.arm * 1.02 });
    const sleeve = skinnedGeometry(sections, .29, 26);
    const forearm = skinnedGeometry([
      { y: -.185, rx: .047, rz: .050 }, { y: -.207, rx: .046, rz: .047, cz: .001 },
      { y: -.25, rx: .038, rz: .041, cx: side * .001 }, { y: -.282, rx: .035, rz: .035, cz: -.003 },
      { y: -.301, rx: .036, rz: .036, cx: side * .002 }, { y: -.328, rx: .040, rz: .039, cx: side * .003 },
      { y: -.362, rx: .042, rz: .039, cx: side * .003 }, { y: -.407, rx: .038, rz: .035 },
      { y: -.453, rx: .032, rz: .028 }, { y: -.505, rx: .027, rz: .020 },
      { y: -.54, rx: .025, rz: .014 },
    ], .29, 26);
    const band = skinnedGeometry([{ y: -.177, rx: b.arm * .981, rz: b.arm * 1.038 }, { y: -.194, rx: b.arm * .973, rz: b.arm * 1.031 }], .29, 26);
    const combined = mergeGeometries([sleeve, forearm, band], true)!; [sleeve, forearm, band].forEach(g => g.dispose()); return combined;
  }
  const elbow = b.arm * .76 + slack, cuff = .0255 + slack;
  for (const [y, width] of [[-.19, elbow * 1.03], [-.219, elbow], [-.235, elbow * 1.055], [-.252, elbow * .95],
    [-.273, elbow * 1.02], [-.298, elbow], [-.317, elbow * .97], [-.351, elbow * 1.02], [-.391, elbow * .95],
    [-.437, elbow * .86], [-.478, cuff * 1.12], [-.498, cuff * 1.15], [-.515, cuff * 1.02], [-.532, cuff]]) {
    sections.push({ y: y!, rx: width!, rz: width! * .95 });
  }
  const cuffStart = sections.length - 1;
  sections.push({ y: -.534, rx: cuff * .92, rz: cuff * .84 }, { y: -.543, rx: cuff * .92, rz: cuff * .84 });
  const geo = skinnedGeometry(sections, .29, 26);
  const sleeveIndices = cuffStart * 26 * 6;
  geo.addGroup(0, sleeveIndices, 0);
  geo.addGroup(sleeveIndices, geo.index!.count - sleeveIndices, 1);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), theta = Math.atan2(p.getX(i) * side, p.getZ(i));
    const elbowFold = Math.exp(-((y + .257) ** 2) / .004);
    const cuffFold = Math.exp(-((y + .49) ** 2) / .0013);
    const fold = .0045 * Math.sin(theta * 2.0 + y * 107) * elbowFold + .0028 * Math.cos(theta * 2 - y * 91) * cuffFold;
    p.setXYZ(i, p.getX(i) + side * Math.sin(theta) * fold, y + Math.cos(theta) * (.015 * elbowFold + .008 * cuffFold), p.getZ(i) + Math.cos(theta) * fold);
  }
  geo.computeVertexNormals(); return geo;
}

class TailoredBody implements CharacterBodyRig {
  readonly root = new THREE.Group();
  readonly headAnchor = new THREE.Vector3(0, 1.62, 0);
  readonly skinColor: string;
  private readonly upperBody = new THREE.Group();
  private readonly pelvis = new THREE.Bone();
  private readonly skeletons: THREE.Skeleton[] = [];
  private readonly arms: Chain[] = [];
  private readonly legs: Chain[] = [];
  private readonly materials = new Set<THREE.MeshStandardMaterial>();
  private seated = false;
  private gait = 0;
  private walkBlend = 0;
  private lean = 0;
  private readonly bendScratch = new THREE.Vector3();
  private seed: number;
  private disposed = false;

  constructor(private readonly kind: CharacterKind) {
    const palette = PALETTES[kind]; this.skinColor = palette.skin; this.seed = kind.length * .7;
    this.root.name = `${kind}-tailored-body`;
    const fabric = (color: string, type: 'woven' | 'knit' | 'satin' | 'leather') => { const m = createFabricMaterial(color, type); this.materials.add(m); return m; };
    const solid = (color: string, roughness = .75, metalness = 0) => { const m = new THREE.MeshStandardMaterial({ color, roughness, metalness }); this.materials.add(m); return m; };
    const skin = solid(palette.skin, .78), pants = fabric(palette.pants, 'woven');
    pants.vertexColors = true;
    const jacket = fabric(palette.jacket, kind === 'mira' ? 'leather' : kind === 'dev' ? 'knit' : 'woven');
    const top = fabric(palette.top, kind === 'mira' ? 'satin' : 'knit');
    const trim = fabric(palette.trim, kind === 'mira' ? 'leather' : kind === 'dev' ? 'knit' : 'woven');
    jacket.side = top.side = trim.side = THREE.DoubleSide;
    // Small thread and grain detail, with larger folds carried by the actual cut.
    for (const cloth of [jacket, top, trim, pants]) {
      for (const map of [cloth.map, cloth.roughnessMap, cloth.bumpMap]) map?.repeat.set(4, 2.5);
      cloth.bumpScale *= .42;
    }
    const metal = solid(kind === 'mira' ? '#d3af75' : '#b7afa0', .28, .78);
    const shoeMaterial = fabric(palette.shoe, 'leather'), sole = solid('#292529', .88);
    const belt = fabric(kind === 'mira' ? '#483339' : '#43362f', 'leather');
    const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material) => { const mesh = new THREE.Mesh(geometry, material); parent.add(mesh); return mesh; };
    const neckSkin = skin.clone(); neckSkin.vertexColors = true; this.materials.add(neckSkin);
    dressTorso(kind, this.upperBody, { skin: neckSkin, outer: jacket, lining: trim, shirt: top, metal });
    const build = builds[kind];
    if (kind === 'waiter') {
      const apron = add(this.upperBody, loft([{ y: -.166, rx: .169, rz: .115 }, { y: .013, rx: build.waist + .012, rz: .104 }], 32, true, false), fabric('#bfb5a4', 'woven'));
      apron.rotation.y = Math.PI; apron.name = 'service-apron';
    }
    this.upperBody.position.y = 1.04;
    this.root.add(this.upperBody, this.pelvis);
    const waistY = 1.068;
    const waist = build.waist + .008;
    add(this.pelvis, loft([
      { y: waistY - .015, rx: waist + .002, rz: .102, cz: -.009 },
      { y: waistY + .006, rx: waist, rz: .101, cz: -.009 },
    ], 36), belt);
    if (kind !== 'jules') {
      const buckle = add(this.pelvis, new THREE.TorusGeometry(.010, .0018, 5, 16), metal);
      buckle.scale.x = 1.55; buckle.position.set(0, waistY - .004, .094);
    }

    for (const side of [-1, 1]) {
      const arm = boneChain(.29, .25);
      // parent-space socket stays just inside the torso; the cap adds the outer deltoid.
      arm.root.position.set(side * (build.shoulders - .009), .338, -.005);
      this.upperBody.add(arm.root); this.arms.push(arm);
      const sleeveMaterial = kind === 'dev' ? [jacket, skin, trim]
        : [kind === 'waiter' ? top : jacket, kind === 'jules' || kind === 'waiter' ? top : trim];
      this.skeletons.push(bindSkin(arm.root, armGeometry(kind, side), sleeveMaterial, [arm.upper, arm.lower, arm.end]));
      const hand = add(arm.end, palmGeometry(side), skin); arm.hand = hand;
      if ((kind === 'mira' && side === -1) || (kind === 'dev' && side === 1)) {
        const bracelet = add(arm.end, new THREE.TorusGeometry(.0255, .0014, 5, 24), metal);
        bracelet.rotation.x = Math.PI / 2; bracelet.scale.y = .70; bracelet.position.y = kind === 'dev' ? .018 : -.008;
      }
      if (DATES.includes(kind)) {
        // The dates hold things: a glass in the -x hand, the fork and now and then a phone in the +x hand.
        arm.grip = add(arm.end, palmGeometry(side, true), skin); arm.grip.visible = false;
        if (side === 1) {
          const fork = new THREE.Group(), steel = solid('#d9d8d3', .22, 1);
          const shaft = add(fork, new THREE.BoxGeometry(.006, .15, .0035), steel); shaft.position.set(0, -.075, 0);
          for (let tine = 0; tine < 4; tine++) { const t = add(fork, new THREE.BoxGeometry(.0016, .04, .0016), steel); t.position.set((tine - 1.5) * .0042, -.168, .002); }
          fork.position.set(-.004, -.045, .018); fork.rotation.set(-.35, 0, .25);
          arm.end.add(fork); arm.fork = fork; fork.visible = false;
          const phone = new THREE.Group();
          const casing = add(phone, new THREE.BoxGeometry(.068, .14, .008), solid('#22252c', .4)); casing.position.set(0, -.07, .026);
          const screen = add(phone, new THREE.PlaneGeometry(.058, .124), solid('#9fb6c4', .3)); screen.position.set(0, -.07, .0302);
          (screen.material as THREE.MeshStandardMaterial).emissive.set('#5d7280'); (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = .6;
          arm.end.add(phone); arm.phone = phone; phone.visible = false;
        }
      }
      if (kind === 'diner' && side === 1) {
        arm.grip = add(arm.end, palmGeometry(side, true), skin); arm.grip.visible = false;
        const phone = new THREE.Group();
        const casing = add(phone, new THREE.BoxGeometry(.06, .127, .009), solid('#252932', .45)); casing.position.set(0, -.073, .024);
        const screen = add(phone, new THREE.PlaneGeometry(.049, .107), solid('#526d76', .3)); screen.position.set(0, -.073, .029);
        arm.end.add(phone); arm.phone = phone; phone.visible = false;
      }

      const leg = boneChain(.41, .36);
      leg.root.position.set(side * hipX(kind), .85, -.009); this.root.add(leg.root); this.legs.push(leg);
      const shoe = loft([
        { y: -.074, rx: .025, rz: .026, cz: .025, power: .55 }, { y: -.055, rx: .038, rz: .038, cz: .025, power: .55 },
        { y: .02, rx: .044, rz: .040, cz: .025, power: .66 }, { y: .11, rx: .044, rz: .027, cz: .039, power: .65 },
        { y: .17, rx: .036, rz: .023, cz: .041, power: .62 }, { y: .194, rx: .014, rz: .013, cz: .045, power: .65 },
      ], 24); shoe.rotateX(Math.PI / 2); add(leg.end, shoe, shoeMaterial);
      const outsole = loft([
        { y: -.077, rx: .028, rz: .01, cz: .066, power: .5 }, { y: -.06, rx: .041, rz: .011, cz: .066, power: .5 },
        { y: .10, rx: .047, rz: .01, cz: .066, power: .55 }, { y: .18, rx: .039, rz: .01, cz: .066, power: .55 }, { y: .20, rx: .018, rz: .009, cz: .066, power: .55 },
      ], 24); outsole.rotateX(Math.PI / 2); add(leg.end, outsole, sole);
      if (kind === 'mira') add(leg.end, loft([{ y: .005, rx: .034, rz: .039 }, { y: .09, rx: .032, rz: .035 }], 24), shoeMaterial);
      if (kind === 'jules' || kind === 'dev') {
        // A low saddle strap follows the vamp of the loafer.
        const strap = loft([{ y: .05, rx: .0415, rz: .032, cz: .030 }, { y: .082, rx: .0445, rz: .030, cz: .034 }], 22, false, false);
        strap.rotateX(Math.PI / 2); add(leg.end, strap, belt);
      }
      batchGarmentPieces(leg.end);
      batchGarmentPieces(arm.end, [arm.hand!, ...(arm.grip ? [arm.grip] : [])]);
    }
    const [left, right] = this.legs;
    this.skeletons.push(bindSkin(this.root, trousers(kind), pants, [this.pelvis, left!.upper, left!.lower, right!.upper, right!.lower]));
    batchGarmentPieces(this.upperBody); batchGarmentPieces(this.pelvis);
    this.setSeated(false);
    this.update(0, 0, 0, REST);
  }

  setSeated(value: boolean) { this.seated = value; }

  update(time: number, dt: number, walkingSpeed: number, performance: BodyPerformance) {
    if (this.disposed) return;
    const move = this.seated ? 0 : THREE.MathUtils.clamp(walkingSpeed / 1.2, 0, 1);
    this.walkBlend = THREE.MathUtils.lerp(this.walkBlend, move, dt > 0 ? 1 - Math.exp(-dt * 10) : 1);
    this.gait += Math.min(walkingSpeed, 2.5) * dt * 6;
    const breath = Math.sin(time * 1.7 + this.seed) * .0018;
    const lowering = THREE.MathUtils.lerp(.005, .017, this.walkBlend);
    const restPose = this.seated ? 0 : 1 - this.walkBlend, weightSide = this.kind === 'jules' ? 1 : -1;
    this.pelvis.position.x = restPose * weightSide * .004;
    this.pelvis.position.y = this.seated ? -.295 : -lowering;
    this.upperBody.position.set(this.pelvis.position.x, (this.seated ? .745 : 1.04 - lowering) + breath + (this.seated ? performance.bounce ?? 0 : 0), 0);
    const leanTarget = this.seated ? (performance.guarded ? -.055 : performance.comfortable ? .025 : .005) + (performance.leanBias ?? 0) : 0;
    this.lean = THREE.MathUtils.lerp(this.lean, leanTarget, dt > 0 ? 1 - Math.exp(-dt * 5) : 1);
    this.upperBody.rotation.set(this.lean, restPose * weightSide * .018, restPose * weightSide * .011 + this.walkBlend * Math.sin(this.gait) * .008);
    this.upperBody.updateMatrix();
    this.headAnchor.set(0, .58, 0).applyMatrix4(this.upperBody.matrix);

    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!, side = i ? 1 : -1;
      const gesture = performance.speaking ? Math.max(0, Math.sin(time * 2.3 + i * .9)) * (.035 + Math.min(1, performance.amplitude) * .025) : 0;
      let target: THREE.Vector3, handOrientation: THREE.Quaternion, bend: THREE.Vector3 | undefined;
      if (this.seated) {
        const carries = (performance.beatHand ?? 1) === 0 || (performance.beatHand ?? 1) === side;
        const beat = carries && !performance.guarded ? (performance.beat ?? 0) : 0;
        // A beat lifts the hand off the cloth, turns the palm up and opens toward the other person.
        target = new THREE.Vector3(side * ((performance.guarded ? .14 : .18) + beat * .03), (performance.guarded ? .80 : .808 + (i === 0 || performance.shared ? gesture : 0)) + beat * .085, (performance.guarded ? .29 : .385) + beat * .04);
        handOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - gesture * 2 + beat * 1.1, side * ((performance.guarded ? .25 : .06) + beat * .3), side * (.035 - beat * .5)));
        const override = performance.arms?.[i];
        if (override && override.weight > .001) {
          const w = Math.min(1, override.weight);
          target.lerp(override.target, w); handOrientation.slerp(override.orientation, w);
          if (override.bend) bend = this.bendScratch.set(side * .47, -.55, -.69).lerp(override.bend, w);
        }
      } else {
        const swing = Math.sin(this.gait + i * Math.PI) * .075 * this.walkBlend;
        const posed = this.kind === 'mira' && i === 1 || this.kind === 'dev' && i === 0;
        const stance = this.kind === 'dev' ? .21 : this.kind === 'jules' ? .194 : .19;
        const atHip = posed ? restPose : 0;
        target = new THREE.Vector3(side * THREE.MathUtils.lerp(stance, .152, atHip), .877 - lowering + .130 * atHip,
          .036 + swing + atHip * .069);
        if (this.kind === 'waiter' && performance.shared && this.walkBlend < .1) target.set(side * .19, 1.03, .22 + gesture);
        handOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.065, side * THREE.MathUtils.lerp(1.35, .38, atHip), side * -.045));
      }
      const phone = this.kind === 'diner' && i === 1 && performance.phoneActive;
      if (phone) { target.set(.235, 1.46, .07); handOrientation.setFromEuler(new THREE.Euler(0, .1, Math.PI)); }
      const held = this.seated && (i === 1 ? !!performance.fork || !!performance.phone : !!performance.gripGlass);
      if (arm.phone) arm.phone.visible = phone || this.seated && i === 1 && !!performance.phone;
      if (arm.fork) arm.fork.visible = this.seated && i === 1 && !!performance.fork && !performance.phone;
      if (arm.grip) arm.grip.visible = phone || held;
      if (arm.hand) arm.hand.visible = !(phone || held);
      arm.root.updateMatrix();
      const transform = this.upperBody.matrix.clone().multiply(arm.root.matrix);
      target.applyMatrix4(transform.clone().invert());
      const bodyOrientation = new THREE.Quaternion().setFromRotationMatrix(transform);
      handOrientation.premultiply(bodyOrientation.invert());
      poseChain(arm, target, bend ?? new THREE.Vector3(side * (this.seated ? .47 : .36), -.55, -.69), handOrientation, phone ? 0 : this.seated ? .10 : .72);
    }
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!, side = i ? 1 : -1;
      leg.root.position.set(side * hipX(this.kind) + this.pelvis.position.x, this.seated ? .55 : .85 - lowering, this.seated ? -.01 : -.009);
      const phase = this.gait + i * Math.PI;
      const freeLeg = side !== weightSide;
      const target = this.seated ? new THREE.Vector3(side * .005, -.47, .44) : new THREE.Vector3(
        side * restPose * (freeLeg ? .019 : .008),
        -.77 + lowering + Math.max(0, Math.cos(phase)) * .042 * this.walkBlend,
        Math.sin(phase) * .135 * this.walkBlend + restPose * (freeLeg ? .052 : -.018));
      const footOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.seated ? 0 : Math.max(0, Math.cos(phase)) * -.12 * this.walkBlend, side * (.035 + restPose * (freeLeg ? .12 : .056)), 0));
      poseChain(leg, target, new THREE.Vector3(0, 0, 1), footOrientation);
    }
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry); });
    geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => disposeProceduralMaterial(material));
    this.skeletons.forEach(skeleton => skeleton.dispose());
    this.root.clear();
  }
}

export function createCharacterBody(kind: CharacterKind): CharacterBodyRig { return new TailoredBody(kind); }
