import type BetterSqlite3 from 'better-sqlite3';
import type pg from 'pg';

import type { DatabaseContext } from './createDb.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'member';
  displayName: string;
  mustChangePassword: boolean;
  disabledAt: number | null;
  displayThemePref: 'system' | 'dark' | 'light';
  invitedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InviteRecord {
  id: string;
  name: string | null;
  email: string | null;
  tripId: string | null;
  tripName: string | null;
  state: 'pending' | 'accepted' | 'revoked';
  createdBy: string;
  inviterName: string;
  acceptedBy: string | null;
  acceptedAt: number | null;
  createdAt: number;
  expiresAt: number;
}

export interface ResetRecord {
  id: string;
  userId: string;
  email: string;
  passwordHash: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface TripRecord {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  themeId: string;
  unlockAt: number;
  ownerId: string;
  ceremonyStartedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemberRecord {
  userId: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  colorIndex: number;
  joinedAt: number;
  disabled: boolean;
  isOwner: boolean;
}

export type TokenFailure = 'invalid' | 'expired' | 'used' | 'revoked';

interface RunResult {
  changes: number;
}

interface SqlExecutor {
  get<T>(statement: string, parameters?: unknown[]): Promise<T | undefined>;
  all<T>(statement: string, parameters?: unknown[]): Promise<T[]>;
  run(statement: string, parameters?: unknown[]): Promise<RunResult>;
}

interface SqlAdapter extends SqlExecutor {
  transaction<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T>;
}

function postgresStatement(statement: string): string {
  let index = 0;
  return statement.replaceAll('?', () => `$${++index}`);
}

function sqliteAdapter(client: BetterSqlite3.Database): SqlAdapter {
  let transactionQueue: Promise<void> = Promise.resolve();
  const executor: SqlExecutor = {
    get<T>(statement: string, parameters: unknown[] = []) {
      return Promise.resolve(client.prepare(statement).get(...parameters) as T | undefined);
    },
    all<T>(statement: string, parameters: unknown[] = []) {
      return Promise.resolve(client.prepare(statement).all(...parameters) as T[]);
    },
    run(statement: string, parameters: unknown[] = []) {
      const result = client.prepare(statement).run(...parameters);
      return Promise.resolve({ changes: result.changes });
    },
  };
  return {
    ...executor,
    transaction<T>(work: (executor: SqlExecutor) => Promise<T>) {
      const execute = async () => {
        client.exec('BEGIN IMMEDIATE');
        try {
          const value = await work(executor);
          client.exec('COMMIT');
          return value;
        } catch (error) {
          client.exec('ROLLBACK');
          throw error;
        }
      };
      const result = transactionQueue.then(execute, execute);
      transactionQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

function postgresExecutor(client: pg.Pool | pg.PoolClient): SqlExecutor {
  return {
    async get<T>(statement: string, parameters: unknown[] = []) {
      const result = await client.query(postgresStatement(statement), parameters);
      return result.rows[0] as T | undefined;
    },
    async all<T>(statement: string, parameters: unknown[] = []) {
      const result = await client.query(postgresStatement(statement), parameters);
      return result.rows as T[];
    },
    async run(statement: string, parameters: unknown[] = []) {
      const result = await client.query(postgresStatement(statement), parameters);
      return { changes: result.rowCount ?? 0 };
    },
  };
}

function postgresAdapter(pool: pg.Pool): SqlAdapter {
  return {
    ...postgresExecutor(pool),
    async transaction<T>(work: (executor: SqlExecutor) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await work(postgresExecutor(client));
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function normalizeUser(row: Record<string, unknown> | undefined): UserRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: row.role === 'admin' ? 'admin' : 'member',
    displayName: String(row.display_name),
    mustChangePassword: Boolean(row.must_change_password),
    disabledAt: row.disabled_at === null ? null : Number(row.disabled_at),
    displayThemePref:
      row.display_theme_pref === 'dark' || row.display_theme_pref === 'light'
        ? row.display_theme_pref
        : 'system',
    invitedBy: typeof row.invited_by === 'string' ? row.invited_by : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function normalizeInvite(row: Record<string, unknown> | undefined): InviteRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : null,
    email: typeof row.email === 'string' ? row.email : null,
    tripId: typeof row.trip_id === 'string' ? row.trip_id : null,
    tripName: typeof row.trip_name === 'string' ? row.trip_name : null,
    state: row.state === 'accepted' || row.state === 'revoked' ? row.state : 'pending',
    createdBy: String(row.created_by),
    inviterName: String(row.inviter_name),
    acceptedBy: typeof row.accepted_by === 'string' ? row.accepted_by : null,
    acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

function classifyInvite(invite: InviteRecord | null, now: number): TokenFailure | null {
  if (!invite) return 'invalid';
  if (invite.state === 'accepted') return 'used';
  if (invite.state === 'revoked') return 'revoked';
  if (invite.expiresAt <= now) return 'expired';
  return null;
}

function normalizeTrip(row: Record<string, unknown> | undefined): TripRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    timezone: String(row.timezone),
    themeId: String(row.theme_id),
    unlockAt: Number(row.unlock_at),
    ownerId: String(row.owner_id),
    ceremonyStartedAt: row.ceremony_started_at === null ? null : Number(row.ceremony_started_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class M2Store {
  readonly #adapter: SqlAdapter;
  readonly #booleanTrue: boolean | number;
  readonly #booleanFalse: boolean | number;
  readonly #forUpdate: string;

  constructor(db: DatabaseContext) {
    if (db.raw.sqlite) {
      this.#adapter = sqliteAdapter(db.raw.sqlite);
      this.#booleanTrue = 1;
      this.#booleanFalse = 0;
      this.#forUpdate = '';
    } else if (db.raw.postgres) {
      this.#adapter = postgresAdapter(db.raw.postgres);
      this.#booleanTrue = true;
      this.#booleanFalse = false;
      this.#forUpdate = 'for update';
    } else {
      throw new Error('Database raw connection is unavailable');
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      'select * from users where email = ? limit 1',
      [email],
    );
    return normalizeUser(row);
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      'select * from users where id = ? limit 1',
      [id],
    );
    return normalizeUser(row);
  }

  async findAdmin(): Promise<UserRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      "select * from users where role = 'admin' limit 1",
    );
    return normalizeUser(row);
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string; displayThemePref?: 'system' | 'dark' | 'light'; now: number },
  ): Promise<UserRecord | null> {
    if (input.displayName !== undefined) {
      await this.#adapter.run('update users set display_name = ?, updated_at = ? where id = ?', [
        input.displayName,
        input.now,
        userId,
      ]);
    }
    if (input.displayThemePref !== undefined) {
      await this.#adapter.run(
        'update users set display_theme_pref = ?, updated_at = ? where id = ?',
        [input.displayThemePref, input.now, userId],
      );
    }
    return this.findUserById(userId);
  }

  async finishSetup(input: {
    userId: string;
    displayName: string;
    email: string;
    passwordHash: string;
    now: number;
  }): Promise<'ok' | 'email_taken'> {
    try {
      const result = await this.#adapter.run(
        `update users
         set display_name = ?, email = ?, password_hash = ?, must_change_password = ?, updated_at = ?
         where id = ? and must_change_password = ?`,
        [
          input.displayName,
          input.email,
          input.passwordHash,
          this.#booleanFalse,
          input.now,
          input.userId,
          this.#booleanTrue,
        ],
      );
      return result.changes === 1 ? 'ok' : 'email_taken';
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) return 'email_taken';
      throw error;
    }
  }

  async updateEmail(userId: string, email: string, now: number): Promise<'ok' | 'email_taken'> {
    try {
      const result = await this.#adapter.run(
        'update users set email = ?, updated_at = ? where id = ?',
        [email, now, userId],
      );
      return result.changes === 1 ? 'ok' : 'email_taken';
    } catch (error) {
      if (String(error).toLowerCase().includes('unique')) return 'email_taken';
      throw error;
    }
  }

  async updatePassword(userId: string, passwordHash: string, now: number): Promise<void> {
    await this.#adapter.run(
      'update users set password_hash = ?, must_change_password = ?, updated_at = ? where id = ?',
      [passwordHash, this.#booleanFalse, now, userId],
    );
  }

  async revokeSession(sessionId: string, now: number): Promise<void> {
    await this.#adapter.run(
      'update sessions set revoked_at = ? where id = ? and revoked_at is null',
      [now, sessionId],
    );
  }

  async revokeSessions(userId: string, now: number, exceptSessionId?: string): Promise<void> {
    if (exceptSessionId) {
      await this.#adapter.run(
        'update sessions set revoked_at = ? where user_id = ? and id <> ? and revoked_at is null',
        [now, userId, exceptSessionId],
      );
      return;
    }
    await this.#adapter.run(
      'update sessions set revoked_at = ? where user_id = ? and revoked_at is null',
      [now, userId],
    );
  }

  async cleanupSessions(now: number): Promise<number> {
    const threshold = now - SESSION_RETENTION_MS;
    const result = await this.#adapter.run(
      `delete from sessions
       where (revoked_at is not null and revoked_at <= ?)
          or (expires_at <= ?)`,
      [threshold, threshold],
    );
    return result.changes;
  }

  async createReset(input: {
    id: string;
    userId: string;
    tokenHash: string;
    createdBy: string | null;
    now: number;
  }): Promise<void> {
    await this.#adapter.transaction(async (tx) => {
      await tx.run('update password_resets set used_at = ? where user_id = ? and used_at is null', [
        input.now,
        input.userId,
      ]);
      await tx.run(
        `insert into password_resets
          (id, user_id, token_hash, created_by, created_at, expires_at)
         values (?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.userId,
          input.tokenHash,
          input.createdBy,
          input.now,
          input.now + RESET_TTL_MS,
        ],
      );
    });
  }

  async lookupReset(tokenHash: string): Promise<ResetRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      `select r.id, r.user_id, r.expires_at, r.used_at, u.email, u.password_hash
       from password_resets r
       join users u on u.id = r.user_id
       where r.token_hash = ?
       limit 1`,
      [tokenHash],
    );
    if (!row) return null;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      expiresAt: Number(row.expires_at),
      usedAt: row.used_at === null ? null : Number(row.used_at),
    };
  }

  async consumeReset(input: {
    tokenHash: string;
    passwordHash: string;
    now: number;
  }): Promise<{ user: UserRecord } | { failure: Exclude<TokenFailure, 'revoked'> }> {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<Record<string, unknown>>(
        `select r.id, r.user_id, r.expires_at, r.used_at
         from password_resets r where r.token_hash = ? limit 1`,
        [input.tokenHash],
      );
      if (!row) return { failure: 'invalid' as const };
      if (row.used_at !== null) return { failure: 'used' as const };
      if (Number(row.expires_at) <= input.now) return { failure: 'expired' as const };

      const claimed = await tx.run(
        `update password_resets set used_at = ?
         where id = ? and used_at is null and expires_at > ?`,
        [input.now, row.id, input.now],
      );
      if (claimed.changes !== 1) return { failure: 'used' as const };
      await tx.run(
        `update users
         set password_hash = ?, must_change_password = ?, updated_at = ?
         where id = ?`,
        [input.passwordHash, this.#booleanFalse, input.now, row.user_id],
      );
      await tx.run('update sessions set revoked_at = ? where user_id = ? and revoked_at is null', [
        input.now,
        row.user_id,
      ]);
      const userRow = await tx.get<Record<string, unknown>>('select * from users where id = ?', [
        row.user_id,
      ]);
      const user = normalizeUser(userRow);
      if (!user) throw new Error('Reset user disappeared');
      return { user };
    });
  }

  async createInvite(input: {
    id: string;
    tokenHash: string;
    createdBy: string;
    name: string | null;
    email: string | null;
    tripId: string | null;
    now: number;
  }): Promise<InviteRecord> {
    await this.#adapter.run(
      `insert into invites
        (id, token_hash, created_by, name, email, trip_id, state, created_at, expires_at)
       values (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        input.id,
        input.tokenHash,
        input.createdBy,
        input.name,
        input.email,
        input.tripId,
        input.now,
        input.now + INVITE_TTL_MS,
      ],
    );
    const invite = await this.getInviteById(input.id);
    if (!invite) throw new Error('Created invite disappeared');
    return invite;
  }

  async getInviteById(id: string): Promise<InviteRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      `select i.*, t.name as trip_name, u.display_name as inviter_name
       from invites i
       left join trips t on t.id = i.trip_id
       join users u on u.id = i.created_by
       where i.id = ? limit 1`,
      [id],
    );
    return normalizeInvite(row);
  }

  async lookupInvite(tokenHash: string): Promise<InviteRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      `select i.*, t.name as trip_name, u.display_name as inviter_name
       from invites i
       left join trips t on t.id = i.trip_id
       join users u on u.id = i.created_by
       where i.token_hash = ? limit 1`,
      [tokenHash],
    );
    return normalizeInvite(row);
  }

  async listInvites(now: number, state?: string): Promise<InviteRecord[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select i.*, t.name as trip_name, u.display_name as inviter_name
       from invites i
       left join trips t on t.id = i.trip_id
       join users u on u.id = i.created_by
       order by i.created_at desc`,
    );
    return rows
      .map((row) => normalizeInvite(row))
      .filter((invite): invite is InviteRecord => invite !== null)
      .filter((invite) => {
        const derived =
          invite.state === 'pending' && invite.expiresAt <= now ? 'expired' : invite.state;
        if (state) return derived === state;
        if (invite.state !== 'pending') return false;
        return invite.expiresAt > now - SESSION_RETENTION_MS;
      });
  }

  async reissueInvite(
    id: string,
    tokenHash: string,
    now: number,
  ): Promise<'ok' | 'not_found' | 'conflict'> {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<{ state: string }>('select state from invites where id = ?', [id]);
      if (!row) return 'not_found';
      if (row.state === 'accepted') return 'conflict';
      await tx.run(
        `update invites
         set token_hash = ?, state = 'pending', accepted_by = null, accepted_at = null,
             created_at = ?, expires_at = ?
         where id = ?`,
        [tokenHash, now, now + INVITE_TTL_MS, id],
      );
      return 'ok';
    });
  }

  async revokeInvite(id: string): Promise<'ok' | 'not_found' | 'conflict'> {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<{ state: string }>('select state from invites where id = ?', [id]);
      if (!row) return 'not_found';
      if (row.state === 'accepted') return 'conflict';
      await tx.run("update invites set state = 'revoked' where id = ?", [id]);
      return 'ok';
    });
  }

  async acceptInviteNewUser(input: {
    tokenHash: string;
    userId: string;
    email: string;
    displayName: string;
    passwordHash: string;
    now: number;
  }): Promise<
    { user: UserRecord; tripId: string | null } | { failure: TokenFailure | 'email_taken' }
  > {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<Record<string, unknown>>(
        `select i.*, u.display_name as inviter_name, t.name as trip_name,
                t.ceremony_started_at
         from invites i
         join users u on u.id = i.created_by
         left join trips t on t.id = i.trip_id
         where i.token_hash = ? limit 1`,
        [input.tokenHash],
      );
      const invite = normalizeInvite(row);
      const failure = classifyInvite(invite, input.now);
      if (failure) return { failure };
      if (!invite) return { failure: 'invalid' };

      try {
        await tx.run(
          `insert into users
            (id, email, password_hash, role, display_name, must_change_password,
             display_theme_pref, invited_by, created_at, updated_at)
           values (?, ?, ?, 'member', ?, ?, 'system', ?, ?, ?)`,
          [
            input.userId,
            input.email,
            input.passwordHash,
            input.displayName,
            this.#booleanFalse,
            invite.createdBy,
            input.now,
            input.now,
          ],
        );
      } catch (error) {
        if (String(error).toLowerCase().includes('unique')) return { failure: 'email_taken' };
        throw error;
      }

      const claimed = await tx.run(
        `update invites set state = 'accepted', accepted_by = ?, accepted_at = ?
         where id = ? and state = 'pending' and expires_at > ?`,
        [input.userId, input.now, invite.id, input.now],
      );
      if (claimed.changes !== 1) return { failure: 'used' };

      const ceremonyStartedAt = row?.ceremony_started_at;
      let tripId: string | null = null;
      if (invite.tripId && ceremonyStartedAt === null) {
        await tx.get(`select id from trips where id = ? ${this.#forUpdate}`, [invite.tripId]);
        const count = await tx.get<{ count: number | string }>(
          'select count(*) as count from trip_members where trip_id = ?',
          [invite.tripId],
        );
        await tx.run(
          `insert into trip_members (trip_id, user_id, color_index, joined_at)
           values (?, ?, ?, ?)`,
          [invite.tripId, input.userId, Number(count?.count ?? 0), input.now],
        );
        tripId = invite.tripId;
      }
      const userRow = await tx.get<Record<string, unknown>>('select * from users where id = ?', [
        input.userId,
      ]);
      const user = normalizeUser(userRow);
      if (!user) throw new Error('Accepted user disappeared');
      return { user, tripId };
    });
  }

  async acceptInviteAsMember(input: {
    tokenHash: string;
    userId: string;
    now: number;
  }): Promise<{ tripId: string | null; consumed: boolean } | { failure: TokenFailure }> {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<Record<string, unknown>>(
        `select i.*, u.display_name as inviter_name, t.name as trip_name,
                t.ceremony_started_at
         from invites i
         join users u on u.id = i.created_by
         left join trips t on t.id = i.trip_id
         where i.token_hash = ? limit 1`,
        [input.tokenHash],
      );
      const invite = normalizeInvite(row);
      const failure = classifyInvite(invite, input.now);
      if (failure) return { failure };
      if (!invite) return { failure: 'invalid' };
      if (!invite.tripId) return { tripId: null, consumed: false };

      const claimed = await tx.run(
        `update invites set state = 'accepted', accepted_by = ?, accepted_at = ?
         where id = ? and state = 'pending' and expires_at > ?`,
        [input.userId, input.now, invite.id, input.now],
      );
      if (claimed.changes !== 1) return { failure: 'used' };
      if (row?.ceremony_started_at !== null) return { tripId: null, consumed: true };

      await tx.get(`select id from trips where id = ? ${this.#forUpdate}`, [invite.tripId]);
      const existing = await tx.get<{ value: number }>(
        'select 1 as value from trip_members where trip_id = ? and user_id = ?',
        [invite.tripId, input.userId],
      );
      if (!existing) {
        const count = await tx.get<{ count: number | string }>(
          'select count(*) as count from trip_members where trip_id = ?',
          [invite.tripId],
        );
        await tx.run(
          `insert into trip_members (trip_id, user_id, color_index, joined_at)
           values (?, ?, ?, ?)`,
          [invite.tripId, input.userId, Number(count?.count ?? 0), input.now],
        );
      }
      return { tripId: invite.tripId, consumed: true };
    });
  }

  async listPeople(): Promise<UserRecord[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      "select * from users where role = 'member' order by created_at desc",
    );
    return rows
      .map((row) => normalizeUser(row))
      .filter((user): user is UserRecord => user !== null);
  }

  async removeUser(userId: string, now: number): Promise<'ok' | 'not_found' | 'forbidden'> {
    return this.#adapter.transaction(async (tx) => {
      const row = await tx.get<{ role: string }>('select role from users where id = ?', [userId]);
      if (!row) return 'not_found';
      if (row.role === 'admin') return 'forbidden';
      await tx.run('update users set disabled_at = ?, updated_at = ? where id = ?', [
        now,
        now,
        userId,
      ]);
      await tx.run('update sessions set revoked_at = ? where user_id = ? and revoked_at is null', [
        now,
        userId,
      ]);
      await tx.run('update password_resets set used_at = ? where user_id = ? and used_at is null', [
        now,
        userId,
      ]);
      return 'ok';
    });
  }

  async createTrip(input: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    timezone: string;
    themeId: string;
    unlockAt: number;
    ownerId: string;
    now: number;
  }): Promise<TripRecord> {
    await this.#adapter.transaction(async (tx) => {
      await tx.run(
        `insert into trips
          (id, name, start_date, end_date, timezone, theme_id, unlock_at, owner_id,
           created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.name,
          input.startDate,
          input.endDate,
          input.timezone,
          input.themeId,
          input.unlockAt,
          input.ownerId,
          input.now,
          input.now,
        ],
      );
      await tx.run(
        `insert into trip_members (trip_id, user_id, color_index, joined_at)
         values (?, ?, 0, ?)`,
        [input.id, input.ownerId, input.now],
      );
    });
    const trip = await this.getTrip(input.id);
    if (!trip) throw new Error('Created trip disappeared');
    return trip;
  }

  async getTrip(id: string): Promise<TripRecord | null> {
    const row = await this.#adapter.get<Record<string, unknown>>(
      'select * from trips where id = ? limit 1',
      [id],
    );
    return normalizeTrip(row);
  }

  async listTripsForUser(userId: string): Promise<TripRecord[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select t.*
       from trips t
       join trip_members tm on tm.trip_id = t.id
       where tm.user_id = ?
       order by coalesce(tm.last_opened_at, tm.joined_at) desc`,
      [userId],
    );
    return rows.map(normalizeTrip).filter((trip): trip is TripRecord => trip !== null);
  }

  async isTripMember(tripId: string, userId: string): Promise<boolean> {
    return Boolean(
      await this.#adapter.get(
        'select 1 as value from trip_members where trip_id = ? and user_id = ?',
        [tripId, userId],
      ),
    );
  }

  async listTripMembers(tripId: string): Promise<MemberRecord[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select u.id as user_id, u.display_name, u.email, u.role, u.disabled_at,
              tm.color_index, tm.joined_at, t.owner_id
       from trip_members tm
       join users u on u.id = tm.user_id
       join trips t on t.id = tm.trip_id
       where tm.trip_id = ?
       order by tm.color_index asc`,
      [tripId],
    );
    return rows.map((row) => ({
      userId: String(row.user_id),
      name: String(row.display_name),
      email: String(row.email),
      role: row.role === 'admin' ? 'admin' : 'member',
      colorIndex: Number(row.color_index),
      joinedAt: Number(row.joined_at),
      disabled: row.disabled_at !== null,
      isOwner: row.owner_id === row.user_id,
    }));
  }

  async addMemberToTrip(
    tripId: string,
    userId: string,
    now: number,
  ): Promise<
    | { member: MemberRecord }
    | { failure: 'trip_not_found' | 'user_not_found' | 'conflict' | 'ceremony_started' }
  > {
    return this.#adapter.transaction(async (tx) => {
      const trip = await tx.get<Record<string, unknown>>(
        `select id, owner_id, ceremony_started_at
         from trips where id = ? limit 1 ${this.#forUpdate}`,
        [tripId],
      );
      if (!trip) return { failure: 'trip_not_found' };
      if (trip.ceremony_started_at !== null) return { failure: 'ceremony_started' };
      const user = await tx.get<Record<string, unknown>>(
        'select id, display_name, email, role, disabled_at from users where id = ? limit 1',
        [userId],
      );
      if (!user) return { failure: 'user_not_found' };
      const existing = await tx.get(
        'select 1 as value from trip_members where trip_id = ? and user_id = ?',
        [tripId, userId],
      );
      if (existing) return { failure: 'conflict' };
      const ordinal = await tx.get<{ next_index: number | string }>(
        'select coalesce(max(color_index), -1) + 1 as next_index from trip_members where trip_id = ?',
        [tripId],
      );
      const colorIndex = Number(ordinal?.next_index ?? 0);
      await tx.run(
        `insert into trip_members (trip_id, user_id, color_index, joined_at)
         values (?, ?, ?, ?)`,
        [tripId, userId, colorIndex, now],
      );
      await tx.run(
        'update trips set data_revision = data_revision + 1, updated_at = ? where id = ?',
        [now, tripId],
      );
      return {
        member: {
          userId,
          name: String(user.display_name),
          email: String(user.email),
          role: user.role === 'admin' ? 'admin' : 'member',
          colorIndex,
          joinedAt: now,
          disabled: user.disabled_at !== null,
          isOwner: trip.owner_id === userId,
        },
      };
    });
  }
}
