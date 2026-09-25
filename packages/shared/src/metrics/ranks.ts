import { dayIndex, tripLengthDays } from '../tripDays.js';
import type { TripMeta } from './types.js';

export interface RankBand {
  min: number;
  name: string;
}

export function elapsedTripDays(trip: TripMeta, snapshotAt: number): number {
  return Math.max(1, dayIndex(snapshotAt, trip.startDate, trip.timezone));
}

export function rankDays(trip: TripMeta, snapshotAt: number): number {
  return Math.min(tripLengthDays(trip.startDate, trip.endDate), elapsedTripDays(trip, snapshotAt));
}

export function stdPerDay(totalStd: number, days: number): number {
  return totalStd / Math.max(days, 1);
}

export function rankFor(stdPerDayValue: number, bands: readonly RankBand[]): number {
  let result = 0;
  for (let index = 0; index < bands.length; index += 1) {
    if (stdPerDayValue < bands[index]!.min) break;
    result = index;
  }
  return result;
}
