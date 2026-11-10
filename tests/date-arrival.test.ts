import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateArrival } from '../src/restaurant/DateArrival';
import { RESTAURANT } from '../src/restaurant/content';
import type { DoubleDateRoomState } from '../src/restaurant/double-date-types';
import type { DinnerState } from '../src/restaurant/types';

const solo = (distance: number, seated = true) => ({ mode: 'ai-date', dateId: 'mira', seated, participants: [{ kind: 'ai', position: [RESTAURANT.dateSeat[0], 0, RESTAURANT.dateSeat[2] + distance] }] }) as DinnerState;
const shared = { mode: 'double-date', dateId: 'mira' } as DinnerState;
function room() {
  return {
    dates: [
      { id: 'd1', humanId: 'h1', dateId: 'mira', seated: true, stance: 'curious' },
      { id: 'd2', humanId: 'h2', dateId: 'jules', seated: false, stance: 'curious' },
    ],
    members: [{ id: 'h1', name: 'Alex', connected: true, seated: true }, { id: 'h2', name: 'Jamie', connected: true, seated: true }],
    views: { h1: { phase: 'playing' }, h2: { phase: 'playing' } },
  } as unknown as DoubleDateRoomState;
}

test('Solo waits for the actual seat position, not the initial seated player state', () => {
  assert.deepEqual(dateArrival(solo(1)), { ready: false, waiting: ['Mira'] });
  assert.deepEqual(dateArrival(solo(.151)), { ready: false, waiting: ['Mira'] });
  assert.deepEqual(dateArrival(solo(.14)), { ready: true, waiting: [] });
  assert.equal(dateArrival(solo(0, false)).ready, false);
});

test('Double gates the addressed active date or all active dates at the table', () => {
  const state = room();
  assert.deepEqual(dateArrival(shared, state, 'table'), { ready: false, waiting: ['Jules'] });
  assert.equal(dateArrival(shared, state, 'd1').ready, true);
  assert.equal(dateArrival(shared, state, 'd2').ready, false);
  assert.equal(dateArrival(shared, state, 'h2').ready, false, 'a friend-addressed turn can still generate date speech, so dates must have arrived');
  state.dates[1].seated = true; assert.equal(dateArrival(shared, state, 'table').ready, true);
  state.dates[1].seated = false; state.views.h2.phase = 'ended';
  assert.equal(dateArrival(shared, state, 'table').ready, true, 'a departed pair cannot block the remaining date');
  assert.equal(dateArrival(shared, undefined, 'table').ready, false);
});
