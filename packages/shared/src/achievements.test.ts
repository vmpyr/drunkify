import { describe, expect, it } from 'vitest';

import {
  ACHIEVEMENT_KEYS,
  achievementPredicates,
  evaluateAchievementPredicates,
  type AchievementDrink,
  type AchievementEvaluationInput,
  type AchievementKey,
} from './achievements.js';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const BASE = Date.parse('2026-09-01T12:00:00.000Z');

function drink(id: string, overrides: Partial<AchievementDrink> = {}): AchievementDrink {
  return {
    id,
    tripId: 'trip-1',
    userId: 'user-1',
    category: 'beer',
    qty: 1,
    drunkAt: BASE,
    venueId: null,
    venueName: null,
    altitude: null,
    speed: null,
    countryCode: null,
    rating: null,
    ...overrides,
  };
}

function input(
  drinks: AchievementDrink[],
  trigger = drinks.at(-1)!,
  overrides: Partial<AchievementEvaluationInput> = {},
): AchievementEvaluationInput {
  return {
    trigger: { drink: trigger, op: 'create' },
    drinks,
    trip: { startDate: '2026-09-01', timezone: 'UTC' },
    ...overrides,
  };
}

interface GoldenFixture {
  key: AchievementKey;
  yes: AchievementEvaluationInput;
  no: AchievementEvaluationInput;
  expectedUsers?: Array<string | null>;
  expectedVars?: Record<string, string | number>;
}

const first = drink('first');
const fiveYes = [0, 15, 30, 45, 60].map((minutes, index) =>
  drink(`five-${index}`, { drunkAt: BASE + minutes * 60_000 }),
);
const fiveNo = [0, 16, 32, 48, 64].map((minutes, index) =>
  drink(`slow-${index}`, { drunkAt: BASE + minutes * 60_000 }),
);
const pitYes = [
  drink('pit-a', { drunkAt: BASE }),
  drink('pit-soft', { category: 'soft', drunkAt: BASE + 1 }),
  drink('pit-b', { drunkAt: BASE + 2 }),
];
const pubYes = ['a', 'b', 'c', 'd'].map((venueId, index) =>
  drink(`pub-${venueId}`, { venueId, drunkAt: BASE + index }),
);
const cheersYes = ['user-1', 'user-2', 'user-3'].map((userId, index) =>
  drink(`cheers-${index}`, { userId, drunkAt: BASE + index * 30_000 }),
);
const criticYes = Array.from({ length: 20 }, (_, index) =>
  drink(`rated-${index}`, { rating: 4, drunkAt: BASE + index }),
);
const centuryYes = [drink('ninety-nine', { qty: 99 }), drink('hundred', { qty: 1 })];
const passportYes = [
  drink('country-a', { countryCode: 'FR' }),
  drink('country-b', { countryCode: 'DE', drunkAt: BASE + DAY_MS }),
];
const regularYes = Array.from({ length: 5 }, (_, index) =>
  drink(`regular-${index}`, {
    venueId: 'home-pub',
    venueName: 'The Local',
    drunkAt: BASE + index * DAY_MS,
  }),
);

const goldenFixtures: GoldenFixture[] = [
  { key: 'first_blood', yes: input([first]), no: input([], first) },
  { key: 'five_in_hour', yes: input(fiveYes), no: input(fiveNo) },
  {
    key: 'pit_stop',
    yes: input(pitYes),
    no: input([pitYes[0]!, { ...pitYes[1]!, category: 'beer' }, pitYes[2]!]),
  },
  { key: 'pub_crawl', yes: input(pubYes), no: input(pubYes.slice(0, 3)) },
  {
    key: 'mile_high',
    yes: input([drink('plane', { altitude: 3_001 })]),
    no: input([drink('ground', { altitude: 3_000, speed: 100 })]),
  },
  {
    key: 'cheers',
    yes: input(cheersYes),
    no: input(cheersYes.slice(0, 2)),
    expectedUsers: ['user-1', 'user-2', 'user-3'],
  },
  {
    key: 'after_3am',
    yes: input([drink('late', { drunkAt: Date.parse('2026-09-02T03:00:00.000Z') })]),
    no: input([drink('early', { drunkAt: Date.parse('2026-09-02T06:00:00.000Z') })]),
  },
  { key: 'critic', yes: input(criticYes), no: input(criticYes.slice(0, 19)) },
  {
    key: 'century',
    yes: input(centuryYes),
    no: input([drink('below', { qty: 99.5 })]),
    expectedUsers: [null],
    expectedVars: { n: 100 },
  },
  {
    key: 'passport',
    yes: input(passportYes),
    no: input([passportYes[0]!, { ...passportYes[1]!, drunkAt: BASE + DAY_MS + 1 }]),
  },
  {
    key: 'regular',
    yes: input(regularYes),
    no: input(regularYes.slice(0, 4)),
    expectedVars: { venue: 'The Local' },
  },
];

describe('achievement predicate registry', () => {
  it('contains exactly the eleven content-pack keys', () => {
    expect(Object.keys(achievementPredicates)).toEqual(ACHIEVEMENT_KEYS);
    expect(ACHIEVEMENT_KEYS).toHaveLength(11);
  });

  it.each(goldenFixtures)('$key matches its golden positive and negative fixtures', (fixture) => {
    const yes = achievementPredicates[fixture.key](fixture.yes);
    const no = achievementPredicates[fixture.key](fixture.no);

    expect(yes.length).toBeGreaterThan(0);
    expect(no).toEqual([]);
    expect(yes.every((candidate) => candidate.key === fixture.key)).toBe(true);
    if (fixture.expectedUsers)
      expect(yes.map((candidate) => candidate.userId)).toEqual(fixture.expectedUsers);
    if (fixture.expectedVars) expect(yes[0]?.vars).toEqual(fixture.expectedVars);
  });
});

describe('achievement edge behavior', () => {
  it('finds a backdated five-in-hour or pit-stop pattern anywhere in full history', () => {
    const backdated = drink('backdated', { category: 'soft', qty: 3, drunkAt: BASE + 1 });
    const drinks = [
      drink('before', { qty: 1, drunkAt: BASE }),
      drink('after', { qty: 1, drunkAt: BASE + 2 }),
      backdated,
    ];
    const keys = evaluateAchievementPredicates(input(drinks, backdated)).map(({ key }) => key);

    expect(keys).toContain('five_in_hour');
    expect(keys).toContain('pit_stop');
  });

  it('counts half-pours and permits a single qty-five drink', () => {
    const halves = Array.from({ length: 10 }, (_, index) =>
      drink(`half-${index}`, { qty: 0.5, drunkAt: BASE + index }),
    );
    expect(achievementPredicates.five_in_hour(input(halves))).toHaveLength(1);
    expect(achievementPredicates.five_in_hour(input([drink('large', { qty: 5 })]))).toHaveLength(1);
  });

  it('requires five distinct trip-night visits for regular', () => {
    const duplicateNight = drink('same-night', {
      venueId: 'home-pub',
      venueName: 'The Local',
      drunkAt: regularYes[0]!.drunkAt + HOUR_MS,
    });
    expect(
      achievementPredicates.regular(input([...regularYes.slice(0, 4), duplicateNight])),
    ).toEqual([]);
  });

  it('only lets a create cross the century threshold', () => {
    expect(
      achievementPredicates.century({
        ...input(centuryYes),
        trigger: { drink: centuryYes[1]!, op: 'update' },
      }),
    ).toEqual([]);
  });
});
