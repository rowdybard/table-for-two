import { createScenarioCareState, buildDinnerBill, DINNER_PRICES_CENTS, scenarioResumeAvailability } from '../../src/restaurant/scenario-care';
import { MENU } from '../../src/restaurant/content';
import type { RestaurantScenarioState } from '../../src/restaurant/scenario-types';
import type { ScenarioChoiceResult } from '../../src/restaurant/scenarios';
import type { DinnerState } from '../../src/restaurant/types';
import { flushScenarioDateCues } from './scenario-cues';

export function ensureScenarioCare(view: DinnerState) { return view.evening.scenarioCare ??= createScenarioCareState(); }
export function refreshScenarioBill(view: DinnerState) { const bill = buildDinnerBill(view); view.evening.bill.items = bill.items; view.evening.bill.totalCents = bill.totalCents; return bill; }
/** Relevant physical facts only; execution IDs, timers and decorative props stay out of prompts. */
export function scenarioMechanicsContext(view: DinnerState) {
  const care = view.evening.scenarioCare;
  if (!care || !care.applied.length) return undefined;
  const context: Record<string, unknown> = {};
  if (care.presence !== 'at-table') context.presence = care.presence;
  if (care.kitchen.held) context.dinnerHeld = true;
  if (care.table === 'quiet') context.table = 'quiet';
  if (care.service.staff !== 'none' && (view.evening.scenario?.phase === 'active' || view.elapsed < view.evening.care.quietUntil || ['medical', 'safe-finish'].includes(care.service.staff))) context.staff = care.service.staff;
  if (care.service.spaceCleared) context.spaceCleared = true;
  if (care.service.alcoholStopped) context.alcoholStopped = true;
  if (care.service.contactRequested) context.contactRequested = true;
  if (care.cleanup.wine === 'wet' || care.presence === 'cleanup-break') context.cleanup = { wine: care.cleanup.wine, cloth: care.cleanup.cloth, glassesCleared: care.cleanup.glassesCleared };
  if (care.extraOrder.items.length) context.extraOrder = care.extraOrder.items.map(({ dish, quantity, status }) => ({ dish, quantity, status }));
  return Object.keys(context).length ? context : undefined;
}
function holdDinner(view: DinnerState) {
  const kitchen = ensureScenarioCare(view).kitchen;
  if (!kitchen.held) { kitchen.held = true; kitchen.heldAt = view.elapsed; }
}
/** Cumulative time excluded from kitchen timers, including a hold currently in progress. */
export function scenarioKitchenDelay(view: DinnerState) {
  const kitchen = view.evening.scenarioCare?.kitchen;
  return kitchen ? kitchen.pausedSeconds + (kitchen.held && kitchen.heldAt !== null ? Math.max(0, view.elapsed - kitchen.heldAt) : 0) : 0;
}
function releaseDinner(view: DinnerState) {
  const kitchen = ensureScenarioCare(view).kitchen;
  kitchen.pausedSeconds = scenarioKitchenDelay(view); kitchen.held = false; kitchen.heldAt = null;
}
export function resumeScenarioDinner(view: DinnerState) {
  const available = scenarioResumeAvailability(view);
  if (!available.enabled) throw new Error(available.reason);
  releaseDinner(view);
}
function shortBreak(view: DinnerState, kind: 'privacy-break' | 'cleanup-break') {
  const care = ensureScenarioCare(view); care.presence = kind; care.returnAt = view.elapsed + 6;
}
function discreet(view: DinnerState, seconds = 60) {
  const care = ensureScenarioCare(view);
  if (care.service.staff === 'none') care.service.staff = 'discreet';
  view.evening.care.quietUntil = Math.max(view.evening.care.quietUntil, view.elapsed + seconds);
}

/** Each opening and choice is a deterministic transaction, independent of dialogue generation. */
export function applyScenarioEffects(view: DinnerState, scenario: RestaurantScenarioState, result?: ScenarioChoiceResult) {
  if (scenario.phase === 'dormant') return;
  const care = ensureScenarioCare(view), opening = `${scenario.id}:opening:${scenario.startedAt ?? 0}`;
  if (!care.applied.includes(opening)) {
    care.applied.push(opening);
    if (scenario.id === 'feeling-unwell') { holdDinner(view); shortBreak(view, 'privacy-break'); discreet(view, 90); }
    if (scenario.id === 'wine-spill') { care.cleanup.wine = 'wet'; care.cleanup.cloth = 'ready'; scenario.effects.wineStain = true; discreet(view); }
    if (scenario.id === 'oversized-order') {
      care.extraOrder.items = [0, 1, 2, 0].map((index, i) => ({ id: `extra-${i + 1}`, dish: MENU[index]!, quantity: 1, unitPriceCents: DINNER_PRICES_CENTS[MENU[index]!]!, status: i < 2 ? 'served' : 'pending' }));
    }
    if (scenario.id === 'allergic-reaction' || scenario.id === 'too-many-drinks') {
      holdDinner(view); care.presence = 'staff-care'; care.returnAt = null;
      care.service.staff = scenario.id === 'allergic-reaction' ? 'medical' : 'discreet';
      care.service.spaceCleared = true; care.service.alcoholStopped = true;
      if (scenario.id === 'too-many-drinks') care.cleanup.cloth = 'ready';
      view.glassRaised = false;
    }
    if (['staff-flirt', 'awkward-ex', 'family-visit', 'unexpected-tic', 'questioning-attraction', 'unwelcome-comment'].includes(scenario.id)) discreet(view);
  }
  if (result) {
    const decision = scenario.decisions.at(-1)?.id, key = `${scenario.id}:choice:${scenario.decisions.length}:${decision ?? ''}`;
    if (!decision || care.applied.includes(key)) return;
    care.applied.push(key);
    if (scenario.id === 'feeling-unwell') {
      if (result.completed && !scenario.effects.earlyExit) discreet(view, 90);
      if (scenario.effects.earlyExit) { care.presence = 'staff-care'; care.returnAt = null; care.service.staff = 'safe-finish'; }
    } else if (scenario.id === 'wine-spill') {
      if (result.completed) {
        care.cleanup.wine = 'clean'; care.cleanup.cloth = 'used'; view.glassRaised = false; scenario.effects.wineStain = false;
        if (decision === 'fresh-start') { holdDinner(view); shortBreak(view, 'cleanup-break'); care.cleanup.glassesCleared = true; }
        else care.cleanup.glassesCleared = false;
        discreet(view);
      }
    } else if (scenario.id === 'oversized-order') {
      if (decision === 'help') for (const item of care.extraOrder.items) if (item.status === 'pending') item.status = 'cancelled';
      if (result.completed) {
        let shared = false;
        for (const item of care.extraOrder.items) {
          if (item.status === 'pending') item.status = 'cancelled';
          else if (item.status === 'served') {
            if (decision === 'share-chosen' && !shared) { item.status = 'shared'; shared = true; }
            else item.status = 'boxed';
          }
        }
      }
    } else if (scenario.id === 'allergic-reaction' || scenario.id === 'too-many-drinks') {
      care.service.spaceCleared = true; care.service.alcoholStopped = true;
      care.service.contactRequested ||= decision === 'contact-person' || decision === 'trusted-person';
      if (result.completed) care.service.staff = scenario.id === 'allergic-reaction' ? 'medical' : 'safe-finish';
    } else if (scenario.id === 'unwelcome-comment' && result.completed) {
      if (decision === 'move-away') care.table = 'quiet';
      care.service.staff = 'discreet'; discreet(view, 120);
    } else if (scenario.id === 'unexpected-tic') {
      // The date explicitly says no adjustment is needed. Privacy never forces an absence.
      if (decision === 'give-privacy' || decision === 'keep-option') discreet(view, 90);
    } else if (scenario.id === 'questioning-attraction') {
      view.evening.care.romanceClosed = true; discreet(view, 90);
    } else discreet(view);
  }
  refreshScenarioBill(view);
}

/** Complete visible short breaks and kitchen work using scene time, never wall timers or AI. */
export function stepScenarioEffects(view: DinnerState, options: { allowReturn?: boolean } = {}) {
  if (view.phase !== 'playing') return;
  const care = view.evening.scenarioCare;
  if (!care) { refreshScenarioBill(view); return; }
  if (options.allowReturn !== false && care.returnAt !== null && view.elapsed >= care.returnAt && ['privacy-break', 'cleanup-break'].includes(care.presence)) {
    care.presence = 'at-table'; care.returnAt = null; care.cleanup.glassesCleared = false;
  }
  flushScenarioDateCues(view);
  if (care.kitchen.held && care.kitchen.heldAt !== null && view.elapsed - care.kitchen.heldAt >= 45 && scenarioResumeAvailability(view).enabled) releaseDinner(view);
  const scenario = view.evening.scenario;
  if (scenario?.id === 'oversized-order' && !care.kitchen.held && view.elapsed - (scenario.startedAt ?? view.elapsed) >= 12) for (const item of care.extraOrder.items) if (item.status === 'pending') item.status = 'served';
  refreshScenarioBill(view);
}
