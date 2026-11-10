import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { seatedTableFieldOfView, seatedTablePitch, sharedTableCameraYaw } from '../src/restaurant/render/TableDateCamera';
import { alignSeatedDate, soloDateAtSeat } from '../src/restaurant/render/SeatedDatePose';

test('seated framing keeps the face and hands within portrait and landscape views', () => {
  for (const aspect of [.4, 9 / 16, 1, 16 / 9, 21 / 9]) {
    const camera = new THREE.PerspectiveCamera(seatedTableFieldOfView(aspect), aspect, .035, 45);
    // Seated human body z=.23; renderer moves the camera .14 toward the table.
    camera.position.set(0, 1.295, .09);
    camera.rotation.order = 'YXZ'; camera.rotation.set(seatedTablePitch(aspect), 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    for (const [name, point] of [
      ['top of head', [0, 1.56, -2.25]], ['eyes', [0, 1.39, -2.25]],
      // CharacterBody's seated hands rest at x=±.18, y=.808, z=.385 from the seat;
      // allow extra width for speaking gestures and hand geometry.
      ['left hand', [-.27, .82, -1.865]], ['right hand', [.27, .82, -1.865]],
    ] as const) {
      const p = new THREE.Vector3(...point).project(camera);
      assert.ok(Math.abs(p.x) < .96 && Math.abs(p.y) < .8, `${aspect}: ${name} falls outside the conversation frame`);
    }
  }
});

test('portrait puts eyes in the upper middle and keeps the hands above the caption area', () => {
  for (const aspect of [.4, 9 / 16]) {
    const camera = new THREE.PerspectiveCamera(seatedTableFieldOfView(aspect), aspect, .035, 45);
    camera.position.set(0, 1.295, .09);
    camera.rotation.set(seatedTablePitch(aspect), 0, 0, 'YXZ');
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const eyes = new THREE.Vector3(0, 1.39, -2.25).project(camera);
    const hand = new THREE.Vector3(.27, .82, -1.865).project(camera);
    assert.ok(eyes.y > .2 && eyes.y < .6, `${aspect}: eyes are not in the upper middle`);
    assert.ok(hand.y > -.5 && Math.abs(hand.x) < .8, `${aspect}: hand overlaps the lower caption region or is cropped`);
  }
  assert.equal(seatedTablePitch(9 / 16, true), -.075);
  assert.equal(seatedTablePitch(16 / 9), -.075);
});

test('authoritative arrival aligns position and facing in the first seated frame', () => {
  const actor = new THREE.Group();
  actor.position.set(1, 0, -1); actor.rotation.y = Math.PI / 2;
  const arriving = [.14, 0, -2.25];
  assert.equal(soloDateAtSeat([.16, 0, -2.25], 0, -2.25), false);
  alignSeatedDate(actor, arriving, false, 0);
  assert.deepEqual(actor.position.toArray(), [1, 0, -1]);
  assert.equal(actor.rotation.y, Math.PI / 2);
  assert.equal(soloDateAtSeat(arriving, 0, -2.25), true);
  alignSeatedDate(actor, arriving, true, .06);
  assert.deepEqual(actor.position.toArray(), arriving);
  assert.equal(actor.rotation.y, .06);
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
