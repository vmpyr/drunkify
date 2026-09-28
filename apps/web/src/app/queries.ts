import { QueryCache, QueryClient, useQuery } from '@tanstack/react-query';

import { api, ApiError } from './api.js';
import type {
  Dashboard,
  DrinkCategory,
  Favourite,
  FeedItem,
  Invite,
  Leaderboard,
  Member,
  PersonalWrapped,
  PredictionMe,
  Recents,
  Trip,
  User,
  WrappedStatus,
} from './types.js';

export function v1<T>(path: string, init?: RequestInit): Promise<T> {
  return api<T>(`/api/v1${path}`, init);
}

export function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return v1<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const SIGNED_OUT_FLAG = 'drunkify.signedOut';

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // A 401 anywhere but /me means the session died under us (DS §6.13 signed-out banner).
      if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== 'me') {
        if (queryClient.getQueryData(['me'])) {
          try {
            sessionStorage.setItem(SIGNED_OUT_FLAG, '1');
          } catch {
            /* private mode */
          }
        }
        queryClient.setQueryData(['me'], null);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

let serverOffsetMs = 0;
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}
function noteServerTime(serverTime: number | undefined) {
  if (typeof serverTime === 'number') serverOffsetMs = serverTime - Date.now();
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await v1<{ user: User }>('/me')).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useTrips(enabled = true) {
  return useQuery({
    queryKey: ['trips'],
    queryFn: async () => (await v1<{ trips: Trip[] }>('/trips')).trips,
    enabled,
  });
}

export function useTrip(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'detail'],
    queryFn: async () => {
      const result = await v1<{ trip: Trip; members: Member[]; serverTime: number }>(`/trips/${tripId}`);
      noteServerTime(result.serverTime);
      return result;
    },
  });
}

export function useRecents(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'recents'],
    queryFn: () => v1<Recents>(`/trips/${tripId}/drinks/recents`),
  });
}

export function useFavourites() {
  return useQuery({
    queryKey: ['favourites'],
    queryFn: async () => (await v1<{ items?: Favourite[]; favourites?: Favourite[] }>('/me/favourites')),
    select: (data) => data.items ?? data.favourites ?? [],
  });
}

/** Custom drink names: yours first, then ones your trip-mates added (flagged `shared`). */
export function useCustomNames(category: DrinkCategory, tripId: string) {
  return useQuery({
    queryKey: ['customNames', category, tripId],
    queryFn: async () =>
      (await v1<{ names: Array<{ name: string; abv: number | null; shared?: boolean }> }>(
        `/me/custom-drink-names?category=${category}&tripId=${tripId}`,
      )).names,
  });
}

export function useLeaderboard(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'leaderboard'],
    queryFn: () => v1<Leaderboard>(`/trips/${tripId}/leaderboard`),
  });
}

export function useDashboard(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'dashboard'],
    queryFn: () => v1<Dashboard>(`/trips/${tripId}/dashboard`),
  });
}

export function useFeed(tripId: string, filter: 'mine' | 'everyone') {
  return useQuery({
    queryKey: ['trip', tripId, 'feed', filter],
    queryFn: () =>
      v1<{ items: FeedItem[]; nextCursor: string | null }>(
        `/trips/${tripId}/feed?filter=${filter}&limit=100`,
      ),
  });
}

export function usePredictionMe(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'predictions', 'me'],
    queryFn: async () => {
      const result = await v1<PredictionMe>(`/trips/${tripId}/predictions/me`);
      noteServerTime(result.serverTime);
      return result;
    },
  });
}

export function usePredictionStatus(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ['trip', tripId, 'predictions', 'status'],
    queryFn: () => v1<{ submitted: number; total: number; submittedUserIds?: string[] }>(
      `/trips/${tripId}/predictions/status`,
    ),
    enabled,
  });
}

export function useWrappedStatus(tripId: string) {
  return useQuery({
    queryKey: ['trip', tripId, 'wrapped', 'status'],
    queryFn: async () => {
      const result = await v1<WrappedStatus>(`/trips/${tripId}/wrapped/status`);
      noteServerTime(result.serverTime);
      return result;
    },
  });
}

export function usePersonalWrapped(tripId: string, enabled = true) {
  return useQuery({
    queryKey: ['trip', tripId, 'wrapped', 'personal'],
    queryFn: () => v1<PersonalWrapped>(`/trips/${tripId}/wrapped/personal`),
    enabled,
    staleTime: Infinity,
  });
}

export function useInvites(enabled = true) {
  return useQuery({
    queryKey: ['invites'],
    queryFn: async () => (await v1<{ items: Invite[] }>('/invites')).items,
    enabled,
  });
}
