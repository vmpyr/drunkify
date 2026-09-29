import type { DrinkRow, SnapshotInput } from '../types.js';

export const SNAPSHOT_AT = Date.parse('2026-09-03T12:00:00.000Z');

function drink(id: string, userId: string, overrides: Partial<DrinkRow>): DrinkRow {
  return {
    id,
    tripId: 'trip-1',
    userId,
    category: 'beer',
    drinkName: 'Lager',
    sizeMl: 500,
    abv: 5,
    qty: 1,
    drunkAt: Date.parse('2026-09-01T20:00:00.000Z'),
    createdAt: Date.parse('2026-09-01T20:00:00.000Z'),
    venueId: 'venue-1',
    venueName: 'The Local',
    lat: 51.5,
    lng: -0.1,
    city: 'London',
    countryCode: 'GB',
    rating: 5,
    note: null,
    editCount: 0,
    lastEditedAt: null,
    ...overrides,
  };
}

const baseInput: SnapshotInput = {
  trip: {
    id: 'trip-1',
    name: 'Hand-computed trip',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    timezone: 'UTC',
    themeId: 'classic',
    ownerId: 'user-a',
    unlockAt: SNAPSHOT_AT,
    ceremonyStartedAt: null,
  },
  members: [
    {
      userId: 'user-a',
      name: 'A',
      colorIndex: 0,
      joinedAt: Date.parse('2026-08-31T12:00:00.000Z'),
      disabled: false,
    },
    {
      userId: 'user-b',
      name: 'B',
      colorIndex: 1,
      joinedAt: Date.parse('2026-08-31T13:00:00.000Z'),
      disabled: false,
    },
  ],
  achievementUnlocks: [
    {
      userId: 'user-a',
      key: 'first_blood',
      triggeredByUserId: 'user-a',
      unlockedAt: Date.parse('2026-09-01T20:00:00.000Z'),
      vars: {},
    },
  ],
  predictions: [
    {
      userId: 'user-a',
      myTotalStd: 5,
      groupTotalStd: 8,
      topMemberId: 'user-a',
      leastMemberId: 'user-b',
      topDay: 1,
      criticMemberId: 'user-b',
      lockedAt: Date.parse('2026-09-01T10:00:00.000Z'),
    },
  ],
  venues: [
    { id: 'venue-1', name: 'The Local', lat: 51.5, lng: -0.1 },
    { id: 'venue-2', name: 'Wine Bar', lat: 51.51, lng: -0.11 },
  ],
  drinks: [],
};

export const handComputedInput: SnapshotInput = {
  ...baseInput,
  drinks: [
    drink('a-1', 'user-a', {}),
    drink('b-1', 'user-b', {
      drunkAt: Date.parse('2026-09-01T20:00:30.000Z'),
      createdAt: Date.parse('2026-09-01T20:00:30.000Z'),
    }),
    drink('a-2', 'user-a', {
      category: 'soft',
      drinkName: 'Water',
      sizeMl: 250,
      abv: 0,
      qty: 2,
      drunkAt: Date.parse('2026-09-01T23:00:00.000Z'),
      createdAt: Date.parse('2026-09-01T23:00:00.000Z'),
      venueId: null,
      venueName: null,
      lat: null,
      lng: null,
      rating: 1,
    }),
    drink('a-3', 'user-a', {
      category: 'wine',
      drinkName: 'House Red',
      sizeMl: 200,
      abv: 12.5,
      drunkAt: Date.parse('2026-09-02T20:00:00.000Z'),
      createdAt: Date.parse('2026-09-02T20:00:00.000Z'),
      venueId: 'venue-2',
      venueName: 'Wine Bar',
      lat: 51.51,
      lng: -0.11,
      rating: 4,
    }),
  ],
};

export const zeroDrinkInput: SnapshotInput = {
  ...baseInput,
  trip: { ...baseInput.trip, name: 'Zero-drink trip' },
  members: [baseInput.members[0]!],
  drinks: [],
  achievementUnlocks: [],
  predictions: [],
  venues: [],
};

export const expectedHandMetrics = {
  totals: {
    drinkCount: 4,
    ml: 1_200,
    litres: 1.2,
    stdDrinks: 4,
    grams: 40,
    ethanolLitres: 0.05,
    weightedAvgAbv: 4.2,
  },
  days: [
    { tripDay: 1, drinkCount: 3, stdDrinks: 2 },
    { tripDay: 2, drinkCount: 1, stdDrinks: 2 },
  ],
  categories: [
    { category: 'beer', drinkCount: 1, stdDrinks: 2, sharePct: 25 },
    { category: 'wine', drinkCount: 1, stdDrinks: 2, sharePct: 25 },
    { category: 'soft', drinkCount: 2, stdDrinks: 0, sharePct: 50 },
  ],
} as const;

export const expectedZeroCardMatrix = [
  '01_cold_open',
  '02_absurd_units.empty',
  '03_guess_ethanol',
  '04_abv_share.empty',
  null,
  '06_trail.empty',
  null,
  null,
  '09_absurd_run',
  null,
  null,
  null,
  '13_rank',
  '14_archetype.noPartner',
] as const;
