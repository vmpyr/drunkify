import { byDay, byHour, byVenue, memberVisitCount, peakDay, topDrinks } from './distribution.js';
import { deriveDrinks } from './derive.js';
import { cheersCount } from './rating2.js';
import { guiltyPleasure, personalRatingRollup, topRated } from './ratings.js';
import { elapsedTripDays, rankDays, stdPerDay } from './ranks.js';
import { shareOfGroupAlcohol, sumVolume, weightedAvgAbv } from './totals.js';
import { toTripMeta } from './types.js';
import type {
  DerivedDrink,
  DrinkCategory,
  PersonalWrappedPayload,
  SnapshotInput,
  TripMeta,
  WrappedCard,
  WrappedValue,
} from './types.js';

export type AbsurdUnitKey =
  'bathtub' | 'olympic_pool' | 'pub_keg' | 'tanker_truck' | 'fire_hydrant';

export interface ComparisonsConfig {
  absurdUnits: Record<
    AbsurdUnitKey,
    { volumeL: number; displayAs: 'count' | 'percent' | 'minutes' }
  >;
  liverMilesKmPerL: number;
  liverMilesReferenceDistances: Array<{ label: string; km: number }>;
}

export interface PricesConfig {
  currency: string;
  categoryPrices: Record<DrinkCategory, number>;
  gdpComparison: { referenceCountry: string; gdpPerSecondEUR: number };
}

export interface PersonalMetricsConfig {
  comparisons?: ComparisonsConfig;
  prices?: PricesConfig;
}

export const DEFAULT_COMPARISONS_CONFIG: ComparisonsConfig = {
  absurdUnits: {
    bathtub: { volumeL: 150, displayAs: 'count' },
    olympic_pool: { volumeL: 2_500_000, displayAs: 'percent' },
    pub_keg: { volumeL: 50, displayAs: 'count' },
    tanker_truck: { volumeL: 30_000, displayAs: 'count' },
    fire_hydrant: { volumeL: 4_000, displayAs: 'minutes' },
  },
  liverMilesKmPerL: 8.5,
  liverMilesReferenceDistances: [
    { label: 'London to Paris', km: 344 },
    { label: 'New York to Boston', km: 306 },
    { label: 'the length of Route 66', km: 3_945 },
  ],
};

export const DEFAULT_PRICES_CONFIG: PricesConfig = {
  currency: 'EUR',
  categoryPrices: {
    beer: 5,
    wine: 7,
    cocktail: 11,
    spirit: 7,
    shot: 5,
    cider: 6,
    seltzer: 5,
    soft: 3,
    other: 6,
  },
  gdpComparison: { referenceCountry: 'Malta', gdpPerSecondEUR: 466 },
};

export interface AbsurdUnitResult {
  key: AbsurdUnitKey;
  value: number;
  displayAs: 'count' | 'percent' | 'minutes';
}

export interface PaceTwinResult {
  partnerId: string;
  matchPct: number;
  bestDay: number;
}

export interface BehaviourFeatures {
  stdCV: number;
  lateShotShare: number;
  ratingsCount: number;
  premiumShare: number;
  uniqueDrinks: number;
  avgSessionSpanMin: number;
  firstHourShare: number;
  softShare: number;
  topDrinkShare: number;
  afterMidnightShare: number;
  venueCount: number;
  cheersTotal: number;
}

export type ArchetypeKey =
  | 'metronome'
  | 'chaos'
  | 'connoisseur'
  | 'explorer'
  | 'tortoise'
  | 'speedrunner'
  | 'designated'
  | 'loyalist'
  | 'night_owl'
  | 'social';

export interface ArchetypeResult {
  main: ArchetypeKey;
  secondary: ArchetypeKey;
}

export const ARCHETYPE_ORDER: ArchetypeKey[] = [
  'metronome',
  'chaos',
  'connoisseur',
  'explorer',
  'tortoise',
  'speedrunner',
  'designated',
  'loyalist',
  'night_owl',
  'social',
];

const ABSURD_TIE_BREAK_ORDER: AbsurdUnitKey[] = [
  'bathtub',
  'pub_keg',
  'olympic_pool',
  'tanker_truck',
  'fire_hydrant',
];

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function makeCard(
  id: string,
  vars: Record<string, WrappedValue>,
  data?: Record<string, unknown>,
  key = id,
): WrappedCard {
  return data === undefined ? { id, key, vars } : { id, key, vars, data };
}

export function funniestAbsurdUnit(volumeL: number, config: ComparisonsConfig): AbsurdUnitResult {
  if (volumeL <= 0) throw new Error('funniestAbsurdUnit requires a positive volume');
  return ABSURD_TIE_BREAK_ORDER.map((key) => {
    const unit = config.absurdUnits[key];
    const raw =
      unit.displayAs === 'percent' ? (volumeL / unit.volumeL) * 100 : volumeL / unit.volumeL;
    return {
      key,
      displayAs: unit.displayAs,
      raw,
      score: Math.abs(Math.log(raw) - Math.log(3)),
    };
  })
    .sort(
      (left, right) =>
        left.score - right.score ||
        ABSURD_TIE_BREAK_ORDER.indexOf(left.key) - ABSURD_TIE_BREAK_ORDER.indexOf(right.key),
    )
    .map(({ key, displayAs, raw }) => ({
      key,
      displayAs,
      value: round(raw, displayAs === 'percent' ? 0 : 1),
    }))[0]!;
}

export function absurdUnitPhrase(result: AbsurdUnitResult): string {
  switch (result.key) {
    case 'bathtub':
      return `${result.value} bathtubs`;
    case 'olympic_pool':
      return `${result.value}% of an Olympic pool`;
    case 'pub_keg':
      return `${result.value} pub kegs`;
    case 'tanker_truck':
      return `${result.value} tanker trucks`;
    case 'fire_hydrant':
      return `${result.value} minutes of fire hydrant flow`;
  }
}

export function brandLoyalty(drinks: readonly DerivedDrink[]): {
  drinkKey: string;
  label: string;
  sharePct: number;
} {
  const top = topDrinks(drinks, 1)[0];
  const total = sumVolume(drinks).drinkCount;
  if (!top || total === 0) throw new Error('brandLoyalty requires at least one drink');
  return {
    drinkKey: top.drinkKey,
    label: top.label,
    sharePct: (top.drinkCount / total) * 100,
  };
}

export function adventurousness(drinks: readonly DerivedDrink[]): number {
  return new Set(drinks.map((drink) => drink.drinkKey)).size;
}

export function dailyStdVector(drinks: readonly DerivedDrink[], elapsedDays: number): number[] {
  const vector = Array.from({ length: Math.max(0, elapsedDays) }, () => 0);
  for (const drink of drinks) {
    if (drink.tripDay >= 1 && drink.tripDay <= vector.length) {
      vector[drink.tripDay - 1]! += drink.stdDrinks;
    }
  }
  return vector;
}

export function paceTwin(
  memberId: string,
  vectors: ReadonlyMap<string, readonly number[]>,
): PaceTwinResult | null {
  const own = vectors.get(memberId);
  if (!own) return null;
  const ownNorm = Math.sqrt(own.reduce((sum, value) => sum + value ** 2, 0));
  if (ownNorm === 0) return null;

  const candidates = [...vectors.entries()]
    .filter(([userId]) => userId !== memberId)
    .map(([userId, vector]) => {
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
      if (norm === 0) return null;
      const length = Math.max(own.length, vector.length);
      let dot = 0;
      let bestProduct = Number.NEGATIVE_INFINITY;
      let bestDay = 1;
      for (let index = 0; index < length; index += 1) {
        const product = (own[index] ?? 0) * (vector[index] ?? 0);
        dot += product;
        if (product > bestProduct) {
          bestProduct = product;
          bestDay = index + 1;
        }
      }
      return {
        partnerId: userId,
        matchPct: round((dot / (ownNorm * norm)) * 100, 0),
        bestDay,
      };
    })
    .filter((candidate): candidate is PaceTwinResult => candidate !== null)
    .sort(
      (left, right) =>
        right.matchPct - left.matchPct || left.partnerId.localeCompare(right.partnerId),
    );
  return candidates[0] ?? null;
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function computeFeatures(
  memberDrinks: readonly DerivedDrink[],
  allDrinks: readonly DerivedDrink[],
  trip: TripMeta,
): BehaviourFeatures {
  if (memberDrinks.some((drink) => drink.tripId !== trip.id)) {
    throw new Error('computeFeatures received a drink from another trip');
  }
  const totals = sumVolume(memberDrinks);
  const dayBuckets = byDay(memberDrinks);
  const sessions = new Map<number, DerivedDrink[]>();
  for (const drink of memberDrinks) {
    const day = sessions.get(drink.tripDay) ?? [];
    day.push(drink);
    sessions.set(drink.tripDay, day);
  }
  const spans = [...sessions.values()]
    .filter((day) => day.length >= 2)
    .map((day) => (day.at(-1)!.drunkAt - day[0]!.drunkAt) / 60_000);
  const firstHourShares = [...sessions.values()].map((day) => {
    const dayStd = day.reduce((sum, drink) => sum + drink.stdDrinks, 0);
    if (dayStd === 0) return 0;
    const firstAt = day[0]!.drunkAt;
    return (
      day
        .filter((drink) => drink.drunkAt - firstAt <= 3_600_000)
        .reduce((sum, drink) => sum + drink.stdDrinks, 0) / dayStd
    );
  });
  const loyalty = totals.drinkCount === 0 ? null : brandLoyalty(memberDrinks);
  const stdTotal = totals.stdDrinks;
  const premiumStd = memberDrinks.reduce((sum, drink) => {
    if (drink.category === 'wine' || drink.category === 'cocktail') {
      return sum + drink.stdDrinks;
    }
    if (drink.category === 'spirit') return sum + drink.stdDrinks * 0.5;
    return sum;
  }, 0);
  const lateShotStd = memberDrinks
    .filter((drink) => drink.category === 'shot' && drink.localHour >= 22)
    .reduce((sum, drink) => sum + drink.stdDrinks, 0);
  const softQty = memberDrinks
    .filter((drink) => drink.category === 'soft')
    .reduce((sum, drink) => sum + drink.qty, 0);
  const afterMidnightQty = memberDrinks
    .filter((drink) => drink.localHour < 4)
    .reduce((sum, drink) => sum + drink.qty, 0);

  return {
    stdCV: coefficientOfVariation(dayBuckets.map((day) => day.stdDrinks)),
    lateShotShare: stdTotal === 0 ? 0 : lateShotStd / stdTotal,
    ratingsCount: memberDrinks.filter((drink) => drink.rating !== null).length,
    premiumShare: stdTotal === 0 ? 0 : premiumStd / stdTotal,
    uniqueDrinks: adventurousness(memberDrinks),
    avgSessionSpanMin:
      spans.length === 0 ? 0 : spans.reduce((sum, value) => sum + value, 0) / spans.length,
    firstHourShare:
      firstHourShares.length === 0
        ? 0
        : firstHourShares.reduce((sum, value) => sum + value, 0) / firstHourShares.length,
    softShare: totals.drinkCount === 0 ? 0 : softQty / totals.drinkCount,
    topDrinkShare: loyalty === null ? 0 : loyalty.sharePct / 100,
    afterMidnightShare: totals.drinkCount === 0 ? 0 : afterMidnightQty / totals.drinkCount,
    venueCount: new Set(
      memberDrinks
        .map((drink) => drink.venueId ?? drink.venueName)
        .filter((venue): venue is string => venue !== null),
    ).size,
    cheersTotal: cheersCount(memberDrinks, allDrinks),
  };
}

function featureZ(value: number, values: readonly number[]): number {
  const mean = values.reduce((sum, item) => sum + item, 0) / Math.max(values.length, 1);
  const variance =
    values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / Math.max(values.length, 1);
  const denominator = Math.max(Math.sqrt(variance), 0.05 * Math.max(mean, 1));
  return Math.min(3, Math.max(-3, (value - mean) / denominator));
}

export function classifyArchetype(
  features: BehaviourFeatures,
  groupFeatures: readonly BehaviourFeatures[],
): ArchetypeResult {
  const z = (key: keyof BehaviourFeatures): number =>
    featureZ(
      features[key],
      groupFeatures.map((group) => group[key]),
    );
  const scores: Record<ArchetypeKey, number> = {
    metronome: -z('stdCV'),
    chaos: z('stdCV') + z('lateShotShare'),
    connoisseur: z('ratingsCount') + z('premiumShare'),
    explorer: z('uniqueDrinks'),
    tortoise: z('avgSessionSpanMin') - z('firstHourShare'),
    speedrunner: z('firstHourShare') - z('avgSessionSpanMin'),
    designated: z('softShare'),
    loyalist: z('topDrinkShare'),
    night_owl: z('afterMidnightShare'),
    social: z('venueCount') + z('cheersTotal'),
  };
  const ordered = [...ARCHETYPE_ORDER].sort(
    (left, right) =>
      scores[right] - scores[left] ||
      ARCHETYPE_ORDER.indexOf(left) - ARCHETYPE_ORDER.indexOf(right),
  );
  return { main: ordered[0]!, secondary: ordered[1]! };
}

function haversineKm(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = radians(right.lat - left.lat);
  const dLng = radians(right.lng - left.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeDistance(route: ReadonlyArray<{ lat: number; lng: number }>): number {
  let distance = 0;
  for (let index = 1; index < route.length; index += 1) {
    distance += haversineKm(route[index - 1]!, route[index]!);
  }
  return distance;
}

function estimatedSpend(drinks: readonly DerivedDrink[], prices: PricesConfig): number {
  return drinks.reduce((sum, drink) => sum + prices.categoryPrices[drink.category] * drink.qty, 0);
}

export function buildPersonalWrapped(
  input: SnapshotInput,
  userId: string,
  snapshotAt: number,
  config: PersonalMetricsConfig = {},
): PersonalWrappedPayload {
  if (!input.members.some((member) => member.userId === userId)) {
    throw new Error(`Unknown trip member: ${userId}`);
  }

  const comparisons = config.comparisons ?? DEFAULT_COMPARISONS_CONFIG;
  const prices = config.prices ?? DEFAULT_PRICES_CONFIG;
  const trip = toTripMeta(input);
  const allDrinks = deriveDrinks(input.drinks, trip);
  const memberDrinks = allDrinks.filter((drink) => drink.userId === userId);
  const totals = sumVolume(memberDrinks);
  const groupTotals = sumVolume(allDrinks);
  const days = elapsedTripDays(trip, snapshotAt);
  const denominatorDays = rankDays(trip, snapshotAt);
  const memberDays = byDay(memberDrinks);
  const ratings = personalRatingRollup(memberDrinks, userId);
  const favourite = topRated(ratings);
  const guilty = guiltyPleasure(ratings, memberDrinks, userId);
  const loyalty = totals.drinkCount === 0 ? null : brandLoyalty(memberDrinks);
  const memberTop = topDrinks(memberDrinks, 1)[0] ?? null;
  const featuresByUser = new Map(
    input.members.map((member) => {
      const drinks = allDrinks.filter((drink) => drink.userId === member.userId);
      return [member.userId, computeFeatures(drinks, allDrinks, trip)] as const;
    }),
  );
  const features = featuresByUser.get(userId)!;
  const archetype = classifyArchetype(features, [...featuresByUser.values()]);
  const vectors = new Map(
    input.members.map((member) => [
      member.userId,
      dailyStdVector(
        allDrinks.filter((drink) => drink.userId === member.userId),
        denominatorDays,
      ),
    ]),
  );
  const twin = paceTwin(userId, vectors);

  const card01 = makeCard('01_cold_open', {
    totalDrinks: totals.drinkCount,
    days,
  });

  const card02 =
    totals.litres === 0
      ? makeCard(
          '02_absurd_units',
          { litres: 0, ukPints: 0, std: 0 },
          undefined,
          '02_absurd_units.empty',
        )
      : (() => {
          const absurd = funniestAbsurdUnit(totals.litres, comparisons);
          return makeCard('02_absurd_units', {
            litres: round(totals.litres, 2),
            ukPints: round(totals.ukPints, 1),
            std: round(totals.stdDrinks, 1),
            absurdValue: absurd.value,
            absurdUnitPhrase: absurdUnitPhrase(absurd),
          });
        })();

  const card03 = makeCard(
    '03_guess_ethanol',
    { diff: 0 },
    { actualEthanolL: totals.ethanolLitres },
  );

  const share = shareOfGroupAlcohol(totals.grams, groupTotals.grams);
  const card04 =
    totals.drinkCount === 0 || share === 0
      ? makeCard(
          '04_abv_share',
          { avgAbv: weightedAvgAbv(memberDrinks), share },
          undefined,
          '04_abv_share.empty',
        )
      : makeCard('04_abv_share', {
          avgAbv: weightedAvgAbv(memberDrinks),
          share: round(share, 0),
          oneIn: Math.round(100 / share),
        });

  const card05 =
    memberDays.length === 0
      ? null
      : (() => {
          const busiest = peakDay(memberDays);
          const peakDrinks = memberDrinks.filter((drink) => drink.tripDay === busiest.tripDay);
          const busiestHour = [...byHour(peakDrinks)].sort(
            (left, right) => right.stdDrinks - left.stdDrinks || left.hour - right.hour,
          )[0]!;
          return makeCard('05_peak_day', {
            peakDay: busiest.tripDay,
            peakDrinks: busiest.drinkCount,
            peakVenues: byVenue(peakDrinks).length,
            peakDrink: topDrinks(peakDrinks, 1)[0]?.label ?? '',
            peakTime: busiestHour.hour,
          });
        })();

  const route = memberDrinks
    .filter(
      (drink): drink is DerivedDrink & { lat: number; lng: number } =>
        drink.lat !== null && drink.lng !== null,
    )
    .map((drink) => ({ lat: drink.lat, lng: drink.lng }));
  const venueBuckets = byVenue(memberDrinks);
  const visits = memberVisitCount(memberDrinks);
  const topVisit = [...visits.entries()].sort(
    ([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId),
  )[0];
  const topVenue =
    (topVisit ? input.venues.find((venue) => venue.id === topVisit[0])?.name : undefined) ??
    venueBuckets[0]?.label ??
    '';
  const card06 =
    venueBuckets.length === 0 && route.length === 0
      ? makeCard(
          '06_trail',
          { venue: '', visits: 0, km: 0 },
          { route: [], venuePins: [] },
          '06_trail.empty',
        )
      : makeCard(
          '06_trail',
          {
            venue: topVenue,
            visits: topVisit?.[1] ?? 0,
            km: round(routeDistance(route), 1),
          },
          {
            route,
            venuePins: input.venues
              .filter((venue) => memberDrinks.some((drink) => drink.venueId === venue.id))
              .map((venue) => ({
                venueId: venue.id,
                name: venue.name,
                lat: venue.lat,
                lng: venue.lng,
              })),
          },
        );

  const card07 =
    favourite === null
      ? null
      : guilty === null
        ? makeCard(
            '07_top_then_guilty',
            { topRated: favourite.label, topRatingValue: round(favourite.avg, 1) },
            undefined,
            '07_top_then_guilty.noGuilty',
          )
        : makeCard('07_top_then_guilty', {
            topRated: favourite.label,
            topRatingValue: round(favourite.avg, 1),
            guilty: guilty.label,
            guiltyRatingValue: round(guilty.avg, 1),
            guiltyCount: memberDrinks
              .filter((drink) => drink.drinkKey === guilty.drinkKey)
              .reduce((sum, drink) => sum + drink.qty, 0),
          });

  const loyaltyValues = input.members.map((member) => {
    const drinks = allDrinks.filter((drink) => drink.userId === member.userId);
    return {
      loyalty: drinks.length === 0 ? 0 : brandLoyalty(drinks).sharePct,
      unique: adventurousness(drinks),
    };
  });
  const card08 =
    loyalty === null
      ? null
      : makeCard('08_loyal_or_adventurous', {
          topDrink: loyalty.label,
          topShare: round(loyalty.sharePct, 0),
          unique: features.uniqueDrinks,
          verdict:
            featureZ(
              loyalty.sharePct,
              loyaltyValues.map((value) => value.loyalty),
            ) >=
            featureZ(
              features.uniqueDrinks,
              loyaltyValues.map((value) => value.unique),
            )
              ? 'loyal'
              : 'adventurous',
        });

  const liverKm = Math.round(totals.ethanolLitres * comparisons.liverMilesKmPerL);
  const reference = [...comparisons.liverMilesReferenceDistances].sort(
    (left, right) =>
      Math.abs(left.km - liverKm) - Math.abs(right.km - liverKm) ||
      left.label.localeCompare(right.label),
  )[0];
  const spend = estimatedSpend(memberDrinks, prices);
  const card09 = makeCard('09_absurd_run', {
    km: liverKm,
    place: reference?.label ?? '',
    spend: round(spend, 2),
    gdpShare:
      prices.gdpComparison.gdpPerSecondEUR === 0
        ? 0
        : round((spend / prices.gdpComparison.gdpPerSecondEUR) * 100, 1),
    country: prices.gdpComparison.referenceCountry,
  });

  const card10 =
    twin === null
      ? null
      : makeCard('10_pace_twin', {
          twinUserId: twin.partnerId,
          day: twin.bestDay,
          matchPct: twin.matchPct,
        });

  const achievements = input.achievementUnlocks
    .filter((unlock) => unlock.triggeredByUserId === userId)
    .sort((left, right) => left.unlockedAt - right.unlockedAt || left.key.localeCompare(right.key))
    .map(({ key, unlockedAt }) => ({ key, unlockedAt }));
  const card11 =
    achievements.length === 0
      ? null
      : makeCard('11_achievements', { n: achievements.length }, { achievements });

  const prediction = input.predictions.find((row) => row.userId === userId);
  const card12 =
    prediction === undefined
      ? null
      : makeCard('12_prediction_vs_reality', {
          predicted: prediction.myTotalStd,
          actual: round(totals.stdDrinks, 1),
        });

  const perDay = stdPerDay(totals.stdDrinks, denominatorDays);
  const card13 = makeCard('13_rank', { perDay: round(perDay, 1) });
  const card14 = makeCard(
    '14_archetype',
    {
      archetype: archetype.main,
      secondary: archetype.secondary,
      twinUserId: twin?.partnerId ?? null,
      perDay: round(perDay, 1),
      days,
      ratings: features.ratingsCount,
      unique: features.uniqueDrinks,
      softShare: round(features.softShare * 100, 0),
      topDrink: memberTop?.label ?? '',
      topCount: memberTop?.drinkCount ?? 0,
      afterMidnight: round(features.afterMidnightShare * 100, 0),
      venues: features.venueCount,
      cheers: features.cheersTotal,
    },
    undefined,
    twin === null ? '14_archetype.noPartner' : '14_archetype',
  );

  return {
    schemaVersion: 1,
    tripId: input.trip.id,
    userId,
    context: {
      days,
      members: input.members.length,
      ownerId: input.trip.ownerId,
      tripName: input.trip.name,
    },
    cards: [
      card01,
      card02,
      card03,
      card04,
      card05,
      card06,
      card07,
      card08,
      card09,
      card10,
      card11,
      card12,
      card13,
      card14,
    ],
  };
}
