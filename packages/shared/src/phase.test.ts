import { describe, expect, it } from 'vitest';

import { computePhase, pendingTransitions } from './index.js';

const DAY_MS = 24 * 3600_000;
const UNLOCK_AT = 10 * DAY_MS;

describe('computePhase', () => {
  it.each([
    { nowMs: UNLOCK_AT - DAY_MS - 1, expected: 'live' },
    { nowMs: UNLOCK_AT - DAY_MS, expected: 'final_24h' },
    { nowMs: UNLOCK_AT - 1, expected: 'final_24h' },
    { nowMs: UNLOCK_AT, expected: 'wrapped_unlocked' },
    { nowMs: UNLOCK_AT + 1, expected: 'wrapped_unlocked' },
  ] as const)('returns $expected at nowMs=$nowMs', ({ nowMs, expected }) => {
    expect(computePhase({ unlockAt: UNLOCK_AT, ceremonyStartedAt: null }, nowMs)).toBe(expected);
  });

  it('gives ceremony precedence over every time-derived phase', () => {
    expect(computePhase({ unlockAt: UNLOCK_AT, ceremonyStartedAt: UNLOCK_AT + DAY_MS }, 0)).toBe(
      'ceremony',
    );
  });
});

describe('pendingTransitions', () => {
  it.each([
    { nowMs: UNLOCK_AT - DAY_MS - 1, expected: [] },
    { nowMs: UNLOCK_AT - DAY_MS, expected: ['final_24h'] },
    { nowMs: UNLOCK_AT - 1, expected: ['final_24h'] },
    { nowMs: UNLOCK_AT, expected: ['final_24h', 'wrapped_unlocked'] },
    { nowMs: UNLOCK_AT + 1, expected: ['final_24h', 'wrapped_unlocked'] },
  ] as const)('returns $expected at nowMs=$nowMs when unmarked', ({ nowMs, expected }) => {
    expect(
      pendingTransitions(
        {
          unlockAt: UNLOCK_AT,
          final24hMarkedAt: null,
          wrappedUnlockedMarkedAt: null,
        },
        nowMs,
      ),
    ).toEqual(expected);
  });

  it('returns an edited-unlock jump as both transitions in order', () => {
    expect(
      pendingTransitions(
        {
          unlockAt: UNLOCK_AT - 1,
          final24hMarkedAt: null,
          wrappedUnlockedMarkedAt: null,
        },
        UNLOCK_AT,
      ),
    ).toEqual(['final_24h', 'wrapped_unlocked']);
  });

  it.each([
    {
      final24hMarkedAt: UNLOCK_AT - DAY_MS,
      wrappedUnlockedMarkedAt: null,
      expected: ['wrapped_unlocked'],
    },
    {
      final24hMarkedAt: null,
      wrappedUnlockedMarkedAt: UNLOCK_AT,
      expected: ['final_24h'],
    },
    {
      final24hMarkedAt: UNLOCK_AT - DAY_MS,
      wrappedUnlockedMarkedAt: UNLOCK_AT,
      expected: [],
    },
  ] as const)(
    'omits transitions whose markers are already set',
    ({ final24hMarkedAt, wrappedUnlockedMarkedAt, expected }) => {
      expect(
        pendingTransitions(
          { unlockAt: UNLOCK_AT, final24hMarkedAt, wrappedUnlockedMarkedAt },
          UNLOCK_AT,
        ),
      ).toEqual(expected);
    },
  );
});
