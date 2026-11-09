import type { DinnerState } from '../../src/restaurant/types';

const logs = new WeakMap<object, string[]>();

/**
 * Facts the server itself establishes at the table (a toast, a taste, a scenario choice).
 * They live apart from `DinnerState.memory`, which the model rewrites every turn, so a model
 * reply can never erase them. The newest twelve are kept and shown to the date each turn.
 */
export function noteTableFact(view: DinnerState, fact: string) {
  const text = fact.trim().slice(0, 170), log = logs.get(view) ?? [];
  if (!text || log.includes(text)) return;
  log.push(text);
  if (log.length > 12) log.splice(0, log.length - 12);
  logs.set(view, log);
}

export const tableFacts = (view: DinnerState): readonly string[] => logs.get(view) ?? [];
