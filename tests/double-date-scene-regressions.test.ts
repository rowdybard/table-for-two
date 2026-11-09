import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { MENU } from '../src/restaurant/content';
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
    next.evening.resolutions['spilled-drink'] = 'The table was dried earlier.';
    for (let bite = 0; bite < 3; bite++) scene.command('h2', { type: 'evening', action: 'taste' }, 1300 + bite * 600);
    next.elapsed = 140; scene.step(.016, 3200);
    assert.equal(next.evening.main.status, 'finished', 'Eli clears the plates on his own once the diner has eaten'); assert.equal(next.evening.incident, null);
  } finally { scene.free(); }
});

test('one check comes for the whole table: Eli waits for every pair’s dessert and for a table nobody is mopping', () => {
  const { room, scene } = fixture();
  try {
    const first = room.views.h1, second = room.views.h2;
    first.evening.dessert.finishedAt = 100; first.elapsed = 200;
    second.evening.dessert.status = 'none'; second.elapsed = 200;
    scene.step(.016, 1000);
    assert.equal(first.evening.bill.requested, false, 'the other pair has not decided on dessert');
    second.evening.dessert.status = 'skipped'; second.evening.dessert.finishedAt = 195;
    scene.step(.016, 1100);
    assert.equal(first.evening.bill.requested, false, 'the other pair only just declined dessert');
    second.evening.dessert.finishedAt = 100; second.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 190 };
    scene.step(.016, 1200);
    assert.equal(first.evening.bill.requested, false, 'nobody brings a check to a table mid-spill');
    assert.equal(second.evening.bill.requested, false);
    second.evening.incident = null;
    scene.step(.016, 1300); scene.step(.016, 1400);
    for (const view of [first, second]) {
      assert.equal(view.evening.bill.requested, true); assert.equal(view.evening.chapter, 'bill'); assert.equal(view.evening.bill.arrivedAt, view.elapsed);
      assert.ok(view.evening.cues.some(cue => cue.key === 'bill-requested' && cue.utterances[0].speaker === 'waiter'));
    }
    assert.equal(first.evening.bill.arrivedAt, second.evening.bill.arrivedAt, 'one check arrives for the table');
  } finally { scene.free(); }
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
    for (const view of Object.values(room.views)) { view.evening.dessert.finishedAt = 100; view.elapsed = 200; }
    scene.step(.016, 1000);
    assert.ok(Object.values(room.views).every(view => view.evening.bill.requested), 'Eli brought one check for the table');
    scene.command('h2', { type: 'evening', action: 'settle-bill', choice: 'split' }, 1100);
    for (const view of Object.values(room.views)) { assert.equal(view.evening.bill.settlement, 'split'); assert.equal(view.stage, 'farewell'); }
  } finally { scene.free(); }
});

test('a seated wingman can settle the remaining pair’s eligible bill while preserving their own completed outcome', () => {
  const { room, scene } = fixture();
  try {
    scene.command('h1', { type: 'finish' }, 1000);
    const ending = structuredClone(room.views.h1.evening.farewell.ending), bill = structuredClone(room.views.h1.evening.bill);
    room.views.h2.evening.dessert.finishedAt = 100; room.views.h2.elapsed = 200; scene.step(.016, 1100);
    assert.equal(room.views.h2.evening.bill.requested, true, 'the remaining pair’s check does not wait for an ended date');
    scene.command('h1', { type: 'evening', action: 'settle-bill', choice: 'separate' }, 1200);
    assert.equal(room.views.h2.evening.bill.settlement, 'separate');
    assert.equal(room.views.h1.phase, 'ended'); assert.deepEqual(room.views.h1.evening.farewell.ending, ending); assert.deepEqual(room.views.h1.evening.bill, bill);
  } finally { scene.free(); }
});
