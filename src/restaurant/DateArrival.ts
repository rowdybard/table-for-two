import { getDate, RESTAURANT } from './content';
import type { ConversationTarget, DoubleDateRoomState } from './double-date-types';
import type { DinnerState } from './types';

export interface DateArrival { ready: boolean; waiting: string[] }

/** Only server-observed seats make a date available for conversation. */
export function dateArrival(state: DinnerState, room?: DoubleDateRoomState, target: ConversationTarget = 'table'): DateArrival {
  if (state.mode !== 'double-date') {
    const date = state.participants.find(person => person.kind === 'ai');
    const atSeat = !!date && state.seated && Math.hypot(date.position[0] - RESTAURANT.dateSeat[0], date.position[2] - RESTAURANT.dateSeat[2]) <= .15;
    return { ready: atSeat, waiting: atSeat ? [] : [getDate(state.dateId)?.name ?? 'Your date'] };
  }
  if (!room) return { ready: false, waiting: ['Your date'] };
  const available = room.dates.filter(date => !date.departed && date.stance !== 'leaving' && room.views[date.humanId]?.phase !== 'ended');
  const addressed = target === 'table' || target === 'h1' || target === 'h2' ? available : available.filter(date => date.id === target);
  if (!addressed.length) return { ready: false, waiting: ['Your date'] };
  const waiting = addressed.filter(date => !date.seated).map(date => getDate(date.dateId)?.name ?? 'Your date');
  return { ready: waiting.length === 0, waiting };
}
