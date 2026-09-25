import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  actionForKey,
  cardTitle,
  clampReplayProgress,
  displayValue,
  replayAtProgress,
  replayFromCard,
  type CeremonyAction,
  type CeremonyState,
  type ReplayPayload,
  type SquadWrappedPayload,
  type WrappedCard,
} from './model.js';

interface CeremonyScreenProps {
  tripId: string;
}

interface CeremonyResponse {
  state: CeremonyState;
}

interface SquadResponse {
  unlocked: boolean;
  payload: SquadWrappedPayload | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set('content-type', 'application/json');
  if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
    headers.set('x-requested-with', 'drunkify');
  }
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function varsOf(card: WrappedCard): Array<[string, string]> {
  return Object.entries(card.vars ?? {}).map(([key, value]) => [key, displayValue(value)]);
}

function MainStat({ card, subStep }: { card: WrappedCard; subStep: number }) {
  const vars = varsOf(card);
  const featured = vars[Math.min(subStep, Math.max(vars.length - 1, 0))];
  return (
    <div className="ceremony-stat">
      {featured ? (
        <>
          <span className="ceremony-stat__value tabular-nums">{featured[1]}</span>
          <span className="ceremony-stat__label">{featured[0].replaceAll('_', ' ')}</span>
        </>
      ) : (
        <span className="ceremony-stat__value">Cheers.</span>
      )}
      {vars.length > 1 && (
        <div className="ceremony-pills">
          {vars.map(([key, value]) => (
            <span key={key}>
              <b>{value}</b> {key.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplayVisual({ replay, progress }: { replay: ReplayPayload; progress: number }) {
  const visible = replayAtProgress(replay, progress);
  const latestDay = visible.dayEndMarkers.at(-1);
  const latestPop = visible.achievementPops.at(-1);
  const memberTotals = replay.memberIndex.map((memberId, memberIndex) => ({
    memberId,
    count: visible.events.filter((event) => event.memberIndex === memberIndex).length,
  }));

  return (
    <div className="replay" aria-label={`Trip replay ${Math.round(progress * 100)}% complete`}>
      <div className="replay__sky" aria-hidden="true">
        {visible.events.slice(-48).map((event, index) => (
          <i
            key={`${event.tOffsetMs}-${index}`}
            style={
              {
                '--event-x': `${(event.tOffsetMs / Math.max(replay.totalPlaybackMs, 1)) * 100}%`,
                '--event-y': `${14 + ((event.memberIndex * 19 + index * 7) % 70)}%`,
                '--event-size': `${8 + Math.min(event.std * 5, 20)}px`,
              } as React.CSSProperties
            }
          />
        ))}
        <div className="replay__pulse">
          <strong>{visible.events.length}</strong>
          <span>drinks replayed</span>
        </div>
      </div>
      <div className="replay__members">
        {memberTotals.map((member, index) => (
          <span key={member.memberId} style={{ '--member': index } as React.CSSProperties}>
            <i />
            {member.memberId} <b>{member.count}</b>
          </span>
        ))}
      </div>
      <div className="replay__track">
        <span style={{ width: `${progress * 100}%` }} />
        {replay.dayEndMarkers.map((marker) => (
          <i
            key={`${marker.tripDay}-${marker.tOffsetMs}`}
            style={{ left: `${(marker.tOffsetMs / Math.max(replay.totalPlaybackMs, 1)) * 100}%` }}
            title={`Day ${marker.tripDay}`}
          />
        ))}
      </div>
      <div className="replay__caption">
        <span>{latestDay ? `Day ${latestDay.tripDay} complete` : 'The trip begins…'}</span>
        <span>
          {latestPop ? `Achievement: ${latestPop.key.replaceAll('_', ' ')}` : 'Live replay'}
        </span>
      </div>
    </div>
  );
}

function SideBoard({ card, subStep }: { card: WrappedCard; subStep: number }) {
  const boards = card.data?.boards as Record<string, Array<Record<string, unknown>>> | undefined;
  const keys = Object.keys(boards ?? {});
  const selected = keys[Math.min(subStep, Math.max(keys.length - 1, 0))];
  const rows = selected ? (boards?.[selected] ?? []) : [];
  return (
    <div className="ceremony-list">
      <h3>{selected?.replaceAll('_', ' ') ?? 'No side quests logged'}</h3>
      {rows.slice(0, 6).map((row, index) => (
        <div
          key={
            typeof row.userId === 'string' || typeof row.userId === 'number'
              ? String(row.userId)
              : String(index)
          }
        >
          <span>
            {index + 1}. {displayValue(row.userId)}
          </span>
          <b>{displayValue(row.value)}</b>
        </div>
      ))}
    </div>
  );
}

function PredictionBoard({ card, subStep }: { card: WrappedCard; subStep: number }) {
  const rows = (card.data?.rows as Array<Record<string, unknown>> | undefined) ?? [];
  const row = rows[Math.min(subStep, Math.max(rows.length - 1, 0))];
  return row ? (
    <div className="ceremony-versus">
      <span>{displayValue(row.userId)}</span>
      <div>
        <small>predicted</small>
        <strong>{displayValue(row.predicted)}</strong>
      </div>
      <i>vs</i>
      <div>
        <small>actual</small>
        <strong>{displayValue(row.actual)}</strong>
      </div>
    </div>
  ) : (
    <MainStat card={card} subStep={subStep} />
  );
}

function AwardBoard({ card, subStep }: { card: WrappedCard; subStep: number }) {
  const award = card.winners?.[Math.min(subStep, Math.max((card.winners?.length ?? 1) - 1, 0))];
  return award ? (
    <div className="ceremony-award">
      <span>🏆</span>
      <h3>{award.award.replaceAll('_', ' ')}</h3>
      <p>{award.winners.map((winner) => winner.userId).join(' & ')}</p>
      {award.winners[0]?.venue && <small>at {award.winners[0].venue}</small>}
    </div>
  ) : (
    <div className="ceremony-stat">
      <span className="ceremony-stat__value">No awards</span>
    </div>
  );
}

function MainBoard({ card, subStep }: { card: WrappedCard; subStep: number }) {
  const ranking = (card.data?.ranking as Array<Record<string, unknown>> | undefined) ?? [];
  const visible = ranking.slice(0, subStep + 1);
  return (
    <div className="ceremony-list ceremony-list--ranking">
      {visible.length === 0 && <h3>Ready for the final table?</h3>}
      {visible.map((row) => (
        <div key={String(row.userId)}>
          <span>
            <em>#{displayValue(row.rank)}</em> {displayValue(row.userId)}
          </span>
          <b>{displayValue(row.std)} std</b>
        </div>
      ))}
    </div>
  );
}

function CardBody({
  card,
  subStep,
  replayProgress,
}: {
  card: WrappedCard;
  subStep: number;
  replayProgress: number;
}) {
  if (card.id === '06_replay') {
    const replay = replayFromCard(card);
    return replay ? (
      <ReplayVisual replay={replay} progress={replayProgress} />
    ) : (
      <MainStat card={card} subStep={subStep} />
    );
  }
  if (card.id === '07_side_boards') return <SideBoard card={card} subStep={subStep} />;
  if (card.id === '08_predictions') return <PredictionBoard card={card} subStep={subStep} />;
  if (card.id === '09_awards') return <AwardBoard card={card} subStep={subStep} />;
  if (card.id === '10_main_board') return <MainBoard card={card} subStep={subStep} />;
  return <MainStat card={card} subStep={subStep} />;
}

export function CeremonyScreen({ tripId }: CeremonyScreenProps) {
  const [state, setState] = useState<CeremonyState | null>(null);
  const [payload, setPayload] = useState<SquadWrappedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [replayElapsed, setReplayElapsed] = useState(0);
  const replayActiveRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [ceremony, squad] = await Promise.all([
        api<CeremonyResponse>(`/api/v1/trips/${tripId}/ceremony/state`),
        api<SquadResponse>(`/api/v1/trips/${tripId}/wrapped/squad`),
      ]);
      setState(ceremony.state);
      setPayload(squad.payload);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load ceremony');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(`/api/v1/trips/${tripId}/events`, { withCredentials: true });
    const sync = () => void refresh();
    events.addEventListener('hello', () => setLive(true));
    events.addEventListener('ceremony.started', sync);
    events.addEventListener('ceremony.step', sync);
    events.onerror = () => setLive(false);
    return () => events.close();
  }, [refresh, tripId]);

  const perform = useCallback(
    async (action: CeremonyAction) => {
      if (!state || busy) return;
      if (action === 'hold' && state.status !== 'running') return;
      if (action === 'back' && state.status === 'not_started') return;
      setBusy(true);
      try {
        let path: string;
        let body: Record<string, unknown> | undefined;
        if (action === 'hold') {
          path = 'hold';
          body = { held: !state.held };
        } else if (action === 'next' && state.status === 'not_started') {
          path = 'start';
        } else if (action === 'next' && state.status === 'ended') {
          path = 'restart';
        } else {
          path = 'advance';
          body = { direction: action === 'back' ? 'back' : 'next' };
        }
        const result = await api<CeremonyResponse>(`/api/v1/trips/${tripId}/ceremony/${path}`, {
          method: 'POST',
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        setState(result.state);
        setError(null);
        if (path === 'start' || path === 'restart') await refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Ceremony control failed');
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh, state, tripId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionForKey(event.key);
      if (!action || event.repeat) return;
      event.preventDefault();
      void perform(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [perform]);

  const card = payload?.cards[state?.cardIndex ?? 0];
  const replay = replayFromCard(card);
  const replayActive = state?.status === 'running' && card?.id === '06_replay';
  useEffect(() => {
    if (replayActive && !replayActiveRef.current) setReplayElapsed(0);
    replayActiveRef.current = replayActive;
    if (!replayActive || state?.held || !replay) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      setReplayElapsed((value) => Math.min(value + now - previous, replay.totalPlaybackMs));
      previous = now;
    }, 100);
    return () => window.clearInterval(timer);
  }, [replay, replayActive, state?.held]);
  const replayProgress = replay ? clampReplayProgress(replayElapsed, replay.totalPlaybackMs) : 0;

  const progress = useMemo(() => {
    if (!payload || !state) return 0;
    if (state.status === 'ended') return 100;
    return ((state.cardIndex + 1) / payload.cards.length) * 100;
  }, [payload, state]);

  if (loading)
    return (
      <main className="ceremony-screen ceremony-screen--center">
        <div className="ceremony-loader" />
        <p>Loading the big screen…</p>
      </main>
    );
  if (!state)
    return (
      <main className="ceremony-screen ceremony-screen--center">
        <h1>Couldn’t join the ceremony</h1>
        <p>{error}</p>
        <button onClick={() => void refresh()}>Try again</button>
      </main>
    );

  return (
    <main
      className={`ceremony-screen ceremony-screen--card-${state.cardIndex + 1}`}
      onClick={() => void perform('next')}
    >
      <div className="ceremony-ambient" aria-hidden="true" />
      <header className="ceremony-header">
        <span className="ceremony-brand">DRUNKIFY WRAPPED</span>
        <span className={`ceremony-live ${live ? 'is-live' : ''}`}>
          {live ? 'LIVE' : 'SYNCING'}
        </span>
        <span className="ceremony-count tabular-nums">
          {Math.min(state.cardIndex + 1, payload?.cards.length ?? 11)} /{' '}
          {payload?.cards.length ?? 11}
        </span>
      </header>

      {state.status === 'not_started' ? (
        <section className="ceremony-waiting">
          <p>Squad Wrapped</p>
          <h1>Ready when you are.</h1>
          <button
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void perform('next');
            }}
          >
            Start ceremony
          </button>
        </section>
      ) : state.status === 'ended' ? (
        <section className="ceremony-waiting">
          <p>That’s a wrap</p>
          <h1>One more round?</h1>
          <button
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void perform('next');
            }}
          >
            Restart ceremony
          </button>
        </section>
      ) : card ? (
        <section className="ceremony-stage" key={`${card.id}-${state.subStep}`}>
          <p className="ceremony-kicker">
            {card.key?.replaceAll('_', ' ') ?? `Card ${state.cardIndex + 1}`}
          </p>
          <h1>{cardTitle(card)}</h1>
          <CardBody card={card} subStep={state.subStep} replayProgress={replayProgress} />
        </section>
      ) : (
        <section className="ceremony-waiting">
          <h1>Waiting for the squad payload…</h1>
        </section>
      )}

      <footer className="ceremony-footer" onClick={(event) => event.stopPropagation()}>
        <div className="ceremony-progress" aria-label={`${Math.round(progress)}% through ceremony`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="ceremony-controls">
          <button
            aria-label="Previous reveal"
            disabled={busy || state.status === 'not_started'}
            onClick={() => void perform('back')}
          >
            ←
          </button>
          <span>
            {state.held ? 'Held · press H to resume' : '← / → / space · H to hold · tap to advance'}
          </span>
          <button
            aria-label={state.status === 'ended' ? 'Restart ceremony' : 'Next reveal'}
            disabled={busy}
            onClick={() => void perform('next')}
          >
            {state.status === 'ended' ? '↻' : '→'}
          </button>
        </div>
      </footer>
      {state.held && <div className="ceremony-held">HELD</div>}
      {error && (
        <div className="ceremony-error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
