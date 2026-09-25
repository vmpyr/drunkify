import { DRINK_CATEGORIES } from './types.js';
import type { DerivedDrink, DrinkCategory } from './types.js';

export interface DayBucket {
  tripDay: number;
  drinkCount: number;
  stdDrinks: number;
}

export interface CategoryBucket {
  category: DrinkCategory;
  drinkCount: number;
  stdDrinks: number;
  sharePct: number;
}

export interface HourBucket {
  hour: number;
  drinkCount: number;
  stdDrinks: number;
}

export interface PlaceBucket {
  key: string;
  label: string;
  drinkCount: number;
  stdDrinks: number;
}

export interface DrinkAgg {
  drinkKey: string;
  label: string;
  category: DrinkCategory;
  drinkCount: number;
  stdDrinks: number;
}

function sortPlaces(left: PlaceBucket, right: PlaceBucket): number {
  return (
    right.drinkCount - left.drinkCount ||
    right.stdDrinks - left.stdDrinks ||
    left.label.localeCompare(right.label)
  );
}

export function byDay(drinks: readonly DerivedDrink[]): DayBucket[] {
  const buckets = new Map<number, DayBucket>();
  for (const drink of drinks) {
    const bucket = buckets.get(drink.tripDay) ?? {
      tripDay: drink.tripDay,
      drinkCount: 0,
      stdDrinks: 0,
    };
    bucket.drinkCount += drink.qty;
    bucket.stdDrinks += drink.stdDrinks;
    buckets.set(drink.tripDay, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.tripDay - right.tripDay);
}

export function peakDay(days: readonly DayBucket[]): DayBucket {
  if (days.length === 0) throw new Error('peakDay requires at least one day');
  return [...days].sort(
    (left, right) => right.stdDrinks - left.stdDrinks || left.tripDay - right.tripDay,
  )[0]!;
}

export function quietestDay(days: readonly DayBucket[]): DayBucket {
  if (days.length === 0) throw new Error('quietestDay requires at least one day');
  return [...days].sort(
    (left, right) => left.stdDrinks - right.stdDrinks || left.tripDay - right.tripDay,
  )[0]!;
}

export function byCategory(drinks: readonly DerivedDrink[]): CategoryBucket[] {
  const total = drinks.reduce((sum, drink) => sum + drink.qty, 0);
  const buckets = new Map<DrinkCategory, CategoryBucket>();
  for (const drink of drinks) {
    const bucket = buckets.get(drink.category) ?? {
      category: drink.category,
      drinkCount: 0,
      stdDrinks: 0,
      sharePct: 0,
    };
    bucket.drinkCount += drink.qty;
    bucket.stdDrinks += drink.stdDrinks;
    buckets.set(drink.category, bucket);
  }
  return DRINK_CATEGORIES.filter((category) => buckets.has(category)).map((category) => {
    const bucket = buckets.get(category)!;
    return {
      ...bucket,
      sharePct: total === 0 ? 0 : (bucket.drinkCount / total) * 100,
    };
  });
}

export function categoryMix(
  drinks: readonly DerivedDrink[],
): Array<{ category: DrinkCategory; sharePct: number }> {
  return byCategory(drinks).map(({ category, sharePct }) => ({ category, sharePct }));
}

export function byHour(drinks: readonly DerivedDrink[]): HourBucket[] {
  const result = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    drinkCount: 0,
    stdDrinks: 0,
  }));
  for (const drink of drinks) {
    const bucket = result[drink.localHour]!;
    bucket.drinkCount += drink.qty;
    bucket.stdDrinks += drink.stdDrinks;
  }
  return result;
}

function byPlace(
  drinks: readonly DerivedDrink[],
  value: (drink: DerivedDrink) => { key: string; label: string } | null,
): PlaceBucket[] {
  const buckets = new Map<string, PlaceBucket>();
  for (const drink of drinks) {
    const place = value(drink);
    if (place === null) continue;
    const bucket = buckets.get(place.key) ?? {
      ...place,
      drinkCount: 0,
      stdDrinks: 0,
    };
    bucket.drinkCount += drink.qty;
    bucket.stdDrinks += drink.stdDrinks;
    buckets.set(place.key, bucket);
  }
  return [...buckets.values()].sort(sortPlaces);
}

export function byCity(drinks: readonly DerivedDrink[]): PlaceBucket[] {
  return byPlace(drinks, (drink) =>
    drink.city === null ? null : { key: drink.city.toLowerCase(), label: drink.city },
  );
}

export function byCountry(drinks: readonly DerivedDrink[]): PlaceBucket[] {
  return byPlace(drinks, (drink) =>
    drink.countryCode === null ? null : { key: drink.countryCode, label: drink.countryCode },
  );
}

export function byVenue(drinks: readonly DerivedDrink[]): PlaceBucket[] {
  return byPlace(drinks, (drink) => {
    const key = drink.venueId ?? drink.venueName;
    if (key === null) return null;
    return { key, label: drink.venueName ?? key };
  });
}

export function topDrinks(drinks: readonly DerivedDrink[], n: number): DrinkAgg[] {
  const buckets = new Map<string, DrinkAgg>();
  for (const drink of drinks) {
    const bucket = buckets.get(drink.drinkKey) ?? {
      drinkKey: drink.drinkKey,
      label: drink.drinkName.trim().replace(/\s+/g, ' '),
      category: drink.category,
      drinkCount: 0,
      stdDrinks: 0,
    };
    bucket.drinkCount += drink.qty;
    bucket.stdDrinks += drink.stdDrinks;
    buckets.set(drink.drinkKey, bucket);
  }
  return [...buckets.values()]
    .sort(
      (left, right) =>
        right.drinkCount - left.drinkCount ||
        right.stdDrinks - left.stdDrinks ||
        left.label.localeCompare(right.label),
    )
    .slice(0, Math.max(0, n));
}

export function memberVisitCount(drinks: readonly DerivedDrink[]): Map<string, number> {
  const visits = new Map<string, Set<string>>();
  for (const drink of drinks) {
    if (drink.venueId === null || drink.visitKey === null) continue;
    const venueVisits = visits.get(drink.venueId) ?? new Set<string>();
    venueVisits.add(drink.visitKey);
    visits.set(drink.venueId, venueVisits);
  }
  return new Map([...visits].map(([venueId, keys]) => [venueId, keys.size]));
}
