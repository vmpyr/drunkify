import type { ThemePack } from '@drunkify/content';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';

import { appUrl } from '../app/api.js';
import { countdown, tp, tpMaybe, useThemePack } from '../app/content.js';
import { queryClient, serverNow, useMe, useTrip } from '../app/queries.js';
import { rememberTrip, Splash } from '../app/session.js';
import type { Member, Trip, User } from '../app/types.js';
import { AvatarStack } from '../components/Avatar.js';
import { Icon, type UiIconName } from '../components/icons.js';
import { useOverlays } from '../components/overlayStore.js';
import { TripSwitcher } from '../screens/home.js';
import { EditTripSheet } from './EditTrip.js';

export interface TripCtx {
  trip: Trip;
  members: Member[];
  pack: ThemePack;
  me: User;
  member: (userId: string) => Member | undefined;
  isOwner: boolean;
}

const Ctx = createContext<TripCtx | null>(null);

export function useTripCtx(): TripCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTripCtx outside TripProvider');
  return value;
}

const shownUnlocks = new Set<string>();

/** Live updates: one EventSource per open trip, mapped onto query invalidation (spec 07 SSE map). */
function useTripEvents(ctx: TripCtx | null) {
  const tripId = ctx?.trip.id;
  const meId = ctx?.me.id;
  const pack = ctx?.pack;
  useEffect(() => {
    if (!tripId || !pack) return;
    const source = new EventSource(appUrl(`/api/v1/trips/${tripId}/events`), { withCredentials: true });
    const invalidate = (...keys: string[]) =>
      void queryClient.invalidateQueries({ queryKey: ['trip', tripId, ...keys] });
    const onDrink = () => {
      invalidate('leaderboard');
      invalidate('feed');
      invalidate('dashboard');
      invalidate('recents');
      invalidate('predictions');
    };
    source.addEventListener('drink.created', onDrink);
    source.addEventListener('drink.updated', onDrink);
    source.addEventListener('drink.deleted', onDrink);
    source.addEventListener('achievement.unlocked', (event) => {
      invalidate('feed');
      invalidate('leaderboard');
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          payload?: Record<string, unknown>;
        } & Record<string, unknown>;
        const payload = (data.payload ?? data) as {
          triggeredByUserId: string;
          achievementKey: string;
          drinkId: string | null;
          vars: Record<string, string | number>;
        };
        const id = `${payload.achievementKey}:${payload.drinkId}:${payload.triggeredByUserId}`;
        if (payload.triggeredByUserId !== meId || shownUnlocks.has(id)) return;
        shownUnlocks.add(id);
        const name = tpMaybe(pack, `achievements.${payload.achievementKey}.name`, payload.vars);
        if (!name) return;
        const description =
          tpMaybe(pack, `achievements.${payload.achievementKey}.description`, payload.vars) ?? '';
        useOverlays.getState().showBanner({
          title: name,
          body: `${description.replace(/\.$/, '')}. ${tp(pack, 'toasts.achievementPosted')}`,
        });
      } catch {
        /* malformed event: the invalidation above still refreshes the feed */
      }
    });
    const onTrip = () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    };
    source.addEventListener('trip.updated', onTrip);
    source.addEventListener('phase.changed', onTrip);
    source.addEventListener('ceremony.started', onTrip);
    source.addEventListener('ceremony.step', () => invalidate('ceremony'));
    source.addEventListener('wrapped.early_vote', () => invalidate('wrapped', 'status'));
    source.addEventListener('wrapped.unlocked', onTrip);
    return () => source.close();
  }, [tripId, meId, pack]);
}

function useNow(intervalMs: number, active = true) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}

const DAY = 86_400_000;

export function isFinal24h(trip: Trip, now: number): boolean {
  return trip.ceremonyStartedAt === null && now >= trip.unlockAt - DAY && now < trip.unlockAt;
}

/** Loads the trip and its theme pack; shared by the tabbed layout and the full-screen routes. */
export function TripProvider({ children }: { children: ReactNode }) {
  const { tripId = '' } = useParams();
  const me = useMe();
  const detail = useTrip(tripId);
  const pack = useThemePack(detail.data?.trip.themeId);

  useEffect(() => {
    if (me.data && detail.data) rememberTrip(me.data.id, detail.data.trip.id);
  }, [me.data, detail.data]);

  const value = useMemo<TripCtx | null>(() => {
    if (!me.data || !detail.data || !pack.data) return null;
    const members = [...detail.data.members].sort(
      (left, right) => left.joinedAt - right.joinedAt,
    );
    return {
      trip: detail.data.trip,
      members,
      pack: pack.data,
      me: me.data,
      member: (userId) => members.find((item) => item.userId === userId),
      isOwner: detail.data.trip.ownerId === me.data.id,
    };
  }, [me.data, detail.data, pack.data]);

  useTripEvents(value);

  if (detail.isError) return <Navigate to="/" replace />;
  if (!value) return <Splash />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function TopBar() {
  const { trip, members, isOwner } = useTripCtx();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div className="p-top">
        <button type="button" className="trip-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <span>{trip.name}</span>
          <Icon name="down" />
        </button>
        <AvatarStack members={members.filter((member) => !member.disabled)} />
      </div>
      <TripSwitcher
        open={open}
        onClose={() => setOpen(false)}
        currentTripId={trip.id}
        memberCount={members.length}
        {...(isOwner && trip.ceremonyStartedAt === null ? { onEditTrip: () => setEditing(true) } : {})}
      />
      {isOwner ? <EditTripSheet open={editing} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

/** Countdown on every screen in the final 24 hours (DS §6.8). */
export function Countdown() {
  const { trip, pack } = useTripCtx();
  const now = useNow(1000);
  if (!isFinal24h(trip, now)) return null;
  return (
    <div className="count" role="timer" aria-live="off">
      <Icon name="hourglass" />
      <div>
        <b>{countdown(trip.unlockAt - now)}</b>
        <span>{tp(pack, 'home.countdown')}</span>
      </div>
    </div>
  );
}

const TABS: Array<{ path: string; icon: UiIconName; key: string }> = [
  { path: 'log', icon: 'glass', key: 'nav.log' },
  { path: 'board', icon: 'board', key: 'nav.leaderboard' },
  { path: 'feed', icon: 'list', key: 'nav.feed' },
  { path: 'wrapped', icon: 'gift', key: 'nav.wrapped' },
];

function TabBar() {
  const { trip, pack } = useTripCtx();
  const setTabsVisible = useOverlays((state) => state.setTabsVisible);
  useEffect(() => {
    setTabsVisible(1);
    return () => setTabsVisible(-1);
  }, [setTabsVisible]);
  return (
    <nav className="tabs" aria-label="Trip">
      {TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={`/t/${trip.id}/${tab.path}`}
          className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}
          replace
        >
          <Icon name={tab.icon} />
          {tp(pack, tab.key)}
        </NavLink>
      ))}
    </nav>
  );
}

export function TripLayout() {
  const location = useLocation();
  return (
    <TripProvider>
      <main className="scr trip">
        <TopBar />
        <Countdown />
        <div className="tab-body" key={location.pathname}>
          <Outlet />
        </div>
        <TabBar />
      </main>
    </TripProvider>
  );
}
