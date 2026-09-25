# 02 — Data Model

Binding: README §4 (shared contracts). Tables, columns and enum values here are the single source of truth; `03-api.md` and later docs must match.

## 1. Conventions

- **IDs**: `text`, UUIDv7, generated server-side (`packages/shared/id.ts`) for every PK **except** `drinks.id`, which is client-generated UUIDv7 (offline idempotency key, D7).
- **Time**: all instants stored as **epoch milliseconds**, `integer` (SQLite) / `bigint` (Postgres) — chosen over native Postgres `timestamp` so both dialects share one representation and app code never branches on driver. Calendar-only fields (`trips.start_date`, `trips.end_date`) are `text` `'YYYY-MM-DD'` in both dialects (no time/zone component; interpreted in the trip's `timezone`).
- **Booleans**: `integer` 0/1 (SQLite) / `boolean` (Postgres). Drizzle's `{mode:'boolean'}` on `integer()` hides this.
- **JSON**: `text` with drizzle `{mode:'json'}` (SQLite) / `jsonb` (Postgres).
- **Money/units**: `ml` integer, `abv` real percent, `qty` real (0.5 steps) — per README §4. 0.5-step and precision rules are enforced by `packages/shared` Zod schemas, not DB constraints (a DB CHECK can't express "0.5 steps" cleanly across both dialects).
- **Enums**: modelled as `CHECK (col IN (...))` in both dialects, **except** content-pack-driven strings (`theme_id`, `achievement_key`, `award_key`, `archetype_key`, `q5_top_drink`) which stay unconstrained `text`, validated against the loaded pack by Zod at the app layer. Rationale: those sets grow with new theme packs (DESIGN_SPEC §4) without a migration.
- **Tokens** (`sessions.token_hash`, `invites.token_hash`, `password_resets.token_hash`): raw token is ≥128 random bits, URL-safe, shown to the client exactly once; DB stores only `sha256(token)` hex.
- **Naming**: DB columns are `snake_case`; Drizzle table definitions map them to `camelCase` JS fields via the column-name argument (e.g. `mustChangePassword: integer('must_change_password', ...)`). Not repeated per table below.

## 2. Soft-delete / lifecycle policy

- **Drinks**: **hard delete** (`DELETE FROM drinks WHERE id = ?`). Undo is client-driven, not server state: the client re-`POST`s the exact prior payload **with the same `id`** to recreate it (delete-undo) or re-`PUT`s the prior field values (edit-undo). Nothing on the server prevents reusing a `drinks.id` that was previously deleted — there is no tombstone. `edit_count` (see §5.7) persists across the delete→undo-reinsert cycle only if the client also resends it as part of the undo payload; otherwise it resets to 0 on reinsert. This is acceptable: undo is a few seconds after the action, blooper stats ("most-edited entry") are trip-wide fun stats, not audit-critical. All drink mutations (create/update/rating/delete) become read-only once `trips.ceremony_started_at` is set — `409 conflict` (`ceremony_started`), see `03`.
- **Users**: never hard-deleted. "Remove access" sets `disabled_at`; row, drinks, achievements and leaderboard entries all stay (D11).
- **Invites / password resets**: state machine columns (`state`, `used_at`), never deleted. Expired invites disappear from the People UI after 30 days but the row stays (audit trail of who invited whom).
- **Everything else** (venues, custom_drink_names, favourites, predictions, trips, trip_members, applied_ops): no delete endpoints in v1 except favourites (unfavourite = row delete, trivial blast radius) and invite revoke (state change, not delete).

## 3. Drizzle schema conventions

**One schema file per dialect** (`schema.sqlite.ts`, `schema.pg.ts`), not a dialect-agnostic builder — `sqlite-core` and `pg-core` diverge enough on primitive types (boolean, timestamp, jsonb, autoincrement) that a shared abstraction would fight the type system for marginal DRYness, and since Postgres is CI-smoke-only (D2) the duplication cost is low while dialect fidelity stays high.

- Location: `apps/server/src/db/schema.sqlite.ts`, `apps/server/src/db/schema.pg.ts`. Both export identically-named tables/types. **No runtime `schema.ts` re-export** — module graphs are static, so a single file can't conditionally re-export one of two dialect modules based on an env var read at import time. Instead `db/createDb.ts` exports `createDb(config)`, called once at boot (before `migrate()`): it branches on `DB_DRIVER` and returns a dialect-specific Drizzle instance plus repository factories closed over it. Routes/services receive `db`/repositories via DI (constructor arg or Fastify decoration), never a module-level singleton import — see `01` for the full boot sequence.
- `drizzle.config.ts` is parameterised by `DB_DRIVER` and points `schema` + migration `out` dir at the matching pair (`drizzle/sqlite/*`, `drizzle/pg/*`).
- A Vitest suite asserts both schema files declare the same table/column names (catches drift the type checker won't).

## 4. Migration strategy

- `drizzle-kit generate` (dev-time, dialect-specific) produces versioned SQL files checked into `drizzle/sqlite/` / `drizzle/pg/`.
- On server boot, before Fastify starts listening: run drizzle's `migrate()` for the active dialect against the matching folder. Drizzle's own `__drizzle_migrations` table (created per-dialect) is the applied-migrations ledger — `app_meta.schema_version` (below) is a human-readable mirror for `/readyz` (C14), not the source of truth.
- D14 (single instance) means no distributed migration lock is needed; migration runs once at process start, wrapped so a failure aborts boot rather than serving against a stale schema.
- Admin seeding (DESIGN_SPEC §7) runs immediately after migration, in one transaction: `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)` guards against double-seeding even under concurrent boots, belt-and-braces beyond the D14 single-instance assumption.

## 5. Tables

### 5.1 `users`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK, UUIDv7 |
| `email` | text | text | no | — | trimmed, lower-cased before write; **unique** |
| `password_hash` | text | text | no | — | Argon2id |
| `role` | text | text | no | `'member'` | `CHECK (role IN ('admin','member'))` |
| `display_name` | text | text | no | — | 1–24 chars (app-validated) |
| `must_change_password` | integer(bool) | boolean | no | `false` | true only for the seeded admin until first setup |
| `disabled_at` | integer | bigint | yes | `NULL` | "remove access" (D11); non-null blocks sign-in |
| `display_theme_pref` | text | text | no | `'system'` | `CHECK (display_theme_pref IN ('system','dark','light'))` |
| `invited_by` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL; copied from `invites.created_by` at invite acceptance (C3); `NULL` for the seeded admin and any admin-created account |
| `created_at` | integer | bigint | no | now | |
| `updated_at` | integer | bigint | no | now | |

**Indexes**: unique(`email`); partial unique index on `role` `WHERE role='admin'` — enforces at most one admin account (C3; "remove admin" isn't a v1 flow, so this can't be worked around by demoting first).

### 5.2 `sessions`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `token_hash` | text | text | no | — | sha256 of opaque token; **unique** |
| `created_at` | integer | bigint | no | now | |
| `expires_at` | integer | bigint | no | — | 90 days from creation, renewed on every use |
| `last_used_at` | integer | bigint | no | now | |
| `revoked_at` | integer | bigint | yes | `NULL` | set on sign-out, password change/reset (all-other-sessions), remove access — **soft-revoke** (C39); auth rejects any session where `revoked_at IS NOT NULL OR expires_at <= now`, row stays |
| `user_agent` | text | text | yes | `NULL` | diagnostic only |

**Indexes**: unique(`token_hash`), index(`user_id`), index(`expires_at`) (expiry sweep), index(`revoked_at`) (revocation sweep).

**Lifecycle (C39, canonical — one lifecycle for the whole doc set)**: revoke/expire never deletes a row immediately; the scheduler (same 15 s tick, `05` §4) deletes rows **30 days after** `expires_at` or `revoked_at` (whichever applies), mirroring the invite 30-day-hide pattern (C5). Until swept, a revoked/expired row simply fails the auth check above — its continued presence is not itself a security issue.

### 5.3 `invites`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `token_hash` | text | text | no | — | **unique** |
| `created_by` | text | text | no | — | FK → `users.id` (admin), ON DELETE RESTRICT |
| `name` | text | text | yes | `NULL` | invitee display name pre-fill |
| `trip_id` | text | text | yes | `NULL` | FK → `trips.id` ON DELETE CASCADE |
| `email` | text | text | yes | `NULL` | optional invite-by-email (D3) |
| `state` | text | text | no | `'pending'` | `CHECK (state IN ('pending','accepted','revoked'))` — **"expired" is derived** at read time (`state='pending' AND now > expires_at`), never written |
| `created_at` | integer | bigint | no | now | |
| `expires_at` | integer | bigint | no | `created_at + 7d` | |
| `accepted_by` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL |
| `accepted_at` | integer | bigint | yes | `NULL` | |

**Indexes**: unique(`token_hash`), index(`trip_id`), index(`created_by`), index(`state`, `expires_at`).

### 5.4 `password_resets`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `token_hash` | text | text | no | — | **unique** |
| `created_by` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL; `NULL` = self-serve forgot-password (D3), set = admin-issued (People sheet) |
| `created_at` | integer | bigint | no | now | |
| `expires_at` | integer | bigint | no | `created_at + 24h` | |
| `used_at` | integer | bigint | yes | `NULL` | valid = `used_at IS NULL AND now < expires_at` |

**Indexes**: unique(`token_hash`), index(`user_id`). **On create**: invalidate any other unexpired reset row for the same `user_id` by setting `used_at = now` — **never delete** (row stays, §2) — "creating a new one kills any earlier ones" (DESIGN_SPEC §7).

### 5.5 `trips`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `name` | text | text | no | — | |
| `start_date` | text | text | no | — | `'YYYY-MM-DD'`, trip-local |
| `end_date` | text | text | no | — | `'YYYY-MM-DD'`, trip-local |
| `timezone` | text | text | no | — | IANA tz name |
| `theme_id` | text | text | no | `'classic'` | not DB-enum (content-pack driven); app validates against loaded packs |
| `unlock_at` | integer | bigint | no | — | Wrapped unlock instant (UTC epoch ms) |
| `owner_id` | text | text | no | — | FK → `users.id` ON DELETE RESTRICT |
| `ceremony_started_at` | integer | bigint | yes | `NULL` | non-null ⇒ theme/unlock/name/dates become immutable |
| `final24h_marked_at` | integer | bigint | yes | `NULL` | scheduler idempotency marker, claimed via `UPDATE … WHERE final24h_marked_at IS NULL` (`05` §4); re-derived/cleared if owner moves `unlock_at` before ceremony (C26) |
| `wrapped_unlocked_marked_at` | integer | bigint | yes | `NULL` | same, for unlock transition; cleared if owner moves `unlock_at` later before ceremony (C26, `05` §3) |
| `data_revision` | integer | integer | no | `0` | incremented per the bump matrix below (C24, C37); a personal snapshot is stale when its `wrapped_snapshots.source_revision < trips.data_revision` |
| `created_at` | integer | bigint | no | now | anchors D10's predictions deadline |
| `updated_at` | integer | bigint | no | now | |

**Indexes**: index(`owner_id`).

**`data_revision` bump matrix (C37, canonical — exhaustive)**:

| Mutation | Bumps? |
|---|---|
| Drink create / update / delete / rate | Yes |
| Prediction submit (`PUT /predictions/me`) | Yes |
| Member insert (invite accept, admin add-to-trip) | Yes |
| Member disable (admin removes access) | Yes |
| Trip edit: `name`, `start_date`, `end_date`, `timezone`, `unlock_at` | Yes |
| Trip edit: `theme_id` | No |
| `trip_members.last_opened_at` bump | No |
| `trip_members.missed_banner_dismissed` | No |
| Favourites / custom drink names (account-global, C27) | No |
| `wrapped_views` watch/replay | No |

All "Yes" rows increment in the same transaction as the underlying write (C25).

### 5.6 `trip_members`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `color_index` | integer | integer | no | — | **unbounded** join ordinal (0, 1, 2, …) — assigned = current member count at join time, **never reassigned** even if earlier members are later disabled or the trip exceeds 10 members (C45); palette colour = `color_index % 10` into `color.members.palette` (10-colour palette), resolved client-side — not the raw column value |
| `joined_at` | integer | bigint | no | now | |
| `first_drink_at` | integer | bigint | yes | `NULL` | **immutable** once set (C35): server receipt time of this member's first successful drink create (any create — including via `/drinks/sync`), independent of `drunk_at`; a later delete/undo of that drink never clears it |
| `predictions_deadline_at` | integer | bigint | no | `max(trip.created_at, joined_at) + 24h` | immutable, set once at insert (D10 basis). **Effective window close** = `MIN(predictions_deadline_at, first_drink_at, trips.ceremony_started_at)`, computed at query time (`NULL` columns excluded from the `MIN`) — ceremony start force-closes every still-open window even if neither deadline nor first-drink has passed (C36); `packages/shared` exports the derivation fn shared by API and any background jobs. |
| `missed_banner_dismissed` | integer(bool) | boolean | no | `false` | "Missed" banner on Log home, dismissible after first view |
| `last_opened_at` | integer | bigint | yes | `NULL` | bumped on every app-shell load with this trip active; drives "last-opened trip" resume (no column needed on `users`) |

**Indexes**: unique(`trip_id`, `user_id`), index(`user_id`, `last_opened_at`).

### 5.7 `drinks`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK, **client-generated** UUIDv7 (idempotency key, D7) |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE RESTRICT |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `category` | text | text | no | — | `CHECK (category IN ('beer','wine','cocktail','spirit','shot','cider','seltzer','soft','other'))` |
| `drink_name` | text | text | no | — | |
| `size_ml` | integer | integer | no | — | `CHECK (size_ml > 0)` |
| `abv` | real | real | no | — | `CHECK (abv >= 0 AND abv <= 80)`; step precision enforced in Zod |
| `qty` | real | real | no | `1` | `CHECK (qty > 0)`; 0.5-step enforced in Zod |
| `drunk_at` | integer | bigint | no | now | user-facing "time" field, backdatable |
| `lat` | real | real | yes | `NULL` | |
| `lng` | real | real | yes | `NULL` | |
| `accuracy` | real | real | yes | `NULL` | metres |
| `altitude` | real | real | yes | `NULL` | metres; plane-detection input for `mile_high` achievement |
| `speed` | real | real | yes | `NULL` | m/s |
| `venue_id` | text | text | yes | `NULL` | FK → `venues.id` ON DELETE SET NULL |
| `venue_name` | text | text | yes | `NULL` | **snapshot** at log time — a later venue rename does not rewrite past drinks (DESIGN_SPEC §7: rename affects "this and subsequent" logs only) |
| `city` | text | text | yes | `NULL` | resolved from lat/lng via bundled GeoNames (D8) |
| `country_code` | text | text | yes | `NULL` | ISO 3166-1 alpha-2 |
| `rating` | integer | integer | yes | `NULL` | `CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)`; UI never offers rating for `category='soft'`, not DB-enforced |
| `note` | text | text | yes | `NULL` | `CHECK (note IS NULL OR length(note) <= 80)` |
| `created_at` | integer | bigint | no | now | row insert time (≠ `drunk_at`) |
| `updated_at` | integer | bigint | no | now | |
| `edit_count` | integer | integer | no | `0` | incremented on full edit (`PUT`), **not** on quick-rate (`PATCH .../rating`) — blooper stat "most-edited entry" |
| `last_edited_at` | integer | bigint | yes | `NULL` | set on full edit (`PUT`) **only**, same scope as `edit_count` — deliberately excludes `PATCH .../rating`, unlike `updated_at` (which any write bumps); tie-break for "most-edited entry" when `edit_count` ties (C46) — latest `last_edited_at` wins |

**Indexes**: index(`trip_id`, `drunk_at`) (feed/day grouping), index(`trip_id`, `user_id`, `drunk_at`), index(`user_id`, `category`, `drink_name`, `size_ml`) (recents/favourites dedup key), index(`trip_id`, `venue_id`).

### 5.8 `venues`

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE; venues are per-trip |
| `name` | text | text | no | — | user-renameable |
| `lat` | real | real | no | — | |
| `lng` | real | real | no | — | |
| `source` | text | text | no | — | `CHECK (source IN ('osm','user'))` |
| `osm_id` | text | text | yes | `NULL` | set when `source='osm'` |
| `created_at` | integer | bigint | no | now | |
| `updated_at` | integer | bigint | no | now | |

**Indexes**: index(`trip_id`), index(`trip_id`, `lat`, `lng`) (bounding-box pre-filter for nearest-venue lookup; haversine done in app — neither dialect has geo indexing in scope), partial unique `(trip_id, osm_id) WHERE osm_id IS NOT NULL` (C29) — DB-enforced dedup so two members independently confirming the same Overpass candidate near-simultaneously can't create two rows for the same OSM place in a trip; `source='user'` rows (`osm_id NULL`) are exempt and unconstrained by this index.

A row is created only for the `{id}` (existing) and `{candidate:{name,lat,lng,osmId}}` cases of the drink `venue` field (C29, `03` §11); a bare `{name}` (user-typed, no coordinates) never creates a `venues` row — it only sets `drinks.venue_name`, `venue_id` stays `NULL`. `lat`/`lng` stay `NOT NULL` because every persisted venue has one.

### 5.9 `custom_drink_names`

Per-user, per-category — **not trip-scoped** (a person's typed-in drink name is a personal habit that should follow them across trips).

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `category` | text | text | no | — | same CHECK domain as `drinks.category` |
| `name` | text | text | no | — | |
| `abv` | real | real | yes | `NULL` | last-used ABV, pre-fill |
| `created_at` | integer | bigint | no | now | |
| `last_used_at` | integer | bigint | no | now | bumped on every use; drives "shown first" ordering |

**Indexes**: unique(`user_id`, `category`, `name`).

### 5.10 `favourites`

Per-user — **not trip-scoped** (same reasoning as 5.9). Keyed by (category, drink, size) per DESIGN_SPEC §7.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `category` | text | text | no | — | |
| `drink_name` | text | text | no | — | |
| `size_ml` | integer | integer | no | — | |
| `abv` | real | real | no | — | snapshot, refreshed on re-favourite |
| `created_at` | integer | bigint | no | now | |

**Indexes**: unique(`user_id`, `category`, `drink_name`, `size_ml`).

### 5.11 `predictions`

One row per member per trip, created on first save (not on member join).

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `q1_my_total_std` | real | real | yes | `NULL` | |
| `q2_group_total_std` | real | real | yes | `NULL` | |
| `q3_top_member_id` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL |
| `q4_least_member_id` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL |
| `q5_top_drink` | text | text | yes | `NULL` | free text, not DB-enum |
| `q5_top_drink_category` | text | text | yes | `NULL` | `CHECK (q5_top_drink_category IN (same domain as drinks.category))` (C31); paired with `q5_top_drink` so Oracle scoring (`05`) can compare category, not just name |
| `locked_at` | integer | bigint | yes | `NULL` | non-null = submitted/locked; "missed" = `NULL` row (or no row) past the effective window close (§5.6) |
| `created_at` | integer | bigint | no | now | |
| `updated_at` | integer | bigint | no | now | |

**Indexes**: unique(`trip_id`, `user_id`).

### 5.12 `achievement_unlocks`

Group achievements (currently only `century`) are modelled explicitly via `user_id = NULL`.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `user_id` | text | text | yes | `NULL` | FK → `users.id` ON DELETE CASCADE; `NULL` = group-level (e.g. `century`) — **who the unlock belongs to** |
| `triggered_by_user_id` | text | text | no | — | FK → `users.id` ON DELETE RESTRICT (C42); **always set**, incl. for group unlocks — the member whose action (the triggering drink log) caused the unlock, e.g. who logged the drink that tipped the group over `century`; distinct from `user_id` |
| `achievement_key` | text | text | no | — | not DB-enum; validated against the theme-independent achievement key set (11 in v1) |
| `drink_id` | text | text | yes | `NULL` | FK → `drinks.id` ON DELETE SET NULL — **kept nullable on delete** so removing the triggering drink never revokes an already-announced achievement (DESIGN_SPEC §7) |
| `vars` | json | jsonb | no | `'{}'` | template placeholders for the achievement's copy (e.g. `{n}`, `{venue}`) (C42) — raw values only, no resolved text (README §4); client substitutes into the theme pack's write-up template |
| `unlocked_at` | integer | bigint | no | now | |

**Indexes**:
- Partial unique `(trip_id, user_id, achievement_key) WHERE user_id IS NOT NULL` — one unlock per member per trip per key.
- Partial unique `(trip_id, achievement_key) WHERE user_id IS NULL` — one group unlock per trip per key.
- index(`trip_id`, `unlocked_at`) — "just unlocked / highlights" feed.

### 5.13 `wrapped_views`

Tracks Personal Wrapped watch state (used for the owner's "{n} of {total} have watched their own" count).

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `watched_at` | integer | bigint | yes | `NULL` | first watch |
| `last_viewed_at` | integer | bigint | yes | `NULL` | |
| `view_count` | integer | integer | no | `0` | includes replays |

**Indexes**: unique(`trip_id`, `user_id`).

### 5.14 `ceremony_state`

Singleton per trip; drives the presenter/cast-mode advance.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE; **unique** |
| `status` | text | text | no | `'not_started'` | `CHECK (status IN ('not_started','running','ended'))` |
| `current_card_index` | integer | integer | no | `0` | 0-based, 0–10 (11 Squad cards) (C18) |
| `sub_step` | integer | integer | no | `0` | for cards with reveal sub-steps (e.g. leaderboard reverse-reveal, §6.10 card 10) |
| `held` | integer(bool) | boolean | no | `false` | presenter "Hold" — pauses **in-card timers only** (count-ups, replay playback); V1 has no auto-advance between cards/subSteps, so the owner's manual `next`/`back` always executes regardless of `held` (`03` §17.1) |
| `started_by` | text | text | yes | `NULL` | FK → `users.id` ON DELETE SET NULL |
| `started_at` | integer | bigint | yes | `NULL` | |
| `updated_at` | integer | bigint | no | now | bumped on every advance/hold — clients can diff against this over SSE |

**Indexes**: unique(`trip_id`).

### 5.15 `wrapped_snapshots`

Precomputed, versioned payloads — frozen at compute time so the story doesn't shift under a user mid-scroll, and replayable later (§06). `user_id = NULL` is the Squad snapshot.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `user_id` | text | text | yes | `NULL` | FK → `users.id` ON DELETE CASCADE; `NULL` = Squad Wrapped |
| `payload` | json | jsonb | no | — | shape defined in `06-metrics-wrapped.md`; card data + metric values, **not** labels (labels resolved client-side from the theme pack, README §4); carries its own `payload.schemaVersion` (payload-shape version) — independent of `revision` below (C24) |
| `revision` | integer | integer | no | `1` | recompute counter: bumped on formula change, manual regen, or (personal only, pre-ceremony) a stale recompute; latest = `MAX(revision)` for the pair |
| `source_revision` | integer | integer | no | — | snapshot of `trips.data_revision` at compute time (C24); personal snapshot is stale when `source_revision < trips.data_revision` (`06` §8) |
| `computed_at` | integer | bigint | no | now | |

**Indexes**:
- Partial unique `(trip_id, user_id, revision) WHERE user_id IS NOT NULL`.
- Partial unique `(trip_id, revision) WHERE user_id IS NULL`.
- index(`trip_id`, `user_id`, `revision` DESC) for "fetch latest".

> Two partial indexes are required instead of one plain unique because SQL treats `NULL <> NULL`, so a single `unique(trip_id, user_id, revision)` would let multiple Squad rows (`user_id NULL`) collide silently.

### 5.16 `rate_limit_events` (not created in v1)

D14 uses an in-memory limiter for the single-instance deployment; this table is **not migrated in v1**. Schema kept here only because README §4 names it as a shared contract — implement verbatim if/when a multi-instance deployment needs a shared limiter.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | text | text | no | — | PK |
| `scope` | text | text | no | — | e.g. `sign_in:email:<lower-email>`, `sign_in:ip:<ip>`, `token_lookup:ip:<ip>` |
| `occurred_at` | integer | bigint | no | now | |

**Indexes** (if enabled): index(`scope`, `occurred_at`).

### 5.17 `app_meta`

Singleton key-value table.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `key` | text | text | no | — | PK, e.g. `'schema_version'`, `'admin_seeded'` |
| `value` | text | text | no | — | |
| `updated_at` | integer | bigint | no | now | |

### 5.18 `applied_ops`

Op-idempotency ledger (C34) for the offline sync queue — the write-side counterpart to the `drinks.id` create-dedup rule (§2), keyed by the client-minted `clientOpId` rather than `drinkId`. `clientOpId ≠ drinkId`, always.

| Column | SQLite | Postgres | Null | Default | Notes |
|---|---|---|---|---|---|
| `client_op_id` | text | text | no | — | PK, client-generated opaque string (not a UUIDv7 requirement) |
| `user_id` | text | text | no | — | FK → `users.id` ON DELETE CASCADE |
| `trip_id` | text | text | no | — | FK → `trips.id` ON DELETE CASCADE |
| `drink_id` | text | text | no | — | the op's target `drinks.id`; **not** a FK — the row may since have been hard-deleted (§2) |
| `type` | text | text | no | — | `CHECK (type IN ('create','update','delete','rate'))` |
| `status_code` | integer | integer | no | — | HTTP status of the original response |
| `response` | json | jsonb | no | — | the original response body, replayed verbatim on a repeat `client_op_id` |
| `applied_at` | integer | bigint | no | now | |

**Indexes**: index(`trip_id`, `user_id`, `applied_at`) (diagnostics; no TTL/cleanup job in v1 — row count is bounded by trip activity).

Written in the **same transaction** as the op it records (C25, C34). A replayed `client_op_id` short-circuits before any business logic and returns the stored `(status_code, response)` unchanged — no re-validation, no re-check of `ceremony_started_at`, no re-run of achievement evaluation. Undo is never a lookup against this table by the original op's key — undo is always a **new** op with a **new** `client_op_id` (C34, `03` §1.3).

## 6. SQLite pragmas

Set on every new `better-sqlite3` connection, before any query runs:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;      -- OFF by default per-connection; required for all ON DELETE behaviour above
PRAGMA busy_timeout = 5000;    -- ms; absorbs the single-writer WAL contention under D14
PRAGMA synchronous = NORMAL;   -- safe + fast pairing with WAL
```

## 7. SQLite → Postgres differences to handle

| Concern | SQLite | Postgres | Handling |
|---|---|---|---|
| Booleans | `INTEGER` 0/1 | native `BOOLEAN` | Drizzle `{mode:'boolean'}` hides it; never compare raw ints in hand-written SQL |
| Timestamps | `INTEGER` epoch ms | `BIGINT` epoch ms (not native `timestamp`) | deliberate — see §1 |
| JSON | `TEXT` (+ `{mode:'json'}`) | `jsonb` | transparent via Drizzle; don't hand-roll `JSON.stringify` outside the schema layer |
| Partial/filtered unique indexes | supported (`CREATE UNIQUE INDEX ... WHERE ...`) | supported | used for `users` (admin), `venues` (`trip_id, osm_id`, C29), `achievement_unlocks`, `wrapped_snapshots`; verify the Drizzle version in use supports `.where()` on both dialect index builders before relying on it in migrations |
| Foreign keys | **off by default per connection** | always enforced | pragma in §6; a missed pragma silently disables every `ON DELETE` rule |
| Case-insensitive email uniqueness | no `CITEXT`, default collation is binary | has `CITEXT` (extension) | don't rely on either — always lower-case in the app before every read/write touching `users.email` |
| Concurrency | single-writer (WAL allows N readers + 1 writer) | full MVCC, many concurrent writers | keep write transactions short (esp. drink create + achievement evaluation) so SQLite doesn't serialize the whole trip under load |
| Autoincrement / serial PKs | N/A — all PKs are app-generated UUIDv7 text | N/A | no divergence, by design (README §4) |
| `CHECK` constraints | supported | supported | identical syntax used in both schema files; no divergence expected |

## 8. ER diagram

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ invites : "created_by"
    users ||--o{ invites : "accepted_by"
    users ||--o{ password_resets : "requested / issued for"
    users ||--o{ trips : "owns"
    users ||--o{ trip_members : "member via"
    trips ||--o{ trip_members : "has"
    trips ||--o{ drinks : "scopes"
    users ||--o{ drinks : "logs"
    trips ||--o{ venues : "scopes"
    venues ||--o{ drinks : "tagged with"
    users ||--o{ custom_drink_names : "owns"
    users ||--o{ favourites : "owns"
    trips ||--o{ predictions : "scopes"
    users ||--o{ predictions : "answers"
    trips ||--o{ achievement_unlocks : "scopes"
    users ||--o{ achievement_unlocks : "earns (nullable = group)"
    users ||--o{ achievement_unlocks : "triggered_by (always set)"
    drinks ||--o{ achievement_unlocks : "triggers (nullable on delete)"
    trips ||--o{ wrapped_views : "scopes"
    users ||--o{ wrapped_views : "watches"
    trips ||--|| ceremony_state : "has one"
    users ||--o{ ceremony_state : "started_by"
    trips ||--o{ wrapped_snapshots : "scopes"
    users ||--o{ wrapped_snapshots : "personal (nullable = squad)"
    trips ||--o{ applied_ops : "scopes"
    users ||--o{ applied_ops : "performs"

    users {
        text id PK
        text email UK
        text role
        boolean must_change_password
        integer disabled_at
    }
    trips {
        text id PK
        text name
        text theme_id
        integer unlock_at
        text owner_id FK
        integer ceremony_started_at
        integer data_revision
    }
    trip_members {
        text id PK
        text trip_id FK
        text user_id FK
        integer color_index "unbounded ordinal, palette = %10"
        integer first_drink_at
        integer predictions_deadline_at
    }
    drinks {
        text id PK "client uuidv7"
        text trip_id FK
        text user_id FK
        text category
        integer size_ml
        real abv
        real qty
        integer drunk_at
        text venue_id FK
        integer edit_count
        integer last_edited_at
    }
    venues {
        text id PK
        text trip_id FK
        text source
        text osm_id "partial unique w/ trip_id"
    }
    predictions {
        text id PK
        text trip_id FK
        text user_id FK
        integer locked_at
    }
    achievement_unlocks {
        text id PK
        text trip_id FK
        text user_id FK "nullable = group"
        text triggered_by_user_id FK "always set"
        text achievement_key
        text drink_id FK
        json vars
    }
    wrapped_snapshots {
        text id PK
        text trip_id FK
        text user_id FK "nullable = squad"
        integer revision
        integer source_revision
    }
    ceremony_state {
        text id PK
        text trip_id FK UK
        text status
        integer current_card_index
    }
    applied_ops {
        text client_op_id PK
        text trip_id FK
        text user_id FK
        text drink_id
        text type
        integer status_code
    }
```
