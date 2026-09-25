import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  computePhase,
  dayIndex,
  dayLabel,
  rankMembers,
  stdDrinks,
  tripLengthDays,
} from '@drunkify/shared';
import {
  M2Service,
  type DatabaseContext,
  type DrinkRecord,
  type TripRecord,
} from '../services/m2Service.js';

const tripParameters = z.object({ tripId: z.string().uuid() });
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

async function requireTripMember(
  service: M2Service,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<TripRecord | null> {
  if (!requireSession(request, reply)) return null;
  const parsed = tripParameters.safeParse(request.params);
  if (!parsed.success) {
    sendError(reply, 404, 'not_found', 'Trip not found');
    return null;
  }
  const trip = await service.getTrip(parsed.data.tripId);
  if (!trip) {
    sendError(reply, 404, 'not_found', 'Trip not found');
    return null;
  }
  if (!(await service.isTripMember(trip.id, request.auth!.userId))) {
    sendError(reply, 403, 'forbidden', 'Trip membership required');
    return null;
  }
  return trip;
}

function cursorOffset(cursor: string | undefined): number | null {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown;
    };
    return Number.isInteger(decoded.offset) && Number(decoded.offset) >= 0
      ? Number(decoded.offset)
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

function page<T>(items: T[], offset: number, limit: number) {
  const visible = items.slice(offset, offset + limit);
  return {
    items: visible,
    nextCursor: items.length > offset + limit ? encodeCursor(offset + limit) : null,
  };
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
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

function dashboardDateLabel(startDate: string, day: number): string {
  const [year, month, date] = startDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year!, month! - 1, date! + day - 1, 12));
}

export function registerM5Routes(app: FastifyInstance, options: { db: DatabaseContext }): void {
  const service = new M2Service(options.db);

  app.get('/api/v1/trips/:tripId/leaderboard', async (request, reply) => {
    const trip = await requireTripMember(service, request, reply);
    if (!trip) return;
    const source = await service.getLeaderboardRows(trip.id);
    const masked = computePhase(trip, Date.now()) === 'final_24h';
    if (masked) {
      return {
        masked: true,
        rows: [...source]
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) || left.userId.localeCompare(right.userId),
          )
          .map((row) => ({
            userId: row.userId,
            name: row.name,
            isYou: row.userId === request.auth!.userId,
            rank: null,
            values: null,
          })),
        recentAchievements: [],
      };
    }
    const ranked = rankMembers(
      source.map((row) => ({
        ...row,
        value: row.std,
        qty: row.drinks,
      })),
    );
    return {
      masked: false,
      rows: ranked.map((row) => ({
        userId: row.userId,
        name: row.name,
        isYou: row.userId === request.auth!.userId,
        rank: row.rank,
        values: {
          std: row.std,
          drinks: row.drinks,
          k: row.k,
          a: row.a,
          d: row.d,
          rating: row.rating,
        },
      })),
      recentAchievements: [],
    };
  });

  app.get('/api/v1/trips/:tripId/feed', async (request, reply) => {
    const trip = await requireTripMember(service, request, reply);
    if (!trip) return;
    const query = pageQuery
      .extend({ filter: z.enum(['mine', 'everyone']).default('everyone') })
      .safeParse(request.query);
    if (!query.success) return sendError(reply, 400, 'bad_request', 'Invalid feed query');
    const offset = cursorOffset(query.data.cursor);
    if (offset === null) return sendError(reply, 400, 'bad_request', 'Invalid cursor');
    const rows = await service.getFeedDrinks(
      trip.id,
      query.data.filter === 'mine' ? request.auth!.userId : undefined,
      offset + query.data.limit + 1,
    );
    const now = Date.now();
    const items = rows.map(({ drink, memberName }) => ({
      kind: 'drink' as const,
      drink: toDrink(drink),
      memberName,
      tripDay: dayIndex(drink.drunkAt, trip.startDate, trip.timezone),
      dayLabel: dayLabel(drink.drunkAt, now, trip.startDate, trip.timezone),
    }));
    return page(items, offset, query.data.limit);
  });

  app.get('/api/v1/trips/:tripId/dashboard', async (request, reply) => {
    const trip = await requireTripMember(service, request, reply);
    if (!trip) return;
    const [leaderboardRows, feedRows] = await Promise.all([
      service.getLeaderboardRows(trip.id),
      service.getFeedDrinks(trip.id, undefined, 1_000_000),
    ]);
    const own = leaderboardRows.find((row) => row.userId === request.auth!.userId);
    const length = tripLengthDays(trip.startDate, trip.endDate);
    const days = Array.from({ length }, (_, index) => ({
      day: index + 1,
      dateLabel: dashboardDateLabel(trip.startDate, index + 1),
      std: 0,
    }));
    const categories = new Map<string, number>();
    for (const { drink } of feedRows) {
      const std = stdDrinks(drink.sizeMl, drink.abv, drink.qty);
      const bucket = Math.min(
        length,
        Math.max(1, dayIndex(drink.drunkAt, trip.startDate, trip.timezone)),
      );
      days[bucket - 1]!.std += std;
      categories.set(drink.category, (categories.get(drink.category) ?? 0) + std);
    }
    return {
      totals: {
        you: { std: own?.std ?? 0, drinks: own?.drinks ?? 0 },
        squad: {
          std: rounded(leaderboardRows.reduce((total, row) => total + row.std, 0)),
          drinks: leaderboardRows.reduce((total, row) => total + row.drinks, 0),
        },
      },
      byDay: days.map((item) => ({ ...item, std: rounded(item.std) })),
      byCategory: [...categories.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, std]) => ({ category, std: rounded(std) })),
      recentAchievements: [],
    };
  });

  app.get('/api/v1/trips/:tripId/stats/ratings', async (request, reply) => {
    const trip = await requireTripMember(service, request, reply);
    if (!trip) return;
    const query = pageQuery.safeParse(request.query);
    if (!query.success) return sendError(reply, 400, 'bad_request', 'Invalid ratings query');
    const offset = cursorOffset(query.data.cursor);
    if (offset === null) return sendError(reply, 400, 'bad_request', 'Invalid cursor');
    const ratings = await service.getRatings(
      trip.id,
      request.auth!.userId,
      offset + query.data.limit + 1,
    );
    return page(ratings, offset, query.data.limit);
  });
}
