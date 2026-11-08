import * as THREE from 'three';
import type { SurfaceKind } from './ProceduralMaterials';

/** CC0 sources and full licenses are shipped in /environment-assets/README.md. */
type AssetSurface = { id: string; versions: [string, string, string]; meters: number; normal: number };
const surfaces: Partial<Record<SurfaceKind, AssetSurface>> = {
  wood: { id: 'black_walnut_veneer_01', versions: ['2598699f', 'a9bd52c6', '0f5645dc'], meters: 1, normal: .28 },
  plaster: { id: 'white_plaster_02', versions: ['a1ebbe09', '4ff1fe95', 'eb572ca3'], meters: 1, normal: .18 },
  linen: { id: 'terlenka', versions: ['74c4333e', 'ec726afa', '05d7152f'], meters: .3, normal: .16 },
};
interface TextureRecord { texture: THREE.Texture; ready: Promise<THREE.Texture>; refs: number; loaded: boolean }
const pool = new Map<string, TextureRecord>();
const pending = new Set<Promise<unknown>>();
const failed = new Set<string>();
const loader = new THREE.TextureLoader();

function acquire(url: string, color: boolean, repeating = true) {
  const existing = pool.get(url);
  if (existing) { existing.refs++; return existing; }
  let resolve!: (texture: THREE.Texture) => void, reject!: (error: unknown) => void;
  const ready = new Promise<THREE.Texture>((yes, no) => { resolve = yes; reject = no; });
  const record: TextureRecord = { texture: null!, ready, refs: 1, loaded: false };
  record.texture = loader.load(url, texture => {
    record.loaded = true;
    if (!record.refs) texture.dispose();
    resolve(texture);
  }, undefined, error => {
    failed.add(url); reject(error);
    if (pool.get(url) === record) pool.delete(url);
  });
  record.texture.name = 'licensed:' + url;
  record.texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  record.texture.wrapS = record.texture.wrapT = repeating ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  record.texture.anisotropy = 4;
  record.texture.userData.sharedEnvironmentAsset = true;
  pool.set(url, record);
  pending.add(ready);
  void ready.then(() => pending.delete(ready), () => pending.delete(ready));
  return record;
}
function release(url: string, record: TextureRecord) {
  record.refs--;
  if (!record.refs) {
    record.texture.dispose();
    if (pool.get(url) === record) pool.delete(url);
  }
}
export function environmentAssetStats() {
  return { pending: pending.size, loaded: [...pool.values()].filter(record => record.loaded).length, failed: [...failed], references: [...pool.values()].reduce((n, record) => n + record.refs, 0) };
}
export async function waitForEnvironmentAssets() { await Promise.allSettled([...pending]); }

/** Keep an authored fallback until the entire licensed PBR set is ready. */
export function applyEnvironmentSurface(material: THREE.MeshStandardMaterial, kind: SurfaceKind, metersPerTile?: number) {
  const asset = surfaces[kind];
  if (!asset) return;
  const names = ['albedo.jpg', 'roughness.jpg', 'normal-gl.jpg'];
  const urls = names.map((name, i) => '/environment-assets/' + asset.id + '/' + name + '?v=' + asset.versions[i]);
  const maps = urls.map((url, i) => acquire(url, i === 0));
  const fallback = new Set([material.map, material.roughnessMap, material.bumpMap]);
  let disposed = false, attached = false;
  material.userData.environmentAsset = asset.id;
  material.userData.assetStatus = 'loading';
  material.userData.metersPerTile = metersPerTile ?? asset.meters;
  material.addEventListener('dispose', () => {
    if (disposed) return;
    disposed = true;
    maps.forEach((record, i) => release(urls[i], record));
    if (!attached) fallback.forEach(map => map?.dispose());
  });
  void Promise.all(maps.map(record => record.ready)).then(([albedo, roughness, normal]) => {
    if (disposed) return;
    material.map = albedo; material.roughnessMap = roughness; material.normalMap = normal; material.bumpMap = null;
    material.normalScale.setScalar(asset.normal);
    // Scanned wood already contains pigment; preserve the venue's tint without double-darkening it.
    if (kind === 'wood') material.color.lerp(new THREE.Color('#ffffff'), .38);
    if (kind === 'plaster') {
      // Keep the scanned relief while treating its mottled albedo as a subtle finish.
      if (material.color.r * .2126 + material.color.g * .7152 + material.color.b * .0722 > .3) material.color.set('#eee8e2');
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', [
          '#include <map_fragment>',
          '#ifdef USE_MAP',
          'diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb, 0.24) / max(sampledDiffuseColor.rgb, vec3(0.002));',
          '#endif',
        ].join('\n'));
      };
      material.customProgramCacheKey = () => 'licensed-plaster-soft-finish-v1';
    }
    material.userData.assetStatus = 'ready'; material.needsUpdate = true; attached = true;
    fallback.forEach(map => map?.dispose());
  }).catch(() => {
    if (!disposed) material.userData.assetStatus = 'fallback';
  });
}

/** One shared, local CC0 street image; each window is an independently positioned plane. */
export function createNightWindow(width: number, height: number, left = 0, span = 1, centerV = .5, tint = '#788ba8') {
  const url = '/environment-assets/seoul-night-1280.jpg?v=c14daedd';
  const source = acquire(url, true, false);
  const material = new THREE.MeshBasicMaterial({ color: tint, toneMapped: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  const uv = plane.geometry.getAttribute('uv');
  const visibleHeight = Math.min(1, span * (1280 / 960) / (width / height));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, left + uv.getX(i) * span, centerV + (uv.getY(i) - .5) * visibleHeight);
  plane.name = 'licensed-night-window';
  plane.userData.environmentAsset = 'seoul-by-night';
  let disposed = false;
  material.addEventListener('dispose', () => { if (!disposed) { disposed = true; release(url, source); } });
  void source.ready.then(texture => {
    if (disposed) return;
    material.map = texture; material.needsUpdate = true;
    plane.userData.assetStatus = 'ready';
  }).catch(() => { plane.userData.assetStatus = 'fallback'; });
  return plane;
}
