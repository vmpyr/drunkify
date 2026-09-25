import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { hashPassword, hashPasswordSync } from '../auth/password.js';
import { generateAdminPassword } from '../auth/tokens.js';
import type { Config } from '../config.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.sqlite.js';

export const SCHEMA_VERSION = '6';

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
  userAgent: string | null;
  user: {
    id: string;
    email: string;
    role: string;
    displayName: string;
    mustChangePassword: boolean;
    disabledAt: number | null;
  };
}

export interface SeedResult {
  created: boolean;
  generatedPassword?: string;
}

export interface DatabaseContext {
  driver: 'sqlite' | 'postgres';
  raw: {
    sqlite?: BetterSqlite3.Database;
    postgres?: pg.Pool;
  };
  migrate(): Promise<void>;
  ping(): Promise<void>;
  getSchemaVersion(): Promise<string>;
  close(): Promise<void>;
  countUsers(): Promise<number>;
  seedAdmin(input: {
    email: string;
    password?: string;
    now: number;
    id: string;
  }): Promise<SeedResult>;
  insertSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    now: number;
    expiresAt: number;
    userAgent?: string;
  }): Promise<void>;
  findActiveSession(tokenHash: string, now: number): Promise<SessionRecord | null>;
  renewSession(id: string, lastUsedAt: number, expiresAt: number): Promise<void>;
}

function resolveMigrationsFolder(config: Config, driver: 'sqlite' | 'postgres'): string {
  const dialect = driver === 'sqlite' ? 'sqlite' : 'pg';
  const folder = resolve(config.DRUNKIFY_MIGRATIONS_DIR, dialect);
  if (!existsSync(resolve(folder, 'meta/_journal.json'))) {
    throw new Error(`Could not find ${dialect} migrations at ${folder}`);
  }
  return folder;
}

export function createDb(config: Config): DatabaseContext {
  return config.DB_DRIVER === 'postgres' ? createPostgresDb(config) : createSqliteDb(config);
}

export function openSqliteConnection(path: string): BetterSqlite3.Database {
  mkdirSync(dirname(path), { recursive: true });
  const client = new BetterSqlite3(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  client.pragma('synchronous = NORMAL');
  return client;
}

function createSqliteDb(config: Config): DatabaseContext {
  const client = openSqliteConnection(config.SQLITE_PATH);
  const db = drizzleSqlite(client, { schema: sqliteSchema });

  return {
    driver: 'sqlite',
    raw: { sqlite: client },
    migrate() {
      migrateSqlite(db, { migrationsFolder: resolveMigrationsFolder(config, 'sqlite') });
      const now = Date.now();
      db.insert(sqliteSchema.appMeta)
        .values({ key: 'schema_version', value: SCHEMA_VERSION, updatedAt: now })
        .onConflictDoUpdate({
          target: sqliteSchema.appMeta.key,
          set: { value: SCHEMA_VERSION, updatedAt: now },
        })
        .run();
      return Promise.resolve();
    },
    ping() {
      client.prepare('select 1').get();
      if (client.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new Error('SQLite foreign key enforcement is disabled');
      }
      return Promise.resolve();
    },
    getSchemaVersion() {
      const row = db
        .select({ value: sqliteSchema.appMeta.value })
        .from(sqliteSchema.appMeta)
        .where(eq(sqliteSchema.appMeta.key, 'schema_version'))
        .get();
      if (!row) throw new Error('schema_version is missing');
      return Promise.resolve(row.value);
    },
    close() {
      client.close();
      return Promise.resolve();
    },
    countUsers() {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(sqliteSchema.users)
        .get();
      return Promise.resolve(Number(row?.count ?? 0));
    },
    seedAdmin(input) {
      const result = db.transaction((tx) => {
        const claimed = tx
          .insert(sqliteSchema.appMeta)
          .values({ key: 'admin_seeded', value: String(input.now), updatedAt: input.now })
          .onConflictDoNothing()
          .run();
        if (claimed.changes === 0) return { created: false };

        const existing = tx
          .select({ count: sql<number>`count(*)` })
          .from(sqliteSchema.users)
          .get();
        if (Number(existing?.count ?? 0) > 0) return { created: false };

        const password = input.password ?? generateAdminPassword();
        tx.insert(sqliteSchema.users)
          .values({
            id: input.id,
            email: input.email,
            passwordHash: hashPasswordSync(password),
            role: 'admin',
            displayName: 'Admin',
            mustChangePassword: true,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .run();
        return input.password ? { created: true } : { created: true, generatedPassword: password };
      });
      return Promise.resolve(result);
    },
    insertSession(input) {
      db.insert(sqliteSchema.sessions)
        .values({
          id: input.id,
          userId: input.userId,
          tokenHash: input.tokenHash,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          lastUsedAt: input.now,
          userAgent: input.userAgent ?? null,
        })
        .run();
      return Promise.resolve();
    },
    findActiveSession(tokenHash, now) {
      const row = db
        .select({
          id: sqliteSchema.sessions.id,
          userId: sqliteSchema.sessions.userId,
          tokenHash: sqliteSchema.sessions.tokenHash,
          expiresAt: sqliteSchema.sessions.expiresAt,
          lastUsedAt: sqliteSchema.sessions.lastUsedAt,
          revokedAt: sqliteSchema.sessions.revokedAt,
          userAgent: sqliteSchema.sessions.userAgent,
          userIdValue: sqliteSchema.users.id,
          email: sqliteSchema.users.email,
          role: sqliteSchema.users.role,
          displayName: sqliteSchema.users.displayName,
          mustChangePassword: sqliteSchema.users.mustChangePassword,
          disabledAt: sqliteSchema.users.disabledAt,
        })
        .from(sqliteSchema.sessions)
        .innerJoin(sqliteSchema.users, eq(sqliteSchema.sessions.userId, sqliteSchema.users.id))
        .where(
          and(
            eq(sqliteSchema.sessions.tokenHash, tokenHash),
            isNull(sqliteSchema.sessions.revokedAt),
            gt(sqliteSchema.sessions.expiresAt, now),
            isNull(sqliteSchema.users.disabledAt),
          ),
        )
        .get();
      return Promise.resolve(row ? mapSession(row) : null);
    },
    renewSession(id, lastUsedAt, expiresAt) {
      db.update(sqliteSchema.sessions)
        .set({ lastUsedAt, expiresAt })
        .where(eq(sqliteSchema.sessions.id, id))
        .run();
      return Promise.resolve();
    },
  };
}

function createPostgresDb(config: Config): DatabaseContext {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const db = drizzlePg(pool, { schema: pgSchema });

  return {
    driver: 'postgres',
    raw: { postgres: pool },
    async migrate() {
      await migratePg(db, { migrationsFolder: resolveMigrationsFolder(config, 'postgres') });
      const now = Date.now();
      await db
        .insert(pgSchema.appMeta)
        .values({ key: 'schema_version', value: SCHEMA_VERSION, updatedAt: now })
        .onConflictDoUpdate({
          target: pgSchema.appMeta.key,
          set: { value: SCHEMA_VERSION, updatedAt: now },
        });
    },
    async ping() {
      await pool.query('select 1');
    },
    async getSchemaVersion() {
      const [row] = await db
        .select({ value: pgSchema.appMeta.value })
        .from(pgSchema.appMeta)
        .where(eq(pgSchema.appMeta.key, 'schema_version'))
        .limit(1);
      if (!row) throw new Error('schema_version is missing');
      return row.value;
    },
    async close() {
      await pool.end();
    },
    async countUsers() {
      const [row] = await db.select({ count: sql<number>`count(*)` }).from(pgSchema.users);
      return Number(row?.count ?? 0);
    },
    async seedAdmin(input) {
      return db.transaction(async (tx) => {
        const claimed = await tx
          .insert(pgSchema.appMeta)
          .values({ key: 'admin_seeded', value: String(input.now), updatedAt: input.now })
          .onConflictDoNothing()
          .returning({ key: pgSchema.appMeta.key });
        if (claimed.length === 0) return { created: false };

        const [existing] = await tx.select({ count: sql<number>`count(*)` }).from(pgSchema.users);
        if (Number(existing?.count ?? 0) > 0) return { created: false };

        const password = input.password ?? generateAdminPassword();
        const passwordHash = await hashPassword(password);
        await tx.insert(pgSchema.users).values({
          id: input.id,
          email: input.email,
          passwordHash,
          role: 'admin',
          displayName: 'Admin',
          mustChangePassword: true,
          createdAt: input.now,
          updatedAt: input.now,
        });
        return input.password ? { created: true } : { created: true, generatedPassword: password };
      });
    },
    async insertSession(input) {
      await db.insert(pgSchema.sessions).values({
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        lastUsedAt: input.now,
        userAgent: input.userAgent ?? null,
      });
    },
    async findActiveSession(tokenHash, now) {
      const [row] = await db
        .select({
          id: pgSchema.sessions.id,
          userId: pgSchema.sessions.userId,
          tokenHash: pgSchema.sessions.tokenHash,
          expiresAt: pgSchema.sessions.expiresAt,
          lastUsedAt: pgSchema.sessions.lastUsedAt,
          revokedAt: pgSchema.sessions.revokedAt,
          userAgent: pgSchema.sessions.userAgent,
          userIdValue: pgSchema.users.id,
          email: pgSchema.users.email,
          role: pgSchema.users.role,
          displayName: pgSchema.users.displayName,
          mustChangePassword: pgSchema.users.mustChangePassword,
          disabledAt: pgSchema.users.disabledAt,
        })
        .from(pgSchema.sessions)
        .innerJoin(pgSchema.users, eq(pgSchema.sessions.userId, pgSchema.users.id))
        .where(
          and(
            eq(pgSchema.sessions.tokenHash, tokenHash),
            isNull(pgSchema.sessions.revokedAt),
            gt(pgSchema.sessions.expiresAt, now),
            isNull(pgSchema.users.disabledAt),
          ),
        )
        .limit(1);
      return row ? mapSession(row) : null;
    },
    async renewSession(id, lastUsedAt, expiresAt) {
      await db
        .update(pgSchema.sessions)
        .set({ lastUsedAt, expiresAt })
        .where(eq(pgSchema.sessions.id, id));
    },
  };
}

function mapSession(row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  lastUsedAt: number;
  revokedAt: number | null;
  userAgent: string | null;
  userIdValue: string;
  email: string;
  role: string;
  displayName: string;
  mustChangePassword: boolean;
  disabledAt: number | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    userAgent: row.userAgent,
    user: {
      id: row.userIdValue,
      email: row.email,
      role: row.role,
      displayName: row.displayName,
      mustChangePassword: row.mustChangePassword,
      disabledAt: row.disabledAt,
    },
  };
}
