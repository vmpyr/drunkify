import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { queryClient, send, useMe, useTrips } from './queries.js';
import type { DisplayPref, Trip, User } from './types.js';

const LAST_USER = 'drunkify.lastUser';
const lastTripKey = (userId: string) => `drunkify.lastTrip.${userId}`;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function rememberTrip(userId: string, tripId: string) {
  safeSet(lastTripKey(userId), tripId);
}

export function applyDisplay(pref: DisplayPref) {
  document.documentElement.dataset.theme = pref;
  safeSet('drunkify.display', pref);
}

/** Where a signed-in user lands: their last trip, else the live one, else No trip. */
export function homePath(user: User, trips: Trip[]): string {
  if (user.mustChangePassword) return '/setup';
  const last = safeGet(lastTripKey(user.id));
  const trip =
    trips.find((item) => item.id === last) ??
    trips.find((item) => item.phase !== 'ceremony') ??
    trips[0];
  return trip ? `/t/${trip.id}/log` : '/no-trip';
}

export function Splash() {
  return <div className="splash" aria-busy="true" />;
}

/** Keeps drunkify.lastUser (read by the offline outbox) and the display pref in sync. */
export function useSessionSync(user: User | null | undefined) {
  useEffect(() => {
    if (user === undefined) return;
    safeSet(LAST_USER, user?.id ?? null);
    if (user) applyDisplay(user.displayThemePref);
  }, [user]);
}

export function RequireAuth({ children, allowSetup = false }: { children: ReactNode; allowSetup?: boolean }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Splash />;
  if (!me.data) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }
  if (me.data.mustChangePassword && !allowSetup) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function HomeRedirect() {
  const me = useMe();
  const trips = useTrips(Boolean(me.data));
  if (me.isPending) return <Splash />;
  if (!me.data) return <Navigate to="/sign-in" replace />;
  if (me.data.mustChangePassword) return <Navigate to="/setup" replace />;
  if (trips.isPending) return <Splash />;
  return <Navigate to={homePath(me.data, trips.data ?? [])} replace />;
}

export async function signOut() {
  await send('POST', '/auth/sign-out').catch(() => undefined);
  queryClient.clear();
  queryClient.setQueryData(['me'], null);
}

/** After sign-in / account creation: seed caches, then go where the user was headed. */
export async function afterSignIn(user: User): Promise<string> {
  queryClient.setQueryData(['me'], user);
  const trips = await queryClient.fetchQuery({
    queryKey: ['trips'],
    queryFn: async () => (await send<{ trips: Trip[] }>('GET', '/trips')).trips,
  });
  return homePath(user, trips);
}
