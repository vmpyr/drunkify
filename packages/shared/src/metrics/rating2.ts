import type { DerivedDrink } from './types.js';

export interface RatingInputs {
  kPerDay: number;
  aPerDay: number;
  dPerDay: number;
  unique: number;
}

function zScore(value: number, values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return stddev < 1e-9 ? 0 : (value - mean) / stddev;
}

export function drinkRating2(member: RatingInputs, group: readonly RatingInputs[]): number {
  const score =
    1 +
    0.5 *
      zScore(
        member.kPerDay,
        group.map((row) => row.kPerDay),
      ) +
    0.3 *
      zScore(
        member.aPerDay,
        group.map((row) => row.aPerDay),
      ) -
    0.2 *
      zScore(
        member.dPerDay,
        group.map((row) => row.dPerDay),
      ) +
    0.1 *
      zScore(
        member.unique,
        group.map((row) => row.unique),
      );
  return Math.round(Math.min(3, Math.max(0, score)) * 100) / 100;
}

export function cheersCount(
  memberDrinks: readonly DerivedDrink[],
  allDrinks: readonly DerivedDrink[],
  windowMs = 60_000,
): number {
  return memberDrinks.reduce((sum, drink) => {
    const hasCompany = allDrinks.some(
      (other) =>
        other.userId !== drink.userId && Math.abs(other.drunkAt - drink.drunkAt) <= windowMs,
    );
    return sum + (hasCompany ? drink.qty : 0);
  }, 0);
}
