import type { DateId, EveningState } from './types';

export const DESSERTS = [
  { id: 'lemon', name: 'Lemon posset', description: 'Sharp lemon cream, shortbread, and two spoons.' },
  { id: 'chocolate', name: 'Chocolate fondant', description: 'A warm middle, vanilla cream, and an excellent excuse to share.' },
  { id: 'berries', name: 'Strawberries & cream', description: 'Fresh berries, soft cream, and nothing to hide behind.' },
] as const;
export function createEvening(dateId: DateId, variation = 0): EveningState {
  return { care: { tasteOffer: null, toast: null, water: { status: 'none', requestedAt: null }, checkIn: null, romanceClosed: false, quietUntil: 0 }, lastInterruptionAt: -1000, chapter: 'welcome', variation, dialogueTurns: 0, stance: 'curious', stanceReason: 'You have only just met.',
    main: { status: 'none', bites: 0, dateDish: null, servedDish: null }, dessert: { choice: null, status: 'none', portions: [] },
    incident: null, resolutions: {}, coasters: { phase: 'idle', turn: 'human', round: 1, humanScore: 0, dateScore: 0, shots: 0, disc: { x: 0, z: .43 }, target: { x: 0, z: -.30 }, lastResult: '' },
    napkin: { points: [], complete: false }, sharedActivities: [], moments: [], cues: [],
    bill: { requested: false, settlement: null }, farewell: { choice: null, ending: null } };
}
export function eveningObjective(state: import('./types').DinnerState): string {
  const e = state.evening;
  if (e.incident?.event === 'wrong-order') return 'That plate doesn’t match the order. Check the ticket, then decide what to do.';
  if (e.incident?.event === 'spilled-drink') return e.incident.progress < 3 ? 'A little water, a little teamwork. Use a napkin to wipe the table.' : 'The table is dry. Set the glass upright.';
  if (e.incident?.event === 'disruptive-diner') return 'The next table is getting loud. Ask for a little quiet, or let it pass.';
  if (e.chapter === 'farewell') return 'Stand up and walk to the entrance together. There’s one last thing to say.';
  if (e.chapter === 'bill') return 'The evening is winding down. Settle the bill when you’re ready.';
  if (!state.seated) return 'Walk to your chair, look at it, and take your seat.';
  if (!state.order) return 'Open Actions for the dinner menu. You can talk or type whenever you like.';
  if (e.main.status === 'waiting') return 'Dinner is on its way. Try a little table game, or enjoy the conversation.';
  if (e.main.status === 'served') return 'Try your dinner. There’s time to talk, play, and linger.';
  if (e.dessert.status === 'none') return 'Something sweet? Choose dessert together, or move on to the bill.';
  if (e.dessert.status === 'waiting') return 'Dessert is on its way. Stay a little longer.';
  if (e.dessert.status === 'served') return 'Share dessert across your two plates, then enjoy the last of the evening.';
  return 'Enjoy this moment. You can ask for the bill whenever you’re ready.';
}
