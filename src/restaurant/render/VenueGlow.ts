import * as THREE from 'three';
import { BAR_STRIPS, CANDLES, GLOW_LINEAR, PENDANTS, PENDANT_Y } from './VenueContract';

export const HALO_TEXTURE_SIZE = 64;
/** Lamp halo size by lampLevel 0..2, times LAMP_HALO_SIZE. */
export const LAMP_HALO_SCALE = [0, .55, 1] as const;
export const LAMP_HALO_SIZE = .3;
const PENDANT_HALO = { size: .45, opacity: .55 } as const;
const CANDLE_HALO = { size: .12, opacity: .7, flicker: .06, lift: .01 } as const;
const STRIP_HALO = { height: .16, opacity: .35, overhang: .15, front: .02 } as const;

/** Soft radial falloff in alpha with white colour; filtered and mipmapped, about 22 KB on the GPU. */
export function createHaloTexture(size = HALO_TEXTURE_SIZE) {
  const data = new Uint8Array(size * size * 4);
  const tail = Math.exp(-6.5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1;
    const r2 = dx * dx + dy * dy;
    const falloff = r2 >= 1 ? 0 : (Math.exp(-6.5 * r2) - tail) / (1 - tail);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(THREE.MathUtils.clamp(falloff, 0, 1) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'venue-halo';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** One instance of the room halo mesh. Mode 0 faces the camera; mode 1 stays along world X. */
export interface RoomHalo {
  position: readonly [number, number, number];
  size: readonly [number, number];
  opacity: number;
  mode: 0 | 1;
  /** Mode 0: flicker depth. Mode 1: unused. */
  flicker: number;
  /** Mode 0: flicker phase. Mode 1: fraction of the half-width that stays at full strength. */
  shape: number;
  color: readonly [number, number, number];
}

/** P1..P4 pendants, the six side-table candles and the two bar shelf strips, all in world space. */
export function roomHaloLayout(): RoomHalo[] {
  const glow = [GLOW_LINEAR[0], GLOW_LINEAR[1], GLOW_LINEAR[2]] as const;
  const halos: RoomHalo[] = [];
  for (const [x, z] of PENDANTS.slice(1)) {
    halos.push({ position: [x, PENDANT_Y.halo, z], size: [PENDANT_HALO.size, PENDANT_HALO.size], opacity: PENDANT_HALO.opacity, mode: 0, flicker: 0, shape: 0, color: glow });
  }
  CANDLES.forEach(([x, z], i) => {
    halos.push({ position: [x, .955 + CANDLE_HALO.lift, z], size: [CANDLE_HALO.size, CANDLE_HALO.size], opacity: CANDLE_HALO.opacity, mode: 0, flicker: CANDLE_HALO.flicker, shape: i * 1.7, color: [1, .62, .32] });
  });
  const halfWidth = BAR_STRIPS.halfLength + STRIP_HALO.overhang;
  for (const y of BAR_STRIPS.y) {
    halos.push({ position: [0, y, BAR_STRIPS.z + STRIP_HALO.front], size: [halfWidth * 2, STRIP_HALO.height], opacity: STRIP_HALO.opacity, mode: 1, flicker: 0, shape: BAR_STRIPS.halfLength / halfWidth, color: glow });
  }
  return halos;
}

const haloVertex = /* glsl */`
attribute vec3 haloCenter;
attribute vec2 haloSize;
attribute vec4 haloParams;
attribute vec3 haloColor;
uniform float uTime;
varying vec2 vHaloUv;
varying vec3 vHaloColor;
varying float vHaloAlpha;
varying float vHaloMode;
varying float vHaloShape;
void main() {
  vec3 right;
  vec3 up;
  if ( haloParams.y < 0.5 ) {
    right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  } else {
    right = vec3( 1.0, 0.0, 0.0 );
    vec3 across = cross( cameraPosition - haloCenter, right );
    float span = length( across );
    up = span > 1e-4 ? across / span : vec3( 0.0, 1.0, 0.0 );
  }
  vec3 world = haloCenter + right * position.x * haloSize.x + up * position.y * haloSize.y;
  float flicker = haloParams.y < 0.5 ? haloParams.z * ( sin( uTime * 7.3 + haloParams.w ) * 0.6 + sin( uTime * 12.9 + haloParams.w * 1.7 ) * 0.4 ) : 0.0;
  vHaloUv = position.xy * 2.0;
  vHaloColor = haloColor;
  vHaloAlpha = haloParams.x * ( 1.0 + flicker );
  vHaloMode = haloParams.y;
  vHaloShape = haloParams.w;
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const haloFragment = /* glsl */`
uniform sampler2D map;
varying vec2 vHaloUv;
varying vec3 vHaloColor;
varying float vHaloAlpha;
varying float vHaloMode;
varying float vHaloShape;
void main() {
  vec2 q = vHaloUv;
  if ( vHaloMode > 0.5 ) q.x = max( 0.0, abs( q.x ) - vHaloShape ) / max( 1.0 - vHaloShape, 1e-3 );
  float alpha = texture2D( map, q * 0.5 + 0.5 ).a * vHaloAlpha;
  gl_FragColor = vec4( vHaloColor, alpha );
  #include <colorspace_fragment>
}
`;

export interface VenueGlow {
  readonly room: THREE.InstancedMesh;
  /** P0's halo, inside the dining station so it follows the quiet-table move. */
  readonly tableHalo: THREE.Sprite;
  /** Scene-level, outside the tabletop props so it never enters their bounds or overlap checks. */
  readonly lampHalo: THREE.Sprite;
  setTime(seconds: number): void;
  /** Call after world matrices are current. Copies the bulb's world position into the halo. */
  followLamp(flame: THREE.Object3D | null, level: number): void;
  dispose(): void;
}

export function createVenueGlow(scene: THREE.Object3D, diningRoot: THREE.Object3D): VenueGlow {
  const texture = createHaloTexture();
  const halos = roomHaloLayout();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const centers = new Float32Array(halos.length * 3), sizes = new Float32Array(halos.length * 2);
  const params = new Float32Array(halos.length * 4), colors = new Float32Array(halos.length * 3);
  halos.forEach((halo, i) => {
    centers.set(halo.position, i * 3); sizes.set(halo.size, i * 2); colors.set(halo.color, i * 3);
    params.set([halo.opacity, halo.mode, halo.flicker, halo.shape], i * 4);
  });
  geometry.setAttribute('haloCenter', new THREE.InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('haloSize', new THREE.InstancedBufferAttribute(sizes, 2));
  geometry.setAttribute('haloParams', new THREE.InstancedBufferAttribute(params, 4));
  geometry.setAttribute('haloColor', new THREE.InstancedBufferAttribute(colors, 3));
  const roomMaterial = new THREE.ShaderMaterial({
    name: 'venue-room-halos',
    uniforms: { map: { value: texture }, uTime: { value: 0 } },
    vertexShader: haloVertex, fragmentShader: haloFragment,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  });
  const room = new THREE.InstancedMesh(geometry, roomMaterial, halos.length);
  room.name = 'venue-room-halos';
  // Billboarding happens in the shader, so the instance bounds mean nothing; never cull it.
  room.frustumCulled = false;
  room.userData.decor = true;
  scene.add(room);

  const sprite = (name: string, color: THREE.Color, opacity: number) => {
    const material = new THREE.SpriteMaterial({ map: texture, color, opacity, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const halo = new THREE.Sprite(material);
    halo.name = name;
    halo.userData.decor = true;
    return halo;
  };
  const glow = new THREE.Color().setRGB(GLOW_LINEAR[0], GLOW_LINEAR[1], GLOW_LINEAR[2], THREE.LinearSRGBColorSpace);
  const tableHalo = sprite('venue-table-halo', glow, PENDANT_HALO.opacity);
  tableHalo.position.set(PENDANTS[0][0], PENDANT_Y.halo, PENDANTS[0][1]);
  tableHalo.scale.set(PENDANT_HALO.size, PENDANT_HALO.size, 1);
  diningRoot.add(tableHalo);
  const lampHalo = sprite('venue-lamp-halo', new THREE.Color().setRGB(1, .72, .42, THREE.LinearSRGBColorSpace), .7);
  lampHalo.visible = false;
  scene.add(lampHalo);

  let disposed = false;
  return {
    room, tableHalo, lampHalo,
    setTime(seconds) { roomMaterial.uniforms.uTime!.value = seconds; },
    followLamp(flame, level) {
      const scale = LAMP_HALO_SIZE * (LAMP_HALO_SCALE[level as 0 | 1 | 2] ?? 0);
      let shown = !!flame && scale > 0, top: THREE.Object3D | null = null;
      for (let object: THREE.Object3D | null = flame; shown && object; object = object.parent) { if (!object.visible) shown = false; top = object; }
      // A bulb detached from the scene keeps a stale world matrix; never draw a halo for it.
      if (!(top as THREE.Scene | null)?.isScene) shown = false;
      lampHalo.visible = shown;
      if (!shown || !flame) return;
      lampHalo.position.setFromMatrixPosition(flame.matrixWorld);
      lampHalo.scale.set(scale, scale, 1);
      lampHalo.updateMatrixWorld();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      room.removeFromParent(); tableHalo.removeFromParent(); lampHalo.removeFromParent();
      room.dispose(); geometry.dispose(); roomMaterial.dispose();
      // Sprites share three's module-level quad geometry; only their materials are ours.
      tableHalo.material.dispose(); lampHalo.material.dispose();
      texture.dispose();
    },
  };
}
