import { createBlindDate } from '../../src/restaurant/blind-date';
import { getDate } from '../../src/restaurant/content';
import type { DinnerState } from '../../src/restaurant/types';
import type { RestaurantScenarioState } from '../../src/restaurant/scenario-types';
import type { ScenarioChoiceResult } from '../../src/restaurant/scenarios';
import { applyScenarioEffects, refreshScenarioBill } from './scenario-effects';
import { appendScenarioCue } from './scenario-cues';
import { noteTableFact } from './table-facts';
export { appendScenarioCue } from './scenario-cues';

// Medical response checked against FARE's emergency guidance; involuntary tics against NHS information.
// https://www.foodallergy.org/resources/recognizing-and-responding-reaction
// https://www.nhs.uk/conditions/Tourette-syndrome/
export function scenarioStyle(view: DinnerState): 'playful' | 'dry' | 'direct' {
  if (view.blindDate) {
    const traits = createBlindDate(view.blindDate.seed).traits;
    return traits.directness > 65 ? 'direct' : traits.sociability > 55 ? 'playful' : 'dry';
  }
  return view.dateId === 'mira' ? 'playful' : view.dateId === 'jules' ? 'dry' : 'direct';
}
export function applyScenarioToView(view: DinnerState, scenario: RestaurantScenarioState, result: ScenarioChoiceResult, by = 'You') {
  view.evening.scenario = scenario; view.evening.lastInterruptionAt = view.elapsed;
  applyScenarioEffects(view, scenario, result);
  const fact = `${by}: ${result.fact}`;
  // Table facts live apart from the notebook the model rewrites, so a later turn cannot erase them. A Double
  // room does not read table facts yet (its context still carries the notebook), so it keeps the older append.
  noteTableFact(view, fact);
  if (view.mode === 'double-date') view.memory = `${view.memory}\n${fact}`.trim().slice(-1000);
  appendScenarioCue(view, `${scenario.id}-${scenario.decisions.length}`, result.utterances);
  const reaction = result.utterances.find(line => line.speaker === 'date');
  if (reaction && view.phase !== 'ended' && view.evening.stance !== 'leaving') view.emotion = reaction.emotion;
  if (result.completed && scenario.id === 'wine-spill') view.glassRaised = false;
  if (scenario.effects.romanceClosed) view.evening.care.romanceClosed = true;
  if (scenario.effects.service === 'water' && view.evening.care.water.status === 'none') view.evening.care.water = { status: 'requested', requestedAt: view.elapsed };
  if (!result.completed) return;
  const id = `scenario-${scenario.id}`;
  if (!view.evening.moments.some(moment => moment.id === id)) view.evening.moments.push({ id, title: scenario.title, description: `${by}: ${scenario.resolution ?? result.fact}` });
  if (scenario.effects.earlyExit && !view.evening.farewell.ending) {
    const medical = ['allergic-reaction', 'too-many-drinks', 'feeling-unwell'].includes(scenario.id);
    const dateLine = result.utterances.find(line => line.speaker === 'date')?.text ?? 'Let’s finish here. Thank you for understanding.';
    view.evening.farewell.ending = { kind: 'early-exit', title: medical ? 'The evening can wait' : 'An honest goodbye', description: scenario.resolution ?? result.fact, dateLine };
    view.evening.stance = 'leaving'; view.evening.stanceReason = medical ? 'The evening ended so the date could receive care and make safe arrangements.' : 'An honest mismatch ended the evening; the decision is respected.';
    view.evening.chapter = 'farewell'; view.stage = 'farewell';
    if (view.evening.dessert.status === 'waiting') view.evening.dessert.status = 'skipped';
    if (medical) {
      view.evening.care.assistedExit = true;
      view.phase = 'ended'; view.stage = 'finished'; view.reason = scenario.resolution ?? result.fact;
    }
    // The restaurant handles the check as part of the early finish; it is not a free escape from the order.
    if (!view.evening.bill.settlement) {
      view.evening.bill.requested = true; view.evening.bill.settlement = 'separate';
      view.evening.moments.push({ id: 'bill', title: 'Dinner is settled', description: medical ? 'Staff handled the check while the date received care.' : 'The ordered dinner was settled separately before the early goodbye.' });
    }
    refreshScenarioBill(view);
  }
}

export function nameScenarioText(text: string, view: DinnerState) { return text.replace(/your date/gi, getDate(view.dateId)!.name); }
