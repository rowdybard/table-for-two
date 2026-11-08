import type { DinnerState } from './types';

export const TABLETOP_ACTIONS = ['sip-water', 'pour-water', 'take-bread', 'salt-meal', 'pepper-meal', 'arrange-cutlery', 'fold-napkin', 'dim-lamp', 'turn-vase', 'turn-plate'] as const;
export type TabletopAction = typeof TABLETOP_ACTIONS[number];
export interface SharedTabletopState {
  carafeFill: number;
  breadRemaining: number;
  lampLevel: 0 | 1 | 2;
  vaseTurn: number;
}
export interface TabletopState {
  glassFill: number;
  breadEaten: number;
  salt: boolean;
  pepper: boolean;
  cutleryCrossed: boolean;
  napkinFolded: boolean;
  plateTurn: number;
  shared: SharedTabletopState;
  /** Scene seconds, with a per-place-setting sequence for animation edges. */
  lastAction: { sequence: number; action: TabletopAction; at: number } | null;
}
export const createSharedTabletopState = (): SharedTabletopState => ({ carafeFill: 6, breadRemaining: 4, lampLevel: 2, vaseTurn: 0 });
export const createTabletopState = (shared = createSharedTabletopState()): TabletopState => ({ glassFill: 4, breadEaten: 0, salt: false, pepper: false, cutleryCrossed: false, napkinFolded: false, plateTurn: 0, shared, lastAction: null });
/** Defaults keep older recordings and fixtures readable without mutating them. */
export function tabletopSnapshot(state?: TabletopState): TabletopState {
  const value = state ?? createTabletopState();
  return { ...value, shared: { ...value.shared }, lastAction: value.lastAction ? { ...value.lastAction } : null };
}
export function tableActionForTarget(target: string): TabletopAction | null {
  return ({ glass: 'sip-water', carafe: 'pour-water', bread: 'take-bread', salt: 'salt-meal', pepper: 'pepper-meal', cutlery: 'arrange-cutlery', napkin: 'fold-napkin', lamp: 'dim-lamp', vase: 'turn-vase', plate: 'turn-plate' } as Record<string, TabletopAction>)[target] ?? null;
}
export interface TabletopActionAvailability { enabled: boolean; label: string; reason?: string }
export function tabletopActionAvailability(dinner: DinnerState, action: TabletopAction): TabletopActionAvailability {
  const table = dinner.evening.tabletop ?? createTabletopState();
  const labels: Record<TabletopAction, string> = {
    'sip-water': 'Take a sip', 'pour-water': 'Pour some water', 'take-bread': 'Take a piece', 'salt-meal': 'Add a little salt', 'pepper-meal': 'Grind some pepper',
    'arrange-cutlery': table.cutleryCrossed ? 'Set the cutlery straight' : 'Rest the cutlery across your plate', 'fold-napkin': table.napkinFolded ? 'Unfold your napkin' : 'Fold your napkin',
    'dim-lamp': table.shared.lampLevel === 2 ? 'Lower the light' : table.shared.lampLevel === 1 ? 'Turn the light off' : 'Turn the light on', 'turn-vase': 'Turn the flowers', 'turn-plate': 'Turn your plate',
  };
  let reason: string | undefined;
  if (dinner.phase !== 'playing') reason = 'Resume the evening first.';
  else if (dinner.doubleDate && dinner.doubleDate.role !== 'dating') reason = 'Your own date is complete. Keep your friend company.';
  else if (!dinner.seated) reason = 'Take your seat first.';
  else if (dinner.stage === 'farewell' || dinner.stage === 'finished' || dinner.evening.stance === 'leaving' || dinner.evening.farewell.ending) reason = 'It is time to say goodbye.';
  else if (dinner.evening.scenario?.phase === 'active' || dinner.doubleDate?.scenario?.phase === 'active') reason = 'Respond to the moment at the table first.';
  else if (dinner.evening.incident || dinner.doubleDate?.otherView?.evening.incident) reason = 'Deal with the interruption first.';
  else if (action === 'sip-water' && table.glassFill <= 0) reason = 'Your glass is empty. Pour some water.';
  else if (action === 'pour-water' && table.glassFill >= 4) reason = 'Your glass is already full.';
  else if (action === 'pour-water' && table.shared.carafeFill <= 0) reason = 'The carafe is empty. Ask Eli for fresh water.';
  else if (action === 'take-bread' && table.shared.breadRemaining <= 0) reason = 'The bread has all been eaten.';
  else if (action === 'salt-meal' || action === 'pepper-meal') {
    if (dinner.evening.main.status !== 'served' || !dinner.evening.main.servedDish || dinner.evening.main.bites >= 3) reason = 'Season your own meal while it is being served.';
    else if (action === 'salt-meal' ? table.salt : table.pepper) reason = action === 'salt-meal' ? 'You have already salted this meal.' : 'You have already added pepper.';
  }
  return { enabled: !reason, label: labels[action], ...(reason ? { reason } : {}) };
}
