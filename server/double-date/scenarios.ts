import type { DoubleDateRoomState, DoubleHumanId, DoubleScenario } from '../../src/restaurant/double-date-types';
import { createRestaurantScenario, activateRestaurantScenario, chooseRestaurantScenario, scenarioSeed } from '../../src/restaurant/scenarios';
import { appendScenarioCue, applyScenarioToView, scenarioStyle, nameScenarioText } from '../restaurant/scenario';
import { scenarioCanStart, scenarioMayOpen } from '../../src/restaurant/scenario-care';
import { applyScenarioEffects } from '../restaurant/scenario-effects';

/** One shared story at the table; either friend can respond, and an offstage date stays offstage. */
export function initializeScenario(room: DoubleDateRoomState, forced?: DoubleScenario['id']) {
  room.scenario = { ...createRestaurantScenario(room.id, forced), target: scenarioSeed(room.id) % 2 ? 'h2' : 'h1' };
}
export function tickScenario(room: DoubleDateRoomState) {
  const scenario = room.scenario;
  if (room.phase !== 'playing' || !scenario || scenario.phase === 'resolved') return;
  const available = room.members.filter(member => room.views[member.id].phase !== 'ended' && room.views[member.id].evening.stance !== 'leaving');
  if (!available.some(member => member.id === scenario.target)) {
    if (scenario.phase === 'active' || !available.length) {
      scenario.phase = 'resolved'; scenario.choices = []; scenario.resolution = 'The table moment ended when the person involved chose to leave.';
      scenario.resolvedAt = available.length ? Math.max(...available.map(person => room.views[person.id].elapsed)) : room.views[scenario.target].elapsed;
      for (const person of available) {
        const view = room.views[person.id];
        view.evening.lastInterruptionAt = view.elapsed;
        if (!view.evening.moments.some(moment => moment.id === `scenario-${scenario.id}`)) view.evening.moments.push({ id: `scenario-${scenario.id}`, title: scenario.title, description: scenario.resolution });
      }
      room.revision++; return;
    }
    scenario.target = available[0].id;
  }
  if (scenario.phase !== 'dormant') return;
  const views = available.map(member => room.views[member.id]);
  const target = room.views[scenario.target];
  if (views.some(view => view.elapsed - view.evening.lastInterruptionAt <= 25 || view.elapsed < view.evening.care.quietUntil)) return;
  target.evening.scenario = scenario;
  if (!(scenario.id === 'feeling-unwell' ? scenarioMayOpen(target) : scenarioCanStart(target)) || views.some(view => view.evening.incident || ['aiming', 'rolling'].includes(view.evening.coasters.phase) || view.evening.farewell.ending)) return;
  const elapsed = Math.min(...views.map(view => view.elapsed));
  if (scenario.id !== 'feeling-unwell' && elapsed < 240 && views.reduce((sum, view) => sum + view.evening.dialogueTurns, 0) < 4) return;
  const utterances = activateRestaurantScenario(scenario, elapsed, scenarioStyle(target));
  appendScenarioCue(target, `${scenario.id}-opening`, utterances);
  applyScenarioEffects(target, scenario);
  for (const view of views) { view.evening.scenario = scenario; view.evening.lastInterruptionAt = view.elapsed; }
  room.revision++;
}
export function resolveScenario(room: DoubleDateRoomState, human: DoubleHumanId, choice: string) {
  const scenario = room.scenario;
  if (room.phase !== 'playing' || scenario?.phase !== 'active') throw new Error('That table moment is no longer active.');
  const actor = room.members.find(member => member.id === human);
  if (!actor?.connected || !actor.seated || actor.viewingEnding) throw new Error('Take a seat at the table before helping with this moment.');
  const target = room.views[scenario.target];
  if (target.phase === 'ended' || target.evening.stance === 'leaving') throw new Error('That date has already left the table.');
  if (scenario.beat === 'follow-through' && ['privacy-break', 'cleanup-break'].includes(target.evening.scenarioCare?.presence ?? 'at-table')) throw new Error('Give your date time to return before deciding together.');
  const name = room.members.find(member => member.id === human)?.name ?? 'Your friend';
  const result = chooseRestaurantScenario(scenario, choice, name, target.elapsed, scenarioStyle(target));
  applyScenarioToView(target, scenario, result, name);
  for (const [id, view] of Object.entries(room.views)) if (id !== scenario.target && view.phase !== 'ended') {
    view.evening.scenario = scenario; view.evening.lastInterruptionAt = view.elapsed;
    if (result.completed) {
      const momentId = `scenario-${scenario.id}`;
      if (!view.evening.moments.some(moment => moment.id === momentId)) view.evening.moments.push({ id: momentId, title: scenario.title, description: `${name}: ${nameScenarioText(scenario.resolution ?? result.fact, target)}` });
    }
  }
  room.revision++;
}
