import { ApiError } from '../app/api.js';
import { face, qtyTxt, tp } from '../app/content.js';
import { queryClient, send } from '../app/queries.js';
import type { Drink, DrinkCategory, DrinkPayload, VenueInput } from '../app/types.js';
import { buzz } from '../components/haptics.js';
import { toast } from '../components/overlayStore.js';
import { createUuidV7, enqueuePendingDrink } from '../offline/index.js';
import { formError } from '../screens/auth.js';
import type { TripCtx } from './TripLayout.js';

export interface DrinkDraft {
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  venue: VenueInput;
  note: string | null;
  rating: number | null;
}

/* ---- sticky venue: suggested from GPS the first time, then reused until you move on (DS §6.2) */

export interface VenueMemory {
  input: VenueInput;
  label: string;
  state: 'accepted' | 'renamed' | 'skipped';
  at: number;
}

const VENUE_TTL = 3 * 60 * 60 * 1000;
const venueKey = (tripId: string) => `drunkify.venue.${tripId}`;

export function readVenue(tripId: string): VenueMemory | null {
  try {
    const raw = localStorage.getItem(venueKey(tripId));
    if (!raw) return null;
    const value = JSON.parse(raw) as VenueMemory;
    return Date.now() - value.at < VENUE_TTL ? value : null;
  } catch {
    return null;
  }
}

export function writeVenue(tripId: string, memory: Omit<VenueMemory, 'at'>) {
  try {
    localStorage.setItem(venueKey(tripId), JSON.stringify({ ...memory, at: Date.now() }));
  } catch {
    /* private mode */
  }
}

/** Venue for one-tap logs: the remembered one, if it's still fresh. */
export function stickyVenue(tripId: string): VenueInput {
  const memory = readVenue(tripId);
  return memory && memory.state !== 'skipped' ? memory.input : null;
}

function payloadOf(id: string, draft: DrinkDraft): DrinkPayload {
  return {
    id,
    category: draft.category,
    drinkName: draft.drinkName,
    sizeMl: Math.round(draft.sizeMl),
    abv: draft.abv,
    qty: draft.qty,
    drunkAt: draft.drunkAt,
    venue: draft.venue,
    note: draft.note?.trim() ? draft.note.trim() : null,
    ...(draft.rating ? { rating: draft.rating } : {}),
  };
}

export function draftOf(drink: Drink): DrinkDraft {
  return {
    category: drink.category,
    drinkName: drink.drinkName,
    sizeMl: drink.sizeMl,
    abv: drink.abv,
    qty: drink.qty,
    drunkAt: drink.drunkAt,
    venue: drink.venueId ? { id: drink.venueId } : null,
    note: drink.note,
    rating: drink.rating,
  };
}

function refresh(tripId: string) {
  void queryClient.invalidateQueries({ queryKey: ['trip', tripId] });
}

function isOffline(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && error.status === 401);
}

async function queue(ctx: TripCtx, type: 'create' | 'update' | 'delete' | 'rate', drinkId: string, payload?: unknown) {
  await enqueuePendingDrink({
    tripId: ctx.trip.id,
    type,
    drinkId,
    ...(payload === undefined ? {} : { payload }),
    userId: ctx.me.id,
  });
  toast(tp(ctx.pack, 'toasts.offlineSaved'));
}

export async function rateDrink(ctx: TripCtx, drink: Pick<Drink, 'id' | 'drinkName'>, rating: number) {
  buzz();
  try {
    await send('PATCH', `/trips/${ctx.trip.id}/drinks/${drink.id}/rating`, { rating });
    refresh(ctx.trip.id);
    toast(tp(ctx.pack, 'toasts.rated', { drink: drink.drinkName, face: face(rating) }));
  } catch (error) {
    if (isOffline(error)) await queue(ctx, 'rate', drink.id, { rating });
    else toast(formError(error));
  }
}

export async function logDrink(ctx: TripCtx, draft: DrinkDraft): Promise<void> {
  const id = createUuidV7();
  const payload = payloadOf(id, draft);
  const label = { qty: qtyTxt(draft.qty), drink: draft.drinkName };
  buzz();
  try {
    await send<{ drink: Drink }>('POST', `/trips/${ctx.trip.id}/drinks`, payload);
    refresh(ctx.trip.id);
    toast({
      title: tp(ctx.pack, 'toasts.logged', label),
      undoLabel: tp(ctx.pack, 'toasts.undo'),
      undo: () => void undoCreate(ctx, id),
      ...(draft.category === 'soft'
        ? {}
        : {
            rate: {
              prompt: tp(ctx.pack, 'toasts.rateAsk'),
              onRate: (rating: number) => void rateDrink(ctx, { id, drinkName: draft.drinkName }, rating),
            },
          }),
    });
  } catch (error) {
    if (isOffline(error)) await queue(ctx, 'create', id, payload);
    else toast(formError(error));
  }
}

async function undoCreate(ctx: TripCtx, id: string) {
  try {
    await send('DELETE', `/trips/${ctx.trip.id}/drinks/${id}`);
    refresh(ctx.trip.id);
    toast(tp(ctx.pack, 'toasts.undone'));
  } catch (error) {
    toast(formError(error));
  }
}

export async function saveDrink(ctx: TripCtx, previous: Drink, draft: DrinkDraft): Promise<void> {
  const payload = payloadOf(previous.id, draft);
  buzz();
  try {
    await send('PUT', `/trips/${ctx.trip.id}/drinks/${previous.id}`, payload);
    refresh(ctx.trip.id);
    toast({
      title: tp(ctx.pack, 'toasts.saved'),
      undoLabel: tp(ctx.pack, 'toasts.undo'),
      undo: () =>
        void send('PUT', `/trips/${ctx.trip.id}/drinks/${previous.id}`, payloadOf(previous.id, draftOf(previous)))
          .then(() => {
            refresh(ctx.trip.id);
            toast(tp(ctx.pack, 'toasts.undone'));
          })
          .catch((error: unknown) => toast(formError(error))),
    });
  } catch (error) {
    if (isOffline(error)) await queue(ctx, 'update', previous.id, payload);
    else toast(formError(error));
  }
}

export async function deleteDrink(ctx: TripCtx, drink: Drink): Promise<void> {
  buzz();
  try {
    await send('DELETE', `/trips/${ctx.trip.id}/drinks/${drink.id}`);
    refresh(ctx.trip.id);
    toast({
      title: tp(ctx.pack, 'toasts.deleted', { drink: drink.drinkName }),
      undoLabel: tp(ctx.pack, 'toasts.undo'),
      // Deletes are hard on the server, so undo re-creates the same id.
      undo: () =>
        void send('POST', `/trips/${ctx.trip.id}/drinks`, payloadOf(drink.id, draftOf(drink)))
          .then(() => {
            refresh(ctx.trip.id);
            toast(tp(ctx.pack, 'toasts.undone'));
          })
          .catch((error: unknown) => toast(formError(error))),
    });
  } catch (error) {
    if (isOffline(error)) await queue(ctx, 'delete', drink.id);
    else toast(formError(error));
  }
}
