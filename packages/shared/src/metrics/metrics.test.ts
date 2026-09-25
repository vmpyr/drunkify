import { describe, expect, it } from 'vitest';

import { rankMembers } from '../rank.js';
import {
  buildPersonalWrapped,
  byCategory,
  byDay,
  deriveDrinks,
  drinkRating2,
  sumVolume,
  toTripMeta,
  weightedAvgAbv,
} from './index.js';
import {
  expectedHandMetrics,
  expectedZeroCardMatrix,
  handComputedInput,
  SNAPSHOT_AT,
  zeroDrinkInput,
} from './__fixtures__/personal.js';

function roundedTotals(input: typeof handComputedInput) {
  const trip = toTripMeta(input);
  const drinks = deriveDrinks(input.drinks, trip).filter((drink) => drink.userId === 'user-a');
  const totals = sumVolume(drinks);
  return {
    drinks,
    projection: {
      drinkCount: totals.drinkCount,
      ml: totals.ml,
      litres: totals.litres,
      stdDrinks: totals.stdDrinks,
      grams: totals.grams,
      ethanolLitres: Number(totals.ethanolLitres.toFixed(2)),
      weightedAvgAbv: weightedAvgAbv(drinks),
    },
  };
}

describe('M8 hand-computed golden fixture', () => {
  it('derives stable day/std fields and hand-computed totals/distributions', () => {
    const { drinks, projection } = roundedTotals(handComputedInput);

    expect(drinks[0]).toMatchObject({
      id: 'a-1',
      tripDay: 1,
      localHour: 20,
      stdDrinks: 2,
      grams: 20,
      ethanolMl: 25,
      litres: 0.5,
      visitKey: '1:venue-1',
      drinkKey: 'beer:lager',
    });
    expect(projection).toEqual(expectedHandMetrics.totals);
    expect(byDay(drinks)).toEqual(expectedHandMetrics.days);
    expect(byCategory(drinks)).toEqual(expectedHandMetrics.categories);
  });

  it('keeps ranking and Drink Rating 2.0 deterministic', () => {
    expect(
      rankMembers([
        { userId: 'user-b', value: 4, qty: 2, joinedAt: 2 },
        { userId: 'user-a', value: 4, qty: 4, joinedAt: 1 },
      ]),
    ).toEqual([
      { userId: 'user-a', value: 4, qty: 4, joinedAt: 1, rank: 1 },
      { userId: 'user-b', value: 4, qty: 2, joinedAt: 2, rank: 2 },
    ]);

    const high = { kPerDay: 2, aPerDay: 1, dPerDay: 0, unique: 3 };
    const low = { kPerDay: 0, aPerDay: 0, dPerDay: 2, unique: 1 };
    expect(drinkRating2(high, [high, low])).toBe(2.1);
    expect(drinkRating2(low, [high, low])).toBe(0);
  });

  it('builds the same complete 14-card payload on repeated calls', () => {
    const first = buildPersonalWrapped(handComputedInput, 'user-a', SNAPSHOT_AT);
    const second = buildPersonalWrapped(handComputedInput, 'user-a', SNAPSHOT_AT);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.cards).toHaveLength(14);
    expect(first.cards.map((card) => card?.id ?? null)).toEqual([
      '01_cold_open',
      '02_absurd_units',
      '03_guess_ethanol',
      '04_abv_share',
      '05_peak_day',
      '06_trail',
      '07_top_then_guilty',
      '08_loyal_or_adventurous',
      '09_absurd_run',
      '10_pace_twin',
      '11_achievements',
      '12_prediction_vs_reality',
      '13_rank',
      '14_archetype',
    ]);
    expect(first.cards[0]?.vars).toEqual({ totalDrinks: 4, days: 3 });
    expect(first.cards[3]?.vars).toEqual({
      avgAbv: 4.2,
      share: 67,
      oneIn: 2,
    });
    expect(first.cards[11]?.vars).toEqual({ predicted: 5, actual: 4 });
  });
});

describe('M8 zero-drink personal Wrapped matrix', () => {
  it('uses only the specified stable skips and fallback variants', () => {
    const payload = buildPersonalWrapped(zeroDrinkInput, 'user-a', SNAPSHOT_AT);

    expect(payload.cards).toHaveLength(14);
    expect(payload.cards.map((card) => card?.key ?? null)).toEqual(expectedZeroCardMatrix);
    expect(JSON.stringify(payload)).not.toMatch(/NaN|Infinity/);
    expect(payload.cards[0]?.vars).toEqual({ totalDrinks: 0, days: 3 });
    expect(payload.cards[12]?.vars).toEqual({ perDay: 0 });
  });
});
