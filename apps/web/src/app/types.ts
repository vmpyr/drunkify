import type { DrinkCategory } from '@drunkify/content';

export type { DrinkCategory };
export type DisplayPref = 'system' | 'dark' | 'light';
export type TripPhase = 'live' | 'final_24h' | 'wrapped_unlocked' | 'ceremony';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  mustChangePassword: boolean;
  displayThemePref: DisplayPref;
  disabledAt: number | null;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  themeId: string;
  unlockAt: number;
  ownerId: string;
  ceremonyStartedAt: number | null;
  phase: TripPhase;
}

export interface Member {
  userId: string;
  name: string;
  colorIndex: number;
  joinedAt: number;
  isOwner: boolean;
  isAdmin: boolean;
  disabled: boolean;
  email?: string;
}

export interface Drink {
  id: string;
  userId: string;
  tripId: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  lat: number | null;
  lng: number | null;
  venueId: string | null;
  venueName: string | null;
  city: string | null;
  rating: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  editCount: number;
  stdDrinks: number;
}

export type VenueInput =
  | { id: string }
  | { candidate: { name: string; lat: number; lng: number; osmId: string | null } }
  | { name: string }
  | null;

export interface DrinkPayload {
  id: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
  venue: VenueInput;
  note?: string | null;
  rating?: number | null;
}

export interface Favourite {
  id: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
}

export interface Recents {
  lastDrink: Drink | null;
  lastByCategory: Partial<Record<DrinkCategory, Drink>>;
  items: Array<Pick<Drink, 'category' | 'drinkName' | 'sizeMl' | 'abv'> & Partial<Drink>>;
}

export type VenueSuggestion =
  | { kind: 'existing'; venue: { id: string; name: string } }
  | { kind: 'candidate'; name: string; lat: number; lng: number; osmId: string | null }
  | { kind: 'none' };

export interface AchievementUnlock {
  key: string;
  userId: string;
  triggeredByUserId: string;
  tripId: string;
  drinkId: string | null;
  unlockedAt: number;
  vars: Record<string, string | number>;
}

export type FeedItem =
  | { kind: 'drink'; drink: Drink; memberName: string; tripDay: number; dayLabel: string }
  | {
      kind: 'achievement';
      unlock: AchievementUnlock;
      memberName: string;
      tripDay: number;
      dayLabel: string;
    };

export interface LeaderboardRow {
  userId: string;
  name: string;
  isYou: boolean;
  rank: number | null;
  values: {
    std: number;
    litres: number;
    drinks: number;
    k: number;
    a: number;
    d: number;
    rating: number;
  } | null;
}

export interface Leaderboard {
  masked: boolean;
  rows: LeaderboardRow[];
  recentAchievements: Array<AchievementUnlock & { memberName?: string }>;
}

export interface Dashboard {
  totals: {
    you: { std: number; litres: number; drinks: number };
    squad: { std: number; litres: number; drinks: number };
  };
  byDay: Array<{ day: number; dateLabel: string; std: number; litres: number }>;
  byCategory: Array<{ category: DrinkCategory; std: number; litres: number }>;
  recentAchievements: Array<AchievementUnlock & { memberName?: string }>;
}

export interface PredictionMe {
  state: 'open' | 'locked' | 'missed';
  deadlineAt: number;
  missedDismissed: boolean;
  serverTime: number;
  answers: unknown;
}

export interface PredictionAnswers {
  /** Litres; the names predate the switch from std drinks. */
  myTotalStd: number;
  groupTotalStd: number;
  topMemberId: string;
  leastMemberId: string;
  topDrink: string;
  topDrinkCategory: DrinkCategory;
}

export interface WrappedStatus {
  personalUnlockAt: number;
  personalUnlocked: boolean;
  personalWatchedCount: number;
  totalMembers: number;
  ceremonyStarted: boolean;
  ceremonyStartedAt: number | null;
  serverTime: number;
  watchedUserIds?: string[];
  /** Members who have agreed to open the Wrapped before its scheduled time. */
  earlyVoteUserIds?: string[];
  /** Active members; everyone must agree for an early release. */
  earlyVoteTotal?: number;
}

export type WrappedValue = string | number | null;

export interface WrappedCardDto {
  id: string;
  key: string;
  vars: Record<string, WrappedValue>;
  data?: Record<string, unknown>;
}

export interface PersonalWrapped {
  unlocked: boolean;
  payload: {
    context: { days: number; members: number; ownerId: string; tripName: string };
    cards: Array<WrappedCardDto | null>;
  } | null;
}

export interface Invite {
  id: string;
  name: string | null;
  email: string | null;
  tripId: string | null;
  tripName: string | null;
  state: 'pending' | 'expired' | 'used' | 'revoked' | string;
  createdAt: number;
  expiresAt: number;
  acceptedBy?: string | null;
  acceptedAt?: number | null;
}

export interface Person extends User {
  trips: Array<{ id: string; name: string }>;
  colorIndex?: number;
}

export type LinkProblemKind = 'invalid' | 'expired' | 'used' | 'revoked' | 'resetExpired';
