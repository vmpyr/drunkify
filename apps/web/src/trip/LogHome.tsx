import type { DrinkCategory } from '@drunkify/content';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { COASTER_ORDER, categoryOf, fmtL, sizeName, tp } from '../app/content.js';
import { send, useDashboard, useFavourites, usePredictionMe, useRecents } from '../app/queries.js';
import { Coaster } from '../components/Coaster.js';
import { DrinkIcon, Icon } from '../components/icons.js';
import { logDrink, stickyVenue } from './drinks.js';
import { LogWizard, type WizardTarget } from './LogWizard.js';
import { useTripCtx } from './TripLayout.js';

interface RailItem {
  key: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  fav: boolean;
}

const keyOf = (item: { category: string; drinkName: string; sizeMl: number }) =>
  `${item.category}|${item.drinkName}|${item.sizeMl}`;

export function LogHome() {
  const ctx = useTripCtx();
  const { trip, pack } = ctx;
  const navigate = useNavigate();
  const dashboard = useDashboard(trip.id);
  const recents = useRecents(trip.id);
  const favourites = useFavourites();
  const prediction = usePredictionMe(trip.id);
  const [wizard, setWizard] = useState<WizardTarget | null>(null);

  const you = dashboard.data?.totals.you ?? { std: 0, litres: 0, drinks: 0 };
  const squad = dashboard.data?.totals.squad ?? { std: 0, litres: 0, drinks: 0 };
  const last = recents.data?.lastDrink ?? null;
  const empty = dashboard.isSuccess && you.drinks === 0 && !last;
  const ceremony = trip.phase === 'ceremony';

  // Favourites stay pinned at the front; the drink "Another" already covers is left out.
  const rail: RailItem[] = [];
  const seen = new Set<string>();
  for (const fav of favourites.data ?? []) {
    const key = keyOf(fav);
    if (seen.has(key)) continue;
    seen.add(key);
    rail.push({ key, ...fav, fav: true });
  }
  for (const item of recents.data?.items ?? []) {
    const key = keyOf(item);
    if (seen.has(key) || (last && key === keyOf(last))) continue;
    seen.add(key);
    rail.push({ key, category: item.category, drinkName: item.drinkName, sizeMl: item.sizeMl, abv: item.abv, fav: false });
  }

  const quickLog = (item: { category: DrinkCategory; drinkName: string; sizeMl: number; abv: number }) =>
    void logDrink(ctx, {
      category: item.category,
      drinkName: item.drinkName,
      sizeMl: item.sizeMl,
      abv: item.abv,
      qty: 1,
      drunkAt: Date.now(),
      venue: stickyVenue(trip.id),
      note: null,
      rating: null,
    });

  const predState = prediction.data?.state;
  const showMissed = predState === 'missed' && prediction.data?.missedDismissed === false;

  return (
    <>
      <div className="totals">
        <div className="tot">
          <div className="who">{tp(pack, 'home.totalsYou')}</div>
          <div className="num">{fmtL(you.litres)}</div>
          <div className="sub">
            {you.drinks === 0
              ? tp(pack, 'home.emptyYouSub')
              : tp(pack, 'home.totalsYouSub', { drinks: you.drinks })}
          </div>
        </div>
        <div className="tot sq">
          <div className="who">{tp(pack, 'home.totalsSquad')}</div>
          <div className="num">{fmtL(squad.litres)}</div>
          <div className="sub">
            {squad.drinks === 0
              ? tp(pack, 'home.emptySquadSub')
              : tp(pack, 'home.totalsSquadSub', { drinks: squad.drinks })}
          </div>
        </div>
      </div>

      {showMissed ? (
        <div className="blk">
          <button
            type="button"
            className="iconbtn bare x"
            aria-label="Dismiss"
            onClick={() =>
              void send('POST', `/trips/${trip.id}/predictions/me/dismiss-missed`).then(() => prediction.refetch())
            }
          >
            <Icon name="x" />
          </button>
          <h4>{tp(pack, 'predictions.missedTitle')}</h4>
        </div>
      ) : null}

      {empty ? (
        <>
          {predState === 'open' ? (
            <div className="blk">
              <h4>{tp(pack, 'predictions.emptyCardTitle')}</h4>
              <button
                type="button"
                className="btn full"
                style={{ marginTop: 12 }}
                onClick={() => navigate(`/t/${trip.id}/predictions`)}
              >
                {tp(pack, 'predictions.emptyCardCta')}
              </button>
            </div>
          ) : null}
        </>
      ) : last ? (
        <>
          <button type="button" className="again" disabled={ceremony} onClick={() => quickLog(last)}>
            <Icon name="repeat" />
            <span>{tp(pack, 'home.again', { drink: last.drinkName })}</span>
            <small>{sizeName(last.category, last.sizeMl)}</small>
          </button>
          {rail.length > 0 ? (
            <div className="rail" role="list" aria-label="Recent and favourite drinks">
              {rail.map((item) => (
                <button
                  type="button"
                  role="listitem"
                  key={item.key}
                  className="chip"
                  disabled={ceremony}
                  aria-label={`Log ${item.drinkName}, ${sizeName(item.category, item.sizeMl)}${item.fav ? ', favourite' : ''}`}
                  onClick={() => quickLog(item)}
                >
                  {item.fav ? <Icon name="star" className="star" /> : null}
                  <DrinkIcon category={item.category} />
                  {item.drinkName} <small>{sizeName(item.category, item.sizeMl)}</small>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="coasters">
        {COASTER_ORDER.map((category) => (
          <Coaster
            key={category}
            category={category}
            label={categoryOf(category).name}
            disabled={ceremony}
            onClick={() => setWizard({ mode: 'new', category })}
          />
        ))}
      </div>

      <LogWizard target={wizard} onClose={() => setWizard(null)} />
    </>
  );
}
