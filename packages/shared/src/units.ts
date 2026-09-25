const ETHANOL_DENSITY_GRAMS_PER_ML = 0.789;
const GRAMS_PER_STANDARD_DRINK = 10;
const MIN_ABV = 0;
const MAX_ABV = 80;
const ABV_SEAM = 15;
const ABV_SEAM_POSITION = 150;
const MAX_ABV_POSITION = 280;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundHalfUp(value: number, fractionDigits: number): number {
  const factor = 10 ** fractionDigits;
  const scaled = Math.abs(value) * factor;
  const tolerance = Number.EPSILON * Math.max(1, scaled) * 4;
  const rounded = Math.floor(scaled + 0.5 + tolerance) / factor;
  return value < 0 ? -rounded : rounded;
}

export function ethanolGrams(sizeMl: number, abvPercent: number, qty: number): number {
  return sizeMl * (abvPercent / 100) * ETHANOL_DENSITY_GRAMS_PER_ML * qty;
}

export function stdDrinks(sizeMl: number, abvPercent: number, qty: number): number {
  return roundHalfUp(ethanolGrams(sizeMl, abvPercent, qty) / GRAMS_PER_STANDARD_DRINK, 1);
}

export function formatStd(std: number): string {
  return roundHalfUp(std, 1).toFixed(1);
}

/** Liquid volume drunk, in litres (not pure alcohol). */
export function litres(sizeMl: number, qty: number): number {
  return (sizeMl * qty) / 1000;
}

/** Two decimals under 10 L (0.85), one from 10 L up (12.4). */
export function formatLitres(value: number): string {
  return value < 10 ? roundHalfUp(value, 2).toFixed(2) : roundHalfUp(value, 1).toFixed(1);
}

export function formatEthanolGrams(grams: number): string {
  return roundHalfUp(grams, 0).toFixed(0);
}

export function clampAbv(abv: number): number {
  return clamp(abv, MIN_ABV, MAX_ABV);
}

export function posToAbv(pos: number): number {
  const boundedPosition = clamp(Math.round(pos), 0, MAX_ABV_POSITION);
  return boundedPosition <= ABV_SEAM_POSITION
    ? boundedPosition / 10
    : ABV_SEAM + (boundedPosition - ABV_SEAM_POSITION) * 0.5;
}

export function abvToPos(abv: number): number {
  const boundedAbv = clampAbv(abv);
  return boundedAbv <= ABV_SEAM
    ? Math.round(boundedAbv * 10)
    : ABV_SEAM_POSITION + Math.round((boundedAbv - ABV_SEAM) / 0.5);
}

export function nudgeAbv(abv: number, dir: 1 | -1): number {
  const position = clamp(abvToPos(abv) + dir, 0, MAX_ABV_POSITION);
  return posToAbv(position);
}

export function snapAbv(abv: number): number {
  return posToAbv(abvToPos(abv));
}

export function formatAbv(abv: number): string {
  const boundedAbv = clampAbv(abv);
  if (boundedAbv <= ABV_SEAM) return `${boundedAbv.toFixed(1)}%`;
  return `${Number.isInteger(boundedAbv) ? boundedAbv.toFixed(0) : boundedAbv.toFixed(1)}%`;
}
