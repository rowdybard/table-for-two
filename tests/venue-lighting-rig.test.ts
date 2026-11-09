import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { ADAPTIVE_PIXEL_RATIO, BOOTH_LIGHT, KEY_SHADOW, TABLE_SPOT_SHADOW, buildLightRig, createPixelRatioGovernor, enableActorShadowLayer, ensureVenueShadowLayers, fitDirectionalShadow, roomCorners } from '../src/restaurant/render/RestaurantLighting';
import { DYNAMIC_SHADOW_LAYER, PENDANTS, PENDANT_Y, STATIC_SHADOW_LAYER } from '../src/restaurant/render/VenueContract';
import { LAMP_HALO_SCALE, createVenueGlow, roomHaloLayout } from '../src/restaurant/render/VenueGlow';
import { applyVenueMaterialTags, createVenueEnvironmentProxy, installVenueGlass, VENUE_GLASS_CACHE_KEY } from '../src/restaurant/render/VenueEnvironment';

function rig(tier: 'high' | 'low') {
  const roomLights = new THREE.Group(), diningRoot = new THREE.Group();
  const scene = new THREE.Scene();
  const station = new THREE.Group();
  station.add(diningRoot);
  scene.add(roomLights, station);
  return { roomLights, diningRoot, scene, rig: buildLightRig({ tier }, roomLights, diningRoot) };
}

const countLights = (root: THREE.Object3D) => { let n = 0; root.traverse(object => { if ((object as THREE.Light).isLight) n++; }); return n; };
const near = (actual: number, expected: number, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('the high tier owns nine lights and the low tier seven, with a fixed caster set', () => {
  for (const [tier, expected, pendants] of [['high', 9, 4], ['low', 7, 2]] as const) {
    const { roomLights, diningRoot, rig: lights } = rig(tier);
    assert.equal(lights.lights.length, expected, tier);
    assert.equal(countLights(roomLights) + countLights(diningRoot), expected, tier);
    assert.equal(lights.pendants.length, pendants, tier);
    assert.equal(lights.booth.parent, diningRoot, 'both tiers keep the booth face light');
    assert.deepEqual(lights.lights.filter(light => light.castShadow).map(light => light.name).sort(), ['venue-key', 'venue-table-spot']);
    for (const light of lights.lights) assert.equal((light as THREE.PointLight).decay ?? 2, 2, light.name);
  }
});

test('the key light renders only the static layer and the table spot only the dynamic layer', () => {
  for (const tier of ['high', 'low'] as const) {
    const { rig: lights } = rig(tier);
    assert.equal(lights.key.shadow.camera.layers.mask, 2);
    assert.equal(lights.table.shadow.camera.layers.mask, 4);
    assert.equal(1 << STATIC_SHADOW_LAYER, 2);
    assert.equal(1 << DYNAMIC_SHADOW_LAYER, 4);
    // Lights themselves stay on layer 0 so the main camera and the warmup compile count them.
    for (const light of lights.lights) assert.equal(light.layers.mask, 1, light.name);
    assert.equal(lights.key.shadow.autoUpdate, false);
    assert.equal(lights.key.shadow.needsUpdate, true);
    assert.equal(lights.key.shadow.mapSize.x, KEY_SHADOW.mapSize);
    const spot = TABLE_SPOT_SHADOW[tier];
    assert.equal(lights.table.shadow.mapSize.x, spot.mapSize);
    assert.equal(lights.table.shadow.mapSize.y, spot.mapSize);
    assert.equal(lights.table.shadow.normalBias, spot.normalBias);
    assert.equal(lights.table.shadow.autoUpdate, tier === 'high');
    near(lights.table.shadow.focus, .55);
    near(lights.table.shadow.intensity, .85);
    near(lights.key.shadow.intensity, .8);
  }
  assert.equal(TABLE_SPOT_SHADOW.high.mapSize, 1024);
  assert.equal(TABLE_SPOT_SHADOW.low.mapSize, 512);
});

test('the table spot and booth light travel with the dining station, and every spot target sits beside its light', () => {
  const { roomLights, diningRoot, rig: lights } = rig('high');
  assert.equal(lights.table.parent, diningRoot);
  assert.equal(lights.booth.parent, diningRoot);
  const spots = [lights.table, ...lights.pendants, lights.bar];
  for (const spot of spots) {
    assert.ok(spot.parent, spot.name);
    assert.equal(spot.target.parent, spot.parent, spot.name);
    assert.equal(spot.decay, 2, spot.name);
  }
  assert.equal(lights.key.target.parent, roomLights);
  for (const spot of [...lights.pendants, lights.bar]) assert.equal(spot.parent, roomLights, spot.name);
  // The pendant spots hang inside their shades, at the contract's pendant centres.
  for (const [i, spot] of [lights.table, ...lights.pendants].entries()) {
    near(spot.position.x, PENDANTS[i]![0]);
    near(spot.position.y, PENDANT_Y.light);
    near(spot.position.z, PENDANTS[i]![1]);
    near(spot.target.position.x, PENDANTS[i]![0]);
    near(spot.target.position.z, PENDANTS[i]![1]);
    assert.ok(spot.target.position.y < spot.position.y, spot.name);
  }
  near(lights.table.target.position.y, .78);
  // Moving the quiet table carries the light and its target together.
  diningRoot.parent!.position.z = 3.85;
  diningRoot.parent!.updateMatrixWorld(true);
  const light = new THREE.Vector3().setFromMatrixPosition(lights.table.matrixWorld);
  const target = new THREE.Vector3().setFromMatrixPosition(lights.table.target.matrixWorld);
  near(light.z, PENDANTS[0][1] + 3.85);
  near(target.z, PENDANTS[0][1] + 3.85);
});

test('the booth light follows the solo or Double layout without changing the light count', () => {
  for (const tier of ['high', 'low'] as const) {
    const { rig: lights } = rig(tier);
    const count = lights.lights.length;
    assert.deepEqual(lights.booth.position.toArray(), [...BOOTH_LIGHT.solo], tier);
    lights.setDoubleLayout(true);
    assert.deepEqual(lights.booth.position.toArray(), [...BOOTH_LIGHT.double], tier);
    lights.setDoubleLayout(false);
    assert.deepEqual(lights.booth.position.toArray(), [...BOOTH_LIGHT.solo], tier);
    assert.equal(lights.lights.length, count, tier);
  }
});

test('the bar spot cone takes in the shelves and the bar sign', () => {
  const { scene, rig: lights } = rig('low');
  scene.updateMatrixWorld(true);
  const from = new THREE.Vector3().setFromMatrixPosition(lights.bar.matrixWorld);
  const axis = new THREE.Vector3().setFromMatrixPosition(lights.bar.target.matrixWorld).sub(from).normalize();
  // Sign centre and the upper and lower bottle shelves (RestaurantScene's bar backdrop).
  for (const point of [[0, 2.97, -6.88], [0, 2.25, -6.69], [0, 1.62, -6.69]] as const) {
    const ray = new THREE.Vector3(...point).sub(from).normalize();
    assert.ok(ray.dot(axis) > Math.cos(lights.bar.angle), `outside the cone: ${point}`);
  }
});

test('the adaptive pixel ratio keeps a step only when frames get faster', () => {
  const capped = 1 / 30, { slowFrame, step } = ADAPTIVE_PIXEL_RATIO;
  // A 30 Hz rAF cap (iOS Low Power Mode, Chrome Energy Saver): the probe gains nothing and is undone.
  const phone = createPixelRatioGovernor(1.25, .75);
  assert.equal(phone.judge(capped, capped), 1.25 - step);
  assert.equal(phone.judge(capped, capped), 1.25, 'the probe is undone');
  for (let i = 0; i < 5; i++) assert.equal(phone.judge(capped * 1.02, capped * 1.02), null, 'the cap becomes the bar');
  assert.equal(phone.ratio, 1.25);
  // Much slower than the cap again: probe once more.
  assert.equal(phone.judge(.06, .06), 1);

  // Fill-bound frames: keep each step that helps, stop at the floor.
  const slow = createPixelRatioGovernor(1.25, .75);
  assert.equal(slow.judge(.045, .045), 1);
  assert.equal(slow.judge(.03, .03), .75, 'faster but still slow: keep and step again');
  assert.equal(slow.idle, false, 'the floor step still needs judging');
  assert.equal(slow.judge(.02, .02), null, 'kept at the floor');
  assert.equal(slow.ratio, .75);
  assert.equal(slow.idle, true);

  // A probe that only helps the median, not the mean, is undone.
  const hitchy = createPixelRatioGovernor(1.5, 1);
  assert.equal(hitchy.judge(slowFrame + .005, .03), 1.25);
  assert.equal(hitchy.judge(.016, .029), 1.5);

  // Fast frames never step, and a start at the floor has nothing to do.
  const fast = createPixelRatioGovernor(1.5, 1);
  for (let i = 0; i < 5; i++) assert.equal(fast.judge(1 / 60, 1 / 60), null);
  assert.equal(createPixelRatioGovernor(1, 1).idle, true);
  assert.equal(createPixelRatioGovernor(1, 1).judge(.05, .05), null);
});

test('the static key shadow box is fitted to every room corner with margin', () => {
  const { rig: lights } = rig('high');
  const camera = lights.key.shadow.camera;
  // Recreate what LightShadow.updateMatrices does at render time.
  camera.position.copy(lights.key.position);
  camera.lookAt(lights.key.target.position);
  camera.updateMatrixWorld(true);
  const corners = roomCorners();
  assert.equal(corners.length, 8);
  for (const corner of corners) {
    const local = corner.clone().applyMatrix4(camera.matrixWorldInverse);
    assert.ok(local.x >= camera.left + .3 - 1e-6 && local.x <= camera.right - .3 + 1e-6, `x ${local.x}`);
    assert.ok(local.y >= camera.bottom + .3 - 1e-6 && local.y <= camera.top - .3 + 1e-6, `y ${local.y}`);
    assert.ok(-local.z > camera.near && -local.z < camera.far, `depth ${-local.z}`);
  }
  // The corner the earlier ±8.5 box missed is now inside.
  const far = new THREE.Vector3(-6.75, 3.5, -7.25).applyMatrix4(camera.matrixWorldInverse);
  assert.ok(far.y < camera.top && far.y > camera.bottom);
  const depth = fitDirectionalShadow(lights.key, corners, .3);
  assert.ok(depth.minDepth > KEY_SHADOW.near && depth.maxDepth < KEY_SHADOW.far);
});

test('actor shadows skip the head, hair cards and interaction targets', () => {
  const root = new THREE.Group(); root.name = 'character-mira';
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); body.castShadow = true;
  const cards = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); cards.castShadow = false;
  const head = new THREE.Group(); head.name = 'head-mira';
  const face = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); face.castShadow = true; head.add(face);
  const target = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); target.castShadow = true; target.userData.target = 'date';
  const arm = new THREE.Group(); const hand = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); hand.castShadow = true; arm.add(hand);
  root.add(body, cards, head, target, arm);
  enableActorShadowLayer(root);
  assert.ok(body.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(hand.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(!cards.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(!face.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(!target.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  for (const mesh of [body, hand, face]) assert.ok(mesh.layers.isEnabled(0));
});

test('untagged baked batches fall back into the split shadow layers, tagged ones are left alone', () => {
  const batch = (name: string, cast = true) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); mesh.name = name; mesh.castShadow = cast; return mesh; };
  const root = new THREE.Group(), diningRoot = new THREE.Group(), furniture = new THREE.Group();
  const wall = batch('restaurant-plaster'), chair = batch('restaurant-wood'), fixture = batch('restaurant-ceramic', false), prop = batch('menu');
  prop.castShadow = true;
  furniture.add(chair); diningRoot.add(furniture, fixture, prop); root.add(wall, diningRoot);
  ensureVenueShadowLayers({ root, diningRoot });
  assert.ok(wall.layers.isEnabled(STATIC_SHADOW_LAYER));
  assert.ok(chair.layers.isEnabled(STATIC_SHADOW_LAYER) && chair.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(!fixture.layers.isEnabled(STATIC_SHADOW_LAYER) && !fixture.layers.isEnabled(DYNAMIC_SHADOW_LAYER));
  assert.ok(!prop.layers.isEnabled(STATIC_SHADOW_LAYER) && !prop.layers.isEnabled(DYNAMIC_SHADOW_LAYER));

  const tagged = new THREE.Group(), taggedDining = new THREE.Group();
  const taggedWall = batch('restaurant-plaster'), untaggedBench = batch('restaurant-velvet'), taggedChair = batch('restaurant-wood');
  taggedWall.layers.enable(STATIC_SHADOW_LAYER); taggedChair.layers.enable(DYNAMIC_SHADOW_LAYER);
  taggedDining.add(taggedChair); tagged.add(taggedWall, untaggedBench, taggedDining);
  ensureVenueShadowLayers({ root: tagged, diningRoot: taggedDining });
  assert.ok(!untaggedBench.layers.isEnabled(STATIC_SHADOW_LAYER), 'a deliberate surfaces choice is not overridden');
  assert.ok(!taggedChair.layers.isEnabled(STATIC_SHADOW_LAYER));
});

test('venue tags set an explicit environment and chain the glass hook once', () => {
  const env = new THREE.Texture();
  const metal = new THREE.MeshStandardMaterial(); metal.userData.venueEnv = 1;
  const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: .14 }); glass.userData.venueEnv = 1.2; glass.userData.venueGlass = true;
  const plain = new THREE.MeshStandardMaterial();
  const basic = new THREE.MeshBasicMaterial(); basic.userData.venueEnv = 1;
  const actorMaterial = new THREE.MeshStandardMaterial(); actorMaterial.userData.venueEnv = 1;
  const actorEnv = new THREE.Texture(); actorMaterial.envMap = actorEnv;
  const root = new THREE.Group();
  for (const material of [metal, glass, plain, basic]) root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const actor = new THREE.Group(); actor.name = 'character-dev'; actor.add(new THREE.Mesh(new THREE.BoxGeometry(), actorMaterial)); root.add(actor);
  let earlier = 0;
  glass.onBeforeCompile = () => { earlier++; };
  glass.customProgramCacheKey = () => 'earlier-hook';
  applyVenueMaterialTags(root, env, object => object.name.startsWith('character-'));
  applyVenueMaterialTags(root, env, object => object.name.startsWith('character-'));
  assert.equal(metal.envMap, env); assert.equal(metal.envMapIntensity, 1);
  assert.equal(glass.envMap, env); near(glass.envMapIntensity, 1.2);
  assert.equal(plain.envMap, null, 'untagged materials use scene.environment');
  assert.equal(actorMaterial.envMap, actorEnv, 'characters keep their own environment');
  assert.equal(glass.customProgramCacheKey(), 'earlier-hook|' + VENUE_GLASS_CACHE_KEY);
  const shader = { fragmentShader: 'a\n#include <opaque_fragment>\nb', vertexShader: '', uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  glass.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
  assert.equal(earlier, 1, 'the earlier hook runs exactly once');
  assert.match(shader.fragmentShader, /venueGlassAlpha/);
  assert.match(shader.fragmentShader, /#include <opaque_fragment>/, 'opaque and transmissive variants keep the stock chunk');
  assert.equal(installVenueGlass(glass), false, 'never wrapped twice');
  // Two glass materials with different earlier hooks keep different program keys.
  const a = new THREE.MeshStandardMaterial({ transparent: true }), b = new THREE.MeshStandardMaterial({ transparent: true });
  a.onBeforeCompile = shader => { shader.fragmentShader += '//a'; };
  b.onBeforeCompile = shader => { shader.fragmentShader += '//b'; };
  installVenueGlass(a); installVenueGlass(b);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});

test('the halo layout and environment proxy follow the venue contract', () => {
  const halos = roomHaloLayout();
  assert.equal(halos.filter(halo => halo.mode === 0 && halo.flicker === 0).length, PENDANTS.length - 1, 'P1..P4; P0 travels with the table');
  assert.equal(halos.filter(halo => halo.flicker > 0).length, 6);
  assert.equal(halos.filter(halo => halo.mode === 1).length, 2);
  for (const halo of halos.filter(halo => halo.mode === 1)) assert.ok(halo.shape > 0 && halo.shape < 1);
  assert.deepEqual([...LAMP_HALO_SCALE], [0, .55, 1]);
  const proxy = createVenueEnvironmentProxy();
  let meshes = 0, lights = 0;
  proxy.scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes++; if ((object as THREE.Light).isLight) lights++; });
  assert.equal(lights, 0);
  assert.ok(meshes >= 1 + PENDANTS.length + 2 + 5 + 2);
  proxy.dispose();
  assert.equal(proxy.scene.children.length, 0);
});

test('the halos stay outside the tabletop props and the lamp halo follows the bulb', () => {
  const scene = new THREE.Scene(), station = new THREE.Group(), diningRoot = new THREE.Group(), props = new THREE.Group(), lamp = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.SphereGeometry(.015), new THREE.MeshBasicMaterial());
  flame.position.set(0, .155, 0); lamp.position.set(-.2, .782, -1.12);
  lamp.add(flame); props.add(lamp); diningRoot.add(props); station.add(diningRoot); scene.add(station);
  const glow = createVenueGlow(scene, diningRoot);
  assert.equal(glow.room.parent, scene);
  assert.equal(glow.room.frustumCulled, false, 'billboarded instances must never be culled by their bounds');
  assert.equal(glow.room.count, roomHaloLayout().length);
  assert.equal(glow.tableHalo.parent, diningRoot);
  near(glow.tableHalo.position.y, PENDANT_Y.halo);
  assert.equal(glow.lampHalo.parent, scene);
  let insideProps = false;
  props.traverse(object => { if ((object as THREE.Sprite).isSprite) insideProps = true; });
  assert.equal(insideProps, false);
  for (const material of [glow.room.material as THREE.Material, glow.tableHalo.material, glow.lampHalo.material]) {
    assert.equal(material.blending, THREE.AdditiveBlending);
    assert.equal(material.depthWrite, false);
    assert.equal(material.toneMapped, false);
  }

  station.position.z = 3.85; scene.updateMatrixWorld(true);
  glow.followLamp(flame, 2);
  assert.equal(glow.lampHalo.visible, true);
  const bulb = new THREE.Vector3().setFromMatrixPosition(flame.matrixWorld);
  assert.ok(new THREE.Vector3().setFromMatrixPosition(glow.lampHalo.matrixWorld).distanceTo(bulb) < 1e-9);
  near(glow.lampHalo.scale.x, .3);
  glow.followLamp(flame, 1);
  near(glow.lampHalo.scale.x, .3 * .55);
  glow.followLamp(flame, 0);
  assert.equal(glow.lampHalo.visible, false);
  lamp.visible = false; glow.followLamp(flame, 2);
  assert.equal(glow.lampHalo.visible, false, 'hidden with any ancestor');
  lamp.visible = true; station.removeFromParent(); glow.followLamp(flame, 2);
  assert.equal(glow.lampHalo.visible, false, 'never drawn for a detached bulb');
  glow.followLamp(null, 2);
  assert.equal(glow.lampHalo.visible, false);

  glow.dispose();
  assert.equal(glow.room.parent, null);
  assert.equal(glow.tableHalo.parent, null);
  assert.equal(glow.lampHalo.parent, null);
  assert.doesNotThrow(() => glow.dispose());
});

test('disposing the rig detaches every light and target', () => {
  const { roomLights, diningRoot, rig: lights } = rig('high');
  lights.dispose();
  assert.equal(roomLights.children.length, 0);
  assert.equal(diningRoot.children.length, 0);
  assert.doesNotThrow(() => lights.dispose());
});
