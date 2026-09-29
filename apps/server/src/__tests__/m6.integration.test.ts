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
import { EventBus, tripChannel } from '../realtime/eventBus.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m6-'));
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
  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  const userId = me.json<{ user: { id: string } }>().user.id;
  const dayMs = 24 * 60 * 60 * 1000;
  const trip = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: { cookie, 'x-requested-with': 'drunkify' },
    payload: {
      name: 'M6 Trip',
      startDate: new Date(Date.now() + 3 * dayMs).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 5 * dayMs).toISOString().slice(0, 10),
      timezone: 'Etc/UTC',
      themeId: 'classic',
      unlockAt: Date.now() + 72 * 60 * 60 * 1000,
    },
  });
  return {
    app,
    bus,
    cookie,
    db,
    sqlitePath,
    userId,
    tripId: trip.json<{ trip: { id: string } }>().trip.id,
  };
}

function mutationHeaders(cookie: string) {
  return { cookie, 'x-requested-with': 'drunkify' };
}

function drinkPayload(id = uuidv7()) {
  return {
    id,
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

describe('M6 predictions and achievements', () => {
  it('locks predictions once and reports only submission counts', async () => {
    const { app, cookie, db, tripId, userId } = await fixture();
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/predictions/me`,
      headers: { cookie },
    });
    expect(before.json()).toMatchObject({
      state: 'open',
      answers: null,
      missedDismissed: false,
    });
    const payload = {
      myTotalStd: 10,
      groupTotalStd: 10,
      topMemberId: userId,
      leastMemberId: userId,
      topDay: 1,
      criticMemberId: userId,
    };
    const submitted = await app.inject({
      method: 'PUT',
      url: `/api/v1/trips/${tripId}/predictions/me`,
      headers: mutationHeaders(cookie),
      payload,
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ state: 'locked' });
    const replay = await app.inject({
      method: 'PUT',
      url: `/api/v1/trips/${tripId}/predictions/me`,
      headers: mutationHeaders(cookie),
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ error: { code: 'already_locked' } });
    const status = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/predictions/status`,
      headers: { cookie },
    });
    expect(status.json()).toEqual({ submitted: 1, total: 1 });
    await app.close();
    await db.close();
  });

  it('keeps the prediction window closed after the first drink is deleted', async () => {
    const { app, cookie, db, tripId } = await fixture();
    const drink = drinkPayload();
    await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: mutationHeaders(cookie),
      payload: drink,
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/trips/${tripId}/drinks/${drink.id}`,
      headers: mutationHeaders(cookie),
    });
    const prediction = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/predictions/me`,
      headers: { cookie },
    });
    expect(prediction.json()).toMatchObject({ state: 'missed', answers: null });
    await app.close();
    await db.close();
  });

  it('persists and emits an achievement exactly once and keeps it after drink deletion', async () => {
    const { app, bus, cookie, db, sqlitePath, tripId } = await fixture();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = bus.subscribe(tripChannel(tripId), ({ type, payload }) => {
      events.push({ type, payload });
    });
    const payload = drinkPayload();
    const request = {
      method: 'POST' as const,
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: mutationHeaders(cookie),
      payload,
    };
    expect((await app.inject(request)).statusCode).toBe(201);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(events.filter((event) => event.type === 'achievement.unlocked')).toHaveLength(1);
    expect(events.find((event) => event.type === 'achievement.unlocked')).toMatchObject({
      payload: { achievementKey: 'first_blood', drinkId: payload.id },
    });

    const feed = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/feed`,
      headers: { cookie },
    });
    expect(
      feed
        .json<{ items: Array<{ kind: string; unlock?: { key: string } }> }>()
        .items.some((item) => item.kind === 'achievement' && item.unlock?.key === 'first_blood'),
    ).toBe(true);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/trips/${tripId}/drinks/${payload.id}`,
      headers: mutationHeaders(cookie),
    });
    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(
      client
        .prepare(
          "select achievement_key, drink_id from achievement_unlocks where achievement_key = 'first_blood'",
        )
        .get(),
    ).toEqual({ achievement_key: 'first_blood', drink_id: null });
    client.close();
    unsubscribe();
    await app.close();
    await db.close();
  });
});
