import type { M2Store, PhaseTransitionClaim } from '../db/m2Store.js';
import { type EventBus, tripChannel } from '../realtime/eventBus.js';

export const PHASE_TICK_INTERVAL_MS = 15_000;

export interface PhaseTransitionStore {
  claimPhaseTransitions(now: number): Promise<PhaseTransitionClaim[]>;
}

interface SchedulerLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export async function runPhaseTransitionPass(
  store: PhaseTransitionStore,
  bus: EventBus,
  now = Date.now(),
): Promise<PhaseTransitionClaim[]> {
  const claims = await store.claimPhaseTransitions(now);
  for (const claim of claims) {
    const channel = tripChannel(claim.tripId);
    bus.publish(channel, {
      type: 'phase.changed',
      payload: { phase: claim.phase },
    });
    if (claim.phase === 'wrapped_unlocked') {
      bus.publish(channel, { type: 'wrapped.unlocked', payload: {} });
    }
  }
  return claims;
}

export interface PhaseScheduler {
  stop(): void;
}

export async function startPhaseScheduler(options: {
  store: M2Store;
  bus: EventBus;
  logger?: SchedulerLogger;
  intervalMs?: number;
  now?: () => number;
}): Promise<PhaseScheduler> {
  const intervalMs = options.intervalMs ?? PHASE_TICK_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runPhaseTransitionPass(options.store, options.bus, now());
    } catch (error) {
      options.logger?.warn({ error }, 'Phase transition scheduler pass failed');
    } finally {
      running = false;
    }
  };

  await tick();
  const interval = setInterval(() => void tick(), intervalMs);
  interval.unref();
  return { stop: () => clearInterval(interval) };
}
