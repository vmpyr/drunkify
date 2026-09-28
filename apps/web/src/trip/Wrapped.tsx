import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { appUrl } from '../app/api.js';
import { countdown, tp } from '../app/content.js';
import { queryClient, send, serverNow, useWrappedStatus } from '../app/queries.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { AvatarStack } from '../components/Avatar.js';
import { BottomSheet } from '../components/Sheet.js';
import { formError } from '../screens/auth.js';
import { LinkResult } from '../screens/links.js';
import { dateTime } from './EditTrip.js';
import { useTripCtx } from './TripLayout.js';

export const watchedKey = (tripId: string, userId: string) => `drunkify.watched.${tripId}.${userId}`;

export function hasWatched(tripId: string, userId: string): boolean {
  try {
    return localStorage.getItem(watchedKey(tripId, userId)) === '1';
  } catch {
    return false;
  }
}

/** The face-down deck on the Wrapped tab: vector so it stays sharp on any screen density. */
export function Stack() {
  const cards: Array<[number, string]> = [
    [-14, '#3F2B1C'],
    [-4, '#C9534A'],
    [8, '#F4A73B'],
  ];
  return (
    <svg className="stack" viewBox="0 0 300 260" role="presentation" aria-hidden="true">
      <defs>
        <filter id="stack-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>
      {cards.map(([rotate, colour], i) => (
        <g key={rotate} transform={`rotate(${rotate} 150 250)`} filter="url(#stack-shadow)">
          <rect x="72" y="28" width="156" height="214" rx="18" fill={colour} />
          <rect
            x="82"
            y="38"
            width="136"
            height="194"
            rx="12"
            fill="none"
            stroke={i === 2 ? '#24160C' : '#FFF3DE'}
            strokeOpacity={i === 2 ? 0.28 : 0.12}
            strokeWidth="2"
          />
          {i === 2 ? (
            <g fill="none" stroke="#24160C" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="118" y="118" width="64" height="50" rx="4" />
              <path d="M112 104h76v14h-76z" />
              <path d="M150 104v64" />
              <path d="M150 104c-6-14-26-16-26-4 0 6 10 4 26 4zM150 104c6-14 26-16 26-4 0 6-10 4-26 4z" />
            </g>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/** Before the unlock: anyone can vote to open it now; it only opens when the whole squad agrees. */
function EarlyRelease() {
  const { trip, me, members, pack } = useTripCtx();
  const status = useWrappedStatus(trip.id);
  const [busy, setBusy] = useState(false);
  const votes = status.data?.earlyVoteUserIds ?? [];
  const active = members.filter((item) => !item.disabled);
  const total = status.data?.earlyVoteTotal ?? active.length;
  const mine = votes.includes(me.id);
  const voters = active.filter((item) => votes.includes(item.userId));
  const holdouts = active.filter((item) => !votes.includes(item.userId));

  const vote = async (agree: boolean) => {
    setBusy(true);
    try {
      const result = await send<{ released: boolean }>('POST', `/trips/${trip.id}/wrapped/early`, { agree });
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      if (result?.released) toast(tp(pack, 'wrappedPersonal.ready.title'));
    } catch (error) {
      toast(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="blk early">
      <h4>Can’t wait?</h4>
      <p>
        {total <= 1
          ? 'Open it now.'
          : `It opens early only if all ${total} of you agree. ${votes.length} of ${total} in so far.`}
      </p>
      {total > 1 ? (
        <div className="early-bar" aria-hidden="true">
          {active.map((item) => (
            <i key={item.userId} className={votes.includes(item.userId) ? 'on' : ''} />
          ))}
        </div>
      ) : null}
      {voters.length > 0 ? (
        <div className="early-who">
          <AvatarStack members={voters} max={10} label={`Agreed: ${voters.map((item) => item.name).join(', ')}`} />
          {holdouts.length > 0 && holdouts.length <= 3 ? (
            <span>Waiting on {holdouts.map((item) => (item.userId === me.id ? 'you' : item.name)).join(', ')}</span>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className={`btn full ${mine ? 'sec' : ''}`}
        disabled={busy || status.isPending}
        aria-pressed={mine}
        onClick={() => void vote(!mine)}
      >
        {mine ? 'Take my vote back' : votes.length === total - 1 ? 'I’m in. Open it' : 'I’m in, open it early'}
      </button>
    </div>
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
          <EarlyRelease />
          {isOwner ? (
            <p className="pmuted early-hint">Tap the trip name up top to change the theme or when it opens.</p>
          ) : null}
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
