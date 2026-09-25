import { useCallback, useEffect, useMemo, useState } from 'react';

import { createUuidV7 } from '../offline/uuidv7.js';
import { ApiError, api, appUrl } from './api.js';
import type { FeedItem, LeaderboardRow, Trip, User } from './types.js';

function dateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function datetimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Something went wrong';
}

interface AppProps {
  online: boolean;
  queued: number;
  sessionLost: boolean;
}

export function App({ online, queued, sessionLost }: AppProps) {
  const [user, setUser] = useState<User | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === selectedTripId) ?? null,
    [selectedTripId, trips],
  );

  const loadTrips = useCallback(async () => {
    const result = await api<{ trips: Trip[] }>('/api/v1/trips');
    setTrips(result.trips);
    setSelectedTripId((current) =>
      current && result.trips.some((trip) => trip.id === current)
        ? current
        : (result.trips[0]?.id ?? null),
    );
  }, []);

  const loadTripData = useCallback(async (tripId: string) => {
    const [board, activity] = await Promise.all([
      api<{ rows: LeaderboardRow[] }>(`/api/v1/trips/${tripId}/leaderboard`),
      api<{ items: FeedItem[] }>(`/api/v1/trips/${tripId}/feed?limit=20`),
    ]);
    setLeaderboard(board.rows);
    setFeed(activity.items);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api<{ user: User }>('/api/v1/me');
        setUser(result.user);
        localStorage.setItem('drunkify.lastUser', result.user.id);
        await loadTrips();
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 401)) setError(messageOf(reason));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadTrips]);

  useEffect(() => {
    if (!selectedTripId) {
      setLeaderboard([]);
      setFeed([]);
      return;
    }
    void loadTripData(selectedTripId).catch((reason) => setError(messageOf(reason)));
  }, [loadTripData, selectedTripId]);

  if (loading) {
    return (
      <main className="app-loading">
        <div className="ceremony-loader" aria-hidden="true" />
        <p>Opening Drunkify…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <SignIn
        online={online}
        onSignedIn={async (signedInUser) => {
          setUser(signedInUser);
          localStorage.setItem('drunkify.lastUser', signedInUser.id);
          await loadTrips();
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Trip drink log</p>
          <h1>Drunkify</h1>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${online ? 'is-online' : ''}`}>
            {online ? 'Online' : 'Offline'}
            {queued > 0 ? ` · ${queued} queued` : ''}
          </span>
          <button
            className="button button--quiet"
            onClick={() =>
              void api('/api/v1/auth/sign-out', { method: 'POST' }).finally(() => {
                setUser(null);
                setTrips([]);
                setSelectedTripId(null);
              })
            }
          >
            Sign out
          </button>
        </div>
      </header>

      {sessionLost && (
        <aside className="session-banner" role="status">
          <strong>Session lost.</strong> Your queued drinks are safe. Sign in again to sync them.
        </aside>
      )}
      {user.mustChangePassword && (
        <aside className="notice">
          You’re using the bootstrap admin account. You can test now, then change the password from
          the account API.
        </aside>
      )}
      {error && (
        <aside className="app-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </aside>
      )}

      <section className="app-toolbar">
        <label>
          <span>Trip</span>
          <select
            value={selectedTripId ?? ''}
            onChange={(event) => setSelectedTripId(event.target.value || null)}
          >
            {trips.length === 0 && <option value="">No trips yet</option>}
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        {user.role === 'admin' && (
          <button className="button" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Cancel' : 'Create trip'}
          </button>
        )}
        {selectedTrip && (
          <>
            <button className="button button--accent" onClick={() => setShowLog((value) => !value)}>
              {showLog ? 'Close logger' : 'Log a drink'}
            </button>
            <button
              className="button button--quiet"
              onClick={() => void loadTripData(selectedTrip.id)}
            >
              Refresh
            </button>
          </>
        )}
      </section>

      {showCreate && (
        <CreateTrip
          busy={busy}
          onCreate={async (trip) => {
            setBusy(true);
            setError(null);
            try {
              const result = await api<{ trip: Trip }>('/api/v1/trips', {
                method: 'POST',
                body: JSON.stringify(trip),
              });
              await loadTrips();
              setSelectedTripId(result.trip.id);
              setShowCreate(false);
            } catch (reason) {
              setError(messageOf(reason));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {selectedTrip ? (
        <>
          <section className="trip-hero">
            <div>
              <p className="eyebrow">{selectedTrip.phase.replaceAll('_', ' ')}</p>
              <h2>{selectedTrip.name}</h2>
              <p>
                {selectedTrip.startDate} → {selectedTrip.endDate} · {selectedTrip.timezone}
              </p>
            </div>
            <div className="trip-actions">
              <button
                className="button button--quiet"
                onClick={() =>
                  window.open(
                    appUrl(`/t/${selectedTrip.id}/ceremony?display=big`),
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                Open big screen
              </button>
              {selectedTrip.ownerId === user.id && !selectedTrip.ceremonyStartedAt && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await api(`/api/v1/trips/${selectedTrip.id}/ceremony/start`, {
                          method: 'POST',
                        });
                        await loadTrips();
                      } catch (reason) {
                        setError(messageOf(reason));
                      } finally {
                        setBusy(false);
                      }
                    })()
                  }
                >
                  Start ceremony
                </button>
              )}
            </div>
          </section>

          {showLog && (
            <LogDrink
              busy={busy}
              onLog={async (drink) => {
                setBusy(true);
                setError(null);
                try {
                  await api(`/api/v1/trips/${selectedTrip.id}/drinks`, {
                    method: 'POST',
                    body: JSON.stringify({ id: createUuidV7(), ...drink }),
                  });
                  setShowLog(false);
                  await loadTripData(selectedTrip.id);
                } catch (reason) {
                  setError(messageOf(reason));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}

          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-heading">
                <h3>Leaderboard</h3>
                <span>{leaderboard.length} members</span>
              </div>
              {leaderboard.length === 0 ? (
                <Empty text="No leaderboard data yet." />
              ) : (
                <div className="leaderboard">
                  {leaderboard.map((row, index) => (
                    <div className={row.isYou ? 'is-you' : ''} key={row.userId}>
                      <span className="rank">{row.rank ?? index + 1}</span>
                      <strong>{row.name}</strong>
                      <span>
                        {row.values
                          ? `${row.values.std.toFixed(1)} std · ${row.values.drinks}`
                          : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-heading">
                <h3>Recent activity</h3>
                <span>{feed.length} items</span>
              </div>
              {feed.length === 0 ? (
                <Empty text="No drinks yet. Log the first one." />
              ) : (
                <div className="feed-list">
                  {feed.map((item, index) =>
                    item.kind === 'drink' ? (
                      <article key={item.drink.id}>
                        <div>
                          <strong>{item.memberName ?? 'A squad member'}</strong>
                          <p>
                            {item.drink.qty}× {item.drink.drinkName} · {item.drink.sizeMl} ml ·{' '}
                            {item.drink.abv}%
                          </p>
                        </div>
                        <span>{item.drink.stdDrinks.toFixed(1)} std</span>
                      </article>
                    ) : (
                      <article key={`achievement-${index}`}>
                        <div>
                          <strong>{item.memberName}</strong>
                          <p>
                            Unlocked{' '}
                            {(item.unlock.achievementKey ?? item.unlock.key ?? 'award').replaceAll(
                              '_',
                              ' ',
                            )}
                          </p>
                        </div>
                        <span>🏆</span>
                      </article>
                    ),
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      ) : (
        <section className="empty-state">
          <h2>No trips yet</h2>
          <p>Create a trip to start logging drinks and invite your group.</p>
          {user.role === 'admin' && (
            <button className="button button--accent" onClick={() => setShowCreate(true)}>
              Create your first trip
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function SignIn({
  online,
  onSignedIn,
}: {
  online: boolean;
  onSignedIn: (user: User) => Promise<void>;
}) {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <p className="eyebrow">Trip drink log</p>
        <h1>Drunkify</h1>
        <p className="lede">Log the rounds. Settle the leaderboard. Remember the trip.</p>
        <span className={`status-pill ${online ? 'is-online' : ''}`}>
          {online ? 'Service online' : 'You are offline'}
        </span>
      </section>
      <form
        className="form-card"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          void api<{ user: User }>('/api/v1/auth/sign-in', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          })
            .then((result) => onSignedIn(result.user))
            .catch((reason) => setError(messageOf(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in</h2>
        </div>
        <label>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="button button--accent button--large" disabled={busy || !online}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

function CreateTrip({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (trip: {
    name: string;
    startDate: string;
    endDate: string;
    timezone: string;
    themeId: string;
    unlockAt: number;
  }) => Promise<void>;
}) {
  const now = new Date();
  const [name, setName] = useState('Weekend away');
  const [startDate, setStartDate] = useState(dateInput(now));
  const [endDate, setEndDate] = useState(dateInput(new Date(now.getTime() + 2 * 86_400_000)));
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
  );
  const [unlockAt, setUnlockAt] = useState(datetimeInput(now));
  return (
    <form
      className="form-card form-card--wide"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate({
          name,
          startDate,
          endDate,
          timezone,
          themeId: 'classic',
          unlockAt: new Date(unlockAt).getTime(),
        });
      }}
    >
      <div>
        <p className="eyebrow">Admin</p>
        <h2>Create trip</h2>
      </div>
      <div className="form-grid">
        <label className="field-span">
          <span>Trip name</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Starts</span>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          <span>Ends</span>
          <input
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label>
          <span>Timezone</span>
          <input required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>
        <label>
          <span>Wrapped unlock</span>
          <input
            type="datetime-local"
            required
            value={unlockAt}
            onChange={(e) => setUnlockAt(e.target.value)}
          />
        </label>
      </div>
      <button className="button button--accent" disabled={busy}>
        {busy ? 'Creating…' : 'Create trip'}
      </button>
    </form>
  );
}

function LogDrink({
  busy,
  onLog,
}: {
  busy: boolean;
  onLog: (drink: {
    category:
      'beer' | 'wine' | 'cocktail' | 'spirit' | 'shot' | 'cider' | 'seltzer' | 'soft' | 'other';
    drinkName: string;
    sizeMl: number;
    abv: number;
    qty: number;
    drunkAt: number;
    venue: null;
    note: null;
  }) => Promise<void>;
}) {
  const [category, setCategory] = useState<
    'beer' | 'wine' | 'cocktail' | 'spirit' | 'shot' | 'cider' | 'seltzer' | 'soft' | 'other'
  >('beer');
  const [drinkName, setDrinkName] = useState('Lager');
  const [sizeMl, setSizeMl] = useState(500);
  const [abv, setAbv] = useState(5);
  const [qty, setQty] = useState(1);
  return (
    <form
      className="form-card form-card--wide"
      onSubmit={(event) => {
        event.preventDefault();
        void onLog({
          category,
          drinkName,
          sizeMl,
          abv,
          qty,
          drunkAt: Date.now(),
          venue: null,
          note: null,
        });
      }}
    >
      <div>
        <p className="eyebrow">New round</p>
        <h2>Log a drink</h2>
      </div>
      <div className="form-grid form-grid--drink">
        <label>
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {[
              'beer',
              'wine',
              'cocktail',
              'spirit',
              'shot',
              'cider',
              'seltzer',
              'soft',
              'other',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field-span">
          <span>Drink</span>
          <input
            required
            value={drinkName}
            onChange={(event) => setDrinkName(event.target.value)}
          />
        </label>
        <label>
          <span>Size (ml)</span>
          <input
            type="number"
            min="1"
            max="10000"
            required
            value={sizeMl}
            onChange={(event) => setSizeMl(event.target.valueAsNumber)}
          />
        </label>
        <label>
          <span>ABV %</span>
          <input
            type="number"
            min="0"
            max="80"
            step={abv <= 15 ? 0.1 : 0.5}
            required
            value={abv}
            onChange={(event) => setAbv(event.target.valueAsNumber)}
          />
        </label>
        <label>
          <span>Quantity</span>
          <input
            type="number"
            min="0.5"
            max="100"
            step="0.5"
            required
            value={qty}
            onChange={(event) => setQty(event.target.valueAsNumber)}
          />
        </label>
      </div>
      <button className="button button--accent" disabled={busy}>
        {busy ? 'Logging…' : 'Add to trip'}
      </button>
    </form>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="panel-empty">{text}</p>;
}
