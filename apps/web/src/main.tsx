import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/700.css';
import '@drunkify/content/css/tokens.css';
import './styles.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { queryClient, useMe } from './app/queries.js';
import { HomeRedirect, RequireAuth, useSessionSync } from './app/session.js';
import { CeremonyRoute } from './ceremony/CeremonyScreen.js';
import { Overlays } from './components/Overlays.js';
import {
  installOutboxReplay,
  OUTBOX_CHANGED_EVENT,
  OUTBOX_SESSION_LOST_EVENT,
} from './offline/index.js';
import { Account } from './screens/account.js';
import { CreateAccount, InviteLanding, LinkProblem, ResetPassword, Setup, SignIn } from './screens/auth.js';
import { CreateTrip, NoTrip } from './screens/home.js';
import { People } from './screens/people.js';
import { Board } from './trip/Board.js';
import { Feed } from './trip/Feed.js';
import { LogHome } from './trip/LogHome.js';
import { Predictions } from './trip/Predictions.js';
import { PersonalWrapped } from './trip/Story.js';
import { TopBar, TripLayout, TripProvider } from './trip/TripLayout.js';
import { WrappedTab } from './trip/Wrapped.js';

/** Replays drinks logged offline once we're back, then refreshes whatever they touched. */
function useOutbox() {
  useEffect(() => {
    const currentUserId = () => {
      try {
        return localStorage.getItem('drunkify.lastUser');
      } catch {
        return null;
      }
    };
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox'] });
      void queryClient.invalidateQueries({ queryKey: ['trip'] });
    };
    const replay = installOutboxReplay({ getCurrentUserId: currentUserId, onRejected: refresh });
    const onSessionLost = () => {
      try {
        sessionStorage.setItem('drunkify.signedOut', '1');
      } catch {
        /* private mode */
      }
      queryClient.setQueryData(['me'], null);
    };
    window.addEventListener(OUTBOX_CHANGED_EVENT, refresh);
    window.addEventListener(OUTBOX_SESSION_LOST_EVENT, onSessionLost);
    if (navigator.onLine) void replay.flush();
    return () => {
      replay.dispose();
      window.removeEventListener(OUTBOX_CHANGED_EVENT, refresh);
      window.removeEventListener(OUTBOX_SESSION_LOST_EVENT, onSessionLost);
    };
  }, []);
}

function Predict() {
  return (
    <TripProvider>
      <main className="scr trip">
        <TopBar />
        <div className="tab-body">
          <Predictions />
        </div>
      </main>
    </TripProvider>
  );
}

function App() {
  const me = useMe();
  useSessionSync(me.data);
  useOutbox();
  return (
    <>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/i/:token" element={<InviteLanding />} />
        <Route path="/i/:token/create" element={<CreateAccount />} />
        <Route path="/r/:token" element={<ResetPassword />} />
        <Route path="/link-problem" element={<LinkProblem />} />
        <Route
          path="/setup"
          element={
            <RequireAuth allowSetup>
              <Setup />
            </RequireAuth>
          }
        />
        <Route path="/no-trip" element={<RequireAuth><NoTrip /></RequireAuth>} />
        <Route path="/trips/new" element={<RequireAuth><CreateTrip /></RequireAuth>} />
        <Route path="/people" element={<RequireAuth><People /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
        <Route path="/t/:tripId" element={<RequireAuth><TripLayout /></RequireAuth>}>
          <Route index element={<Navigate to="log" replace />} />
          <Route path="log" element={<LogHome />} />
          <Route path="board" element={<Board />} />
          <Route path="feed" element={<Feed />} />
          <Route path="wrapped" element={<WrappedTab />} />
        </Route>
        <Route path="/t/:tripId/predictions" element={<RequireAuth><Predict /></RequireAuth>} />
        <Route
          path="/t/:tripId/wrapped/personal"
          element={
            <RequireAuth>
              <TripProvider>
                <PersonalWrapped />
              </TripProvider>
            </RequireAuth>
          }
        />
        <Route
          path="/t/:tripId/ceremony"
          element={
            <RequireAuth>
              <TripProvider>
                <CeremonyRoute />
              </TripProvider>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Overlays />
    </>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
