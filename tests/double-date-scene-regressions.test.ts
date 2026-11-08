import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { MENU } from '../src/restaurant/content';
import { activateRestaurantScenario, createRestaurantScenario } from '../src/restaurant/scenarios';
import type { DoubleDateRoomState } from '../src/restaurant/double-date-types';

before(async () => { await RAPIER.init(); });

function fixture() {
  const usage = emptyUsage();
  const room: DoubleDateRoomState = {
    id: 'scene-regression', code: 'SCENES', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [0, 0, 0], yaw: 0, seated: true },
      { id: 'h2', name: 'Sam', connected: true, ready: true, dateId: 'jules', position: [0, 0, 0], yaw: 0, seated: true },
    ],
    dates: [], views: { h1: createPairView('scene-regression', 'h1', 'Alex', 'mira', usage, 2), h2: createPairView('scene-regression', 'h2', 'Sam', 'jules', usage, 2) },
    lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] },
  };
  const scene = new DoubleTableScene(room);
  scene.chooseDate('h1', 'mira'); scene.chooseDate('h2', 'jules'); scene.setPhase('playing');
  for (const [index, human] of (['h1', 'h2'] as const).entries()) {
    const view = room.views[human]; view.seated = true; view.order = MENU[index];
    view.evening.main.status = 'finished'; view.evening.main.servedDish = view.order; view.evening.dessert.status = 'skipped';
    room.members.find(member => member.id === human)!.seated = true;
  }
  return { room, scene };
}

test('a departed diner’s wrong meal is cleared by staff instead of becoming the remaining diner’s false ticket', () => {
  const { room, scene } = fixture();
  try {
    for (const view of Object.values(room.views)) { view.elapsed = 45; view.evening.main.status = 'waiting'; view.evening.main.servedDish = null; view.evening.main.bites = 0; }
    scene.step(.016, 1000);
    assert.equal(room.views.h1.evening.incident?.event, 'wrong-order');
    const incorrectPlate = room.views.h1.evening.main.servedDish;
    assert.notEqual(incorrectPlate, room.views.h1.order);
    const remainingMeal = room.views.h2.evening.main.servedDish;
    const originalOrder = room.views.h1.order;
    room.views.h1.memory = 'An established conversation before the dinner ended.';
    scene.command('h1', { type: 'finish' }, 1100);
    const next = room.views.h2;
    assert.equal(room.views.h1.phase, 'ended'); assert.equal(room.views.h1.evening.incident, null);
    assert.equal(room.views.h1.evening.main.servedDish, null); assert.equal(room.views.h1.evening.main.status, 'finished', 'the renderer hides a finished main rather than falling back to the original order');
    assert.equal(room.views.h1.order, originalOrder); assert.equal(room.views.h1.memory, 'An established conversation before the dinner ended.');
    assert.equal(room.views.h1.evening.farewell.ending?.kind, 'early-exit'); assert.equal(room.views.h1.evening.farewell.ending?.description, 'You chose when this evening was finished for you.');
    assert.equal(next.evening.incident, null); assert.equal(next.evening.main.servedDish, remainingMeal); assert.equal(next.order, remainingMeal);
    assert.match(next.evening.resolutions['wrong-order']!, /Eli cleared Alex/); assert.ok(next.evening.resolutions['wrong-order']!.includes(incorrectPlate!));
    assert.ok(next.evening.moments.some(moment => moment.id === 'wrong-order' && moment.description.includes('remaining diner’s meal was left unchanged')));
    assert.ok(next.evening.cues.some(cue => cue.key === 'wrong-order-cleared' && cue.utterances[0].speaker === 'waiter'));
    assert.equal(next.evening.lastInterruptionAt, next.elapsed);
    assert.throws(() => scene.command('h2', { type: 'evening', action: 'inspect-ticket' }, 1200));
    assert.equal(next.evening.moments.some(moment => moment.id === 'ticket'), false);
    next.evening.main.bites = 3; scene.command('h2', { type: 'evening', action: 'finish-main' }, 1300);
    assert.equal(next.evening.main.status, 'finished'); assert.equal(next.evening.incident, null);
  } finally { scene.free(); }
});

test('shared bill preflight rejects an unavailable second pair before mutating the first pair', () => {
  for (const blocked of ['standing', 'leaving', 'incident', 'scenario', 'rolling'] as const) {
    const { room, scene } = fixture();
    try {
      const other = room.views.h2;
      if (blocked === 'standing') { other.seated = false; room.members[1].seated = false; }
      if (blocked === 'leaving') other.evening.stance = 'leaving';
      if (blocked === 'incident') other.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 };
      if (blocked === 'rolling') other.evening.coasters.phase = 'rolling';
      if (blocked === 'scenario') { other.evening.scenario = createRestaurantScenario('bill', 'family-visit'); activateRestaurantScenario(other.evening.scenario, 0, 'dry'); }
      const before = structuredClone(room);
      assert.throws(() => scene.command('h1', { type: 'evening', action: 'request-bill' }, 1000), blocked);
      assert.deepEqual(room, before, `${blocked}: a rejected shared action must add no bill, cue, moment, or memory`);
    } finally { scene.free(); }
  }
});

test('shared settlement preflight rejects mismatched bill state atomically, then settles both eligible pairs', () => {
  for (const blocked of ['missing-request', 'already-settled'] as const) {
    const { room, scene } = fixture();
    try {
      room.views.h1.evening.bill.requested = true;
      if (blocked === 'already-settled') { room.views.h2.evening.bill.requested = true; room.views.h2.evening.bill.settlement = 'separate'; }
      const before = structuredClone(room);
      assert.throws(() => scene.command('h1', { type: 'evening', action: 'settle-bill', choice: 'split' }, 1000), blocked);
      assert.deepEqual(room, before);
    } finally { scene.free(); }
  }
  const { room, scene } = fixture();
  try {
    scene.command('h1', { type: 'evening', action: 'request-bill' }, 1000);
    scene.command('h2', { type: 'evening', action: 'settle-bill', choice: 'split' }, 1100);
    for (const view of Object.values(room.views)) { assert.equal(view.evening.bill.settlement, 'split'); assert.equal(view.stage, 'farewell'); }
  } finally { scene.free(); }
});

test('a seated wingman can settle the remaining pair’s eligible bill while preserving their own completed outcome', () => {
  const { room, scene } = fixture();
  try {
    scene.command('h1', { type: 'finish' }, 1000);
    const ending = structuredClone(room.views.h1.evening.farewell.ending), bill = structuredClone(room.views.h1.evening.bill);
    scene.command('h1', { type: 'evening', action: 'request-bill' }, 1100);
    scene.command('h1', { type: 'evening', action: 'settle-bill', choice: 'separate' }, 1200);
    assert.equal(room.views.h2.evening.bill.settlement, 'separate');
    assert.equal(room.views.h1.phase, 'ended'); assert.deepEqual(room.views.h1.evening.farewell.ending, ending); assert.deepEqual(room.views.h1.evening.bill, bill);
  } finally { scene.free(); }
});
