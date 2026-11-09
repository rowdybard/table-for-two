import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { DinnerScene, emptyUsage } from '../server/restaurant/scene';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { initializeScenario, resolveScenario, tickScenario } from '../server/double-date/scenarios';
import { MENU, RESTAURANT } from '../src/restaurant/content';
import { DOUBLE_TABLE, localDoubleDateView, type DoubleDateRoomState, type DoubleHumanId } from '../src/restaurant/double-date-types';
import { QUIET_TABLE_OFFSET_Z } from '../src/restaurant/dining-space';
import { activateRestaurantScenario, chooseRestaurantScenario, createRestaurantScenario } from '../src/restaurant/scenarios';
import { ensureScenarioCare, scenarioKitchenDelay } from '../server/restaurant/scenario-effects';
import type { RestaurantScenarioId } from '../src/restaurant/scenario-types';
import type { SceneTurn } from '../src/restaurant/types';

before(async () => { await RAPIER.init(); });
const near = (actual: number, expected: number, why = '') => assert.ok(Math.abs(actual - expected) < .0001, `${why}: ${actual} vs ${expected}`);
const neutral = { signal: 'none' as const, reason: 'No boundary change.', wantsToLeave: false };

function solo(blind = false, scenarioId: RestaurantScenarioId = 'family-visit') {
  const scene = new DinnerScene('mira', 2, { variation: 0, scenarioId, ...(blind ? { blindDate: { seed: 'atlas-blind-fixes' } } : {}) });
  let now = 1000;
  const advance = (seconds: number) => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) { now += 1000 / 60; scene.step(1 / 60, now); } };
  for (let frame = 0; frame < 90; frame++) { now += 1000 / 60; scene.command({ type: 'move', x: 0, z: -1, yaw: 0 }, now); scene.step(1 / 60, now); }
  scene.command({ type: 'interact', target: 'seat' }, now); advance(10);
  return { scene, advance, command: (command: Parameters<DinnerScene['command']>[0]) => { now += 600; scene.command(command, now); } };
}

function double(id: string) {
  const usage = emptyUsage();
  const room: DoubleDateRoomState = { id, code: 'ATLAS', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [-.55, 0, 5.6], yaw: 0, seated: false },
      { id: 'h2', name: 'Jamie', connected: true, ready: true, dateId: 'jules', position: [.55, 0, 5.6], yaw: 0, seated: false },
    ], dates: [], views: { h1: createPairView(id, 'h1', 'Alex', 'mira', usage, 2), h2: createPairView(id, 'h2', 'Jamie', 'jules', usage, 2) },
    lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] } };
  const scene = new DoubleTableScene(room); scene.chooseDate('h1', 'mira'); scene.chooseDate('h2', 'jules'); scene.setPhase('playing');
  let now = 1000;
  const advance = (seconds: number) => { for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) { now += 1000 / 60; scene.step(1 / 60, now); tickScenario(room); } };
  const command = (human: DoubleHumanId, command: Parameters<DoubleTableScene['command']>[1]) => { now += 600; scene.command(human, command, now); };
  for (let frame = 0; frame < 90; frame++) {
    now += 1000 / 60; for (const human of ['h1', 'h2'] as const) scene.command(human, { type: 'move', x: 0, z: -1, yaw: 0 }, now);
    scene.step(1 / 60, now);
  }
  for (const human of ['h1', 'h2'] as const) command(human, { type: 'interact', target: 'seat' }); advance(10);
  for (const [i, human] of (['h1', 'h2'] as const).entries()) command(human, { type: 'interact', target: 'menu', choice: MENU[i] });
  advance(46);
  if (room.views.h1.evening.incident?.event === 'wrong-order') { command('h1', { type: 'evening', action: 'inspect-ticket' }); command('h1', { type: 'evening', action: 'return-order' }); }
  return { room, scene, advance, command };
}

function heardPreference(scene: DoubleTableScene, human: DoubleHumanId) {
  const context = scene.agendaContext(human), line = { speaker: 'date' as const, text: context.naturalHint, emotion: 'neutral' as const };
  const turn = (signal: 'none' | 'noticed', evidence: string): SceneTurn => ({ utterances: [line], emotion: 'neutral', action: 'none', memory: `We discussed ${human}'s preference.`, social: neutral, agenda: { signal, evidence, clue: signal === 'none' ? line.text : '' } });
  scene.social(human, turn('none', ''), 'What would you like from tonight?'); scene.acknowledge(human, line);
  const answer = `I noticed that ${context.naturalHint}`;
  scene.social(human, turn('noticed', answer), answer);
}

function openDouble(f: ReturnType<typeof double>, id: RestaurantScenarioId, target: DoubleHumanId) {
  initializeScenario(f.room, id); f.room.scenario!.target = target;
  for (const view of Object.values(f.room.views)) { view.elapsed = 300; view.evening.lastInterruptionAt = 0; view.evening.care.quietUntil = 0; }
  tickScenario(f.room); assert.equal(f.room.scenario!.phase, 'active');
}

const medicalPaths = [
  { id: 'allergic-reaction', first: 'get-help', last: 'support-handoff' },
  { id: 'too-many-drinks', first: 'get-staff', last: 'safe-finish' },
  { id: 'feeling-unwell', first: 'water', last: 'head-home' },
] as const;
for (const target of ['h1', 'h2'] as const) for (const path of medicalPaths) test(`Double ${target}: ${path.id} finalizes only their agenda, preserves their friend and settles once`, () => {
  const f = double(`atlas-${target}-${path.id}`);
  try {
    heardPreference(f.scene, 'h1'); heardPreference(f.scene, 'h2');
    const other = target === 'h1' ? 'h2' : 'h1', view = f.room.views[target], friend = f.room.views[other];
    assert.equal(view.evening.agenda!.score, 30); assert.notEqual(view.evening.agenda, friend.evening.agenda);
    const privateGoal = f.scene.agendaContext(target).goal;
    const before = structuredClone({ agenda: friend.evening.agenda, main: friend.evening.main, bill: friend.evening.bill, chemistry: friend.evening.chemistry });
    openDouble(f, path.id, target);
    resolveScenario(f.room, other, path.first); f.scene.reconcile();
    if (path.id === 'feeling-unwell') {
      const callback = () => view.evening.cues.filter(cue => cue.id === 'scenario-feeling-unwell-1');
      const atTable = () => view.evening.scenarioCare!.presence === 'at-table';
      assert.equal(callback().length, 0); assert.throws(() => resolveScenario(f.room, target, path.last), /return/);
      for (let second = 0; second < 20 && !atTable(); second++) { f.advance(1); if (!atTable()) assert.equal(callback().length, 0); }
      const date = view.participants[1]!.position, seat = DOUBLE_TABLE.dateSeats[target === 'h1' ? 'd1' : 'd2'];
      assert.ok(Math.hypot(date[0] - seat[0], date[2] - seat[2]) < .15, 'the callback waits for the real date body to reach its seat'); assert.equal(callback().length, 1);
    }
    resolveScenario(f.room, target, path.last); f.scene.reconcile();
    assert.equal(view.phase, 'ended'); assert.equal(view.evening.farewell.ending!.kind, 'early-exit'); assert.equal(view.evening.care.assistedExit, true);
    assert.equal(view.evening.agenda!.goal, privateGoal); assert.ok(view.evening.agenda!.reflection); assert.equal(view.evening.agenda!.score, 30);
    assert.equal(friend.phase, 'playing'); assert.equal(f.room.phase, 'playing'); assert.deepEqual({ agenda: friend.evening.agenda, main: friend.evening.main, bill: friend.evening.bill, chemistry: friend.evening.chemistry }, before);
    assert.equal(friend.evening.agenda!.goal, null); assert.equal(localDoubleDateView(f.room, target).doubleDate!.role, 'wingman');
    assert.equal(view.evening.bill.settlement, 'separate'); assert.equal(view.evening.moments.filter(moment => moment.id === 'bill').length, 1);
    const settled = structuredClone({ bill: view.evening.bill, agenda: view.evening.agenda, memory: view.memory });
    for (let i = 0; i < 3; i++) f.scene.reconcile();
    assert.deepEqual({ bill: view.evening.bill, agenda: view.evening.agenda, memory: view.memory }, settled);
    assert.equal(f.room.usage.claudeRequests, 0); assert.equal(f.room.usage.totalCost, 0);
  } finally { f.scene.free(); }
});

for (const blind of [false, true]) test(`${blind ? 'blind' : 'solo'} quiet table moves the actual collider and seated actors once and supports reseating`, () => {
  const f = solo(blind, 'unwelcome-comment');
  try {
    f.command({ type: 'interact', target: 'menu', choice: MENU[0] });
    f.scene.state.elapsed += 45; f.scene.director.step(1 / 60, { allowIncidents: false, allowScenarios: false });
    // Late in the main course, before Eli clears the plates, the table story can open.
    f.scene.state.elapsed = 240; f.scene.director.step(1 / 60, { allowIncidents: false }); assert.equal(f.scene.state.evening.scenario!.phase, 'active');
    const before = f.scene.state.participants.map(person => [...person.position]);
    const body = (f.scene as unknown as { diningCollider: RAPIER.RigidBody }).diningCollider;
    assert.ok(body.collider(0).containsPoint({ x: 0, y: 0, z: -1.15 }));
    f.command({ type: 'scenario', choice: 'ask-staff' }); f.command({ type: 'scenario', choice: 'move-away' });
    for (let i = 0; i < 2; i++) near(f.scene.state.participants[i]!.position[2], before[i]![2]! + QUIET_TABLE_OFFSET_Z, 'one relocation');
    f.advance(.1); near(body.translation().z, -1.15 + QUIET_TABLE_OFFSET_Z, 'collider moved');
    assert.equal(body.collider(0).containsPoint({ x: 0, y: 0, z: -1.15 }), false); assert.ok(body.collider(0).containsPoint({ x: 0, y: 0, z: -1.15 + QUIET_TABLE_OFFSET_Z }));
    f.advance(1); near(f.scene.state.participants[0]!.position[2], RESTAURANT.seat[2] + .28 + QUIET_TABLE_OFFSET_Z, 'seat does not drift');
    f.command({ type: 'interact', target: 'seat' }); assert.equal(f.scene.state.seated, false);
    f.command({ type: 'interact', target: 'seat' }); assert.equal(f.scene.state.seated, true);
    f.command({ type: 'tabletop', action: 'take-bread' }); assert.equal(f.scene.state.evening.tabletop!.breadEaten, 1);
    near(f.scene.state.participants[0]!.position[2], RESTAURANT.seat[2] + .28 + QUIET_TABLE_OFFSET_Z);
    assert.equal(f.scene.state.usage.claudeRequests, 0);
  } finally { f.scene.free(); }
});

test('Double quiet relocation moves both pairs and the shared collider once while retaining personal table state', () => {
  const f = double('atlas-double-quiet');
  try {
    f.command('h1', { type: 'tabletop', action: 'take-bread' }); f.command('h2', { type: 'tabletop', action: 'fold-napkin' });
    const personal = Object.fromEntries(Object.entries(f.room.views).map(([id, view]) => [id, structuredClone(view.evening.tabletop)]));
    const before = Object.fromEntries(Object.entries(f.room.views).map(([id, view]) => [id, view.participants.map(person => [...person.position])]));
    openDouble(f, 'unwelcome-comment', 'h2'); resolveScenario(f.room, 'h1', 'ask-staff'); f.scene.reconcile(); resolveScenario(f.room, 'h2', 'move-away'); f.scene.reconcile();
    for (const human of ['h1', 'h2'] as const) {
      const view = f.room.views[human]; assert.equal(view.evening.scenarioCare!.table, 'quiet'); assert.deepEqual(view.evening.tabletop, personal[human]);
      for (let actor = 0; actor < 2; actor++) near(view.participants[actor]!.position[2], before[human]![actor]![2]! + QUIET_TABLE_OFFSET_Z);
    }
    const body = (f.scene as unknown as { diningCollider: RAPIER.RigidBody }).diningCollider;
    f.advance(.1); assert.equal(body.collider(0).containsPoint({ x: 0, y: 0, z: -1.15 }), false); assert.ok(body.collider(0).containsPoint({ x: 0, y: 0, z: 2.7 }));
    const moved = f.room.members.map(member => [...member.position]); for (let i = 0; i < 3; i++) f.scene.reconcile();
    for (const [i, human] of (['h1', 'h2'] as const).entries()) {
      near(f.room.members[i]!.position[2], moved[i]![2]!); f.command(human, { type: 'interact', target: 'seat' }); f.command(human, { type: 'interact', target: 'seat' });
      near(f.room.views[human].participants[0]!.position[2], DOUBLE_TABLE.seats[human][2] + QUIET_TABLE_OFFSET_Z);
      f.command(human, { type: 'interact', target: 'carafe' });
    }
    assert.equal(f.room.usage.claudeRequests, 0);
  } finally { f.scene.free(); }
});

for (const blind of [false, true]) test(`${blind ? 'blind' : 'solo'} wrong order arrives before bites, while a provider redirect cannot replace an eaten dish`, () => {
  const f = solo(blind);
  try {
    f.command({ type: 'interact', target: 'menu', choice: MENU[0] }); f.advance(45.1);
    assert.equal(f.scene.state.evening.incident?.event, 'wrong-order'); assert.equal(f.scene.state.evening.main.bites, 0); assert.notEqual(f.scene.state.evening.main.servedDish, f.scene.state.order);
    assert.throws(() => f.command({ type: 'interact', target: 'meal' })); assert.equal(f.scene.state.evening.main.bites, 0);
    f.command({ type: 'evening', action: 'inspect-ticket' }); f.command({ type: 'evening', action: 'keep-order' });
    f.command({ type: 'interact', target: 'meal' }); const dish = f.scene.state.evening.main.servedDish;
    // A correctly served plate with no earlier wrong-order resolution must also remain intact after a bite.
    delete f.scene.state.evening.resolutions['wrong-order']; f.scene.state.elapsed += 30; f.scene.director.redirectConversation();
    assert.equal(f.scene.state.evening.incident, null); assert.equal(f.scene.state.evening.main.servedDish, dish); assert.equal(f.scene.state.evening.main.bites, 1);
    assert.equal(f.scene.state.events.filter(event => event === 'wrong-order').length, 1); assert.equal(f.scene.state.usage.claudeRequests, 0);
  } finally { f.scene.free(); }
});

for (const blind of [false, true]) test(`${blind ? 'blind' : 'solo'} kitchen hold retains cook time and the quiet delayed delivery is never replaced after a bite`, () => {
  const f = solo(blind, 'feeling-unwell');
  try {
    f.command({ type: 'interact', target: 'menu', choice: MENU[0] }); const orderedAt = f.scene.state.evening.main.orderedAt!;
    f.advance(12.1); assert.equal(f.scene.state.evening.scenario!.phase, 'active'); assert.equal(f.scene.state.evening.main.status, 'waiting');
    f.command({ type: 'scenario', choice: 'water' });
    const callback = () => f.scene.state.evening.cues.filter(cue => cue.id === 'scenario-feeling-unwell-1');
    const atTable = () => f.scene.state.evening.scenarioCare!.presence === 'at-table';
    assert.equal(callback().length, 0); assert.throws(() => f.command({ type: 'scenario', choice: 'slow-dinner' }), /return/);
    for (let second = 0; second < 20 && !atTable(); second++) { f.advance(1); if (!atTable()) assert.equal(callback().length, 0); }
    const date = f.scene.state.participants[1]!.position;
    assert.ok(Math.hypot(date[0] - RESTAURANT.dateSeat[0], date[2] - RESTAURANT.dateSeat[2]) < .15); assert.equal(callback().length, 1);
    f.command({ type: 'scenario', choice: 'slow-dinner' });
    assert.equal(f.scene.state.evening.scenarioCare!.presence, 'at-table'); f.command({ type: 'evening', action: 'resume-dinner' });
    const held = scenarioKitchenDelay(f.scene.state), remaining = 45 - (f.scene.state.elapsed - orderedAt - held);
    f.advance(remaining - .08); assert.equal(f.scene.state.evening.main.status, 'waiting');
    f.advance(.15); assert.equal(f.scene.state.evening.main.status, 'served'); assert.equal(f.scene.state.evening.main.bites, 0); assert.equal(f.scene.state.evening.incident, null);
    assert.equal(f.scene.state.evening.main.servedDish, f.scene.state.order);
    f.command({ type: 'interact', target: 'meal' }); const dish = f.scene.state.evening.main.servedDish;
    f.scene.state.elapsed += 100; f.scene.director.redirectConversation(); assert.equal(f.scene.state.evening.incident, null); assert.equal(f.scene.state.evening.main.servedDish, dish);
    assert.equal(f.scene.state.events.filter(event => event === 'wrong-order').length, 0); assert.equal(f.scene.state.usage.claudeRequests, 0);
  } finally { f.scene.free(); }
});

test('spill and noisy-diner incidents can happen without a prerequisite resolved wrong order or resolved spill', () => {
  const f = solo();
  try {
    f.command({ type: 'interact', target: 'menu', choice: MENU[0] }); f.scene.state.elapsed += 45;
    f.scene.director.step(1 / 60, { allowIncidents: false, allowScenarios: false });
    assert.equal(f.scene.state.events.length, 0); f.scene.state.elapsed += 65; f.scene.director.step(1 / 60, { allowScenarios: false });
    assert.equal(f.scene.state.evening.incident?.event, 'spilled-drink'); assert.equal(f.scene.state.evening.resolutions['wrong-order'], undefined);
  } finally { f.scene.free(); }
  const g = solo();
  try {
    // A quiet main course, cleared plates and a dessert on the table: the neighbour's call still comes, with no spill ever having happened.
    const quiet = { allowIncidents: false, allowScenarios: false } as const;
    g.scene.state.elapsed = 900; g.command({ type: 'interact', target: 'menu', choice: MENU[0] });
    for (const seconds of [45, 200, 40, 20]) { g.scene.state.elapsed += seconds; g.scene.director.step(1 / 60, quiet); }
    assert.equal(g.scene.state.evening.main.status, 'finished'); assert.equal(g.scene.state.evening.dessert.status, 'served'); assert.equal(g.scene.state.events.length, 0);
    g.scene.state.elapsed += 30; g.scene.director.step(1 / 60, { allowScenarios: false });
    assert.equal(g.scene.state.evening.incident?.event, 'disruptive-diner'); assert.equal(g.scene.state.evening.resolutions['spilled-drink'], undefined); assert.equal(g.scene.state.evening.resolutions['wrong-order'], undefined);
  } finally { g.scene.free(); }
});

test('raw story choice effects and live atlas extraction agree about clean wine, real leftovers and medical endings', async () => {
  const wine = createRestaurantScenario('atlas-wine', 'wine-spill'); activateRestaurantScenario(wine, 0, 'dry');
  chooseRestaurantScenario(wine, 'ask-first', 'You', 1, 'dry'); chooseRestaurantScenario(wine, 'fresh-start', 'You', 2, 'dry'); assert.equal(wine.effects.wineStain, false);
  const { collectEncounterAtlas } = await import(pathToFileURL(resolve('scripts/analyze-encounter-atlas.mjs')).href);
  const atlas = await collectEncounterAtlas(); assert.equal(atlas.counts.scenarios, 11); assert.equal(atlas.counts.authoredChoiceRecords, 51); assert.equal(atlas.counts.decisionHistories, 58); assert.equal(atlas.counts.verifiedStyleHistories, 174);
  for (const scenario of atlas.scenarios) for (const path of scenario.paths) {
    const final = path.mechanics.completed;
    if (scenario.id === 'wine-spill') { assert.equal(final.scenarioCare.cleanup.wine, 'clean'); for (const variant of Object.values(path.variants) as any[]) assert.equal(variant.effects.wineStain, false); }
    if (scenario.id === 'oversized-order') {
      assert.ok(final.scenarioCare.extraOrder.items.every((item: any) => ['shared', 'boxed', 'cancelled'].includes(item.status)));
      if (path.first !== 'help') assert.ok(path.mechanicsAfterKitchenWait.completed.bill.totalCents > final.bill.totalCents);
    }
    if (['allergic-reaction', 'too-many-drinks'].includes(scenario.id) || scenario.id === 'feeling-unwell' && path.last === 'head-home') { assert.equal(final.phase, 'ended'); assert.equal(final.ending, 'early-exit'); }
  }
});
