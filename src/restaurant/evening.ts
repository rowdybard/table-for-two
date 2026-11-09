import type { DateId, EveningState } from './types';

export const DESSERTS = [
  { id: 'lemon', name: 'Lemon posset', description: 'Sharp lemon cream, shortbread, and two spoons.' },
  { id: 'chocolate', name: 'Chocolate fondant', description: 'A warm middle, vanilla cream, and an excellent excuse to share.' },
  { id: 'berries', name: 'Strawberries & cream', description: 'Fresh berries, soft cream, and nothing to hide behind.' },
] as const;
export type DessertId = typeof DESSERTS[number]['id'];

/**
 * Scene-second pacing for an evening that carries itself. The waiter serves and clears on
 * these clocks; the player eats, talks and chooses, but never has to push dinner along.
 */
export const EVENING_PACE = Object.freeze({
  /** Eli comes over once a seated guest has looked at nothing for this long. */
  orderNudge: 40,
  /** Kitchen time for a main course after the order goes in. */
  mainKitchen: 45,
  /** The main course runs this long before Eli clears the plates… */
  mainCourse: 200,
  /** …or this long after the player rests the cutlery across the plate… */
  mainAfterCutleryRested: 60,
  /** …or this long after the player has eaten three bites. */
  mainAfterEating: 90,
  /** How long the dessert offer stays open before the date suggests their favourite. */
  dessertDecision: 40,
  /** Kitchen time for dessert. */
  dessertKitchen: 20,
  /** The dessert talk beat follows the first spoonful or this much shared time. */
  dessertTalk: 25,
  /** Dessert finishes itself after this long… */
  dessertCourse: 75,
  /** …or this long after two spoonfuls. */
  dessertAfterEating: 40,
  /** Eli brings the check this long after dessert ends or is declined. */
  checkDelay: 12,
  /** Silence before the date offers an authored line, and the gap between two such lines. */
  beatSilence: 50,
  /** Waiting for the food is the one stretch shorter than the kitchen's 45 seconds, so its silence is shorter too. */
  beatSilenceWaiting: 30,
  beatSpacing: 80,
  beatsPerEvening: 4,
  /** Physical incidents belong to a course rather than to wall-clock minutes: the spill to the main (any calm moment before dessert arrives), the loud neighbour to dessert. */
  spillAfterService: 60,
  dinerAfterDessertServed: 30,
});

export function createEvening(dateId: DateId, variation = 0): EveningState {
  return { care: { tasteOffer: null, toast: null, water: { status: 'none', requestedAt: null }, checkIn: null, romanceClosed: false, quietUntil: 0 }, lastInterruptionAt: -1000, chapter: 'welcome', variation, dialogueTurns: 0, stance: 'curious', stanceReason: 'You have only just met.',
    main: { status: 'none', bites: 0, dateDish: null, servedDish: null }, dessert: { choice: null, status: 'none', bites: 0, chosenBy: null }, beats: 0,
    incident: null, resolutions: {}, sharedActivities: [], moments: [], cues: [],
    bill: { requested: false, settlement: null }, farewell: { choice: null, ending: null } };
}
