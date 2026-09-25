# 03 — API

Binding: README §4. All paths are relative to `/api/v1`. Tables/columns referenced here are defined in `02-data-model.md`.

## 1. Cross-cutting conventions

### 1.1 Transport & auth

- JSON REST, `Content-Type: application/json; charset=utf-8`.
- Session = HttpOnly Secure cookie (`drunkify_session` — `SESSION_COOKIE_NAME` env default, C1 — opaque token, `SameSite=Lax`) — D1.
- CSRF: every mutating request (`POST`/`PUT`/`PATCH`/`DELETE`) **must** send header `X-Requested-With: drunkify`. Missing/wrong value → `400 bad_request` before any handler logic runs.
- Auth levels (checked server-side, never by hiding UI — DESIGN_SPEC §7):
  | Level | Meaning |
  |---|---|
  | `public` | no cookie required |
  | `session` | valid, non-revoked, non-expired session; `users.disabled_at IS NULL` |
  | `trip member` | `session` + a `trip_members` row for `:tripId` |
  | `trip owner` | `trip member` + `trips.owner_id = me.id` |
  | `admin` | `session` + `users.role = 'admin'` |

### 1.2 Pagination

Cursor-based on every list endpoint that can grow unbounded (`feed`, `invites`, `people`, ratings history).

```ts
// query:  ?cursor=<opaque>&limit=<n>            // limit default 20, max 100
// response:
type Page<T> = { items: T[]; nextCursor: string | null };
```

`cursor` is an opaque, server-signed pointer (base64 of `{sortKey, id}`); clients never construct or parse it.

### 1.3 Idempotency

Two independent idempotency keys exist; neither substitutes for the other (C34).

- **Plain `POST /drinks`**: `drinks.id` (client UUIDv7) is the idempotency key, unchanged. Re-`POST`ing the same `id` with the same payload is a no-op returning the existing row (`200`, not `201`). Re-`POST`ing the same `id` with a **different** payload from a **different** `user_id`/`trip_id` than the original → `409 id_conflict`.
- **`POST /drinks/sync` ops**: idempotency key is `clientOpId` (`clientOpId ≠ drinkId`, always), persisted in the `applied_ops` ledger (`02` §5.18) in the **same transaction** as the op (C25, C34). On receipt, the server looks up `clientOpId` first: a hit returns the stored `{statusCode, response}` verbatim — no re-validation, no re-check of `ceremony_started_at`, no re-run of achievement evaluation; a miss executes the op and writes the ledger row. A `create`-type sync op is **additionally** subject to the plain-`POST` `drinkId` dedup/`409 id_conflict` rule above — the two keys are checked independently and both enforced.
- **Undo** is not a server verb and is never a replay of the original `clientOpId`/idempotency key — it is always a **new op with a new `clientOpId`** (C34) that happens to carry the same `drinkId`/prior payload. Delete-undo = a fresh `create` op re-`POST`ing (or re-syncing) the prior drink payload with the same `drinkId`. Edit-undo = a fresh `update` op re-`PUT`ing the prior field values. This keeps "undo" symmetric with the offline queue (D7) instead of adding server-side history.
- **Mark-watched** (`wrapped/personal/watched`) is idempotent — repeat calls just bump `view_count`.

### 1.4 Server time & clock skew

`bootstrap` and every response that carries a countdown-relevant timestamp (`trips` get/list, `dashboard`, `predictions/status`) include `serverTime` (epoch ms) alongside the deadline field, so the client computes `deadline - serverTime` once and ticks locally instead of trusting device clocks (final-24h countdown, predictions countdown, ceremony hold).

### 1.5 Caching

- `GET /config` and `GET /trips/:tripId/venues/suggest` (Overpass round-trip) are the only meaningfully cacheable reads; both support `ETag` / `If-None-Match` → `304`.
- Everything else is either per-user/masked (leaderboard, wrapped) or cheap enough on SQLite that caching isn't worth the invalidation cost in a single-instance v1 (D14). Revisit if Postgres + multi-instance ships.

### 1.6 Errors (README §4, verbatim contract)

```ts
type ApiError = {
  error: {
    code: string;           // snake_case
    message: string;        // human-readable, safe to show
    fields?: Record<string, string>;  // field -> error code, for form binding
    retryAfter?: number;    // seconds, only on 429
  };
};
```

Common codes used across endpoints: `unauthenticated`, `forbidden`, `not_found`, `validation_failed` (with `fields`), `rate_limited` (with `retryAfter`), `conflict`, `bad_request`.

### 1.7 Mutation status matrix (C27, canonical — every endpoint below must match this)

| Mutation | Success | Ceremony started (`trips.ceremony_started_at` set) | Other domain error |
|---|---|---|---|
| Drink create (`POST /drinks`) | `201`/`200` (idempotent replay) | `409 conflict {code:'ceremony_started'}` | `422 validation_failed`; `409 id_conflict` |
| Drink update (`PUT /drinks/:id`) | `200` | `409 conflict {code:'ceremony_started'}` | `422 validation_failed`; `403 forbidden` (not owner) |
| Drink delete (`DELETE /drinks/:id`) | `204` | `409 conflict {code:'ceremony_started'}` | `403 forbidden` (not owner) |
| Drink rate (`PATCH /drinks/:id/rating`) | `200` | `409 conflict {code:'ceremony_started'}` | `422 validation_failed` (`category='soft'`) |
| Drinks sync (`POST /drinks/sync`) | per-op `ok` | per-op `409 conflict {code:'ceremony_started'}` | per-op `422 validation_failed`; never rolls back siblings |
| Favourites / custom drink names | `200`/`204` | **never frozen** — account-global, not trip-scoped (C27) | `422 validation_failed` |
| Predictions submit (`PUT /predictions/me`) | `200` | not gated by ceremony (window-gated instead) | `409 conflict {code:'already_locked'\|'window_closed'}` |
| Trip settings (`PATCH /trips/:id`) | `200` | `409 conflict {code:'ceremony_started'}` | `422 validation_failed` |

All ceremony-started rejections use the same status/code (`409 conflict {code:'ceremony_started'}`) — no endpoint uses a different status (e.g. `403`) or code for this condition.

### 1.8 Realtime

SSE at three channels (see §16). All are `GET`, `text/event-stream`, auth via the same session cookie (browser sends it automatically on `EventSource`).

### 1.9 Token status matrix (C41, canonical)

Applies to every token in `invites` and `password_resets` (`02` §5.3–5.4). Two endpoint shapes, one rule each:

| Token state | Lookup (`GET invites/lookup/:token`, `GET auth/reset-password/:token`) | Consuming (`POST invites/accept`, `POST invites/accept-as-member`, `POST auth/reset-password`) |
|---|---|---|
| Unknown / never existed | `200 {LinkProblem{kind:'invalid'}}` | `404 invalid_token` |
| Expired (`now > expires_at`, still `pending`/unused) | `200 {LinkProblem{kind:'expired'}}` (invites) / `{kind:'resetExpired'}` (resets) | `410 token_expired` |
| Used / accepted (`used_at` set, or invite `state='accepted'`) | `200 {LinkProblem{kind:'used'}}` | `410 token_used` |
| Revoked (invites only — `state='revoked'`; password resets have no revoked state, only "used" via the invalidate-on-reissue rule, `02` §5.4) | `200 {LinkProblem{kind:'revoked'}}` (invites only) | `410 token_revoked` (invites only — resets never return this code) |
| Rate-limited | `429 rate_limited` | `429 rate_limited` |

Lookups are **always `200`** — the client renders `LinkProblem` inline, never an error toast. Consuming endpoints use the status/code pairs above uniformly; no endpoint substitutes a different status (e.g. `401`/`409`) or a differently-named code (e.g. `invite_invalid`) for these cases. Every affected endpoint below matches this table exactly.

---

## 2. Shared types

```ts
type Id = string; // uuidv7

type Role = 'admin' | 'member';
type DisplayThemePref = 'system' | 'dark' | 'light';
type Category = 'beer'|'wine'|'cocktail'|'spirit'|'shot'|'cider'|'seltzer'|'soft'|'other';
type TripPhase = 'live' | 'final_24h' | 'wrapped_unlocked' | 'ceremony'; // C2 — prediction window is per-member state, not a phase

type User = {
  id: Id; email: string; name: string; role: Role;
  mustChangePassword: boolean; displayThemePref: DisplayThemePref;
  disabledAt: number | null; // epoch ms, null unless removed
};

type Member = {
  userId: Id; name: string; colorIndex: number; joinedAt: number;
  isOwner: boolean; isAdmin: boolean; disabled: boolean; email?: string; // email only in admin-facing responses
};

type Trip = {
  id: Id; name: string; startDate: string; endDate: string; timezone: string;
  themeId: string; unlockAt: number; ownerId: Id; ceremonyStartedAt: number | null;
  phase: TripPhase;
};

type Drink = {
  id: Id; userId: Id; tripId: Id; category: Category; drinkName: string;
  sizeMl: number; abv: number; qty: number; drunkAt: number;
  lat: number|null; lng: number|null; accuracy: number|null; altitude: number|null; speed: number|null;
  venueId: Id|null; venueName: string|null; city: string|null; countryCode: string|null;
  rating: 1|2|3|4|5|null; note: string|null;
  createdAt: number; updatedAt: number; editCount: number; stdDrinks: number; // stdDrinks computed, not stored
};

type Invite = {
  id: Id; name: string|null; email: string|null; tripId: Id|null; tripName: string|null;
  state: 'pending'|'accepted'|'expired'|'revoked'; // 'expired' computed server-side for API responses
  createdAt: number; expiresAt: number; acceptedBy: Id|null; acceptedAt: number|null;
};

type AchievementUnlock = {
  key: string; userId: Id|null; triggeredByUserId: Id; tripId: Id; drinkId: Id|null;
  unlockedAt: number; vars: Record<string, string|number>; // C42 — raw values only, no resolved text
}; // used verbatim in feed items, leaderboard/dashboard recentAchievements, and the achievement.unlocked SSE event (no narrower shape anywhere)
```

---

## 3. Auth

Base `/api/v1/auth`.

| Method & path | Auth | Request | Response | Errors | Notes |
|---|---|---|---|---|---|
| `POST /auth/sign-in` | public | `{email, password}` | `{user: User}` + sets session cookie | `validation_failed`, `bad_credentials` (401), `rate_limited` (429), `account_disabled` (403) | email trimmed + lower-cased server-side; wrong password (or unknown email) → generic `bad_credentials`, never reveals whether the account exists or is disabled; **only** a correct password against a disabled account → `403 account_disabled` (C17) |
| `POST /auth/sign-out` | session | — | `204` | — | revokes current session only |
| `POST /auth/finish-setup` | session (`mustChangePassword=true` only) | `{name, email, newPassword}` | `{user: User}` | `validation_failed`, `same_password`, `email_taken` | only reachable path while `mustChangePassword` true; clears the flag |
| `POST /auth/forgot-password` | public | `{email}` | `204` always | — | **always 200/204 regardless of whether the account exists** (README D3); sends via `MAILER` if account found and enabled |
| `GET /auth/reset-password/:token` | public | — | `{email: string} \| LinkProblem` | `429 rate_limited` (per IP, token-lookup bucket) | drives Set a new password (`/r/:token`) "For {email}." / Link problem (`resetExpired`, `used`, `invalid` — §1.9); read-only, does not consume |
| `POST /auth/reset-password` | public | `{token, newPassword}` | `{user: User}` + sets session cookie | `404 invalid_token`, `410 token_expired`, `410 token_used`, `422 validation_failed`, `common_password` | signs in on this device; revokes every other session for the user; per §1.9, password resets have no `revoked` state — `token_used` also covers a reset superseded by a newer one (`02` §5.4) |
| `POST /auth/change-password` | session | `{currentPassword, newPassword}` | `204` | `bad_credentials`, `validation_failed` | revokes every other session |
| `POST /auth/change-email` | session | `{currentPassword, newEmail}` | `{user: User}` | `bad_credentials`, `email_taken`, `validation_failed` | |

## 4. Me (profile)

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `GET /me` | session | — | `{user: User}` | `unauthenticated` |
| `PATCH /me` | session | `{name?, displayThemePref?}` | `{user: User}` | `validation_failed` |

## 5. Invites

Base `/api/v1/invites`. Admin-only except `lookup` (public) and `accept*` (public/session).

| Method & path | Auth | Request | Response | Errors | Notes |
|---|---|---|---|---|---|
| `POST /invites` | admin | `{name?, tripId?, email?, sendEmail?}` | `{invite: Invite, url: string}` | `validation_failed`, `not_found` (bad tripId) | `url` returned **only here and on reissue** — token stored hashed, never retrievable again; `sendEmail` requires `email` (mailer always configured, `MAILER=log|smtp`, README D3 — no disabled state) |
| `GET /invites` | admin | `?state=&tripId=&cursor=&limit=` | `Page<Invite>` | — | `expired` computed at read time. **Default (no `?state=`)**: excludes `accepted`, `revoked`, and `expired` rows whose `expires_at` is more than 30 days past (rows stay in DB, C5); sorts pending first, expired (≤30d) last. Pass `?state=accepted\|revoked\|expired\|pending` to see a specific hidden bucket |
| `POST /invites/:id/reissue` | admin | — | `{invite: Invite, url: string}` | `not_found`, `409 conflict` (`state='accepted'`) | allowed when `state IN ('pending','revoked')` (C40) — one transaction: resets `state='pending'`, generates a new `token_hash` and `expires_at`, kills the old token immediately (C5-adjacent) — atomic, never a partial old-dead/new-not-ready window; `accepted` is the only conflicting state |
| `POST /invites/:id/revoke` | admin | — | `{invite: Invite}` | `not_found`, `conflict` (already accepted) | |
| `GET /invites/lookup/:token` | public | — | `{invite: {name, tripName, tripDates, memberCount, inviterName}} \| LinkProblem` | `429 rate_limited` per IP | drives Invite landing / Link problem screens (§1.9); never leaks the token back |
| `POST /invites/accept` | public | `{token, name, email, password}` | `{user: User, trip: Trip \| null}` + sets session cookie | `404 invalid_token`, `410 token_expired`, `410 token_used`, `410 token_revoked`, `email_taken`, `validation_failed` | creates account, atomically marks invite accepted, joins trip if any. **Ceremony freeze (C36)**: if the invite's `trip_id` has `ceremony_started_at` set, the account is still created and the invite is still marked accepted — the join is silently skipped, response is `trip: null` (not an error) |
| `POST /invites/accept-as-member` | session | `{token}` | `{trip: Trip \| null, consumed: boolean}` | `404 invalid_token`, `410 token_expired`, `410 token_used`, `410 token_revoked` | signed-in user accepts an existing invite; if invite has **no trip** and this account is already a member elsewhere, invite is **not** consumed (`consumed:false`) so it can be forwarded — DESIGN_SPEC §6.13.5. **Ceremony freeze (C36)**: if the invite's trip has `ceremony_started_at` set, the invite is still consumed (`consumed:true`) but the join is skipped — `trip: null` |

`LinkProblem = { kind: 'expired'|'used'|'revoked'|'invalid'|'resetExpired', inviterName?: string }`.

## 6. People (admin)

Base `/api/v1/people`. All admin-only — every handler re-checks `role='admin'` server-side.

| Method & path | Auth | Request | Response | Errors | Notes |
|---|---|---|---|---|---|
| `GET /people` | admin | `?cursor=&limit=` | `Page<User & {trips: {id,name}[]}>` | — | Members section of People screen; Invites section comes from `GET /invites` |
| `GET /people/:userId` | admin | — | `{user: User, trips: Trip[], invitedBy: {id,name}\|null, joinedAt: number}` | `not_found` | member sheet |
| `POST /people/:userId/trips` | admin | `{tripId}` | `{member: Member}` | `not_found`, `conflict` (already a member), `409 conflict {code:'ceremony_started'}` | "Add to a trip"; assigns next `color_index`. **Ceremony freeze (C36)**: unlike invite acceptance (§5), this is a direct membership add for an *existing* account — rejected outright with `409 ceremony_started` once the target trip's `ceremony_started_at` is set, no silent skip |
| `POST /people/:userId/reset-link` | admin | — | `{url: string}` | `not_found`, `conflict` (target is disabled) | admin-issued `password_resets` row (`created_by` = admin); invalidates any earlier reset for that user |
| `DELETE /people/:userId` | admin | — | `204` | `not_found`, `forbidden` (`cannot_remove_admin`) | sets `disabled_at`, revokes all sessions and any pending `password_resets` issued to them; drinks/achievements/name stay (D11) |

## 7. Trips

Base `/api/v1/trips`.

| Method & path | Auth | Request | Response | Errors | Notes |
|---|---|---|---|---|---|
| `POST /trips` | admin | `{name, startDate, endDate, timezone, themeId, unlockAt}` | `{trip: Trip}` | `validation_failed` | D9: admin-only, creator = owner, auto-joined as member (`color_index=0`) |
| `GET /trips` | session | — | `{trips: Trip[]}` | — | trips the caller is a member of ("your trips") |
| `GET /trips/:tripId` | trip member | — | `{trip: Trip, members: Member[], serverTime: number}` | `not_found`, `forbidden` | |
| `PATCH /trips/:tripId` | trip owner | `{name?, startDate?, endDate?, timezone?, themeId?, unlockAt?}` | `{trip: Trip}` | `validation_failed`, `conflict` (`ceremony_started`) | 409 once `ceremonyStartedAt` is set — DESIGN_SPEC §6.12 |
| `GET /trips/:tripId/members` | trip member | — | `{members: Member[]}` | `not_found` | `email` field present only when caller is admin or is themself |

## 8. Bootstrap

| Method & path | Auth | Request | Response | Notes |
|---|---|---|---|---|
| `GET /bootstrap` | session | `?tripId=` (optional override) | `{ me: User, trips: Trip[], currentTrip: { trip: Trip, summary: TripSummary } \| null, serverTime: number }` | Single round-trip for app shell. `currentTrip` = `?tripId` if given and caller is a member, else the trip with the most recent `trip_members.last_opened_at`, else `null` ("No trip yet"). Calling this bumps that trip's `last_opened_at`. `TripSummary = { youStd: number, youDrinks: number, squadStd: number, squadDrinks: number, phase: TripPhase }` — `*Drinks` = `Σqty` (C21) |

## 9. Drinks

Base `/api/v1/trips/:tripId/drinks`. All require `trip member`; mutations are restricted to the caller's **own** drinks (`user_id = me.id`), enforced server-side regardless of UI (Feed only lets you tap your own rows, but the API must not trust that). **Every mutation below additionally 409s once `trips.ceremony_started_at` is set** — drinks are read-only from ceremony start onward (C11, §1.7).

```ts
// venue field on drink create/update (C29) — discriminated, one venues row created only for id/candidate:
type VenueInput =
  | { id: Id }                                                                  // pick an existing trip venue
  | { candidate: { name: string; lat: number; lng: number; osmId: string } }    // persist an Overpass suggestion
  | { name: string }                                                            // user-typed, no coords — sets drinks.venue_name only, no venues row
  | null;                                                                       // skipped
```
Server validates/upserts `venue` inside the same transaction as the drink write (C25).

| Method & path | Request | Response | Errors | Notes |
|---|---|---|---|---|
| `POST /drinks` | `{id, category, drinkName, sizeMl, abv, qty, drunkAt, lat?, lng?, accuracy?, altitude?, speed?, venue?: VenueInput, note?}` | `201 {drink: Drink}` or `200 {drink: Drink}` if `id` already exists (idempotent replay) | `validation_failed` (422), `id_conflict` (409, id owned by another user/trip), `forbidden`, `conflict` (409, `ceremony_started`) | `rating` is never set on create (DESIGN_SPEC §2 #2); city/countryCode resolved server-side from lat/lng; see §1.7 for the mutation status matrix |
| `POST /drinks/sync` | `{ops: SyncOp[]}` where `SyncOp = {clientOpId: string, tripId: Id, type:'create'\|'update'\|'delete'\|'rate', drinkId: Id, payload?: object, clientNowMs: number, userId: Id}` (C28) | `{results: {clientOpId, status: 'ok'|'error', drink?: Drink, error?: ApiError}[]}` | — (per-op errors only, incl. `ceremony_started`, `validation_failed`) | offline queue flush (D7); the **app IndexedDB outbox is the single replay owner** — Workbox never replays mutations and never caches authenticated API responses (C28); ops applied in array order but failures don't block siblings. Each op is looked up by `clientOpId` in `applied_ops` (`02` §5.18) **before** executing — a hit replays the stored result, a miss executes and writes the ledger row in the same transaction (C34, §1.3); a `create` op is additionally subject to the plain-`POST` `drinkId` dedup rule on top of the `clientOpId` ledger — the two keys are independent |
| `PUT /drinks/:drinkId` | full editable field set (category…note, `venue?: VenueInput`, plus `rating?`) | `{drink: Drink}` | `not_found`, `forbidden` (not owner), `validation_failed` (422), `conflict` (409, `ceremony_started`) | full edit sheet save; increments `edit_count` |
| `PATCH /drinks/:drinkId/rating` | `{rating: 1\|2\|3\|4\|5}` | `{drink: Drink}` | `not_found`, `forbidden`, `validation_failed` (422, `category='soft'`), `conflict` (409, `ceremony_started`) | quick-rate from the post-log toast/Feed; does **not** increment `edit_count`; soft-drink rejection is `422 validation_failed`, never a different code (§1.7) |
| `DELETE /drinks/:drinkId` | — | `204` | `not_found`, `forbidden`, `conflict` (409, `ceremony_started`) | hard delete (§02 §2); undo = client re-`POST`s the prior payload with the same `id` |
| `GET /drinks/recents` | `?limit=` (default 12) | `{lastDrink: Drink \| null, lastByCategory: Partial<Record<Category, Drink>>, items: Drink[]}` (C30) | — | caller's own drinks in this trip; `lastDrink` = most recent overall ("Another" prefill); `lastByCategory` = most recent per category (wizard prefill); `items` = newest-first, deduped by `(category, drinkName, sizeMl)`, favourites-first, capped at `limit` — all computed, not a stored table |

## 10. Favourites & custom drink names

Base `/api/v1/me` — **not** trip-scoped (see `02-data-model.md` §5.9–5.10).

| Method & path | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `GET /me/favourites` | session | — | `{favourites: {id, category, drinkName, sizeMl, abv}[]}` | — |
| `POST /me/favourites` | session | `{category, drinkName, sizeMl, abv}` | `{favourite: {...}}` | `validation_failed` — upsert on the `(category,drinkName,sizeMl)` key |
| `DELETE /me/favourites/:id` | session | — | `204` | `not_found`, `forbidden` |
| `GET /me/custom-drink-names` | session | `?category=` | `{names: {name, abv}[]}` | `validation_failed` — ordered by `last_used_at` desc |
| `POST /me/custom-drink-names` | session | `{category, name, abv?}` | `{}` | `validation_failed` — upsert, bumps `last_used_at` |

## 11. Venues

Base `/api/v1/trips/:tripId/venues`, `trip member`.

```ts
// C29 — discriminated; shares the {name,lat,lng,osmId} candidate shape with VenueInput (§9)
type VenueSuggestResponse =
  | { kind: 'existing'; venue: { id: Id; name: string; lat: number; lng: number; source: 'osm'|'user' } }
  | { kind: 'candidate'; name: string; lat: number; lng: number; osmId: string }
  | { kind: 'none' };
```

| Method & path | Request | Response | Errors | Notes |
|---|---|---|---|---|
| `GET /venues/suggest` | `?lat=&lng=` | `VenueSuggestResponse` | `validation_failed` | `kind:'existing'` reuses a trip venue within ~150 m silently; else queries Overpass if `GEO_VENUE_PROVIDER=overpass` and returns `kind:'candidate'` (not yet persisted — a `venues` row is created only when a drink is logged with `venue: {candidate: ...}`, §9); `kind:'none'` if no match and geo lookup is off/empty |
| `PATCH /venues/:venueId` | `{name}` | `{venue: {...}}` | `not_found`, `validation_failed` | renames for this and subsequent logs; past `drinks.venue_name` snapshots untouched |

## 12. Leaderboard

| Method & path | Auth | Request | Response | Notes |
|---|---|---|---|---|
| `GET /trips/:tripId/leaderboard` | trip member | — | `LeaderboardResponse` | see masking rule below |

```ts
type LeaderboardValues = { std: number; drinks: number; k: number; a: number; d: number; rating: number }; // drinks = Σqty (C21)

type LeaderboardResponse = {
  masked: boolean; // true during final_24h
  rows: {
    userId: Id; name: string; isYou: boolean;
    rank: number | null;               // null when masked
    values: LeaderboardValues | null;  // null when masked
  }[]; // sorted by rank when !masked, alphabetically by name when masked
  recentAchievements: AchievementUnlock[]; // "Just unlocked" / "Highlights", most recent 2
};
```

No `title`/`subtitle`/`columns` on the wire (C16) — the client picks which of `values`' fields to show, and their labels, from its own loaded pack's `leaderboard.columns` (README §4: labels never come from the server).

Masking (final 24h, DESIGN_SPEC §6.7 / product spec §5): server never sends `rank` or `values` while `masked=true` — enforced in the query layer, not hidden client-side. This is **suspense, not secrecy** (C20): Feed still shows everyone's drinks (per design), so a determined user can reconstruct approximate ranks from feed/SSE data. No confidentiality guarantee is claimed on this endpoint.

## 13. Dashboard stats

Base `/api/v1/trips/:tripId`, `trip member`.

| Method & path | Response | Notes |
|---|---|---|
| `GET /dashboard` | `{ totals: {you: {std,drinks}, squad: {std,drinks}}, byDay: {day:number, dateLabel:string, std:number}[], byCategory: {category:Category, std:number}[], recentAchievements: AchievementUnlock[] }` | one round trip for Log home + Leaderboard tab's "Squad by day" / "What we drink" charts; `drinks` = `Σqty` (C21) |
| `GET /stats/ratings` | `Page<{drinkId:Id, drinkName:string, category:Category, rating:1|2|3|4|5, drunkAt:number}>` | caller's own ratings history only; explicit item shape `{drinkId, drinkName, category, rating, drunkAt}` (no `memberId` — this is always the caller's own history, final-24h masking (C20) does not apply here); `drunkAt` = epoch ms (C19), sorted newest-first — there is no separate "rated at" timestamp column |

## 14. Feed

| Method & path | Auth | Request | Response | Notes |
|---|---|---|---|---|
| `GET /trips/:tripId/feed` | trip member | `?filter=mine\|everyone&cursor=&limit=` | `Page<FeedItem>` | flat, newest-first; **grouping by trip day is a client concern** using `tripDay`/`dayLabel` on each item (server doesn't nest) |

```ts
type FeedItem =
  | { kind: 'drink'; drink: Drink; memberName: string; tripDay: number; dayLabel: string }
  | { kind: 'achievement'; unlock: AchievementUnlock; memberName: string | null; tripDay: number; dayLabel: string }; // C42: `unlock.key` is the achievement key — no separate `achievementKey` field
```

`dayLabel` follows the trip-tz, 06:00-boundary rule (README §4: a 2 a.m. drink belongs to the previous night) — same helper as `02-data-model.md`'s day computation, shared in `packages/shared`.

## 15. Predictions

Base `/api/v1/trips/:tripId/predictions`, `trip member`.

Window close (C36): effective close = `MIN(predictions_deadline_at, first_drink_at, trips.ceremony_started_at)` (`02` §5.6) — ceremony start force-closes every still-open window immediately, regardless of each member's individual deadline, so a member who joined right before the ceremony can't retain an open window into it.

| Method & path | Request | Response | Errors | Notes |
|---|---|---|---|---|
| `GET /predictions/me` | — | `{state: 'open'|'locked'|'missed', deadlineAt: number, serverTime: number, answers: null, missedDismissed: boolean}` | — | `answers` is **always `null` before the ceremony** (C31), including to the author, even after `locked_at` is set — this endpoint never echoes submitted answers; the caller's own draft is client-held state until submit. Answers are revealed only inside the Squad Wrapped payload once `ceremony_started_at` is set (C8, §16). `missedDismissed` mirrors `trip_members.missed_banner_dismissed` (C7) |
| `PUT /predictions/me` | `Answers` (all 6 required) | `{state:'locked', deadlineAt: number}` | `validation_failed`, `conflict` (`already_locked`), `conflict` (`window_closed`) | atomically sets `locked_at`; window-closed check uses the derived deadline above (`02` §5.6, C36), serialized against first-drink creation for the same member (per-member lock, recheck-before-write) so the two can't both pass the window check racing each other (C25) |
| `POST /predictions/me/dismiss-missed` | — | `204` | — | sets `trip_members.missed_banner_dismissed=true` (C7); idempotent |
| `GET /predictions/status` | — | `{submitted: number, total: number}` | — | counts only, no content — "{n} of {total} have predicted" |

```ts
type Answers = { myTotalStd: number; groupTotalStd: number; topMemberId: Id; leastMemberId: Id; topDrink: string; topDrinkCategory: Category }; // topDrinkCategory: predictions.q5_top_drink_category (C31)
```

## 16. Wrapped

Base `/api/v1/trips/:tripId/wrapped`, `trip member`.

| Method & path | Request | Response | Errors | Notes |
|---|---|---|---|---|
| `GET /wrapped/status` | — | `{ personalUnlockAt: number, personalUnlocked: boolean, personalWatchedCount: number, totalMembers: number, ceremonyStarted: boolean, ceremonyStartedAt: number \| null, serverTime: number }` | — | drives locked/teaser screens for both Personal and Squad |
| `GET /wrapped/personal` | — | `{unlocked: boolean, payload: PersonalWrappedPayload \| null}` | — | `payload` only once `now >= trip.unlockAt`; served from `wrapped_snapshots` (`user_id=me.id`, latest `revision`). Row is computed by the scheduler at `unlockAt` (`05`); any drink/prediction mutation before ceremony start bumps `trips.data_revision` (C24, `02` §5.5 bump matrix), which makes the snapshot stale (`source_revision < trips.data_revision`). **C38 (canonical, no background job)**: when stale, this endpoint recomputes **synchronously in-request**, within a small time budget (< 1 s) — commits the new `wrapped_snapshots` row (new `revision`, `source_revision` = the current `trips.data_revision`) in one transaction, then responds with the fresh payload. There is no async/`202` path and no durable recompute job; a request that hits the budget still completes the recompute before responding (recompute cost is bounded by trip size, per `06`) |
| `POST /wrapped/personal/watched` | — | `204` | — | idempotent; bumps `wrapped_views.view_count`, sets `watched_at` if unset |
| `GET /wrapped/squad` | — | `{unlocked: boolean, payload: SquadWrappedPayload \| null}` | `forbidden` never — non-owners just get `unlocked:false` pre-ceremony | **owner-started only**: `unlocked` is true for *everyone* once `ceremonyStartedAt` is set (so the phone-following-the-TV case works), false before that regardless of role. Computed once, in the same transaction as `POST /ceremony/start` (C25), and frozen (`02` §5.15) |

`PersonalWrappedPayload` / `SquadWrappedPayload` shapes are defined in `06-metrics-wrapped.md` (card-by-card data, achievement/award/archetype/rank **keys** only — never labels, per README §4). `SquadWrappedPayload` is also the **only** place predictions ever surface — the Oracle reveal (card) and the replay data (card 6) both live inside it, gated by the same `ceremonyStartedAt` check (C8, C12); there is no separate predictions-reveal or replay endpoint.

## 17. Ceremony

Base `/api/v1/trips/:tripId/ceremony`. Kept minimal — phone-as-remote is V1.1 (D5); this only drives the single big-screen client plus whatever tab the owner is issuing controls from.

| Method & path | Auth | Request | Response | Errors | Notes |
|---|---|---|---|---|---|
| `POST /ceremony/start` | trip owner | — | `{state: CeremonyState}` | `conflict` (`already_started`) | **one transaction** (C25): sets `trips.ceremony_started_at`, computes + persists the Squad `wrapped_snapshots` row, and inserts/updates `ceremony_state` (`status='running'`, `current_card_index=0`, `sub_step=0`). `ceremony.started` is broadcast **after commit**, never before |
| `GET /ceremony/state` | trip member | — | `{state: CeremonyState}` | — | polled fallback if SSE drops; also how a member who **opens/joins the trip mid-ceremony** gets in sync — there is no separate catch-up event, current state is always fetchable here and reflects wherever the owner currently is (card/subStep) |
| `POST /ceremony/advance` | trip owner | `{direction: 'next'\|'back'}` | `{state: CeremonyState}` | `conflict` (`not_started`) | see §17.1 for exact transitions and bounds; broadcasts `ceremony.step` after commit |
| `POST /ceremony/hold` | trip owner | `{held: boolean}` | `{state: CeremonyState}` | `conflict` (`not_started`) | pauses/resumes **in-card timers only** (count-ups, replay playback) — V1 has **no auto-advance** between cards/subSteps, so there is nothing else for hold to freeze; does not block `advance` (§17.1); broadcasts `ceremony.step` |
| `POST /ceremony/restart` | trip owner | — | `{state: CeremonyState}` | `conflict` (`not_started`) | **rewatch**: resets `ceremony_state` to `current_card_index=0, sub_step=0, status='running'`, clears `held`. Requires the ceremony to have been started (`ceremony_started_at` already set) — does **not** re-set `ceremony_started_at`, does **not** recompute the Squad `wrapped_snapshots` row (already frozen, C11/§16), and does **not** touch `trips.data_revision`. Works from any prior status, incl. `ended`. Broadcasts `ceremony.step` after commit |

```ts
type CeremonyState = { status: 'not_started'|'running'|'ended'; cardIndex: number; subStep: number; held: boolean; updatedAt: number };
// cardIndex is 0-based, 0–10 (11 Squad cards), mirrors ceremony_state.current_card_index (C18)
```

### 17.1 Advance semantics (bounds, transitions)

Exhaustive per-card table — the 11 Squad cards (`06` §9.3), in ceremony order, `current_card_index` 0–10 (C18). `subStep` max is derived from that trip's Squad payload content at ceremony start, not a fixed constant, but the **formula** per card is fixed:

| Index | Card key | `subStep` max (0-based) | What each `next` reveals |
|---|---|---|---|
| 0 | `01_group_total` | `1` | 0: group total headline. 1: absurd-unit punchline |
| 1 | `02_drunk_o_meter` | `max(incidents.length - 1, 0)` | one detected incident per subStep, in `data.series`/`incidents` order (0 if none — fallback-variant copy, `06` §9.4) |
| 2 | `03_keg` | `0` | single beat — keg percentage |
| 3 | `04_cities_venues` | `1` | 0: cities. 1: venues |
| 4 | `05_crowd_then_divisive` | `1` | 0: crowd favourite. 1: most divisive drink |
| 5 | `06_replay` | `0` | fixed at 0 — the replay's own internal clock drives playback (`06` §10), not `subStep`; `hold` pauses/resumes that clock, `next`/`back` only move between cards |
| 6 | `07_side_boards` | `6` (7 boards, fixed — `SideLeaderboardKey`) | one side leaderboard revealed per subStep |
| 7 | `08_predictions` | `rows.length - 1` | one member's predicted-vs-actual row per subStep (Predictions/Oracle rule) |
| 8 | `09_awards` | `winners.length - 1` | one award revealed per subStep, in `orderAwardsForCeremony` order |
| 9 | `10_main_board` | `ranking.length` | subSteps `0..N-1`: one member revealed ascending (last place first). Final subStep `N`: full board + Trip MVP crown (Leaderboard reverse-reveal rule) |
| 10 | `11_credits` | `0` | single beat — bloopers + archetypes roll together |

- **`next`**: `subStep < max` → `subStep += 1`. `subStep = max` → `cardIndex += 1, subStep = 0`. At `cardIndex = 10` (`11_credits`) on its last (only) `subStep` → `status = 'ended'` (terminal). A further `next` while `status='ended'` is a **no-op** (returns current state unchanged, no error).
- **`back`**: mirrors `next` in reverse (`subStep -= 1`, or `cardIndex -= 1` landing on the previous card's max `subStep`). At `cardIndex = 0, subStep = 0` → no-op (stays put, no error). While `status='ended'`, `back` is **not** a no-op: it moves to the last card's last subStep (`cardIndex=10, subStep=0` — `11_credits`'s max per the table above) and flips `status` back to `'running'` — this is the only way out of `ended` other than `POST /ceremony/restart`.
- **`hold`**: pauses/resumes **in-card timers only** — count-ups (e.g. card 1 `02_drunk_o_meter`'s incident ticker) and replay playback (card 5 `06_replay`). V1 has **no auto-advance** between cards or subSteps at all — every card/subStep transition is owner-driven via `next`/`back` — so `hold` never blocks, delays, or interacts with `advance`; the two are orthogonal.
- **Rewatch**: `POST /ceremony/restart` (§17) resets to `cardIndex=0, subStep=0, status='running'` from any state, including `ended`.
- **Late joiners**: a member opening the trip (or joining, pre-ceremony-freeze — see C36) after the ceremony has started fetches `GET /ceremony/state` to land on the owner's current card/subStep, then follows `ceremony.step` SSE events going forward — no separate "catch-up" mechanism.

## 18. Config

| Method & path | Auth | Response | Notes |
|---|---|---|---|
| `GET /config` | public | `{mapStyleUrl: string, geoProviderEnabled: boolean, mailerEnabled: boolean}` | derived from `MAP_STYLE_URL`, `GEO_VENUE_PROVIDER`, `MAILER` env (D8, D3); `ETag` supported |

## 19. Health

Outside `/api/v1` (C14).

| Method & path | Auth | Response | Notes |
|---|---|---|---|
| `GET /healthz` | public | `{status: 'ok'}` | liveness only — no DB check |
| `GET /readyz` | public | `{status: 'ok'\|'not_ready', schemaVersion: string, uptimeSec: number}` | readiness — includes a DB check; `schemaVersion` mirrors `app_meta.schema_version` (`02` §4) |

## 20. SSE

Three channels, all `text/event-stream`, cookie-authenticated:

| Channel | Auth | Scope |
|---|---|---|
| `GET /trips/:tripId/events` | trip member | main trip stream |
| `GET /me/events` | session | personal, cross-trip stream (`session.revoked`, `trip.added`) |
| `GET /admin/events` | admin | admin-wide stream (currently just `invite.accepted`) |

`session.revoked`, `trip.added` and `invite.accepted` are not trip-scoped, so they get dedicated personal/admin channels instead of being multiplexed onto every open trip stream — clients open `/me/events` once at app-shell load (always), `/admin/events` additionally when `role='admin'`, and one `/trips/:tripId/events` per currently-viewed trip.

| Event | Channel | Payload | Fired when |
|---|---|---|---|
| `hello` | trip, me, admin | `{serverTime: number}` | sent immediately on every successful connection, before any other event — lets the client compute clock skew (§1.4) without waiting for the first real event (C13) |
| `drink.created` | trip | `Drink` | any member logs a drink (incl. via sync) |
| `drink.updated` | trip | `Drink` | edit or rating patch |
| `drink.deleted` | trip | `{id: Id}` | delete (including via undo-of-undo, i.e. deletes are always real) |
| `achievement.unlocked` | trip | `AchievementUnlock` | after evaluation on any log/edit/delete |
| `member.joined` | trip | `Member` | invite accepted into this trip, or admin adds existing user to trip |
| `member.removed` | trip | `{userId: Id}` | admin removes access (`DELETE /people/:userId`) for a user who is a member of this trip (C13) — data/rank/stats stay per D11, this just tells clients to refresh member-list UI |
| `trip.updated` | trip | `Trip` | owner changes settings (§7 `PATCH /trips/:tripId`) |
| `phase.changed` | trip | `{phase: TripPhase}` | trip crosses a lifecycle boundary — `live→final_24h`, `final_24h→wrapped_unlocked` (server-computed on a scheduler tick, D14, in-process) or `wrapped_unlocked→ceremony` (synchronously on `POST /ceremony/start`); values per C2 — prediction window closing is per-member state, not a phase, so it never appears here |
| `wrapped.unlocked` | trip | `{}` | fired to all members at `unlockAt` (pairs with `phase.changed` to `wrapped_unlocked`) |
| `ceremony.started` | trip | `CeremonyState` | `POST /ceremony/start` |
| `ceremony.step` | trip | `CeremonyState` | `POST /ceremony/advance`, `/hold`, or `/restart` |
| `invite.accepted` | admin | `{inviteId: Id, name: string|null, tripId: Id|null}` | invite accepted, any trip |
| `session.revoked` | me | `{reason: 'sign_out'|'password_changed'|'password_reset'|'removed'}` | any of the caller's *other* sessions ends — forces that tab to sign-out state |
| `trip.added` | me | `{tripId: Id}` | caller is added to a trip (invite accepted into a trip, or `POST /people/:userId/trips`) while they have no open stream for that trip yet (C32) — client refetches `GET /bootstrap` |

All events are single-instance in-memory pub/sub (D13); Postgres LISTEN/NOTIFY fan-out is future work if the deployment ever goes multi-instance. **No replay buffer** (C13): on reconnect (dropped connection, app resume, tab wake) the server does not redeliver missed events — clients refetch the relevant resource(s) (feed, members, trip, ceremony state) instead of assuming gap-free delivery.
