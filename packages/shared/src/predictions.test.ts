import { describe, expect, it } from 'vitest';

import { computePredictionWindow, predictionDefaults } from './predictions.js';

const DAY_MS = 24 * 3600_000;

describe('computePredictionWindow', () => {
  const trip = { startAtMs: 100 * DAY_MS, ceremonyStartedAt: null };

  it('stays open well beyond 24h after joining, until the trip begins', () => {
    const member = { firstDrinkAt: null, predictionsLockedAt: null };

    expect(computePredictionWindow(member, trip, 50 * DAY_MS)).toBe('open');
    expect(computePredictionWindow(member, trip, trip.startAtMs - 1)).toBe('open');
  });

  it('closes at the trip begin instant', () => {
    const member = { firstDrinkAt: null, predictionsLockedAt: null };

    expect(computePredictionWindow(member, trip, trip.startAtMs)).toBe('missed');
    expect(computePredictionWindow(member, trip, trip.startAtMs + DAY_MS)).toBe('missed');
  });

  it('closes immediately at the immutable first-drink receipt time', () => {
    const member = {
      firstDrinkAt: trip.startAtMs - 1_000,
      predictionsLockedAt: null,
    };

    expect(computePredictionWindow(member, trip, member.firstDrinkAt - 1)).toBe('open');
    expect(computePredictionWindow(member, trip, member.firstDrinkAt)).toBe('missed');
  });

  it('gives a locked prediction precedence over first drink, trip start, and ceremony', () => {
    const member = {
      firstDrinkAt: trip.startAtMs - 100,
      predictionsLockedAt: trip.startAtMs - 200,
    };

    expect(
      computePredictionWindow(
        member,
        { ...trip, ceremonyStartedAt: trip.startAtMs - 50 },
        trip.startAtMs + 2 * DAY_MS,
      ),
    ).toBe('locked');
  });

  it('force-closes at ceremony start even before the trip begins', () => {
    const ceremonyStartedAt = trip.startAtMs - 1_000;
    const member = { firstDrinkAt: null, predictionsLockedAt: null };

    expect(
      computePredictionWindow(member, { ...trip, ceremonyStartedAt }, ceremonyStartedAt - 1),
    ).toBe('open');
    expect(computePredictionWindow(member, { ...trip, ceremonyStartedAt }, ceremonyStartedAt)).toBe(
      'missed',
    );
  });
});

describe('predictionDefaults', () => {
  it('prefills two litres per trip day and scales the squad total once', () => {
    expect(predictionDefaults(10, 6)).toEqual({ q1: 20, q2: 120 });
  });
});
