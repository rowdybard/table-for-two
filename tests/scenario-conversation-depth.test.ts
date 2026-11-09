import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPairView } from '../server/double-date/scene';
import { emptyUsage } from '../server/restaurant/scene';
import { applyScenarioToView } from '../server/restaurant/scenario';
import { applyScenarioEffects } from '../server/restaurant/scenario-effects';
import { appendScenarioCue, flushScenarioDateCues } from '../server/restaurant/scenario-cues';
import { tableFacts } from '../server/restaurant/table-facts';
import { activateRestaurantScenario, chooseRestaurantScenario, createRestaurantScenario, RESTAURANT_SCENARIOS } from '../src/restaurant/scenarios';
import type { RestaurantScenarioId } from '../src/restaurant/scenario-types';
import type { DinnerState, SceneUtterance } from '../src/restaurant/types';

function fixture(id: RestaurantScenarioId) {
  const view = createPairView(`depth-${id}`, 'h1', 'Alex', 'mira', emptyUsage(), 2);
  view.phase = 'playing'; view.stage = 'dining'; view.seated = true; view.elapsed = 120;
  const scenario = createRestaurantScenario('conversation-depth', id);
  view.evening.scenario = scenario;
  return { view, scenario };
}
const dateLine: SceneUtterance = { speaker: 'date', text: 'I am back. Thanks for giving me a minute.', emotion: 'warm' };
const staffLine: SceneUtterance = { speaker: 'waiter', text: 'I will hold the food until they return.', emotion: 'neutral' };
const spoken = (view: DinnerState) => view.evening.cues.flatMap(cue => cue.utterances.map(line => line.text));

test('every existing choice history has branch-specific immediate context and persistent factual callbacks in all voices', () => {
  assert.equal(RESTAURANT_SCENARIOS.length, 11);
  let histories = 0;
  for (const style of ['playful', 'dry', 'direct'] as const) {
    for (const track of RESTAURANT_SCENARIOS) for (const first of track.choices) for (const ending of track.endings) {
      const { view, scenario } = fixture(track.id);
      const opening = activateRestaurantScenario(scenario, view.elapsed, style);
      assert.ok(opening.length && opening.every(line => line.text.trim()), `${track.id}: an actual opening exists`);
      applyScenarioEffects(view, scenario);
      const originalProgress = { agenda: structuredClone(view.evening.agenda), chemistry: structuredClone(view.evening.chemistry) };
      const initial = chooseRestaurantScenario(scenario, first.id, 'Alex', ++view.elapsed, style);
      applyScenarioToView(view, scenario, initial, 'Alex');
      assert.equal(scenario.description, first.follow ?? track.follow, `${track.id}/${first.id}: actual branch context`);
      assert.ok(tableFacts(view).some(fact => fact.startsWith(`Alex: ${initial.fact.slice(0, 80)}`)), 'the first choice survives outside model-rewritten memory');
      assert.ok(initial.utterances.every(line => line.text.trim() && line.text.length <= 420));
      const finish = chooseRestaurantScenario(scenario, ending.id, 'Alex', ++view.elapsed, style);
      applyScenarioToView(view, scenario, finish, 'Alex');
      assert.ok(tableFacts(view).some(fact => fact.startsWith(`Alex: ${finish.fact.slice(0, 80)}`)));
      assert.ok(scenario.resolution?.includes(initial.fact)); assert.ok(scenario.resolution?.includes(finish.fact));
      const callback = view.evening.moments.find(moment => moment.id === `scenario-${track.id}`);
      assert.equal(callback?.description, `Alex: ${scenario.resolution}`);
      assert.equal(view.memory, '', 'authoritative facts do not masquerade as the date\'s learned notebook');
      assert.deepEqual({ agenda: view.evening.agenda, chemistry: view.evening.chemistry }, originalProgress, 'a scenario never awards conversation/chemistry points');
      assert.equal(view.usage.claudeRequests, 0); assert.equal(view.usage.totalCost, 0);
      assert.throws(() => chooseRestaurantScenario(scenario, ending.id, 'Alex', ++view.elapsed, style), 'the same choice cannot generate a duplicate callback');
      histories++;
    }
  }
  assert.equal(histories, 58 * 3, 'the retained 58 histories are exercised in the three existing voices');
});

test('offstage callbacks wait for an actual return, stay ordered and flush only once', () => {
  for (const presence of ['privacy-break', 'cleanup-break'] as const) {
    const { view, scenario } = fixture('feeling-unwell');
    activateRestaurantScenario(scenario, view.elapsed, 'dry'); applyScenarioEffects(view, scenario);
    view.evening.scenarioCare!.presence = presence;
    appendScenarioCue(view, 'first-choice', [dateLine, staffLine]);
    appendScenarioCue(view, 'first-choice', [dateLine]);
    appendScenarioCue(view, 'follow-through', [{ ...dateLine, text: 'I would like to carry on slowly.' }]);
    assert.deepEqual(spoken(view), [staffLine.text], 'staff may speak while the date is away');
    view.elapsed += 100; flushScenarioDateCues(view);
    assert.deepEqual(spoken(view), [staffLine.text], 'time passing does not invent a physical return');
    view.evening.scenarioCare!.presence = 'at-table'; view.phase = 'paused'; flushScenarioDateCues(view);
    assert.deepEqual(spoken(view), [staffLine.text], 'paused callbacks cannot take the floor');
    view.phase = 'playing'; flushScenarioDateCues(view);
    assert.deepEqual(spoken(view), [staffLine.text, dateLine.text, 'I would like to carry on slowly.']);
    const count = view.evening.cues.length;
    flushScenarioDateCues(view); flushScenarioDateCues(view);
    assert.equal(view.evening.cues.length, count);
  }
});

test('medical staff-care cues remain immediate and clear, while a departed date gets no late callback', () => {
  for (const id of ['allergic-reaction', 'too-many-drinks'] as const) {
    const { view, scenario } = fixture(id);
    const opening = activateRestaurantScenario(scenario, view.elapsed, 'playful'); applyScenarioEffects(view, scenario);
    assert.equal(view.evening.scenarioCare!.presence, 'staff-care');
    appendScenarioCue(view, `${id}-opening`, opening);
    assert.deepEqual(spoken(view), opening.map(line => line.text));
    for (const choice of [scenario.choices[0].id, scenario.id === 'allergic-reaction' ? 'support-handoff' : 'safe-finish']) {
      const result = chooseRestaurantScenario(scenario, choice, 'Alex', ++view.elapsed, 'playful');
      applyScenarioToView(view, scenario, result, 'Alex');
      assert.ok(result.utterances.every(line => !['amused', 'flirtatious'].includes(line.emotion)));
      assert.ok(result.utterances.every(line => spoken(view).includes(line.text)), 'care acknowledgement is immediate');
    }
    assert.equal(view.phase, 'ended'); assert.equal(view.evening.care.assistedExit, true);
  }
  const { view, scenario } = fixture('feeling-unwell');
  activateRestaurantScenario(scenario, view.elapsed, 'dry'); applyScenarioEffects(view, scenario);
  appendScenarioCue(view, 'unheard-return', [dateLine]);
  view.evening.stance = 'leaving'; flushScenarioDateCues(view);
  view.evening.stance = 'curious'; view.evening.scenarioCare!.presence = 'at-table'; flushScenarioDateCues(view);
  assert.equal(spoken(view).includes(dateLine.text), false, 'cleared departure callbacks cannot reappear');
});
