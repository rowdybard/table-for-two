import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { installDomStubs } from './fixtures/tabletop-layout-harness';
import type { FacePose } from '../src/restaurant/render/FacialPerformance';

installDomStubs();
const { createCharacterHead } = await import('../src/restaurant/render/CharacterHead');

const pose = (overrides: Partial<FacePose> = {}): FacePose => ({
  smile: 0, asymmetry: 0, squint: 0, jaw: 0, press: 0, browAngle: 0, browLift: 0, browInner: 0, eyeOpen: 1,
  gazeX: 0, gazeY: 0, headPitch: 0, headYaw: 0, headRoll: 0, beat: 0, beatHand: 1, ...overrides,
});

function faceOf(root: THREE.Object3D) {
  let face: THREE.Mesh | null = null;
  root.traverse(object => { if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).geometry.morphAttributes.position) face = object as THREE.Mesh; });
  assert.ok(face, 'the face carries morph targets');
  return face as THREE.Mesh;
}

test('the face expression runs on GPU morph targets, so talking never rewrites or re-uploads the face', () => {
  const head = createCharacterHead('mira', '#d9a58a');
  const face = faceOf(head.root);
  const geometry = face.geometry;
  assert.equal(geometry.morphAttributes.position!.length, 6);
  assert.equal(geometry.morphAttributes.normal!.length, 6);
  assert.equal(geometry.morphTargetsRelative, true);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute, normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const versions = [position.version, normal.version], base = (position.array as Float32Array).slice();
  for (let i = 0; i < 30; i++) head.update(i / 30, 1 / 30, pose({ smile: Math.sin(i) * .6, jaw: .3 + .2 * Math.sin(i * 1.7), browLift: .002 * Math.sin(i), browAngle: .2, asymmetry: .4 }), true, .5, 0, 0);
  assert.deepEqual([position.version, normal.version], versions, 'no CPU upload of the face while speaking');
  assert.deepEqual(position.array, base, 'the base shape is never rewritten');

  head.update(1, 1 / 60, pose({ smile: .5, asymmetry: .4, jaw: .25, browLift: .002, browAngle: .15 }), false, 0, 0, 0);
  const w = face.morphTargetInfluences!;
  assert.ok(Math.abs(w[0]! - .5 * (1 - .14)) < 1e-9 && Math.abs(w[1]! - .5 * (1 + .14)) < 1e-9, 'an asymmetric smile lifts the +x side more, as the CPU morph did');
  assert.equal(w[2], 0);
  assert.ok(Math.abs(w[3]! - 2) < 1e-9 && Math.abs(w[4]! - 1.5) < 1e-9 && w[5] === .25);
  head.update(2, 1 / 60, pose({ smile: -.5 }), false, 0, 0, 0);
  assert.deepEqual(w.slice(0, 3), [0, 0, .5], 'a frown uses only the frown target');

  // Targets move the expected way: cheeks lift, the frown and jaw pull down, the glabella furrows inward.
  const extreme = (index: number, axis: 1 | 2, pick: 'max' | 'min') => {
    const array = geometry.morphAttributes.position![index]!.array as Float32Array;
    let value = 0;
    for (let v = axis; v < array.length; v += 3) value = pick === 'max' ? Math.max(value, array[v]!) : Math.min(value, array[v]!);
    return value;
  };
  assert.ok(extreme(0, 1, 'max') > .003 && extreme(1, 1, 'max') > .003);
  assert.ok(extreme(2, 1, 'min') < -.002 && extreme(5, 1, 'min') < -.004 && extreme(4, 2, 'min') < -.001);
  assert.ok(Math.abs(extreme(3, 1, 'max') - .00055) < 1e-4, 'one unit of brow influence is .55 mm');
  head.dispose();
});
