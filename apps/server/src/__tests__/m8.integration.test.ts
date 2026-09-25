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
import { M2Store } from '../db/m2Store.js';
import { EventBus } from '../realtime/eventBus.js';
import { runPhaseTransitionPass } from '../scheduler/phaseScheduler.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function fixture(unlocked: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m8-'));
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
  const bus = new EventBus();
  const app = await createApp({ config, db, eventBus: bus });
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
      name: 'M8 Trip',
      startDate: '2026-09-23',
      endDate: '2026-09-25',
      timezone: 'Etc/UTC',
      themeId: 'classic',
      unlockAt: Date.now() + (unlocked ? -1_000 : 60_000),
    },
  });
  return {
    app,
    bus,
    cookie,
    db,
    sqlitePath,
    tripId: trip.json<{ trip: { id: string } }>().trip.id,
  };
}

function mutationHeaders(cookie: string) {
  return { cookie, 'x-requested-with': 'drunkify' };
}

function drinkPayload() {
  return {
    id: uuidv7(),
    category: 'beer',
    drinkName: 'Lager',
    sizeMl: 500,
    abv: 5,
    qty: 1,
    drunkAt: Date.now(),
    venue: null,
    note: null,
  };
}

describe('M8 Personal Wrapped', () => {
  it('returns a locked shape without leaking card data before unlock', async () => {
    const { app, cookie, db, tripId } = await fixture(false);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/personal`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      unlocked: false,
      payload: null,
      revision: null,
      sourceRevision: null,
    });
    expect(response.body).not.toContain('"cards"');
    await app.close();
    await db.close();
  });

  it('recomputes a stale snapshot synchronously once and serves a stable zero-drink payload', async () => {
    const { app, cookie, db, tripId } = await fixture(true);
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/personal`,
      headers: { cookie },
    });
    const firstBody = first.json<{
      revision: number;
      sourceRevision: number;
      payload: { cards: Array<{ vars?: { totalDrinks?: number } } | null> };
    }>();
    expect(firstBody.revision).toBe(1);
    expect(firstBody.payload.cards).toHaveLength(14);
    expect(firstBody.payload.cards[0]?.vars?.totalDrinks).toBe(0);
    expect(first.body).not.toMatch(/NaN|Infinity/);

    await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: mutationHeaders(cookie),
      payload: drinkPayload(),
    });
    const refreshed = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/personal`,
      headers: { cookie },
    });
    const refreshedBody = refreshed.json<typeof firstBody>();
    expect(refreshedBody.revision).toBe(2);
    expect(refreshedBody.sourceRevision).toBeGreaterThan(firstBody.sourceRevision);
    expect(refreshedBody.payload.cards[0]?.vars?.totalDrinks).toBe(1);

    const repeat = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/personal`,
      headers: { cookie },
    });
    expect(repeat.json<typeof firstBody>().revision).toBe(2);
    await app.close();
    await db.close();
  });

  it('tracks watched state idempotently while counting replays', async () => {
    const { app, cookie, db, sqlitePath, tripId } = await fixture(true);
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/trips/${tripId}/wrapped/personal/watched`,
            headers: mutationHeaders(cookie),
          })
        ).statusCode,
      ).toBe(204);
    }
    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/status`,
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({
      personalUnlocked: true,
      personalWatchedCount: 1,
      totalMembers: 1,
      ceremonyStarted: false,
    });
    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(
      client
        .prepare('select view_count, watched_at is not null as watched from wrapped_views')
        .get(),
    ).toEqual({ view_count: 2, watched: 1 });
    client.close();
    await app.close();
    await db.close();
  });

  it('backfills unlocked personal snapshots before marking the transition', async () => {
    const { app, bus, db, sqlitePath, tripId } = await fixture(true);
    const store = new M2Store(db);
    const claims = await runPhaseTransitionPass(store, bus, Date.now());
    expect(claims).toContainEqual({ tripId, phase: 'wrapped_unlocked' });

    const client = new BetterSqlite3(sqlitePath);
    expect(
      client
        .prepare('select count(*) as count from wrapped_snapshots where trip_id = ?')
        .get(tripId),
    ).toEqual({ count: 1 });
    client.prepare('delete from wrapped_snapshots where trip_id = ?').run(tripId);
    client.close();

    expect(await runPhaseTransitionPass(store, bus, Date.now())).not.toContainEqual({
      tripId,
      phase: 'wrapped_unlocked',
    });
    const readOnly = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(
      readOnly
        .prepare('select count(*) as count from wrapped_snapshots where trip_id = ?')
        .get(tripId),
    ).toEqual({ count: 1 });
    readOnly.close();
    await app.close();
    await db.close();
  });
});
