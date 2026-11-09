import { MENU } from './content';
import { DESSERTS } from './evening';
import type { DinnerBillItem, ScenarioCareState } from './scenario-types';
import type { DinnerState } from './types';

/** Fictional menu prices in cents; no payment or provider spend is performed. */
export const DINNER_PRICES_CENTS: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(MENU.map((dish, index) => [dish, [1800, 2200, 2000][index] ?? 1800])));
export const DESSERT_PRICES_CENTS: Readonly<Record<string, number>> = Object.freeze({ lemon: 900, chocolate: 1100, berries: 800 });
export const createScenarioCareState = (): ScenarioCareState => ({ applied: [], kitchen: { held: false, heldAt: null, pausedSeconds: 0 }, presence: 'at-table', returnAt: null, table: 'original', cleanup: { wine: 'none', cloth: 'none', glassesCleared: false }, service: { staff: 'none', spaceCleared: false, alcoholStopped: false, contactRequested: false }, extraOrder: { items: [] } });
export function scenarioCareSnapshot(state?: ScenarioCareState): ScenarioCareState {
  const care = state ?? createScenarioCareState();
  return { ...care, applied: [...care.applied], kitchen: { ...care.kitchen }, cleanup: { ...care.cleanup }, service: { ...care.service }, extraOrder: { items: care.extraOrder.items.map(item => ({ ...item })) } };
}
export function scenePresenceAvailable(view: DinnerState) { return view.phase === 'playing' && view.evening.stance !== 'leaving' && !view.evening.farewell.ending && (view.evening.scenarioCare?.presence ?? 'at-table') === 'at-table'; }
export function scenarioResumeAvailability(view: DinnerState): { enabled: boolean; reason?: string } {
  const care = view.evening.scenarioCare;
  let reason: string | undefined;
  if (view.phase !== 'playing' || !view.seated || view.evening.farewell.ending || view.evening.stance === 'leaving') reason = 'Return to your seat in the evening first.';
  else if (!care?.kitchen.held) reason = 'Dinner is already moving along.';
  else if (care.presence !== 'at-table') reason = 'Give your date time to return.';
  else if (view.evening.scenario?.phase === 'active' || view.evening.incident) reason = 'Finish the moment at the table first.';
  return { enabled: !reason, ...(reason ? { reason } : {}) };
}
/** Directors retain their scheduling thresholds; this validates physical eligibility. */
export function scenarioCanStart(view: DinnerState) {
  const e = view.evening, scenario = e.scenario;
  return !!scenario && scenario.phase === 'dormant' && scenePresenceAvailable(view) && view.seated && !e.bill.requested && !e.incident && (scenario.id === 'feeling-unwell' ? e.main.status === 'waiting' || e.main.status === 'served' && e.main.bites < 3 : ['served', 'finished'].includes(e.main.status));
}
export function scenarioMayOpen(view: DinnerState) {
  if (!scenarioCanStart(view)) return false;
  if (view.evening.scenario!.id === 'feeling-unwell') return view.evening.main.status === 'waiting' ? view.elapsed - (view.evening.main.orderedAt ?? 0) >= 12 : view.elapsed >= 90 || view.evening.dialogueTurns >= 2;
  return view.elapsed >= 240 || view.evening.dialogueTurns >= 4;
}
export function buildDinnerBill(view: DinnerState): { items: DinnerBillItem[]; totalCents: number } {
  const e = view.evening, items: DinnerBillItem[] = [];
  const add = (id: string, label: string, quantity: number, unitPriceCents: number, status: DinnerBillItem['status'], owner: DinnerBillItem['owner']) => {
    items.push({ id, label, quantity, unitPriceCents, status, chargedCents: ['pending', 'cancelled'].includes(status) ? 0 : quantity * unitPriceCents, owner });
  };
  const mainStatus = ['served', 'finished'].includes(e.main.status) ? 'served' : 'pending';
  if (view.order) {
    const served = mainStatus === 'served' ? e.main.servedDish ?? view.order : view.order;
    const label = served !== view.order ? `${served} (replacement, original price)` : served;
    add('main-you', label, 1, DINNER_PRICES_CENTS[view.order] ?? 1800, mainStatus, 'you');
  }
  if (e.main.dateDish) add('main-date', e.main.dateDish, 1, DINNER_PRICES_CENTS[e.main.dateDish] ?? 1800, mainStatus, 'date');
  for (const item of e.scenarioCare?.extraOrder.items ?? []) add(item.id, item.dish, item.quantity, item.unitPriceCents, item.status, 'date');
  if (e.dessert.choice && ['waiting', 'served', 'finished'].includes(e.dessert.status)) add('dessert-shared', DESSERTS.find(dessert => dessert.id === e.dessert.choice)?.name ?? 'Shared dessert', 1, DESSERT_PRICES_CENTS[e.dessert.choice] ?? 900, e.dessert.status === 'waiting' ? 'pending' : 'served', 'you');
  return { items, totalCents: items.reduce((total, item) => total + item.chargedCents, 0) };
}
