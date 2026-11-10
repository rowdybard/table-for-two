import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { seatedTableFieldOfView, sharedTableCameraYaw } from '../src/restaurant/render/TableDateCamera';

test('seated framing keeps the face and hands within portrait and landscape views', () => {
  for (const aspect of [.4, 9 / 16, 1, 16 / 9, 21 / 9]) {
    const camera = new THREE.PerspectiveCamera(seatedTableFieldOfView(aspect), aspect, .035, 45);
    camera.position.set(0, 1.295, .14);
    camera.rotation.order = 'YXZ'; camera.rotation.set(-.075, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const [name, point] of [
      ['top of head', [0, 1.56, -2.25]], ['left hand', [-.65, .83, -2.1]], ['right hand', [.65, .83, -2.1]],
    ] as const) {
      const p = new THREE.Vector3(...point).project(camera);
      assert.ok(Math.abs(p.x) < .96 && Math.abs(p.y) < .8, `${aspect}: ${name} falls outside the conversation frame`);
    }
  }
});

test('the framing widens only when a viewport or shared table needs it', () => {
  assert.equal(seatedTableFieldOfView(16 / 9), 45);
  assert.ok(seatedTableFieldOfView(9 / 16) > seatedTableFieldOfView(16 / 9));
  assert.ok(seatedTableFieldOfView(16 / 9, true) > seatedTableFieldOfView(16 / 9));
  for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.ok(Number.isFinite(seatedTableFieldOfView(aspect)));
});

test('both dates fit from either shared-table seat in a standard portrait viewport', () => {
  for (const seatX of [-.57, .57]) {
    const aspect = 9 / 16;
    const camera = new THREE.PerspectiveCamera(seatedTableFieldOfView(aspect, true), aspect, .035, 45);
    camera.position.set(seatX, 1.295, .14); camera.rotation.order = 'YXZ';
    camera.rotation.set(-.075, sharedTableCameraYaw(seatX, 2.64), 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const x of [-1.2, -.57, .57, 1.2]) {
      const point = new THREE.Vector3(x, 1.35, -2.5).project(camera);
      assert.ok(Math.abs(point.x) < .98 && Math.abs(point.y) < .8, `seat ${seatX} crops x=${x}`);
    }
  }
});
