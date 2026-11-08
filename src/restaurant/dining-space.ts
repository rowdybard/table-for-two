import type { DinnerState } from './types';

/** The spare dining area is clear of the occupied side tables and the noisy diner. */
export const QUIET_TABLE_OFFSET_Z = 3.85;
export const diningOffsetZ = (state: DinnerState) => state.evening.scenarioCare?.table === 'quiet' ? QUIET_TABLE_OFFSET_Z : 0;
