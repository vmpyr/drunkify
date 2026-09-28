import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { a, tripDates } from '../app/content.js';
import { queryClient, send, useMe, useTrips } from '../app/queries.js';
import { homePath, Splash } from '../app/session.js';
import type { Trip } from '../app/types.js';
import { Avatar } from '../components/Avatar.js';
import { HeroCoaster } from '../components/Coaster.js';
import { AuthField, PrimaryButton } from '../components/Field.js';
import { Icon } from '../components/icons.js';
import { BackButton, BottomSheet, SheetHead } from '../components/Sheet.js';
import { formError } from './auth.js';
import { InviteSheet } from './people.js';

/** Your trips, then People (admin only) and Account (DS §6.13 trip switcher). */
export function TripSwitcher({
  open,
  onClose,
  currentTripId,
  memberCount,
  onEditTrip,
}: {
  open: boolean;
  onClose: () => void;
  currentTripId?: string;
  memberCount?: number;
  /** Shown to the current trip's owner: opens the trip settings. */
  onEditTrip?: () => void;
}) {
  const navigate = useNavigate();
  const me = useMe();
  const trips = useTrips(open);
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  return (
    <BottomSheet open={open} onClose={onClose} label="Your trips">
      <SheetHead title="Your trips" onClose={onClose} />
      {onEditTrip ? (
        <>
          <button
            type="button"
            className="srow"
            onClick={() => {
              onClose();
              onEditTrip();
            }}
          >
            <Icon name="note" />
            <div className="v">
              <b>Edit trip</b>
              <span>Name, theme and when the Wrapped opens</span>
            </div>
            <Icon name="down" className="fwd" />
          </button>
          <div className="sgap" />
        </>
      ) : null}
      {(trips.data ?? []).map((trip) => (
        <button
          type="button"
          key={trip.id}
          className="srow"
          aria-current={trip.id === currentTripId ? 'true' : undefined}
          onClick={() => go(`/t/${trip.id}/log`)}
        >
          <div className="v">
            <b>{trip.name}</b>
            <span>
              {tripDates(trip.startDate, trip.endDate)}
              {trip.id === currentTripId && memberCount ? ` · ${memberCount} people` : ''}
            </span>
          </div>
          {trip.id === currentTripId ? <Icon name="check" className="chk" /> : null}
        </button>
      ))}
      <div className="sgap" />
      {me.data?.role === 'admin' ? (
        <>
          <button type="button" className="srow" onClick={() => go('/people')}>
            <Icon name="user-plus" />
            <div className="v">
              <b>{a('people.entry')}</b>
            </div>
            <Icon name="down" className="fwd" />
          </button>
          <button type="button" className="srow" onClick={() => go('/trips/new')}>
            <Icon name="glass" />
            <div className="v">
              <b>{a('noTrip.adminCreateTrip')}</b>
            </div>
            <Icon name="down" className="fwd" />
          </button>
        </>
      ) : null}
      {me.data ? (
        <button type="button" className="srow" onClick={() => go('/account')}>
          <Avatar name={me.data.name} colorIndex={0} />
          <div className="v">
            <b>{a('account.entry')}</b>
          </div>
          <Icon name="down" className="fwd" />
        </button>
      ) : null}
    </BottomSheet>
  );
}

export function NoTrip() {
  const me = useMe();
  // A member waits here until someone adds them to a trip; check back regularly.
  const trips = useTrips();
  const [switcher, setSwitcher] = useState(false);
  const [invite, setInvite] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => void trips.refetch(), 30_000);
    return () => clearInterval(timer);
  }, [trips]);

  if (!me.data || trips.isPending) return <Splash />;
  if ((trips.data ?? []).length > 0) return <Navigate to={homePath(me.data, trips.data!)} replace />;
  const admin = me.data.role === 'admin';

  return (
    <main className="scr au">
      <div className="p-top">
        <button type="button" className="trip-btn" onClick={() => setSwitcher(true)}>
          <span>{a('brand.wordmark')}</span>
          <Icon name="down" />
        </button>
      </div>
      <HeroCoaster />
      <div style={{ marginTop: 'auto' }}>
        {admin ? (
          <>
            <h1 className="au-t">{a('noTrip.adminTitle')}</h1>
            <button type="button" className="pbtn" onClick={() => setInvite(true)}>
              <Icon name="user-plus" />
              {a('noTrip.adminInvite')}
            </button>
            <Link className="pbtn sec" style={{ marginTop: 10 }} to="/trips/new">
              {a('noTrip.adminCreateTrip')}
            </Link>
          </>
        ) : (
          <>
            <h1 className="au-t">{a('noTrip.title')}</h1>
            <div style={{ height: 120 }} />
          </>
        )}
      </div>
      <TripSwitcher open={switcher} onClose={() => setSwitcher(false)} />
      <InviteSheet open={invite} onClose={() => setInvite(false)} />
    </main>
  );
}

function isoDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Admin-only. Not drawn in the handoff, so it borrows the account form language. */
export function CreateTrip() {
  const navigate = useNavigate();
  const me = useMe();
  const today = Date.now();
  const [name, setName] = useState('');
  const [start, setStart] = useState(isoDate(today));
  const [end, setEnd] = useState(isoDate(today + 3 * 86_400_000));
  const [unlockTime, setUnlockTime] = useState('11:00');
  const [themeId, setThemeId] = useState('classic');
  const [err, setErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data && me.data.role !== 'admin') return <Navigate to="/" replace />;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setErr('Give the trip a name.');
    if (end < start) return setFormErr('The trip has to end after it starts.');
    const unlockAt = new Date(`${end}T${unlockTime}`).getTime();
    setBusy(true);
    setFormErr(null);
    try {
      const { trip } = await send<{ trip: Trip }>('POST', '/trips', {
        name: name.trim(),
        startDate: start,
        endDate: end,
        timezone,
        themeId,
        unlockAt,
      });
      await queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigate(`/t/${trip.id}/log`, { replace: true });
    } catch (error) {
      setFormErr(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="scr au">
      <div className="au-top">
        <BackButton onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} />
        <span />
      </div>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <h1 className="ph">{a('noTrip.adminCreateTrip')}</h1>
        <AuthField
          label="Trip name"
          value={name}
          onChange={(value) => {
            setName(value);
            setErr(null);
          }}
          placeholder="Lisbon Lads ’26"
          autoComplete="off"
          error={err}
        />
        <div className="brow" style={{ marginTop: 0 }}>
          <div className="af">
            <label htmlFor="ct-start">Starts</label>
            <input id="ct-start" className="afi" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="af">
            <label htmlFor="ct-end">Ends</label>
            <input id="ct-end" className="afi" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="af">
          <label htmlFor="ct-unlock">Wrapped opens on the last day at</label>
          <input
            id="ct-unlock"
            className="afi"
            type="time"
            value={unlockTime}
            onChange={(e) => setUnlockTime(e.target.value)}
          />
        </div>
        <div className="fld" style={{ marginTop: 16 }}>
          <div className="fld-l" id="ct-theme">
            Theme
          </div>
          <div className="chips" role="radiogroup" aria-labelledby="ct-theme">
            {[
              ['classic', 'Classic'],
              ['cs2', 'CS2'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={themeId === id}
                className={`chip ${themeId === id ? 'on' : ''}`}
                onClick={() => setThemeId(id!)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {formErr ? (
          <div className="ferr" role="alert">
            {formErr}
          </div>
        ) : null}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <PrimaryButton busy={busy}>{a('noTrip.adminCreateTrip')}</PrimaryButton>
        </div>
      </form>
    </main>
  );
}
