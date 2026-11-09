import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { STATIC_SHADOW_LAYER } from './VenueContract';

const models = {
  plant: '/restaurant-props/potted_plant_02.glb',
  vase: '/restaurant-props/ceramic_vase_04.glb',
} as const;
type PropKind = keyof typeof models;
const pending = new Set<Promise<unknown>>();
export async function waitForRestaurantProps() { await Promise.allSettled([...pending]); }

/** Small interchangeable prop slots. Model loading never gates dinner or controls. */
export class RestaurantPropKit {
  readonly root = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly sources = new Map<PropKind, Promise<GLTF | null>>();
  private readonly loaded = new Set<THREE.Object3D>();
  private disposed = false;

  constructor(parent: THREE.Group) {
    this.root.name = 'restaurant-prop-kit';
    this.root.userData.models = {};
    parent.add(this.root);
  }

  place(kind: PropKind, fallback: THREE.Group, x: number, y: number, z: number, height: number, yaw = 0) {
    const anchor = new THREE.Group();
    anchor.name = `prop-slot-${kind}`;
    anchor.position.set(x, y, z); anchor.rotation.y = yaw;
    anchor.add(fallback); this.root.add(anchor);
    void this.load(kind).then(gltf => {
      if (!gltf || this.disposed) return;
      const mesh = gltf.scene.clone(true);
      const bounds = new THREE.Box3().setFromObject(mesh);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = height / Math.max(.001, size.y);
      mesh.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      mesh.scale.setScalar(scale);
      mesh.traverse(object => {
        // Model props cast into the static key-light shadow, which renders only its own layer.
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; object.layers.enable(STATIC_SHADOW_LAYER); }
      });
      mesh.userData.asset = models[kind];
      anchor.add(mesh); fallback.visible = false;
    });
    return anchor;
  }

  private load(kind: PropKind) {
    const existing = this.sources.get(kind);
    if (existing) return existing;
    const statuses = this.root.userData.models as Record<string, string>;
    statuses[kind] = 'loading';
    const promise = this.loader.loadAsync(models[kind]).then(gltf => {
      if (this.disposed) { disposeModel(gltf.scene); return null; }
      this.loaded.add(gltf.scene); statuses[kind] = 'ready';
      return gltf;
    }).catch(() => { statuses[kind] = 'fallback'; return null; });
    this.sources.set(kind, promise); pending.add(promise);
    void promise.finally(() => pending.delete(promise));
    return promise;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // The scene owns fallback geometry. Remove model clones before its traversal
    // so shared model resources are released once, by their source owner here.
    const instances: THREE.Object3D[] = [];
    this.root.traverse(object => { if (object.userData.asset) instances.push(object); });
    instances.forEach(instance => instance.removeFromParent());
    for (const source of this.loaded) disposeModel(source);
    this.loaded.clear();
  }
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  const bitmaps = new Set<ImageBitmap>();
  textures.forEach(texture => {
    const source = texture.source.data;
    for (const image of Array.isArray(source) ? source : [source]) {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image);
    }
    texture.dispose();
  });
  bitmaps.forEach(bitmap => bitmap.close());
}
