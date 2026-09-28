import { useEffect, useState } from 'react';

import { tp } from '../app/content.js';
import { queryClient, send, serverNow } from '../app/queries.js';
import { Icon } from '../components/icons.js';
import { toast } from '../components/overlayStore.js';
import { BackButton, BottomSheet, SheetHead } from '../components/Sheet.js';
import { formError } from '../screens/auth.js';
import { useTripCtx } from './TripLayout.js';

const THEMES: Array<[string, string]> = [
  ['classic', 'Classic'],
  ['cs2', 'CS2'],
];

export function dateTime(ms: number): string {
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

type View = 'menu' | 'name' | 'theme' | 'unlock';

/**
 * Owner-only trip settings, reached from the trip name in the top bar. Name, theme and the Wrapped
 * unlock time stay editable until the ceremony starts (DS §6.11); the server enforces the same.
 */
export function EditTripSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { trip, pack } = useTripCtx();
  const [view, setView] = useState<View>('menu');
  const [name, setName] = useState(trip.name);
  const [unlock, setUnlock] = useState(toLocalInput(trip.unlockAt));
  const [busy, setBusy] = useState(false);
  const opened = serverNow() >= trip.unlockAt;
  const locked = trip.ceremonyStartedAt !== null;

  useEffect(() => {
    if (!open) return;
    setView('menu');
    setName(trip.name);
    setUnlock(toLocalInput(trip.unlockAt));
  }, [open, trip.name, trip.unlockAt]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await send('PATCH', `/trips/${trip.id}`, body);
      await queryClient.invalidateQueries({ queryKey: ['trip', trip.id] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      setView('menu');
    } catch (error) {
      toast(formError(error));
    } finally {
      setBusy(false);
    }
  };

  const back = <BackButton onClick={() => setView('menu')} />;
  let body;
  if (view === 'name') {
    body = (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void patch({ name: name.trim() });
        }}
      >
        <SheetHead title="Trip name" onClose={onClose} left={back} />
        <input
          className="inp"
          autoFocus
          value={name}
          maxLength={80}
          aria-label="Trip name"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="pbtn" disabled={busy || !name.trim()}>
          Save
        </button>
      </form>
    );
  } else if (view === 'theme') {
    body = (
      <>
        <SheetHead title={tp(pack, 'owner.themeLabel')} onClose={onClose} left={back} />
        <p className="pmuted" style={{ margin: '0 0 6px' }}>
          {tp(pack, 'owner.themeHint')}
        </p>
        {THEMES.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className="srow"
            disabled={busy}
            onClick={() => void (trip.themeId === id ? setView('menu') : patch({ themeId: id }))}
          >
            <div className="v">
              <b>{label}</b>
            </div>
            {trip.themeId === id ? <Icon name="check" className="chk" /> : null}
          </button>
        ))}
      </>
    );
  } else if (view === 'unlock') {
    body = (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const ms = new Date(unlock).getTime();
          if (!Number.isNaN(ms)) void patch({ unlockAt: ms });
        }}
      >
        <SheetHead title={tp(pack, 'owner.unlockLabel')} onClose={onClose} left={back} />
        <input
          className="inp"
          type="datetime-local"
          value={unlock}
          aria-label={tp(pack, 'owner.unlockLabel')}
          onChange={(event) => setUnlock(event.target.value)}
        />
        <button type="submit" className="pbtn" disabled={busy}>
          Save
        </button>
      </form>
    );
  } else {
    const row = (label: string, value: string, next: View) => (
      <button type="button" className="srow" disabled={locked} onClick={() => setView(next)}>
        <div className="v">
          <b>{label}</b>
          <span>{value}</span>
        </div>
        {locked ? null : <Icon name="down" className="fwd" />}
      </button>
    );
    body = (
      <>
        <SheetHead title="Edit trip" onClose={onClose} />
        {row('Trip name', trip.name, 'name')}
        {row(tp(pack, 'owner.themeLabel'), pack.name, 'theme')}
        {row(
          opened ? 'Wrapped opened' : tp(pack, 'owner.unlockLabel'),
          dateTime(trip.unlockAt),
          'unlock',
        )}
        {locked ? (
          <p className="pmuted" style={{ margin: '10px 0 0' }}>
            The ceremony has started, so the trip is locked in.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} label="Edit trip">
      {body}
    </BottomSheet>
  );
}
