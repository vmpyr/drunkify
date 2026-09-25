import type { DrinkRow, SnapshotInput } from '../types.js';

export const SQUAD_SNAPSHOT_AT = Date.parse('2026-09-15T12:00:00.000Z');

function member(userId: string, index: number): SnapshotInput['members'][number] {
  return {
    userId,
    name: `Member ${String(index + 1).padStart(2, '0')}`,
    colorIndex: index,
    joinedAt: Date.parse('2026-08-30T12:00:00.000Z') + index * 60_000,
    disabled: false,
  };
}

function drink(
  id: string,
  userId: string,
  day: number,
  hour: number,
  overrides: Partial<DrinkRow> = {},
): DrinkRow {
  const drunkAt = Date.parse(
    `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  );
  return {
    id,
    tripId: 'squad-trip',
    userId,
    category: 'beer',
    drinkName: 'Lager',
    sizeMl: 500,
    abv: 5,
    qty: 1,
    drunkAt,
    createdAt: drunkAt,
    venueId: `venue-${(day % 3) + 1}`,
    venueName: `Venue ${(day % 3) + 1}`,
    lat: 51.5 + day / 100,
    lng: -0.1 - day / 100,
    city: day % 2 === 0 ? 'Paris' : 'London',
    countryCode: day % 2 === 0 ? 'FR' : 'GB',
    rating: (((day + hour) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    note: null,
    editCount: 0,
    lastEditedAt: null,
    ...overrides,
  };
}

export function squadFixture(
  options: {
    memberCount?: number;
    days?: number;
    zeroDrinkMember?: boolean;
    tied?: boolean;
  } = {},
): SnapshotInput {
  const memberCount = options.memberCount ?? 6;
  const days = options.days ?? 14;
  const members = Array.from({ length: memberCount }, (_, index) =>
    member(`user-${String(index + 1).padStart(2, '0')}`, index),
  );
  const drinks: DrinkRow[] = [];
  for (let day = 1; day <= days; day += 1) {
    members.forEach((row, memberIndex) => {
      if (options.zeroDrinkMember && memberIndex === members.length - 1) return;
      const count = options.tied ? 1 : 1 + ((day + memberIndex) % 3);
      for (let item = 0; item < count; item += 1) {
        const category =
          item === 1
            ? 'shot'
            : memberIndex % 4 === 0
              ? 'wine'
              : memberIndex % 5 === 0
                ? 'soft'
                : 'beer';
        drinks.push(
          drink(
            `d-${day}-${memberIndex}-${item}`,
            row.userId,
            day,
            18 + ((memberIndex + item * 2) % 7),
            {
              category,
              drinkName:
                category === 'shot'
                  ? 'Tequila'
                  : category === 'wine'
                    ? 'House Red'
                    : category === 'soft'
                      ? 'Water'
                      : memberIndex % 2 === 0
                        ? 'Lager'
                        : 'Stout',
              sizeMl: category === 'shot' ? 25 : category === 'wine' ? 175 : 500,
              abv:
                category === 'shot' ? 40 : category === 'wine' ? 12 : category === 'soft' ? 0 : 5,
              qty: item === 2 ? 0.5 : 1,
              rating: (((memberIndex + day + item) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
              note:
                day === 3 && memberIndex === 1 && item === 0
                  ? 'A very strange note '.repeat(12).trim()
                  : null,
              editCount: day === 4 && memberIndex === 2 && item === 0 ? 6 : 0,
              lastEditedAt:
                day === 4 && memberIndex === 2 && item === 0
                  ? Date.parse('2026-09-05T10:00:00.000Z')
                  : null,
            },
          ),
        );
      }
    });
  }
  if (!options.zeroDrinkMember && members[0]) {
    drinks.push(
      drink('tiny', members[0].userId, 2, 20, {
        category: 'shot',
        drinkName: 'Tiny Shot',
        sizeMl: 20,
        abv: 40,
      }),
    );
    drinks.push(
      drink('water-4am', members[0].userId, 5, 4, {
        category: 'soft',
        drinkName: 'Water',
        sizeMl: 250,
        abv: 0,
      }),
    );
  }
  return {
    trip: {
      id: 'squad-trip',
      name: 'Fourteen day fixture',
      startDate: '2026-09-01',
      endDate: `2026-09-${String(days).padStart(2, '0')}`,
      timezone: 'UTC',
      themeId: 'classic',
      ownerId: members[0]?.userId ?? 'owner',
      unlockAt: SQUAD_SNAPSHOT_AT,
      ceremonyStartedAt: SQUAD_SNAPSHOT_AT,
    },
    members,
    drinks,
    achievementUnlocks: drinks
      .slice(0, Math.min(drinks.length, members.length))
      .map((row, index) => ({
        userId: row.userId,
        key: index % 2 === 0 ? 'first_blood' : 'cheers',
        triggeredByUserId: row.userId,
        unlockedAt: row.drunkAt,
        vars: {},
      })),
    predictions: members.slice(0, Math.max(0, members.length - 1)).map((row, index) => ({
      userId: row.userId,
      myTotalStd: 25 + index,
      groupTotalStd: 180,
      topMemberId: members[0]?.userId ?? row.userId,
      leastMemberId: members.at(-1)?.userId ?? row.userId,
      topDrink: 'Lager',
      topDrinkCategory: 'beer',
      lockedAt: Date.parse('2026-09-01T10:00:00.000Z') + index * 60_000,
    })),
    venues: [1, 2, 3].map((index) => ({
      id: `venue-${index}`,
      name: `Venue ${index}`,
      lat: 51.5 + index / 100,
      lng: -0.1 - index / 100,
    })),
  };
}

export const expectedSquadGolden = {
  cardIds: [
    '01_group_total',
    '02_drunk_o_meter',
    '03_keg',
    '04_cities_venues',
    '05_crowd_then_divisive',
    '06_replay',
    '07_side_boards',
    '08_predictions',
    '09_awards',
    '10_main_board',
    '11_credits',
  ],
  memberIndex: ['user-01', 'user-02', 'user-03', 'user-04', 'user-05', 'user-06'],
  revealRanks: [6, 5, 4, 3, 2, 1],
} as const;
