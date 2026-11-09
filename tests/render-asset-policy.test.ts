import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { prepareCharacterLighting } from '../src/restaurant/render/CharacterLighting';
import { placeRestaurantPlant } from '../src/restaurant/render/RestaurantPlantPolicy';
import { createNightExterior } from '../src/restaurant/render/NightExterior';
import { applyNightExteriorQuality } from '../src/restaurant/render/NightExteriorQuality';
import type { RestaurantPropKit } from '../src/restaurant/render/RestaurantPropKit';

test('low tier keeps the plant fallback without requesting the detailed model', () => {
  const root = new THREE.Group(); root.userData.models = {};
  let loads = 0;
  const props: Pick<RestaurantPropKit, 'root' | 'place'> = {
    root,
    place: () => { loads++; return new THREE.Group(); },
  };
  const fallbacks = Array.from({ length: 4 }, () => new THREE.Group());
  for (const [index, fallback] of fallbacks.entries()) {
    const anchor = placeRestaurantPlant(props, fallback, index, -index, 1.55, index * 1.1, { tier: 'low' });
    assert.equal(anchor.parent, root);
    assert.equal(fallback.parent, anchor);
    assert.equal(fallback.visible, true);
    assert.equal(anchor.position.x, index);
    assert.equal(anchor.position.z, -index);
    assert.equal(anchor.rotation.y, index * 1.1);
  }
  assert.equal(loads, 0);
  assert.equal(root.userData.models.plant, 'fallback');
  placeRestaurantPlant(props, new THREE.Group(), 0, 0, 1, 0, { tier: 'high' });
  placeRestaurantPlant(props, new THREE.Group(), 0, 0, 1, 0);
  assert.equal(loads, 2, 'high and default tiers still request the authored plant');
});

test('low tier keeps character materials and cutouts but omits reflections and anisotropy', () => {
  const root = new THREE.Group();
  const map = new THREE.Texture(), environment = new THREE.Texture();
  const hair = new THREE.MeshPhysicalMaterial({ map, alphaTest: .31, side: THREE.DoubleSide, anisotropy: .4 });
  const hook = hair.onBeforeCompile;
  const hairMesh = new THREE.Mesh(new THREE.BufferGeometry(), hair); hairMesh.name = 'hair-cards-test';
  const skin = new THREE.MeshStandardMaterial({ map });
  const skinMesh = new THREE.Mesh(new THREE.BufferGeometry(), skin);
  const target = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()); target.userData.target = true;
  root.add(hairMesh, skinMesh, target);
  prepareCharacterLighting(root, environment, { tier: 'low' });
  assert.equal(hairMesh.material, hair);
  assert.equal(hair.map, map);
  assert.equal(hair.alphaTest, .31);
  assert.equal(hair.side, THREE.DoubleSide);
  assert.equal(hair.onBeforeCompile, hook);
  assert.equal(hair.anisotropy, 0);
  assert.equal(hair.envMap, null);
  assert.equal(skin.envMap, null);
  assert.equal(skinMesh.castShadow, false);
  assert.equal(skinMesh.receiveShadow, false);
  assert.equal(target.castShadow, false);
});

test('high tier retains reflection, hair anisotropy and normal shadow policy', () => {
  const root = new THREE.Group(), env = new THREE.Texture();
  const hair = new THREE.MeshPhysicalMaterial({ anisotropy: .4 });
  const hairMesh = new THREE.Mesh(new THREE.BufferGeometry(), hair); hairMesh.name = 'hair-cards-test';
  const skin = new THREE.MeshStandardMaterial();
  const skinMesh = new THREE.Mesh(new THREE.BufferGeometry(), skin);
  root.add(hairMesh, skinMesh);
  prepareCharacterLighting(root, env);
  assert.equal(hair.anisotropy, .4);
  assert.equal(hair.envMap, env);
  assert.equal(hairMesh.castShadow, false);
  assert.equal(skin.envMap, env);
  assert.equal(skinMesh.castShadow, true);
  assert.equal(skinMesh.receiveShadow, true);
});

test('low tier hides the rain shader but retains the actual night backdrop', () => {
  const exterior = createNightExterior();
  const rain: THREE.Object3D[] = [], backdrop: THREE.Object3D[] = [];
  exterior.root.traverse(object => {
    if (object.name === 'rain-window-glass') rain.push(object);
    else if (object instanceof THREE.Mesh) backdrop.push(object);
  });
  assert.equal(rain.length, 5);
  assert.ok(backdrop.length > 0);
  applyNightExteriorQuality(exterior.root, { tier: 'high' });
  assert.ok(rain.every(object => object.visible));
  applyNightExteriorQuality(exterior.root, { tier: 'low' });
  assert.ok(rain.every(object => !object.visible));
  assert.ok(backdrop.every(object => object.visible));
  exterior.dispose();
});
