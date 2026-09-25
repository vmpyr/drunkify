import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/600.css';
import '@drunkify/content/css/tokens.css';
import './styles.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { CeremonyScreen } from './ceremony/CeremonyScreen.js';
import { bigScreenTripId } from './ceremony/model.js';
import {
  countPendingDrinks,
  installOutboxReplay,
  OUTBOX_CHANGED_EVENT,
  OUTBOX_SESSION_LOST_EVENT,
  type OutboxChangedDetail,
} from './offline/index.js';

function RootApp() {
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

  return <App online={online} queued={queued} sessionLost={sessionLost} />;
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');
const ceremonyTripId = bigScreenTripId(window.location);
createRoot(root).render(
  <StrictMode>
    {ceremonyTripId ? <CeremonyScreen tripId={ceremonyTripId} /> : <RootApp />}
  </StrictMode>,
);
