import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { stdDrinks } from '@drunkify/shared';

import type { Config } from '../config.js';
import { eventBus as defaultEventBus, type EventBus, tripChannel } from '../realtime/eventBus.js';
import {
  DRINK_CATEGORIES,
  M2Service,
  type DatabaseContext,
  type DrinkInput,
  type DrinkMutationResult,
  type DrinkRecord,
} from '../services/m2Service.js';

const categorySchema = z.enum(DRINK_CATEGORIES);
const abvSchema = z
  .number()
  .min(0)
  .max(80)
  .refine((value) => {
    const step = value <= 15 ? 0.1 : 0.5;
    return Math.abs(value / step - Math.round(value / step)) < 1e-8;
  }, 'Invalid ABV step');
const venueSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({
    candidate: z.object({
      name: z.string().trim().min(1).max(120),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      osmId: z.string().min(1).max(100),
    }),
  }),
  z.object({ name: z.string().trim().min(1).max(120) }),
  z.null(),
]);
const drinkBodySchema = z.object({
  category: categorySchema,
  drinkName: z.string().trim().min(1).max(120),
  sizeMl: z.number().int().positive().max(10_000),
  abv: abvSchema,
  qty: z
    .number()
    .positive()
    .max(100)
    .refine((value) => Number.isInteger(value * 2), 'Quantity must use 0.5 steps'),
  drunkAt: z.number().int().nonnegative(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().nonnegative().nullable().optional(),
  altitude: z.number().nullable().optional(),
  speed: z.number().nonnegative().nullable().optional(),
  venue: venueSchema.optional().default(null),
  note: z.string().max(80).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

function toInput(value: z.infer<typeof drinkBodySchema>): DrinkInput {
  return {
    category: value.category,
    drinkName: value.drinkName,
    sizeMl: value.sizeMl,
    abv: value.abv,
    qty: value.qty,
    drunkAt: value.drunkAt,
    lat: value.lat ?? null,
    lng: value.lng ?? null,
    accuracy: value.accuracy ?? null,
    altitude: value.altitude ?? null,
    speed: value.speed ?? null,
    venue: value.venue,
    note: value.note ?? null,
    ...(value.rating !== undefined ? { rating: value.rating } : {}),
  };
}

function toDrink(drink: DrinkRecord) {
  return {
    id: drink.id,
    userId: drink.userId,
    tripId: drink.tripId,
    category: drink.category,
    drinkName: drink.drinkName,
    sizeMl: drink.sizeMl,
    abv: drink.abv,
    qty: drink.qty,
    drunkAt: drink.drunkAt,
    lat: drink.lat,
    lng: drink.lng,
    accuracy: drink.accuracy,
    altitude: drink.altitude,
    speed: drink.speed,
    venueId: drink.venueId,
    venueName: drink.venueName,
    city: drink.city,
    countryCode: drink.countryCode,
    rating: drink.rating,
    note: drink.note,
    createdAt: drink.createdAt,
    updatedAt: drink.updatedAt,
    editCount: drink.editCount,
    stdDrinks: stdDrinks(drink.sizeMl, drink.abv, drink.qty),
  };
}

function renderResult(reply: FastifyReply, result: DrinkMutationResult) {
  if (result.statusCode === 204) return reply.code(204).send();
  const drink = result.body.drink as DrinkRecord | undefined;
  const body = drink ? { ...result.body, drink: toDrink(drink) } : result.body;
  return reply.code(result.statusCode).send(body);
}

async function overpassCandidate(
  config: Config,
  lat: number,
  lng: number,
): Promise<
  { kind: 'candidate'; name: string; lat: number; lng: number; osmId: string } | { kind: 'none' }
> {
  if (config.GEO_VENUE_PROVIDER !== 'overpass') return { kind: 'none' };
  const query = `[out:json][timeout:5];nwr(around:150,${lat},${lng})["name"]["amenity"~"bar|pub|cafe|restaurant|nightclub"];out center 1;`;
  try {
    const response = await fetch(config.OVERPASS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { kind: 'none' };
    const payload = (await response.json()) as {
      elements?: Array<{
        id: number;
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: { name?: string };
      }>;
    };
    const element = payload.elements?.[0];
    const name = element?.tags?.name;
    const candidateLat = element?.lat ?? element?.center?.lat;
    const candidateLng = element?.lon ?? element?.center?.lon;
    if (!element || !name || candidateLat === undefined || candidateLng === undefined) {
      return { kind: 'none' };
    }
    return {
      kind: 'candidate',
      name,
      lat: candidateLat,
      lng: candidateLng,
      osmId: `${element.type}/${element.id}`,
    };
  } catch {
    return { kind: 'none' };
  }
}

export function registerM4Routes(
  app: FastifyInstance,
  options: { config: Config; db: DatabaseContext; eventBus?: EventBus },
): void {
  const service = new M2Service(options.db);
  const eventBus = options.eventBus ?? defaultEventBus;

  app.post('/api/v1/trips/:tripId/drinks', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    const body = drinkBodySchema
      .omit({ rating: true })
      .extend({ id: z.string().uuid() })
      .safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.createDrink({
      id: body.data.id,
      tripId: parameters.data.tripId,
      userId: request.auth!.userId,
      drink: toInput({ ...body.data, rating: undefined }),
      now: Date.now(),
    });
    const drink = result.body.drink as DrinkRecord | undefined;
    if (result.applied && drink) {
      eventBus.publish(tripChannel(parameters.data.tripId), {
        type: 'drink.created',
        payload: toDrink(drink),
      });
    }
    return renderResult(reply, result);
  });

  app.put('/api/v1/trips/:tripId/drinks/:drinkId', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z
      .object({ tripId: z.string().uuid(), drinkId: z.string().uuid() })
      .safeParse(request.params);
    const body = drinkBodySchema.safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.updateDrink({
      id: parameters.data.drinkId,
      tripId: parameters.data.tripId,
      userId: request.auth!.userId,
      drink: toInput(body.data),
      now: Date.now(),
    });
    const drink = result.body.drink as DrinkRecord | undefined;
    if (result.applied && drink) {
      eventBus.publish(tripChannel(parameters.data.tripId), {
        type: 'drink.updated',
        payload: toDrink(drink),
      });
    }
    return renderResult(reply, result);
  });

  app.patch('/api/v1/trips/:tripId/drinks/:drinkId/rating', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z
      .object({ tripId: z.string().uuid(), drinkId: z.string().uuid() })
      .safeParse(request.params);
    const body = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.rateDrink({
      id: parameters.data.drinkId,
      tripId: parameters.data.tripId,
      userId: request.auth!.userId,
      rating: body.data.rating,
      now: Date.now(),
    });
    const drink = result.body.drink as DrinkRecord | undefined;
    if (result.applied && drink) {
      eventBus.publish(tripChannel(parameters.data.tripId), {
        type: 'drink.updated',
        payload: toDrink(drink),
      });
    }
    return renderResult(reply, result);
  });

  app.delete('/api/v1/trips/:tripId/drinks/:drinkId', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z
      .object({ tripId: z.string().uuid(), drinkId: z.string().uuid() })
      .safeParse(request.params);
    if (!parameters.success) {
      return sendError(reply, 404, 'not_found', 'Drink not found');
    }
    const result = await service.deleteDrink({
      id: parameters.data.drinkId,
      tripId: parameters.data.tripId,
      userId: request.auth!.userId,
      now: Date.now(),
    });
    if (result.applied) {
      eventBus.publish(tripChannel(parameters.data.tripId), {
        type: 'drink.deleted',
        payload: { id: parameters.data.drinkId },
      });
    }
    return renderResult(reply, result);
  });

  app.post('/api/v1/trips/:tripId/drinks/sync', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        ops: z
          .array(
            z.object({
              clientOpId: z.string().min(1).max(200),
              tripId: z.string().uuid(),
              type: z.enum(['create', 'update', 'delete', 'rate']),
              drinkId: z.string().uuid(),
              payload: z.unknown().optional(),
              clientNowMs: z.number().int(),
              userId: z.string().uuid(),
            }),
          )
          .max(100),
      })
      .safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const results = [];
    for (const op of body.data.ops) {
      if (op.tripId !== parameters.data.tripId || op.userId !== request.auth!.userId) {
        results.push({
          clientOpId: op.clientOpId,
          status: 'error',
          error: { code: 'forbidden', message: 'Operation owner mismatch' },
        });
        continue;
      }
      let payload: DrinkInput | { rating: number } | undefined;
      if (op.type === 'rate') {
        const parsed = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(op.payload);
        if (!parsed.success) {
          results.push({
            clientOpId: op.clientOpId,
            status: 'error',
            error: { code: 'validation_failed', message: 'Invalid operation payload' },
          });
          continue;
        }
        payload = parsed.data;
      } else if (op.type !== 'delete') {
        const parsed = drinkBodySchema.safeParse(op.payload);
        if (!parsed.success) {
          results.push({
            clientOpId: op.clientOpId,
            status: 'error',
            error: { code: 'validation_failed', message: 'Invalid operation payload' },
          });
          continue;
        }
        payload = toInput(parsed.data);
      }
      const mutation = await service.applyDrinkOp({
        clientOpId: op.clientOpId,
        tripId: op.tripId,
        userId: op.userId,
        type: op.type,
        drinkId: op.drinkId,
        ...(payload === undefined ? {} : { payload }),
        now: Date.now(),
      });
      const drink = mutation.body.drink as DrinkRecord | undefined;
      if (mutation.applied && mutation.statusCode >= 200 && mutation.statusCode < 300) {
        eventBus.publish(tripChannel(op.tripId), {
          type:
            op.type === 'create'
              ? 'drink.created'
              : op.type === 'delete'
                ? 'drink.deleted'
                : 'drink.updated',
          payload: op.type === 'delete' ? { id: op.drinkId } : toDrink(drink!),
        });
      }
      results.push(
        mutation.statusCode >= 200 && mutation.statusCode < 300
          ? {
              clientOpId: op.clientOpId,
              status: 'ok',
              ...(drink ? { drink: toDrink(drink) } : {}),
            }
          : {
              clientOpId: op.clientOpId,
              status: 'error',
              error: mutation.body.error,
            },
      );
    }
    return { results };
  });

  app.get('/api/v1/trips/:tripId/drinks/recents', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(12) })
      .safeParse(request.query);
    if (!parameters.success || !query.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    if (!(await service.isTripMember(parameters.data.tripId, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    const recents = await service.getRecents(
      parameters.data.tripId,
      request.auth!.userId,
      query.data.limit,
    );
    return {
      lastDrink: recents.lastDrink ? toDrink(recents.lastDrink) : null,
      lastByCategory: Object.fromEntries(
        Object.entries(recents.lastByCategory).map(([category, drink]) => [
          category,
          toDrink(drink),
        ]),
      ),
      items: recents.items.map(toDrink),
    };
  });

  app.get('/api/v1/me/favourites', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    return { favourites: await service.listFavourites(request.auth!.userId) };
  });

  app.post('/api/v1/me/favourites', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const body = z
      .object({
        category: categorySchema,
        drinkName: z.string().trim().min(1).max(120),
        sizeMl: z.number().int().positive(),
        abv: abvSchema,
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 422, 'validation_failed', 'Validation failed');
    return {
      favourite: await service.upsertFavourite({
        id: uuidv7(),
        userId: request.auth!.userId,
        ...body.data,
        now: Date.now(),
      }),
    };
  });

  app.delete('/api/v1/me/favourites/:id', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Favourite not found');
    const result = await service.deleteFavourite(parameters.data.id, request.auth!.userId);
    if (result === 'not_found') return sendError(reply, 404, 'not_found', 'Favourite not found');
    if (result === 'forbidden') return sendError(reply, 403, 'forbidden', 'Forbidden');
    return reply.code(204).send();
  });

  app.get('/api/v1/me/custom-drink-names', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const query = z.object({ category: categorySchema.optional() }).safeParse(request.query);
    if (!query.success) return sendError(reply, 422, 'validation_failed', 'Validation failed');
    return {
      names: await service.listCustomDrinkNames(request.auth!.userId, query.data.category),
    };
  });

  app.post('/api/v1/me/custom-drink-names', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const body = z
      .object({
        category: categorySchema,
        name: z.string().trim().min(1).max(120),
        abv: abvSchema.nullable().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return sendError(reply, 422, 'validation_failed', 'Validation failed');
    await service.upsertCustomDrinkName({
      id: uuidv7(),
      userId: request.auth!.userId,
      category: body.data.category,
      name: body.data.name,
      abv: body.data.abv ?? null,
      now: Date.now(),
    });
    return {};
  });

  app.get('/api/v1/trips/:tripId/venues/suggest', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    const query = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
      })
      .safeParse(request.query);
    if (!parameters.success || !query.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    if (!(await service.isTripMember(parameters.data.tripId, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    const existing = await service.suggestVenue(
      parameters.data.tripId,
      query.data.lat,
      query.data.lng,
    );
    return existing.kind === 'existing'
      ? existing
      : overpassCandidate(options.config, query.data.lat, query.data.lng);
  });

  app.patch('/api/v1/trips/:tripId/venues/:venueId', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z
      .object({ tripId: z.string().uuid(), venueId: z.string().uuid() })
      .safeParse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    if (!(await service.isTripMember(parameters.data.tripId, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    const venue = await service.renameVenue(
      parameters.data.tripId,
      parameters.data.venueId,
      body.data.name,
      Date.now(),
    );
    if (!venue) return sendError(reply, 404, 'not_found', 'Venue not found');
    return { venue };
  });
}
