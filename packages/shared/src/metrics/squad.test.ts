import { describe, expect, it } from 'vitest';

import { allocateAwards, buildSquadWrapped, computeReplayTimeline } from './squad.js';
import { expectedSquadGolden, SQUAD_SNAPSHOT_AT, squadFixture } from './__fixtures__/squad.js';
import { deriveDrinks } from './derive.js';
import { rankDays } from './ranks.js';
import { toTripMeta } from './types.js';
import type { MemberMetrics } from './squad.js';

function awards(payload: ReturnType<typeof buildSquadWrapped>): Set<string> {
  const covered = new Set(
    payload.cards[8].winners.flatMap((card) => card.winners.map((row) => row.userId)),
  );
  const ranking = payload.cards[9].data?.ranking as Array<{ userId: string; rank: number }>;
  const mvp = ranking.find((row) => row.rank === 1);
  if (mvp) covered.add(mvp.userId);
  return covered;
}

function syntheticMetrics(count: number): MemberMetrics[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: `edge-${String(index + 1).padStart(2, '0')}`,
    name: `Edge ${index + 1}`,
    joinedAt: index,
    drinks: [],
    drinkCount: 0,
    stdDrinks: 0,
    litres: 0,
    uniqueDrinks: 0,
    activeDayStd: [],
    dailyStd: [],
    cv: 0,
    firstDrinkAt: null,
    lastDrinkAt: null,
    longestStreak: 0,
    shotStd: 0,
    fancyScore: 0,
    ratingAvg: null,
    ratingCount: 0,
    comeback: null,
    topVenue: null,
    totalVisits: 0,
  }));
}

describe('M9 Squad Wrapped golden fixture', () => {
  it('builds all 11 deterministic cards with embedded replay and reveal ordering', () => {
    const input = squadFixture();
    const first = buildSquadWrapped(input, SQUAD_SNAPSHOT_AT);
    const second = buildSquadWrapped(input, SQUAD_SNAPSHOT_AT);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.cards.map((card) => card.id)).toEqual(expectedSquadGolden.cardIds);
    expect(first.cards[5].data?.replay).toMatchObject({
      schemaVersion: 1,
      memberIndex: expectedSquadGolden.memberIndex,
    });
    expect(
      (first.cards[9].data?.ranking as Array<{ rank: number }>).map((row) => row.rank),
    ).toEqual(expectedSquadGolden.revealRanks);
    expect(first.cards[6].data?.boards).toHaveProperty('best_pacer');
    expect(first.cards[7].data?.rows).toHaveLength(5);
    expect(first.cards[10].data).toHaveProperty('archetypes.user-01');
    expect(JSON.stringify(first)).not.toMatch(/NaN|Infinity/);
  });

  it('compresses the 14-day replay to 60–90 seconds without dropping drinks', () => {
    const input = squadFixture({ days: 14 });
    const trip = toTripMeta(input);
    const drinks = deriveDrinks(input.drinks, trip);
    const replay = computeReplayTimeline(drinks, trip, input.members, input.achievementUnlocks);

    expect(replay.totalPlaybackMs).toBeGreaterThanOrEqual(60_000);
    expect(replay.totalPlaybackMs).toBeLessThanOrEqual(90_000);
    expect(replay.events).toHaveLength(drinks.length);
    expect(replay.dayEndMarkers).toHaveLength(14);
    expect(
      replay.events.every(
        (event, index, rows) => index === 0 || event.tOffsetMs >= rows[index - 1]!.tOffsetMs,
      ),
    ).toBe(true);
  });
});

describe('M9 award coverage', () => {
  it.each([
    ['zero-drink member', squadFixture({ zeroDrinkMember: true })],
    ['tied criteria', squadFixture({ tied: true })],
    ['more than thirteen members', squadFixture({ memberCount: 15, zeroDrinkMember: true })],
  ])('gives every member at least one award: %s', (_name, input) => {
    const payload = buildSquadWrapped(input, SQUAD_SNAPSHOT_AT);
    const covered = awards(payload);
    expect(
      [...input.members.map((member) => member.userId)].every((userId) => covered.has(userId)),
    ).toBe(true);
  });

  it('uses co-winner fallback even when every member is eligible only for least_logged', () => {
    const metrics = syntheticMetrics(15);
    const winners = allocateAwards(metrics, []);
    expect(new Set(winners.map((winner) => winner.userId))).toEqual(
      new Set(metrics.map((member) => member.userId)),
    );
    expect(winners.filter((winner) => winner.isCoWinner)).toHaveLength(14);
  });

  it('keeps the rank denominator bounded by the fixture trip span', () => {
    const input = squadFixture();
    expect(rankDays(toTripMeta(input), SQUAD_SNAPSHOT_AT)).toBe(14);
  });
});
