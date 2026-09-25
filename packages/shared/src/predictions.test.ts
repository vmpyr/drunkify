import { describe, expect, it } from 'vitest';

import { computePredictionWindow, predictionDefaults } from './predictions.js';

const DAY_MS = 24 * 3600_000;

describe('computePredictionWindow', () => {
  const trip = { createdAt: 10_000, ceremonyStartedAt: null };

  it('uses the later of trip creation and member join for the 24-hour deadline', () => {
    const member = {
      joinedAt: trip.createdAt + 3 * DAY_MS,
      firstDrinkAt: null,
      predictionsLockedAt: null,
    };

    expect(computePredictionWindow(member, trip, member.joinedAt + DAY_MS - 1)).toBe('open');
    expect(computePredictionWindow(member, trip, member.joinedAt + DAY_MS)).toBe('missed');
  });

  it('uses trip creation when a member row predates the trip timestamp', () => {
    const member = {
      joinedAt: trip.createdAt - DAY_MS,
      firstDrinkAt: null,
      predictionsLockedAt: null,
    };

    expect(computePredictionWindow(member, trip, trip.createdAt + DAY_MS - 1)).toBe('open');
    expect(computePredictionWindow(member, trip, trip.createdAt + DAY_MS)).toBe('missed');
  });

  it('closes immediately at the immutable first-drink receipt time', () => {
    const member = {
      joinedAt: trip.createdAt,
      firstDrinkAt: trip.createdAt + 1_000,
      predictionsLockedAt: null,
    };

    expect(computePredictionWindow(member, trip, member.firstDrinkAt - 1)).toBe('open');
    expect(computePredictionWindow(member, trip, member.firstDrinkAt)).toBe('missed');
  });

  it('gives a locked prediction precedence over first drink, deadline, and ceremony', () => {
    const member = {
      joinedAt: trip.createdAt,
      firstDrinkAt: trip.createdAt + 100,
      predictionsLockedAt: trip.createdAt + 50,
    };

    expect(
      computePredictionWindow(
        member,
        { ...trip, ceremonyStartedAt: trip.createdAt + 75 },
        trip.createdAt + 2 * DAY_MS,
      ),
    ).toBe('locked');
  });

  it('force-closes a late joiner at ceremony start', () => {
    const ceremonyStartedAt = trip.createdAt + 10 * DAY_MS;
    const member = {
      joinedAt: ceremonyStartedAt - 1_000,
      firstDrinkAt: null,
      predictionsLockedAt: null,
    };

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
