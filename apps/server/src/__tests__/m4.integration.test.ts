import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m4-'));
  tempDirs.push(directory);
  const sqlitePath = join(directory, 'drunkify.db');
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: sqlitePath,
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
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { 'x-requested-with': 'drunkify' },
    payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
  });
  const cookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  const trip = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: { cookie, 'x-requested-with': 'drunkify' },
    payload: {
      name: 'M4 Trip',
      startDate: '2026-09-25',
      endDate: '2026-10-02',
      timezone: 'Europe/Lisbon',
      themeId: 'classic',
      unlockAt: Date.UTC(2026, 9, 3),
    },
  });
  return {
    app,
    db,
    sqlitePath,
    cookie,
    tripId: trip.json<{ trip: { id: string } }>().trip.id,
  };
}

function headers(cookie: string) {
  return { cookie, 'x-requested-with': 'drunkify' };
}

function drinkPayload(overrides: Record<string, unknown> = {}) {
  return {
    category: 'beer',
    drinkName: 'Lager',
    sizeMl: 500,
    abv: 5,
    qty: 1,
    drunkAt: Date.UTC(2026, 8, 25, 20),
    venue: null,
    note: null,
    ...overrides,
  };
}

describe('M4 drinks and recents', () => {
  it('creates idempotently by drink id and returns the standard-drink value', async () => {
    const { app, db, sqlitePath, cookie, tripId } = await fixture();
    const id = uuidv7();
    const request = {
      method: 'POST' as const,
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: headers(cookie),
      payload: { id, ...drinkPayload() },
    };
    const created = await app.inject(request);
    const replay = await app.inject(request);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ drink: { id, stdDrinks: 2 } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(created.json());
    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(client.prepare('select count(*) as count from drinks').get()).toEqual({ count: 1 });
    client.close();
    await app.close();
    await db.close();
  });

  it('deduplicates recents, pins favourites, and caps at 12', async () => {
    const { app, db, cookie, tripId } = await fixture();
    for (let index = 0; index < 14; index += 1) {
      await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/drinks`,
        headers: headers(cookie),
        payload: {
          id: uuidv7(),
          ...drinkPayload({
            drinkName: `Drink ${index}`,
            sizeMl: 300 + index,
            drunkAt: Date.UTC(2026, 8, 25, 10 + index),
          }),
        },
      });
    }
    await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: headers(cookie),
      payload: {
        id: uuidv7(),
        ...drinkPayload({
          drinkName: 'Drink 13',
          sizeMl: 313,
          drunkAt: Date.UTC(2026, 8, 26, 4),
        }),
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/favourites',
      headers: headers(cookie),
      payload: { category: 'beer', drinkName: 'Drink 0', sizeMl: 300, abv: 5 },
    });
    const recents = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/drinks/recents`,
      headers: { cookie },
    });
    const body = recents.json<{
      lastDrink: { drinkName: string };
      lastByCategory: { beer: { drinkName: string } };
      items: Array<{ drinkName: string }>;
    }>();
    expect(body.lastDrink.drinkName).toBe('Drink 13');
    expect(body.lastByCategory.beer.drinkName).toBe('Drink 13');
    expect(body.items).toHaveLength(12);
    expect(body.items[0]?.drinkName).toBe('Drink 0');
    expect(body.items.filter((item) => item.drinkName === 'Drink 13')).toHaveLength(1);
    await app.close();
    await db.close();
  });
});

describe('M4 venues and operation ledger', () => {
  it('persists a candidate, reuses it within 150m, and keeps past name snapshots', async () => {
    const { app, db, cookie, tripId } = await fixture();
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: headers(cookie),
      payload: {
        id: uuidv7(),
        ...drinkPayload({
          lat: 38.7223,
          lng: -9.1393,
          venue: {
            candidate: {
              name: 'Old Tavern',
              lat: 38.7223,
              lng: -9.1393,
              osmId: 'node/123',
            },
          },
        }),
      },
    });
    const firstDrink = first.json<{ drink: { venueId: string; venueName: string } }>().drink;
    const suggestion = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/venues/suggest?lat=38.72231&lng=-9.13931`,
      headers: { cookie },
    });
    expect(suggestion.json()).toMatchObject({
      kind: 'existing',
      venue: { id: firstDrink.venueId, name: 'Old Tavern' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/trips/${tripId}/venues/${firstDrink.venueId}`,
      headers: headers(cookie),
      payload: { name: 'New Tavern' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: headers(cookie),
      payload: {
        id: uuidv7(),
        ...drinkPayload({
          drinkName: 'Ale',
          venue: { id: firstDrink.venueId },
        }),
      },
    });
    expect(firstDrink.venueName).toBe('Old Tavern');
    expect(second.json()).toMatchObject({ drink: { venueName: 'New Tavern' } });
    await app.close();
    await db.close();
  });

  it('replays create, update, rate, and delete operations without duplicate effects', async () => {
    const { app, db, sqlitePath, cookie, tripId } = await fixture();
    const drinkId = uuidv7();
    const ops = [
      {
        clientOpId: 'create-1',
        tripId,
        type: 'create',
        drinkId,
        payload: drinkPayload(),
        clientNowMs: Date.now(),
      },
      {
        clientOpId: 'update-1',
        tripId,
        type: 'update',
        drinkId,
        payload: drinkPayload({ drinkName: 'Updated Lager' }),
        clientNowMs: Date.now(),
      },
      {
        clientOpId: 'rate-1',
        tripId,
        type: 'rate',
        drinkId,
        payload: { rating: 5 },
        clientNowMs: Date.now(),
      },
      {
        clientOpId: 'delete-1',
        tripId,
        type: 'delete',
        drinkId,
        clientNowMs: Date.now(),
      },
    ];
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    const userId = me.json<{ user: { id: string } }>().user.id;
    for (const op of ops) {
      const payload = { ops: [{ ...op, userId }] };
      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/drinks/sync`,
        headers: headers(cookie),
        payload,
      });
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/drinks/sync`,
        headers: headers(cookie),
        payload,
      });
      expect(replay.json()).toEqual(first.json());
    }
    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(client.prepare('select count(*) as count from drinks').get()).toEqual({ count: 0 });
    expect(client.prepare('select count(*) as count from applied_ops').get()).toEqual({ count: 4 });
    client.close();
    await app.close();
    await db.close();
  });
});
