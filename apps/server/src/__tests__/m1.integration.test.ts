import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import {
  issueSession,
  SESSION_DURATION_SECONDS,
  setSessionCookie,
  verifySession,
} from '../auth/session.js';
import { createApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';
import { createDb, openSqliteConnection, type DatabaseContext } from '../db/createDb.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture(password?: string): Promise<{
  config: Config;
  db: DatabaseContext;
  sqlitePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m1-'));
  tempDirs.push(directory);
  const sqlitePath = join(directory, 'drunkify.db');
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: sqlitePath,
    ADMIN_EMAIL: 'Admin@Example.COM',
    ...(password ? { ADMIN_PASSWORD: password } : {}),
    PUBLIC_URL: 'https://drunkify.test',
    LOG_LEVEL: 'silent',
  });
  const db = createDb(config);
  await db.migrate();
  return { config, db, sqlitePath };
}

function readAll(sqlitePath: string, sql: string): unknown[] {
  const client = new BetterSqlite3(sqlitePath, { readonly: true });
  try {
    return client.prepare(sql).all();
  } finally {
    client.close();
  }
}

function runSeedWorker(sqlitePath: string): Promise<string> {
  const repositoryRoot = resolve('../..');
  const worker = resolve(repositoryRoot, 'apps/server/src/__tests__/seed-worker.ts');
  return new Promise((resolveOutput, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', worker, sqlitePath], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveOutput(output);
      else reject(new Error(`seed worker exited ${String(code)}: ${output}`));
    });
  });
}

describe('M1 database bootstrap', () => {
  it('runs migrations idempotently and mirrors the schema version', async () => {
    const { db, sqlitePath } = await fixture('known-password');
    await db.migrate();
    expect(readAll(sqlitePath, "select value from app_meta where key='schema_version'")).toEqual([
      { value: '1' },
    ]);
    await db.close();
  });

  it('seeds exactly one admin across racing processes and logs one OTP', async () => {
    const { db, sqlitePath } = await fixture();
    await db.close();

    const output = (await Promise.all([runSeedWorker(sqlitePath), runSeedWorker(sqlitePath)])).join(
      '\n',
    );
    const users = readAll(
      sqlitePath,
      'select email, password_hash, role, must_change_password from users',
    ) as Array<Record<string, unknown>>;
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
      must_change_password: 1,
    });
    expect(users[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    const passwords = [...output.matchAll(/one-time admin password .*: ([A-Za-z0-9]{20})/g)].map(
      (match) => match[1],
    );
    expect(passwords).toHaveLength(1);
    expect(users[0]?.password_hash).not.toBe(passwords[0]);
    expect(JSON.stringify(readAll(sqlitePath, 'select * from users'))).not.toContain(passwords[0]);
  });

  it('does not seed again after the first successful boot', async () => {
    const { config, db, sqlitePath } = await fixture('known-password');
    const logs: string[] = [];
    expect(await seedAdminIfNeeded(db, config, { info: (message) => logs.push(message) })).toBe(
      true,
    );
    expect(await seedAdminIfNeeded(db, config, { info: (message) => logs.push(message) })).toBe(
      false,
    );
    expect(readAll(sqlitePath, 'select id from users')).toHaveLength(1);
    expect(logs).toEqual([]);
    await db.close();
  });

  it('enables SQLite foreign keys and enforces session cascades', async () => {
    const { config, db, sqlitePath } = await fixture('known-password');
    await seedAdminIfNeeded(db, config, { info() {} });
    const users = readAll(sqlitePath, 'select id from users') as Array<{ id: string }>;
    const userId = users[0]?.id;
    if (!userId) throw new Error('seeded admin missing');
    await issueSession(db, { userId });

    const client = openSqliteConnection(sqlitePath);
    expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
    client.prepare('delete from users where id = ?').run(userId);
    expect(client.prepare('select count(*) as count from sessions').get()).toEqual({ count: 0 });
    client.close();
    await db.close();
  });
});

describe('M1 sessions and readiness', () => {
  it('stores only the token hash, verifies sessions, and renews after one hour', async () => {
    const { config, db, sqlitePath } = await fixture('known-password');
    await seedAdminIfNeeded(db, config, { info() {} });
    const users = readAll(sqlitePath, 'select id from users') as Array<{ id: string }>;
    const userId = users[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) throw new Error('seeded admin missing');
    const now = Date.now() - 2 * 60 * 60 * 1000;
    const issued = await issueSession(db, { userId, now, userAgent: 'vitest' });

    const [stored] = readAll(
      sqlitePath,
      'select token_hash, expires_at, last_used_at from sessions',
    ) as Array<{ token_hash: string; expires_at: number; last_used_at: number }>;
    expect(stored).toBeDefined();
    if (!stored) throw new Error('session row missing');
    expect(stored.token_hash).not.toBe(issued.token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.expires_at - stored.last_used_at).toBe(SESSION_DURATION_SECONDS * 1000);

    const app = await createApp({ config, db });
    app.get('/api/session-test', (request) => ({ userId: request.auth?.user.id ?? null }));
    const response = await app.inject({
      method: 'GET',
      url: '/api/session-test',
      headers: { cookie: `${config.SESSION_COOKIE_NAME}=${issued.token}` },
    });
    expect(response.json()).toEqual({ userId });
    expect(response.headers['set-cookie']).toContain(`Max-Age=${SESSION_DURATION_SECONDS}`);
    const [renewed] = readAll(
      sqlitePath,
      'select expires_at, last_used_at from sessions',
    ) as Array<{
      expires_at: number;
      last_used_at: number;
    }>;
    expect(renewed).toBeDefined();
    if (!renewed) throw new Error('renewed session row missing');
    expect(renewed.expires_at - renewed.last_used_at).toBe(SESSION_DURATION_SECONDS * 1000);
    await app.close();

    const client = new BetterSqlite3(sqlitePath);
    client.prepare('update sessions set revoked_at = ? where id = ?').run(Date.now(), issued.id);
    client.close();
    expect(await verifySession(db, issued.token)).toBeNull();

    const expired = await issueSession(db, {
      userId,
      now: Date.now() - (SESSION_DURATION_SECONDS * 1000 + 1),
    });
    expect(await verifySession(db, expired.token)).toBeNull();
    await db.close();
  });

  it('sets the required cookie attributes and supports COOKIE_SECURE=false', async () => {
    const { config, db } = await fixture('known-password');
    const app = await createApp({ config, db });
    app.get('/cookie-test', (_request, reply) => {
      setSessionCookie(reply, config, 'raw-token');
      return { ok: true };
    });
    const secure = await app.inject({ method: 'GET', url: '/cookie-test' });
    expect(secure.headers['set-cookie']).toContain('HttpOnly');
    expect(secure.headers['set-cookie']).toContain('SameSite=Lax');
    expect(secure.headers['set-cookie']).toContain('Secure');
    expect(secure.headers['set-cookie']).toContain(`Max-Age=${SESSION_DURATION_SECONDS}`);

    await app.close();
    await db.close();

    const insecureFixture = await fixture('known-password');
    const insecureConfig = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      SQLITE_PATH: insecureFixture.sqlitePath,
      ADMIN_EMAIL: 'admin@example.com',
      COOKIE_SECURE: 'false',
      LOG_LEVEL: 'silent',
    });
    const insecureApp = await createApp({ config: insecureConfig, db: insecureFixture.db });
    insecureApp.get('/cookie-test', (_request, reply) => {
      setSessionCookie(reply, insecureConfig, 'raw-token');
      return { ok: true };
    });
    const insecure = await insecureApp.inject({ method: 'GET', url: '/cookie-test' });
    expect(insecure.headers['set-cookie']).not.toContain('Secure');
    await insecureApp.close();
    await insecureFixture.db.close();
  });

  it('reports liveness independently and readiness from the database ping', async () => {
    const { config, db } = await fixture('known-password');
    const app = await createApp({ config, db, startedAt: Date.now() - 1000 });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ok', schemaVersion: '1' });
    await app.close();

    const failingDb: DatabaseContext = {
      ...db,
      ping() {
        return Promise.reject(new Error('database unavailable'));
      },
    };
    const notReadyApp = await createApp({ config, db: failingDb });
    const cookie = `${config.SESSION_COOKIE_NAME}=stale-token`;
    const live = await notReadyApp.inject({
      method: 'GET',
      url: '/healthz',
      headers: { cookie },
    });
    expect(live.statusCode).toBe(200);
    const notReady = await notReadyApp.inject({
      method: 'GET',
      url: '/readyz',
      headers: { cookie },
    });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toMatchObject({ status: 'not_ready', schemaVersion: '1' });
    await notReadyApp.close();
    await db.close();
  });
});
