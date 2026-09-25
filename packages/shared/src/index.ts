import { z } from 'zod';

export {
  ACHIEVEMENT_KEYS,
  achievementPredicates,
  evaluateAchievementPredicates,
} from './achievements.js';
export type {
  AchievementCandidate,
  AchievementDrink,
  AchievementEvaluationInput,
  AchievementKey,
  AchievementOperation,
  AchievementPredicate,
} from './achievements.js';
export { computePredictionWindow, predictionDefaults } from './predictions.js';
export type {
  PredictionWindowMember,
  PredictionWindowState,
  PredictionWindowTrip,
} from './predictions.js';

export { computePhase, pendingTransitions } from './phase.js';
export type { PhaseTransition, TripPhase } from './phase.js';
export { rankMembers } from './rank.js';
export type { MemberRankInput, RankedMember } from './rank.js';
export { dayIndex, dayLabel, tripLengthDays } from './tripDays.js';

export * from './metrics/index.js';

export {
  abvToPos,
  clampAbv,
  ethanolGrams,
  formatAbv,
  formatEthanolGrams,
  formatLitres,
  formatStd,
  litres,
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
