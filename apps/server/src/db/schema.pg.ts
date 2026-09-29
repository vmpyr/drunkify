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

export const predictions = pgTable(
  'predictions',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    q1MyTotalStd: real('q1_my_total_std'),
    q2GroupTotalStd: real('q2_group_total_std'),
    q3TopMemberId: text('q3_top_member_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    q4LeastMemberId: text('q4_least_member_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    q5TopDay: integer('q5_top_day'),
    q6CriticMemberId: text('q6_critic_member_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    lockedAt: bigint('locked_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [uniqueIndex('ux_predictions_trip_user').on(table.tripId, table.userId)],
);

export const achievementUnlocks = pgTable(
  'achievement_unlocks',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    triggeredByUserId: text('triggered_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    achievementKey: text('achievement_key').notNull(),
    drinkId: text('drink_id').references(() => drinks.id, { onDelete: 'set null' }),
    vars: jsonb('vars')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    unlockedAt: bigint('unlocked_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_achievement_unlocks_personal')
      .on(table.tripId, table.userId, table.achievementKey)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('ux_achievement_unlocks_group')
      .on(table.tripId, table.achievementKey)
      .where(sql`${table.userId} is null`),
    index('ix_achievement_unlocks_trip_unlocked').on(table.tripId, table.unlockedAt),
  ],
);

export const wrappedViews = pgTable(
  'wrapped_views',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchedAt: bigint('watched_at', { mode: 'number' }),
    lastViewedAt: bigint('last_viewed_at', { mode: 'number' }),
    viewCount: integer('view_count').notNull().default(0),
  },
  (table) => [uniqueIndex('ux_wrapped_views_trip_user').on(table.tripId, table.userId)],
);

/** One row per member who has agreed to open the Wrapped before its scheduled time. */
export const wrappedEarlyVotes = pgTable(
  'wrapped_early_votes',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [uniqueIndex('ux_wrapped_early_votes_trip_user').on(table.tripId, table.userId)],
);

export const ceremonyState = pgTable(
  'ceremony_state',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('not_started'),
    currentCardIndex: integer('current_card_index').notNull().default(0),
    subStep: integer('sub_step').notNull().default(0),
    held: boolean('held').notNull().default(false),
    startedBy: text('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: bigint('started_at', { mode: 'number' }),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_ceremony_state_trip').on(table.tripId),
    check('ck_ceremony_state_status', sql`${table.status} in ('not_started','running','ended')`),
    check(
      'ck_ceremony_state_card_index',
      sql`${table.currentCardIndex} >= 0 and ${table.currentCardIndex} <= 10`,
    ),
    check('ck_ceremony_state_sub_step', sql`${table.subStep} >= 0`),
  ],
);

export const wrappedSnapshots = pgTable(
  'wrapped_snapshots',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    revision: integer('revision').notNull().default(1),
    sourceRevision: integer('source_revision').notNull(),
    computedAt: bigint('computed_at', { mode: 'number' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_wrapped_snapshots_personal')
      .on(table.tripId, table.userId, table.revision)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('ux_wrapped_snapshots_squad')
      .on(table.tripId, table.revision)
      .where(sql`${table.userId} is null`),
    index('ix_wrapped_snapshots_latest').on(table.tripId, table.userId, table.revision.desc()),
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
  predictions,
  achievementUnlocks,
  wrappedViews,
  wrappedEarlyVotes,
  ceremonyState,
  wrappedSnapshots,
  appliedOps,
  appMeta,
};
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
