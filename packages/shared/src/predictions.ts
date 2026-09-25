const DAY_MS = 24 * 3600_000;

export type PredictionWindowState = 'open' | 'locked' | 'missed';

export interface PredictionWindowMember {
  joinedAt: number;
  firstDrinkAt: number | null;
  predictionsLockedAt: number | null;
}

export interface PredictionWindowTrip {
  createdAt: number;
  ceremonyStartedAt: number | null;
}

export function computePredictionWindow(
  member: PredictionWindowMember,
  trip: PredictionWindowTrip,
  nowMs: number,
): PredictionWindowState {
  if (member.predictionsLockedAt !== null) return 'locked';
  if (trip.ceremonyStartedAt !== null && nowMs >= trip.ceremonyStartedAt) return 'missed';

  const openedAt = Math.max(trip.createdAt, member.joinedAt);
  const closesAt = Math.min(member.firstDrinkAt ?? Number.POSITIVE_INFINITY, openedAt + DAY_MS);
  return nowMs < closesAt ? 'open' : 'missed';
}

export function predictionDefaults(
  tripLengthDays: number,
  memberCount: number,
): { q1: number; q2: number } {
  const q1 = 5 * tripLengthDays;
  return { q1, q2: q1 * memberCount };
}
