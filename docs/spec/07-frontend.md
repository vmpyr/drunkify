# 07 — Frontend

`apps/web`. Vite + React 19 + React Router + TanStack Query + Zustand + vite-plugin-pwa. Content/tokens from `packages/content` / `packages/design-tokens`, sourced verbatim from `design/`. All API paths below are canonical per `03-api.md` and README §5 (C12); §11 is a verified mapping, not an open list of assumptions.

---

## 1. App shell

### 1.1 Route table

| Path | Screen | Auth guard | Screenshot ids (classic / cs2) |
|---|---|---|---|
| `/sign-in` | Sign in | `public-only` (redirect to post-login target if session valid) | 26, 27, 28 (sheet) |
| `/i/:token` | Invite landing | `public` (token-gated, works signed-in or out) | 30 |
| `/i/:token/create` | Create account | `public`, requires valid unaccepted invite in state | 31, 32 (post-success toast) |
| `/r/:token` | Set a new password | `public`, requires valid reset token | 34 |
| `/link-problem` | Link problem | `public`; reached only via redirect, never typed — state passed via router `state` (`{ kind: 'expired'\|'used'\|'revoked'\|'invalid'\|'resetExpired', inviterName? }`); hard reload falls back to `invalid` | 33 (expired shown; other 4 kinds are the same component, different content key) |
| `/setup` | Finish setting up | `session + mustChangePassword` (redirect elsewhere once done) | 29 |
| `/no-trip` | No trip yet | `session`, no trip guard (shown when `trips.length === 0`) | 35 (admin), 36 (member) |
| `/trips/new` | Create trip | `session + isAdmin` | — (new screen, no shot; spec in §1.3) |
| `/t/:tripId/log` | Log home | `session + tripMember(tripId)` | 01, 01b, 07 (empty), 11 (final 24h — countdown only, board is what masks), 25 (light mode) |
| `/t/:tripId/board` | Leaderboard ("The Tab" / theme label) | `session + tripMember(tripId)` | 08, 09, 11 (masked board) |
| `/t/:tripId/feed` | Feed | `session + tripMember(tripId)` | 10, edit sheet reuses 06 |
| `/t/:tripId/wrapped` | Wrapped tab (locked teaser → routes onward) | `session + tripMember(tripId)` | 15 (unlocked teaser), 21/22 (squad teaser, embedded) |
| `/t/:tripId/predictions` | Predictions (form / locked / missed) | `session + tripMember(tripId)` | 07 (entry card), 12, 13, 14 |
| `/t/:tripId/wrapped/personal` | Personal Wrapped story | `session + tripMember(tripId) + wrappedUnlocked(tripId)` | 15–20 |
| `/t/:tripId/ceremony` (`?display=big` per README D5) | Squad Wrapped / ceremony | `session + tripMember(tripId)`; `display=big` skips phone chrome for TV/laptop casting | 21 (locked guest), 22 (locked owner), 24 (cast reveal); 23 (presenter remote) **not built** — README D5 |
| `/people` | People (admin) | `session + isAdmin` | 38, 39 (member sheet is a route-level overlay, not a sub-route) |
| `/account` | Account | `session` | 43 |

Not routes (overlays, driven by `ui` Zustand store, layered over whatever route is active): Log wizard, Edit drink (same sheet, `mode: 'edit'`), Toast, Achievement banner, Trip switcher sheet, Invite sheet, Member sheet, Forgot-password sheet. Rationale: these must survive tab switches inside a trip and must not fight the router's back-stack; instead each open sheet pushes a synthetic `history.pushState` entry so the hardware/gesture back button closes the sheet before leaving the route (see BottomSheet, §5).

Guard semantics:

| Guard | Behaviour on fail |
|---|---|
| `public-only` | If a valid session exists, redirect to post-login target (§1.4) instead of rendering |
| `session` | No/expired session → store attempted URL as pending redirect (session storage key `drunkify.returnTo`), navigate to `/sign-in` |
| `mustChangePassword` | If false, redirect to post-login target |
| `isAdmin` | Non-admin → redirect to `/no-trip` or last trip's log home |
| `tripMember(tripId)` | Not a member of `tripId` (or trip doesn't exist) → redirect to `/no-trip`; membership resolved from bootstrap trip list, not re-fetched per route |
| `wrappedUnlocked(tripId)` | Not yet unlocked → redirect to `/t/:tripId/wrapped` (teaser) |

### 1.2 Deep-link return-to

1. Any `session`-guarded route hit without a session: `sessionStorage.setItem('drunkify.returnTo', location.pathname + location.search)`.
2. On successful sign-in / create-account: read and clear `drunkify.returnTo`. Priority order:
   `mustChangePassword` → `/setup`, else `returnTo` if present and still valid (trip still exists/member) → `returnTo`, else last-opened trip → `/t/:lastTripId/log`, else `/no-trip`.
3. Invite/reset tokens in the URL (`/i/:token`, `/r/:token`) are never overwritten by `returnTo` — they win on direct load.
4. Push-notification / SSE-driven navigation targets (V1.1, currently in-app only per README D4) use the same `returnTo` mechanism for consistency, unused in V1.

### 1.3 `/trips/new` — Create trip (README D9)

Admin-only form, single screen, no wizard (this is a low-frequency admin action, not a 1 a.m. flow).

| Field | Type | Default | Notes |
|---|---|---|---|
| Name | text, 1–40 chars | — | required |
| Start date | date | today | |
| End date | date | start + 6 days | must be ≥ start |
| Timezone | IANA tz picker (searchable list) | device tz (`Intl.DateTimeFormat().resolvedOptions().timeZone`) | stored on trip; drives day-boundary math (06:00 local, `02-data-model.md`) |
| Theme | picker: card per pack (`themes/*.json`), shows pack `name` + one line from `voice`, tap to play a **voice sample** (see below) | `classic` | changeable until ceremony starts (§6.12 DS) |
| Wrapped unlock time | date-time picker, pre-filled | **end date, 20:00 in trip timezone** | editable by owner later (`owner.unlockLabel`) |

- "Voice sample" = a short representative line drawn from the pack at build time (e.g. `wrappedPersonal.ready.body` or `wrappedSquad.ownerSub`), rendered as static text under the theme card — no audio, "voice" = tone-of-copy, not a sound file.
- Submit → `POST /api/v1/trips` with `{ name, startDate, endDate, timezone, themeId, unlockAt }` (field is `unlockAt` per `03-api.md` §7, not `wrappedUnlockAt`). Creator becomes `owner` + is auto-added as a `trip_members` row.
- Success → the new trip becomes "last-opened", navigate to `/t/:tripId/log` (empty state, `07`).
- No screenshot exists for this screen; build to the shared text-field/primary-button components (§6.13.2 DS) with a `screenTitle` "Create a trip".

### 1.4 Last-opened trip memory

- `localStorage['drunkify.lastTrip.<userId>'] = tripId`, written whenever a `/t/:tripId/*` route mounts.
- Read at `/no-trip`-vs-trip decision time in the root loader and on sign-in redirect (§1.2). Keyed by `userId` so a shared device with two accounts doesn't cross-contaminate.
- If the stored tripId is no longer in the bootstrap trip list (removed, or membership revoked), fall back to the first trip or `/no-trip`.

---

## 2. State

### 2.1 TanStack Query keys

| Key | Fetches | Notes |
|---|---|---|
| `['bootstrap']` | `GET /api/v1/bootstrap?tripId=` | `{me, trips, currentTrip: {trip, summary}\|null, serverTime}` (03 §8) — `staleTime: Infinity`, manually invalidated on sign-out/account changes; bumps `trip_members.last_opened_at` for `currentTrip` |
| `['trip', tripId]` | `GET /api/v1/trips/:tripId` | `{trip, members, serverTime}` — name, dates, tz, themeId, unlockAt, phase |
| `['trip', tripId, 'members']` | `GET /api/v1/trips/:tripId/members` | avatar colours, roles; `email` present only for admin or self |
| `['trip', tripId, 'dashboard']` | `GET /api/v1/trips/:tripId/dashboard` | `{totals, byDay, byCategory, recentAchievements}` — one round trip for Log home totals + Board tab's charts + "Just unlocked" panel (03 §13; replaces the old totals/charts/achievements split) |
| `['trip', tripId, 'recents']` | `GET /api/v1/trips/:tripId/drinks/recents` | `{lastDrink, lastByCategory, items}` (C30) — `items` = favourites-first, cap 12, deduped by cat+drink+size |
| `['trip', tripId, 'feed', filter]` | `GET /api/v1/trips/:tripId/feed?filter=mine\|everyone` | `filter ∈ {mine, everyone}`, paginated by day |
| `['trip', tripId, 'leaderboard']` | `GET /api/v1/trips/:tripId/leaderboard` | server applies masking during `final_24h` — masked rows carry `rank:null`, `values:null` (C16); own `recentAchievements` (last 2) embedded, no separate call for the Board tab; client never computes masking |
| `['trip', tripId, 'predictions', 'me']` | `GET /api/v1/trips/:tripId/predictions/me` | own prediction state + `deadlineAt`; `answers` is always `null` pre-ceremony (C31) — populated only inside the Squad Wrapped payload after ceremony start |
| `['trip', tripId, 'stats', 'ratings']` | `GET /api/v1/trips/:tripId/stats/ratings` | caller's own rating history only, items `{drinkId, drinkName, category, rating, drunkAt}` (`drunkAt` epoch ms, C19); **not masked** during `final_24h` — it's personal history, not a comparative view (C20) |
| `['trip', tripId, 'predictions', 'status']` | `GET /api/v1/trips/:tripId/predictions/status` | `{submitted, total}` — "{n} of {total} have predicted" |
| `['trip', tripId, 'wrapped', 'status']` | `GET /api/v1/trips/:tripId/wrapped/status` | drives locked/teaser state for both Personal and Squad tabs |
| `['trip', tripId, 'wrapped', 'personal']` | `GET /api/v1/trips/:tripId/wrapped/personal` | 14 card payloads (`06-metrics-wrapped.md`); `payload:null` until unlock |
| `['trip', tripId, 'wrapped', 'squad']` | `GET /api/v1/trips/:tripId/wrapped/squad` | 11 card payloads, incl. replay events on card 6 (C12 — no separate `/wrapped/replay` endpoint) |
| `['trip', tripId, 'ceremony']` | `GET /api/v1/trips/:tripId/ceremony/state` | `CeremonyState {status, cardIndex, subStep, held, updatedAt}` — `status` incl. terminal `ended`; per-card `subStep` counts, `hold`, next/back bounds and transitions, and restart-from-`ended` (owner-only, `POST .../restart`, resets to card 0) all follow `03-api.md`'s exhaustive card transition table exactly — polled fallback if SSE drops |
| `['people']` | `GET /api/v1/people` | admin-only: members across all trips (not `/admin/people`); Invites section comes from `GET /invites` |
| `['me']` | `GET /api/v1/me` | own profile, `displayThemePref` — replaces the old `['account']` / `GET /api/v1/account` key |
| `['config']` | `GET /api/v1/config` | `{mapStyleUrl, geoProviderEnabled, mailerEnabled}` |

`packages/shared` Zod schemas back every response type; Query's `queryFn` return type = the Zod-inferred type, no `any`.

### 2.2 SSE → invalidation map

Three channels (C13), all cookie-authenticated `EventSource`s: `/api/v1/me/events` opened once at app-shell load (always), `/api/v1/admin/events` additionally when `role='admin'`, and one `/api/v1/trips/:tripId/events` per currently-viewed trip. Each channel delivers a `hello {serverTime}` event on connect (re-syncs the §2.5 offset). No replay buffer — reconnect with backoff, then invalidate everything for that channel's scope (cheap correctness over diffing a gap).

| SSE event | Channel | Invalidates | UI side-effect |
|---|---|---|---|
| `drink.created` | trip | `feed`, `dashboard`, `leaderboard`, `recents` (if from self), `wrapped.personal`* | none if from others (silent); feed row appears live |
| `drink.updated` | trip | `feed`, `dashboard`, `leaderboard`, `wrapped.personal`* | none |
| `drink.deleted` | trip | `feed`, `dashboard`, `leaderboard`, `wrapped.personal`* | none |
| `achievement.unlocked` | trip | `dashboard`, `leaderboard`, `feed` | Achievement banner (own) or feed row (everyone) — see §6.4 DS queue |
| `phase.changed` | trip | `trip`, `leaderboard`, `dashboard`, `wrapped.status`, `predictions.me` + `predictions.status` | masking/countdown state re-evaluates on next render of the affected tab; no forced navigation |
| `member.joined` | trip | `members`, `people` (if admin viewing), `wrapped.personal`* | live update for members already viewing this trip; a no-trip user is not on this channel — see `trip.added` below (C32) |
| `trip.added` | me | `bootstrap` | no-trip user added to a trip (C32) — bootstrap refetch flips `/no-trip` to the new trip's log home |
| `member.removed` | trip | `members`, `people`, `bootstrap`, `wrapped.personal`* | if it's *you*, force sign-out client-side |
| `trip.updated` | trip | `trip` (theme/unlock-time change), `wrapped.personal`* | if on `/t/:tripId/wrapped/personal` or ceremony, re-resolve content pack if `themeId` changed |
| `wrapped.unlocked` | trip | `trip`, `wrapped.status`, `wrapped.personal` | system-style in-app banner (README D4: push deferred → in-app only) routes to unlocked teaser (`15`) |
| `ceremony.started` | trip | `wrapped.status`, `wrapped.squad`, `ceremony` | flips the locked teaser to running for every connected viewer; fetches the Squad Wrapped payload and ceremony state so the running view has data immediately |
| `ceremony.step` | trip | `ceremony` | drives card advance for every connected viewer (owner's presenter actions broadcast); this is the whole real-time mechanism for the cast screen |
| `invite.accepted` | admin | `people` | admin toast (`people.joinedNotification`) if `/people` mounted |
| `session.revoked` | me | `bootstrap` | forces sign-out client-side (`reason: sign_out\|password_changed\|password_reset\|removed`) |

\* Only when the trip's phase is `wrapped_unlocked` or `ceremony` (a Personal snapshot exists once unlocked, C11); before that the query is disabled and there's nothing to invalidate. The invalidation just triggers a refetch — the server does the actual stale check/recompute on that GET (C24, C38).

No `predictions.window_closed` event exists (C13 dropped it): the "Missed" state is computed client-side from `predictions.me`'s `deadlineAt` + the §2.5 server-time offset (checked on Log home mount/interval), so a mid-log user just sees the Missed state next time Log home mounts, same as before.

### 2.3 Zustand stores (`packages/web/src/store`)

**`useUiStore`** (in-memory, not persisted except where noted):

```ts
interface UiState {
  wizard: {
    open: boolean;
    mode: 'create' | 'edit';
    tripId: string | null;
    editingDrinkId: string | null;   // set in edit mode
    step: 1 | 2 | 3;
    stepDidChange: boolean;          // true only on the render that changed step; gates motion.wizardStep
    category: CategoryId | null;
    draft: DrinkDraft;               // drink, abv, ml, qty, venue, time, note, rating
    openEditor: 'venue' | 'time' | 'abv' | 'note' | null; // one at a time
  };
  toasts: { queue: ToastSpec[]; current: ToastSpec | null };
  bannerQueue: AchievementBannerSpec[];  // one visible at a time, 700ms delay before first show
  activeSheet: 'tripSwitcher' | 'invite' | 'member' | 'forgotPassword' | null;
  activeMemberId: string | null;         // for the member sheet
  displayMode: 'system' | 'dark' | 'light'; // mirrors account.display; optimistic local copy
}
```

- `wizard` actions: `openForCategory(cat)`, `openEditFor(drinkId)`, `goToStep(n)` (sets `stepDidChange: true` for exactly one render then clears it), `back()`, `close()` (discard, no confirm per §6.2 DS), `setDraftField`.
- `toasts`: FIFO queue, `current` auto-clears after 6.5s (`motion.toast.autoDismiss`) or on replacement.
- `bannerQueue`: push on `achievement.unlocked` SSE for self; a queue-draining effect shows one at a time with the 700ms delay + 4.2s display.
- `displayMode`: written optimistically on Account screen change, persisted server-side via `PATCH /api/v1/me {displayThemePref}`, and also mirrored to `localStorage['drunkify.display']` so it's known before `bootstrap` resolves (avoids a flash of the wrong theme mode).

**`usePredictionsDraftStore`**: transient (not persisted) form state for the predictions form (Q1–Q5), cleared on submit/unmount.

### 2.4 Bootstrap call

`GET /api/v1/bootstrap` on app mount, before router renders anything but a splash/skeleton (03 §8). Returns:

```ts
{ me: User,                                            // {id, email, name, role, mustChangePassword, displayThemePref, disabledAt}
  trips: Trip[],
  currentTrip: { trip: Trip, summary: TripSummary } | null,
  serverTime: number }                                 // epoch ms — see §2.5, not ISO8601
```

- Drives route guards (§1.1) synchronously — no per-route auth fetch (`me.role === 'admin'` replaces `isAdmin`).
- `serverTime` seeds the server-time offset (§2.5).
- On 401: render signed-out shell, no redirect loop (guards handle it per-route).

### 2.5 Server-time offset (countdowns)

- `offsetMs = bootstrap.serverTime - performanceNowToDateNow()` (both epoch ms, no `Date.parse`) computed once at bootstrap; store in `useUiStore` (or a plain module singleton — it never needs to trigger re-render itself).
- `nowServer() => Date.now() + offsetMs`.
- All countdowns (final-24h banner, Wrapped-unlock countdown, rate-limit countdown, predictions-window) compute their target from server-provided epoch timestamps and tick via `nowServer()`, never `new Date()` directly — phones with wrong clocks must not desync the countdown from the actual unlock.
- Re-sync the offset on SSE reconnect (server sends a `hello` event with its current time) to correct drift over long sessions.

### 2.6 Optimistic updates

| Action | Optimistic write | Rollback trigger | Reconciliation |
|---|---|---|---|
| **Log** | Client generates the drink's `drinkId` (UUIDv7, README §4, PK of the row) **and** a separate `clientOpId` (UUIDv7, op idempotency key, C34 — never equal to `drinkId`). Insert into `feed` (filter `mine`+`everyone`) and bump `dashboard`/`recents` caches immediately via `queryClient.setQueryData`. `POST /api/v1/trips/:tripId/drinks` with both ids in body. | Non-2xx other than `401`, and not offline | On success, server row replaces the optimistic one (same `drinkId`, so no flicker); on failure, `setQueryData` reverts to the pre-mutation snapshot (captured via `onMutate`) + error toast. Offline or `401` → outbox instead (§6.2) |
| **Edit** | `PUT /api/v1/trips/:tripId/drinks/:id` (full edit sheet) with a fresh `clientOpId`; optimistic merge into feed row + dashboard delta | failure (as above) | same snapshot/revert pattern |
| **Delete** | Optimistically remove from feed/dashboard; `DELETE /api/v1/trips/:tripId/drinks/:id` with a fresh `clientOpId` | failure (as above) | revert; achievement already announced is *not* revoked client- or server-side (§7 DS) |
| **Rate** | `PATCH .../drinks/:id/rating { rating }` with a fresh `clientOpId`; optimistic feed row face update | failure (as above) | revert |
| **Undo** | Client keeps the pre-mutation snapshot (from the action above) in the toast's closure for the life of the toast (6.5s window, `useUiStore.toasts.current`). Undo is **a new op with its own new `clientOpId`** (C34), never a replay of the original op's `clientOpId`: undo-create → a `delete` op on the same `drinkId`; undo-edit → an `update` op on the same `drinkId` with the previous body; undo-delete → a `create` op with the previous body, same `drinkId`. | Toast dismissed = undo option gone (button unmounts with the toast) | Same optimistic-then-reconcile pattern as the original action |

Every op — including Undo — carries its own fresh `clientOpId`; `drinkId` and `clientOpId` are never the same value and are never used interchangeably (C34). All four mutations share one `useDrinkMutation` hook keyed by `tripId` so the optimistic-cache logic isn't duplicated across LogWizard/Feed/Toast call sites.

### 2.7 Read-only after ceremony start (C11, C27)

Once `trip.ceremonyStartedAt` is set, the server rejects drink create/update/delete/rate with `409 conflict {code: ceremony_started}` (C27). Client must not rely on that alone: CoasterGrid/AnotherButton/RecentsRail on Log home render disabled (no wizard open), Feed rows stop being tappable (`own` no longer opens the edit sheet) and `useDrinkMutation` short-circuits with a toast instead of firing the request. Favourites and custom drink names stay editable — they're account-global and never frozen (C27). Show a plain read-only affordance rather than a broken/erroring tap target — the trip's drinks are frozen input for Wrapped/ceremony from that point on.

---

## 3. Content system

### 3.1 `packages/content`

```
packages/content/
  src/
    index.ts            # loadAuthContent(), loadThemePack(id), t()
    types.ts             # Zod schema + inferred TS types (source of truth for pack shape)
  themes/classic.json
  themes/cs2.json
  auth.json
  catalog.json
scripts/
  check-pack-parity.ts   # CI check, see §3.4
```

- **`auth.json`** is always loaded, eagerly, in the main bundle (it's theme-independent and needed pre-trip, per DS §6.13). Not code-split.
- **Theme packs** (`themes/<id>.json`) are loaded per trip: `loadThemePack(trip.themeId)` is a dynamic `import()`, so a trip never pulls in another theme's copy. Cached by id in a module-level `Map` for the session (a trip's theme can change via owner settings — cache invalidated on `trip.updated` SSE if `themeId` changed).
- Theme selection is **by `trip.theme_id`**, resolved once the active trip is known (root trip loader), before any themed screen renders — Log home, Leaderboard, Wrapped, ceremony all block on this resolving (show skeleton, not a flash of missing copy).

### 3.2 `t(key, vars)` renderer

```ts
function t(pack: ContentPack, key: string, vars?: Record<string, string | number>): string {
  const template = getByPath(pack, key);           // dot-path, e.g. "wrappedPersonal.cards.01_cold_open.value"
  if (template === undefined) throw new ContentError(`Unknown content key: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (!vars || !(name in vars)) {
      if (import.meta.env.DEV) throw new ContentError(`Missing placeholder "${name}" for key "${key}"`);
      return '';                                    // prod: fail soft, never crash the Wrapped mid-story
    }
    return String(vars[name]);
  });
}
```

- **Unknown placeholder** = a `{token}` in the *pack's own JSON* that isn't in the renderer's expected var set for that key — caught statically, not at render time, by `check-pack-parity.ts` (§3.4), which also validates every `{…}` in every string resolves against a hand-maintained `EXPECTED_VARS` map per key (keeps a themer from typo'ing `{nmae}`).
- **Missing placeholder** = `t()` called without a var the template needs — throws in dev, per spec, so a missing wiring bug (e.g. Wrapped card component forgot to pass `{peakDay}`) is caught immediately in local dev/Storybook rather than shipping a literal `{peakDay}` to a user's screen.
- Never string-concatenate around `t()` output for pluralization/gender — the packs are pre-written per key; if a key needs a variant, that's a new key (content team problem, not renderer logic).

### 3.3 Catalog and tokens loading

- `data/catalog.json` → bundled statically, imported directly (no network), typed via Zod in `packages/shared`. Feeds LogWizard category/drink/size lists and the ABV slider math (`abvSlider`).
- `tokens.json` → not consumed at runtime as JSON; built to CSS custom properties + TS constants at build time (§4).

### 3.4 Pack key-parity CI check

`scripts/check-pack-parity.ts`:
1. Recursively walk `themes/classic.json` and `themes/cs2.json`. For every **object** node, assert an identical key set at that path (fail with a diff of missing/extra keys). For every **array** node, do **not** compare length or index-by-index — packs are allowed variable-length arrays by design (`leaderboard.columns`: 2 entries Classic / 4 CS2, §3.5; `ranks.bands`: 10 vs 18 bands, C43) — instead validate each element against that array's element schema (`packages/content/src/types.ts`), so a malformed/missing field inside an element still fails without requiring equal counts between packs.
2. For every leaf string in every pack, extract `{…}` placeholder names and assert they're a subset of a hand-authored `EXPECTED_VARS: Record<keyPath, string[]>` table (this table is the "unknown placeholder" contract — update it whenever a new content key is added). This lint runs **per key**: a bad `{token}` in one pack's key fails only that key, not the whole parity check.
3. Run in CI on any change under `packages/content/themes/**` or `EXPECTED_VARS`; also runnable locally as `pnpm content:check`.
4. New theme packs (V2, per DS §4) must pass this script before merge — it is the "add a CI check for key parity" instruction from the design spec, made concrete.

### 3.5 Leaderboard column rendering (CS2 vs Classic)

- `Leaderboard` component takes `columns: LeaderboardColumn[]` straight from `pack.leaderboard.columns` (2 entries for Classic: `std` primary + `drinks` sub-caption; 4 for CS2: `k`/`a`/`d`/`rating`, `k` primary).
- Renders generically: header row only if `columns.length > 2` (Classic has no header row, just the value+sub-caption layout per DS §6.6; CS2 renders `Player · K · A · D · Rating`). Component switches layout by `columns.length`, **never by `theme.id`** — a hypothetical 3rd pack with 2 columns gets the Classic-style list for free, a pack with 3+ columns gets the table.
- Row data keyed by `column.key` against a generic `LeaderboardRow.values: Record<string, number>` from the API — server computes and names the values (`06-metrics-wrapped.md`), client only renders.

---

## 4. Design tokens

### 4.1 Build pipeline

`packages/design-tokens/`:

```
tokens.json               # copied verbatim from design/tokens.json — do not hand-edit
scripts/build-tokens.ts   # tokens.json → css/tokens.css + src/tokens.ts
```

`build-tokens.ts` (run in `pnpm build` and watched in dev):

- **CSS custom properties**, dark values on `:root`, light overrides under `:root[data-theme="light"]`, and a `prefers-color-scheme: light` media query scoped to `:root[data-theme="system"]` for "Match phone" (account `display: system`, DS §6.13.13). Dark is the unscoped default per DS §3.1.

```css
:root { --color-bg: #23160E; --color-surface: #301F14; /* … */ }
:root[data-theme="light"] { --color-bg: #FBF4E6; /* … */ }
@media (prefers-color-scheme: light) {
  :root[data-theme="system"] { --color-bg: #FBF4E6; /* … */ }
}
```
  `data-theme` is set on `<html>` by the Account "Display" segmented control (`system`/`dark`/`light`) and read from `localStorage['drunkify.display']` before first paint (inline script in `index.html`) to avoid a flash.
- Also emits: type scale (`--type-*-size`, `--type-*-line-height`), spacing (`--space-*`), radii (`--radius-*`), sizes (`--size-*`), strokes, motion durations/easings as CSS vars so CSS Modules and inline styles share one source.
- **TS constants** mirror the same tree (`export const color = {...}`, `space`, `radius`, `size`, `motion`, `haptics`) for logic that needs numeric values in JS (ABV slider positions, canvas/SVG drawing for coasters/charts/wrapped-share-cards, MapLibre paint expressions).
- Member avatar palette and chart category colours exported as ordered arrays/maps (`members.palette[colorIndex % 10]`, `chartCategory[categoryId]`) — `colorIndex` = `trip_members.color_index`, an unbounded join ordinal, never capped at the 10-colour palette length (C45); an 11th joiner wraps to the same colour as the 1st, it does not error or run out of colours.

### 4.2 pt → px

Design values are authored in pt at 1× on a 360×760pt reference (DS §3). **1pt = 1 CSS px** — no scaling factor. All token pixel values are used verbatim as `px` (or converted to `rem` at a fixed 16px root for type, so OS text-size settings still scale dynamic type per §8).

### 4.3 Fonts

- Alfa Slab One (400 only) + Instrument Sans (400/500/600/700) via `@fontsource/alfa-slab-one` and `@fontsource/instrument-sans` npm packages, imported once in the app entry — **no runtime Google Fonts fetch**, no `<link>` to fonts.googleapis.com (self-hosted PWA, README goal; also required for full offline support, §6).
- `font-display: swap` (fontsource default) is fine since both are bundled and precached by the service worker — effectively no FOUT after first load.

### 4.4 Tabular numerals util

```ts
// packages/design-tokens/src/tabular.ts
export const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
```
Applied via CSS class `.tabular-nums { font-variant-numeric: tabular-nums; }` (also set globally on totals, leaderboard values, countdowns, ABV display, steppers — see token `font.numerals`). Prefer the CSS class over inline style for cacheability.

---

## 5. Component inventory

| Component | Used in | Key props | Notes | A11y |
|---|---|---|---|---|
| **TopBar / TripSwitcher** | every trip tab | `tripName`, `onOpenSwitcher` | 44pt tall; opens `activeSheet='tripSwitcher'` | button role, accessible name "{trip name}, switch trip" |
| **AvatarStack** | TopBar (right) | `members[]`, `max` | overlapping 30pt circles, 2pt bg-ring | `aria-label="{n} members"`, not individually focusable (decorative) |
| **Countdown** | Log home, all tabs (final 24h), Wrapped unlock, rate-limit | `targetEpoch`, `format: 'HHMMSS'\|'mm:ss'`, `nowServer` | uses §2.5 offset, tabular-nums, `requestAnimationFrame`-throttled to 1/sec | live region only for rate-limit countdown (announce start + zero, not every tick, §6.13.14 DS); others are visual-only with a static `aria-label` |
| **Totals** | Log home | `you`, `squad`, `empty` | display 46 / 30 per DS §6.1 | two `<dl>`-like groups, values have units in accessible name ("36.0 standard drinks") |
| **AnotherButton** | Log home | `lastEntry` (= `recents.lastDrink`, C30), `onLog` | hidden if no drinks yet; 1-tap exact-repeat log (§6.2.2 tap counts) | accessible name includes drink+size: "Another Guinness, pint" |
| **RecentsRail** | Log home | `items[]` (= `recents.items`, C30 — deduped by cat+drink+size, favourites first, cap 12) | horizontal scroll, 44pt chips | each chip is a button, name "{drink}, {size}{, favourite}" |
| **Coaster** | CoasterGrid, hero (auth), invite QR card | `categoryId`, `label`, `size`, `interactive` | SVG text-on-path per DS §6.1/§9 — see §5.1 below | button role when interactive; `aria-label="Log {category}"` |
| **CoasterGrid** | Log home | `categories[]` (fixed order: Beer, Wine, Cocktail, Spirit, Shot, Cider, Seltzer, Soft, Other) | 3×3, press scale 0.93/120ms (`motion.coasterPress`) | grid role optional; each coaster independently focusable |
| **BottomSheet** | LogWizard, InviteSheet, TripSwitcher, MemberSheet, ForgotPassword | `open`, `onClose`, `maxHeight='93%'`, `showProgress` | drag-to-dismiss (vertical pan, dismiss past 40% or high velocity), scrim tap closes, `motion.sheetOpen` (translateY 105%→0, 300ms); pushes a `history.pushState` entry so back-gesture closes it first | focus trap (first focusable on open, restore trigger focus on close), scrim `aria-hidden` on background, sheet `role="dialog"` `aria-modal="true"`, Esc closes on desktop |
| **LogWizard** | overlay on Log home / Feed (edit) | `mode`, `category`, `editingDrinkId` | state machine exactly per DS §6.2 — see §5.2 below; wizard slide (`motion.wizardStep`) fires only when `stepDidChange` | step title is an `h2`, progress bar `aria-hidden` (redundant with step heading), Back/Close 44pt icon buttons with labels |
| **DrinkTile** | Wizard step 1 | `name`, `abv`, `selected` | 72pt min height, 2-col grid | name+ABV in accessible name; selected exposes `aria-pressed` |
| **SizeTile** | Wizard step 2 | `label`, `ml`, `std`, `selected` | | same pattern as DrinkTile |
| **QtyStepper** | Wizard step 3 | `value`, `min=0.5`, `step=0.5`, `onChange` | 46pt circular −/+ | buttons labelled "Decrease quantity"/"Increase quantity"; live region announces new value on change (polite) |
| **ChipRow + inline editors** | Wizard step 3 | `chips: {venue,time,abv,note}`, `openEditor`, `onToggle` | one editor open at a time; venue chip: dashed border = `candidate` kind (unconfirmed), solid = `existing`, empty = `none` (C29) | each chip `aria-expanded` (per DS §3.7), editor region `aria-labelledby` the chip |
| **AbvSlider** | ABV chip editor | `valuePos` (uncontrolled, ref-driven), `onCommit(pos)` | see §5.3 — **must not re-render the sheet while dragging** | native `<input type="range">` (0–280 int positions) with `aria-valuetext="{abv}%"` computed live via ref, not state |
| **RatingFaces** | Toast, Feed, Edit sheet | `value`, `onRate`, `disabled` (soft drinks) | 44pt circles, 5 faces from `catalog.ratingScale` | each face "Rate {n} of 5, {emoji description}" per DS §3.7 example ("Rate 4 of 5") |
| **Toast** | global overlay | `spec: {kind, message, undo?, ratingAsk?}` | 6.5s auto-dismiss (`motion.toast`), replaced by next toast, undo consumes the mutation snapshot (§2.6) | `role="status"` `aria-live="polite"`, Undo button real 44pt target |
| **AchievementBanner** | global overlay | `queue[]` (each item the C42 `AchievementUnlock` DTO: `{key, userId\|null, triggeredByUserId, tripId, drinkId\|null, unlockedAt, vars}`) | 700ms delay after triggering log, 4.2s display, haptic (`haptics.achievement`), queued one-at-a-time, copy resolved via `t(pack, 'achievements.'+key+'.copy', vars)` (§3.2) | `role="status"` `aria-live="polite"`, haptic call wrapped in `navigator.vibrate` no-op guard |
| **Feed rows** | Feed | `entry`, `own`, `onEdit` | drink row vs achievement row (surface2 pill); achievement row copy from `t(pack, 'achievements.'+key+'.copy', vars)` using the unlock's `vars` (C42, e.g. `{n}`, `{venue}`); pill attributes to `triggeredByUserId` (the acting member — `userId` may be `null` for group achievements), incl. that member's avatar; own drink rows tappable → edit wizard | row is a button only when `own`; others render as static `<li>` |
| **SegmentedControl** | Feed (Mine/Everyone), Account (Display: 3-way) | `options[]`, `value`, `onChange` | shared component, 2- or 3-segment | `role="tablist"`/`role="tab"` or radiogroup pattern; whichever, selection state not colour-only (accent fill + `aria-selected`) |
| **Leaderboard** | Board tab | `columns` (from pack, §3.5), `rows[]`, `masked`, `you` | Classic list vs CS2 table rendered generically by `columns.length`; masked rows carry `rank:null`/`values:null` from the server (C16) — render the "?" state, never mask real numbers client-side; masking is UI suspense, not a security guarantee — Feed still shows every drink, ranks are reconstructable (C20) | your row additionally labelled "you" in text, not just background colour (§3.7 DS) |
| **Charts (Squad by day, What we drink)** | Board tab | `data[]`, `categoryColors` | **plain inline SVG, no chart lib** — bar chart + stacked bar, future days as neutral stubs | `role="img"` with a text `aria-label` summary; raw data available via a visually-hidden table fallback for screen readers |
| **RatingsHistory** | Board tab | `entries[]` (`{drinkId, drinkName, category, rating, drunkAt}`; `drunkAt` epoch ms, C19), from the `stats.ratings` query (§2.1) — own ratings only, no `memberId` | personal rating trend/list under the Leaderboard; **not masked** during `final_24h` — it's the viewer's own history, not a comparative value (C20) | text summary + accessible list fallback, same pattern as Charts |
| **LockedTile** | Board tab (locked-for-Wrapped), Predictions teaser | `title`, `note` | dashed `ring` border, 16pt radius, lock icon | `aria-disabled`, name includes "Unlocks in the Wrapped" |
| **PredictionsForm** | `/t/:tripId/predictions` | `defaults` (Q1=5×days, Q2=Q1×members), `members[]`, `catalogDrinks[]` | steppers long-press-accelerate; primary disabled until Q3–Q5 answered; Q5 is a drink chip picker — the selected chip also carries its category, submitted as `q5_top_drink` + `q5_top_drink_category` (C31) | stepper buttons labelled with current value change announced (aria-live polite, throttled) |
| **PredictionsLocked** | same route | `count`, `total`, `members[]` | | |
| **PredictionsMissed** | Log home slot | `dismissible` | dismiss via `POST /api/v1/trips/:tripId/predictions/me/dismiss-missed` — sets server-side `trip_members.missed_banner_dismissed` (C7), not a `PATCH predictions/me` field and not client `localStorage` | |
| **WrappedStory** | `/t/:tripId/wrapped/personal` | `cards[14]`, `theme pack` | 14 segments (3pt, done=ink95%, todo=ink22%), tap-right/left, hold-pause, swipe-down-close, count-up hero number 1.2s, amber full-bleed on card 2 + ≤1 more; share = render current card to 1080×1920 PNG (html-to-image, canvas fallback) + Web Share API, download fallback if `navigator.share` unsupported or lacks file support; card 13's rank badge renders from the payload's raw `stdPerDay` resolved against `pack.ranks.bands` via `rankFor()` (`packages/shared`, C43) — never a server-stored band index, so an owner retheming the trip pre-ceremony doesn't require a snapshot recompute | progress segments `aria-hidden`; current card index announced via a visually-hidden "Card {n} of 14" live region on change; hold-to-pause has an on-screen equivalent (pause button) for non-touch/switch users |
| **SquadCeremony** | `/t/:tripId/ceremony` | `displayMode: 'phone'\|'big'`, `cards[11]`, presenter state via SSE | big-screen: 16:9, vw units (≥2vw body, ≥7vw titles), keyboard ←/→/space/Hold(H)/click/tap advance, presenter-controlled only, no auto-advance; card/subStep advance, `hold`, and the terminal `ended` transition follow `03-api.md`'s exhaustive card transition table exactly (index base C18); at `ended`, the owner sees a **Restart** control → `POST /trips/:tripId/ceremony/restart` (owner-only, `403` for anyone else) resets `ceremony_state` to card 0 and re-broadcasts `ceremony.started`/`ceremony.step` to every viewer; phone layout fallback mirrors WrappedStory chrome | keyboard operable end-to-end (arrow/space/H documented in on-screen help on first open); focus starts on the card container |
| **ReplayMap** | Squad Wrapped card 6, replay screen | `style` from `GET /api/v1/config` (`mapStyleUrl`, README D8), `events[]` (from the already-fetched Squad Wrapped payload, card 6 — C12; no separate `/wrapped/replay` call), `scrub`, `playing` | MapLibre GL JS, lazy-loaded (§9); member dots + 2pt trails in avatar colour, drink pulses sized by std, running top-6 ticker, day label, Night MVP banner at day end | map itself `aria-hidden` (decorative for this use), ticker list is real accessible text alongside |
| **TrailMap** | Personal Wrapped card 6 | same MapLibre instance pattern, single-member route | full-bleed, route in accent, venue pins | text stat line duplicates the visual (venue name, distance) for non-visual access |
| **Auth screens shared chrome** | Sign-in, Create account, Finish setting up, Set-new-password, Invite landing, Link problem | hero coaster (168pt→72pt on keyboard, or 72pt compact top-left on 3-field forms), text field, busy button, form-level error block | keyboard-up shrink 220ms scale+opacity (instant if reduced motion); primary button rides above keyboard | on route change/screen mount, focus moves to the screen title (`h1`, §6.13.14 DS); submit failure moves focus to first invalid field |
| **TextField** | all auth/account/wizard-inline forms | `label`, `value`, `error`, `hint`, `type`, `autoComplete` | 52pt height, 12pt radius, border states (rest/focus/error per stroke.input) | label associated via `htmlFor`; error replaces hint and is `aria-describedby` target; password field "Show/Hide" is a real 44×44 button with `aria-pressed` |
| **InviteSheet** | People, Trip switcher, Member sheet (reset variant) | `mode: 'create'\|'result'\|'qr'\|'reset'`, `trips[]` | QR via `qrcode` npm lib, rendered with `coasterInk` module colour on `coaster` background card (`radius.qrCard`); requests Screen Wake Lock API while QR shown (feature-detected, no-op fallback); optional email field (README D3) alongside name on Create step, sends via `MAILER` if provided | QR `<svg role="img">` with `aria-label="QR code for {name}'s invite link"`; plain link text always present and selectable |
| **People** | `/people` | `invites[]`, `members[]` | invite rows (dashed-ring avatar) + member rows (solid avatar), "⋯" action sheet per invite | "⋯" button `aria-label="Invite options for {name}"`; action sheet items are a native/ARIA menu |
| **MemberSheet** | opened from People | `member`, `trips[]`, actions | Add to a trip / Send reset link / Remove access (danger, confirms) | Remove access confirmation dialog is the only non-trivial confirm besides Sign out (§6.13.10 DS) |
| **Account** | `/account` | `user`, `displayMode` | Name + Display via `PATCH /api/v1/me {name?, displayThemePref?}` (Display written to `useUiStore.displayMode` too); Email via `POST /api/v1/auth/change-email {currentPassword, newEmail}`; Change password via `POST /api/v1/auth/change-password {currentPassword, newPassword}` (revokes other sessions, DS §6.13.13) — none of these go through an `/account` endpoint | Sign out is a text button (ink, not danger) with its own confirm dialog |
| **ForgotPassword sheet** | Sign-in | static copy + optional email field (README D3: also allows a self-serve reset link if `MAILER` configured) | when `MAILER` is configured, sheet gains an email field + "Send reset link" flow (`POST /api/v1/auth/forgot-password`) instead of the "ask your admin" copy-only variant; component picks variant from `GET /api/v1/config → mailerEnabled` | |

### 5.1 Coaster — SVG text-on-path (DS §6.1, §9)

```html
<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <path id="coaster-arc-{categoryId}" d="M 14,50 A 36,36 0 0,0 86,50" />
  </defs>
  <circle class="ring" cx="50" cy="50" r="45" />           <!-- dashed inner ring, r=45/100, coasterRing, 1.6 stroke, 3-3 dash -->
  <text class="label">
    <textPath href="#coaster-arc-{categoryId}" startOffset="50%" text-anchor="middle">{categoryName}</textPath>
  </text>
  <!-- drink icon centred in the upper half, 44% of coaster diameter -->
</svg>
```
- Arc path: lower half of the coaster circle, radius **36% of the coaster diameter**, endpoints at 14/86 on a 0–100 viewBox (i.e. ~198°→342° arc), `startOffset="50%"` + `text-anchor="middle"` centres the label on the arc regardless of string length.
- One `<path id>` per category per rendered coaster instance (ids must be unique per SVG document — suffix with an instance key if the same category renders twice on screen, e.g. auth hero coaster reuses the beer coaster with label "Drunkify" instead of "Beer").
- Font: `coasterLabel` token (display, 14.5). Fill: `coasterInk`.
- Coaster fill `coaster`, icon centred upper half at 44% diameter (`icon.drinkCoaster`), outline stroke 2.3 round (`stroke.drinkIcon`) using role mapping in DS §3.5 (coasterInk / drinkIcon.liquid / surface-matched bubbles / drinkIcon.olive / drinkIcon.ice).
- Press state: `transform: scale(0.93)` for 120ms (`motion.coasterPress`), CSS transition, not JS-animated.

### 5.2 LogWizard state machine (implement exactly as DS §6.2)

```
State: { mode: 'create'|'edit', step: 1|2|3, category, drink, abv, ml, qty,
         venue: {kind: 'existing'|'candidate'|'none', name?, id?, candidate?: {name,lat,lng,osmId}},  // mirrors venues/suggest + drink venue field, C29
         time, note, rating, favourite, openEditor }

create, tap coaster            → step=1, category=cat, prefill from `recents.lastByCategory[category]` (C30) or catalog default
step1  · tap "{drink} again"   → step=3 (keep last size)
step1  · tap drink tile        → step=2
step1  · "Other…" + Next       → step=2 (drink = typed name, saved as custom on Log)
step2  · tap size tile         → step=3
step2  · Custom ml + Next      → step=3
step3  · tap summary card      → step=1 (return path preserves qty/venue/time/abv/note already set)
step3  · chip tap              → toggle openEditor (only one open); ABV editor = AbvSlider
step3  · Log / Save changes    → mutate (§2.6), close, toast
Back (header)                  → step=step-1 for step ∈ {2,3}; hidden on step 1
Close / scrim / swipe-down     → discard, no confirmation (nothing persisted yet)
edit mode                      → opens directly at step=3; picking a new drink at step1 returns straight to step=3 (not step=2)
```
- `stepDidChange` flag set true only on transitions that change `step`; a stepper tap or chip edit within step 3 must not replay `motion.wizardStep`.
- Progress bar (3 segments, 26×4pt) hidden in edit mode.
- Rating faces render only in edit mode (never on initial log, per DS change #2).

### 5.3 AbvSlider mechanics

- Domain: integer positions `0..280` mapped non-linearly via `catalog.abvSlider` (`posToAbv`, `abvToPos` — copy the exact functions from `data/catalog.json`/prototype, don't re-derive):
  ```ts
  const posToAbv = (p: number) => p <= 150 ? p / 10 : 15 + (p - 150) * 0.5;
  const abvToPos = (a: number) => a <= 15 ? Math.round(a * 10) : 150 + Math.round((a - 15) / 0.5);
  ```
- **Must not re-render the parent sheet while dragging.** Implementation: native `<input type="range" min="0" max="280">` as an **uncontrolled** element (no `value=` prop bound to React state during drag); read/write via `ref`. On `input` event: update the value label and `aria-valuetext` via direct DOM mutation (or a `requestAnimationFrame`-batched local state confined to the `AbvSlider` subtree only — never lift to wizard state per keystroke). On `change` (drag end) or nudge-button tap: commit to wizard state (`onCommit(pos)`), which is the only point that touches the shared `draft.abv`.
- Nudge buttons move exactly one position; from `pos===150` (exactly 15%), `-` → 149 (14.9%), `+` → 151 (15.5%) — asymmetric step size around the boundary, per spec.
- Tick labels `[0,5,10,15,30,50,80]` positioned by `abvToPos(v)/280 * 100%`; `15` styled accent+bold.
- Drink preset selection snaps ABV to `abvToPos(catalogAbv)` then back through `posToAbv` (quantizes to the slider's resolution).

---

## 6. PWA & offline (README D7)

### 6.1 `vite-plugin-pwa` config

```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Drunkify', short_name: 'Drunkify',
    theme_color: tokens.color.dark.bg,       // from design-tokens build, #23160E
    background_color: tokens.color.dark.bg,
    display: 'standalone',
    start_url: '/',                          // resolves via last-opened-trip logic client-side
    icons: [/* 192, 512, maskable — generated from the beer coaster mark, §10 build note */],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,woff2}'],   // app shell + bundled fonts
    runtimeCaching: [
      { urlPattern: /\/api\/v1\//, handler: 'NetworkOnly' },           // ALL API: never cache authenticated responses (C28) — avoid stale/cross-account data
      { urlPattern: /\/content\/(themes|auth)\//, handler: 'CacheFirst', options: { cacheName: 'content-packs' } },
    ],
  },
})
```

- **App shell**: precached (JS/CSS/HTML/fonts) — full offline boot into the shell even with no network.
- **Content packs** (theme JSON, auth.json, catalog.json): precached alongside the shell since they're small and static per build — not fetched at runtime at all in practice (bundled), but the cache entry covers the case they're split into separate chunks.
- **API**: network-only, always. Workbox never caches `/api/v1/*` responses, including `bootstrap`/`me` — they're authenticated and per-user, and a Cache API entry has no notion of "which account" (C28). Instant offline shell + last-known trip list comes from the IndexedDB bootstrap snapshot (§6.1a) instead of a Workbox cache. All other API calls fail fast when offline — the offline *outbox* (§6.2) is what makes logging still work.

### 6.1a Offline bootstrap snapshot (IndexedDB)

Store name: `bootstrapSnapshot`, DB `drunkify-offline` (same DB as §6.2), keyed by `userId`.

- On every successful `GET /api/v1/bootstrap`, write a **sanitized** snapshot (`me`, `trips[]`, `currentTrip` — no tokens/cookies, which never touch JS anyway) keyed by `me.id`, so the shell can render instantly offline without a network round trip.
- On app boot with no network: read the snapshot for the last-known `userId` (`localStorage['drunkify.lastUser']`, written alongside `drunkify.lastTrip.<userId>`, §1.4) and hydrate the shell/router guards from it instead of blocking on `bootstrap`, with a stale/offline indicator. Once online, the real `bootstrap` call reconciles and overwrites the snapshot.
- **Cleared** on sign-out and whenever the signed-in `userId` changes (§1.4's shared-device concern) — never served for a different account than the one that wrote it.

### 6.2 IndexedDB offline outbox (idb)

Store name: `pendingDrinks`, DB `drunkify-offline`. **Sole owner of mutation replay** — no Workbox `BackgroundSync`/Background Sync API is registered anywhere in the app (C28); Workbox only ever serves precached static assets.

```ts
interface PendingDrink {
  clientOpId: string;   // client UUIDv7, per-op idempotency key against the server's `applied_ops` ledger (C34) — distinct from `drinkId`, incl. on create
  tripId: string;
  type: 'create' | 'update' | 'delete' | 'rate';   // C28 op shape
  drinkId: string;      // client-generated UUIDv7, PK of the drink row (README §4); same value across create/update/delete/rate for that drink — never the op idempotency key
  payload?: unknown;    // exact request body for this op type; absent for delete
  clientNowMs: number;  // epoch ms, client clock — for ordering only
  userId: string;       // only flush queue entries for the signed-in-as user; a 401-triggered enqueue (C47) keeps the entry under this original user regardless of who's signed in when it's retried
  attempts: number;     // local retry bookkeeping, not part of the wire op
}
```

- Every log/edit/delete/rate first attempts the network call (§2.6 optimistic flow). On failure classified as **offline** (network error) **or `401`** (expired/invalidated session mid-trip, C47), the mutation is additionally written to `pendingDrinks` instead of showing a hard error; any other non-2xx is a hard failure, not queued.
- **Flush triggers** (unchanged): `window.addEventListener('online', flush)`; app focus (`visibilitychange` → `visible` + `focus`); immediately after sign-in, **only if the signing-in `userId` matches the queue entries' `userId`** (C47; README §7 "Session lost mid-trip … only if the same account signs in") — a `401`-queued entry stays parked until that same user re-authenticates, it is never flushed under a different signed-in user.
- Flush: `POST /api/v1/trips/:tripId/drinks/sync` with queued ops in `clientNowMs` order per trip, one at a time (avoid reordering side-effects like achievement triggers); on success, delete the entry; on a definitive rejection (e.g. trip no longer exists, 403), drop it and surface a toast; on repeated transient failure, leave queued and retry next trigger.
- **Idempotent replay**: the server dedupes every op (create/update/delete/rate) on `clientOpId` via the `applied_ops` ledger (C34) — a replayed `clientOpId` returns the originally-stored response rather than re-applying, so a flush retried after a partial network failure (request sent, response lost) can't double-apply.

### 6.3 UI indication

- Toast variant: when a log/edit/delete is queued instead of sent, the toast reads "Saved offline, will sync" (content key `toasts.offlineSaved`, lives in `themes/{classic,cs2}.json` per README §5.1) instead of the normal "Logged {qty}{drink}" — same 6.5s auto-dismiss, no Undo (undo against a queued item just deletes the queue entry).
- Feed rows for entries still in the queue show a small **pending badge** (dot or clock icon, `muted` colour, `aria-label="Not yet synced"`) until the flush confirms; removed the moment the queue entry clears.

### 6.4 Geolocation

- Request permission on the **first log attempt** (coaster tap → wizard opens), not on app load — avoids a cold permission prompt before the user has done anything.
- `getCurrentPosition({ timeout: 3000 })` for the one-shot venue-suggestion lookup at wizard-open; if it times out or is denied, proceed with no venue suggestion (dashed "No venue" state) — **never block the Log button on GPS**.
- While the wizard is open, additionally run a cached `watchPosition` (accept cached fixes up to a short maxAge) so a venue suggestion can still resolve slightly after open without a second full GPS acquisition; `clearWatch` on wizard close.
- Venue suggestion logic (nearest known venue within ~150m reused silently, else suggest-as-dashed-chip) is server-side (`05-domain-logic.md`) — client just sends `{lat, lon}` with the log request and renders whatever `venues/suggest` kind comes back (`existing`/`candidate`/`none`, C29).

---

## 7. Motion & haptics

| Token | Implementation |
|---|---|
| `motion.sheetOpen` | CSS transition on `transform: translateY(105% → 0)`, 300ms, `cubic-bezier(.2,.85,.25,1)` |
| `motion.scrim` | opacity 0→1, 220ms, paired with sheet open |
| `motion.wizardStep` | opacity 0→1 + translateX 22px→0, 220ms ease-out; gated by `stepDidChange` (§5.2) |
| `motion.toast` | opacity + translateY 16px→0, 250ms in; auto-dismiss 6500ms |
| `motion.achievement` | translateY -130%→0 + opacity, 350ms, `cubic-bezier(.2,.9,.3,1.2)`; delay 700ms after the triggering log; auto-dismiss 4200ms |
| `motion.coasterPress` | scale 0.93, 120ms, on `:active`/pointerdown |
| Wrapped hero count-up | custom `requestAnimationFrame` tween, ~1.2s, ease-out; the *only* ambient (non-action-triggered) motion in the app, and even it is gated on card entry (a user action: advancing the story) |

- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables wizard slide, sheet slide, and toast slide — swap to opacity-only or instant per token `reducedMotion` note. Implement as a single CSS block overriding the transform parts of the above transitions to `none`, keeping opacity. Respect the same query for the Wrapped count-up (skip straight to final value).
- **Haptics**: `navigator.vibrate(12)` on every successful log/edit/delete/rating (`haptics.log`) and on achievement banner appearance (`haptics.achievement`). Wrap in a helper that no-ops silently where `navigator.vibrate` is absent or throws (**iOS Safari has no Vibration API support — haptics are Android-only in V1; this is a known platform limitation, not a bug**).

---

## 8. Accessibility (implements DS §3.7, §6.13.14)

| Requirement | Implementation |
|---|---|
| Focus management on route change | Router-level effect: on every route change, move focus to the screen's `h1`/`h2` title (`tabIndex={-1}` + `.focus()`); auth screens and full-screen routes (People, Account, Predictions) all have one |
| Focus on submit failure | Form submit handlers, on validation error, focus the first invalid field (not just show its error) |
| Live regions | Toast (`role="status" aria-live="polite"`), AchievementBanner (same), rate-limit countdown (announced only at start and at zero — implemented as a separate visually-hidden live-region text node updated only at those two moments, not every tick), stepper value changes (polite, throttled to avoid spam on long-press-accelerate) |
| Labels | every icon-only button has an explicit `aria-label` (Close, Back, Add to favourites, "Rate 4 of 5", "Lower ABV", "Raise ABV", "Show QR code", "Invite options for {name}", etc. — see component table) |
| Expandable state | Chips exposing an inline editor: `aria-expanded`; Favourite star: `aria-pressed`; SegmentedControl options: `aria-selected` |
| 44pt targets | Enforced via a shared `--min-touch: 44px` min-width/min-height on all interactive elements, including inline "Change"/"Undo" text buttons (padded hit area even when visual text is smaller) |
| Dynamic type | Type scale authored in `rem` (16px root) so OS text-size scaling applies; layouts use `clamp()` where a fixed pt size would break at +2 steps (e.g. wizard question, screen titles wrap rather than truncate per DS §3.2); tiles use `min-height` not fixed `height` so they grow; verified against the DS "+2 steps" floor as part of the a11y test pass (`08-milestones-testing.md`) |
| Colour never sole signal | Selected tiles: accent fill/ring **and** `aria-pressed`/`aria-selected`; your leaderboard row: accent bg/rank **and** literal "you" text; venue chip suggestion state: dashed border **and** distinguishable label, not colour alone |
| Contrast | Token pairs (ink/bg, muted/bg, onAccent/accent, accentText/bg) pre-verified in both modes per DS §3.1/§3.7 — no additional runtime check needed, just don't introduce new colour combinations outside the token set without re-verifying |

---

## 9. Performance budgets

| Budget | Approach |
|---|---|
| JS initial < 200KB gz | Route-level code splitting via React Router lazy routes; heavy libs isolated to their own dynamic imports: **MapLibre GL JS** (ReplayMap/TrailMap, only imported when a Wrapped card or replay screen mounts), **Wrapped** (`WrappedStory`/`SquadCeremony` bundles, only loaded from `/t/:tripId/wrapped/*` and `/ceremony`), **QR** (`qrcode` lib, only loaded when InviteSheet reaches the QR state), **html-to-image**/canvas share renderer (only loaded on Share tap). Core shell (auth + Log home + wizard + feed + leaderboard) is the only thing in the initial bundle. |
| TTI on mid Android < 3s | Bootstrap call + shell render is the critical path — no blocking on trip data beyond the bootstrap trips list; Log home skeleton renders before `totals`/`recents`/`leaderboard` queries resolve; fonts preloaded (`<link rel="preload">` for the two woff2 files) since they're render-blocking for the display face used in the title |
| 60fps wizard | Sheet transform animations are `transform`/`opacity` only (compositor-friendly, no layout thrash); AbvSlider drag never touches React state per-frame (§5.3); wizard step transition is a CSS transition, not a JS-driven animation loop |

---

## 10. Screen checklist

Screenshot → route/component + states to implement. Classic has the full 43; CS2 shares 01–24 minus the theme-independent-only set (wizard steps 02–05, light mode 25, and all auth/account screens 26–43 are Classic-only per `design/README.md`).

| # | File (classic) | Route / Component | States to implement |
|---|---|---|---|
| 01 | log-home | `/t/:tripId/log` | populated, has-drinks |
| 01b | log-home-toast-and-achievement | Log home + Toast + AchievementBanner | log toast with rate-ask, banner queued after |
| 02 | wizard-1-what | LogWizard step 1 | drink tiles, "{drink} again" tile, Other… |
| 03 | wizard-2-size | LogWizard step 2 | size tiles, Custom |
| 04 | wizard-3-confirm-venue-edit | LogWizard step 3 | venue chip editor open, suggested (dashed) state |
| 05 | wizard-3-abv-slider | AbvSlider | mid-drag value, ticks, nudge buttons |
| 06 | edit-drink | LogWizard `mode='edit'` | opens at step 3, rating faces visible, Delete drink button |
| 07 | empty-trip-predictions-open | `/t/:tripId/log` | empty totals, predictions card replacing Another/Recents |
| 08 | leaderboard | `/t/:tripId/board` | Classic list layout / CS2 table layout (both themes have this) |
| 09 | leaderboard-lower-locked-tiles | `/t/:tripId/board` (scrolled) | Squad-by-day chart, What-we-drink chart, LockedTile grid |
| 10 | feed-everyone | `/t/:tripId/feed` | Everyone segment, mixed drink+achievement rows, day grouping |
| 11 | final-24h-masked | Countdown + `/t/:tripId/board` | masked leaderboard (alphabetical, "?" ranks/values), countdown on every tab |
| 12 | predictions-form | `/t/:tripId/predictions` | all 5 questions, primary disabled until Q3–Q5 |
| 13 | predictions-locked | `/t/:tripId/predictions` | locked state, "{n} of {total}" |
| 14 | predictions-missed | `/t/:tripId/predictions` or Log-home slot | missed state, dismissible |
| 15 | wrapped-unlocked | `/t/:tripId/wrapped` | unlocked teaser, CTA to personal story |
| 16–20 | wrapped-card-01/02/03/05/14 | `/t/:tripId/wrapped/personal` | cold open, absurd units (amber full-bleed), guess-ethanol (interactive), peak-day, archetype (end state: Share/Watch again) |
| 21 | ceremony-locked-guest | `/t/:tripId/ceremony` | non-owner locked teaser, blurred fanned stack |
| 22 | ceremony-locked-owner | `/t/:tripId/ceremony` | owner locked, watched-count, Start/Cast/settings rows |
| 23 | ceremony-presenter-remote | — | **not built (README D5)** |
| 24 | cast-mode-leaderboard-reveal | `/t/:tripId/ceremony?display=big` | 16:9 big-screen, card 10 rows rising, #1 slot masked until reveal |
| 25 | light-mode-log-home | `/t/:tripId/log` with `data-theme="light"` | full light-mode palette pass |
| 26 | sign-in | `/sign-in` | rest state |
| 27 | sign-in-error | `/sign-in` | bad-credentials error block |
| 28 | forgot-password | Sign-in + ForgotPassword sheet | sheet open |
| 29 | admin-setup | `/setup` | first-run admin form |
| 30 | invite-landing | `/i/:token` | with-trip variant (also spec: without-trip, already-signed-in — no separate shot) |
| 31 | create-account | `/i/:token/create` | rest state |
| 32 | joined-trip-toast | `/t/:tripId/log` after create-account | welcome toast |
| 33 | link-problem-expired | `/link-problem` | expired variant (also: used, revoked, invalid, resetExpired — same component) |
| 34 | reset-password | `/r/:token` | rest state |
| 35 | no-trip-admin | `/no-trip` | admin variant |
| 36 | no-trip-member | `/no-trip` | member variant |
| 37 | trip-switcher | TripSwitcher sheet | list + People/Account rows |
| 38 | people | `/people` | invites + members sections |
| 39 | member-sheet | MemberSheet overlay | opened from People |
| 40 | invite-create | InviteSheet | create state |
| 41 | invite-link | InviteSheet | result state |
| 42 | invite-qr | InviteSheet | QR state |
| 43 | account | `/account` | full rows incl. Display segmented control |

CS2-specific note: screenshots 01–24 (its subset) must be pixel-matched with the CS2 content pack loaded — same components, different `t()` output and `leaderboard.columns` (§3.5); no CS2-specific component variants should exist.

---

## 11. Verified API surface (matches `03-api.md` / README §5, C12)

| Endpoint / field | Used for |
|---|---|
| `GET /api/v1/bootstrap?tripId=` | App shell: `me`, `trips[]`, `currentTrip`, `serverTime` (§2.4) |
| `GET /api/v1/me`, `PATCH /api/v1/me` | Account: name, `displayThemePref` |
| `POST /api/v1/auth/change-password`, `POST /api/v1/auth/change-email` | Account: password/email change (DS §6.13.13) — not an `/account` endpoint |
| `POST /api/v1/trips` | Create trip (§1.3) |
| `GET /api/v1/trips/:tripId/dashboard` | Log home totals + Board tab's charts + "Just unlocked" panel (replaces `totals`/`charts`/`achievements`) |
| `GET /api/v1/trips/:tripId/drinks/recents` | Log home recents rail |
| `GET /api/v1/trips/:tripId/feed?filter=mine\|everyone` | Feed |
| `GET/POST/PUT/PATCH/DELETE /api/v1/trips/:tripId/drinks[/:id]`, `POST .../drinks/sync` | Log/edit/delete/rate + optimistic/offline flow; client-generated `drinkId` (UUIDv7, row PK) plus a distinct `clientOpId` (UUIDv7) per op, idempotency via `applied_ops` (C34) |
| `GET /api/v1/trips/:tripId/leaderboard` | Board tab (masking + embedded `recentAchievements`, C16; masking is suspense not secrecy, C20) |
| `GET /api/v1/trips/:tripId/stats/ratings` | Own ratings history for the Leaderboard tab, `{drinkId, drinkName, category, rating, drunkAt}`, not masked in `final_24h` (C19, C20) |
| `GET/PUT /api/v1/trips/:tripId/predictions/me`, `POST .../predictions/me/dismiss-missed`, `GET .../predictions/status` | Predictions screens |
| `GET /api/v1/trips/:tripId/wrapped/status`, `/personal`, `POST /personal/watched`, `GET /squad` | Wrapped teaser/story/squad — replay lives inside the Squad payload's card 6 (C12, no `/wrapped/replay`) |
| `GET /api/v1/trips/:tripId/ceremony/state`, `POST .../start`, `.../advance`, `.../hold`, `.../restart` (owner-only) | Ceremony |
| `GET /api/v1/people` | People (not `/admin/people`); invites via `GET /api/v1/invites` |
| `GET/POST /api/v1/me/favourites`, `DELETE .../:id`; `GET/POST /api/v1/me/custom-drink-names` | Wizard favourite/custom-name persistence |
| `GET /api/v1/trips/:tripId/venues/suggest`, `PATCH /api/v1/trips/:tripId/venues/:venueId` | Venue suggestion + rename |
| `GET /api/v1/config` → `{ mapStyleUrl, geoProviderEnabled, mailerEnabled }` | ReplayMap/TrailMap style, ForgotPassword variant, geo behaviour (README D8) |
| `POST /api/v1/auth/forgot-password` | Self-serve reset link when `MAILER` configured (README D3) |
| SSE channels `/trips/:tripId/events`, `/me/events`, `/admin/events` (C13); events `drink.created/updated/deleted`, `achievement.unlocked`, `phase.changed`, `member.joined/removed`, `trip.updated`, `trip.added` (me channel, C32), `wrapped.unlocked`, `ceremony.started`, `ceremony.step`, `invite.accepted`, `session.revoked`, plus `hello {serverTime}` on connect — no `predictions.window_closed` | §2.2, §2.5 |
| Content key `toasts.offlineSaved` | `themes/{classic,cs2}.json`, README §5.1 |
| Content key `toasts.offlineSaved` ("Saved offline, will sync") | not present in current `themes/*.json` — new key needed for the offline-queue toast (§6.3) |
