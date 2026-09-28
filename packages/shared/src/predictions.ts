export type PredictionWindowState = 'open' | 'locked' | 'missed';

export interface PredictionWindowMember {
  firstDrinkAt: number | null;
  predictionsLockedAt: number | null;
}

export interface PredictionWindowTrip {
  /** Trip begin instant: `start_date` 00:00 in the trip's timezone, epoch ms (see `tripStartMs`). */
  startAtMs: number;
  ceremonyStartedAt: number | null;
}

export function computePredictionWindow(
  member: PredictionWindowMember,
  trip: PredictionWindowTrip,
  nowMs: number,
): PredictionWindowState {
  if (member.predictionsLockedAt !== null) return 'locked';
  if (trip.ceremonyStartedAt !== null && nowMs >= trip.ceremonyStartedAt) return 'missed';

  const closesAt = Math.min(member.firstDrinkAt ?? Number.POSITIVE_INFINITY, trip.startAtMs);
  return nowMs < closesAt ? 'open' : 'missed';
}

export function predictionDefaults(
  tripLengthDays: number,
  memberCount: number,
): { q1: number; q2: number } {
  // Litres (liquid volume), whole numbers: about 2 L a person a day.
  const q1 = 2 * tripLengthDays;
  return { q1, q2: q1 * memberCount };
}
