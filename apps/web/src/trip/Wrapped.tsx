import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { appUrl } from '../app/api.js';
import { countdown, tp } from '../app/content.js';
import { queryClient, send, serverNow, useWrappedStatus } from '../app/queries.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { BottomSheet, SheetHead } from '../components/Sheet.js';
import { formError } from '../screens/auth.js';
import { LinkResult } from '../screens/links.js';
import { useTripCtx } from './TripLayout.js';

export const watchedKey = (tripId: string, userId: string) => `drunkify.watched.${tripId}.${userId}`;

export function hasWatched(tripId: string, userId: string): boolean {
  try {
    return localStorage.getItem(watchedKey(tripId, userId)) === '1';
  } catch {
    return false;
  }
}

function Stack() {
  return (
    <div className="stack" aria-hidden="true">
      {[
        ['-14deg', '#3F2B1C'],
        ['-4deg', '#C9534A'],
        ['8deg', '#F4A73B'],
      ].map(([rotate, colour]) => (
        <div key={rotate} style={{ background: colour, transform: `translateX(-50%) rotate(${rotate})` }} />
      ))}
    </div>
  );
}

function dateTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Owner-only: theme and unlock time stay editable until the ceremony starts (DS §6.11). */
function OwnerSettings() {
  const { trip, pack } = useTripCtx();
  const [sheet, setSheet] = useState<'theme' | 'unlock' | null>(null);
  const [unlock, setUnlock] = useState(toLocalInput(trip.unlockAt));
  const opened = serverNow() >= trip.unlockAt;

  const patch = async (body: Record<string, unknown>) => {
    try {
      await send('PATCH', `/trips/${trip.id}`, body);
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      setSheet(null);
    } catch (error) {
      toast(formError(error));
    }
  };

  return (
    <>
      <div className="details" style={{ marginTop: 18 }}>
        <div className="drow">
          <div className="v">
            <b>{tp(pack, 'owner.themeLabel')}</b>
            <span>{pack.name}</span>
          </div>
          <button type="button" className="mini" onClick={() => setSheet('theme')}>
            {tp(pack, 'owner.change')}
          </button>
        </div>
        <div className="drow">
          <div className="v">
            <b>{opened ? 'Wrapped opened' : tp(pack, 'owner.unlockLabel')}</b>
            <span>{dateTime(trip.unlockAt)}</span>
          </div>
          <button type="button" className="mini" onClick={() => setSheet('unlock')}>
            {tp(pack, 'owner.change')}
          </button>
        </div>
      </div>
      <BottomSheet open={sheet === 'theme'} onClose={() => setSheet(null)} label={tp(pack, 'owner.themeLabel')}>
        <SheetHead title={tp(pack, 'owner.themeLabel')} onClose={() => setSheet(null)} />
        {[
          ['classic', 'Classic'],
          ['cs2', 'CS2'],
        ].map(([id, name]) => (
          <button type="button" key={id} className="srow" onClick={() => void patch({ themeId: id })}>
            <div className="v">
              <b>{name}</b>
            </div>
            {trip.themeId === id ? <Icon name="check" className="chk" /> : null}
          </button>
        ))}
      </BottomSheet>
      <BottomSheet open={sheet === 'unlock'} onClose={() => setSheet(null)} label={tp(pack, 'owner.unlockLabel')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const ms = new Date(unlock).getTime();
            if (!Number.isNaN(ms)) void patch({ unlockAt: ms });
          }}
        >
          <SheetHead title={tp(pack, 'owner.unlockLabel')} onClose={() => setSheet(null)} />
          <input
            className="inp"
            type="datetime-local"
            value={unlock}
            aria-label={tp(pack, 'owner.unlockLabel')}
            onChange={(event) => setUnlock(event.target.value)}
          />
          <button type="submit" className="pbtn">
            Save
          </button>
        </form>
      </BottomSheet>
    </>
  );
}

export function WrappedTab() {
  const { trip, pack, me, members, isOwner, member } = useTripCtx();
  const navigate = useNavigate();
  const status = useWrappedStatus(trip.id);
  const [tv, setTv] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = member(trip.ownerId)?.name ?? 'the owner';
  const now = serverNow();
  const unlocked = status.data?.personalUnlocked ?? now >= trip.unlockAt;
  const started = status.data?.ceremonyStarted ?? trip.ceremonyStartedAt !== null;
  const watched = hasWatched(trip.id, me.id);
  const days = Math.round(
    (Date.parse(`${trip.endDate}T12:00:00Z`) - Date.parse(`${trip.startDate}T12:00:00Z`)) / 86_400_000,
  ) + 1;

  const start = async () => {
    setBusy(true);
    try {
      await send('POST', `/trips/${trip.id}/ceremony/start`);
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      navigate(`/t/${trip.id}/ceremony`);
    } catch (error) {
      toast(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const castUrl = `${location.origin}${appUrl(`/t/${trip.id}/ceremony?display=big`)}`;

  // Unlocked but not yet watched: the "your Wrapped is ready" screen.
  if (unlocked && !watched && !started) {
    return (
      <>
        <div style={{ marginTop: 'auto' }}>
          <p className="pmuted">
            {tp(pack, 'wrappedPersonal.ready.pre', { days, members: members.length })}
          </p>
          <p className="big2" style={{ marginTop: 8 }}>
            {tp(pack, 'wrappedPersonal.ready.title')}
          </p>
        </div>
        <button type="button" className="logbtn" onClick={() => navigate(`/t/${trip.id}/wrapped/personal`)}>
          <Icon name="play" /> {tp(pack, 'wrappedPersonal.ready.cta')}
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="ph">{pack.wrappedSquad.title}</h1>

      {!unlocked ? (
        <>
          <Stack />
          <div className="blk" style={{ textAlign: 'center' }}>
            <h4>{trip.unlockAt - now < 86_400_000 ? countdown(trip.unlockAt - now) : dateTime(trip.unlockAt)}</h4>
            <p>{tp(pack, 'home.countdown')}</p>
          </div>
          {isOwner ? <OwnerSettings /> : null}
        </>
      ) : started ? (
        <>
          <Stack />
          <div className="blk" style={{ textAlign: 'center' }}>
            <h4>{tp(pack, 'wrappedSquad.presenting', { device: 'the big screen' })}</h4>
          </div>
          <button type="button" className="logbtn" onClick={() => navigate(`/t/${trip.id}/ceremony`)}>
            {isOwner ? 'Open the clicker' : 'Watch along'}
          </button>
          <button type="button" className="btn sec full" style={{ marginTop: 12 }} onClick={() => navigate(`/t/${trip.id}/wrapped/personal`)}>
            {pack.wrappedSquad.rewatch}
          </button>
        </>
      ) : isOwner ? (
        <>
          <div className="blk">
            <div className="drow" style={{ paddingLeft: 0, border: 0 }}>
              <Icon name="play" />
              <div className="v">
                <b>
                  {tp(pack, 'wrappedSquad.ownerWatched', {
                    n: status.data?.personalWatchedCount ?? 0,
                    total: status.data?.totalMembers ?? members.length,
                  })}
                </b>
              </div>
            </div>
          </div>
          <button type="button" className="logbtn" disabled={busy} onClick={() => void start()}>
            {pack.wrappedSquad.start}
          </button>
          <button type="button" className="btn sec full" style={{ marginTop: 10 }} onClick={() => setTv(true)}>
            <Icon name="tv" /> {pack.wrappedSquad.cast}
          </button>
          <button type="button" className="tbtn" onClick={() => navigate(`/t/${trip.id}/wrapped/personal`)}>
            {pack.wrappedSquad.rewatch}
          </button>
          <OwnerSettings />
        </>
      ) : (
        <>
          <Stack />
          <div className="blk" style={{ textAlign: 'center' }}>
            <h4>{tp(pack, 'wrappedSquad.waitingTitle', { owner })}</h4>
          </div>
          <button type="button" className="btn sec full" style={{ marginTop: 12 }} onClick={() => navigate(`/t/${trip.id}/wrapped/personal`)}>
            {pack.wrappedSquad.rewatch}
          </button>
        </>
      )}

      <BottomSheet open={tv} onClose={() => setTv(false)} label={pack.wrappedSquad.cast}>
        {tv ? (
          <LinkResult
            title={pack.wrappedSquad.cast}
            url={castUrl}
            shareMessage={castUrl}
            qrLabel="QR code for the big-screen link"
            startWithQr
            onClose={() => setTv(false)}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}
