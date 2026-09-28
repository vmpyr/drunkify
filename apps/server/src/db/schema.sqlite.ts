import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const nowMs = sql`(unixepoch() * 1000)`;

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('member'),
    displayName: text('display_name').notNull(),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    disabledAt: integer('disabled_at'),
    displayThemePref: text('display_theme_pref').notNull().default('system'),
    invitedBy: text('invited_by').references((): AnySQLiteColumn => users.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
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

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull().default(nowMs),
    expiresAt: integer('expires_at').notNull(),
    lastUsedAt: integer('last_used_at').notNull().default(nowMs),
    revokedAt: integer('revoked_at'),
    userAgent: text('user_agent'),
  },
  (table) => [
    uniqueIndex('ux_sessions_token_hash').on(table.tokenHash),
    index('ix_sessions_user_id').on(table.userId),
    index('ix_sessions_expires_at').on(table.expiresAt),
    index('ix_sessions_revoked_at').on(table.revokedAt),
  ],
);

export const trips = sqliteTable('trips', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  timezone: text('timezone').notNull(),
  themeId: text('theme_id').notNull().default('classic'),
  unlockAt: integer('unlock_at').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  ceremonyStartedAt: integer('ceremony_started_at'),
  final24hMarkedAt: integer('final24h_marked_at'),
  wrappedUnlockedMarkedAt: integer('wrapped_unlocked_marked_at'),
  dataRevision: integer('data_revision').notNull().default(0),
  createdAt: integer('created_at').notNull().default(nowMs),
  updatedAt: integer('updated_at').notNull().default(nowMs),
});

export const tripMembers = sqliteTable(
  'trip_members',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    colorIndex: integer('color_index').notNull(),
    joinedAt: integer('joined_at').notNull().default(nowMs),
    lastOpenedAt: integer('last_opened_at'),
    firstDrinkAt: integer('first_drink_at'),
    missedBannerDismissed: integer('missed_banner_dismissed', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex('ux_trip_members_trip_user').on(table.tripId, table.userId),
    uniqueIndex('ux_trip_members_trip_color').on(table.tripId, table.colorIndex),
    index('ix_trip_members_user_id').on(table.userId),
  ],
);

export const invites = sqliteTable(
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
    acceptedAt: integer('accepted_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('ux_invites_token_hash').on(table.tokenHash),
    index('ix_invites_trip_id').on(table.tripId),
    index('ix_invites_created_by').on(table.createdBy),
    index('ix_invites_state_expires_at').on(table.state, table.expiresAt),
    check('ck_invites_state', sql`${table.state} in ('pending', 'accepted', 'revoked')`),
  ],
);

export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(nowMs),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [
    uniqueIndex('ux_password_resets_token_hash').on(table.tokenHash),
    index('ix_password_resets_user_id').on(table.userId),
  ],
);

export const venues = sqliteTable(
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
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
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

export const drinks = sqliteTable(
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
    drunkAt: integer('drunk_at').notNull(),
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
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
    editCount: integer('edit_count').notNull().default(0),
    lastEditedAt: integer('last_edited_at'),
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

export const customDrinkNames = sqliteTable(
  'custom_drink_names',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    name: text('name').notNull(),
    abv: real('abv'),
    createdAt: integer('created_at').notNull().default(nowMs),
    lastUsedAt: integer('last_used_at').notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_custom_drink_names_user_category_name').on(
      table.userId,
      table.category,
      table.name,
    ),
  ],
);

export const favourites = sqliteTable(
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
    createdAt: integer('created_at').notNull().default(nowMs),
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

export const predictions = sqliteTable(
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
    q5TopDrink: text('q5_top_drink'),
    q5TopDrinkCategory: text('q5_top_drink_category'),
    lockedAt: integer('locked_at'),
    createdAt: integer('created_at').notNull().default(nowMs),
    updatedAt: integer('updated_at').notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_predictions_trip_user').on(table.tripId, table.userId),
    check(
      'ck_predictions_q5_top_drink_category',
      sql`${table.q5TopDrinkCategory} in ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other')`,
    ),
  ],
);

export const achievementUnlocks = sqliteTable(
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
    vars: text('vars', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
    unlockedAt: integer('unlocked_at').notNull().default(nowMs),
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

export const wrappedViews = sqliteTable(
  'wrapped_views',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    watchedAt: integer('watched_at'),
    lastViewedAt: integer('last_viewed_at'),
    viewCount: integer('view_count').notNull().default(0),
  },
  (table) => [uniqueIndex('ux_wrapped_views_trip_user').on(table.tripId, table.userId)],
);

/** One row per member who has agreed to open the Wrapped before its scheduled time. */
export const wrappedEarlyVotes = sqliteTable(
  'wrapped_early_votes',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(nowMs),
  },
  (table) => [uniqueIndex('ux_wrapped_early_votes_trip_user').on(table.tripId, table.userId)],
);

export const ceremonyState = sqliteTable(
  'ceremony_state',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('not_started'),
    currentCardIndex: integer('current_card_index').notNull().default(0),
    subStep: integer('sub_step').notNull().default(0),
    held: integer('held', { mode: 'boolean' }).notNull().default(false),
    startedBy: text('started_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: integer('started_at'),
    updatedAt: integer('updated_at').notNull().default(nowMs),
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

export const wrappedSnapshots = sqliteTable(
  'wrapped_snapshots',
  {
    id: text('id').primaryKey(),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    revision: integer('revision').notNull().default(1),
    sourceRevision: integer('source_revision').notNull(),
    computedAt: integer('computed_at').notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('ux_wrapped_snapshots_personal')
      .on(table.tripId, table.userId, table.revision)
      .where(sql`${table.userId} is not null`),
    uniqueIndex('ux_wrapped_snapshots_squad')
      .on(table.tripId, table.revision)
      .where(sql`${table.userId} is null`),
    index('ix_wrapped_snapshots_latest').on(
      table.tripId,
      table.userId,
      sql`${table.revision} desc`,
    ),
  ],
);

export const appliedOps = sqliteTable(
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
    response: text('response').notNull(),
    appliedAt: integer('applied_at').notNull().default(nowMs),
  },
  (table) => [
    index('ix_applied_ops_trip_user_applied').on(table.tripId, table.userId, table.appliedAt),
    check('ck_applied_ops_type', sql`${table.type} in ('create','update','delete','rate')`),
  ],
);

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(nowMs),
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
