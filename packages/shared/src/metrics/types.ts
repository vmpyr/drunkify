export const DRINK_CATEGORIES = [
  'beer',
  'wine',
  'cocktail',
  'spirit',
  'shot',
  'cider',
  'seltzer',
  'soft',
  'other',
] as const;

export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];
export type Rating = 1 | 2 | 3 | 4 | 5;

export interface DrinkRow {
  id: string;
  tripId: string;
  userId: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  createdAt: number;
  venueId: string | null;
  venueName: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  countryCode: string | null;
  rating: Rating | null;
  note: string | null;
  editCount: number;
  lastEditedAt: number | null;
}

export interface TripMeta {
  id: string;
  timezone: string;
  startDate: string;
  endDate: string;
  memberIds: string[];
  theme: string;
}

export interface DerivedDrink extends DrinkRow {
  stdDrinks: number;
  grams: number;
  ethanolMl: number;
  litres: number;
  tripDay: number;
  localHour: number;
  isAlcoholic: boolean;
  visitKey: string | null;
  drinkKey: string;
}

export interface SnapshotTrip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  themeId: string;
  ownerId: string;
  unlockAt: number;
  ceremonyStartedAt: number | null;
}

export interface SnapshotMember {
  userId: string;
  name: string;
  colorIndex: number;
  joinedAt: number;
  disabled: boolean;
}

export interface AchievementUnlock {
  userId: string | null;
  key: string;
  triggeredByUserId: string;
  unlockedAt: number;
  vars: Record<string, string | number>;
}

export interface SnapshotVenue {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface Prediction {
  userId: string;
  myTotalStd: number;
  groupTotalStd: number;
  topMemberId: string;
  leastMemberId: string;
  /** 1-based trip day; null on predictions locked before q5 existed. */
  topDay: number | null;
  /** Null on predictions locked before q6 existed. */
  criticMemberId: string | null;
  lockedAt: number;
}

export interface SnapshotInput {
  trip: SnapshotTrip;
  members: SnapshotMember[];
  drinks: DrinkRow[];
  achievementUnlocks: AchievementUnlock[];
  predictions: Prediction[];
  venues: SnapshotVenue[];
}

export type WrappedValue = string | number | null;

export interface WrappedCard<
  TVars extends Record<string, WrappedValue> = Record<string, WrappedValue>,
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  key: string;
  vars: TVars;
  data?: TData;
}

export type PersonalWrappedCard = WrappedCard | null;

export interface PersonalWrappedPayload {
  schemaVersion: 1;
  tripId: string;
  userId: string;
  context: {
    days: number;
    members: number;
    ownerId: string;
    tripName: string;
  };
  cards: [
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
    PersonalWrappedCard,
  ];
}

export function toTripMeta(input: SnapshotInput): TripMeta {
  return {
    id: input.trip.id,
    timezone: input.trip.timezone,
    startDate: input.trip.startDate,
    endDate: input.trip.endDate,
    memberIds: [...input.members]
      .sort(
        (left, right) => left.joinedAt - right.joinedAt || left.userId.localeCompare(right.userId),
      )
      .map((member) => member.userId),
    theme: input.trip.themeId,
  };
}
