# 05 — Domain Logic

Pure functions below live in `packages/shared/src/*` (no I/O; take primitives/rows, return primitives/DTOs). Server routes and the wizard both import them so client-side preview (e.g. live std estimate) and server-side truth never drift.

Row fields referenced here use `02-data-model.md` column names verbatim:
`trips`: `start_date, end_date, theme_id, created_at, unlock_at, ceremony_started_at`.
`drinks`: `id, trip_id, user_id, category, drink_name, size_ml, abv, qty, drunk_at, note, rating, venue_id, venue_name, lat, lng, accuracy, altitude, speed, country_code, city, created_at, updated_at`.
`venues`: `id, trip_id, name, lat, lng, source('osm'|'user'), osm_id, created_at, updated_at`.
`predictions`: `trip_id, user_id, q1_my_total_std, q2_group_total_std, q3_top_member_id, q4_least_member_id, q5_top_drink, q5_top_drink_category, locked_at` (C7 — no separate `submitted_at` column; "locked" and "submitted" are the same instant; C31 adds `q5_top_drink_category`).
`achievement_unlocks`: `id, trip_id, user_id, achievement_key, triggered_by_user_id, drink_id, unlocked_at, vars` (C42).
`favourites`: `user_id, category, drink_name, size_ml` (not trip-scoped, 02 §5.10).
`custom_drink_names`: `user_id, category, name, last_used_at` (not trip-scoped, 02 §5.9).
`ceremony_state`: `trip_id, current_card_index, started_at` — no per-card gate column (C8/C18, §7).
`trip_members`: `first_drink_at, missed_banner_dismissed` (C35 — `first_drink_at` replaces any stored deadline; the window's `closeAt` is always derived, never stored).

**Columns needed beyond `02-data-model.md`** (for `02` to patch — everything else above already exists there):

| Table | Column | Type | Notes |
|---|---|---|---|
| `trips` | `final24h_marked_at` | integer/bigint, nullable | scheduler idempotency marker (§4, C26) |
| `trips` | `wrapped_unlocked_marked_at` | integer/bigint, nullable | scheduler idempotency marker (§4, C26) |
| `predictions` | `q5_top_drink_category` | text, not null | drink category paired with Q5's drink name (C31) |
| `trip_members` | `first_drink_at` | integer/bigint, nullable | immutable, server receipt time of first successful create; deletes never clear it (§3, C35) |
| `venues` | `osm_id` | text, nullable | OSM element id when Overpass supplied one; partial unique `(trip_id, osm_id) WHERE osm_id IS NOT NULL` for concurrent-accept dedup (§6, C29) |
| `achievement_unlocks` | `triggered_by_user_id` | text, not null, FK `users` | the earner, always set (incl. group keys where `user_id` is `NULL`) (§8, C42) |
| `achievement_unlocks` | `vars` | json, not null, default `{}` | achievement-specific copy-interpolation vars, e.g. `{n}` (century), `{venue}` (regular) (§8, C42) |
| `applied_ops` | *(new table)* | `client_op_id` PK, `user_id`, `trip_id`, `drink_id`, `type`, `status_code`, `response` json, `applied_at` | outbox idempotency ledger (§11, C34) |

---

## 1. Units

```ts
// packages/shared/src/units.ts
export function ethanolGrams(sizeMl: number, abvPercent: number, qty: number): number
// sizeMl × (abvPercent/100) × 0.789 × qty

export function stdDrinks(sizeMl: number, abvPercent: number, qty: number): number
// ethanolGrams(...) / 10   — catalog.json → standardDrink

export function formatStd(std: number): string
// 1 decimal, round-half-up. 0 → "0.0"

export function formatEthanolGrams(g: number): string
// integer grams, no decimal
```

**DECISION**: std is never stored; always derived at read time from `size_ml, abv, qty` (all stored on `drinks`). Avoids drift if formula constants change and keeps drinks table normalized.

### ABV slider (`catalog.json → abvSlider`)

```ts
export function posToAbv(pos: number): number
// pos 0-150 → pos/10 ; pos 151-280 → 15 + (pos-150)*0.5
export function abvToPos(abv: number): number
// abv <= 15 → round(abv*10) ; else 150 + round((abv-15)/0.5)
export function nudgeAbv(abv: number, dir: 1 | -1): number
// pos = abvToPos(abv) + dir; clamp [0,280]; return posToAbv(pos)
export function snapAbv(abv: number): number
// posToAbv(abvToPos(abv)) — round-trips a catalog/custom value onto the grid
export function formatAbv(abv: number): string
// abv <= 15 → 1 decimal ("5.0%"); abv > 15 → whole if integral ("40%"), else 1 decimal ("15.5%")
export function clampAbv(abv: number): number
// clamp [0, 80] (§5 ABV bounds)
```

**Edge case, abv = 15 exactly**: `abvToPos(15) = 150` from either branch (continuous at the seam). `nudgeAbv(15, -1)` → pos 149 → `14.9`. `nudgeAbv(15, +1)` → pos 151 → `15.5`. Matches DESIGN_SPEC §6.2.1.
**DECISION**: `snapAbv` is applied whenever a non-grid ABV enters the system (custom catalog seed data, future imports) — the slider itself can only ever produce grid values by construction.

---

## 2. Trip days

```ts
// packages/shared/src/tripDays.ts
export function tripLengthDays(startDate: string, endDate: string): number
// inclusive calendar-day count in trip tz, e.g. 2026-09-05..2026-09-14 = 10

export function dayIndex(instantMs: number, tripStartDate: string, timezone: string): number
// 1-based. C33 — Temporal wall-clock subtraction, via `@js-temporal/polyfill`:
//   const zdt = Temporal.Instant.fromEpochMilliseconds(instantMs).toZonedDateTimeISO(timezone);
//   const shifted = zdt.toPlainDateTime().subtract({ hours: 6 }).toPlainDate();
// `.subtract({hours:6})` is wall-clock (PlainDateTime) arithmetic, not an absolute
// Instant/Duration shift — this is what keeps 02:00 local "the previous night" correct
// across a DST transition, where subtracting 6 real elapsed hours would land on the
// wrong side of the boundary on the transition night itself.
// dayIndex = daysBetween(shifted, PlainDate(tripStartDate)) + 1  (Temporal.PlainDate.until/since, days unit).

export function dayLabel(
  instantMs: number,
  nowMs: number,
  tripStartDate: string,
  timezone: string,
  weekdayName: (instantMs: number, timezone: string) => string,
): string
// dayIndex(instant,...) === dayIndex(now,...) → "Tonight"
// else → "{weekday}, day {n}"  (weekday from the 06:00-shifted local date)
```

**DST test cases (required, C33)** — pick real transition dates for the trip's fixture timezone (e.g. `America/New_York`):
- **Spring-forward night** (clocks skip 02:00→03:00): a drink at 01:30 local (pre-skip) and one at 03:30 local (post-skip, same wall-clock night) both land in the same `dayIndex`; a drink at 06:30 local the *next* calendar day rolls to `dayIndex+1` — the 23-hour-long local day doesn't shift the boundary.
- **Fall-back night** (clocks repeat 01:00→02:00): the ambiguous local hour occurs at two different instants (offsets differ by 1h); both instants must resolve to the same `dayIndex` — verifies the subtraction uses the wall-clock reading Temporal disambiguates to, not raw elapsed-ms math. The 25-hour-long local day also doesn't shift the boundary.
- **Trip `start_date` itself on a transition night**: `dayIndex` of a drink at the trip's first 05:00 local is still `0`/`1` per the normal backdating floor (§5), regardless of that day's local length.
- **06:00 boundary exactly at the transition instant**: a drink logged in the skipped/repeated hour range must not throw or produce a fractional/duplicate index.

**06:00 boundary** applies uniformly: feed grouping, "trip-night" for `pub_crawl`/Night MVP. Rank's "per day of trip" denominator uses `rankDays = clamp(elapsedTripDays(snapshotAt), 1, tripLengthDays(startDate, endDate))` (C22, formula owned by `06-metrics-wrapped.md`) — elapsed days capped at the trip length, not a fixed value, so an early-trip rank isn't diluted by days that haven't happened yet.

**DECISION**: `dayIndex` can exceed `tripLengthDays` (trip runs long) or be `≤0` (backdated before day 1, blocked separately — see §5 backdating bounds, floor is start−1 day so `dayIndex` can be `0`). Squad-by-day chart renders `1..tripLengthDays`; a day index outside that range is clamped into the nearest bucket for display only, never dropped from totals.

---

## 3. Phase state machine

```ts
// packages/shared/src/phase.ts
export type TripPhase = 'live' | 'final_24h' | 'wrapped_unlocked' | 'ceremony';

export function computePhase(
  trip: { unlockAt: number; ceremonyStartedAt: number | null },
  nowMs: number,
): TripPhase {
  if (trip.ceremonyStartedAt !== null) return 'ceremony';
  if (nowMs >= trip.unlockAt) return 'wrapped_unlocked';
  if (nowMs >= trip.unlockAt - 24 * 3600_000) return 'final_24h';
  return 'live';
}

export type PredictionWindowState = 'open' | 'locked' | 'missed';
export function computePredictionWindow(
  member: { firstDrinkAt: number | null; predictionsLockedAt: number | null },
  trip: { startAtMs: number; ceremonyStartedAt: number | null },
  nowMs: number,
): PredictionWindowState
// startAtMs = tripStartMs(trips.start_date, trips.timezone) — start_date 00:00 trip-local
// closeAt = min(member.firstDrinkAt ?? Infinity, trip.startAtMs)
// predictionsLockedAt !== null → 'locked'   (predictions.locked_at, C7 — no separate submitted_at)
// trip.ceremonyStartedAt !== null && nowMs >= trip.ceremonyStartedAt → 'missed'
//   (C36 — ceremony start force-closes any window still nominally 'open' by the trip-start/
//   first-drink math below; a late joiner can't retain an open window past ceremony)
// nowMs < closeAt → 'open'
// else → 'missed'
```

Prediction window (D10) is **per-member**, independent of `TripPhase`; it stays open from the member's join until the trip begins (`start_date` 00:00 trip-local) — no matter how far ahead of the trip they joined — or until their first logged drink, whichever comes first. A member who joins after the trip has begun finds the window already closed, and ceremony start force-closes any window still nominally open (C36). It is not itself a `TripPhase` value — it's orthogonal state surfaced only on the Log home / Predictions screen.

**C35 — `first_drink_at`**: `trip_members.first_drink_at` (immutable, server receipt time) is set inside the drink-create transaction *only when currently `NULL`* — `UPDATE trip_members SET first_drink_at = :now WHERE trip_id=:t AND user_id=:u AND first_drink_at IS NULL`, in the same `BEGIN IMMEDIATE` as the drink insert (C25). That update *is* the definition of "first drink" for window-closing purposes — there is no separate row-count check. Deletes (including the undo delete→recreate flow, §5) never clear it, so re-logging after deleting one's first drink does not reopen the window. `computePredictionWindow` reads the column directly.

**C25 — race with first-drink create**: to close the race against a concurrent `PUT /predictions/me` (§7) both reading `open` before either commits, the first-drink create's `first_drink_at` update above rechecks that no prediction was locked in the interim before treating the insert as "the first drink" for window-closing purposes — symmetric with §7's recheck on the predictions side.

### Editing theme / unlock time
- Owner may `PATCH` `trips.theme_id` and `trips.unlock_at` while `ceremony_started_at IS NULL`. Once set (ceremony start), both become immutable — server returns `409 conflict` (`ceremony_started`) on further edits.
- **Unlock time edited into the past or within 24h**: allowed, no validation block. `computePhase` reacts immediately (next scheduler tick, ≤15s) — the trip can jump straight from `live` to `final_24h` or even to `wrapped_unlocked` on one tick. **DECISION**: scheduler still emits a `phase.changed:final_24h` event immediately before `phase.changed:wrapped_unlocked` / triggers the wrapped snapshot, even if the client never gets to show the countdown — keeps client state machines simple (they always see every phase transition in order, just possibly milliseconds apart).
- **`unlock_at` change vs. the scheduler markers (C26)**: the `PATCH` clears, in the same transaction as the column update, whichever marker(s) no longer match the new schedule — `final24h_marked_at` cleared if `unlock_at − 24h > now`; `wrapped_unlocked_marked_at` cleared if `unlock_at > now` (clearing the latter also bumps `trips.data_revision` (C37 — `unlock_at` edit is a bump-matrix entry) so a later re-claim's snapshot compute recomputes (C38) instead of finding a stale row and skipping). A marker is never left set for a threshold that is now in the future; §4 owns re-derivation (the next tick re-sets whichever marker's threshold has newly passed, same as on first unlock).

### Mutation matrix after ceremony start (C27)
**DECISION**: drinks can be created/edited/deleted normally through `wrapped_unlocked` (people keep drinking after their Personal Wrapped opens). Once `ceremony_started_at` is set: `POST/PATCH/DELETE /drinks` and the rate action (§5) all return `409 conflict {code: ceremony_started}` (not `403` — the trip isn't "read only" forever, it's specifically frozen by ceremony having started). Predictions need no separate freeze codepath: `computePredictionWindow` now takes `ceremonyStartedAt` (C36, §3) so `PUT /predictions/me` is unreachable (`open` can never be returned) once ceremony has started, for every member regardless of join time. **Favourites and custom drink names are never frozen** — they're account-global (not trip-scoped, 02 §5.9/§5.10), so a member can keep favouriting/renaming across any trip's ceremony state.

**Membership freeze (C36)**: once `ceremony_started_at` is set, no new `trip_members` row can be created — a join attempt (invite-accept, or any future add-member endpoint) returns `409 conflict {code: ceremony_started}`. An invite whose trip already started ceremony still creates the invited user's `users` account and consumes the invite normally (auth is unaffected, C40/C41) — it only skips the `trip_members` insert; the invite-accept response's `trip` field is `null` instead of the trip summary the client would otherwise use to redirect into the trip.

### Drinks outside trip dates
**DECISION**: allowed. `drunk_at` is validated only against the backdating bounds in §5 (`tripStart − 1 day` .. `now + 5 min`), never against `trips.end_date`. Real trips run long or logging starts early; the trip container is the source of truth, not the planned dates.

---

## 4. Scheduler (README D14, C26)

- In-process `setInterval`, `TICK_INTERVAL_MS = 15_000` (15s).
- **Boot backfill**: before starting the interval, run one pass identical to a tick's claim-and-process logic (below) over every trip with `ceremony_started_at IS NULL`. Because the marker is always written atomically with its snapshot work (never before, see below), a marker still `NULL` after a restart unambiguously means that transition never completed — the boot pass reprocesses it and persists any missing personal `wrapped_snapshots` rows before the server starts serving.
- Each tick (and the boot pass), for every trip with `ceremony_started_at IS NULL`:

```ts
export type PhaseTransition = 'final_24h' | 'wrapped_unlocked';
export function pendingTransitions(
  trip: { unlockAt: number; final24hMarkedAt: number | null; wrappedUnlockedMarkedAt: number | null },
  nowMs: number,
): PhaseTransition[]
// ['final_24h'] if now >= unlockAt-24h and final24hMarkedAt is null
// + ['wrapped_unlocked'] if now >= unlockAt and wrappedUnlockedMarkedAt is null
// (both can be returned in the same tick if unlock_at was edited into the past)
```

- **`final_24h`**: no snapshot work, so the marker write is the whole unit — `UPDATE trips SET final24h_marked_at = :now WHERE id = :id AND final24h_marked_at IS NULL`; on success, emit SSE `phase.changed {phase:'final_24h'}` after commit (payload shapes per `03-api.md` §20; channel is already trip-scoped, no `tripId` in the payload).
- **`wrapped_unlocked`**: **DECISION** the marker is written in the *same* `BEGIN IMMEDIATE` transaction as the snapshot work, never before it (fixes the earlier draft, where a crash between marker-write and snapshot-compute could permanently suppress the snapshot). One transaction: (1) compute and insert one `wrapped_snapshots` row per trip member (personal cards payload — see `06`), (2) `UPDATE trips SET wrapped_unlocked_marked_at = :now WHERE id = :id AND wrapped_unlocked_marked_at IS NULL`, (3) commit. If compute throws, the transaction rolls back and the marker stays `NULL` — the next tick (or the boot pass, if the crash took the process down) retries the whole thing from scratch; nothing is ever half-done. After commit: emit SSE `phase.changed {phase:'wrapped_unlocked'}` then `wrapped.unlocked {}`.
- `ceremony_started_at` is **not** scheduler-driven — set synchronously by the owner's `POST /trips/:id/ceremony/start` (C25: one `BEGIN IMMEDIATE` covering `ceremony_started_at` + Squad snapshot + `ceremony_state`; SSE `phase.changed:ceremony` emitted after commit).
- **Snapshot staleness (C11/C24)**: `trips.data_revision` increments per the exact bump matrix in **C37** (drink create/update/delete/rate; prediction submit; member insert or disable; trip `name/start_date/end_date/timezone/unlock_at` edits — explicitly *not* `last_opened_at`, dismissals, theme, or favourites; 05 does not restate that list, only points to it so it can't drift). A personal `wrapped_snapshots` row is stale when its `source_revision < trips.data_revision` — meaningful once a trip has reached `wrapped_unlocked` and before `ceremony`. Per **C38**, the next `GET /wrapped/personal` recomputes **synchronously in-request** (budget < 1s, no background job), commits the new `revision`, then responds — `06` §8 owns the payload/versioning rule itself, 05 only fixes the trigger semantics. Squad snapshot is unaffected — it doesn't exist until ceremony start.

---

## 5. Logging rules

```ts
// C30 — server computes all three from one newest-first scan of this user's trip drinks
// and returns them verbatim from `GET /trips/:tripId/drinks/recents`; the wizard never
// re-derives lastDrink/lastByCategory from a raw log list itself.
export function buildRecents(
  logs: DrinkLite[],          // this user, newest-first by drunkAt
  favouriteKeys: Set<string>, // `${category}|${drinkName}|${sizeMl}`
  anotherKey: string | null,
  cap = 12,
): { lastDrink: DrinkLite | null; lastByCategory: Record<string, DrinkLite>; items: RecentChip[] }
// lastDrink = logs[0] ?? null
// lastByCategory = first (newest) log per category
// items: dedupe by (category,drinkName,sizeMl) keeping newest; favourites sorted first
//   (favourites keep their relative recency among themselves); drop anotherKey
//   unless it's a favourite; cap 12

export function prefillDrink(
  lastByCategory: Partial<Record<string, { drinkName: string; abv: number; sizeMl: number }>>, // C30: from `recents.lastByCategory`
  catalogCategory: CatalogCategory,
): { drinkName: string; abv: number; sizeMl: number }
// lastByCategory[catalogCategory.id] ?? { catalogCategory.drinks[0], sizeMl: catalogCategory.defaultSize }

export function buildAnother(lastDrink: DrinkRow, now: number, venue: VenueSuggestion | null): NewDrinkInput
// lastDrink is `recents.lastDrink` (C30); same category/drinkName/sizeMl/abv, qty=1
// (always reset, not copied), drunkAt=now, venueId=venue?.id ?? null, rating=null, note=null
```

| Rule | Value | Note |
|---|---|---|
| Favourites key | `(category, drink_name, size_ml)` | toggled from Confirm step, stored in `favourites` |
| Custom names | `(user_id, category, name)` — not trip-scoped (02 §5.9) | saved on **Log**, not on typing; ordered by `last_used_at desc` ahead of catalog list |
| Qty step | 0.5, min 0.5 | **DECISION** max 20 (no spec value; guards fat-finger/abuse) |
| `size_ml` bounds | **DECISION** 10–2000 ml | custom-size field; catalog sizes are always in-range |
| ABV bounds | 0–80 | `clampAbv` |
| Note length | ≤ 80 chars | matches wizard field |
| Backdating | `drunk_at ∈ [tripStart(tz) − 1 day, now + 5 min]` | clock-skew slack both for future check and for §11 |
| Rating | 1–5, int | only settable via post-log toast or edit sheet, never at initial Log; **C27**: rating a `soft`-category drink → `422 validation_failed`, server-enforced (not just a UI convention) |
| Undo | single-level, scoped to last action, valid only while its toast is visible (~6.5s window) | see below |

```ts
export function validateDrunkAt(
  drunkAtMs: number, nowMs: number, tripStartDate: string, timezone: string,
): { ok: true } | { ok: false; code: 'drunk_at_future' | 'drunk_at_too_early' }
```

**Undo semantics**
- Create → undo = `DELETE /drinks/:id`.
- Edit → undo = client re-submits the pre-edit snapshot it cached before the optimistic edit (`PATCH /drinks/:id` with the old field values); no server-side history needed.
- Delete → undo = `POST /drinks` with the **same `id`** and the exact prior payload. **DECISION**: `DELETE` is a hard delete (not soft), so recreate is a plain insert — safe because ids are client-generated UUIDv7 and the row genuinely no longer exists. If the undo window elapses and something else reused the id (impossible in practice, UUIDv7 collision-free), the insert would fail with a conflict; client just drops undo silently on that (never observed). If `ceremony_started_at` was set in the meantime, undo instead surfaces the `409 ceremony_started` (C27) notice like any other post-ceremony mutation attempt.
- Achievement unlocks are **not** rolled back by undo of a delete/edit (matches "not revoked on delete" in §8).

---

## 6. Venues & geo (README D8)

**GPS on every log**: `drinks.lat, lng, accuracy, altitude, speed` captured from `navigator.geolocation` at log time (nullable if permission denied or fields unsupported by the browser).

**Offline reverse geocode**: the bundled GeoNames dataset — source file, pinned upstream version/checksum, build/preprocess pipeline, Docker image copy step — is owned by `01-architecture.md`; 05 only fixes the **row schema**, which `01` must not diverge from: `{city, countryCode, lat, lng, population}`, one object per row, shipped at **`apps/server/assets/cities15000.min.json`**. Loaded once into memory at server boot into a **1°×1° lat/lng grid index**: `Map<gridKey, CityRow[]>` where `gridKey = "${Math.floor(lat)}_${Math.floor(lng)}"` (~15k rows total, no need for a real KD-tree).

```ts
// packages/shared/src/geo.ts
export function buildCityIndex(cities: CityRow[]): CityIndex // keyed as above
export function nearestCity(index: CityIndex, lat: number, lng: number): { city: string; countryCode: string } | null
// scan the point's grid cell + 8 neighbours (floor(lat)±1, floor(lng)±1), haversine,
// return nearest; null if index has no cities within ~300km (should not happen with
// cities15000 global coverage)
```

**Venue suggestion (C29)** — server keeps trip venues (`venues` table, trip-scoped, not per-user):

```ts
export async function suggestVenue(
  point: { lat: number; lng: number; accuracyM: number | null },
  tripVenues: VenueRow[],
  userLastVenue: VenueRow | null,
  overpass: OverpassClient | null,
): Promise<
  | { kind: 'existing'; venue: VenueRow }
  | { kind: 'candidate'; name: string; lat: number; lng: number; osmId: string | null }
  | { kind: 'none' }
>
```

1. `accuracyM !== null && accuracyM > 200` → `{kind:'none'}` (poor accuracy; venue chip shows muted "No venue", GPS still stored on the drink).
2. Else compute haversine distance from `point` to every trip venue and to `userLastVenue`; if the nearest is `≤150m` → `{kind:'existing', venue}` (chip renders **solid**).
3. Else if `GEO_VENUE_PROVIDER=overpass`: query Overpass for `amenity∈{bar,pub,restaurant,cafe,nightclub,biergarten}` within 100m, nearest wins, **2s timeout**, result cached server-side keyed by rounded coord (~7-decimal geohash, TTL 1h) → `{kind:'candidate', name, lat, lng, osmId}` (chip renders **dashed**, i.e. a suggestion not yet accepted). `osmId` is the OSM element id when Overpass provides one, else `null`; it's passed through so two members who independently accept the same not-yet-persisted candidate within the same short window resolve to one `venues` row instead of a duplicate (below). Unlike the earlier draft, `osmId` **is** persisted — `venues.osm_id` (nullable), guarded by a partial unique index `(trip_id, osm_id) WHERE osm_id IS NOT NULL` — so the dedupe in the drink transaction is an index-enforced upsert, not a best-effort race (C29).
4. Timeout / `GEO_VENUE_PROVIDER=none` / no result within 100m → `{kind:'none'}`.

**Wire shape** (`GET /venues/suggest` response) matches the function's return exactly: `{kind:'existing', venue} | {kind:'candidate', name, lat, lng, osmId} | {kind:'none'}`.

**Drink create/update `venue` field (C29)** — a discriminated union on shape, not a `kind` tag (the client already resolved the suggestion by the time it logs):

```ts
type VenueInput =
  | { id: string }                                                              // accepted an 'existing' suggestion, or picked from the venue list
  | { candidate: { name: string; lat: number; lng: number; osmId: string | null } } // accepted a 'candidate' suggestion
  | { name: string }                                                             // user typed a name, no suggestion involved
  | null;                                                                        // skipped
```

Server behaviour, **inside the same drink create/update transaction** (C25) — never a separate round trip. `drinks.venue_name` is set alongside `venue_id` in every case below, as the point-in-time display snapshot the Feed renders (§ Rename, below) — this is the authoritative venue contract (C29), and no other doc may redefine it:
- `{id}` → validate it belongs to the trip, set `drinks.venue_id`, `drinks.venue_name = venues.name` (current name, at log time).
- `{candidate:{...}}` → upsert into `venues` keyed on `(trip_id, osm_id)` (reuses a row another member's concurrent accept just created, else inserts `source='osm', osm_id`); set `drinks.venue_id` to the (new or reused) row's id and `drinks.venue_name` to that row's name.
- `{name}` → **no `venues` row is created or upserted.** Sets `drinks.venue_name = name` only; `drinks.venue_id` stays `null`. A bare user-typed name is a per-drink text snapshot, never promoted to the shared trip venue list — only `{id}`/`{candidate}` (i.e. accepting a suggestion or picking from the list) ever create/reuse a `venues` row. (Corrects an earlier draft that upserted `venues` by `(trip_id, name)` here — removed; that behaviour never shipped.)
- `null` → `drinks.venue_id = null`, `drinks.venue_name = null`; GPS fields on the drink are still stored regardless.

A `{kind:'candidate'}` suggestion only ever becomes a persisted `venues` row via this in-transaction upsert on an actual drink log — never eagerly from `GET /venues/suggest` alone (declining/renaming before Log never persists a venue).

- **Rename**: edits `venues.name` in place (`PATCH /venues/:id`). **C10**: this updates the shared `venues.name` for every member's **future** logs against that venue. Past drinks are unaffected — each `drinks` row snapshots `venue_name` at log time (02 §5.7), and the Feed/history render that snapshot, not a live join through `venue_id`. So "this and subsequent logs only" (DESIGN_SPEC §7): old entries keep showing the name they were logged under; only a new drink logged after the rename (or any UI surface that reads `venues.name` directly, e.g. the venue picker) sees the new name.
- **Skip**: `drinks.venue_id = null`; GPS fields on the drink are kept regardless.
- **No permission / poor accuracy (>200m)**: drink still saves; `lat/lng` null (no permission) or present-but-unsuitable-for-venue-matching (poor accuracy) — venue suggestion step 1 above handles the latter; geo-dependent achievements (`mile_high`, `passport`, `pub_crawl`, `regular`) simply don't fire for drinks with null/unreliable geo.
- **Mile-High detection**. **DECISION**: automatic only — `altitude > 3000 OR speed > 100` from the Geolocation reading on that drink (`drinks.altitude` metres, `drinks.speed` m/s). No manual "on a plane" toggle (kept minimal per spec); known limitation: many phones/browsers never populate `altitude`/`speed`, so the achievement under-fires rather than over-fires, which is the safer failure mode for a joke achievement.

---

## 7. Predictions

| Q | Type | Default | Validation |
|---|---|---|---|
| Q1 self total std | stepper | `5 × tripLengthDays` | integer ≥ 0 |
| Q2 squad total std | stepper | `Q1_default × memberCount` (recomputed live if Q1 changes? **DECISION**: default computed once from the *default* Q1, not re-derived if the user edits Q1 — matches "pre-filled with sensible defaults", not a live formula) | integer ≥ Q1 answer not enforced (no ordering constraint) |
| Q3 tops leaderboard | member picker | none | required, one member id |
| Q4 drinks least | member picker | none | required, one member id, **may equal Q3** (no distinctness constraint) |
| Q5 most-ordered drink | drink chip (category + name) | none | required, one `(category, drink_name)` pair — **C31**: `q5_top_drink_category` + `q5_top_drink` / API `topDrinkCategory` + `topDrink`, free text name per C7 — from catalog-popular ∪ already-logged-in-trip |

```ts
export function predictionDefaults(tripLengthDays: number, memberCount: number): { q1: number; q2: number }
// q1 = 5 * tripLengthDays ; q2 = q1 * memberCount
```

- **Window**: `computePredictionWindow` (§3). Submitting while `open` calls `PUT /predictions/me` and sets `locked_at = now` — **immutable** thereafter (a further `PUT` → `409 conflict` `already_locked`, per `03-api.md` §15). There is no separate `submitted_at` column (C7); "submitted" and "locked" are the same instant. **C25**: this write runs under `BEGIN IMMEDIATE` and *rechecks* `computePredictionWindow(...) === 'open'` inside the transaction (not just at request start) — closes the race where a concurrent first-drink create (which can retroactively close the window, §3) and a prediction submit both read `open` before either commits. If the recheck fails, respond as `missed`/`locked` (whichever the recheck now shows), never persist the submission.
- **Missed**: window resolves to `missed` with `locked_at` still `NULL`. Client shows the dismissible banner once; dismissal persists via `trip_members.missed_banner_dismissed` (`POST /trips/:tripId/predictions/me/dismiss-missed`, C7) — server-side, not local storage, so it doesn't reappear on another device.
- **Visibility (C8, C31)**: predictions are never returned to anyone (not even to admin/owner/the author's own unlocked draft) until they surface **inside the Squad Wrapped payload**, served once `trips.ceremony_started_at` is set — there is no `ceremony_state` card-index gate column. Before that, `GET /predictions/me` always returns `answers: null` plus the caller's own `locked`/`open`/`missed` state (so the UI can render "Locked in") — `q1..q5` are never echoed back pre-ceremony under any state, and `GET /predictions/status` exposes only submission counts for everyone else.
- **Oracle scoring**: defined here (05 owns it, C9); `06-metrics-wrapped.md` §6.3 links back to this formula for the Oracle award and the `prediction_vs_reality` card — it must not redefine it. For each member who submitted (not missed), per-question normalized error in `[0,1]`:

```
q1Err = min(1, |predicted_q1 - actual_self_std| / max(actual_self_std, 1))
q2Err = min(1, |predicted_q2 - actual_squad_std| / max(actual_squad_std, 1))
q3Err = predicted_q3_member === actual_top_member ? 0 : 1
q4Err = predicted_q4_member === actual_least_member ? 0 : 1
// q5Err is only computed when actualTopDrink(...) !== null — see below
q5Err = (predicted_q5_category === actualTopDrink.category &&
         normalizeDrinkName(predicted_q5_topDrink) === normalizeDrinkName(actualTopDrink.drinkName)) ? 0 : 1
oracleScore = actualTopDrink !== null
  ? (q1Err + q2Err + q3Err + q4Err + q5Err) / 5   // 0 = perfect, 1 = worst
  : (q1Err + q2Err + q3Err + q4Err) / 4           // edge rule below: no top drink exists
```

**Edge rule — no drinks logged**: if `actualTopDrink(tripDrinks)` returns `null` (trip-wide zero drinks; see its own null case below), there is no "actual top drink" for Q5 to be scored against at all — Q5 is **excluded** from every submitter's `oracleScore`, which then averages **q1–q4 only** (denominator 4, not 5). This is the only condition that changes the denominator; whenever a top drink exists but a member's own Q5 guess just doesn't match it, `q5Err` still contributes its normal `0`/`1` and the denominator stays 5.

**C31 — Q5 match is exact on `(category, normalized name)`**, never name-only: a correct drink name in the wrong category scores as a miss.

```ts
export function normalizeDrinkName(name: string): string
// owned by 06 §1.2, must implement exactly: trim → casefold → collapse internal
// whitespace runs to a single space. 05 depends on this exact definition for Q5 matching.

export function actualTopDrink(tripDrinks: { category: string; drinkName: string; qty: number }[]): { category: string; drinkName: string } | null
// group by (category, normalizeDrinkName(drinkName)), sum qty (C21) per group, return the
// argmax group's (category, drinkName) — the group's own (not necessarily normalized) name
// as most recently logged is fine for display; the *comparison* in q5Err always
// re-normalizes both sides. Ties: lower category name, then lower normalized drink name
// (deterministic; a true Σqty tie across two distinct drinks is a rare edge case, not a
// product decision worth surfacing). null if the trip has zero drinks.
```

Oracle award = lowest `oracleScore` among submitters; ties broken by lower `q1Err`, then earlier `locked_at`. Members who missed the window are excluded from Oracle eligibility (but still get all other awards).

**Division guards — every divide in this doc, and why it can't NaN/Infinity**:

| Formula | Divide | Guard | Zero-input result |
|---|---|---|---|
| `ethanolGrams` (§1) | `abvPercent / 100` | constant denominator | `abvPercent = 0` (zero-alcohol drink) → `0`, defined |
| `stdDrinks` (§1) | `ethanolGrams(...) / 10` | constant denominator | `0` grams → `0.0` std, defined |
| `posToAbv` (§1) | `pos / 10` | constant denominator | n/a (pos is always ≥0) |
| `abvToPos` (§1) | `(abv - 15) / 0.5` | constant denominator | n/a |
| `q1Err` (above) | `... / max(actual_self_std, 1)` | floors the denominator at `1` — never a literal `0` | `actual_self_std = 0` (zero-std member) → denominator `1`, `q1Err = min(1, predicted_q1)`, a defined number, never `NaN` |
| `q2Err` (above) | `... / max(actual_squad_std, 1)` | same floor-at-1 guard | `actual_squad_std = 0` (zero-std trip, e.g. everyone logged only soft drinks) → same defined-number outcome as `q1Err` |
| `oracleScore` (above) | `(...) / 5` or `(...) / 4` | denominator is a fixed count of *included* terms (never a measured/zero-able value) | n/a — the edge rule above only changes which fixed denominator applies, it's never computed from a quantity that could be zero |

No formula in this doc divides by a raw, unguarded `std`/`qty`/count that could be `0`; every divide above is either a constant or explicitly floored. (06-metrics-wrapped.md owns any additional divisions in rating/rank/archetype formulas — out of scope for this doc.)

---

## 8. Achievements engine

**C25 — evaluated and persisted inside the mutation transaction, create/update only.** `POST/PATCH /drinks` runs under `BEGIN IMMEDIATE`; achievement evaluation happens *inside that same transaction*, after the drink row is written but before commit (not a separate job/queue, not "after commit" — needed so `century`'s trip-wide count-crossing check is race-free, and so a crash before commit never leaves a drink persisted without its achievements, or vice versa). Each check re-queries only what it needs (indexed by `trip_id, user_id, drunk_at`). `DELETE /drinks` **never calls this at all** — deletes only preserve existing unlocks, they can't create new ones (every predicate below is monotonically non-increasing under removing a drink, so there is nothing to (re-)evaluate).

```ts
export function evaluateAchievements(
  trigger: { drink: DrinkRow; op: 'create' | 'update' }, // no 'delete' — C25
  context: AchievementContext, // scoped repo access, see per-row "data needed"; same tx/connection as the drink write
): Promise<AchievementUnlock[]>  // newly-unlocked only, already persisted (same transaction)

// C42 — persisted row shape (achievement_unlocks) and the DTO returned above are the same fields:
type AchievementUnlock = {
  key: string;                 // achievement_key
  userId: string | null;       // null only for `century` (group)
  triggeredByUserId: string;   // always the earner — set even when userId is null (C42)
  tripId: string;
  drinkId: string | null;
  unlockedAt: number;
  vars: Record<string, string | number>; // copy-interpolation vars, see table below; {} when none
};
```

**Uniqueness**: `(trip_id, user_id, achievement_key)` unique in `achievement_unlocks` for all personal keys. `century` is trip-wide: uniqueness key is `(trip_id, achievement_key) WHERE user_id IS NULL`, `triggered_by_user_id` records the earner. **Not revoked on delete** — once inserted, a row is never removed even if the underlying count later drops (e.g. a rated drink deleted after `critic` fired); combined with the rule above, deletes are purely non-destructive of `achievement_unlocks` in both directions — no new rows, no removed rows.

**Backdated drinks** are evaluated using `drunk_at`, not `created_at`/insert time, for every time-windowed predicate below — inserting an old drink can retroactively satisfy a trigger; the achievement still fires "now" (banner + feed post use current time, `unlocked_at = now`), only the *predicate* looks at historical `drunk_at`.

**Vars (C42)** — every row persists `vars` (json); only two keys use it, everything else persists `vars: {}`:
- `century` → `vars: { n: 100 }` — the fixed milestone threshold (v1 has one tier), not the exact crossing total (which can be e.g. `100.5`); copy reads `{n}` as "100", never the raw Σqty.
- `regular` → `vars: { venue: <name> }` — the qualifying venue's `venues.name`, **snapshotted at unlock time** (same rationale as `drinks.venue_name`, C10): a later rename must not retroactively change already-earned copy.

Banner queuing (one at a time) is client-side; server emits one `achievement.unlocked` SSE event per new unlock, **after the transaction commits** (C25 — SSE always follows commit):
`{ tripId, userId, triggeredByUserId, achievementKey, drinkId, unlockedAt, vars }`. **Group achievement feed/toast copy always resolves the earner's display name via `triggeredByUserId`, never `userId`** (C42) — `userId` is `null` for `century`, so any renderer keying off it alone would have no name to show.

| Key | Predicate | Earner(s) | Data needed | Edge cases |
|---|---|---|---|---|
| `first_blood` | User's 1st ever drink row in the trip (by `drunk_at` rank, evaluated after insert) | that user | `COUNT(drinks WHERE trip_id,user_id)` | backdating an *earlier* drink after the fact does not re-trigger (uniqueness) even though it's now "actually" first |
| `five_in_hour` | `Σqty` (already C21-consistent, not row count) over this user's drinks with `drunk_at` in any rolling 60-min window `≥ 5`, evaluated by sliding the window ending at each of the user's drinks in the trip (re-check on every create/update since backdating can create the window anywhere) | that user | user's `drinks(drunk_at, qty)` in trip | 5 half-pours (`qty=0.5` × 10) counts; a single `qty=5` log alone also counts |
| `pit_stop` | For this user's `drunk_at`-ordered sequence, a `soft` drink with an alcoholic drink immediately before **and** after it | that user | user's drinks ordered by `drunk_at`, need `category` | inserting/backdating a drink in the middle of an existing sequence can create this pattern retroactively |
| `pub_crawl` | ≥4 distinct `venue_id` for this user within one `dayIndex` (trip-night, §2) | that user | user's `(venue_id, drunk_at)` in trip | drinks with `venue_id = null` don't count toward distinct venues |
| `mile_high` | `altitude > 3000 OR speed > 100` on the triggering drink | that user | `drinks.altitude, speed` | most devices never populate these — expected under-fire (§6) |
| `cheers` | ≥3 **distinct members'** drinks with `drunk_at` within any 60s window | **all** members whose drink falls in that qualifying window | trip-wide `drinks(user_id, drunk_at)` near the trigger's `drunk_at` | each qualifying member gets their own unlock row (subject to per-user uniqueness) — a 4th/5th person joining an existing 60s cluster still individually unlocks if they hadn't already |
| `after_3am` | Trigger drink's `drunk_at`, converted to trip `timezone`, local time `∈ [03:00, 06:00)` | that user | `drunk_at`, `trips.timezone` | uses the same tz conversion as day-boundary math, but *not* shifted by 06:00 (raw local clock time) |
| `critic` | `COUNT(drinks WHERE trip_id,user_id, rating IS NOT NULL) ≥ 20` | that user | user's rated-drink count | a later deleted rated drink can drop the count below 20 without revoking |
| `century` | **C21**: trip-wide `Σqty` crosses 100 on this insert (i.e. total was `< 100` before this drink's `qty` is added, `≥ 100` after — computed inside the same transaction as the insert, C25, to avoid a race) | **group** — `achievement_unlocks.user_id = NULL` (02 §5.12), `triggered_by_user_id` = the earner (C42); `drink_id` = the triggering drink | trip-wide `Σqty` | Σqty, not row count, matches every other user-facing "drinks" count (C21) — "100 drinks" means 100 standard units logged, half-pours included; deletes never re-open the trigger (uniqueness on `(trip_id, achievement_key) WHERE user_id IS NULL`) even if the total drops back below 100; `vars.n = 100` (C42) |
| `passport` | ≥2 distinct `country_code` among this user's drinks with `drunk_at` within any rolling 24h window | that user | user's `(country_code, drunk_at)`, requires geo reverse-lookup to have resolved | drinks with `country_code = null` (no GPS) are excluded from the distinct-count, never block it |
| `regular` | **DECISION** "visit" = distinct `(dayIndex, venue_id)` pair, `venue_id IS NOT NULL` — not raw drink count — `COUNT(DISTINCT dayIndex WHERE venue_id = v) ≥ 5` for some venue `v` | that user | user's `(venue_id, drunk_at)` | multiple drinks at the same venue on the same trip-night count as one visit; drinks with `venue_id = null` never count toward any venue's visits (identical `visitKey` definition in `06-metrics-wrapped.md` §1.2/§2.3 — used by `venue_loyal` and "most-visited venue"); `vars.venue` = that venue's name, snapshotted (C42) |

---

## 9. Leaderboard

**Main ranking (C23)** — one shared function, `packages/shared`, used by both the live leaderboard and every Wrapped rank list; no bespoke `ORDER BY`/comparator may reimplement this ordering:

```ts
// packages/shared/src/rank.ts
export function rankMembers<T extends { value: number; qty: number; joinedAt: number; userId: string }>(
  rows: T[],
): T[]
// sort by: value desc → qty (Σqty, C21) desc → earliest joinedAt asc → userId asc (deterministic
// last resort). `value` is whatever the board is ranked on (std total for the live leaderboard;
// the relevant stat for a given Wrapped rank list) — callers annotate rows with `qty` = that
// member's Σqty as the shared tie-break key regardless of what `value` itself measures.
```

**Columns** (from theme pack `leaderboard.columns`, README §4 "server never branches on theme for layout except columns"):

| Pack | Columns | Definition |
|---|---|---|
| Classic | `std`, `drinks` | `std` = `stdDrinks` sum; `drinks` = `Σqty` (C21 — half-quantities count 0.5, not row count) |
| CS2 | `k`, `a`, `d`, `rating` | see below |

Wire keys in the leaderboard response's `values` object are lowercase — `{std, drinks, k, a, d, rating}` (C16) — regardless of the pack; client maps them to column labels via `leaderboard.columns`.

```ts
export function computeK(userStdTotal: number): number  // = userStdTotal
export function computeD(drinks: DrinkLite[]): number
// Σqty (C21/C44) over drinks where category === 'soft' — not row count
export function computeA(userDrinks: DrinkLite[], othersDrinks: DrinkLite[]): number
// Σqty (C21/C44) of userDrinks[i] such that ∃ a drink in othersDrinks with
// |drunk_at_i - drunk_at_other| <= 60_000ms  (±60s, per-drink not per-pair) — sum each
// qualifying drink's own qty, not a count of qualifying drinks
```

**C44**: `computeD` and `computeA` both sum `qty` (Σqty), never row count — consistent with every other user-facing "drinks" quantity in this doc (C21). A half-pour soft drink (`qty=0.5`) contributes `0.5` to `d`, not `1`; a half-pour logged within ±60s of another member contributes `0.5` to `a`, not `1`.

**Drink Rating 2.0**: formula owned by `06-metrics-wrapped.md` §2.5 (`drinkRating2`) — C9. Do not redefine it here; the CS2 `rating` column value is that function's output, displayed to 2 decimals.

**Masking in final 24h (C20, C16)** — server-enforced, `computePhase(...) === 'final_24h'`:
- Applies to: `GET /trips/:id/leaderboard` (main + side boards, both Classic and CS2 column sets) — server returns members **alphabetical by name**, `rank: null` and `values: null` per member (C16 — a plain null, no server-chosen placeholder text; client renders its own dash/"?" from the null).
- **Does not apply** to: `GET /trips/:id/dashboard` totals (your own total, squad aggregate total — these are not comparative/ranked), Feed (`GET /trips/:id/feed`, still returns each drink's own `std` value and rating), achievement feed rows, ratings history (personal).
- **C20 — this is suspense, not secrecy**: masking is scoped strictly to the per-member *comparative* endpoints above; it makes no confidentiality guarantee. Feed still shows every member's individual drinks (per design), so a determined user can reconstruct approximate ranks by hand from Feed during final-24h — that's accepted, not a bug. The goal is to keep the leaderboard itself from spoiling "who's winning" at a glance, not to make rank data unrecoverable.

---

## 10. Dashboard aggregates

```ts
export function totalsFor(scope: 'you' | 'squad', drinks: DrinkLite[]): { stdTotal: number; drinkCount: number }
// drinkCount = Σqty (C21 — half-quantities count 0.5), not row count
export function squadByDay(drinks: DrinkLite[], tripStartDate: string, timezone: string, tripLengthDays: number): { dayIndex: number; std: number; isFuture: boolean }[]
// buckets by dayIndex(); days > max(observed dayIndex so far, today's dayIndex) up to
// tripLengthDays are emitted with std=0, isFuture=true (rendered as neutral stubs)
export function byCategory(drinks: DrinkLite[]): { category: string; std: number; count: number }[]
// count = Σqty per category (C21)
export function ratingsHistory(drinks: DrinkLite[]): { drinkId: string; drinkName: string; rating: number; drunkAt: number }[]
// this user's rated drinks, newest first
export function recentGroupAchievements(unlocks: AchievementUnlock[], cap = 5): AchievementUnlock[]
// newest first by unlockedAt, cap 5 (leaderboard tab "Just unlocked" / "Highlights")
// group-key rows (`century`) have userId: null — feed/toast copy resolves the earner's
// display name via triggeredByUserId, never userId (C42, §8)
```

All aggregate over `drunk_at`, not `created_at` (so backdated drinks land in the right day/category bucket retroactively).

---

## 11. Offline sync (README D7, C28)

- **Client queue**: IndexedDB-backed FIFO per `drinkId`. **The app outbox is the sole replay owner (C28)**: Workbox/service-worker caching must never intercept, cache, or replay any `/api/v1` mutation — no background-sync registrations, no cache-then-network on write routes. `07-frontend.md` owns the Workbox wiring; this boundary is fixed here so it can't drift.
- **Op schema (C28)** — replaces the previous ad hoc shape; one row per queued mutation:

```ts
type OfflineOp = {
  clientOpId: string;   // UUIDv7, generated at enqueue — idempotency key (distinct from drinkId)
  tripId: string;
  type: 'create' | 'update' | 'delete' | 'rate';
  drinkId: string;      // client-generated UUIDv7 for 'create'; existing id otherwise
  payload?: NewDrinkInput | DrinkPatch | { rating: number }; // absent for 'delete'
  clientNowMs: number;  // device clock at enqueue time — the conflict/skew key, below
  userId: string;
};
```

`rate` is a distinct op type (previously folded into `update`) so an offline rating can't clobber a concurrent field edit applied from another device. Processed strictly in FIFO order per `drinkId`, one in-flight request at a time; a later op for the same id waits behind an earlier one.

- **Enqueue triggers (C47)**: an op is queued on a network error **or** on a `401` response to a *live* (non-flush) mutation attempt — not network errors only. A `401`-triggered enqueue keeps the op tagged with its original `userId` (op schema, above); the outbox does not attempt to flush it (or anything behind it in that `drinkId`'s FIFO) until that same user re-authenticates (new session for the same `user_id`) — signing in as a different user never flushes another user's queued ops.
- **Idempotency ledger (C34)** — table `applied_ops (client_op_id PK, user_id, trip_id, drink_id, type, status_code, response json, applied_at)`, written in the **same transaction** as the mutation it records (drink create/update/delete/rate, C25). `POST /trips/:tripId/drinks/sync` looks up `applied_ops` by `client_op_id` first (never `drinkId` — the two are intentionally distinct identifiers, C34, op schema above): a hit replays the stored `status_code`/`response` **verbatim**, without re-running any mutation or conflict logic, even if a *different* op already changed the drink since; a miss executes the op, then inserts the `applied_ops` row before commit. **Undo is never a replay** (§5): undo always mints a new `clientOpId` for its compensating op (delete-undo's recreate, edit-undo's re-submit) — a new `applied_ops` row, not a lookup of the original op's stored response.
- **Conflict & skew — both keyed off `clientNowMs` (C28)**, and only reached on an `applied_ops` **miss** (a replay short-circuits before any of this runs, C34):
  - **Skew** shifts timestamps in the payload (`drunkAt` on create/update) so they land relative to server-true time, not a possibly-wrong device clock:
    ```ts
    export function adjustDrunkAtForSkew(drunkAtMs: number, clientNowMs: number, serverNowMs: number): number
    // skew = serverNowMs - clientNowMs
    // |skew| > 2*60_000 → drunkAtMs + skew   (shift by the skew so "now"-logged
    //   drinks land at the server's real now; explicit backdating is shifted
    //   by the same delta, preserving the user's chosen offset from "now")
    // else → drunkAtMs unchanged
    ```
  - **Conflict**: last-write-wins by `clientNowMs`, not server arrival order — if two ops for the same `drinkId` reach the server out of enqueue order (e.g. a reconnect flushes a backlog after another device's op already landed online), the op with the larger `clientNowMs` wins; `drinks.updated_at` is set from that op's skew-adjusted server-equivalent time. The losing (smaller `clientNowMs`) op is a silent no-op if it arrives after — not an error, since it's a legitimate same-user, different-device edit, not a data-integrity problem. A queued `delete` always wins over any `update`/`rate` for the same id regardless of `clientNowMs` — nothing to conflict with once the row is gone. No optimistic-concurrency version check beyond this; only one device is realistically editing a given drink offline in this app, so more machinery isn't worth it.
- **Ordering**: FIFO per `drinkId` client-side (above) is sufficient; cross-id ordering doesn't matter (drinks are independent rows).
- **Failure codes → client behaviour** (C27's `409` is `ceremony_started` only now — the old "409 = conflict, re-fetch" case is superseded by the silent `clientNowMs` resolution above):

| Code | Behaviour |
|---|---|
| `401` | Enqueue (or keep queued) under the op's original `userId`; flush resumes only once that same user re-authenticates (C47) |
| `403` (drink belongs to another user) | Discard the queued op, show a non-blocking notice |
| `409 ceremony_started` (C27) | Discard the queued op, show a non-blocking notice ("trip is closed") |
| `422 validation_failed` (incl. rating a `soft` drink, C27) | Drop the op, show a notice (validation can't be fixed by retrying without user input) |

---

## 12. Theme switching

- Server persists only keys: `trips.theme_id`, `achievement_unlocks.achievement_key`, award/archetype/rank keys computed in `06`. No label, name, or copy is ever stored.
- Client resolves every label at render time via `packages/content` pack lookup (`themes/<theme_id>.json`), keyed off the trip's current `theme_id` — so retheming (owner changes theme pre-ceremony) instantly relabels every already-earned achievement/award without any data migration.
- **CI check**: a script (`packages/content/scripts/check-key-parity.ts`) walks both `classic.json` and `cs2.json` (and any future pack) and asserts identical key sets at every nesting level (recursing into `achievements`, `awards`, `archetypes`, `ranks`, `wrappedPersonal.cards`, `wrappedSquad.cards`, etc.); fails CI on any missing/extra key path. Runs in the same job as `packages/content` typecheck.

```ts
export function assertKeyParity(packA: unknown, packB: unknown): string[]
// returns list of mismatched dotted key paths; [] = parity OK
```
