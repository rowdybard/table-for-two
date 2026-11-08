import { createTabletopState, tabletopActionAvailability, TABLETOP_ACTIONS, type TabletopAction } from '../../src/restaurant/tabletop';
import type { DinnerState } from '../../src/restaurant/types';

/** Tactile state only: no points, authored dialogue, memories or model requests. */
export class TabletopDirector {
  private lowerGlassAt: number | null = null;
  private seasonedDish: string | null;
  constructor(private readonly dinner: DinnerState) { dinner.evening.tabletop ??= createTabletopState(); this.seasonedDish = dinner.evening.main.servedDish; }
  private syncMeal() {
    if (this.seasonedDish === this.dinner.evening.main.servedDish) return;
    this.seasonedDish = this.dinner.evening.main.servedDish;
    this.dinner.evening.tabletop!.salt = this.dinner.evening.tabletop!.pepper = false;
  }
  action(action: TabletopAction) {
    if (!(TABLETOP_ACTIONS as readonly string[]).includes(action)) throw new Error('Unknown table action.');
    const table = this.dinner.evening.tabletop!;
    const newDish = this.seasonedDish !== this.dinner.evening.main.servedDish;
    const availability = tabletopActionAvailability(newDish ? { ...this.dinner, evening: { ...this.dinner.evening, tabletop: { ...table, salt: false, pepper: false } } } : this.dinner, action);
    if (!availability.enabled) throw new Error(availability.reason);
    this.syncMeal();
    if (action === 'sip-water') {
      table.glassFill--; this.dinner.glassRaised = true; this.lowerGlassAt = this.dinner.elapsed + 1.2;
    } else if (action === 'pour-water') {
      const amount = Math.min(4 - table.glassFill, table.shared.carafeFill);
      table.glassFill += amount; table.shared.carafeFill -= amount;
    } else if (action === 'take-bread') { table.shared.breadRemaining--; table.breadEaten++; }
    else if (action === 'salt-meal') table.salt = true;
    else if (action === 'pepper-meal') table.pepper = true;
    else if (action === 'arrange-cutlery') table.cutleryCrossed = !table.cutleryCrossed;
    else if (action === 'fold-napkin') table.napkinFolded = !table.napkinFolded;
    else if (action === 'dim-lamp') table.shared.lampLevel = ((table.shared.lampLevel + 2) % 3) as 0 | 1 | 2;
    else if (action === 'turn-vase') table.shared.vaseTurn = (table.shared.vaseTurn + 1) % 12;
    else if (action === 'turn-plate') table.plateTurn = (table.plateTurn + 1) % 12;
    table.lastAction = { sequence: (table.lastAction?.sequence ?? 0) + 1, action, at: this.dinner.elapsed };
  }
  step() {
    this.syncMeal();
    if (this.lowerGlassAt !== null && (!this.dinner.seated || this.dinner.elapsed >= this.lowerGlassAt || this.dinner.evening.stance === 'leaving')) {
      this.dinner.glassRaised = false; this.lowerGlassAt = null;
    }
  }
  cancelSip() { this.lowerGlassAt = null; }
  unfoldNapkin() { this.dinner.evening.tabletop!.napkinFolded = false; }
  restockWater() { const table = this.dinner.evening.tabletop!; table.glassFill = 4; table.shared.carafeFill = 6; }
}

/** Keep flowers, lamps and other fidgets out of the model's conversation focus. */
export function tabletopConversationContext(dinner: DinnerState) {
  const table = dinner.evening.tabletop;
  if (!table || (table.glassFill === 4 && !table.breadEaten && !table.salt && !table.pepper)) return undefined;
  return { ownWater: table.glassFill ? 'has water' : 'glass empty', breadPiecesEaten: table.breadEaten, ownMealSeasoned: [table.salt && 'salt', table.pepper && 'pepper'].filter(Boolean), instruction: 'Background food and drink facts only. Mention them only if directly relevant to what the player says; do not turn routine table use into a conversation topic.' };
}
