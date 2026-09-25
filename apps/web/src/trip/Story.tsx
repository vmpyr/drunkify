import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { face, fmtL, tp, tpMaybe } from '../app/content.js';
import { send, useFeed, usePersonalWrapped } from '../app/queries.js';
import { Splash } from '../app/session.js';
import type { WrappedCardDto, WrappedValue } from '../app/types.js';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/icons.js';
import { useTripCtx } from './TripLayout.js';
import { watchedKey } from './Wrapped.js';

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Card 1's number counts up from zero (DS §6.10). */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      setValue(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const current = useCountUp(value);
  return <>{current.toFixed(decimals)}</>;
}

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/** The absurd phrase carries its own number ("0.26 bathtubs"); split it for the big type. */
function splitAbsurd(phrase: string, value: WrappedValue): { big: string; rest: string } {
  const match = /^([\d.,]+%?)\s+(.*)$/.exec(phrase);
  if (match) return { big: match[1]!, rest: match[2]! };
  return { big: String(value ?? ''), rest: phrase };
}

type Vars = Record<string, string | number>;

function clean(vars: Record<string, WrappedValue>): Vars {
  const out: Vars = {};
  for (const [key, value] of Object.entries(vars)) out[key] = value ?? '';
  return out;
}

export function PersonalWrapped() {
  const { trip, pack, member, me } = useTripCtx();
  const navigate = useNavigate();
  const wrapped = usePersonalWrapped(trip.id);
  const mine = useFeed(trip.id, 'mine');
  const [index, setIndex] = useState(0);
  const [guessLocked, setGuessLocked] = useState(false);
  const [guess, setGuess] = useState(0.3);
  const marked = useRef(false);

  const cards = useMemo(
    () => (wrapped.data?.payload?.cards ?? []).filter((card): card is WrappedCardDto => card !== null),
    [wrapped.data],
  );
  const card = cards[index];
  const last = index === cards.length - 1;
  const close = () => navigate(`/t/${trip.id}/wrapped`, { replace: true });

  useEffect(() => {
    if (!last || marked.current || cards.length === 0) return;
    marked.current = true;
    try {
      localStorage.setItem(watchedKey(trip.id, me.id), '1');
    } catch {
      /* private mode */
    }
    void send('POST', `/trips/${trip.id}/wrapped/personal/watched`).catch(() => undefined);
  }, [last, cards.length, trip.id, me.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === ' ') setIndex((i) => Math.min(cards.length - 1, i + 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (wrapped.isPending) return <Splash />;
  if (!wrapped.data?.unlocked || !card) return <Navigate to={`/t/${trip.id}/wrapped`} replace />;

  const id = card.id;
  const variant = card.key.startsWith(`${id}.`) ? card.key.slice(id.length + 1) : null;
  const vars = clean(card.vars);
  const c = (field: string, extra: Vars = {}) =>
    tpMaybe(pack, `wrappedPersonal.cards.${id}.${field}`, { ...vars, ...extra }) ?? '';
  const amber = id === '02_absurd_units' || id === '13_rank';
  const interactive = id === '03_guess_ethanol' && !guessLocked;

  const onTap = (event: MouseEvent<HTMLDivElement>) => {
    if (interactive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX - rect.left < rect.width / 3) setIndex((i) => Math.max(0, i - 1));
    else if (!last) setIndex((i) => i + 1);
  };

  let content: ReactNode;
  switch (id) {
    case '01_cold_open':
      content = (
        <>
          <p className="say">{c('lead')}</p>
          <p className="big accent" style={{ marginTop: 'auto' }}>
            <CountUp value={Number(vars.totalDrinks) || 0} />
          </p>
          <p className="say" style={{ marginTop: 10 }}>
            {c('unit')}
          </p>
          <p className="muted body17">{c('note')}</p>
        </>
      );
      break;
    case '02_absurd_units': {
      if (variant === 'empty') {
        content = <p className="say" style={{ marginTop: 'auto', marginBottom: 'auto' }}>{c('empty')}</p>;
        break;
      }
      const absurd = splitAbsurd(String(vars.absurdUnitPhrase ?? ''), card.vars.absurdValue ?? null);
      content = (
        <>
          <p className="say">{c('real')}</p>
          <p style={{ fontSize: 20, marginTop: 6 }}>{c('realSub')}</p>
          <p className="say" style={{ marginTop: 'auto' }}>
            {c('lead')}
          </p>
          <p className="big" style={{ fontSize: 110 }}>
            {absurd.big}
          </p>
          <p className="say">{absurd.rest}.</p>
        </>
      );
      break;
    }
    case '03_guess_ethanol': {
      const actual = Number(card.data?.actualEthanolL ?? 0);
      const max = Math.max(2, Math.ceil(actual * 2.5 * 2) / 2);
      const diff = Math.abs(guess - actual);
      const note =
        diff <= Math.max(0.05, actual * 0.1) ? c('noteClose') : guess < actual ? c('noteLow') : c('noteHigh');
      content = (
        <>
          <p className="say">{c('question')}</p>
          {guessLocked ? (
            <div className="guess" aria-live="polite">
              <div className="gtrack" />
              <div className="gpin" style={{ left: `${Math.min(92, Math.max(8, (guess / max) * 100))}%` }}>
                {c('guessLabel')}
                <i style={{ background: 'var(--muted)' }} />
                <span style={{ display: 'block', marginTop: 4 }}>{guess.toFixed(1)} L</span>
              </div>
              <div className="gpin act" style={{ left: `${Math.min(92, Math.max(8, (actual / max) * 100))}%` }}>
                <b>{actual.toFixed(1)} L</b>
                {c('actualLabel')}
                <i style={{ background: 'var(--accent)' }} />
              </div>
            </div>
          ) : (
            <div className="live" style={{ marginTop: 26 }}>
              <p className="big2 accent" style={{ textAlign: 'center' }}>
                {guess.toFixed(1)} L
              </p>
              <input
                className="guess-range"
                type="range"
                min={0}
                max={max}
                step={0.1}
                value={guess}
                aria-label={c('guessLabel')}
                onChange={(event) => setGuess(Number(event.target.value))}
              />
              <button type="button" className="btn full" style={{ marginTop: 12 }} onClick={() => setGuessLocked(true)}>
                {c('guessLabel')}: lock it in
              </button>
            </div>
          )}
          {guessLocked ? (
            <>
              <p className="say" style={{ marginTop: 'auto' }}>
                {c('result', { diff: `${diff.toFixed(1)} litres` })}
              </p>
              <p className="muted body17">{note}</p>
            </>
          ) : null}
        </>
      );
      break;
    }
    case '04_abv_share':
      content =
        variant === 'empty' ? (
          <p className="say" style={{ margin: 'auto 0' }}>{c('empty')}</p>
        ) : (
          <>
            <p className="say">{c('abv', { avgAbv: `${Number(vars.avgAbv).toFixed(1)}%` })}</p>
            <p className="big2 accent" style={{ marginTop: 'auto' }}>
              {vars.share}%
            </p>
            <p className="say" style={{ marginTop: 10 }}>
              {c('share')}
            </p>
            <p className="muted body17">{c('note')}</p>
          </>
        );
      break;
    case '05_peak_day': {
      const perDay = new Map<number, number>();
      for (const item of mine.data?.items ?? []) {
        if (item.kind === 'drink') perDay.set(item.tripDay, (perDay.get(item.tripDay) ?? 0) + item.drink.qty);
      }
      const days = wrapped.data.payload?.context.days ?? Math.max(1, ...perDay.keys());
      const values = Array.from({ length: days }, (_, i) => perDay.get(i + 1) ?? 0);
      const peak = Math.max(1, ...values);
      content = (
        <>
          <p className="say">{c('lead')}</p>
          <p className="say muted">{c('roast')}</p>
          <div className="pk" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }} aria-hidden="true">
            {values.map((value, i) => (
              <i
                key={i}
                className={i + 1 === Number(vars.peakDay) ? 'hot' : ''}
                style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
              />
            ))}
          </div>
          <div className="dlab" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }} aria-hidden="true">
            {values.map((_, i) => (
              <span key={i}>D{i + 1}</span>
            ))}
          </div>
          <p className="body17" style={{ marginTop: 'auto' }}>
            {c('note', { peakTime: hourLabel(Number(vars.peakTime)) }).replace(/\.\.$/, '.')}
          </p>
        </>
      );
      break;
    }
    case '06_trail': {
      const route = (card.data?.route as Array<{ lat: number; lng: number }> | undefined) ?? [];
      content =
        variant === 'empty' ? (
          <p className="say" style={{ margin: 'auto 0' }}>{c('empty')}</p>
        ) : (
          <>
            <p className="say">{c('title')}</p>
            <Trail route={route} />
            <p className="say" style={{ marginTop: 'auto' }}>
              {c('venue')}
            </p>
            <p className="muted body17">{c('note')}</p>
          </>
        );
      break;
    }
    case '07_top_then_guilty':
      content =
        variant === 'noGuilty' ? (
          <p className="say" style={{ margin: 'auto 0' }}>
            {c('noGuilty')}
          </p>
        ) : (
          <>
            <p className="muted body17">{c('topLead')}</p>
            <p className="big2 accent">{c('top')}</p>
            <p className="body17">{c('topNote', { topFace: face(Math.round(Number(vars.topRatingValue))) })}</p>
            <p className="muted body17" style={{ marginTop: 'auto' }}>
              {c('guiltyLead')}
            </p>
            <p className="big2">{c('guilty')}</p>
            <p className="body17">{c('guiltyNote', { guiltyFace: face(Math.round(Number(vars.guiltyRatingValue))) })}</p>
          </>
        );
      break;
    case '08_loyal_or_adventurous': {
      const loyal = vars.verdict === 'loyal';
      content = (
        <>
          <p className="say">{c('title')}</p>
          <div className="bars2">
            <div>
              <p className="body17" style={{ margin: '0 0 6px' }}>{c('loyal')}</p>
              <div className="bar">
                <i style={{ width: `${Math.min(100, Number(vars.topShare) || 0)}%`, opacity: loyal ? 1 : 0.45 }} />
              </div>
            </div>
            <div>
              <p className="body17" style={{ margin: '0 0 6px' }}>{c('adventurous')}</p>
              <div className="bar">
                <i style={{ width: `${Math.min(100, (Number(vars.unique) || 0) * 8)}%`, opacity: loyal ? 0.45 : 1 }} />
              </div>
            </div>
          </div>
          <p className="say accent" style={{ marginTop: 'auto' }}>
            {c(`verdict.${loyal ? 'loyal' : 'adventurous'}`)}
          </p>
        </>
      );
      break;
    }
    case '09_absurd_run':
      content = (
        <>
          <p className="say">{c('liverMiles')}</p>
          <p className="muted body17">{c('liverNote')}</p>
          <p className="say" style={{ marginTop: 'auto' }}>
            {c('economy', { spend: `€${Number(vars.spend).toFixed(2)}` })}
          </p>
          <p className="muted body17">{c('economyNote', { gdpShare: `${vars.gdpShare}%` })}</p>
        </>
      );
      break;
    case '10_pace_twin': {
      const twin = member(String(vars.twinUserId ?? ''));
      content = (
        <>
          {twin ? <Avatar name={twin.name} colorIndex={twin.colorIndex} className="lg" /> : null}
          <p className="say" style={{ marginTop: 16 }}>
            {c('lead', { twin: twin?.name ?? '' })}
          </p>
          <p className="say muted">{c('line')}</p>
          <p className="big2 accent" style={{ marginTop: 'auto' }}>
            {vars.matchPct}%
          </p>
          <p className="body17">{c('note')}</p>
        </>
      );
      break;
    }
    case '11_achievements': {
      const list = (card.data?.achievements as Array<{ key: string }> | undefined) ?? [];
      content = (
        <>
          <p className="say">{c('title')}</p>
          <div className="achgrid">
            {list.slice(0, 9).map((item, i) => (
              <div key={`${item.key}-${i}`}>
                <span className="badge">
                  <Icon name="bolt" />
                </span>
                {tpMaybe(pack, `achievements.${item.key}.name`, { n: 3, venue: '' }) ?? item.key}
              </div>
            ))}
          </div>
          <p className="muted body17" style={{ marginTop: 'auto' }}>
            {c('note')}
          </p>
        </>
      );
      break;
    }
    case '12_prediction_vs_reality': {
      // Predictions are whole litres, so anything within half a litre counts as a match.
      const gap = Number(vars.predicted) - Number(vars.actual);
      const verdict = Math.abs(gap) < 0.5 ? 'noteSpot' : gap > 0 ? 'noteOver' : 'noteUnder';
      content = (
        <>
          <p className="muted body17">{c('lead')}</p>
          <p className="big2">{c('predicted')}</p>
          <p className="muted body17" style={{ marginTop: 'auto' }}>
            {c('actualLead')}
          </p>
          <p className="big accent" style={{ fontSize: 96 }}>
            {c('actual', { actual: fmtL(Number(vars.actual) || 0) })}
          </p>
          <p className="body17">{c(verdict)}</p>
        </>
      );
      break;
    }
    case '13_rank': {
      // Rank bands are defined in std drinks a day; the card copy shows litres.
      const perDay = Number(vars.stdPerDay ?? vars.perDay) || 0;
      const band = [...pack.ranks.bands].reverse().find((entry) => perDay >= entry.min) ?? pack.ranks.bands[0]!;
      content = (
        <>
          <p className="say">{c('lead')}</p>
          <p className="say" style={{ opacity: 0.75 }}>
            {c('drumroll')}
          </p>
          <span className="rankbadge" style={{ borderColor: 'currentColor', color: 'inherit' }}>
            <Icon name="star" />
          </span>
          <p className="big2" style={{ marginTop: 'auto' }}>
            {c('rank', { rank: band.name })}
          </p>
          <p className="body17">{c('note')}</p>
        </>
      );
      break;
    }
    case '14_archetype': {
      const key = String(vars.archetype);
      const secondaryKey = String(vars.secondary);
      const archetypes = pack.archetypes as unknown as Record<string, { name: string; writeup: string }>;
      const main = archetypes[key];
      const secondary = archetypes[secondaryKey];
      const writeupVars = { ...vars, topDrink: String(vars.topDrink) };
      const writeup = main ? (tpMaybe(pack, `archetypes.${key}.writeup`, writeupVars) ?? main.writeup) : '';
      const twin = member(String(vars.twinUserId ?? ''));
      const twinCard = cards.find((item) => item.id === '10_pace_twin');
      const shareText = `${tp(pack, 'wrappedPersonal.cards.14_archetype.lead')} ${main?.name ?? key}. ${writeup}`;
      content = (
        <>
          <p className="muted body17">{c('lead')}</p>
          <p className="big2 accent">{main?.name ?? key}</p>
          {secondary ? (
            <p style={{ fontSize: 18 }}>{tp(pack, 'archetypes.secondaryPrefix', { name: secondary.name })}</p>
          ) : null}
          <p className="arch-wr">
            {variant === 'noPartner'
              ? c('noPartner', { archetype: main?.name ?? key })
              : writeup}
          </p>
          {twin && variant !== 'noPartner' ? (
            <div className="twin">
              <Avatar name={twin.name} colorIndex={twin.colorIndex} className="lg" />
              <div>
                <b>{tp(pack, 'archetypes.partner', { name: twin.name })}</b>
                <div className="muted" style={{ fontSize: 14 }}>
                  {tpMaybe(pack, 'archetypes.partnerNote', { day: twinCard?.vars.day ?? '' }) ?? ''}
                </div>
              </div>
            </div>
          ) : null}
          <div className="share live">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (navigator.share) void navigator.share({ text: shareText }).catch(() => undefined);
                else void navigator.clipboard?.writeText(shareText);
              }}
            >
              <Icon name="share" /> {c('share')}
            </button>
            <button type="button" className="btn sec" onClick={() => setIndex(0)}>
              {c('replay')}
            </button>
          </div>
          <p className="story-foot">{c('waiting')}</p>
        </>
      );
      break;
    }
    default:
      content = <p className="say">{card.key}</p>;
  }

  return (
    <div className={`story ${amber ? 'st-amber' : ''}`} role="region" aria-roledescription="story" aria-label={`Card ${index + 1} of ${cards.length}`}>
      <div className="segs" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {cards.map((item, i) => (
          <i key={item.id} className={i <= index ? 'd' : ''} />
        ))}
      </div>
      <button type="button" className="iconbtn bare story-close" aria-label="Close" onClick={close}>
        <Icon name="x" />
      </button>
      <div className="tapzone" onClick={onTap} aria-hidden="true" />
      <div className="content" key={card.id} aria-live="polite">
        {content}
      </div>
      <div className="vh">
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          Previous card
        </button>
        <button type="button" onClick={() => setIndex((i) => Math.min(cards.length - 1, i + 1))}>
          Next card
        </button>
      </div>
    </div>
  );
}

function Trail({ route }: { route: Array<{ lat: number; lng: number }> }) {
  if (route.length < 2) return null;
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.0005);
  const pts = route.map((p) => [10 + ((p.lng - minLng) / span) * 80, 90 - ((p.lat - minLat) / span) * 80] as const);
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', maxHeight: 240, marginTop: 20 }} aria-hidden="true">
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 2.5"
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3 : 1.8} fill={i === pts.length - 1 ? 'var(--accent)' : 'var(--ink)'} />
      ))}
    </svg>
  );
}
