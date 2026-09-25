import { describe, expect, it } from 'vitest';

import {
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
} from './index.js';

describe('standard-drink units', () => {
  it.each([
    { sizeMl: 0, abv: 5, qty: 1, expected: 0 },
    { sizeMl: 330, abv: 5, qty: 1, expected: 1.3 },
    { sizeMl: 568, abv: 5.2, qty: 1, expected: 2.3 },
    { sizeMl: 500, abv: 5, qty: 0.5, expected: 1 },
    { sizeMl: 250, abv: 15, qty: 1, expected: 3 },
    { sizeMl: 250, abv: 15.5, qty: 1, expected: 3.1 },
    { sizeMl: 25, abv: 40, qty: 2, expected: 1.6 },
  ])(
    'rounds $sizeMl ml at $abv% × $qty to $expected standard drinks',
    ({ sizeMl, abv, qty, expected }) => {
      expect(stdDrinks(sizeMl, abv, qty)).toBe(expected);
    },
  );

  it('keeps the unrounded ethanol mass available', () => {
    expect(ethanolGrams(568, 5.2, 1)).toBeCloseTo(23.303904, 6);
  });

  it('formats standard drinks and ethanol grams with round-half-up', () => {
    expect(formatStd(0)).toBe('0.0');
    expect(formatStd(1.25)).toBe('1.3');
    expect(formatEthanolGrams(23.5)).toBe('24');
  });
});

describe('ABV slider math', () => {
  it.each([
    { pos: 0, abv: 0 },
    { pos: 1, abv: 0.1 },
    { pos: 149, abv: 14.9 },
    { pos: 150, abv: 15 },
    { pos: 151, abv: 15.5 },
    { pos: 180, abv: 30 },
    { pos: 220, abv: 50 },
    { pos: 280, abv: 80 },
  ])('maps slider position $pos to $abv%', ({ pos, abv }) => {
    expect(posToAbv(pos)).toBe(abv);
    expect(abvToPos(abv)).toBe(pos);
  });

  it('round-trips every valid position with the documented segment step', () => {
    for (let position = 0; position <= 280; position += 1) {
      const abv = posToAbv(position);
      expect(abvToPos(abv)).toBe(position);

      if (position < 150) expect(posToAbv(position + 1) - abv).toBeCloseTo(0.1, 10);
      else if (position < 280) expect(posToAbv(position + 1) - abv).toBe(0.5);
    }
  });

  it('uses asymmetric steps around exactly 15%', () => {
    expect(nudgeAbv(15, -1)).toBe(14.9);
    expect(nudgeAbv(15, 1)).toBe(15.5);
  });

  it('clamps nudges and direct conversions to the documented endpoints', () => {
    expect(nudgeAbv(0, -1)).toBe(0);
    expect(nudgeAbv(80, 1)).toBe(80);
    expect(posToAbv(-1)).toBe(0);
    expect(posToAbv(281)).toBe(80);
    expect(abvToPos(-0.1)).toBe(0);
    expect(abvToPos(80.1)).toBe(280);
    expect(clampAbv(-0.1)).toBe(0);
    expect(clampAbv(80.1)).toBe(80);
  });

  it('snaps values to the correct segment grid', () => {
    expect(snapAbv(6.34)).toBe(6.3);
    expect(snapAbv(15)).toBe(15);
    expect(snapAbv(15.24)).toBe(15);
    expect(snapAbv(15.26)).toBe(15.5);
    expect(snapAbv(79.9)).toBe(80);
  });

  it('formats values according to the two slider segments', () => {
    expect(formatAbv(0)).toBe('0.0%');
    expect(formatAbv(5)).toBe('5.0%');
    expect(formatAbv(15)).toBe('15.0%');
    expect(formatAbv(15.5)).toBe('15.5%');
    expect(formatAbv(40)).toBe('40%');
    expect(formatAbv(80)).toBe('80%');
  });
});
