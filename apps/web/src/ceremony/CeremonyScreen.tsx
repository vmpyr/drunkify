import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { fmtL, memberColour, tp, tpMaybe } from '../app/content.js';
import { queryClient, send, serverNow, v1 } from '../app/queries.js';
import { Splash } from '../app/session.js';
import { initial } from '../components/Avatar.js';
import { toast } from '../components/overlayStore.js';
import { formError } from '../screens/auth.js';
import { TopBar, useTripCtx, type TripCtx } from '../trip/TripLayout.js';
import {
  actionForKey,
  clampReplayProgress,
  replayAtProgress,
  replayFromCard,
  type CeremonyAction,
  type CeremonyState,
  type SquadWrappedPayload,
  type WrappedCard,
} from './model.js';

function useCeremony(tripId: string, poll: boolean) {
  const state = useQuery({
    queryKey: ['trip', tripId, 'ceremony', 'state'],
    queryFn: async () => (await v1<{ state: CeremonyState }>(`/trips/${tripId}/ceremony/state`)).state,
    refetchInterval: poll ? 5000 : false,
  });
  const squad = useQuery({
    queryKey: ['trip', tripId, 'wrapped', 'squad'],
    queryFn: () => v1<{ unlocked: boolean; payload: SquadWrappedPayload | null }>(`/trips/${tripId}/wrapped/squad`),
    enabled: state.data?.status === 'running' || state.data?.status === 'ended',
    staleTime: Infinity,
  });
  return { state, squad };
}

async function act(tripId: string, action: CeremonyAction, state: CeremonyState | undefined) {
  try {
    const result =
      action === 'hold'
        ? await send<{ state: CeremonyState }>('POST', `/trips/${tripId}/ceremony/hold`, { held: !state?.held })
        : await send<{ state: CeremonyState }>('POST', `/trips/${tripId}/ceremony/advance`, { direction: action });
    if (result?.state) queryClient.setQueryData(['trip', tripId, 'ceremony', 'state'], result.state);
    else void queryClient.invalidateQueries({ queryKey: ['trip', tripId, 'ceremony'] });
  } catch (error) {
    toast(formError(error));
  }
}

type Vars = Record<string, string | number>;

function cardVars(card: WrappedCard | undefined): Vars {
  const out: Vars = {};
  for (const [key, value] of Object.entries(card?.vars ?? {})) out[key] = value ?? '';
  return out;
}

function splitAbsurd(phrase: string): string {
  return phrase.replace(/^[\d.,]+%?\s+/, '');
}

function Row({
  rank,
  name,
  colorIndex,
  value,
  rise,
}: {
  rank: ReactNode;
  name: string;
  colorIndex: number | undefined;
  value: ReactNode;
  rise?: boolean;
}) {
  return (
    <div className={`cr ${rise ? 'rise' : ''}`}>
      <span className="rk">{rank}</span>
      <span className="av" style={{ background: memberColour(colorIndex) }}>
        {initial(name)}
      </span>
      <span>{name}</span>
      <span className="v">{value}</span>
    </div>
  );
}

/** One squad card at the size of the room (DS §6.12 cast mode). */
export function CastCard({ ctx, payload, state }: { ctx: TripCtx; payload: SquadWrappedPayload; state: CeremonyState }) {
  const { pack, member, trip } = ctx;
  const index = Math.min(10, Math.max(0, state.cardIndex));
  const card = payload.cards[index];
  const step = state.subStep;
  const id = card?.id ?? '';
  const vars = cardVars(card);
  const variant = card?.key && card.key.startsWith(`${id}.`) ? card.key.slice(id.length + 1) : '';
  const c = (field: string, extra: Vars = {}) =>
    tpMaybe(pack, `wrappedSquad.cards.${id}.${field}`, { ...vars, ...extra }) ?? '';
  const nameOf = (userId: unknown) => (typeof userId === 'string' ? (member(userId)?.name ?? '') : '');
  const colourOf = (userId: unknown) => (typeof userId === 'string' ? member(userId)?.colorIndex : undefined);
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    if (id !== '06_replay') return;
    const timer = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(timer);
  }, [id]);

  let body: ReactNode;
  switch (id) {
    case '01_group_total':
      body = (
        <div className="in solo">
          <div>
            <h3>{c('lead')}</h3>
            <p className="hero">{fmtL(Number(vars.groupLitres ?? 0))}</p>
            <p className="line">{c('unit')}</p>
            {step >= 1 && vars.absurdUnitPhrase !== 'empty' ? (
              <p className="k">{c('absurd', { absurdUnitPhrase: splitAbsurd(String(vars.absurdUnitPhrase)) })}</p>
            ) : null}
          </div>
        </div>
      );
      break;
    case '02_drunk_o_meter': {
      const series = (card?.data?.series as Array<{ hourIndex: number; std: number; localLabel: string }> | undefined) ?? [];
      const incidents = (card?.data?.incidents as Array<{ hourIndex: number; std: number; rank: number }> | undefined) ?? [];
      const max = Math.max(0.1, ...series.map((point) => point.std));
      const span = Math.max(1, series.length - 1);
      const shown = incidents.slice(0, step + 1);
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            {variant === 'empty' ? (
              <p className="k">{c('empty')}</p>
            ) : (
              <>
                {shown.map((incident, i) => {
                  const point = series.find((item) => item.hourIndex === incident.hourIndex);
                  return (
                    <p className="line" key={incident.hourIndex}>
                      {c('incident', {
                        n: i + 1,
                        day: `Day ${Math.floor(incident.hourIndex / 24) + 1}`,
                        time: point?.localLabel ?? '',
                      })}
                    </p>
                  );
                })}
                <p className="k">{c('note')}</p>
              </>
            )}
          </div>
          <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }} aria-hidden="true">
            <polyline
              fill="none"
              stroke="#F4A73B"
              strokeWidth="0.8"
              points={series.map((point, i) => `${(i / span) * 100},${58 - (point.std / max) * 54}`).join(' ')}
            />
            {shown.map((incident) => {
              const i = series.findIndex((item) => item.hourIndex === incident.hourIndex);
              return <circle key={incident.hourIndex} cx={(i / span) * 100} cy={58 - (incident.std / max) * 54} r="1.6" fill="#FFF3DE" />;
            })}
          </svg>
        </div>
      );
      break;
    }
    case '03_keg':
      body = (
        <div className="in solo">
          <div>
            <h3>{c('lead')}</h3>
            <p className="hero">{vars.kegPct}%</p>
            <p className="line">{c('unit')}</p>
            <p className="k">{c('note')}</p>
          </div>
        </div>
      );
      break;
    case '04_cities_venues':
      body = (
        <div className="in solo">
          <div>
            <h3>{c('title')}</h3>
            {variant === 'empty' ? (
              <p className="k">{c('empty')}</p>
            ) : (
              <>
                <p className="line">{c('top')}</p>
                {step >= 1 ? <p className="k">{c('note')}</p> : null}
              </>
            )}
          </div>
        </div>
      );
      break;
    case '05_crowd_then_divisive': {
      const noCrowd = variant.includes('noCrowd');
      const noDivisive = variant.includes('noDivisive');
      const names = { lowName: nameOf(vars.lowName), highName: nameOf(vars.highName) };
      body = (
        <div className="in">
          <div>
            <h3>{noCrowd ? c('divLead') : c('favLead')}</h3>
            {noCrowd ? <p className="k">{c('noCrowd')}</p> : <p className="hero" style={{ fontSize: '9cqw' }}>{c('fav')}</p>}
          </div>
          <div style={{ alignSelf: 'end' }}>
            {step >= 1 || noCrowd ? (
              noDivisive ? (
                <p className="k">{c('noDivisive')}</p>
              ) : (
                <>
                  <p className="line">{c('divLead')}</p>
                  <p className="hero" style={{ fontSize: '7cqw' }}>{c('div')}</p>
                  <p className="k">{c('divNote', names)}</p>
                </>
              )
            ) : null}
          </div>
        </div>
      );
      break;
    }
    case '06_replay': {
      const replay = replayFromCard(card);
      const elapsed = state.held || state.replayStartedAt === null
        ? state.replayElapsedMs
        : state.replayElapsedMs + (now - state.replayStartedAt);
      const progress = replay ? clampReplayProgress(elapsed, replay.totalPlaybackMs) : 0;
      const view = replay ? replayAtProgress(replay, progress) : null;
      const points = replay?.events.filter((event) => event.lat !== null && event.lng !== null) ?? [];
      const lats = points.map((event) => event.lat!);
      const lngs = points.map((event) => event.lng!);
      const minLat = Math.min(...lats);
      const minLng = Math.min(...lngs);
      const spanGeo = Math.max(Math.max(...lats) - minLat, Math.max(...lngs) - minLng, 0.001);
      const mvp = view?.dayEndMarkers[view.dayEndMarkers.length - 1];
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            {variant === 'empty' ? <p className="k">{c('empty')}</p> : null}
            {mvp && replay ? (
              <p className="line">{c('nightMvp', { name: nameOf(replay.memberIndex[mvp.nightMvpIndex]) })}</p>
            ) : null}
            {state.held ? <p className="k">{pack.wrappedSquad.hold}</p> : null}
          </div>
          <div className="replay-dots" aria-hidden="true">
            {view?.events
              .filter((event) => event.lat !== null && event.lng !== null)
              .map((event, i) => (
                <i
                  key={i}
                  style={{
                    left: `${8 + ((event.lng! - minLng) / spanGeo) * 84}%`,
                    top: `${92 - ((event.lat! - minLat) / spanGeo) * 84}%`,
                    background: memberColour(colourOf(replay?.memberIndex[event.memberIndex])),
                  }}
                />
              ))}
          </div>
        </div>
      );
      break;
    }
    case '07_side_boards': {
      const boards = (card?.data?.boards as Record<string, Array<{ userId: string; rank: number; value: number }>> | undefined) ?? {};
      const entries = Object.entries(boards).slice(0, step + 1);
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            <p className="k">{c('note')}</p>
          </div>
          <div className="rows">
            {entries.map(([key, rows]) => (
              <div key={key} className="cr rise" style={{ gridTemplateColumns: '1fr auto' }}>
                <span>{tpMaybe(pack, `sideLeaderboards.${key}`) ?? key}</span>
                <b>{nameOf(rows[0]?.userId) || '—'}</b>
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
    case '08_predictions': {
      const rows = (card?.data?.rows as Array<{ userId: string; predicted: number; actual: number }> | undefined) ?? [];
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            {variant === 'empty' ? (
              <p className="k">{c('empty')}</p>
            ) : step >= rows.length - 1 ? (
              <p className="line">{c('oracle', { name: nameOf(vars.userId) })}</p>
            ) : null}
          </div>
          <div className="rows">
            {rows.slice(0, step + 1).map((row) => (
              <div key={row.userId} className="cr rise" style={{ gridTemplateColumns: '1fr' }}>
                <span>{c('row', { name: nameOf(row.userId), predicted: row.predicted, actual: row.actual })}</span>
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
    case '09_awards': {
      const winners = card?.winners ?? [];
      const current = winners[Math.min(step, winners.length - 1)];
      const venue = current?.winners[0]?.venue ?? '';
      body = (
        <div className="in solo">
          <div>
            <h3>{c('title')}</h3>
            {current ? (
              <>
                <p className="line" style={{ color: '#CFB696' }}>
                  {tpMaybe(pack, `awards.${current.award}.name`, { venue }) ?? current.award}
                </p>
                <p className="hero" style={{ fontSize: '10cqw' }}>
                  {current.winners.map((winner) => nameOf(winner.userId)).join(' & ')}
                </p>
                {current.isGhostSlot ? <p className="k">{c('ghostNote')}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      );
      break;
    }
    case '10_main_board': {
      const ranking = (card?.data?.ranking as Array<{ userId: string; rank: number; litres: number }> | undefined) ?? [];
      const revealedAll = step >= ranking.length - 1;
      const shown = ranking.slice(0, Math.min(step + 1, Math.max(0, ranking.length - 1)));
      const top = ranking[ranking.length - 1];
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            <div className="k">{c('subtitle')}</div>
          </div>
          <div className="stand">
            {shown.map((row, i) => (
              <Row
                key={row.userId}
                rank={row.rank}
                name={nameOf(row.userId)}
                colorIndex={colourOf(row.userId)}
                value={fmtL(row.litres)}
                rise={i === shown.length - 1}
              />
            ))}
            {top ? (
              revealedAll ? (
                <div className="cr top rise">
                  <span className="rk">1</span>
                  <span className="av" style={{ background: memberColour(colourOf(top.userId)) }}>
                    {initial(nameOf(top.userId))}
                  </span>
                  <span className="q">{nameOf(top.userId)}</span>
                  <span className="q">{fmtL(top.litres)}</span>
                </div>
              ) : (
                <div className="cr top">
                  <span className="rk">1</span>
                  <span />
                  <span className="q">{c('mvp')}</span>
                  <span className="q">?</span>
                </div>
              )
            ) : null}
          </div>
        </div>
      );
      break;
    }
    case '11_credits': {
      const bloopers = (card?.data?.bloopers as Record<string, { userId: string; edits?: number } | null> | undefined) ?? {};
      const lines = [
        bloopers.smallest ? c('smallest', { name: nameOf(bloopers.smallest.userId) }) : null,
        bloopers.strangestNote ? c('strangestNote', { name: nameOf(bloopers.strangestNote.userId) }) : null,
        bloopers.mostEdited ? c('mostEdited', { name: nameOf(bloopers.mostEdited.userId), drink: vars.drink ?? '' }) : null,
        bloopers.loneWater ? c('lateWater', { name: nameOf(bloopers.loneWater.userId), time: `${vars.time}:00` }) : null,
      ].filter(Boolean);
      body = (
        <div className="in">
          <div>
            <h3>{c('title')}</h3>
            <p className="line">{trip.name}</p>
          </div>
          <div className="rows">
            <p className="line" style={{ margin: 0 }}>{c('bloopersTitle')}</p>
            {lines.map((line) => (
              <div key={line}>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      );
      break;
    }
    default:
      body = null;
  }

  return (
    <>
      {body}
      <div className="foot">
        <span>{tp(pack, 'wrappedSquad.footer', { n: index + 1 })}</span>
        <span>{trip.name}</span>
      </div>
    </>
  );
}

function CastFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="cast" role="img" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function Waiting({ ctx }: { ctx: TripCtx }) {
  const owner = ctx.member(ctx.trip.ownerId)?.name ?? 'the owner';
  return (
    <div className="in solo">
      <div>
        <h3>{ctx.pack.wrappedSquad.title}</h3>
        <p className="line">{tp(ctx.pack, 'wrappedSquad.waitingTitle', { owner })}</p>
        <p className="k">{tp(ctx.pack, 'wrappedSquad.waitingBody', { owner })}</p>
      </div>
    </div>
  );
}

/** The TV: full-bleed 16:9, type in container units so it reads from the back of the room. */
function BigScreen() {
  const ctx = useTripCtx();
  const { state, squad } = useCeremony(ctx.trip.id, true);
  useEffect(() => {
    if (!ctx.isOwner) return;
    const onKey = (event: KeyboardEvent) => {
      const action = actionForKey(event.key);
      if (!action) return;
      event.preventDefault();
      void act(ctx.trip.id, action, state.data);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx.isOwner, ctx.trip.id, state.data]);

  const running = state.data && state.data.status !== 'not_started' && squad.data?.payload;
  return (
    <div className="cast-root">
      <CastFrame label={ctx.pack.wrappedSquad.title}>
        {running ? <CastCard ctx={ctx} payload={squad.data!.payload!} state={state.data!} /> : <Waiting ctx={ctx} />}
      </CastFrame>
    </div>
  );
}

const CARD_NAMES = [
  '01_group_total',
  '02_drunk_o_meter',
  '03_keg',
  '04_cities_venues',
  '05_crowd_then_divisive',
  '06_replay',
  '07_side_boards',
  '08_predictions',
  '09_awards',
  '10_main_board',
  '11_credits',
];

/** The owner's phone becomes the clicker; everyone else watches along (DS §6.12). */
function PhoneCeremony() {
  const ctx = useTripCtx();
  const { trip, pack, isOwner } = ctx;
  const navigate = useNavigate();
  const { state, squad } = useCeremony(trip.id, false);
  const [busy, setBusy] = useState(false);
  if (state.isPending) return <Splash />;
  const s = state.data;
  const payload = squad.data?.payload;

  if (!isOwner || !s || s.status === 'not_started') {
    const canStart = isOwner && s?.status === 'not_started';
    return (
      <main className="scr">
        <TopBar />
        <h1 className="ph">{pack.wrappedSquad.title}</h1>
        <div style={{ marginTop: 18, borderRadius: 14, overflow: 'hidden' }}>
          <CastFrame label={pack.wrappedSquad.title}>
            {s && s.status !== 'not_started' && payload ? <CastCard ctx={ctx} payload={payload} state={s} /> : <Waiting ctx={ctx} />}
          </CastFrame>
        </div>
        {canStart ? (
          <button
            type="button"
            className="logbtn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void send('POST', `/trips/${trip.id}/ceremony/start`)
                .then(() => state.refetch())
                .catch((error: unknown) => toast(formError(error)))
                .finally(() => setBusy(false));
            }}
          >
            {pack.wrappedSquad.start}
          </button>
        ) : null}
        <button type="button" className="btn sec full" style={{ margin: '12px 0 24px' }} onClick={() => navigate(`/t/${trip.id}/wrapped`)}>
          {pack.wrappedSquad.back}
        </button>
      </main>
    );
  }

  const index = Math.min(10, s.cardIndex);
  const titleOf = (at: number) => {
    const cardId = CARD_NAMES[at]!;
    return (
      tpMaybe(pack, `wrappedSquad.cards.${cardId}.title`) ??
      tpMaybe(pack, `wrappedSquad.cards.${cardId}.lead`) ??
      tpMaybe(pack, `wrappedSquad.cards.${cardId}.favLead`) ??
      pack.wrappedSquad.title
    );
  };
  const title = titleOf(index);
  const ranking = (payload?.cards[9]?.data?.ranking as unknown[] | undefined) ?? [];
  const lastReveal = index === 9 && s.subStep === ranking.length - 2;
  // "Next: …" names what the next tap brings up (DS §6.10 presenter remote).
  const upNext =
    s.status === 'ended'
      ? null
      : index === 9 && ranking.length > 0
        ? `${Math.min(ranking.length, s.subStep + 1)} of ${ranking.length} revealed.${
            lastReveal ? ` Next: ${tpMaybe(pack, 'wrappedSquad.cards.10_main_board.mvp') ?? '#1'}.` : ''
          }`
        : index < 10
          ? `Next: ${titleOf(index + 1)}.`
          : null;
  const nextLabel =
    s.status === 'ended'
      ? 'Done'
      : lastReveal
        ? pack.wrappedSquad.reveal
        : 'Next';

  return (
    <main className="scr">
      <div className="p-top">
        <span style={{ fontWeight: 600 }}>{tp(pack, 'wrappedSquad.presenting', { device: 'the big screen' })}</span>
      </div>
      <p className="pmuted" style={{ marginTop: 14 }}>
        {tp(pack, 'wrappedSquad.footer', { n: index + 1 })}
      </p>
      <h1 className="ph">{title}</h1>
      {upNext ? <p className="pmuted">{upNext}</p> : null}
      <button
        type="button"
        className="logbtn remote-next"
        onClick={() => void (s.status === 'ended' ? navigate(`/t/${trip.id}/wrapped`) : act(trip.id, 'next', s))}
      >
        {nextLabel}
      </button>
      <div className="share" style={{ margin: '12px 0 24px' }}>
        <button type="button" className="btn sec" onClick={() => void act(trip.id, 'back', s)}>
          {pack.wrappedSquad.back}
        </button>
        {s.status === 'ended' ? null : (
          <button type="button" className="btn sec" aria-pressed={s.held} onClick={() => void act(trip.id, 'hold', s)}>
            {pack.wrappedSquad.hold}
          </button>
        )}
      </div>
    </main>
  );
}

export function CeremonyRoute() {
  const [params] = useSearchParams();
  return params.get('display') === 'big' ? <BigScreen /> : <PhoneCeremony />;
}
