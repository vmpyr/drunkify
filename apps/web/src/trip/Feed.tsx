import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { drinkLitres, face, fmtL, hhmm, qtyTxt, sizeName, tp, tpMaybe, withTime } from '../app/content.js';
import { useFeed } from '../app/queries.js';
import type { Drink, DrinkPayload, FeedItem } from '../app/types.js';
import { DrinkIcon, Icon } from '../components/icons.js';
import { listPendingDrinks } from '../offline/index.js';
import { LogWizard, type WizardTarget } from './LogWizard.js';
import { useTripCtx } from './TripLayout.js';

const FILTER_KEY = 'drunkify.feedFilter';

export function dayHeading(pack: Parameters<typeof tp>[0], label: string): string {
  if (label === 'Tonight') return tp(pack, 'feed.tonight');
  const match = /^(\w+), day (\d+)$/.exec(label);
  return match ? tp(pack, 'feed.dayHeading', { weekday: match[1]!, n: match[2]! }) : label;
}

export function Feed() {
  const ctx = useTripCtx();
  const { trip, pack, me } = ctx;
  const [filter, setFilter] = useState<'mine' | 'everyone'>(() => {
    try {
      return sessionStorage.getItem(FILTER_KEY) === 'everyone' ? 'everyone' : 'mine';
    } catch {
      return 'mine';
    }
  });
  const feed = useFeed(trip.id, filter);
  const pending = useQuery({
    queryKey: ['outbox', me.id],
    queryFn: () => listPendingDrinks(me.id),
  });
  const [wizard, setWizard] = useState<WizardTarget | null>(null);

  const choose = (value: 'mine' | 'everyone') => {
    setFilter(value);
    try {
      sessionStorage.setItem(FILTER_KEY, value);
    } catch {
      /* private mode */
    }
  };

  const queued = (pending.data ?? [])
    .filter((op) => op.tripId === trip.id && op.type === 'create' && op.payload)
    .map((op) => op.payload as DrinkPayload);

  const groups: Array<{ label: string; items: FeedItem[] }> = [];
  for (const item of feed.data?.items ?? []) {
    const group = groups[groups.length - 1];
    if (group && group.label === item.dayLabel) group.items.push(item);
    else groups.push({ label: item.dayLabel, items: [item] });
  }

  return (
    <>
      <h1 className="ph">{tp(pack, 'feed.title')}</h1>
      <div className="seg2" role="radiogroup" aria-label="Whose drinks">
        <button type="button" role="radio" aria-checked={filter === 'mine'} onClick={() => choose('mine')}>
          {tp(pack, 'feed.mine')}
        </button>
        <button type="button" role="radio" aria-checked={filter === 'everyone'} onClick={() => choose('everyone')}>
          {tp(pack, 'feed.everyone')}
        </button>
      </div>

      {queued.length > 0 ? (
        <>
          <div className="dayh">{tp(pack, 'feed.tonight')}</div>
          {queued.map((drink) => (
            <div className="frow" key={drink.id}>
              <DrinkIcon category={drink.category} />
              <div className="m">
                <b>
                  {qtyTxt(drink.qty)}
                  {drink.drinkName}, {sizeName(drink.category, drink.sizeMl)}
                  <span className="pending" role="img" aria-label="Waiting to sync" />
                </b>
                <span>{tp(pack, 'toasts.offlineSaved')}</span>
              </div>
              <div className="r">
                <span className="rt" />
                {hhmm(drink.drunkAt)}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {groups.map((group, index) => (
        <section key={`${group.label}-${index}`} aria-label={dayHeading(pack, group.label)}>
          {queued.length > 0 && index === 0 && group.label === 'Tonight' ? null : (
            <div className="dayh">{dayHeading(pack, group.label)}</div>
          )}
          {group.items.map((item) =>
            item.kind === 'achievement' ? (
              <div className="frow achv" key={`a-${item.unlock.key}-${item.unlock.unlockedAt}-${item.unlock.userId}`}>
                <span className="badge">
                  <Icon name="bolt" />
                </span>
                <div className="m">
                  <b>
                    {tp(pack, 'feed.achievementRow', {
                      name: item.memberName,
                      achievement:
                        tpMaybe(pack, `achievements.${item.unlock.key}.name`, item.unlock.vars) ?? item.unlock.key,
                    })}
                  </b>
                  <span>
                    {withTime(
                      tpMaybe(pack, `achievements.${item.unlock.key}.description`, item.unlock.vars),
                      hhmm(item.unlock.unlockedAt),
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <DrinkRow
                key={item.drink.id}
                drink={item.drink}
                who={item.drink.userId === me.id ? null : item.memberName}
                onEdit={item.drink.userId === me.id ? () => setWizard({ mode: 'edit', drink: item.drink }) : undefined}
              />
            ),
          )}
        </section>
      ))}

      {feed.isSuccess && groups.length === 0 && queued.length === 0 ? (
        <p className="empty">{tp(pack, 'home.emptyYouSub')}</p>
      ) : null}

      <LogWizard target={wizard} onClose={() => setWizard(null)} />
    </>
  );
}

function DrinkRow({ drink, who, onEdit }: { drink: Drink; who: string | null; onEdit?: (() => void) | undefined }) {
  const inner = (
    <>
      <DrinkIcon category={drink.category} />
      <div className="m">
        <b>
          {who ? `${who}: ` : ''}
          {qtyTxt(drink.qty)}
          {drink.drinkName}, {sizeName(drink.category, drink.sizeMl)}
        </b>
        <span>
          {drink.venueName ? `${drink.venueName}, ` : ''}
          {hhmm(drink.drunkAt)}
        </span>
      </div>
      <div className="r">
        <span className="rt" aria-label={drink.rating ? `Rated ${drink.rating} of 5` : undefined}>
          {face(drink.rating)}
        </span>
        {fmtL(drinkLitres(drink))} L
      </div>
    </>
  );
  return onEdit ? (
    <button type="button" className="frow" onClick={onEdit}>
      {inner}
    </button>
  ) : (
    <div className="frow">{inner}</div>
  );
}
