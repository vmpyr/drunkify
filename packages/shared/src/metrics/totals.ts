import type { DerivedDrink } from './types.js';

export const UNITS = {
  ukPintMl: 568.26,
  usPintMl: 473.18,
  gramsPerStd: 10,
  ethanolDensity: 0.789,
} as const;

export interface VolumeTotals {
  drinkCount: number;
  ml: number;
  litres: number;
  ukPints: number;
  usPints: number;
  stdDrinks: number;
  grams: number;
  ethanolLitres: number;
}

export function sumVolume(drinks: readonly DerivedDrink[]): VolumeTotals {
  let drinkCount = 0;
  let ml = 0;
  let stdDrinks = 0;
  let grams = 0;
  let ethanolMl = 0;

  for (const drink of drinks) {
    drinkCount += drink.qty;
    ml += drink.sizeMl * drink.qty;
    stdDrinks += drink.stdDrinks;
    grams += drink.grams;
    ethanolMl += drink.ethanolMl;
  }

  return {
    drinkCount,
    ml,
    litres: ml / 1000,
    ukPints: ml / UNITS.ukPintMl,
    usPints: ml / UNITS.usPintMl,
    stdDrinks,
    grams,
    ethanolLitres: ethanolMl / 1000,
  };
}

export function weightedAvgAbv(drinks: readonly DerivedDrink[]): number {
  let weighted = 0;
  let volume = 0;
  for (const drink of drinks) {
    const drinkVolume = drink.sizeMl * drink.qty;
    weighted += drink.abv * drinkVolume;
    volume += drinkVolume;
  }
  return volume === 0 ? 0 : Math.round((weighted / volume) * 10) / 10;
}

export function shareOfGroupAlcohol(memberGrams: number, groupGrams: number): number {
  return groupGrams === 0 ? 0 : (memberGrams / groupGrams) * 100;
}
