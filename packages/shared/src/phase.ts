const FINAL_24H_DURATION_MS = 24 * 3600_000;

export type TripPhase = 'live' | 'final_24h' | 'wrapped_unlocked' | 'ceremony';

export function computePhase(
  trip: { unlockAt: number; ceremonyStartedAt: number | null },
  nowMs: number,
): TripPhase {
  if (trip.ceremonyStartedAt !== null) return 'ceremony';
  if (nowMs >= trip.unlockAt) return 'wrapped_unlocked';
  if (nowMs >= trip.unlockAt - FINAL_24H_DURATION_MS) return 'final_24h';
  return 'live';
}

export type PhaseTransition = 'final_24h' | 'wrapped_unlocked';

export function pendingTransitions(
  trip: {
    unlockAt: number;
    final24hMarkedAt: number | null;
    wrappedUnlockedMarkedAt: number | null;
  },
  nowMs: number,
): PhaseTransition[] {
  const transitions: PhaseTransition[] = [];

  if (nowMs >= trip.unlockAt - FINAL_24H_DURATION_MS && trip.final24hMarkedAt === null) {
    transitions.push('final_24h');
  }
  if (nowMs >= trip.unlockAt && trip.wrappedUnlockedMarkedAt === null) {
    transitions.push('wrapped_unlocked');
  }

  return transitions;
}
