import * as THREE from 'three';
import { CONTACT_SHADOW_MAX, DYNAMIC_SHADOW_LAYER, type ContactShadowTag } from './VenueContract';

/** World height of the table top. Blobs sit .4 mm above it and below the paper props at .783. */
export const CONTACT_TABLE_TOP = .782;
export const CONTACT_BLOB_Y = .7824;
/** A blob fades out over this much lift, so a raised glass or a pouring carafe leaves the table. */
const FADE_LIFT = .15;
/** Objects that already cast into the table spotlight's shadow get a lighter blob, so the two do not double-darken. */
export const SPOT_CASTER_OPACITY = .6;

/**
 * The shared contract tag, plus two optional object-local heights: `cy` is the point whose ground
 * projection centres the blob (a tipped glass then grounds along its body), `y0` is the origin's resting
 * height above the table top, from which lift is measured.
 */
export interface ContactShadowSource extends ContactShadowTag { cy?: number; y0?: number }

export function tagContactShadow<T extends THREE.Object3D>(object: T, tag: ContactShadowSource) { object.userData.contactShadow = tag; return object; }

/** Cast into the table spotlight's shadow (layer 2). Instanced specks never cast. */
export function castSpotShadow(...objects: THREE.Object3D[]) {
  for (const root of objects) root.traverse(object => {
    if (!(object as THREE.Mesh).isMesh || (object as THREE.InstancedMesh).isInstancedMesh) return;
    object.castShadow = true; object.layers.enable(DYNAMIC_SHADOW_LAYER);
  });
}

export function receiveSpotShadow(...objects: THREE.Object3D[]) {
  for (const root of objects) root.traverse(object => { if ((object as THREE.Mesh).isMesh) object.receiveShadow = true; });
}

const castsSpotShadow = (root: THREE.Object3D) => {
  let casts = false;
  root.traverse(object => { if ((object as THREE.Mesh).isMesh && object.castShadow && object.layers.isEnabled(DYNAMIC_SHADOW_LAYER)) casts = true; });
  return casts;
};

const vertexShader = /* glsl */`
attribute float instanceOpacity;
varying vec2 vSpot;
varying float vOpacity;
void main() {
  vSpot = position.xz;
  vOpacity = instanceOpacity;
#ifdef USE_INSTANCING
  mat4 placement = instanceMatrix;
#else
  mat4 placement = mat4(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * placement * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */`
uniform vec3 tint;
varying vec2 vSpot;
varying float vOpacity;
void main() {
  float alpha = vOpacity * (1.0 - smoothstep(0.18, 1.0, length(vSpot)));
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(tint, alpha);
  #include <colorspace_fragment>
}`;

interface Source { object: THREE.Object3D; tag: ContactShadowSource; weight: number }

/**
 * Soft contact blobs under every tagged tabletop object, drawn as one instanced quad set (one draw).
 * Each blob follows its object's world placement, including the quiet-table move and both Double
 * layouts, and disappears with the object. The renderer may move `mesh` freely; blobs are placed
 * relative to it. Instances update in the mesh's own onBeforeRender, so they trail by one frame.
 */
export function createPlaceSettingShadows() {
  const geometry = new THREE.PlaneGeometry(2, 2); geometry.rotateX(-Math.PI / 2);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_SHADOW_MAX), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('instanceOpacity', opacity);
  const material = new THREE.ShaderMaterial({
    name: 'contact-shadow', uniforms: { tint: { value: new THREE.Color('#351a1b') } }, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, CONTACT_SHADOW_MAX);
  mesh.name = 'contact-shadows'; mesh.frustumCulled = false; mesh.renderOrder = -1;
  mesh.castShadow = false; mesh.receiveShadow = false; mesh.userData.decor = true;
  mesh.raycast = () => {};
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CONTACT_SHADOW_MAX; i++) mesh.setMatrixAt(i, hidden);

  let sources: Source[] | null = null, discoveredIn: THREE.Object3D | null = null;
  const inverse = new THREE.Matrix4(), placement = new THREE.Matrix4(), centre = new THREE.Vector3(), local = new THREE.Vector3();
  const turn = new THREE.Quaternion(), scale = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  const rootOf = (object: THREE.Object3D) => { let top = object; while (top.parent) top = top.parent; return top; };
  const shownIn = (object: THREE.Object3D, root: THREE.Object3D) => {
    let node: THREE.Object3D | null = object;
    for (; node; node = node.parent) { if (!node.visible) return false; if (node === root) return true; }
    return false;
  };
  const yawOf = (e: ArrayLike<number>) => Math.hypot(e[0]!, e[2]!) >= Math.hypot(e[8]!, e[10]!) ? Math.atan2(-e[2]!, e[0]!) : Math.atan2(e[8]!, e[10]!);

  function discover(root: THREE.Object3D) {
    const found: Source[] = [];
    root.traverse(object => {
      const tag = object.userData.contactShadow as ContactShadowSource | undefined;
      if (tag && found.length < CONTACT_SHADOW_MAX) found.push({ object, tag, weight: castsSpotShadow(object) ? SPOT_CASTER_OPACITY : 1 });
    });
    sources = found; discoveredIn = root; mesh.count = Math.max(1, found.length);
  }

  /** Place every blob from its source's current world matrix. Pass the scene to (re)discover tagged objects. */
  function sync(scene?: THREE.Object3D) {
    const root = scene ?? rootOf(mesh);
    if (!sources || root !== discoveredIn) discover(root);
    mesh.updateWorldMatrix(true, false);
    inverse.copy(mesh.matrixWorld).invert();
    const meshYaw = yawOf(mesh.matrixWorld.elements);
    const list = sources!;
    for (let i = 0; i < list.length; i++) {
      const { object, tag, weight } = list[i]!;
      if (!shownIn(object, root)) { mesh.setMatrixAt(i, hidden); opacity.setX(i, 0); continue; }
      const e = object.matrixWorld.elements, cy = tag.cy ?? 0;
      centre.set(0, cy, 0).applyMatrix4(object.matrixWorld);
      const lift = Math.max(0, centre.y - CONTACT_TABLE_TOP - (tag.y0 ?? 0) - cy);
      const strength = tag.opacity * weight * Math.max(0, 1 - lift / FADE_LIFT);
      local.set(centre.x, CONTACT_BLOB_Y, centre.z).applyMatrix4(inverse);
      turn.setFromAxisAngle(up, yawOf(e) - meshYaw);
      scale.set(tag.rx * Math.hypot(e[0]!, e[1]!, e[2]!), 1, tag.rz * Math.hypot(e[8]!, e[9]!, e[10]!));
      placement.compose(local, turn, strength > 0 ? scale : scale.setScalar(0));
      mesh.setMatrixAt(i, placement); opacity.setX(i, strength);
    }
    mesh.instanceMatrix.needsUpdate = true; opacity.needsUpdate = true;
  }
  mesh.onBeforeRender = (_renderer, scene) => sync(scene);

  return {
    mesh, sync,
    /** Tagged objects in instance order (discovered on the first sync). */
    sources: () => (sources ?? []).map(source => source.object),
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
