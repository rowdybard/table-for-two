import * as THREE from 'three';
import { BAR_STRIPS, GLOW_LINEAR, PENDANTS, PENDANT_Y } from './VenueContract';

/** fromScene(proxy, sigma, near, far, { size, position }) for the venue reflection map. */
export const VENUE_ENV_BAKE = { sigma: .02, near: .1, far: 30, size: 256, position: [0, 1.2, -1.15] } as const;
export const VENUE_GLASS_CACHE_KEY = 'venue-glass-1';

/** Interior shell of the dining room in metres. The key-light shadow box is fitted to it too. */
export const VENUE_ROOM = { min: [-6.75, 0, -7.25], max: [6.75, 3.5, 7.25] } as const;

const linear = (r: number, g: number, b: number, scale = 1) => new THREE.Color().setRGB(r * scale, g * scale, b * scale, THREE.LinearSRGBColorSpace);

export interface VenueEnvironmentProxy {
  readonly scene: THREE.Scene;
  dispose(): void;
}

/**
 * A coarse, emissive stand-in for the dining room: warm walls, a dim floor and ceiling,
 * the pendant mouths, the bar strips, rain-blue windows and the rose booths. It is rendered
 * once into a PMREM and kept so the map can be rebuilt after a lost WebGL context.
 */
export function createVenueEnvironmentProxy(): VenueEnvironmentProxy {
  const scene = new THREE.Scene();
  scene.name = 'venue-environment-proxy';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const basic = (color: THREE.Color, side: THREE.Side = THREE.FrontSide) => {
    const material = new THREE.MeshBasicMaterial({ color, side, fog: false, toneMapped: false });
    materials.push(material);
    return material;
  };
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return mesh;
  };

  const [minX, minY, minZ] = VENUE_ROOM.min, [maxX, maxY, maxZ] = VENUE_ROOM.max;
  const wall = basic(linear(.30, .245, .19), THREE.BackSide);
  // BoxGeometry groups: +x, -x, +y (ceiling), -y (floor), +z, -z.
  add(new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ), [
    wall, wall, basic(linear(.06, .05, .045), THREE.BackSide), basic(linear(.10, .085, .07), THREE.BackSide), wall, wall,
  ], (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);

  const pendantGlow = basic(linear(GLOW_LINEAR[0], GLOW_LINEAR[1], GLOW_LINEAR[2], 6), THREE.DoubleSide);
  for (const [x, z] of PENDANTS) {
    const disc = add(new THREE.CircleGeometry(.3, 24), pendantGlow, x, PENDANT_Y.mouth, z);
    disc.rotation.x = Math.PI / 2;
  }

  const stripGlow = basic(linear(GLOW_LINEAR[0], GLOW_LINEAR[1], GLOW_LINEAR[2], 4));
  for (const y of BAR_STRIPS.y) add(new THREE.BoxGeometry(BAR_STRIPS.halfLength * 2, .03, .03), stripGlow, 0, y, BAR_STRIPS.z);

  const rain = basic(linear(.07, .11, .20), THREE.DoubleSide);
  for (const [start, end] of [[-6.21, -3.09], [-2.36, .76], [1.64, 4.76]] as const) {
    const pane = add(new THREE.PlaneGeometry(end - start, 1.9), rain, minX + .01, 2.02, (start + end) / 2);
    pane.rotation.y = Math.PI / 2;
  }
  for (const x of [-4.4, 4.4]) add(new THREE.PlaneGeometry(3.04, 1.9), rain, x, 2.05, minZ + .12);

  const booth = basic(linear(1, .42, .48, .25));
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(1.16, 1.4, 4.8), booth, side * 4.8, .7, 1);

  return {
    scene,
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      scene.clear();
    },
  };
}

export interface VenueEnvironment {
  /** The current venue PMREM. Its identity changes after a context restore. */
  readonly texture: THREE.Texture;
  /** Re-render the kept proxy into a fresh PMREM, e.g. after `webglcontextrestored`. */
  rebuild(): THREE.Texture;
  dispose(): void;
}

/** WebGL only: bakes the proxy once. Not used by the Node rig tests. */
export function createVenueEnvironment(renderer: THREE.WebGLRenderer): VenueEnvironment {
  const proxy = createVenueEnvironmentProxy();
  const position = new THREE.Vector3(...VENUE_ENV_BAKE.position);
  const bake = () => {
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      const target = generator.fromScene(proxy.scene, VENUE_ENV_BAKE.sigma, VENUE_ENV_BAKE.near, VENUE_ENV_BAKE.far, { size: VENUE_ENV_BAKE.size, position });
      target.texture.name = 'venue-environment';
      return target;
    } finally {
      generator.dispose();
    }
  };
  let target = bake();
  let disposed = false;
  return {
    get texture() { return target.texture; },
    rebuild() {
      if (disposed) return target.texture;
      // The old target's GL objects died with the lost context; let it be collected rather than
      // deleting stale handles on the new context.
      target = bake();
      return target.texture;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
      proxy.dispose();
    },
  };
}

/**
 * Fresnel-weighted alpha for thin glass. Specular light is divided back out of the blend so
 * reflections keep their strength through alpha blending; tone mapping still caps the centre
 * highlight near the material's alpha. Opaque and transmissive variants keep the stock chunk.
 */
const VENUE_GLASS_FRAGMENT = /* glsl */`
#if defined( OPAQUE ) || defined( USE_TRANSMISSION )
#include <opaque_fragment>
#else
float venueGlassFacing = saturate( abs( dot( normal, geometryViewDir ) ) );
float venueGlassAlpha = clamp( mix( diffuseColor.a, 0.7, pow( 1.0 - venueGlassFacing, 3.0 ) ), 0.0, 1.0 );
gl_FragColor = vec4( ( totalDiffuse * venueGlassAlpha + totalSpecular ) / max( venueGlassAlpha, 1e-3 ) + totalEmissiveRadiance, venueGlassAlpha );
#endif
`;

const glassHooked = new WeakSet<THREE.Material>();

/** Chain the glass hook after any existing onBeforeCompile and extend its program cache key. */
export function installVenueGlass(material: THREE.Material): boolean {
  if (glassHooked.has(material) || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return false;
  glassHooked.add(material);
  // Thin glass at low opacity: one pass instead of three's back-then-front pair, which drew every glass
  // twice and re-resolved its program twice per frame. The fresnel below shades either face alike.
  material.forceSinglePass = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const inheritedKey = previousKey === THREE.Material.prototype.customProgramCacheKey;
  material.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    previous.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', VENUE_GLASS_FRAGMENT);
  };
  // The inherited key is onBeforeCompile.toString(), which would now name this wrapper for every
  // glass material; key on the previous hook instead so distinct earlier hooks keep distinct programs.
  material.customProgramCacheKey = function (this: THREE.Material) {
    return (inheritedKey ? previous.toString() : previousKey.call(this)) + '|' + VENUE_GLASS_CACHE_KEY;
  };
  material.needsUpdate = true;
  return true;
}

/** Applies `userData.venueEnv` (explicit envMap at that intensity) and `userData.venueGlass`. */
export function applyVenueMaterial(material: THREE.Material, envMap: THREE.Texture) {
  const strength = material.userData.venueEnv;
  const standard = material as THREE.MeshStandardMaterial;
  if (typeof strength === 'number' && Number.isFinite(strength) && standard.isMeshStandardMaterial) {
    // A changed envMap is detected by the renderer and selects the matching program variant.
    if (standard.envMap !== envMap) standard.envMap = envMap;
    standard.envMapIntensity = strength;
  }
  if (material.userData.venueGlass === true) installVenueGlass(material);
}

/** Walks `root` (skipping subtrees `skip` rejects) and applies the venue material tags. */
export function applyVenueMaterialTags(root: THREE.Object3D, envMap: THREE.Texture, skip?: (object: THREE.Object3D) => boolean) {
  if (skip?.(root)) return;
  const material = (root as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (material && ((root as THREE.Mesh).isMesh || (root as THREE.Sprite).isSprite || (root as THREE.Points).isPoints || (root as THREE.Line).isLine)) {
    if (Array.isArray(material)) for (let i = 0; i < material.length; i++) applyVenueMaterial(material[i]!, envMap);
    else applyVenueMaterial(material, envMap);
  }
  const children = root.children;
  for (let i = 0; i < children.length; i++) applyVenueMaterialTags(children[i]!, envMap, skip);
}
