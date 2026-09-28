# 08 — Milestones & Testing

Each milestone = one buildable slice, roughly PR-sized to several PRs. Build in order; later milestones assume earlier DoD is met.

## 1. Milestones

### M0 — Scaffolding, CI, Docker
- Scope: pnpm workspace (`apps/web`, `apps/server`, `packages/shared`, `packages/content`); TS strict configs; ESLint/Prettier + import-boundary rule (`01-architecture.md §3`); Fastify skeleton with `/healthz`; Vite skeleton; Dockerfile + compose; GitHub Actions skeleton (lint/typecheck only); merge `content-additions/{classic,cs2,auth}.json` into `packages/content` (README §5.1, C48).
- Deps: none.
- Docs: `01-architecture.md` (repo layout, Docker, config), README §5.1.
- DoD:
  - `pnpm build` succeeds for all 4 packages from a clean checkout.
  - `docker buildx build --platform linux/amd64,linux/arm64 .` succeeds.
  - `docker compose --profile local up` (plain HTTP, port 3000) and `docker compose --profile prod up` (Caddy/TLS) both boot and pass `GET /healthz`.
  - `GET /healthz` → 200 in the built image.
  - CI green on lint + typecheck.
  - **Content additions merged (C48)**: every key listed in README §5.1 exists in `packages/content/{themes/classic.json, themes/cs2.json, auth.json}` from this milestone on — no later milestone introduces a new content key outside this merge; `pnpm content:check` (§3.4 of `07-frontend.md`) passes.

### M1 — DB schema, auth, admin seed, sessions
- Scope: Drizzle schema for `users`, `sessions`, `app_meta`; `DB_DRIVER` switch (SQLite default); migrations (`drunkify db migrate` CLI, C15); admin seed-on-boot; argon2 password hashing; session cookie issue/verify middleware; `config.ts` Zod validation (fail fast).
- Deps: M0.
- Docs: `01-architecture.md §5, §10`, `02-data-model.md`, `04-auth-accounts.md`.
- DoD:
  - Fresh boot with no users + `ADMIN_EMAIL` set creates exactly one admin with `mustChangePassword=true`; second concurrent boot (two processes racing against the same empty DB) creates exactly one admin, no duplicate/crash (**seed idempotency** — test via a unique constraint + `INSERT ... ON CONFLICT DO NOTHING`/transaction, verified with a concurrency test spawning boot logic twice against one DB file).
  - `ADMIN_PASSWORD` unset → 20-char random OTP printed exactly once to log, never persisted in plaintext.
  - Session cookie: `HttpOnly`, `Secure` (unless `COOKIE_SECURE=false`), `SameSite=Lax`, 90-day expiry renewed on use.
  - `GET /readyz` returns 200 once migrations have run and a DB check succeeds; `/healthz` (liveness) and `/readyz` (DB check) both sit outside `/api/v1` (C14).
  - Postgres CI smoke job passes migrations + seed against `DB_DRIVER=postgres`.

### M2 — Invites, People, reset, mailer
- Scope: invite token issue/accept (atomic), password reset token issue/consume, `mailer` interface (`log`/`smtp`), People admin screens' API, rate limiting on auth endpoints, `drunkify admin reset-link` / `drunkify admin set-email` CLI (both run via `docker compose exec app-prod drunkify …`, C15).
- Deps: M1.
- Docs: `04-auth-accounts.md`, DS §6.13.5–§6.13.12.
- DoD:
  - **Invite atomicity**: concurrent accept requests for the same token, serialized under SQLite `BEGIN IMMEDIATE` (Postgres: row lock, C25) → exactly one succeeds (200 + session), all others get `token_used` (409, per `03-api.md` §5 — not `invite_already_used`); verified with a test firing N parallel accepts against one token and asserting exactly 1 success (DB-level lock, not app-level check-then-act).
  - Invite expires at 7 days, reset at 24 h; creating a new reset token invalidates prior ones for that user (single active token, enforced at write time).
  - Sign-in: 5 failures / 15 min per email AND per IP → 429 with `retryAfter` seconds.
  - Remove access: ends all sessions, kills pending resets, blocks future sign-in — verified end-to-end (login attempt after removal → 401).
  - `MAILER=log` prints the reset/invite link to stdout in dev; `MAILER=smtp` sends via nodemailer (tested against a local smtp4dev/maildev container in CI, not real SMTP).
  - **Log token redaction**: invite/reset token path segments never appear verbatim in access or application logs — regex-scan test over captured log lines for issued tokens.
  - **Session cleanup (C39)**: sessions are soft-revoked (`sessions.revoked_at` set), never hard-deleted at revoke time, and auth rejects a revoked or expired session immediately; a scheduler job hard-deletes session rows 30 days after expiry/revocation. Test seeds a revoked session younger than 30 days (row still present, auth still rejects it) and one older than 30 days (scheduler deletes it on next tick).
  - **Token status matrix (C41)**: `GET invites/lookup/:token` and `GET auth/reset-password/:token` always return `200` with either data or `LinkProblem{kind}`; the consuming endpoints (accept/consume) return `404 invalid_token` (unknown), `410 token_expired`, `410 token_used`, `410 token_revoked`, and `429` when rate-limited — table-driven test covers all five outcomes for both invite and reset tokens.

### M3 — Trips, members, switcher, create trip
- Scope: `trips`, `trip_members` schema; admin-only create-trip form API; trip switcher list API; join-via-invite membership creation (avatar colour = next in join order); phase field skeleton (values only, no transition logic yet — that's M5).
- Deps: M1, M2.
- Docs: `02-data-model.md`, `03-api.md`, DS §6.13.9, README D9.
- DoD:
  - Creating a trip sets creator as owner; trip appears in switcher for owner only until members join.
  - Join order strictly increasing per trip; `trip_members.color_index` is an unbounded join ordinal (never capped at the 10-colour palette size) — rendered colour = `color_index % 10` (C45). Test joins 13 members and asserts colours wrap (the 11th member matches the 1st member's colour) rather than erroring, truncating, or reusing a colour out of order.
  - `/api/v1/trips` list scoped to caller's memberships only (no cross-trip leakage), verified by an authz test with two trips/two users.

### M4 — Log wizard, drinks API, recents/favourites, venues/geo
- Scope: `drinks`, `custom_drink_names`, `favourites`, `venues` schema; log/edit/delete drink endpoints (client-UUIDv7 idempotency key); std-drink calc + ABV slider math in `packages/shared`; recents/favourites/pre-fill queries; GeoNames city/country lookup; Overpass venue suggestion + ~150 m reuse + rename; catalog loader from `packages/content`.
- Deps: M3.
- Docs: `02-data-model.md`, `03-api.md`, `05-domain-logic.md`, DS §6.2, §7.
- DoD:
  - Std drinks formula matches DS §7 exactly: `ml × abv/100 × 0.789 / 10 × qty`, rounded to 1 decimal — golden-fixture unit tests covering boundary values (0.5 qty, 15.0%/15.5% ABV boundary).
  - ABV slider: positions 0–280; 0–15% at 0.1% steps (first 150 positions), 15–80% at 0.5% steps (remaining 130); from exactly position-for-15%, `−` → 14.9%, `+` → 15.5% (DS §6.2.1) — unit-tested at every documented boundary.
  - Recents: newest-first, de-duplicated by (category, drink, size), favourites pinned first, capped at 12 — unit test with >12 distinct + duplicate entries.
  - Venue: first log at a new place gets `GET venues/suggest` → `{kind:'candidate', name, lat, lng, osmId}` (C29 — no `isNewSuggestion` field), rendered as the dashed-chip suggested state; a second log within ~150 m gets `{kind:'existing', venue}` and attaches the same venue id; rename updates the venue name for this and subsequent logs; skip sends `venue: null` and stores the GPS point with no venue name.
  - **Idempotent ops via `applied_ops` (C34)**: every drink create/update/delete/rate carries a `clientOpId` distinct from `drinkId`, written to `applied_ops` in the same transaction as the op; replaying a previously-seen `clientOpId` (any of the four op types) returns the stored response instead of re-applying — test replays each op type twice and asserts exactly one resulting side-effect (one row created/edited/deleted/rated) plus an identical second response. Required for offline replay (M7) and re-tap-on-timeout safety.

### M5 — Feed, leaderboard, dashboard, SSE, masking, countdown
- Scope: feed/leaderboard read APIs; phase-transition scheduler job (real logic now, 15 s cadence, C26); SSE endpoints (three channels — trip/me/admin, C13) + event bus (`01-architecture.md §6`); countdown data; final-24h masking.
- Deps: M4.
- Docs: `03-api.md`, `05-domain-logic.md`, `06-metrics-wrapped.md`, DS §6.5–§6.7.
- DoD:
  - **Masking guarantee**: during `final_24h`, `GET /trips/:tripId/leaderboard` returns `masked:true` with every row's `rank` and `values` forced to `null` in the query layer (C16) — member names only, no order/rank, no drink counts, no std-drink totals. Verified by an integration test asserting the masked response can only ever carry `null` for `rank`/`values` (not merely that the client happens to ignore them).
  - Side/lower leaderboards remain locked (teaser) per DS §6.6 until unlock, independent of masking.
  - SSE: client receives a `phase.changed` event within one scheduler tick (≤15 s, C26) of the trip crossing a boundary; reconnect triggers a refetch (no replay buffer, per `01-architecture.md §6`) — e2e test kills and reopens the EventSource and asserts fresh data loads.
  - Heartbeat received at least every 25 s on an idle connection (integration test reading raw SSE stream for 60 s).
  - **Scheduler crash-recovery (C26)**: killing the process between the transition-marker write and the snapshot/event work it guards, then restarting, backfills the missing snapshot exactly once and never re-emits a duplicate transition — test seeds that partial-completion state directly in the DB and asserts boot backfill.

### M6 — Predictions, achievements, banners
- Scope: `predictions` schema + submit/lock logic (per-member window, README D10); `achievement_unlocks` schema + evaluation after log/edit/delete; achievement banner + feed row emission over SSE.
- Deps: M5.
- Docs: `05-domain-logic.md`, DS §6.4, §6.8, §10 Q9.
- DoD:
  - Prediction window closes at `min(firstDrinkTime, trip start)` per member — trip start = `start_date` 00:00 in the trip's timezone, so the window stays open until the trip begins no matter how early the member joined — unit-tested with a member joined well over 24h before trip start (still open) and a member who drinks within the window.
  - **First-drink immutability (C35)**: `trip_members.first_drink_at` is set once, at server receipt time of the member's first successfully-created drink, and is never cleared by later deletes. Regression test logs one drink then deletes it, and separately deletes *every* drink the member has logged, asserting in both cases the prediction window stays closed (does not reopen).
  - All 11 achievement keys from `packages/content` (`first_blood`, `five_in_hour`, `pit_stop`, `pub_crawl`, `mile_high`, `cheers`, `after_3am`, `critic`, `century`, `passport`, `regular`) have a predicate function in `packages/shared` with a golden-fixture unit test (input drink sequence → expected unlock/no-unlock).
  - Deleting a drink never revokes an already-announced achievement (regression test: unlock, delete triggering drink, assert unlock persists).
  - Achievement evaluated exactly once per triggering log/edit/delete (no duplicate unlock rows — unique constraint on `(trip_id, user_id, achievement_key)`).
  - **Achievement-in-transaction (C25)**: evaluation and unlock persistence happen inside the same transaction as the triggering drink create/update (incl. `century`, which needs the insert visible) — regression test forces a rollback and asserts no unlock row exists.
  - **Prediction-submit vs first-drink race (C25)**: firing `PUT predictions/me` and the member's first `POST drinks` concurrently serializes both under a per-member transactional lock with a window recheck before write — test asserts exactly the window-consistent outcome, never a submit that a same-instant first drink should have closed.

### M7 — Offline queue / PWA
- Scope: service worker (Workbox via vite-plugin-pwa), IndexedDB outbox, client-generated UUIDv7 on log, replay-on-reconnect/sign-in, "session lost" banner + queued-count UI.
- Deps: M4 (idempotent create), M2 (session behaviour).
- Docs: `05-domain-logic.md`, `07-frontend.md`, DS §7 "Session lost".
- DoD:
  - **Offline replay idempotency**: logging N drinks offline, then replaying twice (e.g. app killed mid-replay and reopened) results in exactly N drink rows, not 2N — e2e test using Playwright's offline mode + IndexedDB inspection, relies on M4's idempotent-create guarantee.
  - Queued drinks persist across an app/browser restart (IndexedDB, not memory).
  - Replay only occurs for the same account that queued the drinks (a different account signing in on the same device does not flush someone else's queue) — DS §7.
  - Installable PWA (manifest, icons, Lighthouse PWA check passes in CI or manual note).

### M8 — Metrics engine, Personal Wrapped
- Scope: metrics formulas (`packages/shared`), rank calc, `wrapped_snapshots` compute job, Personal Wrapped card payload endpoints, `trips.data_revision` bump wiring.
- Deps: M4, M6.
- Docs: `06-metrics-wrapped.md`, DS §6.9.
- DoD:
  - Metrics functions are pure, golden-fixture tested against hand-computed values for a small fixed drink set (docs §06 owns the exact formulas; this doc only requires golden-fixture coverage exists).
  - **`data_revision` bump matrix (C37)**: `trips.data_revision` increments on drink create/update/delete/rate, prediction submit, member insert/disable, and trip `name`/`start_date`/`end_date`/`timezone`/`unlock_at` edits — and does **not** increment on `last_opened_at` writes, missed-banner dismissal, theme change, or favourites/custom-name changes. Table-driven test asserts increment/no-increment for every listed mutation.
  - **Snapshot staleness model (C24)**: each personal `wrapped_snapshots` row carries `revision` (a recompute counter) and `source_revision` (the `trips.data_revision` it was computed against, `payload.schemaVersion` is separate); a snapshot is stale when `source_revision < trips.data_revision`. There is no `snapshot_revision` column, no `version` column, and no separate safety-poll job (`01-architecture.md §7`'s poll does not exist for this) — recompute is triggered only by the GET path below.
  - **Synchronous stale recompute (C38)**: `GET /wrapped/personal` recomputes in-request when stale (budget < 1 s), commits the bumped `revision`/`source_revision` in the same transaction, then responds with fresh data — no background job, no 202/polling protocol. Test mutates a drink post-unlock, then GETs once and asserts the response already reflects the mutation with a bumped `revision`; a repeat GET with no intervening mutation asserts no recompute (revision unchanged).
  - Personal Wrapped becomes reachable only after the trip's wrapped-unlock time; locked-teaser state returns a distinct API shape (no card data leak before unlock).
  - **Zero-drink fallback matrix, not "all 14 cards" (06 §fallback matrix)**: Personal Wrapped for a zero-drink member fixture renders every card per its own documented eligibility/fallback rule — some cards render nullable/skipped fallback content rather than real data, none crash or emit null/NaN. Golden-fixture test asserts each of the 14 cards individually against its own rule, not a blanket "all cards fully populated" assumption.

### M9 — Squad Wrapped / ceremony (big-screen) / replay
- Scope: Squad Wrapped payload (replay data embedded in card 6, C12 — no standalone replay endpoint), ceremony state machine (`ceremony_state`), big-screen layout route (`?display=big`), day-by-day replay (in-app only, README D6), owner controls (theme/unlock time/start).
- Deps: M8.
- Docs: `06-metrics-wrapped.md`, `07-frontend.md`, DS §6.10, §6.11, §6.12, README D5/D6.
- DoD:
  - `/t/:tripId/ceremony?display=big` renders the 16:9 big-screen layout with keyboard/click/tap advance (no presenter-remote pairing — deferred per D5).
  - Ceremony state (current card index, started/not) is shared across viewers of the same trip via the `ceremony.started`/`ceremony.step` SSE events (trip channel, C13), so a second browser opening the same ceremony URL mid-show sees the current card, not card 1; `POST .../restart` from `status: 'ended'` (owner-only, `403` otherwise) resets to card 0 and re-broadcasts the same way.
  - **Ceremony freeze (C36)**: after `ceremony_started_at`, adding an existing user as a member returns `409 ceremony_started`; accepting an invite for that trip still creates the invitee's account but skips the join (`trip: null` in the response, no membership row, no error); a prediction submit attempt for that trip is rejected (window already closed). Regression test covers all three.
  - Replay plays in-app end-to-end, sourced from the Squad Wrapped payload, with no video export path present in the UI (confirms D6 scope).
  - Replay total duration is 60–90 s for a 14-day trip fixture (empty-hour runs collapsed/capped rather than charged 1.5 s each) — timed test against the fixture generator's 14-day variant.
  - Every trip member receives ≥1 award, including edge fixtures (zero-drink member, tied criteria, >13 members) — co-winner fallback runs for every uncovered member, not just the >13-members case; asserted in the seed post-check and a dedicated unit test.

### M10 — Polish, a11y, perf, hardening
- Scope: DS §6.13.14 accessibility/motion/haptics pass; axe violations fixed; CSP/security headers finalized; load sanity (10 members, 2k drinks); error-state coverage (offline banners, rate-limit UI, link-problem screens DS §6.13.7); light/dark parity (DS screenshot 25).
- Deps: all prior.
- Docs: all.
- DoD: see "V1 done" checklist (§4 below).

## 2. Test strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `packages/shared` pure fns only: std-drink calc, ABV slider math, phase/day-boundary calc (06:00 local rollover via `@js-temporal/polyfill`, C33 — incl. spring-forward and fall-back DST day-index cases), achievement predicates, metrics formulas. Golden fixtures checked into `packages/shared/__fixtures__/`, no mocking of Date/Math beyond fixed-clock injection. |
| Integration | Vitest + Fastify `.inject()` | Route → service → repo, against a **fresh temp SQLite file per test** (`:memory:` not used — file-based to catch file-lock/WAL behavior; `beforeEach` creates `tmp/<test-id>.db`, migrates, seeds minimum fixtures, `afterEach` deletes). Covers auth, invites, trips, drinks, SSE event emission (assert bus publish, not the wire format), masking schema enforcement. |
| E2E | Playwright | Mobile viewport **390×844**, geolocation mocked (`context.setGeolocation`), against a Dockerized app + temp DB. Key journeys (must all pass before M10 exit): sign-in → log a drink (new drink, 4 taps) → repeat log (1 tap) → edit drink → offline log + reconnect replay → invite create → share-link accept → create-account landing in trip → predictions submit → final-24h masked board renders no ordinal data → personal Wrapped unlock → ceremony big-screen advance. |
| Visual | Playwright screenshot compare | DECISION: automated, low-tolerance (`maxDiffPixelRatio: 0.02`) screenshot diffs against `design/screenshots/<theme>/*.png` for the handful of static, data-independent screens (sign-in, invite landing, locked teasers); **not** attempted for data-heavy screens (feed, leaderboard, Wrapped cards) where content varies by fixture — those get manual visual review against the design spec instead. Rationale: full pixel-parity CI for dynamic screens is high-maintenance for a home-lab v1; static-screen coverage catches token/layout regressions cheaply. |
| Content parity | Vitest (in `packages/content`) | `classic.json` and `cs2.json` have identical **object** key-path sets (deep diff); **arrays**, incl. pack-defined variable-length sets (`leaderboard.columns`, `ranks.bands`, C43), are validated per-element against their schema, not by length/index parity; placeholder-lint runs per key, scanning for un-interpolated `{token}` or lorem-ipsum-style leftovers in shipped copy (`07-frontend.md` §3.4). |
| Accessibility | `@axe-core/playwright` | Run against every route in the e2e suite; fail CI on any "serious"/"critical" violation (DS §6.13.14 baseline). |
| Load sanity | Vitest/script against a temp DB | Seed 10 members × 2,000 drinks (scaled-up variant of the fixture generator, §3), assert leaderboard/feed/Wrapped-compute endpoints respond within an agreed budget (DECISION: p95 < 500 ms on the dev container, single instance, no load balancer — generous for a ≤10-person home-lab app) and the metrics engine completes without timeout. |

## 3. CI (GitHub Actions, Forgejo/Gitea Actions-compatible syntax)

Jobs (parallel where independent):
1. **lint** — `pnpm eslint .`, `pnpm prettier --check .`
2. **typecheck** — `pnpm -r typecheck` (tsc `--noEmit` per package)
3. **test-unit** — `pnpm --filter @drunkify/shared test`
4. **test-integration** — `pnpm --filter @drunkify/server test` (SQLite, temp files, no external services)
5. **test-e2e** — build app, `docker compose -f docker-compose.ci.yml up -d`, `pnpm --filter e2e test` (Playwright, mobile viewport), teardown
6. **build-docker** — `docker buildx build --platform linux/amd64,linux/arm64` (no push on PR; push on `main` merge/tag)
7. **postgres-smoke** — service container `postgres:16`, `DB_DRIVER=postgres DATABASE_URL=...`, run migrations + a minimal integration subset (auth + one trip + one drink + one SSE event) — **not** the full suite (§`01-architecture.md §5` decision)

All jobs required on PR merge except `build-docker` push step (build-only is required; push is main-branch-only).

## 4. Fixture / seed generator requirements

`scripts/seed.ts`, also usable as `pnpm seed` in dev and as the base for M10 load-sanity (scaled parameter).

- **Deterministic**: fixed seed for any RNG (drink choice, timing jitter, venue selection) — re-running produces byte-identical DB state on a fresh DB.
- **Idempotent**: re-running against an already-seeded DB is a safe no-op (or explicit `--reset` flag to wipe first) — never duplicates the fixture trip.
- 1 admin + **6 members**, joined at staggered times (covers per-member prediction windows, README D10).
- 1 trip spanning **9 days**, IANA timezone set, covering pre-trip, live, final-24h, and post-wrapped-unlock phases relative to "now" (fixture uses relative dates from seed-run time so the trip is always in a useful phase for manual dev testing — DECISION: default seed places "now" inside the final-24h window, since that's the hardest state to reach manually).
- **~400 drinks** total across members/days/categories/venues, hand-tuned to guarantee at least one qualifying event for **all 11 achievement keys** (`first_blood`, `five_in_hour`, `pit_stop`, `pub_crawl`, `mile_high`, `cheers`, `after_3am`, `critic`, `century`, `passport`, `regular`) — enforced by a post-seed assertion script that runs the achievement predicates and fails the seed if any key has zero eligible members.
- Includes: at least one custom drink name, at least one favourite, at least one venue in each state (suggested/renamed/skipped), at least one backdated log, at least one prediction submitted and one missed, at least one removed member (README D11 — data stays, still counted).
- Load-sanity variant: same generator, `--members 10 --drinks 2000` flag, non-deterministic RNG fine (perf test doesn't need golden values).

## 5. "V1 done" checklist

- [ ] All milestones M0–M10 DoD met.
- [ ] `docker buildx build --platform linux/amd64,linux/arm64` succeeds and image boots on both a dev amd64 machine and a Raspberry Pi (or arm64 VM) smoke test.
- [ ] Fresh-boot → admin seed → first-sign-in → create trip → invite a member → member logs a drink → feed/leaderboard update via SSE, all over HTTPS through the example Caddy config, no manual DB intervention.
- [ ] Full e2e journey list (§2) green on CI.
- [ ] Postgres smoke job green on CI (not full suite, per DECISION §`01-architecture.md §5`).
- [ ] Axe: zero serious/critical violations across all e2e-covered routes.
- [ ] CSP `connect-src`/`img-src` cover every origin required by the configured `MAP_STYLE_URL` (tiles/glyphs/sprites load with CSP enforced, no console violations).
- [ ] `GET /healthz` (liveness) and `GET /readyz` (DB check) both return 200 against the built image, outside `/api/v1` (C14).
- [ ] Backup (`drunkify db backup <path>`) + restore steps manually verified once against a real seeded DB.
- [ ] Load sanity (10 members, 2k drinks) meets the p95 budget (§2).
- [ ] Content key-parity check green for both theme packs; placeholder lint clean.
- [ ] Masking guarantee, invite atomicity, offline-replay idempotency, and seed idempotency each have a passing automated test (not just manual verification) — these are the four correctness properties called out as highest-risk in this doc.
- [ ] All README §5 "Out of scope (V1)" items confirmed absent from the built app (no push permission prompts, no cast/remote pairing UI, no replay export button, no passkey option, no multi-admin UI, no group-invite-link UI).
