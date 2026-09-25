import type BetterSqlite3 from 'better-sqlite3';
import type pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { pendingTransitions, stdDrinks } from '@drunkify/shared';

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

export const DRINK_CATEGORIES = [
  'beer',
  'wine',
  'cocktail',
  'spirit',
  'shot',
  'cider',
  'seltzer',
  'soft',
  'other',
] as const;
export type DrinkCategory = (typeof DRINK_CATEGORIES)[number];

export type VenueInput =
  | { id: string }
  | { candidate: { name: string; lat: number; lng: number; osmId: string } }
  | { name: string }
  | null;

export interface DrinkInput {
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  venue: VenueInput;
  note: string | null;
  rating?: number | null;
}

export interface DrinkRecord {
  id: string;
  userId: string;
  tripId: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
  qty: number;
  drunkAt: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  venueId: string | null;
  venueName: string | null;
  city: string | null;
  countryCode: string | null;
  rating: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  editCount: number;
  lastEditedAt: number | null;
}

export interface VenueRecord {
  id: string;
  tripId: string;
  name: string;
  lat: number;
  lng: number;
  source: 'osm' | 'user';
  osmId: string | null;
}

export interface FavouriteRecord {
  id: string;
  category: DrinkCategory;
  drinkName: string;
  sizeMl: number;
  abv: number;
}

export interface DrinkMutationResult {
  statusCode: number;
  body: Record<string, unknown>;
  applied?: boolean;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  joinedAt: number;
  std: number;
  drinks: number;
  k: number;
  a: number;
  d: number;
  rating: number;
}

export interface FeedDrink {
  drink: DrinkRecord;
  memberName: string;
}

export interface PhaseTransitionClaim {
  tripId: string;
  phase: 'final_24h' | 'wrapped_unlocked';
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

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeDrink(row: Record<string, unknown> | undefined): DrinkRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tripId: String(row.trip_id),
    category: row.category as DrinkCategory,
    drinkName: String(row.drink_name),
    sizeMl: Number(row.size_ml),
    abv: Number(row.abv),
    qty: Number(row.qty),
    drunkAt: Number(row.drunk_at),
    lat: nullableNumber(row.lat),
    lng: nullableNumber(row.lng),
    accuracy: nullableNumber(row.accuracy),
    altitude: nullableNumber(row.altitude),
    speed: nullableNumber(row.speed),
    venueId: nullableText(row.venue_id),
    venueName: nullableText(row.venue_name),
    city: nullableText(row.city),
    countryCode: nullableText(row.country_code),
    rating: nullableNumber(row.rating),
    note: nullableText(row.note),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    editCount: Number(row.edit_count),
    lastEditedAt: nullableNumber(row.last_edited_at),
  };
}

function normalizeVenue(row: Record<string, unknown> | undefined): VenueRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    tripId: String(row.trip_id),
    name: String(row.name),
    lat: Number(row.lat),
    lng: Number(row.lng),
    source: row.source === 'osm' ? 'osm' : 'user',
    osmId: nullableText(row.osm_id),
  };
}

export class M2Store {
  readonly #adapter: SqlAdapter;
  readonly #booleanTrue: boolean | number;
  readonly #booleanFalse: boolean | number;
  readonly #forUpdate: string;
  readonly #isPostgres: boolean;

  constructor(db: DatabaseContext) {
    if (db.raw.sqlite) {
      this.#adapter = sqliteAdapter(db.raw.sqlite);
      this.#booleanTrue = 1;
      this.#booleanFalse = 0;
      this.#forUpdate = '';
      this.#isPostgres = false;
    } else if (db.raw.postgres) {
      this.#adapter = postgresAdapter(db.raw.postgres);
      this.#booleanTrue = true;
      this.#booleanFalse = false;
      this.#forUpdate = 'for update';
      this.#isPostgres = true;
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

  async #prepareDrinkMutation(
    tx: SqlExecutor,
    tripId: string,
    userId: string,
  ): Promise<DrinkMutationResult | null> {
    const trip = await tx.get<Record<string, unknown>>(
      `select id, ceremony_started_at from trips where id = ? ${this.#forUpdate}`,
      [tripId],
    );
    if (!trip) {
      return {
        statusCode: 404,
        body: { error: { code: 'not_found', message: 'Trip not found' } },
      };
    }
    if (trip.ceremony_started_at !== null) {
      return {
        statusCode: 409,
        body: { error: { code: 'ceremony_started', message: 'Ceremony has started' } },
      };
    }
    const member = await tx.get(
      'select 1 as value from trip_members where trip_id = ? and user_id = ?',
      [tripId, userId],
    );
    if (!member) {
      return {
        statusCode: 403,
        body: { error: { code: 'forbidden', message: 'Trip membership required' } },
      };
    }
    return null;
  }

  async #resolveVenue(
    tx: SqlExecutor,
    tripId: string,
    venue: VenueInput,
    now: number,
  ): Promise<
    { venueId: string | null; venueName: string | null } | { error: DrinkMutationResult }
  > {
    if (venue === null) return { venueId: null, venueName: null };
    if ('name' in venue) return { venueId: null, venueName: venue.name };
    if ('id' in venue) {
      const existing = await tx.get<Record<string, unknown>>(
        'select * from venues where id = ? and trip_id = ?',
        [venue.id, tripId],
      );
      const normalized = normalizeVenue(existing);
      if (!normalized) {
        return {
          error: {
            statusCode: 422,
            body: { error: { code: 'validation_failed', message: 'Invalid venue' } },
          },
        };
      }
      return { venueId: normalized.id, venueName: normalized.name };
    }

    const candidate = venue.candidate;
    const venueId = uuidLike();
    await tx.run(
      `insert into venues
        (id, trip_id, name, lat, lng, source, osm_id, created_at, updated_at)
       values (?, ?, ?, ?, ?, 'osm', ?, ?, ?)
       on conflict (trip_id, osm_id) where osm_id is not null
       do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
                     updated_at = excluded.updated_at`,
      [venueId, tripId, candidate.name, candidate.lat, candidate.lng, candidate.osmId, now, now],
    );
    const stored = await tx.get<Record<string, unknown>>(
      'select * from venues where trip_id = ? and osm_id = ?',
      [tripId, candidate.osmId],
    );
    const normalized = normalizeVenue(stored);
    if (!normalized) throw new Error('Venue upsert failed');
    return { venueId: normalized.id, venueName: normalized.name };
  }

  async #findDrink(tx: SqlExecutor, drinkId: string): Promise<DrinkRecord | null> {
    return normalizeDrink(
      await tx.get<Record<string, unknown>>('select * from drinks where id = ?', [drinkId]),
    );
  }

  async #createDrink(
    tx: SqlExecutor,
    input: {
      id: string;
      tripId: string;
      userId: string;
      drink: DrinkInput;
      now: number;
    },
  ): Promise<DrinkMutationResult> {
    const gate = await this.#prepareDrinkMutation(tx, input.tripId, input.userId);
    if (gate) return gate;
    const existing = await this.#findDrink(tx, input.id);
    if (existing) {
      if (existing.tripId === input.tripId && existing.userId === input.userId) {
        return { statusCode: 200, body: { drink: existing }, applied: false };
      }
      return {
        statusCode: 409,
        body: { error: { code: 'id_conflict', message: 'Drink id is already in use' } },
      };
    }
    const venue = await this.#resolveVenue(tx, input.tripId, input.drink.venue, input.now);
    if ('error' in venue) return venue.error;
    await tx.run(
      `insert into drinks
        (id, user_id, trip_id, category, drink_name, size_ml, abv, qty, drunk_at,
         lat, lng, accuracy, altitude, speed, venue_id, venue_name, note,
         created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.tripId,
        input.drink.category,
        input.drink.drinkName,
        input.drink.sizeMl,
        input.drink.abv,
        input.drink.qty,
        input.drink.drunkAt,
        input.drink.lat,
        input.drink.lng,
        input.drink.accuracy,
        input.drink.altitude,
        input.drink.speed,
        venue.venueId,
        venue.venueName,
        input.drink.note,
        input.now,
        input.now,
      ],
    );
    await tx.run(
      `update trip_members set first_drink_at = ?
       where trip_id = ? and user_id = ? and first_drink_at is null`,
      [input.now, input.tripId, input.userId],
    );
    await tx.run(
      'update trips set data_revision = data_revision + 1, updated_at = ? where id = ?',
      [input.now, input.tripId],
    );
    return {
      statusCode: 201,
      body: { drink: (await this.#findDrink(tx, input.id))! },
      applied: true,
    };
  }

  async #updateDrink(
    tx: SqlExecutor,
    input: {
      id: string;
      tripId: string;
      userId: string;
      drink: DrinkInput;
      now: number;
    },
  ): Promise<DrinkMutationResult> {
    const gate = await this.#prepareDrinkMutation(tx, input.tripId, input.userId);
    if (gate) return gate;
    const existing = await this.#findDrink(tx, input.id);
    if (!existing || existing.tripId !== input.tripId) {
      return {
        statusCode: 404,
        body: { error: { code: 'not_found', message: 'Drink not found' } },
      };
    }
    if (existing.userId !== input.userId) {
      return {
        statusCode: 403,
        body: { error: { code: 'forbidden', message: 'Drink belongs to another user' } },
      };
    }
    const venue = await this.#resolveVenue(tx, input.tripId, input.drink.venue, input.now);
    if ('error' in venue) return venue.error;
    await tx.run(
      `update drinks set
         category = ?, drink_name = ?, size_ml = ?, abv = ?, qty = ?, drunk_at = ?,
         lat = ?, lng = ?, accuracy = ?, altitude = ?, speed = ?,
         venue_id = ?, venue_name = ?, note = ?, rating = ?,
         updated_at = ?, edit_count = edit_count + 1, last_edited_at = ?
       where id = ?`,
      [
        input.drink.category,
        input.drink.drinkName,
        input.drink.sizeMl,
        input.drink.abv,
        input.drink.qty,
        input.drink.drunkAt,
        input.drink.lat,
        input.drink.lng,
        input.drink.accuracy,
        input.drink.altitude,
        input.drink.speed,
        venue.venueId,
        venue.venueName,
        input.drink.note,
        input.drink.rating ?? existing.rating,
        input.now,
        input.now,
        input.id,
      ],
    );
    await tx.run(
      'update trips set data_revision = data_revision + 1, updated_at = ? where id = ?',
      [input.now, input.tripId],
    );
    return {
      statusCode: 200,
      body: { drink: (await this.#findDrink(tx, input.id))! },
      applied: true,
    };
  }

  async #rateDrink(
    tx: SqlExecutor,
    input: { id: string; tripId: string; userId: string; rating: number; now: number },
  ): Promise<DrinkMutationResult> {
    const gate = await this.#prepareDrinkMutation(tx, input.tripId, input.userId);
    if (gate) return gate;
    const existing = await this.#findDrink(tx, input.id);
    if (!existing || existing.tripId !== input.tripId) {
      return {
        statusCode: 404,
        body: { error: { code: 'not_found', message: 'Drink not found' } },
      };
    }
    if (existing.userId !== input.userId) {
      return {
        statusCode: 403,
        body: { error: { code: 'forbidden', message: 'Drink belongs to another user' } },
      };
    }
    if (existing.category === 'soft') {
      return {
        statusCode: 422,
        body: { error: { code: 'validation_failed', message: 'Soft drinks cannot be rated' } },
      };
    }
    await tx.run('update drinks set rating = ?, updated_at = ? where id = ?', [
      input.rating,
      input.now,
      input.id,
    ]);
    await tx.run(
      'update trips set data_revision = data_revision + 1, updated_at = ? where id = ?',
      [input.now, input.tripId],
    );
    return {
      statusCode: 200,
      body: { drink: (await this.#findDrink(tx, input.id))! },
      applied: true,
    };
  }

  async #deleteDrink(
    tx: SqlExecutor,
    input: { id: string; tripId: string; userId: string; now: number },
  ): Promise<DrinkMutationResult> {
    const gate = await this.#prepareDrinkMutation(tx, input.tripId, input.userId);
    if (gate) return gate;
    const existing = await this.#findDrink(tx, input.id);
    if (!existing || existing.tripId !== input.tripId) {
      return {
        statusCode: 404,
        body: { error: { code: 'not_found', message: 'Drink not found' } },
      };
    }
    if (existing.userId !== input.userId) {
      return {
        statusCode: 403,
        body: { error: { code: 'forbidden', message: 'Drink belongs to another user' } },
      };
    }
    await tx.run('delete from drinks where id = ?', [input.id]);
    await tx.run(
      'update trips set data_revision = data_revision + 1, updated_at = ? where id = ?',
      [input.now, input.tripId],
    );
    return { statusCode: 204, body: {}, applied: true };
  }

  createDrink(input: {
    id: string;
    tripId: string;
    userId: string;
    drink: DrinkInput;
    now: number;
  }): Promise<DrinkMutationResult> {
    return this.#adapter.transaction((tx) => this.#createDrink(tx, input));
  }

  updateDrink(input: {
    id: string;
    tripId: string;
    userId: string;
    drink: DrinkInput;
    now: number;
  }): Promise<DrinkMutationResult> {
    return this.#adapter.transaction((tx) => this.#updateDrink(tx, input));
  }

  rateDrink(input: {
    id: string;
    tripId: string;
    userId: string;
    rating: number;
    now: number;
  }): Promise<DrinkMutationResult> {
    return this.#adapter.transaction((tx) => this.#rateDrink(tx, input));
  }

  deleteDrink(input: {
    id: string;
    tripId: string;
    userId: string;
    now: number;
  }): Promise<DrinkMutationResult> {
    return this.#adapter.transaction((tx) => this.#deleteDrink(tx, input));
  }

  async applyDrinkOp(input: {
    clientOpId: string;
    tripId: string;
    userId: string;
    type: 'create' | 'update' | 'delete' | 'rate';
    drinkId: string;
    payload?: DrinkInput | { rating: number };
    now: number;
  }): Promise<DrinkMutationResult> {
    return this.#adapter.transaction(async (tx) => {
      const stored = await tx.get<Record<string, unknown>>(
        'select status_code, response from applied_ops where client_op_id = ?',
        [input.clientOpId],
      );
      if (stored) {
        const response =
          typeof stored.response === 'string'
            ? (JSON.parse(stored.response) as Record<string, unknown>)
            : (stored.response as Record<string, unknown>);
        return { statusCode: Number(stored.status_code), body: response, applied: false };
      }
      let result: DrinkMutationResult;
      if (input.clientOpId === input.drinkId) {
        result = {
          statusCode: 422,
          body: {
            error: {
              code: 'validation_failed',
              message: 'clientOpId must differ from drinkId',
            },
          },
        };
      } else if (input.type === 'create' && input.payload && 'category' in input.payload) {
        result = await this.#createDrink(tx, {
          id: input.drinkId,
          tripId: input.tripId,
          userId: input.userId,
          drink: input.payload,
          now: input.now,
        });
      } else if (input.type === 'update' && input.payload && 'category' in input.payload) {
        result = await this.#updateDrink(tx, {
          id: input.drinkId,
          tripId: input.tripId,
          userId: input.userId,
          drink: input.payload,
          now: input.now,
        });
      } else if (
        input.type === 'rate' &&
        input.payload &&
        'rating' in input.payload &&
        typeof input.payload.rating === 'number'
      ) {
        result = await this.#rateDrink(tx, {
          id: input.drinkId,
          tripId: input.tripId,
          userId: input.userId,
          rating: input.payload.rating,
          now: input.now,
        });
      } else if (input.type === 'delete') {
        result = await this.#deleteDrink(tx, {
          id: input.drinkId,
          tripId: input.tripId,
          userId: input.userId,
          now: input.now,
        });
      } else {
        result = {
          statusCode: 422,
          body: { error: { code: 'validation_failed', message: 'Invalid sync operation' } },
        };
      }
      await tx.run(
        `insert into applied_ops
          (client_op_id, user_id, trip_id, drink_id, type, status_code, response, applied_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.clientOpId,
          input.userId,
          input.tripId,
          input.drinkId,
          input.type,
          result.statusCode,
          this.#isPostgres ? result.body : JSON.stringify(result.body),
          input.now,
        ],
      );
      return { ...result, applied: true };
    });
  }

  async getRecents(
    tripId: string,
    userId: string,
    limit: number,
  ): Promise<{
    lastDrink: DrinkRecord | null;
    lastByCategory: Partial<Record<DrinkCategory, DrinkRecord>>;
    items: DrinkRecord[];
  }> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select * from drinks
       where trip_id = ? and user_id = ?
       order by drunk_at desc, created_at desc`,
      [tripId, userId],
    );
    const drinks = rows.map(normalizeDrink).filter((drink): drink is DrinkRecord => drink !== null);
    const favourites = await this.listFavourites(userId);
    const favouriteKeys = new Set(
      favourites.map((item) => `${item.category}\u0000${item.drinkName}\u0000${item.sizeMl}`),
    );
    const lastByCategory: Partial<Record<DrinkCategory, DrinkRecord>> = {};
    const deduplicated: DrinkRecord[] = [];
    const seen = new Set<string>();
    for (const drink of drinks) {
      lastByCategory[drink.category] ??= drink;
      const key = `${drink.category}\u0000${drink.drinkName}\u0000${drink.sizeMl}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(drink);
      }
    }
    const items = deduplicated
      .map((drink, index) => ({
        drink,
        index,
        favourite: favouriteKeys.has(
          `${drink.category}\u0000${drink.drinkName}\u0000${drink.sizeMl}`,
        ),
      }))
      .sort(
        (left, right) =>
          Number(right.favourite) - Number(left.favourite) || left.index - right.index,
      )
      .slice(0, limit)
      .map(({ drink }) => drink);
    return { lastDrink: drinks[0] ?? null, lastByCategory, items };
  }

  async listFavourites(userId: string): Promise<FavouriteRecord[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select id, category, drink_name, size_ml, abv
       from favourites where user_id = ? order by created_at desc`,
      [userId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      category: row.category as DrinkCategory,
      drinkName: String(row.drink_name),
      sizeMl: Number(row.size_ml),
      abv: Number(row.abv),
    }));
  }

  async upsertFavourite(input: {
    id: string;
    userId: string;
    category: DrinkCategory;
    drinkName: string;
    sizeMl: number;
    abv: number;
    now: number;
  }): Promise<FavouriteRecord> {
    await this.#adapter.run(
      `insert into favourites
        (id, user_id, category, drink_name, size_ml, abv, created_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict (user_id, category, drink_name, size_ml)
       do update set abv = excluded.abv`,
      [input.id, input.userId, input.category, input.drinkName, input.sizeMl, input.abv, input.now],
    );
    const row = await this.#adapter.get<Record<string, unknown>>(
      `select id, category, drink_name, size_ml, abv from favourites
       where user_id = ? and category = ? and drink_name = ? and size_ml = ?`,
      [input.userId, input.category, input.drinkName, input.sizeMl],
    );
    return {
      id: String(row!.id),
      category: row!.category as DrinkCategory,
      drinkName: String(row!.drink_name),
      sizeMl: Number(row!.size_ml),
      abv: Number(row!.abv),
    };
  }

  async deleteFavourite(id: string, userId: string): Promise<'ok' | 'not_found' | 'forbidden'> {
    const row = await this.#adapter.get<{ user_id: string }>(
      'select user_id from favourites where id = ?',
      [id],
    );
    if (!row) return 'not_found';
    if (row.user_id !== userId) return 'forbidden';
    await this.#adapter.run('delete from favourites where id = ?', [id]);
    return 'ok';
  }

  async listCustomDrinkNames(userId: string, category?: DrinkCategory) {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select name, abv from custom_drink_names
       where user_id = ? ${category ? 'and category = ?' : ''}
       order by last_used_at desc`,
      category ? [userId, category] : [userId],
    );
    return rows.map((row) => ({ name: String(row.name), abv: nullableNumber(row.abv) }));
  }

  async upsertCustomDrinkName(input: {
    id: string;
    userId: string;
    category: DrinkCategory;
    name: string;
    abv: number | null;
    now: number;
  }): Promise<void> {
    await this.#adapter.run(
      `insert into custom_drink_names
        (id, user_id, category, name, abv, created_at, last_used_at)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict (user_id, category, name)
       do update set abv = excluded.abv, last_used_at = excluded.last_used_at`,
      [input.id, input.userId, input.category, input.name, input.abv, input.now, input.now],
    );
  }

  async suggestVenue(
    tripId: string,
    lat: number,
    lng: number,
  ): Promise<{ kind: 'existing'; venue: VenueRecord } | { kind: 'none' }> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      'select * from venues where trip_id = ?',
      [tripId],
    );
    const nearest = rows
      .map(normalizeVenue)
      .filter((venue): venue is VenueRecord => venue !== null)
      .map((venue) => ({ venue, distance: haversineMetres(lat, lng, venue.lat, venue.lng) }))
      .filter((item) => item.distance <= 150)
      .sort((left, right) => left.distance - right.distance)[0];
    return nearest ? { kind: 'existing', venue: nearest.venue } : { kind: 'none' };
  }

  async renameVenue(
    tripId: string,
    venueId: string,
    name: string,
    now: number,
  ): Promise<VenueRecord | null> {
    const result = await this.#adapter.run(
      'update venues set name = ?, updated_at = ? where id = ? and trip_id = ?',
      [name, now, venueId, tripId],
    );
    if (result.changes === 0) return null;
    return normalizeVenue(
      await this.#adapter.get<Record<string, unknown>>('select * from venues where id = ?', [
        venueId,
      ]),
    );
  }

  async getLeaderboardRows(tripId: string): Promise<LeaderboardRow[]> {
    const members = await this.#adapter.all<Record<string, unknown>>(
      `select tm.user_id, tm.joined_at, u.display_name
       from trip_members tm
       join users u on u.id = tm.user_id
       where tm.trip_id = ?`,
      [tripId],
    );
    const drinkRows = await this.#adapter.all<Record<string, unknown>>(
      'select * from drinks where trip_id = ?',
      [tripId],
    );
    const drinks = drinkRows
      .map(normalizeDrink)
      .filter((drink): drink is DrinkRecord => drink !== null);
    const intermediate = members.map((member) => {
      const own = drinks.filter((drink) => drink.userId === member.user_id);
      const std =
        Math.round(
          own.reduce((total, drink) => total + stdDrinks(drink.sizeMl, drink.abv, drink.qty), 0) *
            10,
        ) / 10;
      const a = own.reduce(
        (total, drink) =>
          total +
          (drinks.some(
            (other) =>
              other.userId !== drink.userId && Math.abs(other.drunkAt - drink.drunkAt) <= 60_000,
          )
            ? drink.qty
            : 0),
        0,
      );
      const d = own.reduce(
        (total, drink) => total + (drink.category === 'soft' ? drink.qty : 0),
        0,
      );
      return {
        userId: String(member.user_id),
        name: String(member.display_name),
        joinedAt: Number(member.joined_at),
        std,
        drinks: own.reduce((total, drink) => total + drink.qty, 0),
        k: std,
        a,
        d,
        unique: new Set(own.map((drink) => `${drink.category}\u0000${drink.drinkName}`)).size,
      };
    });
    const zScore = (value: number, values: number[]) => {
      const mean = values.reduce((total, item) => total + item, 0) / Math.max(values.length, 1);
      const variance =
        values.reduce((total, item) => total + (item - mean) ** 2, 0) / Math.max(values.length, 1);
      return (value - mean) / Math.max(Math.sqrt(variance), 1e-9);
    };
    const ks = intermediate.map((row) => row.k);
    const as = intermediate.map((row) => row.a);
    const ds = intermediate.map((row) => row.d);
    const uniques = intermediate.map((row) => row.unique);
    return intermediate.map(({ unique, ...row }) => ({
      ...row,
      rating:
        Math.round(
          Math.min(
            3,
            Math.max(
              0,
              1 +
                0.5 * zScore(row.k, ks) +
                0.3 * zScore(row.a, as) -
                0.2 * zScore(row.d, ds) +
                0.1 * zScore(unique, uniques),
            ),
          ) * 100,
        ) / 100,
    }));
  }

  async getFeedDrinks(tripId: string, userId?: string, limit = 50): Promise<FeedDrink[]> {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select d.*, u.display_name as member_name
       from drinks d
       join users u on u.id = d.user_id
       where d.trip_id = ? ${userId ? 'and d.user_id = ?' : ''}
       order by d.drunk_at desc, d.created_at desc
       limit ?`,
      userId ? [tripId, userId, limit] : [tripId, limit],
    );
    return rows
      .map((row) => {
        const drink = normalizeDrink(row);
        return drink ? { drink, memberName: String(row.member_name) } : null;
      })
      .filter((item): item is FeedDrink => item !== null);
  }

  async getRatings(tripId: string, userId: string, limit = 50) {
    const rows = await this.#adapter.all<Record<string, unknown>>(
      `select id, drink_name, category, rating, drunk_at
       from drinks
       where trip_id = ? and user_id = ? and rating is not null
       order by drunk_at desc limit ?`,
      [tripId, userId, limit],
    );
    return rows.map((row) => ({
      drinkId: String(row.id),
      drinkName: String(row.drink_name),
      category: row.category as DrinkCategory,
      rating: Number(row.rating),
      drunkAt: Number(row.drunk_at),
    }));
  }

  async claimPhaseTransitions(now: number): Promise<PhaseTransitionClaim[]> {
    const trips = await this.#adapter.all<Record<string, unknown>>(
      `select id, unlock_at, final24h_marked_at, wrapped_unlocked_marked_at
       from trips where ceremony_started_at is null`,
    );
    const claimed: PhaseTransitionClaim[] = [];
    for (const trip of trips) {
      const tripId = String(trip.id);
      const unlockAt = Number(trip.unlock_at);
      const transitions = pendingTransitions(
        {
          unlockAt,
          final24hMarkedAt:
            trip.final24h_marked_at === null ? null : Number(trip.final24h_marked_at),
          wrappedUnlockedMarkedAt:
            trip.wrapped_unlocked_marked_at === null
              ? null
              : Number(trip.wrapped_unlocked_marked_at),
        },
        now,
      );
      if (transitions.includes('final_24h')) {
        const result = await this.#adapter.run(
          `update trips set final24h_marked_at = ?
           where id = ? and final24h_marked_at is null`,
          [now, tripId],
        );
        if (result.changes === 1) claimed.push({ tripId, phase: 'final_24h' });
      }
      if (transitions.includes('wrapped_unlocked')) {
        const result = await this.#adapter.run(
          `update trips set wrapped_unlocked_marked_at = ?
           where id = ? and wrapped_unlocked_marked_at is null`,
          [now, tripId],
        );
        if (result.changes === 1) claimed.push({ tripId, phase: 'wrapped_unlocked' });
      }
    }
    return claimed;
  }
}

function uuidLike(): string {
  return uuidv7();
}

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lng2 - lng1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
