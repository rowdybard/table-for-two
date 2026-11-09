import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { applyScenarioToView } from '../server/restaurant/scenario';
import { applyScenarioEffects, ensureScenarioCare, refreshScenarioBill, resumeScenarioDinner, scenarioKitchenDelay, scenarioMechanicsContext, stepScenarioEffects } from '../server/restaurant/scenario-effects';
import { activateRestaurantScenario, chooseRestaurantScenario, createRestaurantScenario, RESTAURANT_SCENARIOS } from '../src/restaurant/scenarios';
import { createScenarioCareState, buildDinnerBill, scenarioCareSnapshot, scenarioMayOpen, scenarioResumeAvailability, scenePresenceAvailable } from '../src/restaurant/scenario-care';
import { MENU } from '../src/restaurant/content';
import type { RestaurantScenarioId } from '../src/restaurant/scenario-types';
import type { DinnerState } from '../src/restaurant/types';
import { appendScenarioCue, flushScenarioDateCues } from '../server/restaurant/scenario-cues';

function fixture(id: RestaurantScenarioId, mode: DinnerState['mode'] = 'ai-date') {
  const view = createPairView(`effects-${id}`, 'h1', 'Alex', 'mira', emptyUsage(), 2);
  view.mode = mode; view.phase = 'playing'; view.stage = 'dining'; view.seated = true; view.elapsed = 120; view.order = MENU[0]!;
  view.evening.main = { status: 'served', bites: 0, servedDish: MENU[0]!, dateDish: MENU[1]!, orderedAt: 0, servedAt: 45 };
  const scenario = createRestaurantScenario(`effects-${id}`, id); view.evening.scenario = scenario;
  if (mode === 'blind-date') view.blindDate = { seed: `effects-${id}` };
  const open = () => { activateRestaurantScenario(scenario, view.elapsed, 'playful'); applyScenarioEffects(view, scenario); };
  const choose = (id: string) => { const result = chooseRestaurantScenario(scenario, id, 'Alex', view.elapsed, 'playful'); applyScenarioToView(view, scenario, result, 'Alex'); return result; };
  return { view, scenario, open, choose };
}

test('scenario state defaults and snapshots are independent, and no dormant story applies effects', () => {
  const a = createScenarioCareState(), b = scenarioCareSnapshot(a); b.cleanup.wine = 'wet'; b.extraOrder.items.push({ id: 'test', dish: MENU[0]!, quantity: 1, unitPriceCents: 1800, status: 'boxed' });
  assert.equal(a.cleanup.wine, 'none'); assert.equal(a.extraOrder.items.length, 0);
  const { view, scenario } = fixture('oversized-order'); applyScenarioEffects(view, scenario);
  assert.equal(view.evening.scenarioCare, undefined);
});

for (const mode of ['ai-date', 'blind-date', 'double-date'] as const) test(`${mode}: all eleven tracks and every setup/ending path apply once without model calls or affection rewards`, () => {
  for (const track of RESTAURANT_SCENARIOS) for (const first of track.choices) for (const last of track.endings) {
    const f = fixture(track.id, mode); f.open(); const initial = structuredClone(f.view.evening.scenarioCare);
    applyScenarioEffects(f.view, f.scenario); assert.deepEqual(f.view.evening.scenarioCare, initial, `${track.id} activation is idempotent`);
    f.choose(first.id); const result = f.choose(last.id); const final = structuredClone(f.view.evening.scenarioCare);
    applyScenarioEffects(f.view, f.scenario, result); assert.deepEqual(f.view.evening.scenarioCare, final, `${track.id}/${first.id}/${last.id} cannot duplicate physical effects`);
    assert.equal(f.view.evening.scenarioCare!.applied.length, 3);
    assert.equal(f.view.usage.claudeRequests, 0); assert.equal(f.view.usage.totalCost, 0);
    assert.equal(f.view.evening.agenda, undefined); assert.equal(f.view.evening.chemistry, undefined);
    assert.equal(f.scenario.phase, 'resolved');
  }
});

test('urgent bathroom detour starts before service, pauses remaining kitchen time, returns visibly, and resumes explicitly', () => {
  const f = fixture('feeling-unwell'); f.view.evening.main.status = 'waiting'; f.view.evening.main.servedDish = null; f.view.evening.main.orderedAt = 100;
  f.view.elapsed = 111.9; assert.equal(scenarioMayOpen(f.view), false);
  f.view.elapsed = 112; assert.equal(scenarioMayOpen(f.view), true); f.open();
  const care = f.view.evening.scenarioCare!; assert.equal(care.kitchen.held, true); assert.equal(care.presence, 'privacy-break'); assert.equal(scenePresenceAvailable(f.view), false);
  f.view.elapsed = 115; stepScenarioEffects(f.view); assert.equal(scenarioKitchenDelay(f.view), 3); assert.equal(care.presence, 'privacy-break');
  f.choose('water'); f.choose('slow-dinner'); assert.equal(scenarioResumeAvailability(f.view).enabled, false); assert.throws(() => resumeScenarioDinner(f.view), /return/);
  f.view.elapsed = 118; stepScenarioEffects(f.view); assert.equal(care.presence, 'at-table'); assert.equal(scenePresenceAvailable(f.view), true); assert.equal(scenarioResumeAvailability(f.view).enabled, true);
  resumeScenarioDinner(f.view); assert.equal(care.kitchen.held, false); assert.equal(scenarioKitchenDelay(f.view), 6);
  f.view.elapsed = 140; assert.equal(scenarioKitchenDelay(f.view), 6, 'only the held interval is excluded from cooking');
  assert.equal(f.view.evening.main.status, 'waiting', 'helper never pretends the held course was delivered');
});

test('a resolved short break has a fallback resume while paused or unresolved scenes cannot resume or advance', () => {
  const f = fixture('feeling-unwell'); f.open();
  const before = structuredClone(f.view.evening.scenarioCare); assert.throws(() => resumeScenarioDinner(f.view)); assert.deepEqual(f.view.evening.scenarioCare, before);
  f.choose('fresh-air'); f.choose('slow-dinner'); f.view.phase = 'paused'; f.view.elapsed += 50; stepScenarioEffects(f.view);
  assert.equal(f.view.evening.scenarioCare!.presence, 'privacy-break'); assert.equal(f.view.evening.scenarioCare!.kitchen.held, true);
  assert.throws(() => resumeScenarioDinner(f.view));
  f.view.phase = 'playing'; stepScenarioEffects(f.view); assert.equal(f.view.evening.scenarioCare!.presence, 'at-table'); assert.equal(f.view.evening.scenarioCare!.kitchen.held, false); assert.equal(scenarioKitchenDelay(f.view), 50);
});

test('unwell story never re-holds an eaten main, and a live incident keeps every story closed', () => {
  const f = fixture('feeling-unwell'); f.view.evening.main.status = 'finished'; assert.equal(scenarioMayOpen(f.view), false);
  f.view.evening.main.status = 'served'; f.view.evening.main.bites = 3; assert.equal(scenarioMayOpen(f.view), false);
  f.view.evening.main.bites = 0; f.view.evening.incident = { event: 'spilled-drink', progress: 0, startedAt: 100 }; assert.equal(scenarioMayOpen(f.view), false);
  f.view.evening.incident = null; assert.equal(scenarioMayOpen(f.view), true);
});

test('wine clean-up clears the actual stain and glass state; a private clean-up break returns before dinner resumes', () => {
  for (const ending of ['fresh-start', 'change-seat']) {
    const f = fixture('wine-spill'); f.view.glassRaised = true; f.open();
    assert.equal(f.scenario.effects.wineStain, true); assert.equal(f.view.evening.scenarioCare!.cleanup.wine, 'wet');
    f.choose('get-eli'); f.choose(ending);
    const care = f.view.evening.scenarioCare!;
    assert.equal(f.scenario.effects.wineStain, false); assert.equal(care.cleanup.wine, 'clean'); assert.equal(care.cleanup.cloth, 'used'); assert.equal(f.view.glassRaised, false);
    if (ending === 'fresh-start') { assert.equal(care.presence, 'cleanup-break'); assert.equal(care.cleanup.glassesCleared, true); f.view.elapsed += 6; stepScenarioEffects(f.view); assert.equal(care.presence, 'at-table'); assert.equal(care.cleanup.glassesCleared, false); resumeScenarioDinner(f.view); }
    else { assert.equal(care.presence, 'at-table'); assert.equal(care.cleanup.glassesCleared, false); }
  }
});

test('cancelling kitchen extras and boxing prepared extras changes a real itemised bill while preserving the player’s meal', () => {
  const f = fixture('oversized-order'); f.open(); const care = f.view.evening.scenarioCare!;
  assert.deepEqual(care.extraOrder.items.map(item => item.status), ['served', 'served', 'pending', 'pending']);
  assert.equal(f.view.evening.bill.totalCents, 8000);
  f.choose('help'); assert.deepEqual(care.extraOrder.items.map(item => item.status), ['served', 'served', 'cancelled', 'cancelled']);
  f.choose('share-chosen'); assert.deepEqual(care.extraOrder.items.map(item => item.status), ['shared', 'boxed', 'cancelled', 'cancelled']);
  const bill = buildDinnerBill(f.view); assert.equal(bill.totalCents, 8000); assert.equal(bill.items.filter(item => item.status === 'cancelled').reduce((sum, item) => sum + item.chargedCents, 0), 0);
  assert.equal(bill.items.find(item => item.status === 'boxed')!.chargedCents, 2200);
  assert.equal(f.view.order, MENU[0]); assert.equal(f.view.evening.main.servedDish, MENU[0]); assert.equal(f.view.evening.main.bites, 0);
  f.view.elapsed += 50; stepScenarioEffects(f.view); assert.equal(care.extraOrder.items.filter(item => item.status === 'cancelled').length, 2, 'cancelled food never appears later');
});

test('letting the extra dishes arrive has a different bill, and keeping your meal boxes the date’s leftovers only', () => {
  const f = fixture('oversized-order'); f.open(); f.choose('wait'); f.view.elapsed += 12; stepScenarioEffects(f.view);
  assert.equal(f.view.evening.scenarioCare!.extraOrder.items.filter(item => item.status === 'served').length, 4); assert.equal(f.view.evening.bill.totalCents, 11800);
  f.choose('keep-own'); assert.ok(f.view.evening.scenarioCare!.extraOrder.items.every(item => item.status === 'boxed'));
  assert.equal(f.view.evening.bill.totalCents, 11800); assert.equal(f.view.evening.bill.items!.find(item => item.id === 'main-you')!.status, 'served');
});

test('serious allergy immediately pauses service and clears responder space; the authored handoff records the requested contact', () => {
  const f = fixture('allergic-reaction'); f.open(); const care = f.view.evening.scenarioCare!;
  assert.equal(care.service.staff, 'medical'); assert.equal(care.kitchen.held, true); assert.equal(care.service.spaceCleared, true); assert.equal(care.service.alcoholStopped, true); assert.equal(scenePresenceAvailable(f.view), false);
  f.choose('stay-close'); f.choose('contact-person');
  assert.equal(care.service.contactRequested, true); assert.equal(f.view.phase, 'ended'); assert.equal(f.view.evening.care.assistedExit, true); assert.equal(f.view.evening.bill.settlement, 'separate');
});

test('too much alcohol stops drinks at the opening and staff make the agreed safe finish', () => {
  const f = fixture('too-many-drinks'); f.open(); const care = f.view.evening.scenarioCare!;
  assert.equal(care.service.alcoholStopped, true); assert.equal(care.service.spaceCleared, true); assert.equal(care.presence, 'staff-care');
  f.choose('no-pressure'); f.choose('trusted-person'); assert.equal(care.service.staff, 'safe-finish'); assert.equal(care.service.contactRequested, true); assert.equal(f.view.phase, 'ended');
});

test('quiet-table choice changes physical station state; discreet privacy never forces an adult to leave', () => {
  const f = fixture('unwelcome-comment'); f.open(); f.choose('ask-staff'); f.choose('move-away'); assert.equal(f.view.evening.scenarioCare!.table, 'quiet');
  const g = fixture('unexpected-tic'); g.open(); g.choose('give-privacy'); g.choose('keep-option');
  assert.equal(g.view.evening.scenarioCare!.presence, 'at-table'); assert.equal(g.view.evening.scenarioCare!.returnAt, null); assert.equal(g.view.evening.scenarioCare!.service.staff, 'discreet'); assert.ok(g.view.evening.care.quietUntil > g.view.elapsed);
  const h = fixture('questioning-attraction'); h.open(); h.choose('respect-privacy'); h.choose('friendship'); assert.equal(h.view.evening.care.romanceClosed, true); assert.equal(h.view.phase, 'playing');
});

test('targeted Double care and extra orders never consume another pair’s meal, bill or personal state', () => {
  const target = fixture('oversized-order', 'double-date'), other = fixture('family-visit', 'double-date'); refreshScenarioBill(other.view);
  const before = structuredClone(other.view); target.open(); target.choose('joke'); target.choose('keep-own');
  assert.deepEqual(other.view, before); assert.equal(other.view.evening.bill.totalCents, 4000); assert.equal(target.view.evening.bill.totalCents, 8000);
  const medical = fixture('allergic-reaction', 'double-date'); medical.open(); medical.choose('get-help'); medical.choose('support-handoff'); assert.equal(medical.view.phase, 'ended'); assert.equal(other.view.phase, 'playing');
});

test('pending mains and desserts are not charged before service, while prepared courses remain billed', () => {
  const f = fixture('family-visit'); ensureScenarioCare(f.view); f.view.evening.main.status = 'waiting'; f.view.evening.dessert = { choice: 'lemon', status: 'waiting', bites: 0, chosenBy: 'you' };
  assert.equal(refreshScenarioBill(f.view).totalCents, 0);
  f.view.evening.main.status = 'served'; assert.equal(refreshScenarioBill(f.view).totalCents, 4000);
  f.view.evening.dessert.status = 'served'; assert.equal(refreshScenarioBill(f.view).totalCents, 4900);
  f.view.evening.main.status = 'finished'; f.view.evening.dessert.status = 'finished'; assert.equal(refreshScenarioBill(f.view).totalCents, 4900);
});

test('a kept replacement is labelled as the actual meal while retaining the original menu price', () => {
  const f = fixture('family-visit'); f.view.evening.main.servedDish = MENU[1]!;
  const replacement = refreshScenarioBill(f.view).items.find(item => item.id === 'main-you')!;
  assert.match(replacement.label, new RegExp(MENU[1]!)); assert.match(replacement.label, /replacement, original price/); assert.equal(replacement.unitPriceCents, 1800);
  f.view.evening.main.servedDish = f.view.order;
  const restored = refreshScenarioBill(f.view).items.find(item => item.id === 'main-you')!;
  assert.equal(restored.label, MENU[0]); assert.equal(restored.unitPriceCents, 1800);
});

test('model context exposes meaningful scenario consequences without execution IDs, timers or decorative prop topics', () => {
  const f = fixture('oversized-order'); assert.equal(scenarioMechanicsContext(f.view), undefined); f.open(); f.choose('help'); f.choose('keep-own');
  const context = scenarioMechanicsContext(f.view)!;
  assert.deepEqual((context.extraOrder as unknown[]).length, 4);
  const text = JSON.stringify(context);
  for (const omitted of ['applied', 'heldAt', 'pausedSeconds', 'returnAt', 'extra-1', 'lamp', 'vase', 'plant', 'cutlery', 'unitPriceCents']) assert.equal(text.includes(omitted), false, omitted);
  const medical = fixture('allergic-reaction'); medical.open(); assert.equal(scenarioMechanicsContext(medical.view)!.dinnerHeld, true); assert.equal(scenarioMechanicsContext(medical.view)!.staff, 'medical');
});

test('temporary privacy defers authored date callbacks until return while staff and medical cues remain immediate', () => {
  const f = fixture('feeling-unwell'); f.open(); f.choose('water');
  assert.equal(f.view.evening.cues.length, 0, 'the offstage date callback is not yet in the transcript queue');
  appendScenarioCue(f.view, 'staff-check', [{ speaker: 'waiter', text: 'Fresh water is on its way.', emotion: 'neutral' }]);
  assert.equal(f.view.evening.cues.length, 1); assert.equal(f.view.evening.cues[0]!.utterances[0]!.speaker, 'waiter');
  f.view.elapsed += 5.9; stepScenarioEffects(f.view); assert.equal(f.view.evening.cues.length, 1);
  f.view.elapsed += .1; stepScenarioEffects(f.view, { allowReturn: false }); assert.equal(f.view.evening.cues.length, 1); assert.equal(f.view.evening.scenarioCare!.presence, 'privacy-break', 'elapsed time cannot claim a body has returned');
  stepScenarioEffects(f.view, { allowReturn: true }); assert.equal(f.view.evening.cues.length, 2); assert.equal(f.view.evening.cues[1]!.utterances[0]!.speaker, 'date');
  stepScenarioEffects(f.view); assert.equal(f.view.evening.cues.length, 2, 'return flushes each callback once');
  const medical = fixture('allergic-reaction'); medical.open(); medical.choose('get-help'); assert.equal(medical.view.evening.cues.length, 1, 'medical handoff dialogue does not await a privacy break');
  const mixed = fixture('feeling-unwell'); mixed.open(); appendScenarioCue(mixed.view, 'mixed', [{ speaker: 'date', text: 'I’m back.', emotion: 'neutral' }, { speaker: 'waiter', text: 'I’ll hold dinner.', emotion: 'neutral' }]);
  mixed.view.elapsed += 6; stepScenarioEffects(mixed.view); assert.equal(mixed.view.evening.cues.length, 2); assert.equal(new Set(mixed.view.evening.cues.map(cue => cue.id)).size, 2, 'immediate staff and later date callbacks have distinct delivery IDs');
  const cancelled = fixture('wine-spill'); cancelled.open(); cancelled.choose('ask-first'); cancelled.choose('fresh-start');
  const count = cancelled.view.evening.cues.length; cancelled.view.phase = 'ended'; flushScenarioDateCues(cancelled.view); cancelled.view.phase = 'playing'; cancelled.view.evening.scenarioCare!.presence = 'at-table'; flushScenarioDateCues(cancelled.view); assert.equal(cancelled.view.evening.cues.length, count, 'a terminated break cannot play a late callback');
});
