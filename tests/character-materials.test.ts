import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { installDomStubs } from './fixtures/tabletop-layout-harness';
import type { CharacterKind } from '../src/restaurant/render/CharacterBody';

installDomStubs();
const { RestaurantActor } = await import('../src/restaurant/render/RestaurantActor');

test('no cast material is shared between a skinned and a plain mesh, so three never switches its program every frame', () => {
  for (const kind of ['mira', 'jules', 'dev', 'waiter', 'diner', 'friend'] satisfies CharacterKind[]) {
    const actor = new RestaurantActor(kind);
    const skinned = new Set<THREE.Material>(), plain = new Set<THREE.Material>();
    actor.root.traverse(object => {
      if (!(object as THREE.Mesh).isMesh) return;
      const into = (object as THREE.SkinnedMesh).isSkinnedMesh ? skinned : plain;
      for (const material of ([] as THREE.Material[]).concat((object as THREE.Mesh).material)) into.add(material);
    });
    assert.ok(skinned.size > 0, `${kind} has skinned meshes`);
    const shared = [...skinned].filter(material => plain.has(material)).map(material => material.name || material.type);
    assert.deepEqual(shared, [], `${kind} shares materials between skinned and plain meshes`);
    actor.dispose();
  }
});
