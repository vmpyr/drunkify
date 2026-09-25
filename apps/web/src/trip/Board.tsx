import { dayIndex, tripLengthDays } from '@drunkify/shared';

import { CHART_COLOURS, categoryOf, fmtL, relativeAgo, tp, tpMaybe, withTime } from '../app/content.js';
import { serverNow, useDashboard, useLeaderboard } from '../app/queries.js';
import type { LeaderboardRow } from '../app/types.js';
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

  const byDay = dashboard.data?.byDay ?? [];
  const maxDay = Math.max(0.01, ...byDay.map((day) => day.litres));
  const totalLitres = (dashboard.data?.byCategory ?? []).reduce((sum, item) => sum + item.litres, 0);
  const mix = (dashboard.data?.byCategory ?? [])
    .filter((item) => item.litres > 0)
    .sort((left, right) => right.litres - left.litres)
    .map((item) => ({ ...item, pct: Math.round((item.litres / Math.max(totalLitres, 0.001)) * 100) }));

  return (
    <>
      <h1 className="ph">{pack.leaderboard.title}</h1>
      <p className="pmuted">{tp(pack, 'leaderboard.subtitle', { day: today, days })}</p>

      {columns.length > 2 ? (
        <div className="sb" role="table" aria-label={pack.leaderboard.title}>
          <div
            className="sbh"
            role="row"
            style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, minmax(34px, auto))` }}
          >
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
              style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, minmax(34px, auto))` }}
            >
              <span className="n" role="cell">
                <Avatar name={row.name} colorIndex={colourOf(row.userId)} />
                <b>{row.name}</b>
              </span>
              {columns.map((column, index) => (
                <span role="cell" key={column.key} className={index === columns.length - 1 ? 'rt' : ''}>
                  {row.values ? columnValue(column.key, row.values) : '?'}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <ol className={`lb ${masked ? 'masked' : ''}`} style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
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
                    <div className="bar" style={{ width: `${(row.values.litres / maxLitres) * 100}%` }} />
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
            const who = unlock.memberName ?? member(unlock.triggeredByUserId)?.name ?? member(unlock.userId)?.name ?? '';
            return (
              <div className="frow achv" key={`${unlock.key}-${unlock.unlockedAt}-${unlock.userId}`}>
                <span className="badge">
                  <Icon name="bolt" />
                </span>
                <div className="m">
                  <b>
                    {tp(pack, 'feed.achievementRow', {
                      name: who,
                      achievement: tpMaybe(pack, `achievements.${unlock.key}.name`, unlock.vars) ?? unlock.key,
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
          <div className="dlab" style={{ gridTemplateColumns: `repeat(${byDay.length}, minmax(0, 1fr))` }} aria-hidden="true">
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
          <div className="mix" role="img" aria-label={mix.map((item) => `${categoryOf(item.category).name} ${item.pct}%`).join(', ')}>
            {mix.map((item) => (
              <i key={item.category} style={{ flex: item.litres, background: CHART_COLOURS[item.category] }} />
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

      <div className="sech">
        <h3>{pack.locked.sectionTitle}</h3>
      </div>
      <div className="locks">
        {pack.locked.tiles.map((tile) => (
          <div className="lock" key={tile}>
            <b>{tile}</b>
            <span>
              <Icon name="lock" />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
