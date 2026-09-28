import { dayIndex, tripLengthDays } from '@drunkify/shared';
import { useQuery } from '@tanstack/react-query';

import {
  CHART_COLOURS,
  categoryOf,
  fmtL,
  relativeAgo,
  tp,
  tpMaybe,
  withTime,
} from '../app/content.js';
import {
  serverNow,
  useDashboard,
  useLeaderboard,
  usePersonalWrapped,
  useWrappedStatus,
  v1,
} from '../app/queries.js';
import type { LeaderboardRow, WrappedCardDto, WrappedValue } from '../app/types.js';
import { Avatar } from '../components/Avatar.js';
import { Icon } from '../components/icons.js';
import { useTripCtx } from './TripLayout.js';

function columnValue(key: string, values: NonNullable<LeaderboardRow['values']>): string {
  switch (key) {
    case 'litres':
      return fmtL(values.litres);
    case 'drinks':
      return String(values.drinks);
    case 'k':
      return values.litres.toFixed(1);
    case 'a':
      return String(Math.round(values.a));
    case 'd':
      return String(Math.round(values.d));
    case 'rating':
      return values.rating.toFixed(2);
    default:
      return String((values as unknown as Record<string, number>)[key] ?? '');
  }
}

export function Board() {
  const { trip, pack, member } = useTripCtx();
  const board = useLeaderboard(trip.id);
  const dashboard = useDashboard(trip.id);
  const days = tripLengthDays(trip.startDate, trip.endDate);
  const today = Math.min(days, Math.max(1, dayIndex(serverNow(), trip.startDate, trip.timezone)));
  const columns = pack.leaderboard.columns;
  const masked = board.data?.masked ?? false;
  const rows = board.data?.rows ?? [];
  const maxLitres = Math.max(0.01, ...rows.map((row) => row.values?.litres ?? 0));
  const colourOf = (userId: string) => member(userId)?.colorIndex;
  // Fixed stat widths so every row (and the header) lines up; "auto" sized each row on its own.
  const sbColumns = `minmax(0,1fr) repeat(${Math.max(0, columns.length - 1)}, 38px) 52px`;

  const byDay = dashboard.data?.byDay ?? [];
  const maxDay = Math.max(0.01, ...byDay.map((day) => day.litres));
  const totalLitres = (dashboard.data?.byCategory ?? []).reduce(
    (sum, item) => sum + item.litres,
    0,
  );
  const mix = (dashboard.data?.byCategory ?? [])
    .filter((item) => item.litres > 0)
    .sort((left, right) => right.litres - left.litres)
    .map((item) => ({
      ...item,
      pct: Math.round((item.litres / Math.max(totalLitres, 0.001)) * 100),
    }));

  return (
    <>
      <h1 className="ph">{pack.leaderboard.title}</h1>
      <p className="pmuted">{tp(pack, 'leaderboard.subtitle', { day: today, days })}</p>

      {columns.length > 2 ? (
        <div className="sb" role="table" aria-label={pack.leaderboard.title}>
          <div className="sbh" role="row" style={{ gridTemplateColumns: sbColumns }}>
            <span role="columnheader">Player</span>
            {columns.map((column) => (
              <span role="columnheader" key={column.key} title={column.meaning}>
                {column.label}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div
              key={row.userId}
              role="row"
              className={`sbr ${row.isYou ? 'me' : ''}`}
              style={{ gridTemplateColumns: sbColumns }}
            >
              <span className="n" role="cell">
                <Avatar name={row.name} colorIndex={colourOf(row.userId)} />
                <b>{row.name}</b>
              </span>
              {columns.map((column, index) => (
                <span
                  role="cell"
                  key={column.key}
                  className={index === columns.length - 1 ? 'rt' : ''}
                >
                  {row.values ? columnValue(column.key, row.values) : '?'}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <ol
          className={`lb ${masked ? 'masked' : ''}`}
          style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}
        >
          {rows.map((row) => {
            const secondary = columns[1];
            return (
              <li key={row.userId} className={`lbr ${row.isYou ? 'me' : ''}`}>
                <span className="rk">{row.rank ?? '?'}</span>
                <Avatar name={row.name} colorIndex={colourOf(row.userId)} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">
                    {row.name}
                    {row.isYou ? <small> {pack.leaderboard.you}</small> : null}
                  </div>
                  {row.values ? (
                    <div
                      className="bar"
                      style={{ width: `${(row.values.litres / maxLitres) * 100}%` }}
                    />
                  ) : null}
                </div>
                <div className="val">
                  {row.values ? (
                    <>
                      {columnValue(columns[0]!.key, row.values)}
                      {secondary ? (
                        <small>
                          {columnValue(secondary.key, row.values)} {secondary.label.toLowerCase()}
                        </small>
                      ) : null}
                    </>
                  ) : (
                    <span className="mk" aria-label="Hidden" />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {(board.data?.recentAchievements.length ?? 0) > 0 ? (
        <>
          <div className="sech">
            <h3>{pack.leaderboard.achievementsHeading}</h3>
          </div>
          {board.data!.recentAchievements.map((unlock) => {
            const who =
              unlock.memberName ??
              member(unlock.triggeredByUserId)?.name ??
              member(unlock.userId)?.name ??
              '';
            return (
              <div
                className="frow achv"
                key={`${unlock.key}-${unlock.unlockedAt}-${unlock.userId}`}
              >
                <span className="badge">
                  <Icon name="bolt" />
                </span>
                <div className="m">
                  <b>
                    {tp(pack, 'feed.achievementRow', {
                      name: who,
                      achievement:
                        tpMaybe(pack, `achievements.${unlock.key}.name`, unlock.vars) ?? unlock.key,
                    })}
                  </b>
                  <span>
                    {withTime(
                      tpMaybe(pack, `achievements.${unlock.key}.description`, unlock.vars),
                      relativeAgo(unlock.unlockedAt, serverNow()),
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </>
      ) : null}

      {byDay.length > 0 ? (
        <>
          <div className="sech">
            <h3>Squad by day</h3>
            <span>litres</span>
          </div>
          <div
            className="days"
            style={{ gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={byDay.map((day) => `Day ${day.day}: ${fmtL(day.litres)} litres`).join(', ')}
          >
            {byDay.map((day) => (
              <i
                key={day.day}
                className={day.day > today || day.litres === 0 ? 'fut' : ''}
                style={{ height: `${day.litres > 0 ? (day.litres / maxDay) * 100 : 8}%` }}
              />
            ))}
          </div>
          <div
            className="dlab"
            style={{ gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {byDay.map((day) => (
              <span key={day.day}>D{day.day}</span>
            ))}
          </div>
        </>
      ) : null}

      {mix.length > 0 ? (
        <>
          <div className="sech">
            <h3>What we drink</h3>
            <span>share of litres</span>
          </div>
          <div
            className="mix"
            role="img"
            aria-label={mix
              .map((item) => `${categoryOf(item.category).name} ${item.pct}%`)
              .join(', ')}
          >
            {mix.map((item) => (
              <i
                key={item.category}
                style={{ flex: item.litres, background: CHART_COLOURS[item.category] }}
              />
            ))}
          </div>
          <div className="leg" aria-hidden="true">
            {mix.map((item) => (
              <span key={item.category}>
                <i style={{ background: CHART_COLOURS[item.category] }} />
                {categoryOf(item.category).name} {item.pct}%
              </span>
            ))}
          </div>
        </>
      ) : null}

      <SavedForWrapped />
    </>
  );
}

type Card = {
  id: string;
  key?: string;
  vars?: Record<string, WrappedValue>;
  data?: Record<string, unknown>;
};

/**
 * The eight "Saved for the Wrapped" tiles. Locked until the Wrapped opens; then the personal ones
 * fill in from your Wrapped, and the squad ones once the ceremony has revealed them.
 */
function SavedForWrapped() {
  const { trip, pack, me, member } = useTripCtx();
  const status = useWrappedStatus(trip.id);
  const unlocked = status.data?.personalUnlocked ?? serverNow() >= trip.unlockAt;
  const ceremony = status.data?.ceremonyStarted ?? trip.ceremonyStartedAt !== null;
  const personal = usePersonalWrapped(trip.id, unlocked);
  const squad = useQuery({
    queryKey: ['trip', trip.id, 'wrapped', 'squad'],
    queryFn: () =>
      v1<{ unlocked: boolean; payload: { cards: Card[] } | null }>(
        `/trips/${trip.id}/wrapped/squad`,
      ),
    enabled: ceremony,
    staleTime: Infinity,
  });
  const mine = (id: string) =>
    (personal.data?.payload?.cards ?? []).find((card): card is WrappedCardDto => card?.id === id);
  const group = (id: string) => squad.data?.payload?.cards.find((card) => card.id === id);
  const nameOf = (userId: unknown) =>
    userId === me.id ? 'You' : typeof userId === 'string' ? (member(userId)?.name ?? '') : '';
  const atCeremony = 'At the ceremony';

  const value = (index: number): string | null => {
    if (!unlocked) return null;
    switch (index) {
      case 0: {
        const card = mine('02_absurd_units');
        return card?.vars.absurdUnitPhrase
          ? String(card.vars.absurdUnitPhrase)
          : 'Nothing to measure';
      }
      case 1: {
        const archetype = mine('14_archetype');
        const rank = mine('13_rank');
        const archetypes = pack.archetypes as unknown as Record<
          string,
          { name: string } | undefined
        >;
        const perDay = Number(rank?.vars.stdPerDay ?? rank?.vars.perDay) || 0;
        const band = [...pack.ranks.bands].reverse().find((entry) => perDay >= entry.min);
        const main = archetypes[String(archetype?.vars.archetype ?? '')]?.name;
        return [main, band?.name].filter(Boolean).join(' · ') || null;
      }
      case 2: {
        const card = mine('09_absurd_run');
        if (!card) return null;
        return `${card.vars.km ?? 0} liver km · €${Number(card.vars.spend ?? 0).toFixed(0)} spent`;
      }
      case 3: {
        if (!ceremony) return atCeremony;
        const boards = (group('07_side_boards')?.data?.boards ?? {}) as Record<
          string,
          Array<{ userId: string }>
        >;
        const wins = Object.values(boards).filter((rows) => rows[0]?.userId === me.id).length;
        return wins > 0
          ? `You top ${wins} of ${Object.keys(boards).length}`
          : `${Object.keys(boards).length} boards settled`;
      }
      case 4: {
        if (!ceremony) return atCeremony;
        const drink = group('05_crowd_then_divisive')?.vars?.drink;
        return drink ? String(drink) : 'No ratings, no favourite';
      }
      case 5: {
        if (!ceremony) return atCeremony;
        const replay = group('06_replay')?.data?.replay as
          { memberIndex: string[]; dayEndMarkers: Array<{ nightMvpIndex: number }> } | undefined;
        const mvp = replay?.dayEndMarkers[replay.dayEndMarkers.length - 1];
        return mvp
          ? `Last night's MVP: ${nameOf(replay?.memberIndex[mvp.nightMvpIndex])}`
          : 'Nothing to replay';
      }
      case 6: {
        const card = mine('12_prediction_vs_reality');
        return card
          ? `Said ${fmtL(Number(card.vars.predicted) || 0)} L, drank ${fmtL(Number(card.vars.actual) || 0)} L`
          : 'No prediction made';
      }
      case 7: {
        if (!ceremony) return atCeremony;
        const awards =
          (
            group('09_awards') as
              | {
                  winners?: Array<{
                    award: string;
                    winners: Array<{ userId: string; venue?: string }>;
                  }>;
                }
              | undefined
          )?.winners ?? [];
        const won = awards
          .filter((award) => award.winners.some((winner) => winner.userId === me.id))
          .map(
            (award) =>
              tpMaybe(pack, `awards.${award.award}.name`, {
                venue: award.winners[0]?.venue ?? '',
              }) ?? award.award,
          );
        return won.length > 0 ? won.join(', ') : `${awards.length} handed out`;
      }
      default:
        return null;
    }
  };

  return (
    <>
      <div className="sech">
        <h3>{pack.locked.sectionTitle}</h3>
      </div>
      <div className="locks">
        {pack.locked.tiles.map((tile, index) => {
          const shown = value(index);
          const open = shown !== null && shown !== atCeremony;
          return (
            <div className={`lock ${open ? 'open' : ''}`} key={tile}>
              <b>{tile}</b>
              {open ? (
                <span className="lv">{shown}</span>
              ) : (
                <span>
                  <Icon name="lock" />
                  {shown ?? (unlocked ? '' : pack.locked.tileNote)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
