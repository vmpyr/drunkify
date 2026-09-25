# 06 — Metrics, Ranks, Archetypes, Awards, Wrapped Payloads, Replay

Scope: `packages/shared/metrics/*` (pure functions, no I/O), `packages/content/prices.json` + `packages/content/comparisons.json` (new files, README §5.1), `wrapped_snapshots` table (see `02-data-model.md`). Consumed by `apps/server` (snapshot builder) and `apps/web` (Wrapped renderer). Source: product spec §6, §8–§11; `design/DESIGN_SPEC.md` §6.9–6.11, §10; `design/themes/{classic,cs2}.json`.

All formulas are **pure functions of a trip's `SnapshotInput`** (§1.1a: `DrinkRow[]`, `Prediction[]`, members, venues, achievement unlocks — `TripMeta` is a reduced projection of it). No wall-clock reads inside metrics — snapshot time is passed in explicitly, for determinism and testability.

---

## 0. Conventions

- Money uses `packages/content/prices.json`, default currency EUR (see §2.5).
- All "tie-break" rules exist so results are 100% deterministic given the same inputs — required for golden tests (§12) and for recompute-before-freeze (§8) to be safe.
- Global final tie-break, if a rule below runs out: `userId` ascending (string compare).
- Drinks are hard-deleted, no soft-delete column (C6) — a deleted drink is simply absent from the `DrinkRow[]` input; no `deletedAt` filtering exists or is needed in this module.
- "Group" = all non-removed-from-metrics trip members (README D11: removed users still count).
- **C21**: every `drinkCount`-shaped field in this module (`VolumeTotals`, `DayBucket`, `HourBucket`, `PlaceBucket`, `DrinkAgg`, side-leaderboard `most_drinks`, `least_logged`, …) = `Σ qty`, never row count. Stated once here, not repeated per struct.
- **C44** (extends C21): `Σqty`, not row count, also governs `brandLoyalty().sharePct` (both numerator and denominator) and the CS2 Drink Rating 2.0 `A` input (`cheersCount`, §2.5) — `D` (soft drinks/day) was already `Σqty` via `sumVolume`. `adventurousness()` is the one adjacent metric this does **not** apply to: it's a distinct-`drinkKey` presence count (`Set.size`) — variety, not volume — so a drinkKey counts once regardless of its `Σqty`.
- **C24**: nothing in `PersonalWrappedPayload`/`SquadWrappedPayload` may hold a value that requires a theme-pack or roster lookup to have already happened (rank names, archetype/award labels, write-ups, resolved member display names). Payloads carry keys, indexes, ids and raw numbers; the client resolves labels from the theme pack and names from the trip roster it already holds. Called out per-field below where a fix was needed.

---

## 1. Inputs and derived fields

### 1.1 `DrinkRow` (normalized input contract)

```ts
export type DrinkCategory =
  | 'beer' | 'wine' | 'cocktail' | 'spirit' | 'shot' | 'cider' | 'seltzer' | 'soft' | 'other';

export type Rating = 1 | 2 | 3 | 4 | 5; // 🤮 😐 🙂 😍 🔥

export interface DrinkRow {
  id: string;                 // UUIDv7, client-generated
  tripId: string;
  userId: string;
  category: DrinkCategory;
  drinkName: string;          // as typed/selected, original case
  sizeMl: number;              // integer, size of one serving (drinks.size_ml)
  abv: number;                 // percent, catalog.json abvSlider scale
  qty: number;                  // 0.5 steps
  drunkAt: number;              // epoch ms UTC (user-editable "time" field)
  createdAt: number;            // epoch ms UTC, row insert time (drinks.created_at) — C6: no loggedAt, no deletedAt
  venueId: string | null;
  venueName: string | null;      // snapshot at log time (02 §5.7) — see C10
  lat: number | null;
  lng: number | null;
  city: string | null;          // resolved via GEO (D8)
  countryCode: string | null;    // resolved via GEO (D8); ISO 3166-1 alpha-2 (drinks.country_code)
  rating: Rating | null;
  note: string | null;
  editCount: number;             // increments on every edit after create
  lastEditedAt: number | null;    // drinks.last_edited_at; set on PUT only (C46), null if never edited — most-edited tie-break
}

export interface TripMeta {
  id: string;
  timezone: string;             // IANA
  startDate: string;             // trip-local date, YYYY-MM-DD
  endDate: string;
  memberIds: string[];           // join order = avatar colour order
  theme: string;                  // trips.theme_id — content-pack key, unconstrained/extensible (02 §1), not a fixed union
}
```

**`TripMeta` is a reduced projection** of the full snapshot input below — kept small because it's threaded through every low-level per-drink/per-day function (`deriveDrink`, `computeFeatures`, `groupHourlySeries`, `computeReplayTimeline`, …). `memberIds` = `SnapshotInput.members` sorted by `joinedAt` asc, mapped to `userId` (join order = avatar colour order = `colorIndex`, 02 §5.6).

### 1.1a `SnapshotInput` (complete builder contract)

The snapshot builder (`buildPersonalWrapped` / `buildSquadWrapped`, §8) takes exactly this and nothing else — no DB reads mid-computation:

```ts
export interface SnapshotTrip {
  id: string;
  name: string;
  startDate: string;                 // 'YYYY-MM-DD', trip-local (C19)
  endDate: string;
  timezone: string;                    // IANA
  themeId: string;                      // trips.theme_id
  ownerId: string;
  unlockAt: number;                      // epoch ms
  ceremonyStartedAt: number | null;        // epoch ms; null before ceremony start
}

export interface SnapshotMember {
  userId: string;
  name: string;
  colorIndex: number;   // trip_members.color_index — join order, never reassigned (02 §5.6)
  joinedAt: number;       // epoch ms
  disabled: boolean;        // users.disabled_at != null — still counted everywhere (D11)
}

export interface AchievementUnlock { userId: string | null; key: string; triggeredByUserId: string; unlockedAt: number; vars: Record<string, string | number>; }
// C42: userId null = group-level achievement; triggeredByUserId is the actor and is always present
// (achievement_unlocks.triggered_by_user_id, not null); vars is the {n}/{venue}-style context needed
// for card 11's copy (§9.2) — this mirrors the canonical AchievementUnlock DTO (README C42), trimmed to
// the fields this module actually consumes.

export interface SnapshotVenue { id: string; name: string; lat: number; lng: number; }

export interface SnapshotInput {
  trip: SnapshotTrip;
  members: SnapshotMember[];        // array order = join order
  drinks: DrinkRow[];
  achievementUnlocks: AchievementUnlock[];
  predictions: Prediction[];          // §6.3; a member with no submission is simply absent
  venues: SnapshotVenue[];
}

export function toTripMeta(input: SnapshotInput): TripMeta;
// { id: trip.id, timezone: trip.timezone, startDate: trip.startDate, endDate: trip.endDate,
//   memberIds: members sorted by joinedAt asc → userId, theme: trip.themeId }
```

### 1.2 Derived per-drink fields

Day boundary and "trip day": **06:00 local** — a 02:00 drink belongs to the previous trip-day (owned by `05-domain-logic.md`; restated here because metrics depend on it byte-for-byte).

```ts
export interface DerivedDrink extends DrinkRow {
  stdDrinks: number;   // sizeMl * (abv/100) * 0.789 / 10 * qty     — catalog.json formula
  grams: number;        // stdDrinks * 10
  ethanolMl: number;    // sizeMl * (abv/100) * qty                  — pure alcohol volume
  litres: number;        // sizeMl * qty / 1000                       — beverage volume
  tripDay: number;        // 1-based, 06:00-local boundary
  localHour: number;       // 0-23 in trip.timezone
  isAlcoholic: boolean;     // category !== 'soft'
  visitKey: string | null;   // `${tripDay}:${venueId}` when venueId is set; null otherwise — a
                               // visit requires a resolved venue_id (identical rule to 05's
                               // `regular` achievement, 05 §8); never falls back to venueName
  drinkKey: string;           // drinkKey(category, drinkName) = `${category}:${normalizeDrinkName(drinkName)}` — rollup identity
}

export function deriveDrink(row: DrinkRow, trip: TripMeta): DerivedDrink;

// trim + collapse whitespace + lowercase; category included so "Old fashioned" (cocktail)
// never merges with an unrelated "Old fashioned" typo in another category.
export function drinkKey(category: DrinkCategory, drinkName: string): string; // uses 05's normalizeDrinkName(name)
```

**DECISION:** `drunkAt` (editable) is the authoritative time for every metric (day bucketing, hour-of-day, ordering, replay). `createdAt` is never used in metrics, only for edit/undo bookkeeping.

---

## 2. Metric formulas (§6.1–6.6)

Module layout under `packages/shared/metrics/`:

```
types.ts        derive.ts       totals.ts       absurd.ts
distribution.ts ratings.ts      fun.ts          leaderboards.ts
ranks.ts        archetypes.ts   awards.ts       bloopers.ts
payloads.ts     replay.ts       format.ts
```

All aggregation functions take `DerivedDrink[]` already filtered to the trip and to non-deleted rows, sorted by `(drunkAt, id)` ascending — callers must sort once; functions assume stable input order for deterministic floating-point summation (Kahan summation not required at this scale, but summing in a fixed order is).

### 2.1 Volume and alcohol (spec §6.1)

```ts
export const UNITS = {
  ukPintMl: 568.26,
  usPintMl: 473.18,
  gramsPerStd: 10,
  ethanolDensity: 0.789, // g/mL, from catalog.json
} as const;

export interface VolumeTotals {
  drinkCount: number;      // Σ qty (half quantities count)
  ml: number;
  litres: number;
  ukPints: number;
  usPints: number;
  stdDrinks: number;
  grams: number;             // pure-alcohol grams
  ethanolLitres: number;      // pure-alcohol litres
}

export function sumVolume(drinks: DerivedDrink[]): VolumeTotals;

// weighted by beverage volume (ml*qty), not by drink count
export function weightedAvgAbv(drinks: DerivedDrink[]): number; // %, 1 decimal
// = Σ(abv_i * ml_i * qty_i) / Σ(ml_i * qty_i); 0 if Σ(ml_i * qty_i) === 0 (zero-drink member, §9.4)

export function shareOfGroupAlcohol(memberGrams: number, groupGrams: number): number;
// = memberGrams / groupGrams * 100; 0 if groupGrams === 0 (zero-alcohol trip — never divide by zero)
```

`drinkCount` = `Σ qty`, **not** row count (spec: "including half quantities").

### 2.2 Absurd units (spec §6.2)

**Source of truth: `packages/content/comparisons.json`** (new file, README §5.1) — constants below are content, not hardcoded TS, so a future theme/locale can retune them without a code change.

```jsonc
// packages/content/comparisons.json
{
  "absurdUnits": {
    "bathtub":       { "volumeL": 150,       "displayAs": "count"   },
    "olympic_pool":  { "volumeL": 2500000,   "displayAs": "percent" },
    "pub_keg":       { "volumeL": 50,        "displayAs": "count"   },
    "tanker_truck":  { "volumeL": 30000,     "displayAs": "count"   },
    "fire_hydrant":  { "volumeL": 4000,      "displayAs": "minutes" }
  },
  "liverMilesKmPerL": 8.5,
  "liverMilesReferenceDistances": [
    { "label": "London to Paris", "km": 344 },
    { "label": "New York to Boston", "km": 306 },
    { "label": "the length of Route 66", "km": 3945 }
  ]
}
```

**DECISION — fixed constants** (comedic, not scientific; cite once here, never re-derive):

| Key | Constant | Basis |
|---|---|---|
| `bathtub` | 150 L | DECISION: average household bathtub fill |
| `olympic_pool` | 2,500,000 L | Fixed: FINA 50 m × 25 m × 2 m pool |
| `pub_keg` | 50 L | Fixed: standard UK 11-gal keg (also used for §2.6 "the keg") |
| `tanker_truck` | 30,000 L | DECISION: mid-size beverage tanker |
| `fire_hydrant` | 4,000 L/min flow | DECISION: typical hydrant flow; expressed as **minutes of flow**, not a static volume |

```ts
export type AbsurdUnitKey = 'bathtub' | 'olympic_pool' | 'pub_keg' | 'tanker_truck' | 'fire_hydrant';

export interface AbsurdUnitResult {
  key: AbsurdUnitKey;
  value: number;              // rounded per §11
  displayAs: 'count' | 'percent' | 'minutes';
}

export interface ComparisonsConfig {
  absurdUnits: Record<AbsurdUnitKey, { volumeL: number; displayAs: AbsurdUnitResult['displayAs'] }>;
  liverMilesKmPerL: number;
  liverMilesReferenceDistances: { label: string; km: number }[];
}
// loaded once from comparisons.json at boot; values above are that file's v1 defaults

/**
 * "Funniest number" selection — deterministic.
 * Target range for the raw value (count, or minutes, or 0-100 for percent/100): [0.3, 30].
 * Score = |ln(value) - ln(3)| (3 = geometric mean of 0.3 and 30); lower is funnier.
 * If no unit's value falls in [0.3, 30], pick the one with the smallest score anyway
 * (i.e. closest to the range on a log scale).
 * Tie-break (equal score, epsilon 1e-9): fixed priority order below.
 */
export const ABSURD_TIE_BREAK_ORDER: AbsurdUnitKey[] =
  ['bathtub', 'pub_keg', 'olympic_pool', 'tanker_truck', 'fire_hydrant'];

export function funniestAbsurdUnit(volumeL: number, config: ComparisonsConfig): AbsurdUnitResult;
export function absurdUnitPhrase(result: AbsurdUnitResult, theme: ThemePack): string; // "0.6 bathtubs" / "12% of an Olympic pool" / "3 minutes of fire hydrant flow"
```

**DECISION:** absurd units apply to **beverage volume** (litres), not pure ethanol — matches card 02 (`{litres}` → `{absurdValue}`) and keeps "the keg" (§2.6) using the same total.

### 2.3 Distribution (spec §6.3)

```ts
export interface DayBucket { tripDay: number; drinkCount: number; stdDrinks: number; }
export function byDay(drinks: DerivedDrink[]): DayBucket[]; // one entry per tripDay with ≥1 drink

// peak: max stdDrinks; quietest: min stdDrinks among days with ≥1 drink.
// Tie-break: earliest tripDay wins both (peak and quietest).
export function peakDay(days: DayBucket[]): DayBucket;
export function quietestDay(days: DayBucket[]): DayBucket;

export interface HourBucket { hour: number; drinkCount: number; stdDrinks: number; } // 0-23, local
export function byHour(drinks: DerivedDrink[]): HourBucket[]; // 24 entries, zero-filled

export interface PlaceBucket { key: string; label: string; drinkCount: number; stdDrinks: number; }
export function byCity(drinks: DerivedDrink[]): PlaceBucket[];
export function byCountry(drinks: DerivedDrink[]): PlaceBucket[];
export function byVenue(drinks: DerivedDrink[]): PlaceBucket[]; // key = venueId ?? venueName (display aggregation by volume, distinct from visit counting below)
// sort desc by drinkCount; tie-break: stdDrinks desc, then label alphabetical.

export interface DrinkAgg { drinkKey: string; label: string; category: DrinkCategory; drinkCount: number; stdDrinks: number; }
export function topDrinks(drinks: DerivedDrink[], n: number): DrinkAgg[]; // sort desc drinkCount, tie stdDrinks desc, tie label asc
export function categoryMix(drinks: DerivedDrink[]): { category: DrinkCategory; sharePct: number }[]; // share of total drinkCount
```

**"Most-visited venue"** (card 06) ranks by **visits**, not drink rows — see §1.2 `visitKey` definition (a visit = one `(tripDay, venueId)` pair per member, `venueId` required; identical to the `regular` achievement's "5th visit", 05 §8). Computed via `memberVisitCount`, not `byVenue` (which sorts by `drinkCount` and is for display aggregation only).

```ts
export function memberVisitCount(drinks: DerivedDrink[]): Map<string /*venueId*/, number>;
// drinks with visitKey === null (no venueId) are excluded; group by venueId,
// count = Set(visitKey).size per venueId
```

### 2.4 Ratings (spec §6.4)

Rollup key = `drinkKey` (§1.2). Only rated drinks (`rating != null`) count.

| Metric | Formula | Eligibility | Tie-break |
|---|---|---|---|
| **Top-rated** (personal) | `drinkKey` with max avg(own ratings) | ≥1 own rating | most own-orders, then `drinkKey` asc |
| **Guilty pleasure** | `drinkKey` with avg(own rating) ≤ **2** and own order count ≥ **3** | must satisfy both thresholds | lowest avg, then most orders, then `drinkKey` asc |
| **Crowd favourite** | `drinkKey` with max avg(all members' ratings) | ≥ **3** distinct raters | most raters, then `drinkKey` asc |
| **Most divisive** | `drinkKey` with max population stddev of ratings | ≥ **2** distinct raters | most raters, then `drinkKey` asc |

**DECISION:** thresholds `2` (out of 5) for guilty pleasure, `3` orders, `3` raters for crowd favourite, `2` raters for divisive, population stddev (not sample) for determinism at tiny N.

```ts
export interface RatingAgg { drinkKey: string; label: string; avg: number; raterCount: number; stddev: number; }
export function personalRatingRollup(drinks: DerivedDrink[], userId: string): RatingAgg[];
export function groupRatingRollup(drinks: DerivedDrink[]): RatingAgg[]; // across all members

export function topRated(rollup: RatingAgg[]): RatingAgg | null;
export function guiltyPleasure(rollup: RatingAgg[], drinks: DerivedDrink[], userId: string): RatingAgg | null;
export function crowdFavourite(rollup: RatingAgg[]): RatingAgg | null;   // min raters 3
export function mostDivisive(rollup: RatingAgg[]): RatingAgg | null;    // min raters 2
```

### 2.5 Fun metrics (spec §6.5)

**Liver miles** — DECISION constant: E100 (pure-ethanol-fuelled) car efficiency **8.5 km/L** (comedic order-of-magnitude, cited once, never re-derived); sourced from `comparisons.json → liverMilesKmPerL` (§2.2), not hardcoded.

```ts
export function liverMiles(ethanolLitres: number, config: ComparisonsConfig): number; // km, 0 decimals; uses config.liverMilesKmPerL
```

**Economy comparison** — `packages/content/prices.json` (new file):

```jsonc
{
  "currency": "EUR",
  "categoryPrices": { "beer": 5, "wine": 7, "cocktail": 11, "spirit": 7, "shot": 5, "cider": 6, "seltzer": 5, "soft": 3, "other": 6 },
  "gdpComparison": { "referenceCountry": "Malta", "gdpPerSecondEUR": 466 }
}
```

**DECISION:** static, global (no per-city price variation in v1 — product spec's "average local prices per city" is deferred; a single default table keeps this offline-safe and deterministic). **DECISION:** the GDP comparison always uses the fixed `referenceCountry` in `prices.json`, never the trip's actual country — avoids needing a live/offline GDP dataset. `{country}` in card copy = `gdpComparison.referenceCountry`.

```ts
export function estimatedSpend(drinks: DerivedDrink[], prices: PricesConfig): number; // Σ categoryPrices[category] * qty
export function gdpSharePct(spendEUR: number, prices: PricesConfig): number;
// = spendEUR / gdpComparison.gdpPerSecondEUR * 100
```

**Drunk-o-meter + incident detection**:

```ts
export interface HourPoint { hourIndex: number; /* absolute hour offset from trip start */ std: number; localLabel: string; }
export function groupHourlySeries(drinks: DerivedDrink[], trip: TripMeta): HourPoint[]; // zero-filled, full trip span

export interface Incident { hourIndex: number; std: number; rank: number; }
/**
 * Top-N local maxima with minimum separation. Greedy:
 * 1. candidates = points with std > 0, sorted by std desc (tie: earlier hourIndex first)
 * 2. walk candidates; accept if |hourIndex - accepted.hourIndex| >= minSeparationHours for all accepted
 * 3. stop at topN accepted
 * 4. return sorted by hourIndex asc, rank = 1-based order of discovery (i.e. biggest incident = rank 1)
 */
export function detectIncidents(
  series: HourPoint[],
  opts?: { topN?: number; minSeparationHours?: number }, // DECISION defaults: topN=5, minSeparationHours=3
): Incident[];
```

**Brand loyalty / adventurousness**:

```ts
export function brandLoyalty(drinks: DerivedDrink[]): { drinkKey: string; label: string; sharePct: number };
// C44: sharePct = Σqty(topDrinkKey) / Σqty(all) * 100 — qty-weighted, matches "X% of your drinks were Y"
export function adventurousness(drinks: DerivedDrink[]): number; // Set(drinkKey).size — distinct-type presence, not Σqty (C44)
```

**Pace twin** — cosine similarity on per-day std vectors, vector length = elapsed trip days at snapshot (§4), zero-filled:

```ts
export function dailyStdVector(drinks: DerivedDrink[], elapsedDays: number): number[]; // index 0 = tripDay 1

export interface PaceTwinResult { partnerId: string; matchPct: number; bestDay: number; }
/**
 * For member A: for every other member B, cosine(vecA, vecB). Winner = max similarity.
 * Tie-break: partner userId asc.
 * bestDay = argmax(vecA[d] * vecB[d]) over the winning pair (biggest joint contribution to the dot
 * product); tie-break: earliest day.
 */
export function paceTwin(memberId: string, vectors: Map<string, number[]>): PaceTwinResult | null;
// null if trip has < 2 members with any drinks, or all-zero vectors (cosine undefined)
```

**The keg**:

```ts
export function kegPercent(totalLitres: number, kegVolumeL = ABSURD_UNITS.pub_keg.volumeL): number; // %, 1 decimal
```

**Drink Rating 2.0** (CS2 leaderboard column; restated here, must match `05-domain-logic.md` if it also defines it — this file is the source of truth for the formula, `05` should link back):

```ts
export interface RatingInputs { kPerDay: number; aPerDay: number; dPerDay: number; unique: number; }
/**
 * z-scored within the group (population stddev, epsilon floor to avoid /0 — see §5).
 * rating2 = clamp(1 + 0.5*z(K) + 0.3*z(A) - 0.2*z(D) + 0.1*z(unique), 0, 3), 2 decimals.
 * K = std/day, A = "cheers" Σqty/day (synced within 60s of another member — same window as the
 * Cheers!/Executed achievement), D = soft Σqty/day. C44: A and D are Σqty/day, not row-count/day.
 */
export function drinkRating2(member: RatingInputs, group: RatingInputs[]): number;

export function cheersCount(memberDrinks: DerivedDrink[], allDrinks: DerivedDrink[], windowMs = 60_000): number;
// C44: Σqty (not row count) of memberDrinks with >=1 other member's drink within ±windowMs of drunkAt
```

---

## 3. Leaderboards (spec §6.6)

**C23 — `rankMembers()`**, one shared function in `packages/shared/metrics/leaderboards.ts`, is the canonical ranker for the **main board** — used by both the live leaderboard (owned/rendered by `05`, do not redefine there — link back here) and Wrapped card 10 `main_board`. Sort by `value` (`stdDrinks`) **descending only** — there is no ascending mode; tie-break chain, always in this order: `Σqty` desc → earliest `joinedAt` asc → `userId` asc.

```ts
export interface MemberRankInput { userId: string; value: number; qty: number; joinedAt: number; }
export interface RankedRow { userId: string; rank: number; value: number; }

export function rankMembers(members: MemberRankInput[]): RankedRow[];
// primary: value desc; ties: qty desc → joinedAt asc → userId asc. rank is 1-based, ties get
// distinct ranks (the tie-break chain is exhaustive down to userId, so no two rows ever truly tie).
// No `direction` param: any consumer that needs reveal-order reversed (card 10, §9.3) reverses the
// already-ranked array — it never re-ranks ascending.
```

Card 10 `main_board` additionally needs the live leaderboard's full per-row columns (C16: `{std, drinks, k, a, d, rating}`) so the client's existing leaderboard-row component renders both views unchanged:

```ts
export interface MainBoardRow extends RankedRow { std: number; drinks: number; k: number; a: number; d: number; rating: number; }
```

**Side leaderboards (§3.1) do NOT use `rankMembers()`** — each is a distinct single metric with its own domain-specific secondary tie-break (usually `stdDrinks` desc, see table below), not the C23 chain. Don't conflate the two: `rankMembers()` is specifically for "the same ranking the live board and Wrapped both show" (std-based main board); side leaderboards are Wrapped-only novelty rankings.

### 3.1 Side leaderboards (7 keys, exact match to `sideLeaderboards` theme keys)

| Key | Metric | Sort | Eligibility | Tie-break |
|---|---|---|---|---|
| `most_drinks` | `drinkCount` | desc | all members (0 is a valid value) | `stdDrinks` desc |
| `most_litres` | `litres` (beverage volume) | desc | all members (0 is a valid value) | `stdDrinks` desc |
| `most_variety` | `adventurousness()` | desc | all members (0 is a valid value) | `stdDrinks` desc |
| `best_pacer` | coefficient of variation (CV) of per-day std, `stddev/mean` over days with ≥1 drink | **asc** (lower = steadier = better) | ≥1 active day — zero-drink member excluded (CV undefined) | `stdDrinks` desc |
| `earliest_first` | first drink's absolute `drunkAt` | asc | ≥1 drink — zero-drink member excluded (no `drunkAt`) | `userId` asc |
| `latest_last` | last drink's absolute `drunkAt` | desc | ≥1 drink — zero-drink member excluded | `userId` asc |
| `longest_streak` | longest run of consecutive trip-days with ≥1 **alcoholic** drink | desc | all members (0 is a valid value) | `stdDrinks` desc |

Ineligible members are simply absent from that board's `RankedRow[]` (never a zero-valued row standing in for "no data") — the client renders whatever length comes back.

**DECISION — "best pacer":** steadiest drinker (lowest day-to-day CV), i.e. the same underlying metric as the `most_consistent` award, just exposed as a full ranking instead of a single winner (every member appears — matches spec's "everyone places somewhere" for card 7).

```ts
export function coefficientOfVariation(dailyStd: number[]): number; // population stddev / mean; 0 if mean=0
export function longestAlcoholStreak(drinks: DerivedDrink[]): number; // consecutive tripDay count
export function buildSideLeaderboard(key: SideLeaderboardKey, members: MemberMetrics[]): RankedRow[];
// filters to the Eligibility column above before ranking; ineligible members are omitted, not zeroed
```

---

## 4. Rank badges (spec §6.8)

```ts
export interface RankBand { min: number; name: string; } // `name` is theme-pack content, never sent in a payload (C24) — see rankFor()

export function elapsedTripDays(trip: TripMeta, snapshotAt: number): number;
// number of 06:00-local day boundaries that have passed at snapshotAt, min 1
// (delegates to the trip-day function owned by 05-domain-logic.md)

export function tripLengthDays(startDate: string, endDate: string): number;
// inclusive day count of the trip's planned span (05's day-index function on endDate 06:00 boundary - startDate)

export function rankDays(trip: TripMeta, snapshotAt: number): number;
// = clamp(elapsedTripDays(trip, snapshotAt), 1, tripLengthDays(trip.startDate, trip.endDate)) — C22 canonical denominator

export function stdPerDay(totalStd: number, days: number): number; // totalStd / max(days, 1); callers pass rankDays()

export function rankFor(stdPerDayValue: number, bands: RankBand[]): number;
// bands sorted ascending by `min`; returns the INDEX of the last band whose min <= value. C43: this is a
// client-side call only — against whichever theme's own `bands` array is active — because band count
// differs by theme (Classic 10 vs CS2 18); a stored index would mislabel a retheme. The Wrapped payload
// builder never calls this into a stored field; it's exported from `packages/shared` for the client (and
// for tests) to call directly.
```

**DECISION (C22):** the denominator is elapsed trip-days at snapshot time, **clamped to the trip's planned length** (`tripLengthDays`) — fixes the earlier drift from `05-domain-logic.md`, which used the fixed planned length only. Clamping means: a Wrapped generated mid-trip (shortened path) still divides by real elapsed days, while a trip that runs long never divides by more than its planned length. In the normal flow (unlock at scheduled end) `elapsedTripDays == tripLengthDays`, so this only changes behaviour for shortened/extended trips.

Bands are data (`themes/{id}.json → ranks.bands`), not hardcoded — Classic 10 bands, CS2 18 bands, per product spec §6.8. **C43:** card 13 stores raw `stdPerDay` only (no band index, see §9.2) — the client resolves the band by calling `rankFor(stdPerDay, pack.ranks.bands)` against whichever theme is currently active.

---

## 5. Archetypes (spec §6.7)

### 5.1 Behaviour feature vector (per member, pure numbers)

```ts
export interface BehaviourFeatures {
  stdCV: number;            // coefficient of variation of per-day std (steadiness; lower = steadier)
  lateShotShare: number;    // share of stdDrinks from category='shot' logged after 22:00 local
  ratingsCount: number;     // count of own ratings given
  premiumShare: number;     // share of stdDrinks from category in {wine, cocktail} + spirit*0.5 weight
  uniqueDrinks: number;     // adventurousness()
  avgSessionSpanMin: number;// avg per-day (last drink time - first drink time) in minutes, days with >=2 drinks
  firstHourShare: number;   // share of a day's stdDrinks logged within 60 min of that day's first drink, averaged over days
  softShare: number;        // share of drinkCount that is category='soft'
  topDrinkShare: number;    // brandLoyalty().sharePct / 100
  afterMidnightShare: number; // share of drinkCount with localHour in [0,4)
  venueCount: number;       // Set(venueKey).size
  cheersTotal: number;      // Σ cheersCount() across member's drinks
}

export function computeFeatures(memberDrinks: DerivedDrink[], allDrinks: DerivedDrink[], trip: TripMeta): BehaviourFeatures;
```

### 5.2 Scoring

Z-score each feature **within the group** (population mean/stddev across members present in the trip). **DECISION — small-group floor:** `stddev' = max(stddev, 0.05 * max(mean, 1))` before dividing, to avoid divide-by-zero / exploding z-scores at n=2–3; clamp every z-score to `[-3, 3]`.

```ts
export function zScore(value: number, groupValues: number[]): number; // uses the floor above, clamped

export type ArchetypeKey =
  | 'metronome' | 'chaos' | 'connoisseur' | 'explorer' | 'tortoise'
  | 'speedrunner' | 'designated' | 'loyalist' | 'night_owl' | 'social';

export const ARCHETYPE_SCORERS: Record<ArchetypeKey, (z: (f: keyof BehaviourFeatures) => number) => number> = {
  metronome:    (z) => -z('stdCV'),
  chaos:        (z) =>  z('stdCV') + z('lateShotShare'),
  connoisseur:  (z) =>  z('ratingsCount') + z('premiumShare'),
  explorer:     (z) =>  z('uniqueDrinks'),
  tortoise:     (z) =>  z('avgSessionSpanMin') - z('firstHourShare'),
  speedrunner:  (z) =>  z('firstHourShare') - z('avgSessionSpanMin'),
  designated:   (z) =>  z('softShare'),
  loyalist:     (z) =>  z('topDrinkShare'),
  night_owl:    (z) =>  z('afterMidnightShare'),
  social:       (z) =>  z('venueCount') + z('cheersTotal'),
};

export interface ArchetypeResult { main: ArchetypeKey; secondary: ArchetypeKey; }
/**
 * Score every key for the member; main = highest score, secondary = 2nd highest (different key).
 * Tie-break: spec table order (#1..#10, i.e. ARCHETYPE_ORDER index asc), then userId asc.
 */
export const ARCHETYPE_ORDER: ArchetypeKey[] =
  ['metronome','chaos','connoisseur','explorer','tortoise','speedrunner','designated','loyalist','night_owl','social'];

export function classifyArchetype(features: BehaviourFeatures, groupFeatures: BehaviourFeatures[]): ArchetypeResult;
```

**Compatible partner** = `paceTwin(memberId).partnerId` (§2.5) — reused, not recomputed.

**Write-up text**: `themes/<id>.json → archetypes[key].writeup`, filled with placeholders below (union of classic+cs2 usage):

| Placeholder | Source |
|---|---|
| `{perDay}` | `stdPerDay` (§4), formatted 1 decimal |
| `{days}` | `elapsedTripDays` |
| `{ratings}` | `BehaviourFeatures.ratingsCount` |
| `{unique}` | `BehaviourFeatures.uniqueDrinks` |
| `{softShare}` | `BehaviourFeatures.softShare * 100`, 0 decimals |
| `{topDrink}` | `brandLoyalty().label` |
| `{topCount}` | count of `topDrinkKey` orders |
| `{afterMidnight}` | `BehaviourFeatures.afterMidnightShare * 100`, 0 decimals |
| `{venues}` | `BehaviourFeatures.venueCount` |
| `{cheers}` | `BehaviourFeatures.cheersTotal` |
| `{name}` (secondaryPrefix/partner) | secondary archetype label / pace-twin display name — **both client-resolved** (C24): secondary label from `archetypes[secondary].name`, partner name from the trip roster via `twinUserId` |
| `{day}` (partnerNote) | `paceTwin().bestDay` |

All placeholders above are computed server-side as raw numbers/keys and shipped in Card14's `vars` (see §9.2 table); the client does the `{perDay}`/`{days}`/… substitution into the theme's `writeup` template itself — the server never renders write-up text.

**DECISION — small groups (2–3 members):** archetype computation is unchanged; z-scores use the floor in §5.2. No special-cased behaviour, but document the caveat in the write-up copy is out of scope for this doc (content, not logic).

---

## 6. Awards (spec §8) — 13 + Night MVP

### 6.1 Criterion formulas

| Key | Formula | Eligibility | Tie-break |
|---|---|---|---|
| `most_std` | max `stdDrinks` | ≥1 drink — zero-drink member excluded | `drinkCount` desc, then `userId` |
| `most_shots` | max `stdDrinks` where `category='shot'` | ≥1 drink — zero-drink member excluded | total `stdDrinks` desc |
| `fanciest` | max Σ `fancyWeight[category] * stdDrinks_i` | ≥1 drink — zero-drink member excluded | total `stdDrinks` desc |
| `least_logged` | min `drinkCount` | all members, **including zero-drink** (explicitly eligible — often the intended winner) | min `stdDrinks`, then `userId` |
| `earliest_first` | min first-drink `drunkAt` | ≥1 drink — zero-drink member excluded (no `drunkAt`) | `userId` |
| `latest_last` | max last-drink `drunkAt` | ≥1 drink — zero-drink member excluded | `userId` |
| `most_unique` | max `adventurousness()` | ≥1 drink — zero-drink member excluded | `stdDrinks` desc |
| `lowest_rating` | min avg(own ratings given) | ≥3 own ratings (else drop to ≥1) | fewest ratings, then `userId` |
| `highest_rating` | max avg(own ratings given) | ≥3 own ratings (else drop to ≥1) | most ratings, then `userId` |
| `most_consistent` | min CV of per-day std | ≥2 active days | `userId` |
| `comeback` | max `(std[d] - std[d-1])` where `std[d-1] < member's mean std` | needs ≥2 active days with a qualifying quiet day | biggest absolute jump, then earliest `d` |
| `venue_loyal` | max visits (§2.3 `visitKey`) to one venue | ≥1 visit | most total visits, then `userId` |
| `best_predictions` | min `oracleScore` (05 §7, linked at §6.3) | submitted predictions | lower `q1Err`, then earliest `locked_at` |

**DECISION — zero-drink members and "most/least X":** every `most_*`/`earliest_*`/`latest_*` award above requires ≥1 drink; a zero-drink member is never eligible for any of them. `least_logged` is the sole exception — it explicitly welcomes zero-drink members. This is consistent with the allocation fallback (§6.4): a zero-drink member is eligible for zero metrics and is unconditionally assigned `least_logged`.

`fancyWeight`: **DECISION** table —

| Category | Weight |
|---|---|
| wine | 1.0 |
| cocktail | 1.0 |
| spirit | 0.6 |
| other | 0.3 |
| shot | 0.2 |
| beer | 0.1 |
| cider | 0.1 |
| seltzer | 0.05 |
| soft | 0 |

```ts
export const FANCY_WEIGHT: Record<DrinkCategory, number> = { wine: 1.0, cocktail: 1.0, spirit: 0.6, other: 0.3, shot: 0.2, beer: 0.1, cider: 0.1, seltzer: 0.05, soft: 0 };
export function fanciestScore(drinks: DerivedDrink[]): number;
export function comebackDelta(dailyStd: number[]): { day: number; delta: number } | null;
```

### 6.2 Night MVP (per trip-day)

```ts
export function nightMvp(dayDrinks: DerivedDrink[]): { userId: string; std: number };
// max stdDrinks that trip-day; tie-break: alphabetical display name, then earliest first drink that day
```
One per elapsed trip-day; shown in the replay (§10), **not** part of the "every member ≥1 award" pool (§6.4).

### 6.3 Oracle / prediction scoring

**C9: the formula is owned by `05-domain-logic.md` §7 — do not redefine it here.** This module only consumes it: `oracleScore` is `[0,1]`, **0 = perfect, 1 = worst** (05's convention); the winner is the submitter with the **lowest** `oracleScore`, tie-break lower `q1Err` then earlier `locked_at` (predictions have no separate `submitted_at`, C7).

**Q5 (C31):** matched on **`category` + normalized name**, never name alone — 05 §7 owns the exact comparator (`q5Err` uses `predicted_q5_category === actualTopDrink.category && normalizeDrinkName(...) === normalizeDrinkName(...)`). `drinkKey()` (§1.2) is built on 05's `normalizeDrinkName(name)`; one normalizer, no second definition. `Prediction.topDrinkCategory` below is `predictions.q5_top_drink_category` (C31), required input to that comparator.

```ts
export interface Prediction { userId: string; myTotalStd: number; groupTotalStd: number; topMemberId: string; leastMemberId: string; topDrink: string; topDrinkCategory: DrinkCategory; lockedAt: number; }

export interface OracleScore { userId: string; score: number; q1Err: number; } // score = 05 §7's oracleScore
/** Thin wrapper around 05's formula — see 05-domain-logic.md §7 for q1Err..q5Err and oracleScore.
 * Members with no prediction row are EXCLUDED (not scored).
 * Winner = min score; tie-break: lower q1Err, then earlier lockedAt.
 */
export function scorePrediction(p: Prediction, actual: TripActuals): OracleScore;
export function oracle(scores: OracleScore[]): OracleScore | null; // null if nobody predicted
```

### 6.4 Allocation algorithm (every member ≥ 1 award)

**DECISION:**

1. `most_std` is **fixed** to the true top-std member always (it mirrors the live main-leaderboard #1 crowned in Squad card 10 — must never be reassigned).
2. For the remaining 12 awards, walk a fixed priority order (below); for each, pick the top-ranked **eligible candidate who has not yet won an award**. If every eligible candidate already has an award, fall back to the true top-ranked candidate regardless (allows a repeat winner rather than leaving an award unassigned).
3. Single winner per award in this pass (no ties surfaced — deterministic tie-break already resolves them).
4. **Fallback pass — runs for every member left with zero awards after step 2, at any group size** (not only `#members > 13`: with tight eligibility gates — e.g. `≥3` ratings, `≥1` visit — several small-group members can share no eligible criterion in common just as easily). For each such member: compute their percentile rank (1 = best; `position / eligibleCount` among candidates eligible for that metric, using that metric's own §6.1 eligibility gate and tie-break to produce the order first) across every award metric **they are eligible for**; assign the award where they rank best, **as an additional co-winner** (duplicate winners now allowed). Tie-break: lowest percentile wins; if still tied, `AWARD_PRIORITY` order. **If a member is eligible for zero metrics** (degenerate case — e.g. no ratings, no visits, no predictions, single active day), assign `least_logged` unconditionally — every member has a `drinkCount`, so it's always eligible by construction.

```ts
export const AWARD_PRIORITY: AwardKey[] = [
  'most_std', 'best_predictions', 'most_unique', 'highest_rating', 'lowest_rating',
  'most_shots', 'fanciest', 'most_consistent', 'comeback', 'venue_loyal',
  'earliest_first', 'latest_last', 'least_logged',
];

export interface AwardWinner { award: AwardKey; userId: string; isCoWinner: boolean; }
export function allocateAwards(members: MemberMetrics[], predictions: OracleScore[]): AwardWinner[];
```

**DECISION:** duplicate/co-winners are allowed only from the fallback pass (can trigger at any group size once several criteria' eligible pools overlap on the same top performers, not just groups >13). Primary pass never doubles up — keeps the ceremony's "one name per card" staging simple.

### 6.5 The Ghost placement (award sequence order)

```ts
export function orderAwardsForCeremony(winners: AwardWinner[]): AwardWinner[];
// Start from AWARD_PRIORITY order (drop most_std to the position it already holds — it stays first
// thematically but is revealed LAST as the main leaderboard, so it is excluded from card 9 entirely,
// see §9.2). Remove `least_logged`; reinsert at index floor((n-1)/2) of the remaining sequence.
```

**DECISION:** `most_std` (Trip MVP) is **not** one of the 9 award cards in Squad card 9 — it is the climax of Squad card 10 (main leaderboard reveal), per product spec §10 card 10 "crowned Trip MVP". So card 9 shows the other 12 award keys, `least_logged` moved to the middle (index `floor(11/2) = 5`, i.e. 6th of 12).

---

## 7. Blooper stats (credits, spec §10 card 11)

| Stat | Formula | Tie-break |
|---|---|---|
| **Smallest drink logged** | min `sizeMl` across all drinks (serving size, not `qty`-scaled) | earliest `drunkAt` |
| **Strangest note** | longest `note` by character length, among non-null/non-empty notes | earliest `drunkAt` |
| **Most-edited entry** | max `editCount` | `lastEditedAt` desc, then `id` asc (C46) |
| **Lone 4 AM "water"** | a `category='soft'` drink with `localHour === 4` | if multiple qualify, earliest `drunkAt` wins (card copy assumes one; omit the stat entirely if zero) |

**DECISION — "strangest note" heuristic:** longest note wins (deterministic, no NLP). A "least common words" heuristic was considered but rejected — it needs a corpus/vocabulary and isn't reproducible offline.

```ts
export interface Bloopers {
  smallest: { drink: DerivedDrink; userId: string } | null;
  strangestNote: { note: string; drink: DerivedDrink; userId: string } | null;
  mostEdited: { drink: DerivedDrink; userId: string; edits: number } | null;
  loneWater: { drink: DerivedDrink; userId: string } | null;
}
export function computeBloopers(drinks: DerivedDrink[]): Bloopers;
```

---

## 8. Snapshot computation

**DECISION — timing:**

| Snapshot | When computed | Frozen? |
|---|---|---|
| Personal Wrapped (per member) | At scheduled unlock time (scheduler job) — **C26**: scheduler tick (15s) writes the snapshot then the transition marker, in that order, in the same transaction (never marker-first); boot backfills any personal snapshot missing for an already-unlocked trip, so a crash between the two never permanently strands a member without one. **Stale, not eagerly recomputed**: any drink/prediction/membership mutation before ceremony start bumps `trips.data_revision`; a personal snapshot is stale when its `source_revision < trips.data_revision`, and is lazily recomputed (new `revision`) on the next `GET` (C11, C24) | Frozen the instant the owner starts the ceremony |
| Squad Wrapped | At the moment the owner presses **"Start the ceremony"** — **C25**: the squad snapshot write, `trips.ceremony_started_at`, and `ceremony_state` row insert all happen inside **one transaction** (SQLite `BEGIN IMMEDIATE`), owned by the ceremony-start handler (`03-api.md`); SSE `ceremony.started` (C13) is emitted only after commit. This module supplies the pure `buildSquadWrapped()` call the handler makes inside that transaction — it does not own the transaction boundary itself. | Frozen immediately (never recomputed again — replaying the ceremony later must be stable) |

Rationale: predictions/leaderboard integrity requires the squad snapshot (esp. the leaderboard reveal and awards) to be computed from the exact same dataset the ceremony presents, taken once; personal snapshots can stay "live" a little longer since screenshots/sharing happen before the ceremony and small corrections (e.g. someone fixes a typo'd drink) shouldn't feel wrong.

**Storage** (`wrapped_snapshots`, see `02-data-model.md` §5.15 for the full column list — restated here only where this module is the source of truth):

```ts
export interface WrappedSnapshotRow {
  id: string;
  tripId: string;
  userId: string | null;       // null = squad snapshot (02 §5.15) — no separate `type` column, this is the discriminant
  revision: number;              // C24: recompute counter — bumped on formula change, manual regen, or a stale personal recompute
  sourceRevision: number;         // C24: snapshot of `trips.data_revision` at compute time; stale when sourceRevision < trips.data_revision
  payload: PersonalWrappedPayload | SquadWrappedPayload; // stored as json/jsonb (02 wrapped_snapshots.payload); Drizzle handles (de)serialization, not JSON.stringify'd by app code
  computedAt: number;
}
```

`payload.schemaVersion` (below, §9.2/9.3) is the payload **shape** version — independent of `revision`/`sourceRevision` above, which track recompute freshness, not shape (C24; see 02 §5.15 for the full rationale).

**Performance budget:** 10 members × 2,000 drinks each (20,000 rows) < **1 s** wall clock on a Raspberry-Pi-class single instance. Achieved by: one pass to build `DerivedDrink[]` (`O(n)`), one sort (`O(n log n)`), all rollups via `Map` grouping (`O(n)`), pace-twin pairwise cosine `O(m² × days)` (trivial at m≤~30), archetype z-scoring `O(m × features)`. No per-member re-scan of the full drink array — group once, slice per member.

**Determinism / seeded choices:** every formula above is a pure function of sorted input; no `Date.now()`, no `Math.random()` inside `packages/shared/metrics`. **DECISION:** v1 needs no randomness in payload generation (no multi-variant flavour text exists in the theme packs — each card key is a single template). If a future theme adds variant copy, select via a seeded hash of `(tripId, userId, cardKey)` so recompute is still deterministic — documented here for the implementer, not implemented now.

---

## 9. Payload contracts

### 9.1 Shared shapes

```ts
export interface WrappedCard<TVars extends Record<string, string | number> = Record<string, string | number>> {
  id: string;          // e.g. "01_cold_open" — matches themes/<id>.json → wrappedPersonal.cards key
  key: string;           // stable metric key, same across themes (== id, kept separate for clarity)
  vars: TVars;             // placeholder values; client does `template.replace(/\{(\w+)\}/g, k => vars[k])`
  data?: Record<string, unknown>; // chart/map/replay payloads (see per-card table)
}
```

### 9.2 `PersonalWrappedPayload` (14 cards)

**Personal Wrapped never includes leaderboard position** (product spec §9) — no `rank`/`position` field anywhere in this payload.

```ts
export interface PersonalWrappedPayload {
  schemaVersion: 1;     // C24: payload-shape version, independent of the row's `revision`/`sourceRevision` (§8)
  tripId: string;
  userId: string;
  context: { days: number; members: number; ownerId: string; tripName: string }; // for ready/notification chrome, not a card; ownerId (not ownerName — C24) — client resolves from roster
  cards: [
    WrappedCard<Card01>, WrappedCard<Card02>, WrappedCard<Card03>, WrappedCard<Card04>,
    WrappedCard<Card05> | null, WrappedCard<Card06, { route: LatLng[]; venuePins: VenuePin[] }>,
    WrappedCard<Card07> | null, WrappedCard<Card08> | null, WrappedCard<Card09>, WrappedCard<Card10>,
    WrappedCard<Card11, { achievements: { key: string; unlockedAt: number }[] }> | null,
    WrappedCard<Card12> | null, WrappedCard<Card13>, WrappedCard<Card14>,
  ];
  // §9.4: a `null` slot means "skipped for this member" — index stays stable (so `id`/ceremony-adjacent
  // tooling can still reason positionally), the client's swipe deck simply omits null slots.
}
```

| Card | Vars (union classic+cs2) | Source |
|---|---|---|
| 01 cold_open | `totalDrinks`, `days` | `sumVolume().drinkCount`, `elapsedTripDays` |
| 02 absurd_units | `litres`, `ukPints`, `std`, `absurdValue`, `absurdUnitPhrase` | `sumVolume`, `funniestAbsurdUnit` |
| 03 guess_ethanol | `diff` (+ raw `actualEthanolL` in `data` for the client-side slider compare) | `sumVolume().ethanolLitres` minus prediction (no prediction question covers this — client holds the user's live in-card guess, `diff` is filled client-side; server only supplies `actualEthanolL` via `data`) |
| 04 abv_share | `avgAbv`, `share`, `oneIn` (`= round(100/share)`) | `weightedAvgAbv`, `shareOfGroupAlcohol` |
| 05 peak_day | `peakDay`, `peakDrinks`, `peakVenues`, `peakDrink`, `peakTime` | `peakDay()`, `byVenue` restricted to that day, `topDrinks` restricted to that day, that day's busiest `HourBucket` |
| 06 trail | `venue`, `visits`, `km` (`data.route`, `data.venuePins`) | `byVenue()[0]`, `memberVisitCount`, haversine sum over ordered drink lat/lng |
| 07 top_then_guilty | `topRated`, `topRatingValue`, `guilty`, `guiltyRatingValue`, `guiltyCount` | `topRated()`, `guiltyPleasure()`; `*RatingValue` = the raw 1–5 `Rating` (rounded), **not** an emoji — C24: client maps to `{topFace}`/`{guiltyFace}` via `catalog.json → ratingScale` |
| 08 loyal_or_adventurous | `topDrink`, `topShare`, `unique`, `verdict` | `brandLoyalty`, `adventurousness`; `verdict` = "loyal"/"adventurous" text-pack key chosen by `topShare vs unique` z-comparison (DECISION: whichever feature has the higher z-score within the group) |
| 09 absurd_run | `km`, `place`, `spend`, `gdpShare`, `country` | `liverMiles`, `estimatedSpend`, `gdpSharePct`; `place` = closest-by-`km` entry in `comparisons.json → liverMilesReferenceDistances` (§2.2) to the member's `km` |
| 10 pace_twin | `twinUserId`, `day`, `matchPct` | `paceTwin()`; `twinUserId` = `partnerId` (C24: id, not a resolved display name — client looks up the name from the trip roster it already has) |
| 11 achievements | `n` (+ `data.achievements`) | count of `achievement_unlocks` rows with `triggeredByUserId === member.userId` (C42: the actor, not `userId`, which is null for group-level unlocks) |
| 12 prediction_vs_reality | `predicted`, `actual` | `Prediction.myTotalStd`, `sumVolume().stdDrinks`; **DECISION:** card is **skipped** (not a fallback variant) if the member has no prediction row — the missed-prediction state already has a first-class UI surface (C7 `missed_banner_dismissed`), so Wrapped doesn't duplicate it |
| 13 rank | `perDay` | `stdPerDay(totalStd, rankDays(...))` (C22); C43 — no stored band index, client resolves the band via `rankFor(perDay, pack.ranks.bands)` (§4) |
| 14 archetype | `archetype`, `secondary`, `twinUserId \| null`, `perDay`, `days`, `ratings`, `unique`, `softShare`, `topDrink`, `topCount`, `afterMidnight`, `venues`, `cheers` | `classifyArchetype()` (keys only), `paceTwin().partnerId` (id, null if no twin — §9.4); **C24: no `writeup` field** — the raw feature values (same list as the write-up placeholder table, §5.2) are sent instead and the client fills `themes/<id>.json → archetypes[key].writeup` itself |

Card `03`'s `diff`/interactivity: **DECISION** — the guess is entered live in the UI (product spec: "a slider for the user's guess"), never stored server-side; payload only supplies the actual value the client compares against.

### 9.3 `SquadWrappedPayload` (11 cards)

```ts
export interface SquadWrappedPayload {
  schemaVersion: 1;    // C24: payload-shape version, independent of the row's `revision`/`sourceRevision` (§8)
  tripId: string;
  cards: [
    WrappedCard<SCard01>, WrappedCard<SCard02, { series: HourPoint[]; incidents: Incident[] }>,
    WrappedCard<SCard03>, WrappedCard<SCard04>, WrappedCard<SCard05>,
    WrappedCard<SCard06Meta, { replay: ReplayPayload }>,                    // §10
    WrappedCard<SCard07, { boards: Record<SideLeaderboardKey, RankedRow[]> }>,
    WrappedCard<SCard08Meta, { rows: PredictionRevealRow[] }>,
    { id: '09_awards'; winners: AwardCard[] };                                // one entry per award, expanded
    WrappedCard<SCard10Meta, { ranking: MainBoardRow[] }>;                    // ascending, last place first (§3)
    WrappedCard<SCard11, { bloopers: Bloopers; archetypes: Record<string, ArchetypeResult> }>,
  ];
}

// C24: no `name` here — it would duplicate/stale-cache the winner's display name. userId is already
// present; the client resolves the name from the trip roster. `venue` (venue_loyal only) is raw
// application data (a real venue name string), not theme-pack content, so it's fine to embed.
export interface AwardCard { award: AwardKey; winners: { userId: string; venue?: string }[]; isGhostSlot: boolean; }
export interface PredictionRevealRow { userId: string; predicted: number; actual: number; }
```

| Card | Vars | Source |
|---|---|---|
| 01 group_total | `groupStd`, `absurdValue`, `absurdUnitPhrase` | `sumVolume` (group), `funniestAbsurdUnit` |
| 02 drunk_o_meter | `n`, `day`, `time` (per incident) | `detectIncidents` |
| 03 keg | `kegPct` | `kegPercent` (group) |
| 04 cities_venues | `venue`, `cities`, `venues` | `byVenue`, `byCity` (group) |
| 05 crowd_then_divisive | `drink`, `low`, `lowName`, `high`, `highName` | `crowdFavourite`, `mostDivisive` (+ the min/max-rating member names for the divisive drink) |
| 06 replay | `nightMvpIndex` (night MVP per day, in `data.replay.dayEndMarkers`) | §10; index into `memberIndex` (C24: no name — matches the replay's existing convention) |
| 07 side_boards | — (chrome only; `data.boards` carries all 7 as `RankedRow[]`, `userId` + `value`) | §3 |
| 08 predictions | `userId`, `predicted`, `actual` (per row) | `Prediction`, `sumVolume` per member; `oracle`; `PredictionRevealRow` carries `userId` only (C24) — client resolves name from roster |
| 09 awards | `award` (+ `venue` for `venue_loyal`) | §6, one `AwardCard` per award key in `orderAwardsForCeremony` order; `award` is the **key** — client resolves the award title from `awards[key].name`, and the winner's name from `userId` via the roster (C24) |
| 10 main_board | — (chrome; `data.ranking: MainBoardRow[]` drives the reveal) | §3 `rankMembers()` (shared with the live leaderboard), called **once**, descending, with the C16 per-row columns attached; the resulting array is then **reversed** for reveal order (§3) — ranks are not recomputed on the reversed array |
| 11 credits | `ml`, `drink`, `userId` / `note`, `userId` / `drink`, `edits`, `userId` / `time`, `userId` | §7; `Bloopers` already carries `userId` not name (C24) — client resolves the name for every `{name}` placeholder from the roster |

**DECISION — leaderboard reverse order:** `rankMembers()` is called exactly **once**, descending (its only mode, §3), producing the canonical `RankedRow[]` with `rank` 1 = Trip MVP. `data.ranking` in card 10 is that same array with `.reverse()` applied for reveal — the `rank` field on each row is untouched by the reversal, only array order changes — so the client reveals rows in array order (last place first) and ends on index `length-1`, whose `rank` field reads `1` = Trip MVP.

---

### 9.4 Zero/edge-data fallbacks

Every card's behaviour at the edges below is now fixed — no card may render `NaN`/`Infinity`/a crash. Two mechanisms only: **skip** (payload slot is `null`, §9.2/§9.3 tuple types) for Personal cards where the whole card is meaningless with no data; **fallback variant key** (`themes/<id>.json` sibling key next to the card's normal copy, both packs must define it) where the card stays but shows different copy. Squad cards are a **fixed 11-slot ceremony sequence (C18: `current_card_index` 0–10) and are never skipped** — every Squad edge case below is a fallback variant, not a null slot.

**Formula-level guards** (why no formula ever dereferences a missing top drink, divides by zero, or lets a zero-drink member win the wrong award — the card-level tables below build on these):

| Guard | Where | Rule |
|---|---|---|
| Zero-drink member excluded from "most/least X" | Side leaderboards §3.1 (`most_drinks`…`longest_streak`), Awards §6.1 (`most_std`, `most_shots`, `fanciest`, `most_unique`, `earliest_first`, `latest_last`, `venue_loyal`) | Requires ≥1 drink (≥1 visit for `venue_loyal`) per that section's Eligibility column — **except `least_logged`**, which explicitly includes zero-drink members as a valid, intended winner |
| Divide-by-zero: `weightedAvgAbv` | §2.1 | Returns `0` when `Σ(ml*qty) === 0` |
| Divide-by-zero: `shareOfGroupAlcohol` | §2.1 | Returns `0` when `groupGrams === 0` (whole trip is zero-alcohol) |
| Divide-by-zero: `brandLoyalty` | §2.5 | Not called — card **skipped** (table below) when `drinkCount === 0` |
| Divide-by-zero: `coefficientOfVariation` | §3.1 | Returns `0` when `mean === 0` |
| Divide-by-zero: `gdpSharePct` | §2.5 | Denominator is a fixed content constant (`gdpComparison.gdpPerSecondEUR`), never `0` by construction |
| Null top drink: `topRated` / `crowdFavourite` / `mostDivisive` | §2.4 | Return `null` when the eligibility threshold (own rating / ≥3 raters / ≥2 raters) isn't met — callers must null-check (table below) before dereferencing, never assume a result exists |
| Null top drink: `topDrinks` | §2.3 | Returns `[]` on no rated/rollup-eligible rows, never `undefined` |
| Null top drink: `funniestAbsurdUnit` | §2.2 | Undefined at `litres === 0` — handled as a card **fallback variant**, not a formula-level null (row below) |

**Personal Wrapped**

| Card | Trigger | Behaviour |
|---|---|---|
| 01 cold_open, 03 guess_ethanol, 09 absurd_run, 13 rank | 0 drinks | Renders correctly as zero-valued (no `NaN`/`Infinity` path) — **no fallback needed** |
| 02 absurd_units | 0 drinks (`litres === 0`) | `funniestAbsurdUnit` is undefined at volume 0 (all units score `-Infinity` identically) — **fallback variant** `cards.02_absurd_units.empty` |
| 04 abv_share | 0 drinks (`share === 0`) | `oneIn = round(100/share)` divides by zero — **fallback variant** `cards.04_abv_share.empty` (omits the `{oneIn}` line) |
| 05 peak_day | 0 drinks (no days with any drink) | `peakDay()`/`quietestDay()` undefined (empty `DayBucket[]`) — **skip** |
| 06 trail | No venues/GPS ever resolved (`byVenue()` empty) | **fallback variant** `cards.06_trail.empty` |
| 07 top_then_guilty | No own ratings at all (`topRated()` null) | Both halves need ratings — **skip** |
| 07 top_then_guilty | ≥1 own rating but `guiltyPleasure()` null | **fallback variant** `cards.07_top_then_guilty.noGuilty` (top half only) |
| 08 loyal_or_adventurous | 0 drinks | `brandLoyalty()` divides by zero — **skip** |
| 10 pace_twin | No pace twin (`paceTwin()` null — solo trip or only 1 member with any drinks) | **skip** |
| 11 achievements | 0 unlocks | **skip** |
| 12 prediction_vs_reality | No prediction row for the member | **skip** (finalized — see §9.2 table; not a variant, to avoid duplicating the existing missed-prediction UI, C7) |
| 14 archetype | No pace twin (`paceTwin()` null) | **fallback variant** `cards.14_archetype.noPartner` (drops the partner line; archetype/write-up itself still computes — z-score floor, §5.2, keeps it defined even at n=1) |

**Squad Wrapped**

| Card | Trigger | Behaviour |
|---|---|---|
| 02 drunk_o_meter | `detectIncidents()` returns `[]` (no drinks trip-wide) | **fallback variant** `cards.02_drunk_o_meter.empty` |
| 04 cities_venues | No venues resolved trip-wide | **fallback variant** `cards.04_cities_venues.empty` |
| 05 crowd_then_divisive | `crowdFavourite()` null (`<3` distinct raters group-wide) | **fallback variant** `cards.05_crowd_then_divisive.noCrowd` |
| 05 crowd_then_divisive | `mostDivisive()` null (`<2` distinct raters) | **fallback variant** `cards.05_crowd_then_divisive.noDivisive` (independent of the above — either, both, or neither can fire) |
| 06 replay | Zero drinks trip-wide (`events`/`dayEndMarkers` empty) | **fallback variant** `cards.06_replay.empty` |
| 08 predictions | `oracle()` null (nobody predicted) | **fallback variant** `cards.08_predictions.empty` (`rows` may still be non-empty from members who predicted; the Oracle line specifically is omitted) |
| 03 keg, 07 side_boards, 09 awards, 10 main_board, 11 credits | Any group size, incl. 0-drink members mixed in | Already deterministic at zero per their formulas (`kegPercent`, `coefficientOfVariation`, award fallback pass §6.4, `rankMembers`, `Bloopers` all-null fields) — **no fallback needed** |

New content keys are listed together in §13.

---

## 10. Replay data (Squad card 6)

```ts
export interface ReplayPayload {
  schemaVersion: 1;    // C24 naming convention (shape version), consistent with the outer payload's `schemaVersion`
  memberIndex: string[];        // userId per index (join order = avatar colour, per TripMeta.memberIds)
  totalPlaybackMs: number;        // clamped to [60_000, 90_000], target 75_000 (§10)
  events: ReplayEvent[];           // sorted by tOffsetMs asc
  dayEndMarkers: { tOffsetMs: number; tripDay: number; nightMvpIndex: number }[];
  achievementPops: { tOffsetMs: number; memberIndex: number; key: string }[]; // C42: field name matches AchievementUnlock.key
}

export interface ReplayEvent {
  tOffsetMs: number;    // playback-timeline offset, not real time
  memberIndex: number;
  lat: number | null; lng: number | null;   // null when the drink has no resolved venue/GPS — no map pulse, but still a score event (below)
  std: number;
}
```

**Every drink is a score event:** `events` contains exactly one entry per (non-deleted) drink trip-wide, regardless of whether `lat`/`lng` resolved — a drink with no venue is never dropped. The client folds every event's `std` into the running ticker/leaderboard as it plays; it only renders a map pulse for events where `lat`/`lng` are non-null.

**DECISION:** no `leaderboardSnapshots` field — the client derives the running leaderboard by folding `events` (cheap, `O(events)`, and halves payload size). Only `dayEndMarkers` (for the Night MVP banner) and `achievementPops` are precomputed server-side, since both need data (achievement timestamps, night MVP) not reconstructable from `events` alone.

**Time compression rule** (real trip time → 60–90 s playback, target 75 s) — rewritten to fix the earlier version's overflow on long trips (a run of empty overnight hours could alone blow past the 90 s ceiling):

1. Bucket the trip into local hours (`groupHourlySeries`-style, but per-member for dot positions).
2. Walk hours in order; collapse each **run of one or more consecutive hours with zero drinks trip-wide** into a single beat of fixed raw weight `1.0` — a run of 1 empty hour and a run of 50 empty hours both cost exactly one beat. A non-empty ("active") hour is its own beat, raw weight `sqrt(hourStd + 1)` (unchanged square-root compression, so one huge peak hour can't eat the whole budget).
3. `rawTotal = Σ` all raw weights (collapsed-empty-run beats + active-hour beats). `scale = (opts?.targetMs ?? 75_000) / rawTotal` in seconds-equivalent terms; every beat's playback duration = `rawWeight * scale`. This is a straight linear scale of **all** beats (empty-run beats included) to hit the 75 s target.
4. `totalPlaybackMs` after step 3 is clamped into `[60_000, 90_000]` by adjusting `scale` (i.e. if the natural `rawTotal`-driven total would fall outside the range at the 75 s target, `scale` is chosen to land at the nearest bound instead).
5. **Active-hour floor, applied after scaling**: any active-hour beat now below `300 ms` is raised to `300 ms`; the surplus is reclaimed by re-normalizing (scaling down) only the *other* active-hour beats that remain above the floor, keeping the running total inside `[60_000, 90_000]`. Collapsed-empty-run beats are never floored past their scaled value. In the degenerate case where flooring every active hour alone would already exceed `90_000` (many short active hours in a short trip), the floor wins — total may exceed `90_000` slightly rather than making any active hour invisible.

```ts
export function computeReplayTimeline(drinks: DerivedDrink[], trip: TripMeta, opts?: { targetMs?: number }): ReplayPayload;
```

**Size budget — DECISION:** target < **150 KB** pre-gzip for the fixture scale (§12: 6 members / 9 days / ~400 drinks); roughly 400 events × ~40 bytes/event (5 numbers) + markers ≈ well under budget. No images/binary in the payload (map tiles are client-fetched via `MAP_STYLE_URL`, D8).

Video export: **deferred** (README D6) — no export function in this module; replay only ever renders in-app.

---

## 11. Formatting rules

```ts
// packages/shared/metrics/format.ts
export function formatStd(n: number): string;         // 1 decimal, e.g. "12.4"
export function formatPercent(n: number): string;       // 0 decimals; "<1%" if 0 < n < 0.5 rounds to 0
export function formatCurrency(n: number, currency: string): string; // Intl.NumberFormat(locale, {style:'currency', currency})
export function formatCount(n: number): string;           // Intl.NumberFormat grouping (thousands separator) above 999
export function formatKm(n: number): string;                // 1 decimal if <100, else 0 decimals
export function formatAbv(n: number): string;                // reuse catalog.json abvSlider.display rule: 1 decimal <=15%, whole or 1 decimal above
export function formatRating(n: number): string;              // 1 decimal, e.g. "4.2"
export function pluralize(n: number, singular: string, plural?: string): string;
// n === 1 ? singular : (plural ?? `${singular}s`); irregular table: { country: 'countries', city: 'cities' }
```

**DECISION:** locale for `Intl.NumberFormat` calls = `'en-GB'` fixed (no i18n in v1, per README §5 out of scope).

---

## 12. Test fixtures

**Seeded fixture generator** (`packages/shared/metrics/__fixtures__/generate.ts`):

```ts
export function generateFixtureTrip(seed: number): { trip: TripMeta; drinks: DrinkRow[]; predictions: Prediction[] };
```

- PRNG: `mulberry32(seed)` (small, deterministic, no deps).
- **6 members**, **9 trip-days**, **~400 drinks** total (weighted distribution across days/hours so peak/quietest/incidents are non-trivial).
- Guarantees baked in (so every metric in this doc has a fixture case):
  - ≥1 drink with `sizeMl` far below the catalogue minimum (e.g. 20 ml) → smallest-drink blooper.
  - ≥1 drink with a long `note` (>200 chars) → strangest-note blooper.
  - ≥1 drink with `editCount ≥ 5` → most-edited blooper.
  - Exactly one `category='soft'` drink at `localHour === 4` → lone-water blooper.
  - ≥2 countries visited within 24 h → passport-stamp achievement path exercised.
  - At least one member with **zero** predictions (Oracle eligibility) and one with all 5 answered.
  - At least one exact-repeat drink name per member (brand loyalty) and one member with many unique names (adventurousness).
  - Multiple members' drinks within a 60 s window ≥3 times (cheers/A-column).
  - Small-group edge case covered by a **second** fixture: `generateFixtureTrip(seed, { memberCount: 3 })` for the z-score-floor path (§5.2).

**Golden-file tests**:

- `packages/shared/metrics/__fixtures__/golden/{personal-<userId>,squad}.json` — one file per member's `PersonalWrappedPayload` + one `SquadWrappedPayload`, generated from `generateFixtureTrip(42)`.
- Test: `computeX(...)` deep-equals the golden JSON (`toMatchObject`/`toEqual` on `JSON.parse(JSON.stringify(payload))` to normalize key order).
- Determinism test: compute twice from the same input, assert `JSON.stringify(a) === JSON.stringify(b)`.
- Regeneration: `pnpm --filter shared test:golden:update` writes new goldens — must be a deliberate, reviewed diff (never run automatically in CI).
- CI: golden mismatch fails the build; a snapshot-scale perf test asserts the 20,000-row budget (§8) via `console.time`/an assertion on wall-clock ms.
- Fixture generator must additionally guarantee, for the §9.4 fallback matrix to have a test case: **one member with zero drinks** (exercises 02/04/05/08/skips), **one trip-day with zero venues resolved for one member** (06 fallback), and the existing `memberCount: 3` small-group fixture is extended to `memberCount: 1` for one run to exercise `paceTwin() === null` (10/14 fallback, solo trip).

---

## 13. Content additions (README §5.1 / C48 sync)

**C48: this doc does not carry exact copy.** It is the **key + placeholder contract** only — every key below, and its required placeholders, are what the content agent writing `content-additions/{classic,cs2}.json` must fill in for both packs (README C48; those files merge into `packages/content/themes/{classic,cs2}.json` at M0, README §5.1). If a key is missing here, it doesn't get written.

| Key | When used | Required placeholders |
|---|---|---|
| `wrappedPersonal.cards.02_absurd_units.empty` | §9.4 — member logged 0 drinks; absurd-unit selection undefined at `litres === 0` | none |
| `wrappedPersonal.cards.04_abv_share.empty` | §9.4 — member logged 0 drinks; `oneIn` undefined | none |
| `wrappedPersonal.cards.06_trail.empty` | §9.4 — no venues/GPS ever resolved for the member | none |
| `wrappedPersonal.cards.07_top_then_guilty.noGuilty` | §9.4 — member has ≥1 own rating but no qualifying guilty pleasure (top half still renders) | `{topRated}`, `{topRatingValue}` |
| `wrappedPersonal.cards.14_archetype.noPartner` | §9.4 — no pace twin (solo trip / only 1 member with drinks) | `{archetype}`, `{perDay}`, `{days}`, `{ratings}`, `{unique}`, `{softShare}`, `{topDrink}`, `{topCount}`, `{afterMidnight}`, `{venues}`, `{cheers}` (§5.2 write-up vars minus `{name}`/`{day}`) |
| `wrappedPersonal.cards.08_loyal_or_adventurous.verdict.loyal` | Card 08 (§9.2) — `topShare` z-score ≥ `unique` z-score | `{topDrink}`, `{topShare}` |
| `wrappedPersonal.cards.08_loyal_or_adventurous.verdict.adventurous` | Card 08 (§9.2) — `unique` z-score > `topShare` z-score | `{unique}` |
| `comparisons.absurdUnits.{bathtub,olympic_pool,pub_keg,tanker_truck,fire_hydrant}.label` | `absurdUnitPhrase()` (§2.2) — unit name substituted into cards `02_absurd_units` and Squad `01_group_total`; needs singular+plural forms, `displayAs` decides which shows (count/percent/minutes) | none — the label itself is the value substituted into `{absurdUnitPhrase}` |
| `wrappedSquad.cards.02_drunk_o_meter.empty` | §9.4 — no incidents (`detectIncidents()` empty, zero drinks trip-wide) | none |
| `wrappedSquad.cards.04_cities_venues.empty` | §9.4 — no venues resolved trip-wide | none |
| `wrappedSquad.cards.05_crowd_then_divisive.noCrowd` | §9.4 — `<3` distinct raters group-wide | none |
| `wrappedSquad.cards.05_crowd_then_divisive.noDivisive` | §9.4 — `<2` distinct raters | none |
| `wrappedSquad.cards.06_replay.empty` | §9.4 — zero drinks trip-wide | none |
| `wrappedSquad.cards.08_predictions.empty` | §9.4 — nobody predicted (`oracle()` null); `rows` may still be non-empty from members who did predict | none |

No new keys needed for rating-face emoji (existing `catalog.json → ratingScale`, now consumed client-side per C24 instead of server-embedded) or for skipped Personal cards (a `null` payload slot needs no copy).

---
