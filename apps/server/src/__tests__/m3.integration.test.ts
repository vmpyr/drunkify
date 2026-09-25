import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { hashPasswordSync } from '../auth/password.js';
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
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m3-'));
  tempDirs.push(directory);
  const sqlitePath = join(directory, 'drunkify.db');
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: sqlitePath,
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'CorrectHorseBattery7',
    PUBLIC_URL: 'https://drunkify.test',
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
  return {
    app,
    db,
    sqlitePath,
    adminCookie: firstHeader(signIn.headers['set-cookie']).split(';')[0]!,
  };
}

function mutationHeaders(cookie: string) {
  return { cookie, 'x-requested-with': 'drunkify' };
}

async function createTrip(
  app: Awaited<ReturnType<typeof createApp>>,
  adminCookie: string,
  name = 'Lisbon 2026',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: mutationHeaders(adminCookie),
    payload: {
      name,
      startDate: '2026-09-25',
      endDate: '2026-10-02',
      timezone: 'Europe/Lisbon',
      themeId: 'classic',
      unlockAt: Date.UTC(2026, 9, 3),
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ trip: { id: string; ownerId: string } }>().trip;
}

function insertMember(sqlitePath: string, index: number): string {
  const client = new BetterSqlite3(sqlitePath);
  try {
    const id = uuidv7();
    const now = Date.now() + index;
    client
      .prepare(
        `insert into users
          (id, email, password_hash, role, display_name, must_change_password,
           display_theme_pref, created_at, updated_at)
         values (?, ?, ?, 'member', ?, 0, 'system', ?, ?)`,
      )
      .run(
        id,
        `member${index}@example.com`,
        hashPasswordSync('LongUniquePassphrase7'),
        `Member ${index}`,
        now,
        now,
      );
    return id;
  } finally {
    client.close();
  }
}

describe('M3 trips and memberships', () => {
  it('creates a trip with the admin as owner and scopes the switcher list', async () => {
    const { app, db, adminCookie } = await fixture();
    const trip = await createTrip(app, adminCookie);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/trips',
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      trips: [{ id: trip.id, ownerId: trip.ownerId, name: 'Lisbon 2026' }],
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${trip.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.json()).toMatchObject({
      trip: { id: trip.id },
      members: [{ userId: trip.ownerId, colorIndex: 0, isOwner: true }],
    });
    await app.close();
    await db.close();
  });

  it('assigns an unbounded color ordinal for 13 joined members', async () => {
    const { app, db, sqlitePath, adminCookie } = await fixture();
    const trip = await createTrip(app, adminCookie);
    for (let index = 1; index <= 13; index += 1) {
      const userId = insertMember(sqlitePath, index);
      const added = await app.inject({
        method: 'POST',
        url: `/api/v1/people/${userId}/trips`,
        headers: mutationHeaders(adminCookie),
        payload: { tripId: trip.id },
      });
      expect(added.statusCode).toBe(200);
      expect(added.json()).toMatchObject({ member: { colorIndex: index } });
    }
    const members = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${trip.id}/members`,
      headers: { cookie: adminCookie },
    });
    const colorIndexes = members
      .json<{ members: Array<{ colorIndex: number }> }>()
      .members.map((member) => member.colorIndex);
    expect(colorIndexes).toEqual(Array.from({ length: 14 }, (_, index) => index));
    expect(colorIndexes[10]! % 10).toBe(colorIndexes[0]! % 10);
    await app.close();
    await db.close();
  });

  it('prevents cross-trip list and detail leakage', async () => {
    const { app, db, sqlitePath, adminCookie } = await fixture();
    const first = await createTrip(app, adminCookie, 'First');
    const second = await createTrip(app, adminCookie, 'Second');
    const memberId = insertMember(sqlitePath, 1);
    await app.inject({
      method: 'POST',
      url: `/api/v1/people/${memberId}/trips`,
      headers: mutationHeaders(adminCookie),
      payload: { tripId: first.id },
    });
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { 'x-requested-with': 'drunkify' },
      payload: { email: 'member1@example.com', password: 'LongUniquePassphrase7' },
    });
    const memberCookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/trips',
      headers: { cookie: memberCookie },
    });
    expect(list.json<{ trips: Array<{ id: string }> }>().trips.map((trip) => trip.id)).toEqual([
      first.id,
    ]);
    const forbidden = await app.inject({
      method: 'GET',
      url: `/api/v1/trips/${second.id}`,
      headers: { cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    await app.close();
    await db.close();
  });
});
