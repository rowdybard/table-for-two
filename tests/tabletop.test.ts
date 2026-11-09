import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import { DinnerScene, emptyUsage } from '../server/restaurant/scene';
import { EveningDirector } from '../server/restaurant/evening';
import { TabletopDirector, tabletopConversationContext } from '../server/restaurant/tabletop';
import { DoubleTableScene, createPairView } from '../server/double-date/scene';
import { attachRestaurantServer, validateCommand } from '../server/restaurant/index';
import { attachDoubleDateServer } from '../server/double-date';
import type { ClaudeAdapter } from '../server/restaurant/providers';
import { TABLETOP_ACTIONS, createTabletopState, tabletopSnapshot, tableActionForTarget, tabletopActionAvailability } from '../src/restaurant/tabletop';
import type { DoubleDateRoomState, DoubleRoomResponse } from '../src/restaurant/double-date-types';
import { activateRestaurantScenario, createRestaurantScenario } from '../src/restaurant/scenarios';
import { MENU } from '../src/restaurant/content';
import type { DinnerState } from '../src/restaurant/types';

before(async () => { await RAPIER.init(); });

function seatedState(mode: DinnerState['mode'] = 'ai-date') {
  const state = createPairView('table-test', 'h1', 'Alex', 'mira', emptyUsage(), 2);
  state.mode = mode; state.phase = 'playing'; state.seated = true; state.stage = 'seated';
  if (mode === 'blind-date') state.blindDate = { seed: 'tabletop-blind' };
  return state;
}
function doubleFixture() {
  const usage = emptyUsage();
  const room: DoubleDateRoomState = { id: 'table-test', code: 'TABLES', mode: 'double-date', phase: 'playing', hostId: 'h1', generation: 0, revision: 0,
    members: [
      { id: 'h1', name: 'Alex', connected: true, ready: true, dateId: 'mira', position: [0, 0, 0], yaw: 0, seated: true },
      { id: 'h2', name: 'Jamie', connected: true, ready: true, dateId: 'jules', position: [0, 0, 0], yaw: 0, seated: true },
    ], dates: [], views: { h1: createPairView('table-test', 'h1', 'Alex', 'mira', usage, 2), h2: createPairView('table-test', 'h2', 'Jamie', 'jules', usage, 2) },
    lines: [], usage, sessionLimit: 2, model: 'claude-haiku-5-5', voice: { enabled: { h1: false, h2: false }, epoch: 0, iceServers: [] } };
  const scene = new DoubleTableScene(room);
  scene.chooseDate('h1', 'mira'); scene.chooseDate('h2', 'jules'); scene.setPhase('playing');
  for (const view of Object.values(room.views)) { view.seated = true; view.stage = 'seated'; }
  for (const member of room.members) member.seated = true;
  return { room, scene };
}

test('table protocol accepts only known actions and rejects ownership, refill and amount overrides', () => {
  for (const action of TABLETOP_ACTIONS) assert.deepEqual(validateCommand({ type: 'tabletop', action }), { type: 'tabletop', action });
  for (const payload of [
    { type: 'tabletop' }, { type: 'tabletop', action: 'throw-glass' }, { type: 'tabletop', action: ['take-bread'] },
    { type: 'tabletop', action: 'take-bread', human: 'h2' }, { type: 'tabletop', action: 'pour-water', amount: 99 },
    { type: 'tabletop', action: 'pour-water', shared: { carafeFill: 999 } }, { type: 'tabletop', action: 'salt-meal', target: 'other-date' },
  ]) assert.throws(() => validateCommand(payload), /Invalid scene command/);
  for (const target of ['carafe', 'bread', 'salt', 'pepper', 'cutlery', 'lamp', 'vase', 'plate']) assert.equal(validateCommand({ type: 'interact', target }).type, 'interact');
  assert.equal(tableActionForTarget('glass'), 'sip-water'); assert.equal(tableActionForTarget('date'), null);
});

test('default snapshots are detached and older states have usable action labels', () => {
  const a = tabletopSnapshot(), b = tabletopSnapshot(); a.shared.breadRemaining = 0;
  assert.equal(b.shared.breadRemaining, 4);
  const state = seatedState(); assert.equal(tabletopActionAvailability(state, 'fold-napkin').label, 'Fold your napkin');
  state.evening.tabletop = createTabletopState(); const snapshot = tabletopSnapshot(state.evening.tabletop);
  snapshot.shared.carafeFill = 0; assert.equal(state.evening.tabletop.shared.carafeFill, 6);
});

for (const mode of ['ai-date', 'blind-date', 'double-date'] as const) test(`${mode}: finite water and bread, seasonings and cosmetic fidgets have no score or dialogue side effects`, () => {
  const state = seatedState(mode), director = new EveningDirector(state), table = state.evening.tabletop!;
  try {
    const baseline = { memory: state.memory, cues: structuredClone(state.evening.cues), moments: structuredClone(state.evening.moments), agenda: structuredClone(state.evening.agenda), chemistry: structuredClone(state.evening.chemistry), stance: state.evening.stance };
    for (let i = 0; i < 4; i++) director.tabletop.action('sip-water');
    assert.equal(table.glassFill, 0); assert.throws(() => director.tabletop.action('sip-water'), /empty/);
    director.tabletop.action('pour-water'); assert.equal(table.glassFill, 4); assert.equal(table.shared.carafeFill, 2);
    assert.throws(() => director.tabletop.action('pour-water'), /full/);
    for (let i = 0; i < 4; i++) director.tabletop.action('sip-water');
    director.tabletop.action('pour-water'); assert.equal(table.glassFill, 2); assert.equal(table.shared.carafeFill, 0);
    director.tabletop.action('sip-water'); assert.throws(() => director.tabletop.action('pour-water'), /carafe is empty/);
    for (let i = 0; i < 4; i++) director.tabletop.action('take-bread');
    assert.equal(table.breadEaten, 4); assert.equal(table.shared.breadRemaining, 0); assert.throws(() => director.tabletop.action('take-bread'), /all been eaten/);
    assert.throws(() => director.tabletop.action('salt-meal'), /Season your own meal/);
    state.evening.main = { status: 'served', bites: 0, dateDish: MENU[1], servedDish: MENU[0] };
    director.tabletop.action('salt-meal'); director.tabletop.action('pepper-meal');
    assert.equal(table.salt, true); assert.equal(table.pepper, true);
    assert.throws(() => director.tabletop.action('salt-meal'), /already salted/); assert.throws(() => director.tabletop.action('pepper-meal'), /already added/);
    for (let i = 0; i < 24; i++) for (const action of ['arrange-cutlery', 'fold-napkin', 'dim-lamp', 'turn-vase', 'turn-plate'] as const) director.tabletop.action(action);
    assert.equal(table.plateTurn, 0); assert.equal(table.shared.vaseTurn, 0); assert.equal(table.shared.lampLevel, 2);
    assert.equal(table.napkinFolded, false); assert.equal(table.cutleryCrossed, false);
    assert.deepEqual({ memory: state.memory, cues: state.evening.cues, moments: state.evening.moments, agenda: state.evening.agenda, chemistry: state.evening.chemistry, stance: state.evening.stance }, baseline);
    assert.equal(state.usage.claudeRequests, 0);
    assert.equal(table.lastAction?.sequence, 137); assert.equal(table.lastAction?.at, state.elapsed);
  } finally { director.free(); }
});

test('table controller rejects paused, standing, active incidents, scenarios and farewells without consuming shared supplies', () => {
  const state = seatedState(), director = new TabletopDirector(state);
  const blocked = (mutate: () => void, restore: () => void) => {
    mutate(); const before = structuredClone(state.evening.tabletop);
    for (const action of TABLETOP_ACTIONS) assert.throws(() => director.action(action));
    assert.deepEqual(state.evening.tabletop, before); restore();
  };
  blocked(() => state.phase = 'paused', () => state.phase = 'playing');
  blocked(() => state.seated = false, () => state.seated = true);
  blocked(() => state.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 0 }, () => state.evening.incident = null);
  blocked(() => { const scenario = createRestaurantScenario('active', 'family-visit'); activateRestaurantScenario(scenario, 0, 'playful'); state.evening.scenario = scenario; }, () => state.evening.scenario = undefined);
  blocked(() => state.evening.stance = 'leaving', () => state.evening.stance = 'curious');
  blocked(() => state.stage = 'farewell', () => state.stage = 'seated');
  blocked(() => state.phase = 'ended', () => state.phase = 'playing');
  const before = structuredClone(state.evening.tabletop); assert.throws(() => director.action('teleport' as any)); assert.deepEqual(state.evening.tabletop, before);
});

test('sips lower automatically in scene time, paused time stays frozen, and the napkin folds and unfolds', () => {
  const state = seatedState(), director = new EveningDirector(state);
  try {
    director.tabletop.action('sip-water'); assert.equal(state.glassRaised, true);
    state.elapsed = 1.1; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(state.glassRaised, true);
    state.phase = 'paused'; state.elapsed = 2; director.step(.1); assert.equal(state.glassRaised, true);
    state.phase = 'playing'; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(state.glassRaised, false);
    director.tabletop.action('fold-napkin'); assert.equal(state.evening.tabletop!.napkinFolded, true);
    director.tabletop.action('fold-napkin'); assert.equal(state.evening.tabletop!.napkinFolded, false);
    director.tabletop.action('sip-water'); state.seated = false; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(state.glassRaised, false);
  } finally { director.free(); }
});

test('Eli’s water service refills depleted supplies after 12 seconds and repeated service earns no additional care credit', () => {
  const state = seatedState(), director = new EveningDirector(state);
  try {
    const table = state.evening.tabletop!; table.glassFill = 0; table.shared.carafeFill = 0;
    director.action({ type: 'evening', action: 'request-water' }, 0);
    state.elapsed = 11.9; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(table.shared.carafeFill, 0);
    state.elapsed = 12; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(table.shared.carafeFill, 6); assert.equal(table.glassFill, 4);
    assert.equal(state.evening.care.water.status, 'served');
    assert.throws(() => director.action({ type: 'evening', action: 'request-water' }, 0), /already been requested/);
    table.shared.carafeFill = 1; state.elapsed = 30; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(table.shared.carafeFill, 1);
    assert.throws(() => director.action({ type: 'evening', action: 'request-water' }, 0), /already been requested/);
    table.shared.carafeFill = 0; table.glassFill = 4; assert.throws(() => director.action({ type: 'evening', action: 'request-water' }, 0), /already been requested/);
    director.tabletop.action('sip-water'); const memory = state.memory, moments = structuredClone(state.evening.moments), cues = state.evening.cues.length;
    director.action({ type: 'evening', action: 'request-water' }, 0); assert.equal(state.evening.care.water.status, 'requested'); assert.equal(state.evening.cues.length, cues);
    assert.deepEqual(state.evening.moments, moments); assert.equal(state.memory, memory);
    assert.throws(() => director.action({ type: 'evening', action: 'request-water' }, 0), /already been requested/);
    state.elapsed = 41.9; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(table.shared.carafeFill, 0);
    state.elapsed = 42; director.step(.1, { allowIncidents: false, allowScenarios: false }); assert.equal(table.shared.carafeFill, 6); assert.equal(table.glassFill, 4);
    assert.equal(state.evening.cues.at(-1)!.id, 'care-water-served-1'); assert.equal(state.evening.cues.length, cues + 1); assert.deepEqual(state.evening.moments, moments); assert.equal(state.memory, memory);
  } finally { director.free(); }
});

test('conversation context carries only meaningful food and drink facts, never fidgets or a new prop topic', () => {
  const state = seatedState(), director = new TabletopDirector(state);
  assert.equal(tabletopConversationContext(state), undefined);
  for (const action of ['dim-lamp', 'turn-vase', 'turn-plate', 'arrange-cutlery', 'fold-napkin'] as const) director.action(action);
  assert.equal(tabletopConversationContext(state), undefined);
  director.action('take-bread'); const context = tabletopConversationContext(state)!;
  assert.equal(context.breadPiecesEaten, 1);
  for (const word of ['vase', 'lamp', 'plateTurn', 'cutlery', 'napkin', 'lastAction', 'sequence']) assert.equal(JSON.stringify(context).includes(word), false);
  assert.equal(state.memory, ''); assert.equal(state.usage.claudeRequests, 0);
});

test('double date shares a finite basket and carafe atomically while all personal place settings remain independent', () => {
  const { room, scene } = doubleFixture();
  try {
    const a = room.views.h1.evening.tabletop!, b = room.views.h2.evening.tabletop!;
    assert.notEqual(a, b); assert.equal(a.shared, b.shared);
    a.shared.breadRemaining = 1;
    scene.command('h1', { type: 'tabletop', action: 'take-bread' }, 0);
    assert.throws(() => scene.command('h2', { type: 'tabletop', action: 'take-bread' }, 0), /all been eaten/);
    assert.equal(a.breadEaten, 1); assert.equal(b.breadEaten, 0);
    a.glassFill = b.glassFill = 0; a.shared.carafeFill = 1;
    scene.command('h2', { type: 'tabletop', action: 'pour-water' }, 0);
    assert.throws(() => scene.command('h1', { type: 'tabletop', action: 'pour-water' }, 0), /carafe is empty/);
    assert.equal(a.glassFill, 0); assert.equal(b.glassFill, 1);
    room.views.h1.evening.main = { status: 'served', bites: 0, dateDish: MENU[1], servedDish: MENU[0] };
    scene.command('h1', { type: 'tabletop', action: 'salt-meal' }, 0);
    scene.command('h1', { type: 'tabletop', action: 'fold-napkin' }, 0);
    scene.command('h1', { type: 'tabletop', action: 'arrange-cutlery' }, 0);
    assert.equal(a.salt, true); assert.equal(b.salt, false); assert.equal(b.napkinFolded, false); assert.equal(b.cutleryCrossed, false);
    scene.command('h2', { type: 'tabletop', action: 'dim-lamp' }, 0); assert.equal(a.shared.lampLevel, 1);
    const shared = a.shared; scene.chooseDate('h1', 'dev'); assert.equal(room.views.h1.evening.tabletop!.shared, shared); assert.equal(room.views.h2.evening.tabletop!.shared, shared); assert.equal(shared.carafeFill, 0);
    assert.equal(room.usage.claudeRequests, 0);
  } finally { scene.free(); }
});

test('double-date tabletop cannot be used standing, while paused, during a shared scenario or after becoming a wingman', () => {
  const { room, scene } = doubleFixture();
  try {
    const action = () => scene.command('h1', { type: 'tabletop', action: 'take-bread' }, 0);
    room.members[0].seated = false; assert.throws(action, /own seat/); room.members[0].seated = true;
    scene.setPhase('paused'); assert.throws(action, /resume/); scene.setPhase('playing');
    room.views.h2.evening.incident = { event: 'wrong-order', progress: 0, startedAt: 0 }; assert.throws(action, /interruption/); room.views.h2.evening.incident = null;
    const scenario = createRestaurantScenario('double-active', 'family-visit'); activateRestaurantScenario(scenario, 0, 'playful'); room.scenario = { ...scenario, target: 'h2' }; assert.throws(action, /moment at the table/); room.scenario = undefined;
    room.views.h1.phase = 'ended'; assert.throws(action, /complete/);
    assert.throws(() => scene.command('h1', { type: 'interact', target: 'carafe' }, 0), /complete/);
    assert.equal(room.views.h1.evening.tabletop!.shared.breadRemaining, 4); assert.equal(room.views.h2.evening.tabletop!.breadEaten, 0);
  } finally { scene.free(); }
});

test('real solo and seeded blind scenes accept tabletop commands through their normal command route', () => {
  for (const blind of [false, true]) {
    const scene = new DinnerScene('dev', 2, blind ? { blindDate: { seed: 'tabletop-cmd-seed' } } : {});
    try {
      assert.ok(scene.state.evening.tabletop);
      assert.throws(() => scene.command({ type: 'tabletop', action: 'take-bread' }), /seat/);
      scene.state.seated = true; scene.state.stage = 'seated';
      scene.command({ type: 'tabletop', action: 'take-bread' });
      assert.equal(scene.state.evening.tabletop!.breadEaten, 1);
      const snapshot = scene.snapshot(); snapshot.evening.tabletop!.shared.breadRemaining = 99;
      assert.equal(scene.state.evening.tabletop!.shared.breadRemaining, 3);
      assert.equal(scene.state.mode, blind ? 'blind-date' : 'ai-date'); assert.equal(scene.state.usage.claudeRequests, 0);
    } finally { scene.free(); }
  }
});

test('HTTP tabletop commands across all modes make no Claude requests and fidgeting leaves an existing response running', { timeout: 15_000 }, async t => {
  let clock = Date.UTC(2026, 10, 8, 12), calls = 0, aborted = false;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const claude: ClaudeAdapter = { async *stream(_request, signal) {
    calls++; signal.addEventListener('abort', () => { aborted = true; }, { once: true }); started();
    yield { type: 'usage', usage: { inputTokens: 100 } };
    yield { type: 'text', text: JSON.stringify({ utterances: [{ speaker: 'date', text: 'I have a soft spot for live music. What about you?', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'We talked about live music.' }) };
    await gate;
    yield { type: 'usage', usage: { outputTokens: 40 } };
  } };
  let restaurant!: Awaited<ReturnType<typeof attachRestaurantServer>>, double!: Awaited<ReturnType<typeof attachDoubleDateServer>>;
  const http = createServer((req, res) => { if (!double.handle(req, res) && !restaurant.handle(req, res)) { res.statusCode = 404; res.end(); } });
  restaurant = await attachRestaurantServer(http, { env: { DATE_SPEECH_PROVIDER: 'none' }, claude, ledgerPath: false, now: () => clock, scenarioId: 'family-visit' });
  double = await attachDoubleDateServer(http, restaurant, { env: {}, now: () => clock, autoTick: false, disconnectMs: 1e9, scenarioId: 'family-visit' });
  t.after(async () => { release(); double.close(); await restaurant.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve)); const address = http.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token = '', value?: unknown) => fetch(url + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(value === undefined ? {} : { 'content-type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const okay = async (path: string, token: string, value: unknown) => { const response = await request(path, token, value); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const soloSeats: { path: string; token: string }[] = [];
  for (const extra of [{ dateId: 'mira' }, { mode: 'blind-date', seed: 'tabletop-http-blind' }]) {
    const created = await request('/api/date/sessions', '', extra); assert.equal(created.status, 201, await created.clone().text());
    const { state, token } = await created.json(); const path = `/api/date/sessions/${state.id}`; soloSeats.push({ path, token });
    let seated = false;
    for (let i = 0; i < 50 && !seated; i++) {
      await okay(path + '/command', token, { type: 'move', x: 0, z: -1, yaw: 0 });
      clock += 100; await delay(20);
      const seat = await request(path + '/command', token, { type: 'interact', target: 'seat' });
      if (seat.status === 200) seated = true; else assert.equal(seat.status, 409, await seat.text());
    }
    assert.equal(seated, true, 'reach the seat through authoritative movement');
    for (const action of ['sip-water', 'pour-water', 'take-bread', 'arrange-cutlery', 'fold-napkin', 'dim-lamp', 'turn-vase', 'turn-plate']) await okay(path + '/command', token, { type: 'tabletop', action });
    assert.equal((await request(path + '/command', token, { type: 'tabletop', action: 'salt-meal' })).status, 409);
    assert.equal((await request(path + '/command', token, { type: 'tabletop', action: 'take-bread', human: 'h2' })).status, 400);
    const snapshot = await request(path, token).then(response => response.json()); assert.equal(snapshot.state.evening.tabletop.breadEaten, 1); assert.equal(snapshot.state.usage.claudeRequests, 0);
  }
  const created = await request('/api/double-date/rooms', '', { name: 'Alex' }); assert.equal(created.status, 201); const host = await created.json() as DoubleRoomResponse;
  const joined = await request('/api/double-date/rooms/join', '', { code: host.state.code, name: 'Jamie' }); assert.equal(joined.status, 201); const friend = await joined.json() as DoubleRoomResponse;
  const roomPath = `/api/double-date/rooms/${host.roomId}`;
  await okay(roomPath + '/command', host.token, { type: 'choose-date', dateId: 'mira' }); await okay(roomPath + '/command', friend.token, { type: 'choose-date', dateId: 'jules' });
  for (const seat of [host, friend]) await okay(roomPath + '/command', seat.token, { type: 'ready', ready: true });
  await okay(roomPath + '/command', host.token, { type: 'start' });
  for (let i = 0; i < 30; i++) {
    for (const seat of [host, friend]) await okay(roomPath + '/command', seat.token, { type: 'scene', command: { type: 'move', x: 0, z: -1, yaw: 0 } });
    clock += 50; double.tick(.05, clock);
  }
  for (const seat of [host, friend]) {
    await okay(roomPath + '/command', seat.token, { type: 'scene', command: { type: 'interact', target: 'seat' } });
    for (const action of ['sip-water', 'pour-water', 'take-bread', 'arrange-cutlery', 'fold-napkin', 'dim-lamp', 'turn-vase', 'turn-plate']) await okay(roomPath + '/command', seat.token, { type: 'scene', command: { type: 'tabletop', action } });
  }
  const room = await request(roomPath, host.token).then(response => response.json());
  assert.equal(room.state.views.h1.evening.tabletop.breadEaten, 1); assert.equal(room.state.views.h2.evening.tabletop.breadEaten, 1); assert.equal(room.state.views.h1.evening.tabletop.shared.breadRemaining, 2);
  assert.equal(room.state.usage.claudeRequests, 0); assert.equal(calls, 0, 'tabletop routes do not schedule provider work');

  const solo = soloSeats[0]; const ongoing = await request(solo.path + '/turn', solo.token, { turnId: 'tabletop-stream', text: 'What do you like doing on a Friday night?', model: 'claude-haiku-5-5' });
  assert.equal(ongoing.status, 200); await entered;
  const before = await request(solo.path, solo.token).then(response => response.json());
  for (const action of ['turn-vase', 'fold-napkin', 'dim-lamp', 'arrange-cutlery']) await okay(solo.path + '/command', solo.token, { type: 'tabletop', action });
  const during = await request(solo.path, solo.token).then(response => response.json());
  assert.equal(during.state.generation, before.state.generation); assert.equal(aborted, false); assert.equal(calls, 1);
  release(); const events = await ongoing.text(); assert.match(events, /"type":"done"/); assert.equal(aborted, false);
});
