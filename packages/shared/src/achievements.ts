import { dayIndex } from './tripDays.js';

export const ACHIEVEMENT_KEYS = [
  'first_blood',
  'five_in_hour',
  'pit_stop',
  'pub_crawl',
  'mile_high',
  'cheers',
  'after_3am',
  'critic',
  'century',
  'passport',
  'regular',
] as const;

export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[number];
export type AchievementOperation = 'create' | 'update';

export interface AchievementDrink {
  id: string;
  tripId: string;
  userId: string;
  category: string;
  qty: number;
  drunkAt: number;
  venueId: string | null;
  venueName?: string | null;
  altitude: number | null;
  speed: number | null;
  countryCode: string | null;
  rating: number | null;
}

export interface AchievementEvaluationInput {
  trigger: { drink: AchievementDrink; op: AchievementOperation };
  drinks: readonly AchievementDrink[];
  trip: { startDate: string; timezone: string };
  venueNames?: Readonly<Record<string, string>>;
}

export interface AchievementCandidate {
  key: AchievementKey;
  userId: string | null;
  triggeredByUserId: string;
  drinkId: string;
  vars: Record<string, string | number>;
}

export type AchievementPredicate = (
  input: AchievementEvaluationInput,
) => readonly AchievementCandidate[];

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

function ordered(drinks: readonly AchievementDrink[]): AchievementDrink[] {
  return [...drinks].sort(
    (left, right) => left.drunkAt - right.drunkAt || left.id.localeCompare(right.id),
  );
}

function ownDrinks(input: AchievementEvaluationInput): AchievementDrink[] {
  return ordered(
    input.drinks.filter(
      (drink) =>
        drink.tripId === input.trigger.drink.tripId && drink.userId === input.trigger.drink.userId,
    ),
  );
}

function personalCandidate(
  key: AchievementKey,
  drink: AchievementDrink,
  vars: Record<string, string | number> = {},
): AchievementCandidate {
  return {
    key,
    userId: drink.userId,
    triggeredByUserId: drink.userId,
    drinkId: drink.id,
    vars,
  };
}

function hasQtyWindow(
  drinks: readonly AchievementDrink[],
  durationMs: number,
  threshold: number,
): boolean {
  let left = 0;
  let total = 0;
  for (let right = 0; right < drinks.length; right += 1) {
    const rightDrink = drinks[right]!;
    total += rightDrink.qty;
    while (rightDrink.drunkAt - drinks[left]!.drunkAt > durationMs) {
      total -= drinks[left]!.qty;
      left += 1;
    }
    if (total >= threshold) return true;
  }
  return false;
}

function hasCountryWindow(drinks: readonly AchievementDrink[]): boolean {
  let left = 0;
  const countryCounts = new Map<string, number>();
  for (let right = 0; right < drinks.length; right += 1) {
    const rightDrink = drinks[right]!;
    if (rightDrink.countryCode !== null) {
      countryCounts.set(
        rightDrink.countryCode,
        (countryCounts.get(rightDrink.countryCode) ?? 0) + 1,
      );
    }
    while (rightDrink.drunkAt - drinks[left]!.drunkAt > DAY_MS) {
      const country = drinks[left]!.countryCode;
      if (country !== null) {
        const remaining = (countryCounts.get(country) ?? 1) - 1;
        if (remaining === 0) countryCounts.delete(country);
        else countryCounts.set(country, remaining);
      }
      left += 1;
    }
    if (countryCounts.size >= 2) return true;
  }
  return false;
}

function localHour(instantMs: number, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(instantMs)
    .find((part) => part.type === 'hour')?.value;
  if (hour === undefined) throw new Error(`Could not resolve local hour for ${timezone}`);
  return Number(hour);
}

function cheersCandidates(input: AchievementEvaluationInput): AchievementCandidate[] {
  const trigger = input.trigger.drink;
  const drinks = ordered(input.drinks.filter((drink) => drink.tripId === trigger.tripId));
  const triggerIndex = drinks.findIndex((drink) => drink.id === trigger.id);
  if (triggerIndex < 0) return [];

  const qualifying = new Map<string, AchievementDrink>();
  for (let left = 0; left <= triggerIndex; left += 1) {
    for (let right = triggerIndex; right < drinks.length; right += 1) {
      if (drinks[right]!.drunkAt - drinks[left]!.drunkAt > 60_000) break;
      const window = drinks.slice(left, right + 1);
      if (new Set(window.map((drink) => drink.userId)).size < 3) continue;
      for (const drink of window) {
        const prior = qualifying.get(drink.userId);
        if (!prior || drink.drunkAt > prior.drunkAt) qualifying.set(drink.userId, drink);
      }
    }
  }

  return [...qualifying.values()]
    .sort((left, right) => left.userId.localeCompare(right.userId))
    .map((drink) => personalCandidate('cheers', drink));
}

function regularCandidate(input: AchievementEvaluationInput): AchievementCandidate[] {
  const trigger = input.trigger.drink;
  const visitsByVenue = new Map<string, Map<number, AchievementDrink>>();
  for (const drink of ownDrinks(input)) {
    if (drink.venueId === null) continue;
    const visits = visitsByVenue.get(drink.venueId) ?? new Map<number, AchievementDrink>();
    const tripDay = dayIndex(drink.drunkAt, input.trip.startDate, input.trip.timezone);
    if (!visits.has(tripDay)) visits.set(tripDay, drink);
    visitsByVenue.set(drink.venueId, visits);
  }

  const qualifying = [...visitsByVenue.entries()]
    .filter(([, visits]) => visits.size >= 5)
    .sort(([leftId], [rightId]) => {
      if (leftId === trigger.venueId) return -1;
      if (rightId === trigger.venueId) return 1;
      return leftId.localeCompare(rightId);
    })[0];
  if (!qualifying) return [];

  const [venueId, visits] = qualifying;
  const visitDrinks = [...visits.values()].sort((left, right) => right.drunkAt - left.drunkAt);
  const venue =
    input.venueNames?.[venueId] ??
    visitDrinks.find((drink) => drink.venueName !== null && drink.venueName !== undefined)
      ?.venueName;
  if (!venue) return [];
  return [personalCandidate('regular', trigger, { venue })];
}

export const achievementPredicates: Readonly<Record<AchievementKey, AchievementPredicate>> = {
  first_blood(input) {
    return ownDrinks(input).length > 0
      ? [personalCandidate('first_blood', input.trigger.drink)]
      : [];
  },
  five_in_hour(input) {
    return hasQtyWindow(ownDrinks(input), HOUR_MS, 5)
      ? [personalCandidate('five_in_hour', input.trigger.drink)]
      : [];
  },
  pit_stop(input) {
    const drinks = ownDrinks(input);
    const qualifies = drinks.some(
      (drink, index) =>
        drink.category === 'soft' &&
        index > 0 &&
        index < drinks.length - 1 &&
        drinks[index - 1]!.category !== 'soft' &&
        drinks[index + 1]!.category !== 'soft',
    );
    return qualifies ? [personalCandidate('pit_stop', input.trigger.drink)] : [];
  },
  pub_crawl(input) {
    const venuesByDay = new Map<number, Set<string>>();
    for (const drink of ownDrinks(input)) {
      if (drink.venueId === null) continue;
      const tripDay = dayIndex(drink.drunkAt, input.trip.startDate, input.trip.timezone);
      const venues = venuesByDay.get(tripDay) ?? new Set<string>();
      venues.add(drink.venueId);
      venuesByDay.set(tripDay, venues);
    }
    return [...venuesByDay.values()].some((venues) => venues.size >= 4)
      ? [personalCandidate('pub_crawl', input.trigger.drink)]
      : [];
  },
  mile_high(input) {
    const { altitude, speed } = input.trigger.drink;
    return (altitude !== null && altitude > 3_000) || (speed !== null && speed > 100)
      ? [personalCandidate('mile_high', input.trigger.drink)]
      : [];
  },
  cheers: cheersCandidates,
  after_3am(input) {
    const hour = localHour(input.trigger.drink.drunkAt, input.trip.timezone);
    return hour >= 3 && hour < 6 ? [personalCandidate('after_3am', input.trigger.drink)] : [];
  },
  critic(input) {
    return ownDrinks(input).filter((drink) => drink.rating !== null).length >= 20
      ? [personalCandidate('critic', input.trigger.drink)]
      : [];
  },
  century(input) {
    if (input.trigger.op !== 'create') return [];
    const trigger = input.trigger.drink;
    const total = input.drinks
      .filter((drink) => drink.tripId === trigger.tripId)
      .reduce((sum, drink) => sum + drink.qty, 0);
    return total - trigger.qty < 100 && total >= 100
      ? [
          {
            key: 'century',
            userId: null,
            triggeredByUserId: trigger.userId,
            drinkId: trigger.id,
            vars: { n: 100 },
          },
        ]
      : [];
  },
  passport(input) {
    return hasCountryWindow(ownDrinks(input))
      ? [personalCandidate('passport', input.trigger.drink)]
      : [];
  },
  regular: regularCandidate,
};

export function evaluateAchievementPredicates(
  input: AchievementEvaluationInput,
): AchievementCandidate[] {
  return ACHIEVEMENT_KEYS.flatMap((key) => achievementPredicates[key](input));
}
