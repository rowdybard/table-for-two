import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type PlantSpecies = 'rubber-tree' | 'parlor-palm';

function leafTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 128, 0);
  gradient.addColorStop(0, '#536c38'); gradient.addColorStop(.48, '#7c9355'); gradient.addColorStop(.52, '#657f40'); gradient.addColorStop(1, '#425f32');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 256);
  ctx.strokeStyle = '#a3ae6f'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(64, 256); ctx.lineTo(64, 0); ctx.stroke();
  for (let n = 1; n < 9; n++) for (const side of [-1, 1]) {
    const y = n * 27;
    ctx.strokeStyle = 'rgba(187,194,130,.38)'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.moveTo(64, y + 24); ctx.quadraticCurveTo(64 + side * 28, y + 10, 64 + side * 60, y - 13); ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas); map.name = 'authored-leaf-veins'; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return map;
}

/** A continuous curved blade with pointed tip, cupped edges and a raised midrib. */
export function createLeafBladeGeometry(narrow = false) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const rows = 12, cols = 6;
  for (let y = 0; y <= rows; y++) {
    const t = y / rows, width = Math.pow(Math.sin(Math.PI * t), narrow ? .72 : .8) * (narrow ? .12 : .36);
    for (let x = 0; x <= cols; x++) {
      const across = x / cols * 2 - 1;
      positions.push(across * width, t, Math.sin(Math.PI * t) * (narrow ? .065 : .18) - t * t * (narrow ? .035 : .12) + across * across * (narrow ? .018 : .08) * Math.sin(Math.PI * t));
      uv.push(x / cols, t);
      if (y < rows && x < cols) { const a = y * (cols + 1) + x; indices.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1); }
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createBotanicalPlant(species: PlantSpecies, height = 1.1, seed = 0) {
  const root = new THREE.Group(); root.name = `botanical-${species}`;
  const map = leafTexture();
  const leafMaterial = new THREE.MeshStandardMaterial({ color: species === 'rubber-tree' ? '#8ca774' : '#a7b87b', map, side: THREE.DoubleSide, roughness: species === 'rubber-tree' ? .62 : .83 });
  leafMaterial.name = `${species}-veined-leaves`;
  const stemMaterial = new THREE.MeshStandardMaterial({ color: species === 'rubber-tree' ? '#685b36' : '#687744', roughness: .9 }); stemMaterial.name = `${species}-branches`;
  const stems: THREE.BufferGeometry[] = [], transforms: THREE.Matrix4[] = [];
  const line = (points: THREE.Vector3[], radius: number) => { stems.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 7, radius, 5, false)); };
  const blade = (base: THREE.Vector3, direction: THREE.Vector3, length: number, roll: number) => {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
    transforms.push(new THREE.Matrix4().compose(base, quaternion, new THREE.Vector3(length, length, length)));
  };
  if (species === 'rubber-tree') {
    for (let branch = 0; branch < 3; branch++) {
      const a = seed + branch * 2.25, tip = new THREE.Vector3(Math.cos(a) * .13, .43 + height * (.78 + branch * .08), Math.sin(a) * .13);
      line([new THREE.Vector3(0, .34, 0), new THREE.Vector3(Math.cos(a) * .035, .85, Math.sin(a) * .035), tip], .012 - branch * .002);
      for (let i = 0; i < 8; i++) {
        const fraction = .25 + i * .09, y = .43 + (tip.y - .43) * fraction, angle = a + i * 2.4;
        const base = new THREE.Vector3(tip.x * fraction, y, tip.z * fraction), reach = .09 + (i % 3) * .015;
        const attachment = base.clone().add(new THREE.Vector3(Math.cos(angle) * reach, .035, Math.sin(angle) * reach));
        line([base, attachment], .0025);
        blade(attachment, new THREE.Vector3(Math.cos(angle) * .88, .35 + (i % 2) * .25, Math.sin(angle) * .88), .23 + (7 - i) * .01, angle * .15);
      }
    }
  } else {
    for (let frond = 0; frond < 7; frond++) {
      const angle = seed + frond * 2.39996, peak = .74 + height * (.45 + (frond % 3) * .1), spread = .25 + (frond % 2) * .08;
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .34, 0), new THREE.Vector3(Math.cos(angle) * .05, peak * .82, Math.sin(angle) * .05), new THREE.Vector3(Math.cos(angle) * spread, peak, Math.sin(angle) * spread)]);
      stems.push(new THREE.TubeGeometry(path, 14, .0055, 5, false));
      for (let i = 2; i < 10; i++) {
        const t = i / 10, origin = path.getPoint(t), outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), across = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        for (const side of [-1, 1]) {
          const direction = across.clone().multiplyScalar(side * .8).add(outward.clone().multiplyScalar(.32)).add(new THREE.Vector3(0, .18 - t * .12, 0));
          blade(origin, direction, .18 * (1 - t * .42), angle * .2);
        }
      }
      blade(path.getPoint(1), new THREE.Vector3(Math.cos(angle) * .7, .08, Math.sin(angle) * .7), .13, 0);
    }
  }
  const leaves = new THREE.InstancedMesh(createLeafBladeGeometry(species === 'parlor-palm'), leafMaterial, transforms.length); leaves.name = `${species}-individual-leaf-blades`;
  transforms.forEach((matrix, index) => { leaves.setMatrixAt(index, matrix); leaves.setColorAt(index, new THREE.Color().setHSL(.24 + (index % 3) * .014, .3, .7 + (index % 4) * .045)); });
  leaves.instanceMatrix.needsUpdate = true; leaves.computeBoundingSphere(); root.add(leaves);
  const geometry = mergeGeometries(stems, false)!; stems.forEach(stem => stem.dispose());
  const branches = new THREE.Mesh(geometry, stemMaterial); branches.name = `${species}-branch-network`; root.add(branches);
  root.userData.leafCount = transforms.length; root.userData.species = species;
  return { root, materials: [leafMaterial, stemMaterial], textures: [map] };
}
