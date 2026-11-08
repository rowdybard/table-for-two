import * as THREE from 'three';

export type HairStyle = 'short' | 'curls' | 'bob' | 'wavy';
export type HairOptions = { style: HairStyle; color: number; highlight: number };

/** Hair is built in head-pivot space, with +Z toward the face. */
export function createHair({ style, color, highlight }: HairOptions) {
  const root = new THREE.Group();
  root.name = `hair-${style}`;
  const base = new THREE.Color(color);
  const light = new THREE.Color(highlight);
  const curly = style === 'curls';
  const bob = style === 'bob';
  const wavy = style === 'wavy';
  const long = bob || wavy;
  const rx = curly ? .124 : long ? .121 : .119;
  const ry = curly ? .150 : .145;
  const cy = .014;
  const frontRadius = .115;
  const backRadius = .119;
  const around = 64;
  const rows = 28;
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

  // Hold the forehead line nearly level across the front, then turn it down
  // around the temple. The back and sides of the longer cuts are one surface.
  function edge(theta: number) {
    const a = Math.abs(theta);
    const temple = smooth(.65, 1.42, a);
    const front = .077 - .007 * Math.sin(theta + .45);
    const side = long ? -.070 : curly ? .025 : .035;
    const rear = long ? -.070 : curly ? -.048 : -.062;
    let y = THREE.MathUtils.lerp(front, side, temple);
    y = THREE.MathUtils.lerp(y, rear, smooth(1.55, 2.5, a));
    if (long) {
      y += .004 * (1 + Math.cos(theta)) + (wavy ? .004 * Math.sin(theta * 5 + .4) : 0);
    }
    if (curly) {
      y += .0035 * Math.sin(theta * 7 + .5) + .002 * Math.sin(theta * 11);
    } else {
      y += .0015 * Math.sin(theta * 3 + .7);
    }
    return y;
  }

  function point(theta: number, phi: number) {
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const front = (Math.cos(theta) + 1) * .5;
    const y0 = cy + ry * c;
    const fall = long ? smooth(.005, .065, -y0) * smooth(.83, 1.35, Math.abs(theta)) : 0;
    // Extend a rounded curtain from the crown down behind the jaw. The lower
    // perimeter stays full instead of pinching into separate tapered strands.
    const widthS = long ? THREE.MathUtils.lerp(s, Math.max(s, .88), fall * .85) : s;
    const rz = THREE.MathUtils.lerp(backRadius, frontRadius, front);
    let x = rx * widthS * Math.sin(theta);
    let z = rz * widthS * Math.cos(theta);
    let y = y0 - fall * (bob ? .058 : .046);
    const crown = Math.pow(Math.max(0, s), .8);
    // Broad flowing ridges are part of the silhouette, not drawn-on strands.
    let relief: number;
    if (curly) {
      relief = (.0048 * Math.sin(theta * 8 + phi * 5) * Math.sin(theta * 5 - phi * 7)
        + .0028 * Math.sin(theta * 11 - phi * 4)) * crown;
    } else if (wavy) {
      relief = (.0055 * Math.sin(theta * 5 + phi * 3 + 1.0)
        + .0022 * Math.sin(theta * 9 - phi * 3)) * crown;
    } else if (bob) {
      relief = (.0032 * Math.sin(theta * 5 + phi * 2 + .8)
        + .0015 * Math.sin(theta * 9 + phi * 3)) * crown;
    } else {
      relief = (.0028 * Math.sin(theta * 4 + phi * 2 + .8)
        + .0015 * Math.sin(theta * 7 - phi * 2)) * crown;
    }
    x += Math.sin(theta) * relief;
    z += Math.cos(theta) * relief;
    y += relief * .35;
    if (wavy && fall) {
      const sway = .004 * Math.sin(y * 42 + theta * 3) * fall;
      x += Math.sin(theta) * sway;
      z += Math.cos(theta) * sway;
    }
    return { x, y, z, relief };
  }

  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= around; i++) {
      const theta = -Math.PI + i / around * Math.PI * 2;
      const end = Math.acos(THREE.MathUtils.clamp((edge(theta) - cy) / ry, -.98, .98));
      const phi = .001 + (end - .001) * j / rows;
      const p = point(theta, phi);
      vertices.push(p.x, p.y, p.z);
      const directional = .5 + .5 * Math.sin(theta * (curly ? 8 : 5) + phi * (curly ? 5 : 2) + .8);
      const amount = THREE.MathUtils.clamp(.20 + directional * (curly ? .13 : .10) + p.relief * 7, 0, .48);
      const c = base.clone().lerp(light, amount);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * (around + 1) + i;
      const b = a + around + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Average the duplicated back seam to preserve continuous lighting.
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j <= rows; j++) {
    const a = j * (around + 1);
    const b = a + around;
    const n = new THREE.Vector3(
      normals.getX(a) + normals.getX(b),
      normals.getY(a) + normals.getY(b),
      normals.getZ(a) + normals.getZ(b),
    ).normalize();
    normals.setXYZ(a, n.x, n.y, n.z);
    normals.setXYZ(b, n.x, n.y, n.z);
  }
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .91, metalness: 0 });
  const hair = new THREE.Mesh(geometry, material);
  hair.castShadow = true;
  hair.receiveShadow = true;
  root.add(hair);
  return {
    root,
    dispose() {
      geometry.dispose();
      material.dispose();
      root.clear();
    },
  };
}
