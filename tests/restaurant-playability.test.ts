import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { EveningDirector } from '../server/restaurant/evening';
import { emptyUsage } from '../server/restaurant/scene';
import { MENU } from '../src/restaurant/content';
import { DOUBLE_TABLE, type DoubleDateRoomState } from '../src/restaurant/double-date-types';
import { createEvening } from '../src/restaurant/evening';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

before(async () => { await RAPIER.init(); });

function dinner(): DinnerState {
  return { id: 'playability', generation: 0, mode: 'ai-date', phase: 'playing', dateId: 'mira', stage: 'dining', elapsed: 0,
    participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, 3.3] }, { id: 'p2', kind: 'ai', name: 'Mira', position: [0, 0, -2.25] }],
    seated: true, order: MENU[0], events: [], emotion: 'neutral', glassRaised: false, memory: '', sessionLimit: 2, usage: emptyUsage(), evening: createEvening('mira') };
}

function departAfterIgnoringDeliveredBoundary(view: DinnerState, director: EveningDirector) {
  const refusal = 'Please let me choose my own food. Do not order for me.';
  const line: SceneUtterance = { speaker: 'date', text: refusal, emotion: 'neutral' };
  const offer = 'Shall I choose your dinner for you?';
  director.social({ utterances: [line], emotion: 'neutral', action: 'none', memory: '', social: { signal: 'none', reason: 'The date chooses their own food.', wantsToLeave: false, boundary: { kind: 'set', topic: 'food-drink', refusal, evidence: offer } } }, offer);
  assert.equal(view.evening.farewell.ending, null, 'stating the initial refusal does not end the date');
  director.acknowledge(line);
  for (const evidence of ['I am choosing your dinner anyway.', 'I still insist on choosing your food despite your answer.']) {
    director.social({ utterances: [], emotion: 'annoyed', action: 'none', memory: '', social: { signal: 'pressure', reason: 'The delivered food choice boundary was ignored again.', wantsToLeave: true, boundary: { kind: 'repeat', topic: 'food-drink', refusal, evidence } } }, evidence);
  }
  assert.equal(structuredClone(view).evening.farewell.ending?.kind, 'walked-away');
}

test('the full entrance range offered by the farewell menu accepts a goodbye', () => {
  const view = dinner(), director = new EveningDirector(view);
  try {
    view.seated = false; view.evening.bill.requested = true; view.evening.bill.settlement = 'split'; view.evening.chapter = 'farewell'; view.stage = 'farewell';
    // 2.3m from the foyer centre: inside the existing 2.4m menu/exit affordance.
    director.action({ type: 'evening', action: 'farewell', choice: 'friendly' }, 1000);
    assert.equal(view.evening.farewell.ending?.kind, 'new-friend');
    assert.equal(view.phase, 'playing', 'the farewell retains its delivery window');
  } finally { director.free(); }
});

test('a table game during dessert does not erase the dessert chapter or prevent the timed diner interruption', () => {
  const view = dinner(), director = new EveningDirector(view);
  try {
    view.evening.main.status = 'finished'; view.evening.dessert.status = 'served'; view.evening.dessert.choice = 'lemon'; view.evening.chapter = 'dessert'; view.stage = 'dessert';
    view.evening.resolutions['wrong-order'] = 'The meal was checked earlier.'; view.evening.resolutions['spilled-drink'] = 'The table was dried earlier.';
    director.action({ type: 'evening', action: 'start-coasters' }, 1000);
    assert.equal(view.evening.chapter, 'dessert');
    view.elapsed = 901; director.step(1 / 60, { allowScenarios: false });
    assert.equal(view.evening.incident?.event, 'disruptive-diner');
  } finally { director.free(); }
});

test('pending kitchen service does not restart dinner or make a departing date speak again', () => {
  const view = dinner(), director = new EveningDirector(view);
  try {
    director.ordered(); view.elapsed = 20;
    departAfterIgnoringDeliveredBoundary(view, director);
    assert.equal(view.evening.farewell.ending?.kind, 'walked-away');
    view.elapsed = 45; director.step(1 / 60);
    assert.equal(view.stage, 'farewell'); assert.equal(view.phase, 'playing');
    assert.equal(view.evening.main.status, 'waiting');
    assert.equal(view.evening.cues.some(cue => cue.key === 'main-served'), false);
  } finally { director.free(); }
});

test('a shot in progress cannot append a congratulatory date line after a farewell starts', () => {
  const view = dinner(), director = new EveningDirector(view);
  try {
    director.action({ type: 'evening', action: 'start-coasters' }, 1000);
    Object.assign(view.evening.coasters, { phase: 'aiming', turn: 'date', round: 3 });
    director.coasters.shoot(0, .6, 'date');
    departAfterIgnoringDeliveredBoundary(view, director);
    const farewellCueCount = view.evening.cues.length;
    for (let frame = 0; frame < 160; frame++) { view.elapsed += .05; director.step(.05); }
    assert.equal(view.evening.cues.length, farewellCueCount);
    assert.equal(view.evening.sharedActivities.includes('coasters'), false);
  } finally { director.free(); }
});

function doubleDinner(z: number) {
  const usage = emptyUsage(), h1 = createPairView('seating', 'h1', 'Alex', 'mira', usage, 2), h2 = createPairView('seating', 'h2', 'Jamie', 'jules', usage, 2);
  h1.participants[0].position = [-.57, 0, 1]; h1.participants[1].position = [...DOUBLE_TABLE.dateSeats.d1]; h2.participants[0].position = [1.35, 0, z];
  const room: DoubleDateRoomState = { id: 'seating', code: 'SEATED', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [...h1.participants[0].position], yaw: 0, seated: false },
      { id: 'h2', name: 'Jamie', connected: true, ready: true, dateId: 'jules', position: [...h2.participants[0].position], yaw: 0, seated: false },
    ], dates: [
      { id: 'd1', humanId: 'h1', dateId: 'mira', position: [...h1.participants[1].position], seated: false, emotion: 'neutral', stance: 'curious' },
      { id: 'd2', humanId: 'h2', dateId: 'jules', position: [...h2.participants[1].position], seated: false, emotion: 'neutral', stance: 'curious' },
    ], views: { h1, h2 }, lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] } };
  const scene = new DoubleTableScene(room); scene.setPhase('playing'); scene.command('h1', { type: 'interact', target: 'seat' }, 1000);
  let clock = 1000;
  const advance = (seconds: number, move = false) => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) { clock += 1000 / 60; if (move) scene.command('h2', { type: 'move', x: -1, z: 0, yaw: 0 }, clock); scene.step(1 / 60, clock); } };
  return { room, scene, advance, get clock() { return clock; } };
}

test('a walking friend cannot shove a seated player out of their chair, and standing restores movement', () => {
  const game = doubleDinner(.2);
  try {
    game.advance(1.6, true);
    const human = game.room.members[0];
    assert.equal(human.seated, true); assert.ok(Math.hypot(human.position[0] + .57, human.position[2] - .2) < .001, JSON.stringify(human.position));
    game.scene.command('h1', { type: 'interact', target: 'seat' }, game.clock);
    const from = [...game.room.members[0].position];
    for (let frame = 1; frame <= 60; frame++) { game.scene.command('h1', { type: 'move', x: 0, z: 1, yaw: 0 }, game.clock + frame * 1000 / 60); game.scene.step(1 / 60, game.clock + frame * 1000 / 60); }
    assert.ok(game.room.members[0].position[2] > from[2] + 1);
  } finally { game.scene.free(); }
});

test('an arrived seated date stays in their chair under contact and can get up again', () => {
  const game = doubleDinner(-2.5);
  try {
    game.advance(1.6, true);
    const date = game.room.dates[0];
    assert.ok(Math.hypot(date.position[0] + .57, date.position[2] + 2.5) < .001, JSON.stringify(date.position));
    game.scene.command('h1', { type: 'interact', target: 'seat' }, game.clock);
    const before = [...date.position]; game.advance(3);
    assert.ok(Math.hypot(date.position[0] - before[0], date.position[2] - before[2]) > .5, 'standing up restores the date’s walking controller');
  } finally { game.scene.free(); }
});
