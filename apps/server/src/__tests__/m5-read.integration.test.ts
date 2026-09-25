import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { hashPasswordSync } from '../auth/password.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';
import { registerM5Routes } from '../routes/m5.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function dateOnly(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m5-read-'));
  tempDirs.push(directory);
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: join(directory, 'drunkify.db'),
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'CorrectHorseBattery7',
    PUBLIC_URL: 'https://drunkify.test',
    GEO_VENUE_PROVIDER: 'none',
    LOG_LEVEL: 'silent',
  });
  const db = createDb(config);
  await db.migrate();
  await seedAdminIfNeeded(db, config, { info() {} });
  const app = await createApp({ config, db });
  if (
    !app.hasRoute({
      method: 'GET',
      url: '/api/v1/trips/:tripId/leaderboard',
    })
  ) {
    registerM5Routes(app, { db });
  }
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { 'x-requested-with': 'drunkify' },
    payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
  });
  const adminCookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  const tripResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: { cookie: adminCookie, 'x-requested-with': 'drunkify' },
    payload: {
      name: 'M5 Reads',
      startDate: dateOnly(),
      endDate: dateOnly(2),
      timezone: 'UTC',
      themeId: 'classic',
      unlockAt: Date.now() + 12 * 60 * 60 * 1000,
    },
  });
  const trip = tripResponse.json<{ trip: { id: string } }>().trip;

  const memberId = uuidv7();
  const now = Date.now();
  db.raw
    .sqlite!.prepare(
      `insert into users
        (id, email, password_hash, role, display_name, must_change_password,
         display_theme_pref, created_at, updated_at)
       values (?, 'zoe@example.com', ?, 'member', 'Zoe', 0, 'system', ?, ?)`,
    )
    .run(memberId, hashPasswordSync('LongUniquePassphrase7'), now, now);
  const added = await app.inject({
    method: 'POST',
    url: `/api/v1/people/${memberId}/trips`,
    headers: { cookie: adminCookie, 'x-requested-with': 'drunkify' },
    payload: { tripId: trip.id },
  });
  expect(added.statusCode).toBe(200);
  const memberSignIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { 'x-requested-with': 'drunkify' },
    payload: { email: 'zoe@example.com', password: 'LongUniquePassphrase7' },
  });
  const memberCookie = firstHeader(memberSignIn.headers['set-cookie']).split(';')[0]!;

  return { app, db, adminCookie, memberCookie, tripId: trip.id };
}

function mutationHeaders(cookie: string) {
  return { cookie, 'x-requested-with': 'drunkify' };
}

async function createDrink(
  app: Awaited<ReturnType<typeof createApp>>,
  cookie: string,
  tripId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/trips/${tripId}/drinks`,
    headers: mutationHeaders(cookie),
    payload: {
      id: uuidv7(),
      category: 'beer',
      drinkName: 'Lager',
      sizeMl: 500,
      abv: 5,
      qty: 1,
      drunkAt: Date.now() - 60 * 60 * 1000,
      venue: null,
      note: null,
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ drink: { id: string } }>().drink;
}

describe('M5 read APIs', () => {
  it('masks and alphabetizes the final-24h leaderboard, then ranks live rows', async () => {
    const { app, db, adminCookie, memberCookie, tripId } = await fixture();
    await createDrink(app, adminCookie, tripId, { qty: 2 });
    await createDrink(app, memberCookie, tripId);

    const masked = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/leaderboard`,
      headers: { cookie: memberCookie },
    });
    expect(masked.statusCode).toBe(200);
    const maskedBody = masked.json<{
      masked: boolean;
      rows: Array<{
        userId: string;
        name: string;
        isYou: boolean;
        rank: number | null;
        values: Record<string, number> | null;
      }>;
      recentAchievements: unknown[];
    }>();
    expect(maskedBody.rows.every((row) => typeof row.userId === 'string')).toBe(true);
    expect(maskedBody).toMatchObject({
      masked: true,
      rows: [
        {
          name: 'Admin',
          isYou: false,
          rank: null,
          values: null,
        },
        {
          name: 'Zoe',
          isYou: true,
          rank: null,
          values: null,
        },
      ],
      recentAchievements: [{ key: 'first_blood' }, { key: 'first_blood' }],
    });

    db.raw
      .sqlite!.prepare('update trips set unlock_at = ? where id = ?')
      .run(Date.now() + 48 * 60 * 60 * 1000, tripId);
    const live = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/leaderboard`,
      headers: { cookie: memberCookie },
    });
    expect(live.json()).toMatchObject({
      masked: false,
      rows: [
        { name: 'Admin', rank: 1, values: { drinks: 2 } },
        { name: 'Zoe', rank: 2, values: { drinks: 1 } },
      ],
    });
    await app.close();
    await db.close();
  });

  it('returns paged feed items, aggregate dashboard data, and only the caller ratings', async () => {
    const { app, db, adminCookie, memberCookie, tripId } = await fixture();
    await createDrink(app, adminCookie, tripId, { drinkName: 'Admin Lager', qty: 2 });
    const memberDrink = await createDrink(app, memberCookie, tripId, {
      drinkName: 'Member Lager',
    });
    const rated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/trips/${tripId}/drinks/${memberDrink.id}/rating`,
      headers: mutationHeaders(memberCookie),
      payload: { rating: 5 },
    });
    expect(rated.statusCode).toBe(200);

    const firstFeedPage = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/feed?filter=everyone&limit=1`,
      headers: { cookie: memberCookie },
    });
    const firstPage = firstFeedPage.json<{
      items: Array<{ kind: string; drink: { stdDrinks: number }; tripDay: number }>;
      nextCursor: string | null;
    }>();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      kind: 'achievement',
      tripDay: 1,
    });
    expect(typeof firstPage.nextCursor).toBe('string');
    const secondFeedPage = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/feed?filter=everyone&limit=1&cursor=${firstPage.nextCursor}`,
      headers: { cookie: memberCookie },
    });
    const secondPage = secondFeedPage.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(secondPage.items).toHaveLength(1);
    expect(typeof secondPage.nextCursor).toBe('string');

    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/feed?filter=mine`,
      headers: { cookie: memberCookie },
    });
    expect(
      mine
        .json<{
          items: Array<{ kind: string; drink?: { drinkName: string } }>;
        }>()
        .items.filter((item) => item.kind === 'drink')
        .map((item) => item.drink!.drinkName),
    ).toEqual(['Member Lager']);

    const dashboard = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/dashboard`,
      headers: { cookie: memberCookie },
    });
    const dashboardBody = dashboard.json<{
      totals: {
        you: { std: number; drinks: number };
        squad: { std: number; drinks: number };
      };
      byDay: Array<{ day: number; dateLabel: string; std: number }>;
      byCategory: Array<{ category: string; std: number }>;
      recentAchievements: unknown[];
    }>();
    expect(dashboardBody.totals.you.drinks).toBe(1);
    expect(dashboardBody.totals.squad.drinks).toBe(3);
    expect(dashboardBody.byDay[0]).toMatchObject({ day: 1 });
    expect(typeof dashboardBody.byDay[0]!.std).toBe('number');
    expect(dashboardBody.byCategory).toEqual([
      { category: 'beer', std: dashboardBody.byCategory[0]!.std },
    ]);
    expect(typeof dashboardBody.byCategory[0]!.std).toBe('number');
    expect(dashboardBody.recentAchievements).toHaveLength(2);

    const ratings = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/stats/ratings`,
      headers: { cookie: memberCookie },
    });
    const ratingsBody = ratings.json<{
      items: Array<{
        drinkId: string;
        drinkName: string;
        category: string;
        rating: number;
        drunkAt: number;
      }>;
      nextCursor: string | null;
    }>();
    expect(typeof ratingsBody.items[0]!.drunkAt).toBe('number');
    expect(ratingsBody).toMatchObject({
      items: [
        {
          drinkId: memberDrink.id,
          drinkName: 'Member Lager',
          category: 'beer',
          rating: 5,
        },
      ],
      nextCursor: null,
    });
    await app.close();
    await db.close();
  });
});
