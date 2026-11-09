import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createServer } from 'node:http';
import RAPIER from '@dimforge/rapier3d-compat';
import { createEvening } from '../src/restaurant/evening';
import { createBlindDate } from '../src/restaurant/blind-date';
import { RESTAURANT_SCENARIOS, createRestaurantScenario, activateRestaurantScenario, chooseRestaurantScenario } from '../src/restaurant/scenarios';
import type { DinnerState, DateId } from '../src/restaurant/types';
import { EveningDirector } from '../server/restaurant/evening';
import { attachRestaurantServer, validateCommand, type ClaudeAdapter } from '../server/restaurant';
import { applyScenarioToView, scenarioStyle } from '../server/restaurant/scenario';
import { tableFacts } from '../server/restaurant/table-facts';
import { noteOf, section } from './helpers/turn-note';

before(async () => { await RAPIER.init(); });
function view(dateId: DateId = 'mira', seed?: string): DinnerState {
  return { id: 'story-fixture', generation: 0, mode: seed ? 'blind-date' : 'ai-date', ...(seed ? { blindDate: { seed } } : {}), phase: 'playing', dateId,
    stage: 'dining', elapsed: 300, participants: [{ id: 'p1', kind: 'human', name: 'You', position: [0, 0, .1] }, { id: 'p2', kind: 'ai', name: 'Date', position: [0, 0, -2.25] }],
    seated: true, order: 'Wild mushroom risotto', events: [], emotion: 'neutral', glassRaised: false, memory: '', sessionLimit: 2,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, speechCharacters: 0, cacheHits: 0, claudeRequests: 0, claudeCost: 0, speechCost: 0, totalCost: 0, responseMs: null, firstAudioMs: null }, evening: createEvening(dateId) };
}

test('eleven retained core scenarios require two choices and keep deterministic factual callbacks', () => {
  assert.equal(RESTAURANT_SCENARIOS.length, 11);
  assert.deepEqual(createRestaurantScenario('same-night'), createRestaurantScenario('same-night'));
  for (const track of RESTAURANT_SCENARIOS) {
    const state = createRestaurantScenario('night', track.id);
    const opening = activateRestaurantScenario(state, 300, 'dry');
    assert.equal(opening.length, 1); assert.equal(state.phase, 'active'); assert.equal(state.beat, 'setup');
    assert.throws(() => chooseRestaurantScenario(state, 'invented', 'Alex', 301, 'dry'));
    const first = state.choices[0], result = chooseRestaurantScenario(state, first.id, 'Alex', 301, 'dry');
    assert.equal(result.completed, false); assert.equal(state.phase, 'active'); assert.equal(state.beat, 'follow-through');
    assert.equal(state.decisions[0].by, 'Alex'); assert.ok(!state.choices.some(choice => choice.id === first.id));
    assert.throws(() => chooseRestaurantScenario(state, first.id, 'Alex', 302, 'dry'), 'late first-beat input cannot become a second decision');
    const last = chooseRestaurantScenario(state, state.choices[0].id, 'Sam', 303, 'dry');
    assert.equal(last.completed, true); assert.equal(state.phase, 'resolved'); assert.equal(state.decisions.length, 2); assert.equal(state.choices.length, 0);
    assert.ok(state.resolution?.includes(result.fact)); assert.ok(state.resolution?.includes(last.fact));
    assert.throws(() => chooseRestaurantScenario(state, 'continue', 'Alex', 304, 'dry'));
  }
});

test('sensitive scenarios preserve agency and medical help never waits for a minigame or grants romance', () => {
  const allergy = createRestaurantScenario('allergy', 'allergic-reaction');
  activateRestaurantScenario(allergy, 300, 'direct');
  assert.equal(allergy.effects.service, 'help');
  assert.match(allergy.description, /prescribed emergency medication/); assert.match(allergy.description, /calls for emergency help/);
  assert.ok(allergy.choices.every(choice => !/water|wait and see|keep eating/i.test(choice.label)));
  const state = view();
  applyScenarioToView(state, allergy, chooseRestaurantScenario(allergy, allergy.choices[0].id, 'You', 301, 'direct'));
  const final = chooseRestaurantScenario(allergy, 'support-handoff', 'You', 302, 'direct'); applyScenarioToView(state, allergy, final);
  assert.equal(state.evening.farewell.ending?.kind, 'early-exit'); assert.equal(state.evening.stance, 'leaving'); assert.equal(state.phase, 'ended'); assert.equal(state.evening.care.assistedExit, true);
  assert.equal(state.evening.bill.settlement, 'separate'); assert.equal(state.evening.care.romanceClosed, false);
  assert.equal(state.evening.stanceReason.includes('care'), true);
  const tic = createRestaurantScenario('tic', 'unexpected-tic'); activateRestaurantScenario(tic, 300, 'playful');
  assert.match(tic.description, /involuntary/); assert.match(tic.description, /chooses to explain/);
  assert.ok(tic.choices.every(choice => !/stop|suppress|perform/i.test(choice.label)));
  const attraction = createRestaurantScenario('privacy', 'questioning-attraction'); activateRestaurantScenario(attraction, 300, 'direct');
  chooseRestaurantScenario(attraction, 'respect-privacy', 'You', 301, 'direct');
  assert.equal(attraction.effects.romanceClosed, true); assert.match(attraction.description, /privat|privacy/);
  chooseRestaurantScenario(attraction, 'friendship', 'You', 302, 'direct'); assert.equal(attraction.effects.earlyExit, false);
});

test('solo and blind directors activate the same stories, record both beats and reject other play during an active moment', () => {
  for (const seed of [undefined, 'a-reproducible-blind-date']) {
    const dateId = seed ? createBlindDate(seed).dateId : 'mira', state = view(dateId, seed);
    const director = new EveningDirector(state, { scenarioId: 'family-visit' });
    try {
      state.evening.main.status = 'served'; state.evening.main.servedDish = state.order; state.evening.resolutions['wrong-order'] = 'The meal was checked earlier.';
      director.step(.016); assert.equal(state.evening.scenario?.phase, 'active');
      assert.throws(() => director.action({ type: 'evening', action: 'taste' }, 1000));
      assert.throws(() => director.action({ type: 'evening', action: 'skip-dessert' }, 1000));
      director.scenario('boundary'); assert.equal(state.evening.scenario?.beat, 'follow-through');
      director.scenario('return-date'); assert.equal(state.evening.scenario?.phase, 'resolved');
      assert.ok(tableFacts(state).some(fact => fact.includes('family visit')), 'the story is recorded as a table fact the model cannot overwrite'); assert.equal(state.memory, '', 'the model’s notebook is untouched by server facts'); assert.ok(state.evening.moments.some(moment => moment.id === 'scenario-family-visit'));
      assert.equal(state.usage.claudeRequests, 0);
    } finally { director.free(); }
  }
});

test('care actions respect preferences and a refusal, are attributable, and cannot be farmed', () => {
  for (const dateId of ['mira', 'jules'] as const) {
    const state = view(dateId), director = new EveningDirector(state, { scenarioId: 'family-visit' });
    try {
      state.evening.main.status = 'served'; state.evening.main.servedDish = 'Roasted tomato rigatoni';
      const before = state.evening.stance;
      director.action({ type: 'evening', action: 'offer-taste' }, 1000, 'Sam');
      assert.equal(state.evening.care.tasteOffer?.result, dateId === 'mira' ? 'accepted' : 'declined');
      assert.equal(state.evening.stance, before); assert.match(state.evening.moments.at(-1)!.description, /^Sam:/);
      assert.throws(() => director.action({ type: 'evening', action: 'offer-taste' }, 2000));
      director.action({ type: 'evening', action: 'toast', choice: 'honesty' }, 3000);
      assert.equal(state.evening.care.toast?.at, 300); assert.equal(state.glassRaised, true);
      assert.throws(() => director.action({ type: 'evening', action: 'toast', choice: 'tonight' }, 4000));
      director.action({ type: 'evening', action: 'request-water' }, 5000);
      assert.equal(state.evening.care.water.status, 'requested');
      state.elapsed += 11; director.step(.016, { allowScenarios: false, allowIncidents: false }); assert.equal(state.evening.care.water.status, 'requested');
      state.elapsed += 1; director.step(.016, { allowScenarios: false, allowIncidents: false }); assert.equal(state.evening.care.water.status, 'served');
      director.action({ type: 'evening', action: 'check-in' }, 6000); assert.equal(state.evening.care.checkIn?.answer, dateId === 'jules' ? 'slow-down' : 'continue');
      assert.equal(state.evening.stance, before); assert.throws(() => director.action({ type: 'evening', action: 'check-in' }, 7000));
    } finally { director.free(); }
  }
});

test('wrong plates arrive before bites, interruptions keep their calm intervals, and declining dessert brings the check before a third one', () => {
  const state = view(), director = new EveningDirector(state, { scenarioId: 'family-visit' });
  try {
    state.elapsed = 0; director.ordered(); state.elapsed = 45; director.step(.016);
    assert.equal(state.evening.incident?.event, 'wrong-order'); assert.equal(state.evening.main.bites, 0);
    director.action({ type: 'evening', action: 'inspect-ticket' }, 500); director.action({ type: 'evening', action: 'return-order' }, 600);
    for (let bite = 0; bite < 3; bite++) director.action({ type: 'evening', action: 'taste' }, 1000 + bite * 600);
    state.elapsed = 60; director.step(.016); assert.equal(state.evening.incident?.event, undefined, 'a resolved plate earns a calm interval');
    state.elapsed = 105; director.step(.016); assert.equal(state.evening.incident?.event, 'spilled-drink', 'the spill is keyed to service');
    for (let wipe = 0; wipe < 3; wipe++) director.action({ type: 'evening', action: 'wipe' }, 3000 + wipe * 200); director.action({ type: 'evening', action: 'steady-glass' }, 4000);
    state.elapsed = 136; director.step(.016);
    assert.equal(state.evening.main.status, 'finished', 'Eli clears the plates after the diner has eaten'); assert.equal(state.evening.incident, null);
    director.action({ type: 'evening', action: 'skip-dessert' }, 5000);
    state.elapsed = 149; director.step(.016);
    assert.deepEqual(state.events, ['wrong-order', 'spilled-drink']); assert.equal(state.evening.incident, null); assert.equal(state.evening.bill.requested, true);
    state.elapsed = 400; director.step(.016); assert.equal(state.evening.incident, null, 'no interruption arrives once the check is on the table');
  } finally { director.free(); }
  const late = view(), timed = new EveningDirector(late, { scenarioId: 'family-visit' });
  try {
    late.elapsed = 0; timed.ordered(); late.elapsed = 45; timed.step(.016); assert.equal(late.evening.incident?.event, 'wrong-order'); const plate = late.evening.main.servedDish; late.elapsed = 150; timed.step(.016); assert.equal(late.evening.main.servedDish, plate);
    assert.equal(late.evening.incident?.event, 'wrong-order'); assert.throws(() => timed.action({ type: 'evening', action: 'taste' }, 1000));
    late.elapsed = 400; timed.step(.016); assert.equal(late.evening.main.status, 'served', 'an unresolved wrong plate is never cleared by the clock');
  } finally { timed.free(); }
});

test('new physical incidents stop when the table is empty or dinner reaches the bill and farewell', () => {
  for (const stop of ['none', 'away', 'requested', 'settled', 'farewell'] as const) {
    const state = view(), director = new EveningDirector(state, { scenarioId: 'family-visit' });
    try {
      state.elapsed = 170; state.evening.main.status = 'served'; state.evening.main.servedAt = 100;
      state.evening.resolutions['wrong-order'] = 'Returned earlier.';
      if (stop === 'away') state.seated = false;
      if (stop === 'requested') state.evening.bill.requested = true;
      if (stop === 'settled') state.evening.bill.settlement = 'split';
      if (stop === 'farewell') { state.evening.chapter = 'farewell'; state.stage = 'farewell'; }
      director.step(.016, { allowScenarios: false });
      if (stop === 'none') { assert.equal(state.evening.incident?.event, 'spilled-drink', 'the same table receives the course-keyed spill when nothing stops it'); continue; }
      assert.equal(state.evening.incident, null, stop);
      assert.equal(state.events.includes('spilled-drink'), false, stop);
    } finally { director.free(); }
  }
  const state = view(), director = new EveningDirector(state, { scenarioId: 'family-visit' });
  try {
    state.elapsed = 500; state.evening.main.status = 'finished'; state.evening.dessert.status = 'skipped';
    state.evening.resolutions['wrong-order'] = 'Returned earlier.';
    state.evening.bill.requested = true; state.evening.bill.settlement = 'split';
    state.evening.chapter = 'farewell'; state.stage = 'farewell'; state.seated = false;
    state.participants[0].position = [0, 0, 5.6];
    director.step(.016, { allowScenarios: false });
    director.action({ type: 'evening', action: 'farewell', choice: 'goodbye' }, 1000);
    assert.equal(state.evening.farewell.ending?.kind, 'quiet-goodbye');
  } finally { director.free(); }
});

test('romantic uncertainty stays a friendship after kindness, and resolved wine is cleaned', () => {
  for (const stance of ['comfortable', 'guarded'] as const) {
    const state = view(), director = new EveningDirector(state, { scenarioId: 'questioning-attraction' });
    try {
      state.evening.main.status = 'served'; state.evening.main.servedDish = state.order; state.evening.resolutions['wrong-order'] = 'The meal was checked earlier.'; director.step(.016);
      director.scenario('respect-privacy'); director.scenario('friendship');
      state.evening.main.status = 'finished'; state.evening.dessert.status = 'skipped';
      state.evening.bill.requested = true; state.evening.bill.settlement = 'split'; state.seated = false;
      state.participants[0].position = [0, 0, 5.6]; state.evening.stance = stance;
      director.action({ type: 'evening', action: 'farewell', choice: 'again' }, 1000);
      assert.equal(state.evening.farewell.ending?.kind, stance === 'comfortable' ? 'new-friend' : 'quiet-goodbye');
    } finally { director.free(); }
  }
  const wine = createRestaurantScenario('wine', 'wine-spill'); activateRestaurantScenario(wine, 300, 'dry');
  chooseRestaurantScenario(wine, 'ask-first', 'You', 301, 'dry'); chooseRestaurantScenario(wine, 'fresh-start', 'You', 302, 'dry');
  assert.equal(wine.effects.wineStain, false);
  assert.equal(validateCommand({ type: 'scenario', choice: 'ask-first' }).type, 'scenario');
  assert.equal(validateCommand({ type: 'evening', action: 'toast', choice: 'friends' }).type, 'evening');
  assert.throws(() => validateCommand({ type: 'scenario', choice: 'ask-first', target: 'other-player' }));
});

test('a bold joke can miss, create a different follow-through and recover without an affection score', () => {
  const practical = createRestaurantScenario('wine', 'wine-spill'); activateRestaurantScenario(practical, 300, 'dry');
  chooseRestaurantScenario(practical, 'ask-first', 'You', 301, 'dry');
  const bold = createRestaurantScenario('wine', 'wine-spill'); activateRestaurantScenario(bold, 300, 'dry');
  const first = chooseRestaurantScenario(bold, 'own-mishap', 'You', 301, 'dry');
  assert.equal(first.utterances[0].emotion, 'annoyed'); assert.notEqual(practical.description, bold.description);
  assert.match(bold.choices[0].label, /Put the joke aside/);
  const final = chooseRestaurantScenario(bold, 'fresh-start', 'You', 302, 'dry');
  assert.equal(final.utterances[0].emotion, 'warm'); assert.match(bold.resolution!, /tried a sleeve joke/);
  const playful = createRestaurantScenario('wine', 'wine-spill'); activateRestaurantScenario(playful, 300, 'playful');
  assert.equal(chooseRestaurantScenario(playful, 'own-mishap', 'You', 301, 'playful').utterances[0].emotion, 'amused');
});

test('a resolved story earns a quiet interval before another physical interruption', () => {
  const state = view(), director = new EveningDirector(state, { scenarioId: 'family-visit' });
  try {
    state.evening.main.status = 'finished'; state.evening.main.finishedAt = 280; state.evening.dessert.status = 'served'; state.evening.dessert.servedAt = 880; state.evening.chapter = 'dessert';
    state.evening.resolutions['wrong-order'] = 'Returned earlier.'; state.evening.resolutions['spilled-drink'] = 'Dried earlier.';
    director.step(.016); director.scenario('welcome'); director.scenario('return-date');
    state.elapsed = 900; state.evening.lastInterruptionAt = 890;
    director.step(.016); assert.equal(state.evening.incident, null);
    state.elapsed = 916; director.step(.016); assert.equal((state.evening.incident as { event: string } | null)?.event, 'disruptive-diner');
  } finally { director.free(); }
});

test('the single-call Claude context cannot anticipate an undisclosed dormant health story', async t => {
  let captured = '';
  const claude: ClaudeAdapter = { async *stream(request) {
    captured = noteOf(request);
    yield { type: 'text', text: JSON.stringify({ utterances: [{ speaker: 'date', text: 'Good to meet you. How was the walk over?', emotion: 'warm' }], emotion: 'warm', action: 'none', memory: 'We introduced ourselves.', social: { signal: 'none', reason: '', wantsToLeave: false } }) };
  } };
  const server = createServer((req, res) => { if (!app.handle(req, res)) res.writeHead(404).end(); });
  const app = await attachRestaurantServer(server, { env: {}, claude, ledgerPath: false, autoTick: false, scenarioId: 'unexpected-tic' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const created = await fetch(base + '/api/date/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dateId: 'mira' }) }).then(response => response.json());
  const response = await fetch(base + `/api/date/sessions/${created.state.id}/turn`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${created.token}` }, body: JSON.stringify({ turnId: 'first-greeting', text: 'Hi, good to meet you.', model: 'claude-haiku-5-5' }) });
  assert.equal(response.status, 200); await response.text();
  assert.equal(section(captured, 'Happening now'), undefined, 'a dormant story is not mentioned before it is disclosed');
  assert.equal(/Tourette|tic\b|Something they choose to share/i.test(captured), false); assert.match(captured, /^Right now: /);
});
