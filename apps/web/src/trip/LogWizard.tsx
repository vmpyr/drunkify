import { abvToPos, litres, nudgeAbv, posToAbv, snapAbv } from '@drunkify/shared';
import { useEffect, useRef, useState } from 'react';

import {
  catalog,
  categoryOf,
  FACES,
  fmtAbv,
  fmtL,
  hhmm,
  qtyNum,
  qtyTxt,
  sizeName,
  tp,
} from '../app/content.js';
import { queryClient, send, useCustomNames, useFavourites, useRecents, v1 } from '../app/queries.js';
import type { Drink, DrinkCategory, Favourite, VenueInput, VenueSuggestion } from '../app/types.js';
import { DrinkIcon, Icon, type UiIconName } from '../components/icons.js';
import { BottomSheet } from '../components/Sheet.js';
import { deleteDrink, logDrink, readVenue, saveDrink, writeVenue, type DrinkDraft } from './drinks.js';
import { useTripCtx } from './TripLayout.js';

type Step = 'drink' | 'size' | 'confirm';
type VenueState = 'suggested' | 'accepted' | 'renamed' | 'skipped';
type Editor = 'venue' | 'time' | 'abv' | 'note' | null;

interface WizardState {
  step: Step;
  category: DrinkCategory;
  drinkName: string;
  abv: number;
  sizeMl: number;
  qty: number;
  drunkAt: number;
  timeEdited: boolean;
  venue: VenueInput;
  venueLabel: string;
  venueState: VenueState;
  suggestion: { input: VenueInput; label: string } | null;
  note: string;
  rating: number | null;
  last: Pick<Drink, 'drinkName' | 'abv' | 'sizeMl'> | null;
  isOther: boolean;
}

export type WizardTarget = { mode: 'new'; category: DrinkCategory } | { mode: 'edit'; drink: Drink };

function initialState(target: WizardTarget, tripId: string, last: WizardState['last']): WizardState {
  if (target.mode === 'edit') {
    const drink = target.drink;
    return {
      step: 'confirm',
      category: drink.category,
      drinkName: drink.drinkName,
      abv: drink.abv,
      sizeMl: drink.sizeMl,
      qty: drink.qty,
      drunkAt: drink.drunkAt,
      timeEdited: true,
      venue: drink.venueId ? { id: drink.venueId } : null,
      venueLabel: drink.venueName ?? '',
      venueState: drink.venueId ? 'accepted' : 'skipped',
      suggestion: null,
      note: drink.note ?? '',
      rating: drink.rating,
      last: null,
      isOther: false,
    };
  }
  const category = categoryOf(target.category);
  const first = category.drinks[0];
  const memory = readVenue(tripId);
  return {
    step: 'drink',
    category: target.category,
    drinkName: last?.drinkName ?? first?.[0] ?? category.name,
    abv: snapAbv(last?.abv ?? first?.[1] ?? 5),
    sizeMl: last?.sizeMl ?? category.defaultSize,
    qty: 1,
    drunkAt: Date.now(),
    timeEdited: false,
    venue: memory && memory.state !== 'skipped' ? memory.input : null,
    venueLabel: memory && memory.state !== 'skipped' ? memory.label : '',
    venueState: memory ? (memory.state === 'skipped' ? 'skipped' : memory.state) : 'skipped',
    suggestion: null,
    note: '',
    rating: null,
    last,
    isOther: false,
  };
}

function useVenueSuggestion(
  enabled: boolean,
  tripId: string,
  onSuggest: (input: VenueInput, label: string) => void,
) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current || !('geolocation' in navigator)) return;
    done.current = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        v1<VenueSuggestion>(`/trips/${tripId}/venues/suggest?lat=${lat}&lng=${lng}`)
          .then((suggestion) => {
            if (suggestion.kind === 'existing') {
              onSuggest({ id: suggestion.venue.id }, suggestion.venue.name);
            } else if (suggestion.kind === 'candidate') {
              onSuggest(
                {
                  candidate: {
                    name: suggestion.name,
                    lat: suggestion.lat,
                    lng: suggestion.lng,
                    osmId: suggestion.osmId,
                  },
                },
                suggestion.name,
              );
            }
          })
          .catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
    );
  }, [enabled, tripId, onSuggest]);
}

export function LogWizard({ target, onClose }: { target: WizardTarget | null; onClose: () => void }) {
  // Keep the last target through the closing slide; bump the key so every open starts fresh.
  const [shown, setShown] = useState<{ target: WizardTarget; n: number } | null>(null);
  useEffect(() => {
    if (target) setShown((prev) => ({ target, n: (prev?.n ?? 0) + 1 }));
  }, [target]);
  const title = shown?.target.mode === 'edit' ? 'Edit drink' : 'Log a drink';
  return (
    <BottomSheet open={target !== null} onClose={onClose} label={title}>
      {shown ? <WizardBody key={shown.n} target={shown.target} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function WizardBody({ target, onClose }: { target: WizardTarget; onClose: () => void }) {
  const ctx = useTripCtx();
  const { pack, trip } = ctx;
  const recents = useRecents(trip.id);
  const favourites = useFavourites();
  const initialCategory = target.mode === 'edit' ? target.drink.category : target.category;
  const lastForCategory = recents.data?.lastByCategory[initialCategory] ?? null;
  const [s, setS] = useState<WizardState>(() => initialState(target, trip.id, lastForCategory));
  const [ed, setEd] = useState<Editor>(null);
  const [anim, setAnim] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [customSize, setCustomSize] = useState(false);
  const [customMl, setCustomMl] = useState('');
  const [venueDraft, setVenueDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const customNames = useCustomNames(s.category, trip.id);
  const isEdit = target.mode === 'edit';
  const category = categoryOf(s.category);

  // The last drink in this category may arrive after the sheet opens.
  useEffect(() => {
    if (!isEdit && lastForCategory && !s.last) {
      setS((prev) =>
        prev.step === 'drink'
          ? {
              ...prev,
              last: lastForCategory,
              drinkName: lastForCategory.drinkName,
              abv: snapAbv(lastForCategory.abv),
              sizeMl: lastForCategory.sizeMl,
            }
          : prev,
      );
    }
  }, [isEdit, lastForCategory, s.last]);

  const onSuggest = (input: VenueInput, label: string) =>
    setS((prev) => {
      const suggestion = { input, label };
      // A fresh remembered venue wins; a suggestion only fills in when there's nothing yet.
      if (prev.venueState === 'skipped' && !readVenue(trip.id)) {
        return { ...prev, suggestion, venue: input, venueLabel: label, venueState: 'suggested' };
      }
      return { ...prev, suggestion };
    });
  useVenueSuggestion(!isEdit, trip.id, onSuggest);

  const go = (step: Step) => {
    setS((prev) => ({ ...prev, step }));
    setEd(null);
    setAnim(true);
    bodyRef.current?.closest('.sheet')?.scrollTo({ top: 0 });
  };

  const names: Array<[string, number]> = [
    ...(customNames.data ?? []).map((entry) => [entry.name, entry.abv ?? s.abv] as [string, number]),
    ...category.drinks.filter(
      ([name]) => !(customNames.data ?? []).some((entry) => entry.name === name),
    ),
  ];

  const favourite: Favourite | undefined = (favourites.data ?? []).find(
    (fav) => fav.category === s.category && fav.drinkName === s.drinkName && fav.sizeMl === s.sizeMl,
  );
  const toggleFavourite = async () => {
    try {
      if (favourite) await send('DELETE', `/me/favourites/${favourite.id}`);
      else
        await send('POST', '/me/favourites', {
          category: s.category,
          drinkName: s.drinkName,
          sizeMl: s.sizeMl,
          abv: s.abv,
        });
      void queryClient.invalidateQueries({ queryKey: ['favourites'] });
    } catch {
      /* the star simply doesn't flip */
    }
  };

  const submit = () => {
    const draft: DrinkDraft = {
      category: s.category,
      drinkName: s.drinkName,
      sizeMl: s.sizeMl,
      abv: s.abv,
      qty: s.qty,
      drunkAt: s.timeEdited ? s.drunkAt : Date.now(),
      venue: s.venueState === 'skipped' ? null : s.venue,
      note: s.note,
      rating: isEdit ? s.rating : null,
    };
    if (!isEdit) {
      if (s.venueState !== 'skipped' && s.venue) {
        writeVenue(trip.id, {
          input: s.venue,
          label: s.venueLabel,
          state: s.venueState === 'renamed' ? 'renamed' : 'accepted',
        });
      } else {
        writeVenue(trip.id, { input: null, label: '', state: 'skipped' });
      }
    }
    if (s.isOther) {
      void send('POST', '/me/custom-drink-names', { category: s.category, name: s.drinkName, abv: s.abv })
        .then(() => queryClient.invalidateQueries({ queryKey: ['customNames', s.category] }))
        .catch(() => undefined);
    }
    onClose();
    if (target.mode === 'edit') void saveDrink(ctx, target.drink, draft);
    else void logDrink(ctx, draft);
  };

  const stepIndex = ['drink', 'size', 'confirm'].indexOf(s.step);
  const showBack = stepIndex > 0 && !(isEdit && s.step === 'confirm');
  const est = fmtL(litres(s.sizeMl, s.qty));

  const pickName = (name: string, abv: number, other = false) => {
    setS((prev) => ({ ...prev, drinkName: name, abv: snapAbv(abv), isOther: other }));
    setOtherOpen(false);
    go(isEdit ? 'confirm' : 'size');
  };

  let body;
  if (s.step === 'drink') {
    body = (
      <>
        <h3 className="wz-q">{tp(pack, 'logWizard.stepWhat')}</h3>
        <div className="tiles">
          {s.last && !isEdit ? (
            <button
              type="button"
              className="tile wide"
              onClick={() => {
                setS((prev) => ({
                  ...prev,
                  drinkName: prev.last!.drinkName,
                  abv: snapAbv(prev.last!.abv),
                  sizeMl: prev.last!.sizeMl,
                }));
                go('confirm');
              }}
            >
              <Icon name="repeat" />
              <b>{tp(pack, 'logWizard.againTile', { drink: s.last.drinkName })}</b>
              <span>{sizeName(s.category, s.last.sizeMl)}</span>
            </button>
          ) : null}
          {names.map(([name, abv]) => (
            <button
              type="button"
              key={name}
              className={`tile ${name === s.drinkName && (s.last || isEdit) ? 'cur' : ''}`}
              onClick={() => pickName(name, abv)}
            >
              <b>{name}</b>
              <span>{fmtAbv(abv)}</span>
            </button>
          ))}
          <button type="button" className="tile ghost" onClick={() => setOtherOpen(true)} aria-expanded={otherOpen}>
            <b>{tp(pack, 'logWizard.otherTile')}</b>
            <span>{tp(pack, 'logWizard.otherTileSub')}</span>
          </button>
        </div>
        {otherOpen ? (
          <form
            className="inrow"
            onSubmit={(event) => {
              event.preventDefault();
              if (otherName.trim()) pickName(otherName.trim(), s.abv, true);
            }}
          >
            <input
              className="inp"
              autoFocus
              value={otherName}
              maxLength={120}
              placeholder={tp(pack, 'logWizard.otherPlaceholder')}
              aria-label="Drink name"
              onChange={(event) => setOtherName(event.target.value)}
            />
            <button type="submit" className="btn">
              Next
            </button>
          </form>
        ) : null}
      </>
    );
  } else if (s.step === 'size') {
    body = (
      <>
        <h3 className="wz-q">{tp(pack, 'logWizard.stepSize')}</h3>
        <div className="tiles">
          {category.sizes.map((size) => {
            const named = !/ml$/i.test(size.label);
            return (
              <button
                type="button"
                key={size.ml}
                className={`tile ${size.ml === s.sizeMl ? 'cur' : ''}`}
                onClick={() => {
                  setS((prev) => ({ ...prev, sizeMl: size.ml }));
                  setCustomSize(false);
                  go('confirm');
                }}
              >
                <b>{named ? size.label : `${size.ml} ml`}</b>
                {named ? <span>{size.ml} ml</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            className="tile ghost"
            aria-expanded={customSize}
            onClick={() => {
              setCustomSize(true);
              setCustomMl(String(s.sizeMl));
            }}
          >
            <b>{tp(pack, 'logWizard.customSize')}</b>
            <span>{tp(pack, 'logWizard.customSizeSub')}</span>
          </button>
        </div>
        {customSize ? (
          <form
            className="inrow"
            onSubmit={(event) => {
              event.preventDefault();
              const ml = Math.round(Number(customMl));
              if (ml > 0 && ml <= 10_000) {
                setS((prev) => ({ ...prev, sizeMl: ml }));
                go('confirm');
              }
            }}
          >
            <input
              className="inp"
              type="number"
              inputMode="numeric"
              min={1}
              max={10000}
              autoFocus
              value={customMl}
              aria-label="Size in ml"
              onChange={(event) => setCustomMl(event.target.value)}
            />
            <button type="submit" className="btn">
              Next
            </button>
          </form>
        ) : null}
      </>
    );
  } else {
    const size = sizeName(s.category, s.sizeMl);
    const venueChip: [string, string] =
      s.venueState === 'skipped'
        ? ['off', tp(pack, 'logWizard.noVenue')]
        : [s.venueState === 'suggested' ? 'sug' : '', s.venueLabel];
    const chips: Array<{ key: Exclude<Editor, null>; icon: UiIconName; label: string; cls: string }> = [
      { key: 'venue', icon: 'pin', label: venueChip[1], cls: venueChip[0] },
      {
        key: 'time',
        icon: 'clock',
        label: s.timeEdited ? hhmm(s.drunkAt) : tp(pack, 'logWizard.now'),
        cls: '',
      },
      { key: 'abv', icon: 'pct', label: fmtAbv(s.abv), cls: '' },
      { key: 'note', icon: 'note', label: s.note || tp(pack, 'logWizard.note'), cls: s.note ? '' : 'off' },
    ];
    const finishVenue = () => {
      const typed = venueDraft.trim();
      setS((prev) => {
        if (!typed) return { ...prev, venueState: 'skipped', venue: null, venueLabel: '' };
        if (typed === prev.venueLabel && prev.venueState !== 'skipped') {
          return { ...prev, venueState: prev.venueState === 'suggested' ? 'accepted' : prev.venueState };
        }
        return { ...prev, venue: { name: typed }, venueLabel: typed, venueState: 'renamed' };
      });
      setEd(null);
    };

    body = (
      <>
        <button type="button" className="sum" onClick={() => go('drink')} aria-label={`Change drink: ${s.drinkName}`}>
          <DrinkIcon category={s.category} />
          <span className="tx">
            <b>{s.drinkName}</b>
            <span>
              {size}
              {size.endsWith('ml') ? '' : `, ${s.sizeMl} ml`}
            </span>
          </span>
          <Icon name="down" className="fwd" />
        </button>
        <div className="qtyrow">
          <div className="step">
            <button
              type="button"
              aria-label="Less"
              disabled={s.qty <= 0.5}
              onClick={() => setS((prev) => ({ ...prev, qty: Math.max(0.5, prev.qty - 0.5) }))}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Quantity">
              {qtyNum(s.qty)}
            </output>
            <button
              type="button"
              aria-label="More"
              onClick={() => setS((prev) => ({ ...prev, qty: Math.min(100, prev.qty + 0.5) }))}
            >
              +
            </button>
          </div>
          <div className="stdest">
            <b>{est}</b>
            <span>{tp(pack, 'logWizard.stdUnit')}</span>
          </div>
        </div>
        <div className="ctx">
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              className={`chip ${chip.cls} ${ed === chip.key ? 'on' : ''}`}
              aria-expanded={ed === chip.key}
              onClick={() => {
                if (chip.key === 'venue') setVenueDraft(s.venueState === 'skipped' ? '' : s.venueLabel);
                setEd((current) => (current === chip.key ? null : chip.key));
              }}
            >
              <Icon name={chip.icon} />
              <em>{chip.label}</em>
            </button>
          ))}
        </div>
        {ed === 'venue' ? (
          <form
            className="inrow"
            onSubmit={(event) => {
              event.preventDefault();
              finishVenue();
            }}
          >
            <input
              className="inp"
              autoFocus
              value={venueDraft}
              maxLength={120}
              placeholder="Venue name"
              aria-label="Venue name"
              onChange={(event) => setVenueDraft(event.target.value)}
            />
            {s.venueState === 'skipped' && s.suggestion ? (
              <button
                type="button"
                className="btn sec"
                onClick={() => {
                  setS((prev) => ({
                    ...prev,
                    venue: prev.suggestion!.input,
                    venueLabel: prev.suggestion!.label,
                    venueState: 'accepted',
                  }));
                  setEd(null);
                }}
              >
                Nearest
              </button>
            ) : s.venueState !== 'skipped' ? (
              <button
                type="button"
                className="btn sec"
                onClick={() => {
                  setS((prev) => ({ ...prev, venueState: 'skipped', venue: null, venueLabel: '' }));
                  setEd(null);
                }}
              >
                Skip
              </button>
            ) : null}
            <button type="submit" className="btn">
              Done
            </button>
          </form>
        ) : ed === 'time' ? (
          <form
            className="inrow"
            onSubmit={(event) => {
              event.preventDefault();
              setEd(null);
            }}
          >
            <input
              className="inp"
              type="time"
              autoFocus
              value={hhmm(s.drunkAt)}
              aria-label="Time"
              onChange={(event) => {
                const [h, m] = event.target.value.split(':').map(Number);
                if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return;
                const base = new Date(isEdit ? s.drunkAt : Date.now());
                base.setHours(h, m, 0, 0);
                let at = base.getTime();
                // A time later than now means last night.
                if (!isEdit && at > Date.now() + 60_000) at -= 86_400_000;
                setS((prev) => ({ ...prev, drunkAt: at, timeEdited: true }));
              }}
            />
            <button type="submit" className="btn">
              Done
            </button>
          </form>
        ) : ed === 'abv' ? (
          <AbvSlider
            abv={s.abv}
            onChange={(abv) => setS((prev) => ({ ...prev, abv }))}
            onDone={() => setEd(null)}
          />
        ) : ed === 'note' ? (
          <form
            className="inrow"
            onSubmit={(event) => {
              event.preventDefault();
              setEd(null);
            }}
          >
            <input
              className="inp"
              autoFocus
              maxLength={80}
              value={s.note}
              placeholder="Short note"
              aria-label="Note"
              onChange={(event) => setS((prev) => ({ ...prev, note: event.target.value }))}
            />
            <button type="submit" className="btn">
              Done
            </button>
          </form>
        ) : null}
        {isEdit ? (
          <div className="fld">
            <div className="fld-l" id="rate-l">
              {tp(pack, 'logWizard.ratingLabel')}
            </div>
            <div className="faces" role="radiogroup" aria-labelledby="rate-l">
              {FACES.map((f, index) => (
                <button
                  type="button"
                  key={f}
                  role="radio"
                  aria-checked={s.rating === index + 1}
                  className={`face ${s.rating === index + 1 ? 'on' : ''}`}
                  aria-label={`Rate ${index + 1} of 5`}
                  onClick={() =>
                    setS((prev) => ({ ...prev, rating: prev.rating === index + 1 ? null : index + 1 }))
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="wz-foot">
          <button
            type="button"
            className={`iconbtn ${favourite ? 'faved' : ''}`}
            aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={Boolean(favourite)}
            onClick={() => void toggleFavourite()}
          >
            <Icon name="star" />
          </button>
          <button type="button" className="logbtn" onClick={submit}>
            {isEdit
              ? tp(pack, 'logWizard.save')
              : tp(pack, 'logWizard.log', { qty: qtyTxt(s.qty), drink: s.drinkName })}
          </button>
        </div>
        {target.mode === 'edit' ? (
          <button
            type="button"
            className="delbtn"
            onClick={() => {
              onClose();
              void deleteDrink(ctx, target.drink);
            }}
          >
            {tp(pack, 'logWizard.delete')}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="wz-top">
        {showBack ? (
          <button
            type="button"
            className="iconbtn back"
            aria-label="Back"
            onClick={() => go(s.step === 'confirm' ? 'size' : 'drink')}
          >
            <Icon name="down" />
          </button>
        ) : (
          <span className="sp" />
        )}
        <h3 className="ttl">
          <DrinkIcon category={s.category} />
          {isEdit ? tp(pack, 'logWizard.editTitle') : category.name}
        </h3>
        <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      {isEdit ? null : (
        <div className="dots" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={stepIndex + 1} aria-label={`Step ${stepIndex + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i <= stepIndex ? 'on' : ''} />
          ))}
        </div>
      )}
      <div
        ref={bodyRef}
        className={`wz-step ${anim ? 'anim' : ''}`}
        key={s.step}
        onAnimationEnd={() => setAnim(false)}
      >
        {body}
      </div>
    </>
  );
}

const MAX_POS = catalog.abvSlider.totalPositions;

/** 0–15% in 0.1% steps on the first half of the track, then 0.5% (DS §6.2 ABV). */
function AbvSlider({
  abv,
  onChange,
  onDone,
}: {
  abv: number;
  onChange: (abv: number) => void;
  onDone: () => void;
}) {
  return (
    <div className="abvbox">
      <div className="abvtop">
        <div className="step">
          <button type="button" aria-label="Lower ABV" onClick={() => onChange(nudgeAbv(abv, -1))}>
            −
          </button>
        </div>
        <output aria-live="polite">{fmtAbv(abv)}</output>
        <div className="step">
          <button type="button" aria-label="Raise ABV" onClick={() => onChange(nudgeAbv(abv, 1))}>
            +
          </button>
        </div>
      </div>
      <input
        className="abvr"
        type="range"
        min={0}
        max={MAX_POS}
        step={1}
        value={abvToPos(abv)}
        aria-label="ABV"
        aria-valuetext={fmtAbv(abv)}
        onChange={(event) => onChange(posToAbv(Number(event.target.value)))}
      />
      <div className="ticks" aria-hidden="true">
        {catalog.abvSlider.ticks.map((value) => (
          <span key={value} className={value === 15 ? 'fine' : ''} style={{ left: `${(abvToPos(value) / MAX_POS) * 100}%` }}>
            {value}
          </span>
        ))}
      </div>
      <div className="abvfoot">
        <span />
        <button type="button" className="mini" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
