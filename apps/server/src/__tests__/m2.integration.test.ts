import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { createApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { createDb, type DatabaseContext } from '../db/createDb.js';
import { M2Store, SESSION_RETENTION_MS } from '../db/m2Store.js';

const tempDirs: string[] = [];

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture(): Promise<{
  app: Awaited<ReturnType<typeof createApp>>;
  config: Config;
  db: DatabaseContext;
  sqlitePath: string;
  adminCookie: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m2-'));
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
    payload: { email: 'ADMIN@example.com', password: 'CorrectHorseBattery7' },
  });
  expect(signIn.statusCode).toBe(200);
  const adminCookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  return { app, config, db, sqlitePath, adminCookie };
}

function mutationHeaders(cookie?: string) {
  return {
    'x-requested-with': 'drunkify',
    ...(cookie ? { cookie } : {}),
  };
}

async function createInvite(
  app: Awaited<ReturnType<typeof createApp>>,
  adminCookie: string,
): Promise<{ token: string; id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/invites',
    headers: mutationHeaders(adminCookie),
    payload: { name: 'Alex', email: 'alex@example.com' },
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<{ invite: { id: string }; url: string }>();
  return { id: body.invite.id, token: body.url.split('/').at(-1)! };
}

describe('M2 auth and CSRF', () => {
  it('requires the mutation header and signs in with a sliding session cookie', async () => {
    const { app, db } = await fixture();
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ error: { code: 'bad_request' } });

    const generic = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: mutationHeaders(),
      payload: { email: 'missing@example.com', password: 'wrong-password' },
    });
    expect(generic.statusCode).toBe(401);
    expect(generic.json()).toMatchObject({ error: { code: 'bad_credentials' } });
    await app.close();
    await db.close();
  });
});

describe('M2 invite atomicity and token states', () => {
  it('allows exactly one parallel accept and classifies every loser as token_used', async () => {
    const { app, db, adminCookie } = await fixture();
    const { token } = await createInvite(app, adminCookie);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/invites/accept',
          headers: mutationHeaders(),
          payload: {
            token,
            name: 'Alex',
            email: 'alex@example.com',
            password: 'LongUniquePassphrase7',
          },
        }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 410)).toHaveLength(7);
    for (const response of responses.filter((item) => item.statusCode === 410)) {
      expect(response.json()).toMatchObject({ error: { code: 'token_used' } });
    }
    await app.close();
    await db.close();
  });

  it('returns lookup problems as 200 and consume problems with canonical statuses', async () => {
    const { app, db, adminCookie } = await fixture();
    const unknownLookup = await app.inject({
      method: 'GET',
      url: '/api/v1/invites/lookup/not-a-real-token-value',
    });
    expect(unknownLookup.statusCode).toBe(200);
    expect(unknownLookup.json()).toEqual({ kind: 'invalid' });

    const { id, token } = await createInvite(app, adminCookie);
    await app.inject({
      method: 'POST',
      url: `/api/v1/invites/${id}/revoke`,
      headers: mutationHeaders(adminCookie),
    });
    const revoked = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: mutationHeaders(),
      payload: {
        token,
        name: 'Alex',
        email: 'alex@example.com',
        password: 'LongUniquePassphrase7',
      },
    });
    expect(revoked.statusCode).toBe(410);
    expect(revoked.json()).toMatchObject({ error: { code: 'token_revoked' } });
    await app.close();
    await db.close();
  });
});

describe('M2 resets, removal, and cleanup', () => {
  it('supersedes older reset links and signs in with the consumed link', async () => {
    const { app, db, adminCookie } = await fixture();
    const { token } = await createInvite(app, adminCookie);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: mutationHeaders(),
      payload: {
        token,
        name: 'Alex',
        email: 'alex@example.com',
        password: 'LongUniquePassphrase7',
      },
    });
    const userId = accepted.json<{ user: { id: string } }>().user.id;
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/people/${userId}/reset-link`,
      headers: mutationHeaders(adminCookie),
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/people/${userId}/reset-link`,
      headers: mutationHeaders(adminCookie),
    });
    const firstToken = first.json<{ url: string }>().url.split('/').at(-1)!;
    const secondToken = second.json<{ url: string }>().url.split('/').at(-1)!;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/auth/reset-password/${firstToken}`,
        })
      ).json(),
    ).toEqual({ kind: 'used' });

    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      headers: mutationHeaders(),
      payload: { token: secondToken, newPassword: 'AnotherUniquePassphrase8' },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.headers['set-cookie']).toContain('drunkify_session=');
    await app.close();
    await db.close();
  });

  it('removes access without deleting user data and rejects the existing session', async () => {
    const { app, db, adminCookie, sqlitePath } = await fixture();
    const { token } = await createInvite(app, adminCookie);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/invites/accept',
      headers: mutationHeaders(),
      payload: {
        token,
        name: 'Alex',
        email: 'alex@example.com',
        password: 'LongUniquePassphrase7',
      },
    });
    const userId = accepted.json<{ user: { id: string } }>().user.id;
    const memberCookie = firstHeader(accepted.headers['set-cookie']).split(';')[0]!;
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/people/${userId}`,
          headers: mutationHeaders(adminCookie),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: { cookie: memberCookie },
        })
      ).statusCode,
    ).toBe(401);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: mutationHeaders(),
      payload: { email: 'alex@example.com', password: 'LongUniquePassphrase7' },
    });
    expect(signIn.statusCode).toBe(403);
    expect(signIn.json()).toMatchObject({ error: { code: 'account_disabled' } });
    const client = new BetterSqlite3(sqlitePath, { readonly: true });
    expect(client.prepare('select count(*) as count from users where id = ?').get(userId)).toEqual({
      count: 1,
    });
    client.close();
    await app.close();
    await db.close();
  });

  it('retains young revoked sessions and deletes rows after the 30-day boundary', async () => {
    const { app, db, sqlitePath } = await fixture();
    const now = Date.now();
    const client = new BetterSqlite3(sqlitePath);
    const user = client.prepare('select id from users limit 1').get() as { id: string };
    const insert = client.prepare(
      `insert into sessions
        (id, user_id, token_hash, created_at, expires_at, last_used_at, revoked_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('young', user.id, 'a'.repeat(64), now, now + 1000, now, now - 1000);
    insert.run(
      'old',
      user.id,
      'b'.repeat(64),
      now - SESSION_RETENTION_MS,
      now,
      now,
      now - SESSION_RETENTION_MS - 1,
    );
    client.close();
    expect(await new M2Store(db).cleanupSessions(now)).toBe(1);
    const verify = new BetterSqlite3(sqlitePath, { readonly: true });
    const remaining = verify.prepare('select id from sessions order by id').all() as Array<{
      id: string;
    }>;
    expect(remaining).toContainEqual({ id: 'young' });
    expect(remaining).not.toContainEqual({ id: 'old' });
    verify.close();
    await app.close();
    await db.close();
  });
});
