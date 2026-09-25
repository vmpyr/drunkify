import type { DerivedDrink } from './types.js';

export interface RatingAgg {
  drinkKey: string;
  label: string;
  avg: number;
  raterCount: number;
  stddev: number;
}

function rollup(drinks: readonly DerivedDrink[], distinctRaters: boolean): RatingAgg[] {
  const buckets = new Map<string, { label: string; values: number[]; users: Set<string> }>();
  for (const drink of drinks) {
    if (drink.rating === null) continue;
    const bucket = buckets.get(drink.drinkKey) ?? {
      label: drink.drinkName.trim().replace(/\s+/g, ' '),
      values: [],
      users: new Set<string>(),
    };
    bucket.values.push(drink.rating);
    bucket.users.add(drink.userId);
    buckets.set(drink.drinkKey, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const avg = bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length;
      const variance =
        bucket.values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / bucket.values.length;
      return {
        drinkKey: key,
        label: bucket.label,
        avg,
        raterCount: distinctRaters ? bucket.users.size : bucket.values.length,
        stddev: Math.sqrt(variance),
      };
    })
    .sort((left, right) => left.drinkKey.localeCompare(right.drinkKey));
}

export function personalRatingRollup(drinks: readonly DerivedDrink[], userId: string): RatingAgg[] {
  return rollup(
    drinks.filter((drink) => drink.userId === userId),
    false,
  );
}

export function groupRatingRollup(drinks: readonly DerivedDrink[]): RatingAgg[] {
  return rollup(drinks, true);
}

export function topRated(rollupRows: readonly RatingAgg[]): RatingAgg | null {
  return (
    [...rollupRows].sort(
      (left, right) =>
        right.avg - left.avg ||
        right.raterCount - left.raterCount ||
        left.drinkKey.localeCompare(right.drinkKey),
    )[0] ?? null
  );
}

export function guiltyPleasure(
  rollupRows: readonly RatingAgg[],
  drinks: readonly DerivedDrink[],
  userId: string,
): RatingAgg | null {
  const orders = new Map<string, number>();
  for (const drink of drinks) {
    if (drink.userId !== userId) continue;
    orders.set(drink.drinkKey, (orders.get(drink.drinkKey) ?? 0) + drink.qty);
  }
  return (
    rollupRows
      .filter((row) => row.avg <= 2 && (orders.get(row.drinkKey) ?? 0) >= 3)
      .sort(
        (left, right) =>
          left.avg - right.avg ||
          (orders.get(right.drinkKey) ?? 0) - (orders.get(left.drinkKey) ?? 0) ||
          left.drinkKey.localeCompare(right.drinkKey),
      )[0] ?? null
  );
}

export function crowdFavourite(rollupRows: readonly RatingAgg[]): RatingAgg | null {
  return (
    rollupRows
      .filter((row) => row.raterCount >= 3)
      .sort(
        (left, right) =>
          right.avg - left.avg ||
          right.raterCount - left.raterCount ||
          left.drinkKey.localeCompare(right.drinkKey),
      )[0] ?? null
  );
}

export function mostDivisive(rollupRows: readonly RatingAgg[]): RatingAgg | null {
  return (
    rollupRows
      .filter((row) => row.raterCount >= 2)
      .sort(
        (left, right) =>
          right.stddev - left.stddev ||
          right.raterCount - left.raterCount ||
          left.drinkKey.localeCompare(right.drinkKey),
      )[0] ?? null
  );
}
