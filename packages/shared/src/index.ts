import { z } from 'zod';

export { computePhase, pendingTransitions } from './phase.js';
export type { PhaseTransition, TripPhase } from './phase.js';
export { rankMembers } from './rank.js';
export type { MemberRankInput, RankedMember } from './rank.js';
export { dayIndex, dayLabel, tripLengthDays } from './tripDays.js';

export {
  abvToPos,
  clampAbv,
  ethanolGrams,
  formatAbv,
  formatEthanolGrams,
  formatStd,
  nudgeAbv,
  posToAbv,
  snapAbv,
  stdDrinks,
} from './units.js';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'not_ready']),
  schemaVersion: z.string(),
  uptimeSec: z.number().nonnegative(),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
