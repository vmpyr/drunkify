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

function mutationHeaders(cookie?: string) {
  return {
    'x-requested-with': 'drunkify',
    ...(cookie ? { cookie } : {}),
  };
}

async function fixture(unlockAt = Date.now() - 1_000) {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m9-'));
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
    headers: mutationHeaders(),
    payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
  });
  const ownerCookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  const trip = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: mutationHeaders(ownerCookie),
    payload: {
      name: 'M9 Ceremony',
      startDate: '2026-09-20',
      endDate: '2026-09-25',
      timezone: 'Etc/UTC',
      themeId: 'classic',
      unlockAt,
    },
  });
  const tripId = trip.json<{ trip: { id: string } }>().trip.id;

  const acceptInvite = async (email: string, trip: string | null) => {
    const issued = await app.inject({
      method: 'POST',
      url: '/api/v1/invites',
      headers: mutationHeaders(ownerCookie),
      payload: { name: email.split('@')[0], email, ...(trip ? { tripId: trip } : {}) },
    });
    const token = issued.json<{ url: string }>().url.split('/').at(-1)!;
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: mutationHeaders(),
      payload: {
        token,
        name: email.split('@')[0],
        email,
        password: 'LongUniquePassphrase7',
      },
    });
    return {
      response: accepted,
      cookie: firstHeader(accepted.headers['set-cookie']).split(';')[0]!,
      userId: accepted.json<{ user: { id: string } }>().user.id,
    };
  };

  const member = await acceptInvite('member@example.com', tripId);
  const outsider = await acceptInvite('outsider@example.com', null);
  return {
    app,
    bus,
    db,
    sqlitePath,
    ownerCookie,
    tripId,
    member,
    outsider,
    acceptInvite,
  };
}

describe('M9 ceremony and Squad Wrapped', () => {
  it('starts atomically, shares state, freezes mutations, ends, and restarts', async () => {
    const { app, bus, db, sqlitePath, ownerCookie, tripId, member, outsider, acceptInvite } =
      await fixture();
    const events: string[] = [];
    const unsubscribe = bus.subscribe(tripChannel(tripId), ({ type }) => events.push(type));

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/start`,
      headers: mutationHeaders(ownerCookie),
    });
    expect(started.statusCode, started.body).toBe(200);
    const startedBody = started.json<{
      state: {
        status: string;
        cardIndex: number;
        subStep: number;
        held: boolean;
        updatedAt: number;
      };
    }>();
    expect(startedBody.state).toMatchObject({
      status: 'running',
      cardIndex: 0,
      subStep: 0,
      held: false,
    });
    expect(typeof startedBody.state.updatedAt).toBe('number');
    expect(events).toEqual(expect.arrayContaining(['phase.changed', 'ceremony.started']));

    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(
      client
        .prepare(
          `select
             (select count(*) from wrapped_snapshots where trip_id = ? and user_id is null) squad,
             (select count(*) from ceremony_state where trip_id = ?) ceremony,
             (select ceremony_started_at is not null from trips where id = ?) started`,
        )
        .get(tripId, tripId, tripId),
    ).toEqual({ squad: 1, ceremony: 1, started: 1 });
    client.close();

    const squad = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/wrapped/squad`,
      headers: { cookie: member.cookie },
    });
    const squadBody = squad.json<{ unlocked: boolean; payload: { cards: unknown[] } }>();
    expect(squadBody.unlocked).toBe(true);
    expect(Array.isArray(squadBody.payload.cards)).toBe(true);
    expect(squadBody.payload.cards).toHaveLength(11);

    const advanced = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/advance`,
      headers: mutationHeaders(ownerCookie),
      payload: { direction: 'next' },
    });
    expect(advanced.json()).toMatchObject({ state: { cardIndex: 0, subStep: 1 } });
    const lateViewer = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${tripId}/ceremony/state`,
      headers: { cookie: member.cookie },
    });
    expect(lateViewer.json()).toMatchObject({ state: { cardIndex: 0, subStep: 1 } });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/trips/${tripId}/ceremony/state`,
          headers: { cookie: outsider.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/trips/${tripId}/wrapped/squad`,
          headers: { cookie: outsider.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/trips/${tripId}/ceremony/restart`,
          headers: mutationHeaders(member.cookie),
        })
      ).statusCode,
    ).toBe(403);

    const drink = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/drinks`,
      headers: mutationHeaders(ownerCookie),
      payload: {
        id: uuidv7(),
        category: 'beer',
        drinkName: 'Too late',
        sizeMl: 500,
        abv: 5,
        qty: 1,
        drunkAt: Date.now(),
        venue: null,
        note: null,
      },
    });
    expect(drink.statusCode).toBe(409);
    expect(drink.json()).toMatchObject({ error: { code: 'ceremony_started' } });

    const addExisting = await app.inject({
      method: 'POST',
      url: `/api/v1/people/${outsider.userId}/trips`,
      headers: mutationHeaders(ownerCookie),
      payload: { tripId },
    });
    expect(addExisting.statusCode).toBe(409);
    expect(addExisting.json()).toMatchObject({ error: { code: 'ceremony_started' } });

    const afterStart = await acceptInvite('late@example.com', tripId);
    expect(afterStart.response.statusCode).toBe(200);
    expect(afterStart.response.json()).toMatchObject({ trip: null });

    const prediction = await app.inject({
      method: 'PUT',
      url: `/api/v1/trips/${tripId}/predictions/me`,
      headers: mutationHeaders(member.cookie),
      payload: {
        myTotalStd: 1,
        groupTotalStd: 2,
        topMemberId: member.userId,
        leastMemberId: member.userId,
        topDrink: 'Lager',
        topDrinkCategory: 'beer',
      },
    });
    expect(prediction.statusCode).toBe(409);
    expect(prediction.json()).toMatchObject({ error: { code: 'window_closed' } });

    let state = advanced.json<{
      state: { status: string; cardIndex: number; held: boolean };
    }>().state;
    for (let index = 0; index < 100 && state.cardIndex !== 5; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/ceremony/advance`,
        headers: mutationHeaders(ownerCookie),
        payload: { direction: 'next' },
      });
      state = response.json<{ state: typeof state }>().state;
    }
    expect(state.cardIndex).toBe(5);
    const replayState = (
      await app.inject({
        method: 'GET',
        url: `/api/v1/trips/${tripId}/ceremony/state`,
        headers: { cookie: member.cookie },
      })
    ).json<{
      state: {
        replayElapsedMs: number;
        replayStartedAt: number | null;
      };
    }>().state;
    expect(replayState.replayElapsedMs).toBe(0);
    expect(typeof replayState.replayStartedAt).toBe('number');
    const held = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/hold`,
      headers: mutationHeaders(ownerCookie),
      payload: { held: true },
    });
    expect(held.json()).toMatchObject({
      state: { cardIndex: 5, held: true, replayStartedAt: null },
    });
    const resumed = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/hold`,
      headers: mutationHeaders(ownerCookie),
      payload: { held: false },
    });
    expect(resumed.json()).toMatchObject({
      state: { cardIndex: 5, held: false },
    });
    expect(resumed.json<{ state: { replayStartedAt: number } }>().state.replayStartedAt).toEqual(
      expect.any(Number),
    );
    const backed = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/advance`,
      headers: mutationHeaders(ownerCookie),
      payload: { direction: 'back' },
    });
    expect(backed.json()).toMatchObject({ state: { cardIndex: 4, held: false } });

    for (let index = 0; index < 100 && state.status !== 'ended'; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/ceremony/advance`,
        headers: mutationHeaders(ownerCookie),
        payload: { direction: 'next' },
      });
      state = response.json<{ state: typeof state }>().state;
    }
    expect(state.status).toBe('ended');
    const restarted = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/restart`,
      headers: mutationHeaders(ownerCookie),
    });
    expect(restarted.json()).toMatchObject({
      state: { status: 'running', cardIndex: 0, subStep: 0, held: false },
    });

    unsubscribe();
    await app.close();
    await db.close();
  });

  it('applies owner settings revision rules and freezes settings after start', async () => {
    const { app, db, sqlitePath, ownerCookie, tripId } = await fixture();
    const revision = () => {
      const client = new BetterSqlite3(sqlitePath, { readonly: true });
      const value = client.prepare('select data_revision from trips where id = ?').get(tripId) as {
        data_revision: number;
      };
      client.close();
      return value.data_revision;
    };
    const before = revision();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/trips/${tripId}`,
          headers: mutationHeaders(ownerCookie),
          payload: { themeId: 'cs2' },
        })
      ).statusCode,
    ).toBe(200);
    expect(revision()).toBe(before);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/trips/${tripId}`,
          headers: mutationHeaders(ownerCookie),
          payload: { name: 'Renamed ceremony' },
        })
      ).statusCode,
    ).toBe(200);
    expect(revision()).toBe(before + 1);

    await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/start`,
      headers: mutationHeaders(ownerCookie),
    });
    const frozen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/trips/${tripId}`,
      headers: mutationHeaders(ownerCookie),
      payload: { name: 'Too late' },
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json()).toMatchObject({ error: { code: 'ceremony_started' } });
    await app.close();
    await db.close();
  });

  it('rejects ceremony start before the wrapped unlock time', async () => {
    const { app, db, ownerCookie, tripId } = await fixture(Date.now() + 60_000);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/trips/${tripId}/ceremony/start`,
      headers: mutationHeaders(ownerCookie),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'wrapped_locked' } });
    await app.close();
    await db.close();
  });
});
