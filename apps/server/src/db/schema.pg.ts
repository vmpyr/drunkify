import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const nowMs = sql`(extract(epoch from now()) * 1000)::bigint`;

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('member'),
    displayName: text('display_name').notNull(),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    disabledAt: bigint('disabled_at', { mode: 'number' }),
    displayThemePref: text('display_theme_pref').notNull().default('system'),
    invitedBy: text('invited_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_users_email').on(table.email),
    uniqueIndex('ux_users_one_admin')
      .on(table.role)
      .where(sql`${table.role} = 'admin'`),
    check('ck_users_role', sql`${table.role} in ('admin', 'member')`),
    check(
      'ck_users_display_theme_pref',
      sql`${table.displayThemePref} in ('system', 'dark', 'light')`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    lastUsedAt: bigint('last_used_at', { mode: 'number' }).notNull().default(nowMs),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('ux_sessions_token_hash').on(table.tokenHash),
    index('ix_sessions_user_id').on(table.userId),
    index('ix_sessions_expires_at').on(table.expiresAt),
    index('ix_sessions_revoked_at').on(table.revokedAt),
  ],
);

export const trips = pgTable('trips', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  timezone: text('timezone').notNull(),
  themeId: text('theme_id').notNull().default('classic'),
  unlockAt: bigint('unlock_at', { mode: 'number' }).notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ceremonyStartedAt: bigint('ceremony_started_at', { mode: 'number' }),
  final24hMarkedAt: bigint('final24h_marked_at', { mode: 'number' }),
  wrappedUnlockedMarkedAt: bigint('wrapped_unlocked_marked_at', { mode: 'number' }),
  dataRevision: bigint('data_revision', { mode: 'number' }).notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
});

export const tripMembers = pgTable(
  'trip_members',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    colorIndex: bigint('color_index', { mode: 'number' }).notNull(),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull().default(nowMs),
    lastOpenedAt: bigint('last_opened_at', { mode: 'number' }),
    firstDrinkAt: bigint('first_drink_at', { mode: 'number' }),
    missedBannerDismissed: boolean('missed_banner_dismissed').notNull().default(false),
  },
  (table) => [
    uniqueIndex('ux_trip_members_trip_user').on(table.tripId, table.userId),
    uniqueIndex('ux_trip_members_trip_color').on(table.tripId, table.colorIndex),
    index('ix_trip_members_user_id').on(table.userId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name'),
    email: text('email'),
    tripId: text('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('pending'),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: bigint('accepted_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('ux_invites_token_hash').on(table.tokenHash),
    index('ix_invites_trip_id').on(table.tripId),
    index('ix_invites_created_by').on(table.createdBy),
    index('ix_invites_state_expires_at').on(table.state, table.expiresAt),
    check('ck_invites_state', sql`${table.state} in ('pending', 'accepted', 'revoked')`),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    usedAt: bigint('used_at', { mode: 'number' }),
  },
  (table) => [
    uniqueIndex('ux_password_resets_token_hash').on(table.tokenHash),
    index('ix_password_resets_user_id').on(table.userId),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    source: text('source').notNull(),
    osmId: text('osm_id'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    index('ix_venues_trip_id').on(table.tripId),
    index('ix_venues_trip_lat_lng').on(table.tripId, table.lat, table.lng),
    uniqueIndex('ux_venues_trip_osm')
      .on(table.tripId, table.osmId)
      .where(sql`${table.osmId} is not null`),
    check('ck_venues_source', sql`${table.source} in ('osm', 'user')`),
  ],
);

export const drinks = pgTable(
  'drinks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    drinkName: text('drink_name').notNull(),
    sizeMl: integer('size_ml').notNull(),
    abv: real('abv').notNull(),
    qty: real('qty').notNull().default(1),
    drunkAt: bigint('drunk_at', { mode: 'number' }).notNull(),
    lat: real('lat'),
    lng: real('lng'),
    accuracy: real('accuracy'),
    altitude: real('altitude'),
    speed: real('speed'),
    venueId: text('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    venueName: text('venue_name'),
    city: text('city'),
    countryCode: text('country_code'),
    rating: integer('rating'),
    note: text('note'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
    editCount: integer('edit_count').notNull().default(0),
    lastEditedAt: bigint('last_edited_at', { mode: 'number' }),
  },
  (table) => [
    index('ix_drinks_trip_drunk_at').on(table.tripId, table.drunkAt),
    index('ix_drinks_trip_user_drunk_at').on(table.tripId, table.userId, table.drunkAt),
    index('ix_drinks_recent_key').on(table.userId, table.category, table.drinkName, table.sizeMl),
    index('ix_drinks_trip_venue').on(table.tripId, table.venueId),
    check(
      'ck_drinks_category',
      sql`${table.category} in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other')`,
    ),
    check('ck_drinks_size', sql`${table.sizeMl} > 0`),
    check('ck_drinks_abv', sql`${table.abv} >= 0 and ${table.abv} <= 80`),
    check('ck_drinks_qty', sql`${table.qty} > 0`),
    check('ck_drinks_rating', sql`${table.rating} is null or ${table.rating} between 1 and 5`),
    check('ck_drinks_note', sql`${table.note} is null or length(${table.note}) <= 80`),
  ],
);

export const customDrinkNames = pgTable(
  'custom_drink_names',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    name: text('name').notNull(),
    abv: real('abv'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    lastUsedAt: bigint('last_used_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_custom_drink_names_user_category_name').on(
      table.userId,
      table.category,
      table.name,
    ),
  ],
);

export const favourites = pgTable(
  'favourites',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    drinkName: text('drink_name').notNull(),
    sizeMl: integer('size_ml').notNull(),
    abv: real('abv').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_favourites_user_key').on(
      table.userId,
      table.category,
      table.drinkName,
      table.sizeMl,
    ),
  ],
);

export const appliedOps = pgTable(
  'applied_ops',
  {
    clientOpId: text('client_op_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    drinkId: text('drink_id').notNull(),
    type: text('type').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    appliedAt: bigint('applied_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    index('ix_applied_ops_trip_user_applied').on(table.tripId, table.userId, table.appliedAt),
    check('ck_applied_ops_type', sql`${table.type} in ('create','update','delete','rate')`),
  ],
);

export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
});

export const schemaTables = {
  users,
  sessions,
  trips,
  tripMembers,
  invites,
  passwordResets,
  venues,
  drinks,
  customDrinkNames,
  favourites,
  appliedOps,
  appMeta,
};
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
