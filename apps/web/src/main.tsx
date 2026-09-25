import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import '@drunkify/content/css/tokens.css';
import './styles.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CeremonyScreen } from './ceremony/CeremonyScreen.js';
import { bigScreenTripId } from './ceremony/model.js';
import {
  countPendingDrinks,
  installOutboxReplay,
  OUTBOX_CHANGED_EVENT,
  OUTBOX_SESSION_LOST_EVENT,
  type OutboxChangedDetail,
} from './offline/index.js';

function App() {
  const [queued, setQueued] = useState(0);
  const [sessionLost, setSessionLost] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const currentUserId = () => localStorage.getItem('drunkify.lastUser');
    const refreshCount = async () => {
      const userId = currentUserId();
      setQueued(userId ? await countPendingDrinks(userId) : 0);
    };
    const replay = installOutboxReplay({
      getCurrentUserId: currentUserId,
      onRejected: () => void refreshCount(),
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<OutboxChangedDetail>).detail;
      if (detail.userId === currentUserId()) setQueued(detail.count);
    };
    const onSessionLost = () => {
      setSessionLost(true);
      void refreshCount();
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener(OUTBOX_CHANGED_EVENT, onChanged);
    window.addEventListener(OUTBOX_SESSION_LOST_EVENT, onSessionLost);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void refreshCount();
    if (navigator.onLine) void replay.flush();

    return () => {
      replay.dispose();
      window.removeEventListener(OUTBOX_CHANGED_EVENT, onChanged);
      window.removeEventListener(OUTBOX_SESSION_LOST_EVENT, onSessionLost);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <main className="shell">
      {sessionLost && (
        <aside className="session-banner" role="status">
          <strong>Session lost.</strong> Your queued drinks are safe. Sign in with the same account
          to sync them.
        </aside>
      )}
      <p className="eyebrow">Trip drink log</p>
      <h1>Drunkify</h1>
      <p className="lede">Installable, offline-ready, and built to keep every queued round.</p>
      <section className="sync-card" aria-live="polite">
        <span className={`connection-dot ${online ? 'online' : 'offline'}`} aria-hidden="true" />
        <div>
          <strong>{online ? 'Online' : 'Offline'}</strong>
          <p>
            {queued === 0
              ? 'No drinks waiting to sync.'
              : `${queued} queued ${queued === 1 ? 'drink' : 'drinks'} waiting to sync.`}
          </p>
        </div>
      </section>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');
const ceremonyTripId = bigScreenTripId(window.location);
createRoot(root).render(
  <StrictMode>{ceremonyTripId ? <CeremonyScreen tripId={ceremonyTripId} /> : <App />}</StrictMode>,
);
