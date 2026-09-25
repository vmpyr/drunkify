export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
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
  phase: string;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  isYou: boolean;
  rank: number | null;
  values: {
    std: number;
    drinks: number;
    k: number;
    a: number;
    d: number;
    rating: number | null;
  } | null;
}

export interface FeedDrink {
  id: string;
  drinkName: string;
  category: string;
  qty: number;
  sizeMl: number;
  abv: number;
  stdDrinks: number;
  drunkAt: number;
}

export type FeedItem =
  | {
      kind: 'drink';
      memberName: string;
      dayLabel: string;
      drink: FeedDrink;
    }
  | {
      kind: 'achievement';
      memberName: string | null;
      dayLabel: string;
      unlock: { achievementKey?: string; key?: string };
    };
