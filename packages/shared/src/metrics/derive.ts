import { dayIndex } from '../tripDays.js';
import { stdDrinks } from '../units.js';
import type { DerivedDrink, DrinkCategory, DrinkRow, TripMeta } from './types.js';

export function normalizeDrinkName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function drinkKey(category: DrinkCategory, drinkName: string): string {
  return `${category}:${normalizeDrinkName(drinkName)}`;
}

function localHour(instantMs: number, timezone: string): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(instantMs)
    .find((part) => part.type === 'hour')?.value;
  if (value === undefined) throw new Error(`Could not resolve local hour for ${timezone}`);
  return Number(value);
}

export function deriveDrink(row: DrinkRow, trip: TripMeta): DerivedDrink {
  const tripDay = dayIndex(row.drunkAt, trip.startDate, trip.timezone);
  const derivedStd = stdDrinks(row.sizeMl, row.abv, row.qty);
  return {
    ...row,
    stdDrinks: derivedStd,
    grams: derivedStd * 10,
    ethanolMl: row.sizeMl * (row.abv / 100) * row.qty,
    litres: (row.sizeMl * row.qty) / 1000,
    tripDay,
    localHour: localHour(row.drunkAt, trip.timezone),
    isAlcoholic: row.category !== 'soft',
    visitKey: row.venueId === null ? null : `${tripDay}:${row.venueId}`,
    drinkKey: drinkKey(row.category, row.drinkName),
  };
}

export function deriveDrinks(rows: readonly DrinkRow[], trip: TripMeta): DerivedDrink[] {
  return rows
    .filter((row) => row.tripId === trip.id)
    .map((row) => deriveDrink(row, trip))
    .sort((left, right) => left.drunkAt - right.drunkAt || left.id.localeCompare(right.id));
}
