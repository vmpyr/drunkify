import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { v7 as uuidv7 } from 'uuid';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { hashPasswordSync } from '../auth/password.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';
import { M2Store } from '../db/m2Store.js';

const MEMBER_COUNT = 10;
const DRINK_COUNT = 2_000;
const RESPONSE_BUDGET_MS = 500;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m10-load-'));
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

  const store = new M2Store(db);
  const owner = await store.findAdmin();
  if (!owner) throw new Error('Seeded admin is unavailable');

  const now = Date.now();
  const tripId = uuidv7();
  await store.createTrip({
    id: tripId,
    name: 'M10 Load Sanity',
    startDate: '2026-09-20',
    endDate: '2026-09-25',
    timezone: 'Etc/UTC',
    themeId: 'classic',
    unlockAt: now - 1_000,
    ownerId: owner.id,
    now,
  });

  const memberIds = [owner.id];
  const passwordHash = hashPasswordSync('LongUniquePassphrase7');
  for (let index = 1; index < MEMBER_COUNT; index += 1) {
    const memberId = uuidv7();
    db.raw
      .sqlite!.prepare(
        `insert into users
        (id, email, password_hash, role, display_name, must_change_password,
         display_theme_pref, created_at, updated_at)
       values (?, ?, ?, 'member', ?, 0, 'system', ?, ?)`,
      )
      .run(
        memberId,
        `load-member-${index}@example.com`,
        passwordHash,
        `Load Member ${index}`,
        now,
        now,
      );
    const added = await store.addMemberToTrip(tripId, memberId, now + index);
    if ('failure' in added) throw new Error(`Unable to add load member: ${added.failure}`);
    memberIds.push(memberId);
  }

  const categories = ['beer', 'wine', 'cocktail', 'soft'] as const;
  const firstDrinkAt = Date.UTC(2026, 8, 20, 12);
  for (let index = 0; index < DRINK_COUNT; index += 1) {
    const category = categories[index % categories.length]!;
    const result = await store.createDrink({
      id: uuidv7(),
      tripId,
      userId: memberIds[index % memberIds.length]!,
      drink: {
        category,
        drinkName: `${category} ${index % 12}`,
        sizeMl: category === 'wine' ? 150 : 330,
        abv: category === 'soft' ? 0 : category === 'wine' ? 12 : 5,
        qty: 1,
        drunkAt: firstDrinkAt + index * 60_000,
        lat: null,
        lng: null,
        accuracy: null,
        altitude: null,
        speed: null,
        venue: null,
        note: null,
      },
      now: now + MEMBER_COUNT + index,
    });
    if (result.statusCode !== 201) {
      throw new Error(`Unable to seed drink ${index}: ${JSON.stringify(result.body)}`);
    }
  }

  const app = await createApp({ config, db });
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { 'x-requested-with': 'drunkify' },
    payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
  });
  const cookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  return { app, cookie, db, tripId };
}

async function timedRequest<T>(
  label: string,
  request: () => Promise<{ statusCode: number; body: string; json(): T }>,
) {
  const startedAt = performance.now();
  const response = await request();
  const elapsedMs = performance.now() - startedAt;
  expect(response.statusCode, response.body).toBe(200);
  expect(
    elapsedMs,
    `${label} took ${elapsedMs.toFixed(1)}ms (budget ${RESPONSE_BUDGET_MS}ms)`,
  ).toBeLessThan(RESPONSE_BUDGET_MS);
  return response.json();
}

describe('M10 load sanity', () => {
  it('serves core reads and computes Wrapped within budget for 10 members and 2,000 drinks', async () => {
    const { app, cookie, db, tripId } = await fixture();
    try {
      const leaderboard = await timedRequest<{
        rows: Array<{ userId: string; values: { drinks: number } }>;
      }>('leaderboard', () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/trips/${tripId}/leaderboard`,
          headers: { cookie },
        }),
      );
      expect(leaderboard.rows).toHaveLength(MEMBER_COUNT);
      expect(leaderboard.rows.reduce((total, row) => total + row.values.drinks, 0)).toBe(
        DRINK_COUNT,
      );

      const feed = await timedRequest<{ items: unknown[]; nextCursor: string | null }>('feed', () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/trips/${tripId}/feed?filter=everyone&limit=100`,
          headers: { cookie },
        }),
      );
      expect(feed.items).toHaveLength(100);
      expect(typeof feed.nextCursor).toBe('string');

      const wrapped = await timedRequest<{
        unlocked: boolean;
        payload: { cards: unknown[] };
        revision: number;
      }>('Personal Wrapped compute', () =>
        app.inject({
          method: 'GET',
          url: `/api/v1/trips/${tripId}/wrapped/personal`,
          headers: { cookie },
        }),
      );
      expect(wrapped.unlocked).toBe(true);
      expect(wrapped.payload.cards).toHaveLength(14);
      expect(wrapped.revision).toBe(1);
    } finally {
      await app.close();
      await db.close();
    }
  }, 120_000);
});
