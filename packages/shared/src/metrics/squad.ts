import { tripLengthDays } from '../tripDays.js';
import { rankMembers } from '../rank.js';
import { byCity, byDay, byVenue, memberVisitCount, topDrinks } from './distribution.js';
import { deriveDrinks, normalizeDrinkName } from './derive.js';
import {
  adventurousness,
  classifyArchetype,
  computeFeatures,
  dailyStdVector,
  DEFAULT_COMPARISONS_CONFIG,
  funniestAbsurdUnit,
} from './personal.js';
import { cheersCount, drinkRating2 } from './rating2.js';
import { crowdFavourite, groupRatingRollup, mostDivisive } from './ratings.js';
import { rankDays } from './ranks.js';
import { sumVolume } from './totals.js';
import { toTripMeta } from './types.js';
import type { ArchetypeResult, BehaviourFeatures, ComparisonsConfig } from './personal.js';
import type {
  DerivedDrink,
  DrinkCategory,
  Prediction,
  SnapshotInput,
  SnapshotMember,
  TripMeta,
  WrappedCard,
  WrappedValue,
} from './types.js';

export const SIDE_LEADERBOARD_KEYS = [
  'most_drinks',
  'most_litres',
  'most_variety',
  'best_pacer',
  'earliest_first',
  'latest_last',
  'longest_streak',
] as const;

export type SideLeaderboardKey = (typeof SIDE_LEADERBOARD_KEYS)[number];

export const AWARD_PRIORITY = [
  'most_std',
  'best_predictions',
  'most_unique',
  'highest_rating',
  'lowest_rating',
  'most_shots',
  'fanciest',
  'most_consistent',
  'comeback',
  'venue_loyal',
  'earliest_first',
  'latest_last',
  'least_logged',
] as const;

export type AwardKey = (typeof AWARD_PRIORITY)[number];

export const FANCY_WEIGHT: Record<DrinkCategory, number> = {
  wine: 1,
  cocktail: 1,
  spirit: 0.6,
  other: 0.3,
  shot: 0.2,
  beer: 0.1,
  cider: 0.1,
  seltzer: 0.05,
  soft: 0,
};

export interface RankedRow {
  userId: string;
  rank: number;
  value: number;
}

export interface MainBoardRow extends RankedRow {
  litres: number;
  std: number;
  drinks: number;
  k: number;
  a: number;
  d: number;
  rating: number;
}

export interface HourPoint {
  hourIndex: number;
  std: number;
  localLabel: string;
}

export interface Incident {
  hourIndex: number;
  std: number;
  rank: number;
}

export interface ReplayEvent {
  tOffsetMs: number;
  memberIndex: number;
  lat: number | null;
  lng: number | null;
  std: number;
}

export interface ReplayPayload {
  schemaVersion: 1;
  memberIndex: string[];
  totalPlaybackMs: number;
  events: ReplayEvent[];
  dayEndMarkers: Array<{
    tOffsetMs: number;
    tripDay: number;
    nightMvpIndex: number;
  }>;
  achievementPops: Array<{
    tOffsetMs: number;
    memberIndex: number;
    key: string;
  }>;
}

export interface OracleScore {
  userId: string;
  score: number;
  q1Err: number;
  lockedAt: number;
}

export interface AwardWinner {
  award: AwardKey;
  userId: string;
  isCoWinner: boolean;
}

export interface AwardCard {
  award: AwardKey;
  winners: Array<{ userId: string; venue?: string }>;
  isGhostSlot: boolean;
}

export interface PredictionRevealRow {
  userId: string;
  predicted: number;
  actual: number;
}

export interface Bloopers {
  smallest: { drink: DerivedDrink; userId: string } | null;
  strangestNote: { note: string; drink: DerivedDrink; userId: string } | null;
  mostEdited: { drink: DerivedDrink; userId: string; edits: number } | null;
  loneWater: { drink: DerivedDrink; userId: string } | null;
}

export interface MemberMetrics {
  userId: string;
  name: string;
  joinedAt: number;
  drinks: DerivedDrink[];
  drinkCount: number;
  stdDrinks: number;
  litres: number;
  uniqueDrinks: number;
  activeDayStd: number[];
  dailyStd: number[];
  cv: number;
  firstDrinkAt: number | null;
  lastDrinkAt: number | null;
  longestStreak: number;
  shotStd: number;
  fancyScore: number;
  ratingAvg: number | null;
  ratingCount: number;
  comeback: { day: number; delta: number } | null;
  topVenue: { venueId: string; venue: string; visits: number } | null;
  totalVisits: number;
}

export interface SquadMetricsConfig {
  comparisons?: ComparisonsConfig;
}

type SquadCard = WrappedCard<Record<string, WrappedValue>, Record<string, unknown>>;

export interface SquadWrappedPayload {
  schemaVersion: 1;
  tripId: string;
  cards: [
    SquadCard,
    SquadCard,
    SquadCard,
    SquadCard,
    SquadCard,
    SquadCard,
    SquadCard,
    SquadCard,
    {
      id: '09_awards';
      winners: AwardCard[];
    },
    SquadCard,
    SquadCard,
  ];
}

interface AwardRanking {
  award: AwardKey;
  candidates: MemberMetrics[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function makeCard(
  id: string,
  vars: Record<string, WrappedValue> = {},
  data?: Record<string, unknown>,
  key = id,
): SquadCard {
  return data === undefined ? { id, key, vars } : { id, key, vars, data };
}

export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function longestAlcoholStreak(drinks: readonly DerivedDrink[]): number {
  const days = [
    ...new Set(
      drinks
        .filter((drink) => drink.isAlcoholic)
        .map((drink) => drink.tripDay)
        .sort((left, right) => left - right),
    ),
  ];
  let best = 0;
  let current = 0;
  let previous: number | null = null;
  for (const day of days) {
    current = previous !== null && day === previous + 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = day;
  }
  return best;
}

export function fanciestScore(drinks: readonly DerivedDrink[]): number {
  return drinks.reduce((sum, drink) => sum + FANCY_WEIGHT[drink.category] * drink.stdDrinks, 0);
}

export function comebackDelta(dailyStd: readonly number[]): { day: number; delta: number } | null {
  const activeDays = dailyStd.filter((value) => value > 0);
  if (activeDays.length < 2) return null;
  const mean = activeDays.reduce((sum, value) => sum + value, 0) / activeDays.length;
  const candidates = dailyStd
    .map((value, index) => ({
      day: index + 1,
      delta: index === 0 ? Number.NEGATIVE_INFINITY : value - dailyStd[index - 1]!,
      previous: index === 0 ? Number.POSITIVE_INFINITY : dailyStd[index - 1]!,
    }))
    .filter((row) => row.day > 1 && row.delta > 0 && row.previous < mean);
  return (
    candidates.sort((left, right) => right.delta - left.delta || left.day - right.day)[0] ?? null
  );
}

function memberMetrics(
  member: SnapshotMember,
  drinks: DerivedDrink[],
  days: number,
  venues: SnapshotInput['venues'],
): MemberMetrics {
  const totals = sumVolume(drinks);
  const activeDayStd = byDay(drinks).map((day) => day.stdDrinks);
  const visits = memberVisitCount(drinks);
  const topVisit = [...visits.entries()].sort(
    ([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId),
  )[0];
  const rated = drinks.filter((drink) => drink.rating !== null);
  const dailyStd = dailyStdVector(drinks, days);
  return {
    userId: member.userId,
    name: member.name,
    joinedAt: member.joinedAt,
    drinks,
    drinkCount: totals.drinkCount,
    stdDrinks: totals.stdDrinks,
    litres: totals.litres,
    uniqueDrinks: adventurousness(drinks),
    activeDayStd,
    dailyStd,
    cv: coefficientOfVariation(activeDayStd),
    firstDrinkAt: drinks[0]?.drunkAt ?? null,
    lastDrinkAt: drinks.at(-1)?.drunkAt ?? null,
    longestStreak: longestAlcoholStreak(drinks),
    shotStd: drinks
      .filter((drink) => drink.category === 'shot')
      .reduce((sum, drink) => sum + drink.stdDrinks, 0),
    fancyScore: fanciestScore(drinks),
    ratingAvg:
      rated.length === 0
        ? null
        : rated.reduce((sum, drink) => sum + drink.rating!, 0) / rated.length,
    ratingCount: rated.length,
    comeback: comebackDelta(dailyStd),
    topVenue:
      topVisit === undefined
        ? null
        : {
            venueId: topVisit[0],
            venue: venues.find((venue) => venue.id === topVisit[0])?.name ?? topVisit[0],
            visits: topVisit[1],
          },
    totalVisits: [...visits.values()].reduce((sum, value) => sum + value, 0),
  };
}

function rankedRows(
  members: readonly MemberMetrics[],
  value: (member: MemberMetrics) => number,
  compare: (left: MemberMetrics, right: MemberMetrics) => number,
  eligible: (member: MemberMetrics) => boolean = () => true,
): RankedRow[] {
  return members
    .filter(eligible)
    .sort(compare)
    .map((member, index) => ({
      userId: member.userId,
      rank: index + 1,
      value: value(member),
    }));
}

export function buildSideLeaderboard(
  key: SideLeaderboardKey,
  members: readonly MemberMetrics[],
): RankedRow[] {
  const stdTie = (left: MemberMetrics, right: MemberMetrics): number =>
    right.stdDrinks - left.stdDrinks || left.userId.localeCompare(right.userId);
  switch (key) {
    case 'most_drinks':
      return rankedRows(
        members,
        (member) => member.drinkCount,
        (left, right) => right.drinkCount - left.drinkCount || stdTie(left, right),
      );
    case 'most_litres':
      return rankedRows(
        members,
        (member) => member.litres,
        (left, right) => right.litres - left.litres || stdTie(left, right),
      );
    case 'most_variety':
      return rankedRows(
        members,
        (member) => member.uniqueDrinks,
        (left, right) => right.uniqueDrinks - left.uniqueDrinks || stdTie(left, right),
      );
    case 'best_pacer':
      return rankedRows(
        members,
        (member) => member.cv,
        (left, right) => left.cv - right.cv || stdTie(left, right),
        (member) => member.activeDayStd.length > 0,
      );
    case 'earliest_first':
      return rankedRows(
        members,
        (member) => member.firstDrinkAt!,
        (left, right) =>
          left.firstDrinkAt! - right.firstDrinkAt! || left.userId.localeCompare(right.userId),
        (member) => member.firstDrinkAt !== null,
      );
    case 'latest_last':
      return rankedRows(
        members,
        (member) => member.lastDrinkAt!,
        (left, right) =>
          right.lastDrinkAt! - left.lastDrinkAt! || left.userId.localeCompare(right.userId),
        (member) => member.lastDrinkAt !== null,
      );
    case 'longest_streak':
      return rankedRows(
        members,
        (member) => member.longestStreak,
        (left, right) => right.longestStreak - left.longestStreak || stdTie(left, right),
      );
  }
}

function absoluteHour(drink: DerivedDrink): number {
  return (drink.tripDay - 1) * 24 + ((drink.localHour - 6 + 24) % 24);
}

export function groupHourlySeries(drinks: readonly DerivedDrink[], trip: TripMeta): HourPoint[] {
  const hours = Math.max(1, tripLengthDays(trip.startDate, trip.endDate) * 24);
  const series = Array.from({ length: hours }, (_, hourIndex) => ({
    hourIndex,
    std: 0,
    localLabel: `${Math.floor(hourIndex / 24) + 1}:${(hourIndex + 6) % 24}`,
  }));
  for (const drink of drinks) {
    const hourIndex = absoluteHour(drink);
    if (hourIndex >= 0 && hourIndex < series.length) {
      series[hourIndex]!.std += drink.stdDrinks;
    }
  }
  return series;
}

export function detectIncidents(
  series: readonly HourPoint[],
  opts: { topN?: number; minSeparationHours?: number } = {},
): Incident[] {
  const topN = opts.topN ?? 5;
  const minSeparation = opts.minSeparationHours ?? 3;
  const accepted: Incident[] = [];
  for (const point of [...series].sort(
    (left, right) => right.std - left.std || left.hourIndex - right.hourIndex,
  )) {
    if (point.std <= 0 || accepted.length >= topN) break;
    if (
      accepted.every((incident) => Math.abs(incident.hourIndex - point.hourIndex) >= minSeparation)
    ) {
      accepted.push({ hourIndex: point.hourIndex, std: point.std, rank: accepted.length + 1 });
    }
  }
  return accepted.sort((left, right) => left.hourIndex - right.hourIndex);
}

interface ReplayBeat {
  active: boolean;
  hours: number[];
  rawWeight: number;
  duration: number;
  start: number;
}

function buildReplayBeats(series: readonly HourPoint[], targetMs: number): ReplayBeat[] {
  const beats: ReplayBeat[] = [];
  for (let index = 0; index < series.length;) {
    const point = series[index]!;
    if (point.std > 0) {
      beats.push({
        active: true,
        hours: [point.hourIndex],
        rawWeight: Math.sqrt(point.std + 1),
        duration: 0,
        start: 0,
      });
      index += 1;
      continue;
    }
    const hours: number[] = [];
    while (index < series.length && series[index]!.std === 0) {
      hours.push(series[index]!.hourIndex);
      index += 1;
    }
    beats.push({ active: false, hours, rawWeight: 1, duration: 0, start: 0 });
  }

  const desired = Math.min(90_000, Math.max(60_000, targetMs));
  const rawTotal = beats.reduce((sum, beat) => sum + beat.rawWeight, 0);
  for (const beat of beats) {
    beat.duration = (beat.rawWeight / Math.max(rawTotal, 1)) * desired;
  }

  const floored = beats.filter((beat) => beat.active && beat.duration < 300);
  for (const beat of floored) beat.duration = 300;
  let total = beats.reduce((sum, beat) => sum + beat.duration, 0);
  if (total > 90_000) {
    const flexible = beats.filter((beat) => beat.active && beat.duration > 300);
    const flexibleRoom = flexible.reduce((sum, beat) => sum + beat.duration - 300, 0);
    const reclaim = Math.min(total - 90_000, flexibleRoom);
    if (reclaim > 0 && flexibleRoom > 0) {
      for (const beat of flexible) {
        beat.duration -= reclaim * ((beat.duration - 300) / flexibleRoom);
      }
      total -= reclaim;
    }
  }
  if (total < 60_000) {
    const multiplier = 60_000 / Math.max(total, 1);
    for (const beat of beats) beat.duration *= multiplier;
  }

  let cursor = 0;
  for (const beat of beats) {
    beat.start = cursor;
    cursor += beat.duration;
  }
  return beats;
}

function nightMvp(
  drinks: readonly DerivedDrink[],
  members: readonly SnapshotMember[],
): { userId: string; std: number } | null {
  const byMember = new Map<string, { std: number; first: number }>();
  for (const drink of drinks) {
    const row = byMember.get(drink.userId) ?? {
      std: 0,
      first: drink.drunkAt,
    };
    row.std += drink.stdDrinks;
    row.first = Math.min(row.first, drink.drunkAt);
    byMember.set(drink.userId, row);
  }
  return (
    [...byMember.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftName = members.find((member) => member.userId === leftId)?.name ?? leftId;
        const rightName = members.find((member) => member.userId === rightId)?.name ?? rightId;
        return (
          right.std - left.std ||
          leftName.localeCompare(rightName) ||
          left.first - right.first ||
          leftId.localeCompare(rightId)
        );
      })
      .map(([userId, row]) => ({ userId, std: row.std }))[0] ?? null
  );
}

function offsetForInstant(
  instant: number,
  sortedDrinks: readonly DerivedDrink[],
  events: readonly ReplayEvent[],
  totalPlaybackMs: number,
): number {
  if (events.length === 0) return 0;
  const index = sortedDrinks.findIndex((drink) => drink.drunkAt >= instant);
  if (index < 0) return totalPlaybackMs;
  return events[index]!.tOffsetMs;
}

export function computeReplayTimeline(
  drinks: readonly DerivedDrink[],
  trip: TripMeta,
  members: readonly SnapshotMember[],
  achievementUnlocks: SnapshotInput['achievementUnlocks'] = [],
  opts: { targetMs?: number } = {},
): ReplayPayload {
  const memberIndex = [...trip.memberIds];
  if (drinks.length === 0) {
    return {
      schemaVersion: 1,
      memberIndex,
      totalPlaybackMs: 60_000,
      events: [],
      dayEndMarkers: [],
      achievementPops: [],
    };
  }
  const series = groupHourlySeries(drinks, trip);
  const beats = buildReplayBeats(series, opts.targetMs ?? 75_000);
  const beatByHour = new Map(
    beats.flatMap((beat) => beat.hours.map((hour) => [hour, beat] as const)),
  );
  const drinksByHour = new Map<number, DerivedDrink[]>();
  for (const drink of drinks) {
    const hour = absoluteHour(drink);
    const rows = drinksByHour.get(hour) ?? [];
    rows.push(drink);
    drinksByHour.set(hour, rows);
  }
  const events = drinks.map((drink) => {
    const hour = absoluteHour(drink);
    const beat = beatByHour.get(hour)!;
    const rows = drinksByHour.get(hour)!;
    const position = rows.findIndex((row) => row.id === drink.id);
    return {
      tOffsetMs: Math.round(beat.start + (beat.duration * (position + 1)) / (rows.length + 1)),
      memberIndex: memberIndex.indexOf(drink.userId),
      lat: drink.lat,
      lng: drink.lng,
      std: drink.stdDrinks,
    };
  });
  const totalPlaybackMs = Math.round(beats.reduce((sum, beat) => sum + beat.duration, 0));
  const dayEndMarkers = [...new Set(drinks.map((drink) => drink.tripDay))]
    .sort((left, right) => left - right)
    .map((tripDay) => {
      const dayDrinks = drinks.filter((drink) => drink.tripDay === tripDay);
      const lastDrink = dayDrinks.at(-1)!;
      const lastIndex = drinks.findIndex((drink) => drink.id === lastDrink.id);
      const winner = nightMvp(dayDrinks, members)!;
      return {
        tOffsetMs: events[lastIndex]!.tOffsetMs,
        tripDay,
        nightMvpIndex: memberIndex.indexOf(winner.userId),
      };
    });
  const achievementPops = [...achievementUnlocks]
    .sort(
      (left, right) =>
        left.unlockedAt - right.unlockedAt ||
        left.key.localeCompare(right.key) ||
        left.triggeredByUserId.localeCompare(right.triggeredByUserId),
    )
    .map((unlock) => ({
      tOffsetMs: offsetForInstant(unlock.unlockedAt, drinks, events, totalPlaybackMs),
      memberIndex: memberIndex.indexOf(unlock.triggeredByUserId),
      key: unlock.key,
    }))
    .filter((pop) => pop.memberIndex >= 0);
  return {
    schemaVersion: 1,
    memberIndex,
    totalPlaybackMs,
    events,
    dayEndMarkers,
    achievementPops,
  };
}

function actualTopMember(members: readonly MemberMetrics[]): MemberMetrics | null {
  return (
    [...members].sort(
      (left, right) =>
        right.stdDrinks - left.stdDrinks ||
        right.drinkCount - left.drinkCount ||
        left.joinedAt - right.joinedAt ||
        left.userId.localeCompare(right.userId),
    )[0] ?? null
  );
}

function actualLeastMember(members: readonly MemberMetrics[]): MemberMetrics | null {
  return (
    [...members].sort(
      (left, right) =>
        left.stdDrinks - right.stdDrinks ||
        left.drinkCount - right.drinkCount ||
        left.joinedAt - right.joinedAt ||
        left.userId.localeCompare(right.userId),
    )[0] ?? null
  );
}

export function scorePredictions(
  predictions: readonly Prediction[],
  members: readonly MemberMetrics[],
  allDrinks: readonly DerivedDrink[],
): OracleScore[] {
  // q1/q2 answers are litres; the field names predate the switch from std drinks.
  const groupLitres = members.reduce((sum, member) => sum + member.litres, 0);
  const topMember = actualTopMember(members);
  const leastMember = actualLeastMember(members);
  const topDrink = topDrinks(allDrinks, 1)[0] ?? null;
  return predictions
    .map((prediction) => {
      const member = members.find((row) => row.userId === prediction.userId);
      const actualSelf = member?.litres ?? 0;
      const q1Err = Math.min(
        1,
        Math.abs(prediction.myTotalStd - actualSelf) / Math.max(actualSelf, 1),
      );
      const q2Err = Math.min(
        1,
        Math.abs(prediction.groupTotalStd - groupLitres) / Math.max(groupLitres, 1),
      );
      const q3Err = prediction.topMemberId === topMember?.userId ? 0 : 1;
      const q4Err = prediction.leastMemberId === leastMember?.userId ? 0 : 1;
      const errors = [q1Err, q2Err, q3Err, q4Err];
      if (topDrink !== null) {
        errors.push(
          prediction.topDrinkCategory === topDrink.category &&
            normalizeDrinkName(prediction.topDrink) === normalizeDrinkName(topDrink.label)
            ? 0
            : 1,
        );
      }
      return {
        userId: prediction.userId,
        score: errors.reduce((sum, value) => sum + value, 0) / errors.length,
        q1Err,
        lockedAt: prediction.lockedAt,
      };
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.q1Err - right.q1Err ||
        left.lockedAt - right.lockedAt ||
        left.userId.localeCompare(right.userId),
    );
}

export function oracle(scores: readonly OracleScore[]): OracleScore | null {
  return (
    [...scores].sort(
      (left, right) =>
        left.score - right.score ||
        left.q1Err - right.q1Err ||
        left.lockedAt - right.lockedAt ||
        left.userId.localeCompare(right.userId),
    )[0] ?? null
  );
}

function awardRankings(
  members: readonly MemberMetrics[],
  predictions: readonly OracleScore[],
): AwardRanking[] {
  const user = (id: string): MemberMetrics => members.find((member) => member.userId === id)!;
  const nonEmpty = members.filter((member) => member.drinkCount > 0);
  const ratingPool = (minimum: number): MemberMetrics[] => {
    const eligible = members.filter(
      (member) => member.ratingAvg !== null && member.ratingCount >= minimum,
    );
    return eligible.length > 0 || minimum === 1 ? eligible : ratingPool(1);
  };
  const sortStd = (left: MemberMetrics, right: MemberMetrics): number =>
    right.stdDrinks - left.stdDrinks ||
    right.drinkCount - left.drinkCount ||
    left.userId.localeCompare(right.userId);
  const rankings: Record<AwardKey, MemberMetrics[]> = {
    most_std: [...nonEmpty].sort(sortStd),
    best_predictions: predictions.map((prediction) => user(prediction.userId)),
    most_unique: [...nonEmpty].sort(
      (left, right) =>
        right.uniqueDrinks - left.uniqueDrinks ||
        right.stdDrinks - left.stdDrinks ||
        left.userId.localeCompare(right.userId),
    ),
    highest_rating: ratingPool(3).sort(
      (left, right) =>
        right.ratingAvg! - left.ratingAvg! ||
        right.ratingCount - left.ratingCount ||
        left.userId.localeCompare(right.userId),
    ),
    lowest_rating: ratingPool(3).sort(
      (left, right) =>
        left.ratingAvg! - right.ratingAvg! ||
        left.ratingCount - right.ratingCount ||
        left.userId.localeCompare(right.userId),
    ),
    most_shots: [...nonEmpty].sort(
      (left, right) =>
        right.shotStd - left.shotStd ||
        right.stdDrinks - left.stdDrinks ||
        left.userId.localeCompare(right.userId),
    ),
    fanciest: [...nonEmpty].sort(
      (left, right) =>
        right.fancyScore - left.fancyScore ||
        right.stdDrinks - left.stdDrinks ||
        left.userId.localeCompare(right.userId),
    ),
    most_consistent: members
      .filter((member) => member.activeDayStd.length >= 2)
      .sort((left, right) => left.cv - right.cv || left.userId.localeCompare(right.userId)),
    comeback: members
      .filter((member) => member.comeback !== null)
      .sort(
        (left, right) =>
          right.comeback!.delta - left.comeback!.delta ||
          left.comeback!.day - right.comeback!.day ||
          left.userId.localeCompare(right.userId),
      ),
    venue_loyal: members
      .filter((member) => member.topVenue !== null)
      .sort(
        (left, right) =>
          right.topVenue!.visits - left.topVenue!.visits ||
          right.totalVisits - left.totalVisits ||
          left.userId.localeCompare(right.userId),
      ),
    earliest_first: [...nonEmpty].sort(
      (left, right) =>
        left.firstDrinkAt! - right.firstDrinkAt! || left.userId.localeCompare(right.userId),
    ),
    latest_last: [...nonEmpty].sort(
      (left, right) =>
        right.lastDrinkAt! - left.lastDrinkAt! || left.userId.localeCompare(right.userId),
    ),
    least_logged: [...members].sort(
      (left, right) =>
        left.drinkCount - right.drinkCount ||
        left.stdDrinks - right.stdDrinks ||
        left.userId.localeCompare(right.userId),
    ),
  };
  return AWARD_PRIORITY.map((award) => ({ award, candidates: rankings[award] }));
}

export function allocateAwards(
  members: readonly MemberMetrics[],
  predictions: readonly OracleScore[],
): AwardWinner[] {
  if (members.length === 0) return [];
  const rankings = awardRankings(members, predictions);
  const winners: AwardWinner[] = [];
  const awarded = new Set<string>();

  for (const ranking of rankings) {
    if (ranking.candidates.length === 0) continue;
    const winner =
      ranking.award === 'most_std'
        ? ranking.candidates[0]!
        : (ranking.candidates.find((candidate) => !awarded.has(candidate.userId)) ??
          ranking.candidates[0]!);
    winners.push({ award: ranking.award, userId: winner.userId, isCoWinner: false });
    awarded.add(winner.userId);
  }

  for (const member of members.filter((candidate) => !awarded.has(candidate.userId))) {
    const eligible = rankings
      .filter((ranking) => ranking.award !== 'most_std')
      .map((ranking) => {
        const position = ranking.candidates.findIndex(
          (candidate) => candidate.userId === member.userId,
        );
        return position < 0
          ? null
          : {
              award: ranking.award,
              percentile: (position + 1) / ranking.candidates.length,
            };
      })
      .filter((row): row is { award: AwardKey; percentile: number } => row !== null)
      .sort(
        (left, right) =>
          left.percentile - right.percentile ||
          AWARD_PRIORITY.indexOf(left.award) - AWARD_PRIORITY.indexOf(right.award),
      );
    winners.push({
      award: eligible[0]?.award ?? 'least_logged',
      userId: member.userId,
      isCoWinner: true,
    });
  }
  return winners;
}

export function orderAwardsForCeremony(winners: readonly AwardWinner[]): AwardWinner[] {
  const withoutMvp = winners.filter(
    (winner) => winner.award !== 'most_std' && winner.award !== 'least_logged',
  );
  const ghosts = winners.filter((winner) => winner.award === 'least_logged');
  const index = Math.floor(withoutMvp.length / 2);
  return [...withoutMvp.slice(0, index), ...ghosts, ...withoutMvp.slice(index)];
}

export function computeBloopers(drinks: readonly DerivedDrink[]): Bloopers {
  const smallest =
    [...drinks].sort(
      (left, right) =>
        left.sizeMl - right.sizeMl ||
        left.drunkAt - right.drunkAt ||
        left.id.localeCompare(right.id),
    )[0] ?? null;
  const strange =
    drinks
      .filter((drink) => drink.note !== null && drink.note.trim().length > 0)
      .sort(
        (left, right) =>
          right.note!.length - left.note!.length ||
          left.drunkAt - right.drunkAt ||
          left.id.localeCompare(right.id),
      )[0] ?? null;
  const edited =
    [...drinks].sort(
      (left, right) =>
        right.editCount - left.editCount ||
        (right.lastEditedAt ?? Number.NEGATIVE_INFINITY) -
          (left.lastEditedAt ?? Number.NEGATIVE_INFINITY) ||
        left.id.localeCompare(right.id),
    )[0] ?? null;
  const water =
    drinks
      .filter((drink) => drink.category === 'soft' && drink.localHour === 4)
      .sort((left, right) => left.drunkAt - right.drunkAt || left.id.localeCompare(right.id))[0] ??
    null;
  return {
    smallest: smallest === null ? null : { drink: smallest, userId: smallest.userId },
    strangestNote:
      strange === null ? null : { note: strange.note!, drink: strange, userId: strange.userId },
    mostEdited:
      edited === null || edited.editCount === 0
        ? null
        : { drink: edited, userId: edited.userId, edits: edited.editCount },
    loneWater: water === null ? null : { drink: water, userId: water.userId },
  };
}

function ratingExtremes(
  drinkKey: string,
  drinks: readonly DerivedDrink[],
): { low: number; lowUserId: string; high: number; highUserId: string } | null {
  const byMember = new Map<string, number[]>();
  for (const drink of drinks) {
    if (drink.drinkKey !== drinkKey || drink.rating === null) continue;
    const ratings = byMember.get(drink.userId) ?? [];
    ratings.push(drink.rating);
    byMember.set(drink.userId, ratings);
  }
  const rows = [...byMember.entries()]
    .map(([userId, ratings]) => ({
      userId,
      value: ratings.reduce((sum, value) => sum + value, 0) / ratings.length,
    }))
    .sort((left, right) => left.value - right.value || left.userId.localeCompare(right.userId));
  if (rows.length === 0) return null;
  const low = rows[0]!;
  const high = [...rows].sort(
    (left, right) => right.value - left.value || left.userId.localeCompare(right.userId),
  )[0]!;
  return { low: low.value, lowUserId: low.userId, high: high.value, highUserId: high.userId };
}

function awardCards(
  winners: readonly AwardWinner[],
  members: readonly MemberMetrics[],
): AwardCard[] {
  const ordered = orderAwardsForCeremony(winners);
  const cards = new Map<AwardKey, AwardCard>();
  for (const winner of ordered) {
    const card = cards.get(winner.award) ?? {
      award: winner.award,
      winners: [],
      isGhostSlot: winner.award === 'least_logged',
    };
    const member = members.find((row) => row.userId === winner.userId)!;
    card.winners.push({
      userId: winner.userId,
      ...(winner.award === 'venue_loyal' && member.topVenue !== null
        ? { venue: member.topVenue.venue }
        : {}),
    });
    cards.set(winner.award, card);
  }
  return [...cards.values()];
}

export function buildSquadWrapped(
  input: SnapshotInput,
  snapshotAt: number,
  config: SquadMetricsConfig = {},
): SquadWrappedPayload {
  const comparisons = config.comparisons ?? DEFAULT_COMPARISONS_CONFIG;
  const trip = toTripMeta(input);
  const allDrinks = deriveDrinks(input.drinks, trip);
  const days = rankDays(trip, snapshotAt);
  const metrics = [...input.members]
    .sort(
      (left, right) => left.joinedAt - right.joinedAt || left.userId.localeCompare(right.userId),
    )
    .map((member) =>
      memberMetrics(
        member,
        allDrinks.filter((drink) => drink.userId === member.userId),
        days,
        input.venues,
      ),
    );
  const totals = sumVolume(allDrinks);
  const absurd = totals.litres === 0 ? null : funniestAbsurdUnit(totals.litres, comparisons);
  const series = groupHourlySeries(allDrinks, trip);
  const incidents = detectIncidents(series);
  const venues = byVenue(allDrinks);
  const cities = byCity(allDrinks);
  const ratings = groupRatingRollup(allDrinks);
  const crowd = crowdFavourite(ratings);
  const divisive = mostDivisive(ratings);
  const extremes = divisive === null ? null : ratingExtremes(divisive.drinkKey, allDrinks);
  const replay = computeReplayTimeline(allDrinks, trip, input.members, input.achievementUnlocks);
  const boards = Object.fromEntries(
    SIDE_LEADERBOARD_KEYS.map((key) => [key, buildSideLeaderboard(key, metrics)]),
  ) as Record<SideLeaderboardKey, RankedRow[]>;
  const oracleScores = scorePredictions(input.predictions, metrics, allDrinks);
  const oracleWinner = oracle(oracleScores);
  const predictionRows: PredictionRevealRow[] = input.predictions
    .map((prediction) => ({
      userId: prediction.userId,
      predicted: prediction.myTotalStd,
      actual: round(metrics.find((member) => member.userId === prediction.userId)?.litres ?? 0, 1),
    }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
  const winners = allocateAwards(metrics, oracleScores);
  const featuresByUser = new Map<string, BehaviourFeatures>(
    metrics.map((member) => [member.userId, computeFeatures(member.drinks, allDrinks, trip)]),
  );
  const groupFeatures = [...featuresByUser.values()];
  const archetypes = Object.fromEntries(
    metrics.map((member) => [
      member.userId,
      classifyArchetype(featuresByUser.get(member.userId)!, groupFeatures),
    ]),
  ) as Record<string, ArchetypeResult>;
  const ratingInputs = metrics.map((member) => ({
    userId: member.userId,
    value: {
      kPerDay: member.stdDrinks / Math.max(days, 1),
      aPerDay: cheersCount(member.drinks, allDrinks) / Math.max(days, 1),
      dPerDay:
        member.drinks
          .filter((drink) => drink.category === 'soft')
          .reduce((sum, drink) => sum + drink.qty, 0) / Math.max(days, 1),
      unique: member.uniqueDrinks,
    },
  }));
  const ranking = rankMembers(
    metrics.map((member) => ({
      userId: member.userId,
      value: member.litres,
      qty: member.drinkCount,
      joinedAt: member.joinedAt,
    })),
  )
    .map((row) => {
      const values = ratingInputs.find((inputRow) => inputRow.userId === row.userId)!.value;
      return {
        userId: row.userId,
        rank: row.rank,
        value: round(row.value, 2),
        litres: round(row.value, 2),
        std: round(metrics.find((member) => member.userId === row.userId)!.stdDrinks, 1),
        drinks: row.qty,
        k: round(values.kPerDay, 2),
        a: round(values.aPerDay, 2),
        d: round(values.dPerDay, 2),
        rating: drinkRating2(
          values,
          ratingInputs.map((inputRow) => inputRow.value),
        ),
      };
    })
    .reverse();
  const bloopers = computeBloopers(allDrinks);

  const card01 = makeCard('01_group_total', {
    groupStd: round(totals.stdDrinks, 1),
    groupLitres: round(totals.litres, 2),
    absurdValue: absurd?.value ?? 0,
    absurdUnitPhrase: absurd?.key ?? 'empty',
  });
  const card02 = makeCard(
    '02_drunk_o_meter',
    {
      n: incidents.length,
      day: incidents[0] === undefined ? 0 : Math.floor(incidents[0].hourIndex / 24) + 1,
      time: incidents[0] === undefined ? 0 : (incidents[0].hourIndex + 6) % 24,
    },
    { series, incidents },
    incidents.length === 0 ? '02_drunk_o_meter.empty' : '02_drunk_o_meter',
  );
  const card03 = makeCard('03_keg', {
    kegPct: round((totals.litres / 50) * 100, 1),
  });
  const card04 = makeCard(
    '04_cities_venues',
    {
      venue: venues[0]?.label ?? '',
      cities: cities.length,
      venues: venues.length,
    },
    undefined,
    venues.length === 0 ? '04_cities_venues.empty' : '04_cities_venues',
  );
  const card05 = makeCard(
    '05_crowd_then_divisive',
    {
      drink: crowd?.label ?? divisive?.label ?? '',
      divDrink: divisive?.label ?? '',
      low: round(extremes?.low ?? 0, 1),
      lowName: extremes?.lowUserId ?? '',
      high: round(extremes?.high ?? 0, 1),
      highName: extremes?.highUserId ?? '',
    },
    {
      crowd: crowd === null ? null : { drinkKey: crowd.drinkKey, avg: crowd.avg },
      divisive: divisive === null ? null : { drinkKey: divisive.drinkKey, stddev: divisive.stddev },
    },
    crowd === null
      ? divisive === null
        ? '05_crowd_then_divisive.noCrowd.noDivisive'
        : '05_crowd_then_divisive.noCrowd'
      : divisive === null
        ? '05_crowd_then_divisive.noDivisive'
        : '05_crowd_then_divisive',
  );
  const card06 = makeCard(
    '06_replay',
    { nightMvpIndex: replay.dayEndMarkers[0]?.nightMvpIndex ?? -1 },
    { replay },
    replay.events.length === 0 ? '06_replay.empty' : '06_replay',
  );
  const card07 = makeCard('07_side_boards', {}, { boards });
  const card08 = makeCard(
    '08_predictions',
    {
      userId: oracleWinner?.userId ?? '',
      predicted: predictionRows.find((row) => row.userId === oracleWinner?.userId)?.predicted ?? 0,
      actual: predictionRows.find((row) => row.userId === oracleWinner?.userId)?.actual ?? 0,
    },
    { rows: predictionRows, oracle: oracleWinner },
    oracleWinner === null ? '08_predictions.empty' : '08_predictions',
  );
  const card09 = {
    id: '09_awards' as const,
    winners: awardCards(winners, metrics),
  };
  const card10 = makeCard('10_main_board', {}, { ranking });
  const card11 = makeCard(
    '11_credits',
    {
      ml: bloopers.smallest?.drink.sizeMl ?? 0,
      drink: bloopers.smallest?.drink.drinkName ?? '',
      userId: bloopers.smallest?.userId ?? '',
      note: bloopers.strangestNote?.note ?? '',
      edits: bloopers.mostEdited?.edits ?? 0,
      editedDrink: bloopers.mostEdited?.drink.drinkName ?? '',
      time: bloopers.loneWater?.drink.localHour ?? 0,
    },
    { bloopers, archetypes },
  );

  return {
    schemaVersion: 1,
    tripId: input.trip.id,
    cards: [card01, card02, card03, card04, card05, card06, card07, card08, card09, card10, card11],
  };
}
