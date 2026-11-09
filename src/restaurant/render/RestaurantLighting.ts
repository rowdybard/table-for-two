import * as THREE from 'three';
import type { DinnerState } from '../types';
import type { RenderQuality, RenderTier } from './RenderQuality';
import type { RestaurantSet } from './RestaurantScene';
import { DYNAMIC_SHADOW_LAYER, PENDANTS, PENDANT_Y, STATIC_SHADOW_LAYER, VENUE_ENV } from './VenueContract';
import { applyVenueMaterialTags, createVenueEnvironment, VENUE_ROOM } from './VenueEnvironment';
import { createVenueGlow } from './VenueGlow';
import { waitForEnvironmentAssets } from './EnvironmentAssets';
import { waitForRestaurantProps } from './RestaurantPropKit';

/** Booth face light, diningRoot-local, so it travels with the quiet-table move. */
export const BOOTH_LIGHT = { solo: [-1.2, 2.1, -1.3], double: [0, 2.15, -1.45] } as const;
export const KEY_SHADOW = { position: [2.2, 10.74, 4.88], target: [0, 0, 0], near: .5, far: 24, margin: .3, mapSize: 1024 } as const;
export const TABLE_SPOT_SHADOW = { high: { mapSize: 1024, normalBias: .004 }, low: { mapSize: 512, normalBias: .008 } } as const;
/**
 * Adaptive pixel ratio: wait after play starts, then judge 3 s windows of rendered frames. A step
 * down is kept only if the next window's mean frame time drops below `gain` of the slow one; a
 * capped display (30 Hz power saving) or main-thread-bound frames gain nothing and get it back.
 */
export const ADAPTIVE_PIXEL_RATIO = { delay: 4, window: 3, slowFrame: .022, step: .25, gain: .9, capMargin: 1.25 } as const;
/** Renders between full-scene venue tag rescans (about two seconds at 60 fps). */
const TAG_RESCAN_RENDERS = 120;

export interface LightRig {
  readonly tier: RenderTier;
  readonly hemisphere: THREE.HemisphereLight;
  /** Static shadow: renders only STATIC_SHADOW_LAYER, and only when asked to. */
  readonly key: THREE.DirectionalLight;
  /** P0 over the dining table, parented to diningRoot. Its shadow renders only DYNAMIC_SHADOW_LAYER. */
  readonly table: THREE.SpotLight;
  /** P1..P4 room pendants. P3 and P4 exist on the high tier only. */
  readonly pendants: readonly THREE.SpotLight[];
  readonly bar: THREE.SpotLight;
  /** Face light on both tiers, parented to diningRoot. */
  readonly booth: THREE.PointLight;
  /** Every light this rig owns, for counting and disposal. */
  readonly lights: readonly THREE.Light[];
  setDoubleLayout(double: boolean): void;
  dispose(): void;
}

const spot = (parent: THREE.Object3D, name: string, color: string, intensity: number, distance: number, angle: number, penumbra: number,
  position: readonly [number, number, number], target: readonly [number, number, number]) => {
  const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
  light.name = name;
  light.position.set(...position);
  light.target.name = name + '-target';
  light.target.position.set(...target);
  // The target sits next to its light so it shares the light's frame (diningRoot for P0).
  parent.add(light, light.target);
  return light;
};

/**
 * Fit an orthographic shadow camera to `corners` as seen from the light, plus a margin.
 * Positions are read in the light's parent frame, which must share world orientation.
 */
export function fitDirectionalShadow(light: THREE.DirectionalLight, corners: readonly THREE.Vector3[], margin: number) {
  const camera = light.shadow.camera;
  camera.position.copy(light.position);
  camera.lookAt(light.target.position);
  camera.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minDepth = Infinity, maxDepth = -Infinity;
  for (const corner of corners) {
    point.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    minDepth = Math.min(minDepth, -point.z); maxDepth = Math.max(maxDepth, -point.z);
  }
  camera.left = minX - margin; camera.right = maxX + margin;
  camera.bottom = minY - margin; camera.top = maxY + margin;
  camera.updateProjectionMatrix();
  return { minDepth, maxDepth };
}

export function roomCorners() {
  const corners: THREE.Vector3[] = [];
  for (const x of [VENUE_ROOM.min[0], VENUE_ROOM.max[0]]) for (const y of [VENUE_ROOM.min[1], VENUE_ROOM.max[1]]) for (const z of [VENUE_ROOM.min[2], VENUE_ROOM.max[2]]) corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

/**
 * Pure light rig, testable without WebGL. `roomLights` must sit at the world origin unrotated;
 * P0 and the booth light go into `diningRoot`. Light count and casters are final here:
 * nothing toggles them later, so compiled programs stay valid.
 */
export function buildLightRig(quality: Pick<RenderQuality, 'tier'>, roomLights: THREE.Object3D, diningRoot: THREE.Object3D): LightRig {
  const high = quality.tier === 'high';
  const lights: THREE.Light[] = [];

  const hemisphere = new THREE.HemisphereLight('#e6d6cf', '#5a4840', .5);
  hemisphere.name = 'venue-hemisphere';
  roomLights.add(hemisphere); lights.push(hemisphere);

  const key = new THREE.DirectionalLight('#ffdcc0', .55);
  key.name = 'venue-key';
  key.position.set(...KEY_SHADOW.position);
  key.target.name = 'venue-key-target';
  key.target.position.set(...KEY_SHADOW.target);
  key.castShadow = true;
  key.shadow.mapSize.set(KEY_SHADOW.mapSize, KEY_SHADOW.mapSize);
  key.shadow.camera.near = KEY_SHADOW.near; key.shadow.camera.far = KEY_SHADOW.far;
  key.shadow.bias = -.0002; key.shadow.normalBias = .02; key.shadow.radius = 2.5; key.shadow.intensity = .8;
  fitDirectionalShadow(key, roomCorners(), KEY_SHADOW.margin);
  key.shadow.camera.layers.set(STATIC_SHADOW_LAYER);
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  roomLights.add(key, key.target); lights.push(key);

  const [tableX, tableZ] = PENDANTS[0];
  const table = spot(diningRoot, 'venue-table-spot', '#ffd39a', 8, 6, 1.15, .75, [tableX, PENDANT_Y.light, tableZ], [tableX, .78, tableZ]);
  table.castShadow = true;
  const tableShadow = table.shadow, tierShadow = TABLE_SPOT_SHADOW[high ? 'high' : 'low'];
  // The shadow camera's far plane follows the light distance (SpotLightShadow.updateMatrices).
  tableShadow.focus = .55; tableShadow.bias = -.00015; tableShadow.radius = 2; tableShadow.intensity = .85;
  tableShadow.camera.near = .4;
  tableShadow.camera.layers.set(DYNAMIC_SHADOW_LAYER);
  tableShadow.mapSize.set(tierShadow.mapSize, tierShadow.mapSize);
  tableShadow.normalBias = tierShadow.normalBias;
  if (!high) { tableShadow.autoUpdate = false; tableShadow.needsUpdate = true; }
  lights.push(table);

  const pendants: THREE.SpotLight[] = [];
  for (let i = 1; i < (high ? 5 : 3); i++) {
    const [x, z] = PENDANTS[i]!;
    const pendant = spot(roomLights, `venue-pendant-${i}`, '#ffd39a', 5.5, 5.5, 1.05, .7, [x, PENDANT_Y.light, z], [x, 0, z]);
    pendants.push(pendant); lights.push(pendant);
  }

  // Aimed at the shelves so the bottles and the bar sign sit inside the cone.
  const bar = spot(roomLights, 'venue-bar-spot', '#ffcf9f', 4.5, 4, .95, .8, [0, 2.95, -5.75], [0, 1.9, -6.8]);
  lights.push(bar);

  // Both tiers: without it the date's cheeks fall to a third of the old face light on phones.
  const booth = new THREE.PointLight('#ffdbbd', 2.6, 4, 2);
  booth.name = 'venue-booth';
  booth.position.set(...BOOTH_LIGHT.solo);
  diningRoot.add(booth); lights.push(booth);

  let disposed = false;
  return {
    tier: high ? 'high' : 'low', hemisphere, key, table, pendants, bar, booth, lights,
    setDoubleLayout(double) {
      const p = double ? BOOTH_LIGHT.double : BOOTH_LIGHT.solo;
      booth.position.set(p[0], p[1], p[2]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of lights) {
        const target = (light as THREE.SpotLight | THREE.DirectionalLight).target;
        if (target && target.parent === light.parent) target.removeFromParent();
        light.removeFromParent();
        light.dispose();
      }
    },
  };
}

/** Enables DYNAMIC_SHADOW_LAYER on an actor's casting meshes, leaving the head (face, eyes, hair) out. */
export function enableActorShadowLayer(root: THREE.Object3D) {
  if (root.name.startsWith('head-')) return;
  if ((root as THREE.Mesh).isMesh && root.castShadow && !root.userData.target) root.layers.enable(DYNAMIC_SHADOW_LAYER);
  const children = root.children;
  for (let i = 0; i < children.length; i++) enableActorShadowLayer(children[i]!);
}

const isActorRoot = (object: THREE.Object3D) => object.name.startsWith('character-');

/**
 * Keeps the split shadows usable when the surfaces workstream has not tagged any baked batch:
 * room batches join the static layer and the table furniture joins the spot layer.
 * A no-op once any casting batch already carries the layer.
 */
export function ensureVenueShadowLayers(set: Pick<RestaurantSet, 'root' | 'diningRoot'>) {
  const batches: THREE.Mesh[] = [], furniture: THREE.Mesh[] = [];
  let staticTagged = false, furnitureTagged = false;
  set.root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || !mesh.name.startsWith('restaurant-')) return;
    let inDining = false;
    for (let parent = mesh.parent; parent; parent = parent.parent) if (parent === set.diningRoot) { inDining = true; break; }
    if (inDining) { furniture.push(mesh); if (mesh.layers.isEnabled(DYNAMIC_SHADOW_LAYER)) furnitureTagged = true; }
    if (mesh.layers.isEnabled(STATIC_SHADOW_LAYER)) staticTagged = true;
    batches.push(mesh);
  });
  if (!staticTagged) batches.forEach(mesh => mesh.layers.enable(STATIC_SHADOW_LAYER));
  if (!furnitureTagged) furniture.forEach(mesh => mesh.layers.enable(DYNAMIC_SHADOW_LAYER));
}

export interface PixelRatioGovernor {
  readonly ratio: number;
  /** At the floor with no probe to judge: nothing left to decide. */
  readonly idle: boolean;
  /** Judge one finished window. Returns the new pixel ratio when it changes, otherwise null. */
  judge(median: number, mean: number): number | null;
}

/**
 * Pure step-down decision, testable without WebGL. A slow window (median over the bar) steps down
 * once as a probe. If the next window is not clearly faster on average, lowering the resolution
 * did not help: the ratio goes back and that frame time, plus a margin, becomes the new bar.
 */
export function createPixelRatioGovernor(start: number, floor: number): PixelRatioGovernor {
  let ratio = start, bar: number = ADAPTIVE_PIXEL_RATIO.slowFrame;
  let probing = false, probeFrom = start, probeMean = 0, probeMedian = 0;
  return {
    get ratio() { return ratio; },
    get idle() { return !probing && ratio <= floor + 1e-3; },
    judge(median, mean) {
      if (probing) {
        probing = false;
        if (!(mean <= probeMean * ADAPTIVE_PIXEL_RATIO.gain)) {
          bar = Math.max(bar, probeMedian * ADAPTIVE_PIXEL_RATIO.capMargin);
          ratio = probeFrom;
          return ratio;
        }
      }
      if (median <= bar || ratio <= floor + 1e-3) return null;
      probing = true; probeFrom = ratio; probeMean = mean; probeMedian = median;
      ratio = Math.max(floor, ratio - ADAPTIVE_PIXEL_RATIO.step);
      return ratio;
    },
  };
}

export interface RestaurantLightingOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  roomLights: THREE.Group;
  set: RestaurantSet;
  quality: RenderQuality;
}

export interface RestaurantLighting {
  readonly rig: LightRig;
  /** Per frame, before any early return: time, tier cadence inputs and adaptive pixel ratio. */
  update(state: DinnerState, dt: number, time: number, reducedMotion: boolean): void;
  dispose(): void;
}

/**
 * WebGL side of the venue lighting: builds the rig, bakes the venue environment, applies material
 * tags before the shader warmup, adds the glow halos and keeps the split shadows current from
 * scene.onBeforeRender, which runs after world matrices update and before the shadow pass.
 */
export function createRestaurantLighting({ renderer, scene, quality, roomLights, set }: RestaurantLightingOptions): RestaurantLighting {
  const rig = buildLightRig(quality, roomLights, set.diningRoot);
  const { key, table } = rig;
  const low = rig.tier === 'low';
  ensureVenueShadowLayers(set);

  const environment = createVenueEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = VENUE_ENV.scene;
  const glow = createVenueGlow(scene, set.diningRoot);

  // Characters keep their own explicit environment and are scanned only for shadow layers.
  const seenRoots = new WeakSet<THREE.Object3D>();
  const scanRoot = (root: THREE.Object3D) => {
    seenRoots.add(root);
    if (isActorRoot(root)) enableActorShadowLayer(root);
    else applyVenueMaterialTags(root, environment.texture, isActorRoot);
  };
  const scanNewRoots = () => {
    const children = scene.children;
    for (let i = 0; i < children.length; i++) if (!seenRoots.has(children[i]!)) scanRoot(children[i]!);
  };
  // Before requestWarmup: every tagged material compiles once, with its final envMap and hooks.
  scanNewRoots();

  let disposed = false;
  let double = false, lampLevel = 2;
  let assetsReady = 0, retag = false, restored = false;
  let lastOffset = NaN, lastDouble = false, lastAssets = -1, renders = 0, renderedSinceUpdate = false;
  // Registered before the warmup's own waits, so these tags land before compileAsync; the
  // next-frame retag still catches meshes an asset callback inserts after this one.
  const assetReady = () => {
    if (disposed) return;
    assetsReady++; retag = true;
    applyVenueMaterialTags(scene, environment.texture, isActorRoot);
  };
  // Late model meshes (plants) and licensed maps: rescan tags and refresh the static key shadow once each.
  void waitForEnvironmentAssets().then(assetReady, assetReady);
  void waitForRestaurantProps().then(assetReady, assetReady);

  const onContextRestored = () => {
    if (disposed) return;
    try {
      scene.environment = environment.rebuild();
      applyVenueMaterialTags(scene, environment.texture, isActorRoot);
    } catch (error) {
      console.warn('Venue environment could not be rebuilt after the WebGL context returned.', error);
    }
    restored = true;
  };
  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const previousBeforeRender = scene.onBeforeRender;
  const chained = previousBeforeRender !== THREE.Object3D.prototype.onBeforeRender;
  const beforeRender: THREE.Scene['onBeforeRender'] = function (this: THREE.Scene, webgl, target, camera, geometry, material, group) {
    if (chained) previousBeforeRender.call(this, webgl, target, camera, geometry, material, group);
    if (disposed) return;
    // New top-level roots (a replacement date, the Double friend) are handled before their first draw.
    scanNewRoots();
    // A slow safety net for meshes added deep inside an existing root; applying a tag is idempotent.
    if (retag || renders % TAG_RESCAN_RENDERS === 0) { retag = false; applyVenueMaterialTags(scene, environment.texture, isActorRoot); }
    // World matrices are current here, so a table move or furniture swap refreshes this same frame.
    const offset = set.diningRoot.matrixWorld.elements[14]!;
    const layoutChanged = offset !== lastOffset || double !== lastDouble || assetsReady !== lastAssets;
    if (layoutChanged || restored) {
      key.shadow.needsUpdate = true;
      table.shadow.needsUpdate = true;
      lastOffset = offset; lastDouble = double; lastAssets = assetsReady; restored = false;
    }
    renders++;
    if (low && (renders & 1) === 0) table.shadow.needsUpdate = true;
    glow.followLamp(set.flame, lampLevel);
    renderedSinceUpdate = true;
  };
  scene.onBeforeRender = beforeRender;

  // Adaptive pixel ratio: never above the start, only from frames that rendered while visible.
  const samples = new Float32Array(512), sorted = new Float32Array(512);
  let sampleCount = 0, windowFrames = 0, windowTime = 0, playingSince: number | null = null, glowTime = 0;
  const governor = createPixelRatioGovernor(renderer.getPixelRatio(), quality.pixelRatioFloor);
  const resetWindow = () => { sampleCount = 0; windowFrames = 0; windowTime = 0; };
  const adapt = (state: DinnerState, dt: number, time: number) => {
    const rendered = renderedSinceUpdate;
    renderedSinceUpdate = false;
    if (!quality.adaptive || governor.idle) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { resetWindow(); return; }
    if (playingSince === null) { if (state.phase === 'playing') playingSince = time; return; }
    if (time - playingSince < ADAPTIVE_PIXEL_RATIO.delay || !rendered || dt <= 0) return;
    if (sampleCount < samples.length) samples[sampleCount++] = dt;
    windowFrames++;
    windowTime += dt;
    if (windowTime < ADAPTIVE_PIXEL_RATIO.window) return;
    for (let i = 0; i < sorted.length; i++) sorted[i] = i < sampleCount ? samples[i]! : Infinity;
    sorted.sort();
    const median = sorted[sampleCount >> 1]!, mean = windowTime / windowFrames;
    resetWindow();
    const next = governor.judge(median, mean);
    if (next !== null) renderer.setPixelRatio(next);
  };

  return {
    rig,
    update(state, dt, time, reducedMotion) {
      if (disposed) return;
      double = !!state.doubleDate;
      rig.setDoubleLayout(double);
      lampLevel = state.evening.tabletop?.shared.lampLevel ?? 2;
      // Candle flicker holds still under reduced motion.
      if (!reducedMotion) glowTime += Math.max(0, dt);
      glow.setTime(glowTime);
      adapt(state, dt, time);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousBeforeRender;
      if (scene.environment === environment.texture) scene.environment = null;
      glow.dispose();
      rig.dispose();
      environment.dispose();
    },
  };
}
