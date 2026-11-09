import * as THREE from 'three';
import type { DinnerState } from '../types';
import type { RenderQuality, RenderTier } from './RenderQuality';
import type { RestaurantSet } from './RestaurantScene';
import { PENDANTS, PENDANT_Y, STATIC_SHADOW_LAYER } from './VenueContract';
import { applyVenueMaterialTags, createVenueEnvironment, installVenueGlass, VENUE_ROOM } from './VenueEnvironment';
import { createVenueGlow } from './VenueGlow';
import { waitForEnvironmentAssets } from './EnvironmentAssets';
import { waitForRestaurantProps } from './RestaurantPropKit';
import { createFrameIntervalClock } from '../FrameCap';

/** Booth face light, diningRoot-local, so it travels with the quiet-table move. */
export const BOOTH_LIGHT = { solo: [-1.2, 2.1, -1.3], double: [0, 2.15, -1.45] } as const;
export const KEY_SHADOW = { position: [2.2, 10.74, 4.88], target: [0, 0, 0], near: .5, far: 24, margin: .3, mapSize: 1024 } as const;
/**
 * Adaptive pixel ratio: wait after play starts, then judge 3 s windows of rendered frames. A step
 * down is kept only if the next window's mean frame time drops below `gain` of the slow one; a
 * capped display (30 Hz power saving) or main-thread-bound frames gain nothing and get it back.
 */
export const ADAPTIVE_PIXEL_RATIO = { delay: 3, window: 2, slowFrame: .022, step: .25, gain: .9, capMargin: 1.25 } as const;
/** Renders between full-scene venue tag rescans (about two seconds at 60 fps). */
const TAG_RESCAN_RENDERS = 120;

export interface LightRig {
  readonly tier: RenderTier;
  readonly hemisphere: THREE.HemisphereLight;
  /** The only shadow map, on the high tier: renders only STATIC_SHADOW_LAYER, and only when asked to. The low tier casts nothing. */
  readonly key: THREE.DirectionalLight;
  /** P0 over the dining table, parented to diningRoot. Casts no shadow; contact blobs ground the tabletop. */
  readonly table: THREE.SpotLight;
  /** P1..P4 room pendants on the high tier; none on low. */
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

  // Low uses a little more broad fill in place of background spotlights and reflection maps.
  const hemisphere = new THREE.HemisphereLight('#e6d6cf', '#5a4840', high ? 1 : 1.2);
  hemisphere.name = 'venue-hemisphere';
  roomLights.add(hemisphere); lights.push(hemisphere);

  const key = new THREE.DirectionalLight('#ffdcc0', high ? .55 : .7);
  key.name = 'venue-key';
  key.position.set(...KEY_SHADOW.position);
  key.target.name = 'venue-key-target';
  key.target.position.set(...KEY_SHADOW.target);
  // Phones skip shadow maps entirely: no depth pass and no shadow lookups in any shader.
  key.castShadow = high;
  key.shadow.mapSize.set(KEY_SHADOW.mapSize, KEY_SHADOW.mapSize);
  key.shadow.camera.near = KEY_SHADOW.near; key.shadow.camera.far = KEY_SHADOW.far;
  key.shadow.bias = -.0002; key.shadow.normalBias = .02; key.shadow.radius = 2.5; key.shadow.intensity = .8;
  fitDirectionalShadow(key, roomCorners(), KEY_SHADOW.margin);
  key.shadow.camera.layers.set(STATIC_SHADOW_LAYER);
  key.shadow.autoUpdate = false;
  key.shadow.needsUpdate = true;
  roomLights.add(key, key.target); lights.push(key);

  const [tableX, tableZ] = PENDANTS[0];
  // No shadow: a per-frame depth pass of the props and diners cost frames and added little.
  const table = spot(diningRoot, 'venue-table-spot', '#ffd39a', 8, 6, 1.15, .75, [tableX, PENDANT_Y.light, tableZ], [tableX, .78, tableZ]);
  if (high) lights.push(table);
  else { table.removeFromParent(); table.target.removeFromParent(); }

  const pendants: THREE.SpotLight[] = [];
  for (let i = 1; i < (high ? 5 : 1); i++) {
    const [x, z] = PENDANTS[i]!;
    const pendant = spot(roomLights, `venue-pendant-${i}`, '#ffd39a', 5.5, 5.5, 1.05, .7, [x, PENDANT_Y.light, z], [x, 0, z]);
    pendants.push(pendant); lights.push(pendant);
  }

  // Aimed at the shelves so the bottles and the bar sign sit inside the cone.
  const bar = spot(roomLights, 'venue-bar-spot', '#ffcf9f', 4.5, 4, .95, .8, [0, 2.95, -5.75], [0, 1.9, -6.8]);
  if (high) lights.push(bar);
  else { bar.removeFromParent(); bar.target.removeFromParent(); }

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
      for (const light of new Set([...lights, table, bar])) {
        const target = (light as THREE.SpotLight | THREE.DirectionalLight).target;
        if (target && target.parent === light.parent) target.removeFromParent();
        light.removeFromParent();
        light.dispose();
      }
    },
  };
}

const isActorRoot = (object: THREE.Object3D) => object.name.startsWith('character-');

/** Remove expensive venue shading in place, retaining material identity and late-loaded albedo maps. */
export function applyLowCostVenue(root: THREE.Object3D, retainedLights: ReadonlySet<THREE.Light>) {
  if (isActorRoot(root)) return;
  if ((root as THREE.Light).isLight && !retainedLights.has(root as THREE.Light) && root.name !== 'view-face-fill') root.visible = false;
  const mesh = root as THREE.Mesh;
  if (mesh.isMesh) {
    mesh.castShadow = false; mesh.receiveShadow = false;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const changed = !!(material.envMap || material.normalMap || material.bumpMap || material.roughnessMap || material.metalnessMap);
      material.envMap = null; material.envMapIntensity = 0;
      material.normalMap = null; material.bumpMap = null; material.roughnessMap = null; material.metalnessMap = null;
      if (material.userData.venueGlass === true) installVenueGlass(material);
      if (material.transparent && material.side === THREE.DoubleSide) material.forceSinglePass = true;
      if (changed) material.needsUpdate = true;
    }
  }
  for (const child of root.children) applyLowCostVenue(child, retainedLights);
}

/**
 * Keeps the key shadow usable when the surfaces workstream has not tagged any baked batch: every
 * casting room batch, the dining furniture included, joins the static layer. A no-op once any
 * casting batch already carries the layer.
 */
export function ensureVenueShadowLayers(set: Pick<RestaurantSet, 'root'>) {
  const batches: THREE.Mesh[] = [];
  let staticTagged = false;
  set.root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || !mesh.name.startsWith('restaurant-')) return;
    if (mesh.layers.isEnabled(STATIC_SHADOW_LAYER)) staticTagged = true;
    batches.push(mesh);
  });
  if (!staticTagged) batches.forEach(mesh => mesh.layers.enable(STATIC_SHADOW_LAYER));
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
  /** Applies the adaptive resolution scale (1 = full) through the renderer's pixel-ratio policy. */
  setResolutionScale(scale: number): void;
}

export interface RestaurantLighting {
  readonly rig: LightRig;
  /** Per frame, before any early return: time, tier cadence inputs and adaptive pixel ratio. `gameplay` is false on the title and date-selection screens, where the pixel ratio is never judged. */
  update(state: DinnerState, dt: number, time: number, reducedMotion: boolean, gameplay?: boolean): void;
  dispose(): void;
}

/**
 * WebGL side of the venue lighting: builds the rig, bakes the venue environment, applies material
 * tags before the shader warmup, adds the glow halos and refreshes the static key shadow from
 * scene.onBeforeRender, which runs after world matrices update and before the shadow pass.
 */
export function createRestaurantLighting({ renderer, scene, quality, roomLights, set, setResolutionScale }: RestaurantLightingOptions): RestaurantLighting {
  const rig = buildLightRig(quality, roomLights, set.diningRoot);
  const { key } = rig;
  const high = quality.tier === 'high';
  if (high) ensureVenueShadowLayers(set);

  // Only tagged materials (metal, glass, glaze, water) sample the venue map. A scene-wide environment put
  // two cube-map lookups on every room pixel, the largest share of the pass's per-frame cost.
  const environment = high ? createVenueEnvironment(renderer) : null;
  const glow = high ? createVenueGlow(scene, set.diningRoot) : null;
  const retainedLights = new Set(rig.lights);
  const applyMaterials = (root: THREE.Object3D) => {
    if (environment) applyVenueMaterialTags(root, environment.texture, isActorRoot);
    else applyLowCostVenue(root, retainedLights);
  };

  // Characters keep their own explicit environment and are skipped.
  const seenRoots = new WeakSet<THREE.Object3D>();
  const scanRoot = (root: THREE.Object3D) => {
    seenRoots.add(root);
    if (!isActorRoot(root)) applyMaterials(root);
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
  const drawClock = createFrameIntervalClock();
  let frameSeconds = 0;
  // Registered before the warmup's own waits, so these tags land before compileAsync; the
  // next-frame retag still catches meshes an asset callback inserts after this one.
  const assetReady = () => {
    if (disposed) return;
    assetsReady++; retag = true;
    applyMaterials(scene);
  };
  // Late model meshes (plants) and licensed maps: rescan tags and refresh the static key shadow once each.
  void waitForEnvironmentAssets().then(assetReady, assetReady);
  void waitForRestaurantProps().then(assetReady, assetReady);

  const onContextRestored = () => {
    if (disposed) return;
    try {
      environment?.rebuild();
      applyMaterials(scene);
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
    if (retag || renders % TAG_RESCAN_RENDERS === 0) { retag = false; applyMaterials(scene); }
    // World matrices are current here, so a table move or furniture swap refreshes this same frame.
    const offset = set.diningRoot.matrixWorld.elements[14]!;
    const layoutChanged = offset !== lastOffset || double !== lastDouble || assetsReady !== lastAssets;
    if (layoutChanged || restored) {
      if (high) key.shadow.needsUpdate = true;
      lastOffset = offset; lastDouble = double; lastAssets = assetsReady; restored = false;
    }
    renders++;
    glow?.followLamp(set.flame, lampLevel);
    const renderedAt = performance.now();
    frameSeconds = drawClock.sample(renderedAt);
    renderedSinceUpdate = true;
  };
  scene.onBeforeRender = beforeRender;

  // Adaptive pixel ratio: never above the start, only from frames that rendered while visible.
  const samples = new Float32Array(512), sorted = new Float32Array(512);
  let sampleCount = 0, windowFrames = 0, windowTime = 0, playingSince: number | null = null, glowTime = 0;
  // The governor judges a resolution scale (1 = the tier's full resolution); the renderer turns it into a pixel ratio.
  const governor = createPixelRatioGovernor(1, quality.minScale);
  const resetWindow = () => { sampleCount = 0; windowFrames = 0; windowTime = 0; };
  const adapt = (state: DinnerState, gameplay: boolean) => {
    const rendered = renderedSinceUpdate;
    renderedSinceUpdate = false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      drawClock.reset(); frameSeconds = 0; playingSince = null; resetWindow(); return;
    }
    if (!quality.adaptive || governor.idle) return;
    // The selection preview also reports phase 'playing'; only the dinner itself counts.
    if (!gameplay) { playingSince = null; resetWindow(); return; }
    const now = performance.now() / 1000;
    if (playingSince === null) { if (state.phase === 'playing') playingSince = now; return; }
    if (now - playingSince < ADAPTIVE_PIXEL_RATIO.delay || !rendered || frameSeconds <= 0) return;
    // Animation dt is clamped for stable poses; quality must judge actual wall time between draws.
    if (sampleCount < samples.length) samples[sampleCount++] = frameSeconds;
    windowFrames++;
    windowTime += frameSeconds;
    if (windowTime < ADAPTIVE_PIXEL_RATIO.window) return;
    for (let i = 0; i < sorted.length; i++) sorted[i] = i < sampleCount ? samples[i]! : Infinity;
    sorted.sort();
    const median = sorted[sampleCount >> 1]!, mean = windowTime / windowFrames;
    resetWindow();
    const next = governor.judge(median, mean);
    if (next !== null) setResolutionScale(next);
  };

  return {
    rig,
    update(state, dt, time, reducedMotion, gameplay = true) {
      if (disposed) return;
      double = !!state.doubleDate;
      rig.setDoubleLayout(double);
      lampLevel = state.evening.tabletop?.shared.lampLevel ?? 2;
      // Candle flicker holds still under reduced motion.
      if (!reducedMotion) glowTime += Math.max(0, dt);
      glow?.setTime(glowTime);
      adapt(state, gameplay);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousBeforeRender;
      glow?.dispose();
      rig.dispose();
      environment?.dispose();
    },
  };
}
