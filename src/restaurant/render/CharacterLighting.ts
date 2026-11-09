import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { RenderQuality } from './RenderQuality';

/** One small, shared reflection probe; it lights cast materials without changing the venue. */
export function createCharacterEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, .06, .1, 100, { size: 256 });
  } finally {
    room.dispose();
    generator.dispose();
  }
}

/** Apply this to newly created cast too, including a friend's avatar and replacement dates. */
export function prepareCharacterLighting(root: THREE.Object3D, environment: THREE.Texture | null, quality?: Pick<RenderQuality, 'tier'>) {
  const low = quality?.tier === 'low';
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.target) return;
    const cards = object.name.startsWith('hair-cards-') || object.userData.hairCards === true;
    // The venue's shadow texels cannot resolve sub-millimetre strands. The scalp still casts.
    object.castShadow = !low && !cards;
    object.receiveShadow = !low && !cards;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.envMap = low ? null : environment;
      material.envMapIntensity = material.metalness > .5 ? .65 : cards ? .42 : .24;
      // Hair uses a physical anisotropic highlight. On low tier, drop that shader
      // branch without replacing the material (which owns the atlas and cutout).
      if (low && material instanceof THREE.MeshPhysicalMaterial && material.anisotropy !== 0) {
        material.anisotropy = 0;
        material.needsUpdate = true;
      }
    }
  });
}
