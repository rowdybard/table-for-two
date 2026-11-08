import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterKind } from './CharacterBody';

interface Swatches {
  skin: THREE.Material; outer: THREE.Material; lining: THREE.Material;
  shirt: THREE.Material; metal: THREE.Material;
}

export const builds = {
  mira: { shoulders: .166, chest: .142, waist: .116, hips: .175, depth: .092, arm: .043 },
  jules: { shoulders: .173, chest: .156, waist: .137, hips: .164, depth: .096, arm: .046 },
  dev: { shoulders: .199, chest: .177, waist: .146, hips: .164, depth: .111, arm: .054 },
  waiter: { shoulders: .181, chest: .157, waist: .141, hips: .162, depth: .098, arm: .048 },
  diner: { shoulders: .177, chest: .171, waist: .165, hips: .173, depth: .114, arm: .052 },
  friend: { shoulders: .171, chest: .152, waist: .132, hips: .166, depth: .095, arm: .045 },
} as const;

const tau = Math.PI * 2;
const mix = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;
const bell = (n: number, centre: number, spread: number) => Math.exp(-((n - centre) ** 2) / spread ** 2);
type Section = [height: number, halfWidth: number, frontDepth: number, backDepth: number];
type Layer = 'skin' | 'shirt' | 'outer';
type Surface = (y: number, angle: number, layer: Layer, lift?: number) => THREE.Vector3;

function torsoSurface(kind: CharacterKind): Surface {
  const b = builds[kind], neck = kind === 'dev' ? .049 : .041;
  // From the high hip through rib cage, deltoid, trapezius and sternocleidomastoid.
  const sections: Section[] = [
    [.90, b.hips, .098, .109], [.965, b.hips * .97, .099, .105],
    [1.035, b.waist * 1.06, .086, .087], [1.10, b.waist, .082, .084],
    [1.16, b.waist * 1.08, .086, .088], [1.22, b.chest * .96, b.depth, .094],
    [1.268, b.chest, b.depth * 1.01, .095], [1.32, b.chest * 1.04, b.depth * .99, .091],
    [1.364, b.shoulders * .95, b.depth * .84, .084],
    [1.388, b.shoulders * 1.02, b.depth * .75, .075],
    [1.406, b.shoulders, b.depth * .68, .069],
    [1.424, b.shoulders * .83, .059, .063], [1.441, b.shoulders * .53, .046, .055],
    [1.457, neck * 1.27, .038, .049], [1.478, neck * 1.04, .036, .046],
    [1.506, neck * .98, .036, .042], [1.522, neck * .96, .034, .046],
    [1.538, neck * .95, .032, .053], [1.555, neck * .93, .031, .061],
  ];
  const curve = (column: 1 | 2 | 3) => new THREE.SplineCurve(sections.map(r => new THREE.Vector2(r[0], r[column])));
  const widths = curve(1), fronts = curve(2), backs = curve(3);
  return (y, theta, layer, lift = 0) => {
    let i = 0;
    while (i < sections.length - 2 && y > sections[i + 1]![0]) i++;
    const t = THREE.MathUtils.clamp((y - sections[i]![0]) / (sections[i + 1]![0] - sections[i]![0]), 0, 1);
    const address = (i + t) / (sections.length - 1);
    const sin = Math.sin(theta), cos = Math.cos(theta), front = Math.max(0, cos);
    const lateral = Math.abs(sin), neckness = smooth(y, 1.443, 1.48);
    let ease = 0;
    if (layer === 'shirt') {
      const dart = bell(y, 1.16 + lateral * .079, .015) + .55 * bell(y, 1.11 - lateral * .048, .012);
      ease = .0028 + .0031 * dart * lateral;
    }
    if (layer === 'outer') {
      const loose = kind === 'jules' ? .017 + .021 * bell(y, 1.09, .125) : kind === 'dev' ? .006 : .009;
      ease = loose * (1 - neckness * .65);
      // Oblique tension creases from the waist and armscye, pinched where the coat closes.
      const crease = (peak: number, breadth: number) => bell(y, peak, breadth) - .53 * bell(y, peak + .013, breadth * 1.4);
      const handed = sin > 0 ? 1 : -1;
      ease += (.0053 * crease(1.135 + lateral * .077 + handed * .008, .012)
        + .0035 * crease(1.20 - lateral * .091, .0115)
        + .003 * crease(1.367 - lateral * .047, .012)) * (.2 + lateral);
      if (kind === 'dev') ease *= smooth(y, 1.053, 1.107);
      if (kind === 'jules') ease += .007 * bell(y, 1.402, .024) * lateral;
    }
    const width = widths.getPoint(address).y, depth = (cos >= 0 ? fronts : backs).getPoint(address).y;
    const power = .92 + neckness * .08;
    const nape = smooth(y, 1.497, 1.553) * Math.max(0, -cos);
    const x = Math.sign(sin) * Math.abs(sin) ** power * (width + .012 * nape + ease + lift);
    const pectoral = bell(Math.abs(x), kind === 'mira' ? .069 : .080, .052) * bell(y, kind === 'mira' ? 1.285 : 1.318, .054);
    const collarbone = bell(y, 1.397 + .023 * Math.min(1, Math.abs(x) / .12), .006) * bell(Math.abs(x), .067, .055);
    const throat = bell(Math.abs(x), .016 + .023 * (1 - neckness), .008) * bell(y, 1.445, .044);
    const z = Math.sign(cos) * Math.abs(cos) ** power * (depth + ease + lift)
      + front * (pectoral * (kind === 'mira' ? .023 : .013) + .0050 * collarbone + .0025 * throat)
      - .009 * neckness;
    return new THREE.Vector3(x, y - 1.04, z);
  };
}

function grid(columns: number, rows: number, point: (u: number, v: number) => THREE.Vector3) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const u = i / columns, v = j / rows, p = point(u, v);
    positions.push(p.x, p.y, p.z); uv.push(u, v);
    if (j < rows && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

function curvePoints(count: number, point: (t: number) => THREE.Vector3) {
  return Array.from({ length: count + 1 }, (_, i) => point(i / count));
}

export function dressTorso(kind: CharacterKind, parent: THREE.Group, mat: Swatches) {
  const surface = torsoSurface(kind);
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; parent.add(mesh); return mesh;
  };
  const seam = (name: string, points: THREE.Vector3[], radius: number, material: THREE.Material) =>
    add(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 2, radius, 5, false), material);
  const snap = (point: THREE.Vector3, size: number, material: THREE.Material) => {
    const disc = add('button', new THREE.SphereGeometry(1, 10, 7), material);
    disc.scale.set(size, size, size * .45); disc.position.copy(point);
  };
  const isPolo = kind === 'dev', moto = kind === 'mira', suit = kind === 'jules';
  const hem = suit ? .925 : moto ? 1.107 : isPolo ? 1.061 : 1.031;
  const opening = (y: number) => moto ? .36 + .16 * smooth(y, 1.14, 1.35) + .13 * smooth(y, 1.38, 1.45)
    : suit ? .13 - .095 * bell(y, 1.135, .07) + .51 * smooth(y, 1.16, 1.43)
    : .10 + .48 * smooth(y, 1.12, 1.43);
  const neckline = (theta: number) => {
    const arc = Math.acos(THREE.MathUtils.clamp(Math.cos(theta), -1, 1));
    if (isPolo) return 1.455 - .124 * Math.max(0, 1 - arc / .52) ** 1.15;
    const front = Math.max(0, Math.cos(theta)), back = Math.max(0, -Math.cos(theta));
    return 1.442 - (moto ? .129 : .072) * front ** (moto ? 5 : 7) - .045 * back ** 3;
  };
  // Expose only the clavicle and neck. The arm socket and lower chest are inside cloth.
  const neck = grid(52, 26, (u, v) => {
    const angle = u * tau;
    const lower = neckline(angle) - .012;
    return surface(mix(lower, 1.555, v), angle, 'skin');
  });
  const skinTone: number[] = [], p = neck.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i) + 1.04;
    const clavicle = bell(y, 1.403 + .021 * Math.min(1, x / .115), .009) * bell(x, .064, .058);
    const hollow = bell(y, 1.419, .014) * bell(x, 0, .022);
    const jaw = smooth(y, 1.477, 1.524) * .13;
    const shade = (1 - jaw) * (1 - (.102 * clavicle + .09 * hollow) * smooth(p.getZ(i), .009, .059));
    skinTone.push(shade, shade ** 1.14, shade ** 1.21);
  }
  neck.setAttribute('color', new THREE.Float32BufferAttribute(skinTone, 3));
  add('neck-and-clavicles', neck, mat.skin);
  if (!isPolo) {
    // The underlayer ends inside the coat. It cannot poke through a sleeve cap.
    add(moto ? 'satin-camisole' : 'fine-gauge-shell', grid(36, 27, (u, v) => {
      const span = mix(tau, moto ? 1.77 : 1.64, smooth(v, .20, .64));
      const angle = (u - .5) * span;
      return surface(mix(1.054, neckline(angle), v), angle, 'shirt');
    }), mat.shirt);
    seam('bound-neckline', curvePoints(23, t => {
      const a = (t - .5) * 1.65;
      return surface(neckline(a), a, 'shirt', .0006);
    }), .0017, mat.shirt);
  }
  const hemHeight = (a: number) => hem + (suit ? .023 * Math.exp(-Math.abs(Math.sin(a)) * 7) * Math.max(0, Math.cos(a)) : .003 * Math.cos(a * 2));
  add(moto ? 'cropped-leather-jacket' : suit ? 'longline-suit' : isPolo ? 'open-collar-knit' : 'jacket', grid(56, 38, (u, v) => {
    const y = mix(hem, 1.456, v);
    const gap = isPolo ? 0 : opening(y);
    const a = mix(gap, tau - gap, u);
    const actualY = mix(hemHeight(a), isPolo ? neckline(a) : 1.456, v);
    return surface(actualY, a, 'outer');
  }), mat.outer);
  const collarGap = isPolo ? .53 : opening(1.456);
  add('folded-collar-stand', grid(44, 6, (u, v) => {
    const a = mix(collarGap, tau - collarGap, u);
    const rise = .002 + .013 * Math.sin(Math.PI * u) ** .7;
    const outside = surface(1.454, a, 'outer', .0006);
    const inside = surface(1.456 + rise, a, 'skin', -.0004);
    return outside.lerp(inside, v);
  }), mat.lining);
  const hemGap = isPolo ? 0 : opening(hem);
  seam('hem-turn', curvePoints(40, t => {
    const a = mix(hemGap, tau - hemGap, t); return surface(hemHeight(a) + .003, a, 'outer', .0007);
  }), isPolo ? .0018 : .002, mat.lining);

  for (const side of [-1, 1]) {
    if (isPolo) {
      const rows = [
        [1.363, .55, .557], [1.383, .406, .640], [1.403, .353, .759],
        [1.424, .376, .867], [1.443, .470, 1.021], [1.456, .568, 1.34],
      ];
      add('knitted-collar-leaf', fittedPanel(rows, side, surface, .004), mat.lining);
      seam('collar-tipping', panelEdge(rows, side, surface, .0048), .0011, mat.shirt);
      const placket = curvePoints(14, t => {
        const angle = side * t * .50;
        return surface(neckline(angle), angle, 'outer', .0017);
      });
      seam('placket-edge', placket, .0024, mat.lining);
    } else {
      const tip = moto ? 1.185 : 1.133;
      const rows = [
        [tip, opening(tip), opening(tip) + .004],
        [1.256, opening(1.256), moto ? .666 : .548],
        [1.331, opening(1.331), moto ? .856 : .809],
        [1.379, opening(1.379), moto ? .965 : .962],
        [1.385, opening(1.385), moto ? .780 : .795],
        [1.394, opening(1.394), moto ? .925 : 1.018],
        [1.427, opening(1.427), 1.20], [1.454, opening(1.454), 1.41],
      ];
      add('rolled-notched-lapel', fittedPanel(rows, side, surface, .0046), mat.lining);
      seam('lapel-edge', panelEdge(rows, side, surface, .0051), .00115, mat.outer);
      const zipper = curvePoints(23, t => {
        const y = mix(hem + .004, moto ? 1.385 : 1.382, t);
        return surface(y, side * opening(y), 'outer', .0042);
      });
      seam('front-edge', zipper, moto ? .00145 : .0017, moto ? mat.metal : mat.lining);
      const pocketY = moto ? 1.158 : suit ? 1.048 : 1.103;
      const welt = (u: number, v: number) => {
        const y = pocketY + (moto ? .044 : .009) * u + v * .006;
        return surface(y, side * mix(.53, .98, u), 'outer', .0034);
      };
      add('set-in-welt-pocket', grid(12, 2, welt), mat.lining);
      if (moto) {
        seam('pocket-zip', curvePoints(12, t => welt(t, .75)), .00125, mat.metal);
        snap(surface(1.378, side * .856, 'outer', .0064), .0036, mat.metal);
      } else {
        seam('pocket-welt', curvePoints(12, t => welt(t, .15)), .0012, mat.outer);
      }
    }
  }
  if (suit) {
    for (const y of [1.144, 1.071]) snap(surface(y, .099, 'outer', .003), .0057, mat.lining);
    const chest = curvePoints(12, t => surface(1.323 + t * .009, mix(.47, .86, t), 'outer', .0028));
    seam('breast-welt', chest, .0028, mat.lining);
  }
  if (moto) {
    const pendantY = 1.365;
    const necklace = curvePoints(34, t => {
      const x = t * 2 - 1, y = mix(pendantY, 1.458, Math.abs(x) ** 1.65);
      return surface(y, x * .97, 'skin', .0024);
    });
    seam('fine-chain', necklace, .00085, mat.metal);
    const drop = add('pendant', new THREE.SphereGeometry(1, 10, 7), mat.metal);
    drop.scale.set(.0035, .006, .002); drop.position.copy(necklace[17]!); drop.position.y -= .005;
  }
}

/** A rolled cloth panel follows the curved chest, including the cut into a notch. */
function fittedPanel(rows: number[][], side: number, surface: Surface, lift: number) {
  return grid(7, (rows.length - 1) * 4, (u, v) => {
    const [y, inner, outer] = panelRow(rows, v);
    return surface(y!, side * mix(inner!, outer!, u), 'outer', lift + .0035 * Math.sin(Math.PI * u));
  });
}
function panelRow(rows: number[][], t: number) {
  const p = t * (rows.length - 1), i = Math.min(Math.floor(p), rows.length - 2);
  return rows[i]!.map((n, k) => mix(n, rows[i + 1]![k]!, p - i));
}
function panelEdge(rows: number[][], side: number, surface: Surface, lift: number) {
  return curvePoints((rows.length - 1) * 4, t => {
    const [y, , angle] = panelRow(rows, t);
    return surface(y!, side * angle!, 'outer', lift);
  });
}

/** Merge static garment pieces after their final local transforms. Bones remain independent. */
export function batchGarmentPieces(parent: THREE.Object3D, preserve: THREE.Object3D[] = []) {
  const batches = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of parent.children) {
    if (!(child instanceof THREE.Mesh) || child instanceof THREE.SkinnedMesh || Array.isArray(child.material) || preserve.includes(child)) continue;
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material)!.push(child);
  }
  for (const [material, group] of batches) {
    if (group.length < 2) continue;
    const parts = group.map(item => {
      item.updateMatrix();
      const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
      geometry.applyMatrix4(item.matrix); return geometry;
    });
    const combined = mergeGeometries(parts, false);
    parts.forEach(part => part.dispose());
    if (!combined) continue;
    for (const item of group) { parent.remove(item); item.geometry.dispose(); }
    const mesh = new THREE.Mesh(combined, material); mesh.name = group.map(item => item.name).filter(Boolean).join(' ');
    parent.add(mesh);
  }
}
