# Drunkify V1 — Engineering Handoff

Build spec for an implementation agent. Self-hosted, mobile-first PWA for a friend group's trip drink log + end-of-trip "Wrapped".

Design source of truth: `design/` (copied verbatim from the design handoff). Where engineering docs and `design/DESIGN_SPEC.md` disagree, **these docs win** (only on the points listed in §2); otherwise the design spec wins on look/copy/behaviour.

## 1. Read order

| # | File | Scope |
|---|---|---|
| 0 | `README.md` | Decisions, stack, shared contracts (this file) |
| 1 | `01-architecture.md` | Repo layout, runtime, config/env, Docker, ops, backups |
| 2 | `02-data-model.md` | Tables, columns, indexes, migrations, SQLite→Postgres |
| 3 | `03-api.md` | REST endpoints, SSE events, error format |
| 4 | `04-auth-accounts.md` | Admin seed, sessions, invites, resets, mailer, rate limits |
| 5 | `05-domain-logic.md` | Trip phases, logging, venues/geo, predictions, achievements, masking, offline sync |
| 6 | `06-metrics-wrapped.md` | Metrics formulas, ranks, archetypes, awards, Wrapped card payloads, replay |
| 7 | `07-frontend.md` | Routes, state, components, content packs, tokens, PWA, a11y |
| 8 | `08-milestones-testing.md` | Build order, acceptance criteria, test plan |
| — | `content-additions/` | Exact copy for new content keys (deep-merge into `packages/content` at M0) |
| — | `design/` | Design spec, prototype, screenshots, tokens, theme packs, catalog, icons |

## 2. Decisions (override design spec)

| # | Decision | Overrides |
|---|---|---|
| D1 | **Web app (PWA) only**, mobile-first. No native app. Sessions = HttpOnly cookie. "Keychain/Keystore", "universal links" → N/A. | DS §6.13.5, §7 Sessions |
| D2 | **SQLite (v1 default)**; Postgres supported via `DB_DRIVER=postgres` but not a v1 test target beyond CI smoke. | — |
| D3 | **Mailer**: `MAILER=log` (default, prints email to stdout) or `MAILER=smtp`. Sends: (a) self-serve **forgot-password** reset link, (b) optional **invite email** from Invite sheet. Share link / QR flows unchanged. | DS §2 #10, §6.13.3 "Forgot password?" sheet, §10 Q7 |
| D4 | **Web Push deferred (V1.1).** All "push notification" moments become in-app (SSE-driven toast/state change while open; badge on next open). | DS §6.13.6, §6.13.8, §6.9 |
| D5 | **Phone-as-remote casting deferred (V1.1).** V1 ceremony = owner opens Squad Wrapped on any big-screen browser (laptop→TV); **big-screen layout** (16:9, vw units) with keyboard/click/tap advance. Presenter remote screen (`23`) not built; "Show on a TV first" → opens `/t/:tripId/ceremony?display=big` + copyable URL. | DS §6.10 |
| D6 | **Replay video export deferred (V1.1).** Replay plays in-app only. | DS §6.11 |
| D7 | **Offline log queue in V1**: service worker + IndexedDB; client-generated UUIDs; idempotent create. | DS §7 "Session lost" |
| D8 | **Geo is pluggable & self-host friendly**: city/country via bundled offline GeoNames dataset; venue suggestion via configurable Overpass endpoint (`GEO_VENUE_PROVIDER=overpass|none`); map tiles via configurable MapLibre style URL (`MAP_STYLE_URL`). | — |
| D9 | **Trip creation**: admin-only, simple form (name, start/end date, timezone, theme, unlock time). Creator = owner. | DS §10 Q13 |
| D10 | **Predictions window per member**: closes at `min(first_drink_at, max(tripCreatedAt, joinedAt) + 24h, ceremony_started_at)` (C35, C36). | DS §10 Q9 |
| D11 | **Removed users**: data stays; still in metrics, leaderboards and awards; can't sign in. | DS §10 Q12 |
| D12 | **Artwork**: one neutral set (bolt badge, text rank badge). | DS §10 Q1 |
| D13 | Realtime via **SSE**, single-instance in-memory event bus (Postgres LISTEN/NOTIFY = future). | — |
| D14 | **Single instance** assumption for v1 (in-process scheduler, in-memory rate limiter + bus). | — |

## 3. Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere, Node 22 LTS |
| Monorepo | pnpm workspaces |
| Frontend | Vite + React 19, React Router, TanStack Query, Zustand (UI state), vite-plugin-pwa (Workbox), MapLibre GL JS, idb |
| Styling | CSS Modules + CSS custom properties generated from `design/tokens.json` |
| Backend | Fastify 5, Zod (validation, shared schemas), `@node-rs/argon2`, nodemailer |
| ORM | Drizzle ORM + drizzle-kit migrations; `better-sqlite3` (default) / `postgres` (pg) |
| Tests | Vitest (unit/integration), Playwright (e2e, mobile viewport 390×844) |
| Packaging | Single Docker image; Fastify serves API + built SPA; volume `/data` |

## 4. Shared contracts (all docs must match)

**Packages**: `apps/web`, `apps/server`, `packages/shared` (Zod schemas, types, pure domain fns: std drinks, ABV slider, phase calc, metrics), `packages/content` (tokens, packs, catalog, auth copy — copied from `design/`).

**Tables** (names fixed; columns in `02`):
`users`, `sessions`, `invites`, `password_resets`, `trips`, `trip_members`, `drinks`, `custom_drink_names`, `favourites`, `venues`, `predictions`, `achievement_unlocks`, `wrapped_views`, `ceremony_state`, `wrapped_snapshots`, `applied_ops`, `rate_limit_events` (spec only, not migrated in v1), `app_meta`.

**IDs**: UUIDv7 strings (text) for all PKs. Drinks: client-generated UUIDv7 (idempotency key).
**Time**: store UTC epoch ms (`integer`/`bigint`); trip has IANA `timezone`; "day N" computed in trip tz, day boundary at **06:00 local** (a 2 a.m. drink belongs to the previous night).
**Money/units**: ml as integer, ABV as `real` percent (one decimal ≤15, 0.5 steps above), qty as `real` (0.5 steps).
**API**: JSON REST under `/api/v1`, cookie session, CSRF via `SameSite=Lax` + required `X-Requested-With: drunkify` header on mutations. SSE channels per C13.
**Errors**: `{ "error": { "code": "snake_case", "message": "…", "fields"?: {field: code}, "retryAfter"?: seconds } }`.
**Theme labels are never stored**: server stores keys (`achievement_key`, `award_key`, `archetype_key`) and raw values (`stdPerDay`, C43); client resolves labels/bands from pack.

## 5. Canonical names & resolved conflicts (binding for all docs)

| # | Topic | Canonical |
|---|---|---|
| C1 | Session cookie | `drunkify_session` (`SESSION_COOKIE_NAME` default) |
| C2 | Trip phase | `TripPhase = 'live' \| 'final_24h' \| 'wrapped_unlocked' \| 'ceremony'`. Prediction window is per-member state, **not** a phase. |
| C3 | Admin flag | `users.role IN ('admin','member')` + partial unique index `WHERE role='admin'`. Removal = `users.disabled_at`. `users.invited_by` (nullable FK) copied at invite acceptance. |
| C4 | Column names | `sessions.last_used_at`; `password_resets.created_by` (NULL = self-serve forgot-password) |
| C5 | Invite rows | Never deleted. Hidden in People 30 days after expiry. `expired` derived, never stored. |
| C6 | Drinks delete | Hard delete. No `deleted_at`, no `logged_at` (`created_at` = log time). `drunk_at` authoritative for all metrics/order. |
| C7 | Predictions | Columns `q1_my_total_std, q2_group_total_std, q3_top_member_id, q4_least_member_id, q5_top_drink (drink name), locked_at`. Missed-card dismiss → `trip_members.missed_banner_dismissed` via `POST /trips/:tripId/predictions/me/dismiss-missed`. |
| C8 | Predictions visibility | Only inside the Squad payload, served once `trips.ceremony_started_at` is set. No card-index gate column. |
| C9 | Formula owners | Drink Rating 2.0 → `06` (§ Drink Rating). Oracle scoring → `05` (§ Predictions). The other doc links; never redefines. |
| C10 | Venue rename | Updates shared `venues.name` (future logs, all members); past drinks keep `drinks.venue_name` snapshot. |
| C11 | Wrapped snapshots | Personal: computed by scheduler at `unlock_at`; any drink/prediction mutation before ceremony start marks trip's personal snapshots stale → recomputed lazily on next GET (new `revision`, C24). Squad: computed at ceremony start, frozen. Drinks read-only after `ceremony_started_at`. |
| C12 | Endpoints | `03-api.md` is canonical. Replay data lives inside the Squad payload (card 6). |
| C13 | SSE | Channels: `/trips/:tripId/events`, `/me/events`, `/admin/events`. Events per `03` §20 + `member.removed` (trip) + `hello {serverTime}` on connect. Ceremony events: `ceremony.started`, `ceremony.step`. No replay buffer: refetch on reconnect. |
| C14 | Health | `GET /healthz` (liveness), `GET /readyz` (DB check), outside `/api/v1`. |
| C15 | Paths/CLI | Common-password list `apps/server/assets/common-passwords-10k.txt`. CLI `drunkify` (`admin reset-link`, `admin set-email`, `db migrate`, `db backup <path>`), run via `docker compose exec app-prod drunkify …` (or `app-local`). |
| C16 | Leaderboard payload | Server returns all values per row `{std, drinks, k, a, d, rating}`; client picks columns from pack `leaderboard.columns`. No labels from server. Masked: `rank` and `values` = null. |
| C17 | Disabled sign-in | Wrong password → generic `bad_credentials`. Correct password + disabled → `403 account_disabled`. |
| C18 | Ceremony index | `ceremony_state.current_card_index` 0-based (0–10). |
| C19 | Wire time format | All instants on the wire = epoch ms `number` (incl. `serverTime`). Calendar dates (`startDate`, `endDate`) = `'YYYY-MM-DD'`. |

| C20 | Final-24h masking | **Suspense, not secrecy.** Leaderboard/side-board/dashboard endpoints omit per-member comparative values and order; Feed still shows everyone's drinks (per design), so ranks are reconstructable by a determined user. No confidentiality guarantee is claimed. |
| C21 | Drink counts | All user-facing "drinks" counts = `Σ qty` (half quantities count 0.5), incl. `century` (≥100). |
| C22 | Rank denominator | `rankDays = clamp(elapsedTripDays(snapshotAt), 1, tripLengthDays(startDate, endDate))`. |
| C23 | Ranking | One shared `rankMembers()` in `packages/shared` (tie-breaks: value desc → Σqty desc → earliest `joined_at` → `user_id`) used by live board and Wrapped. |
| C24 | Snapshot storage | Payloads store keys, indexes and raw values only (no labels, write-ups, rank names). Column `wrapped_snapshots.revision` (recompute counter) + `source_revision`; `payload.schemaVersion` separate. `trips.data_revision` increments on every drink/prediction/membership mutation; a personal snapshot is stale when `source_revision < trips.data_revision`. |
| C25 | Transactions | Drink create/update + achievement evaluation/persist: one transaction (SQLite `BEGIN IMMEDIATE`). Same for: invite acceptance, prediction submit (rechecks window vs first drink), ceremony start (set `ceremony_started_at` + squad snapshot + `ceremony_state`). SSE emitted **after** commit. |
| C26 | Scheduler | Tick every **15 s**. Transition marker written in the same transaction as the snapshot work (never before). Boot backfills missing personal snapshots for unlocked trips. Moving `unlock_at` (pre-ceremony) re-derives/clears both markers. |
| C27 | Mutation matrix | After `ceremony_started_at`: drink create/update/delete/rate → `409 conflict {code: ceremony_started}`. Rating a `soft` drink → `422 validation_failed`. Favourites/custom names are account-global and never frozen. |
| C28 | Offline outbox | Single owner = app code (IndexedDB outbox, flushed via `POST /trips/:tripId/drinks/sync`). Workbox never replays mutations and never caches authenticated API responses. Op shape: `{clientOpId, tripId, type:'create'\|'update'\|'delete'\|'rate', drinkId, payload?, clientNowMs, userId}`. |
| C29 | Venues on the wire | `GET venues/suggest` → `{kind:'existing', venue} \| {kind:'candidate', name, lat, lng, osmId} \| {kind:'none'}`. Drink create/update `venue` field: `{id} \| {candidate:{name,lat,lng,osmId}} \| {name}` (user-typed) `\| null` (skipped). Server upserts venue in the drink transaction. |
| C30 | Recents | `GET /trips/:tripId/drinks/recents` → `{lastDrink, lastByCategory: Record<Category, Drink>, items}` (items = C-deduped, favourites first, cap 12). |
| C31 | Predictions | Add `predictions.q5_top_drink_category`. `GET /predictions/me` returns `answers: null` always before ceremony. |
| C32 | No-trip user | `/me/events` carries `trip.added {tripId}` (user added to a trip) → client refetches bootstrap. |
| C33 | Day index / DST | Day = `PlainDate(ZonedDateTime(instant, tz).toPlainDateTime().subtract({hours: 6}))`; index = days since `start_date` + 1. Use `@js-temporal/polyfill`. DST tests required. |

| C34 | Op idempotency | New table `applied_ops (client_op_id PK, user_id, trip_id, drink_id, type, status_code, response json, applied_at)` written in the same txn as the op. Replayed `clientOpId` → stored response. `clientOpId` ≠ `drinkId`. Undo = a new op with a new `clientOpId`. |
| C35 | First drink | `trip_members.first_drink_at` (immutable, server receipt time of first successful create). Deletes never clear it. Prediction window uses it. |
| C36 | Ceremony freeze | After `ceremony_started_at`: no membership adds (`409 ceremony_started`); an invite for that trip still creates the account but skips the join (`trip: null`). Prediction windows are closed. |
| C37 | `data_revision` bumps | Drink create/update/delete/rate; prediction submit; member insert or disable; trip `name/start_date/end_date/timezone/unlock_at` edits. Not: `last_opened_at`, dismissals, theme, favourites. |
| C38 | Stale personal snapshot | `GET wrapped/personal` recomputes synchronously in-request when stale (budget < 1 s), commits new revision, then responds. No background job. |
| C39 | Sessions | Soft-revoke via `sessions.revoked_at`; auth rejects revoked/expired. Scheduler deletes rows 30 days after expiry/revocation. |
| C40 | Invite reissue | Allowed when `state IN ('pending','revoked')` (→ `pending`, new hash, new expiry). `accepted` → `409 conflict`. |
| C41 | Token status matrix | Lookups (`GET invites/lookup/:token`, `GET auth/reset-password/:token`) always `200` with either data or `LinkProblem {kind}`. Consuming endpoints: unknown → `404 invalid_token`; expired → `410 token_expired`; used → `410 token_used`; revoked → `410 token_revoked`. Rate limit → `429`. |
| C42 | Achievements DTO | `AchievementUnlock {key, userId\|null, triggeredByUserId, tripId, drinkId\|null, unlockedAt, vars}`. Columns `achievement_unlocks.triggered_by_user_id` (not null) + `vars` (json: e.g. `{n}`, `{venue}`). |
| C43 | Rank in snapshots | Store raw `stdPerDay`; band resolved client-side from pack (10 vs 18 bands). |
| C44 | Σqty scope | Also CS2 A and D, brand loyalty, adventurousness counts. |
| C45 | Member colour | `trip_members.color_index` = unbounded join ordinal; palette colour = `color_index % 10`. |
| C46 | Most-edited | `drinks.last_edited_at` set on `PUT` only; tie-break for blooper "most-edited". |
| C47 | Outbox triggers | Enqueue on network error **and** on `401`; keep under original `userId`; flush only after same user re-auths. |
| C48 | Content copy | Exact copy for every added key lives in `content-additions/{classic,cs2,auth}.json` (merge into `packages/content` at M0). |

### 5.1 Content additions (live in `packages/content`; `design/` stays untouched)

Exact copy: `content-additions/` (C48). Numeric data files (`prices.json`, `comparisons.json` constants) specified in `06`.

| File | Keys | Owner doc |
|---|---|---|
| `themes/{classic,cs2}.json` | `toasts.offlineSaved` | `07` |
| `themes/{classic,cs2}.json` | Wrapped fallback variants + verdicts + absurd-unit labels: `wrappedPersonal.cards.{02_absurd_units.empty, 04_abv_share.empty, 06_trail.empty, 07_top_then_guilty.noGuilty, 08_loyal_or_adventurous.verdict.{loyal,adventurous}, 14_archetype.noPartner}`, `comparisons.absurdUnits.{bathtub,olympic_pool,pub_keg,tanker_truck,fire_hydrant}.label`, `wrappedSquad.cards.{02_drunk_o_meter.empty, 04_cities_venues.empty, 05_crowd_then_divisive.noCrowd, 05_crowd_then_divisive.noDivisive, 06_replay.empty, 08_predictions.empty}` | `06` §9.4, §13 |
| `auth.json` | `signIn.forgotSheet.*`, `email.forgotPassword.*`, `email.invite.*`, `inviteSheet.emailLabel`, `inviteSheet.emailSent` | `04` |
| `prices.json` (new) | currency, per-category price, GDP comparison | `06` |
| `comparisons.json` (new) | absurd-unit constants, liver-miles reference distances | `06` |

## 6. Out of scope (V1)
Web push · phone remote/cast pairing · replay video export · passkeys · multi-admin · group invite links · AI content (product spec §14) · per-theme artwork · i18n.
