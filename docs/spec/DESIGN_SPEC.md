# Drunkify V1 — Design Spec for Implementation

This is the build spec for the Drunkify V1 mobile app UI. It sits on top of the product spec (`reference/product-spec-v1.md`), which defines *what* the product does; this document defines *how it looks, reads and behaves*. Where the two disagree, this document wins, and every such change is listed in §2.

**Artifacts in this package**

| Path | What it is | How to use it |
|---|---|---|
| `prototype/index.html` | Interactive reference prototype (single file, open in a browser) | The source of truth for look and interaction. The top phone is fully interactive; everything else is a static state. A Classic / CS2 switch at the bottom re-renders all copy. |
| `screenshots/classic/*.png`, `screenshots/cs2/*.png` | 2× renders of every screen, per theme | Visual targets. Numbered to match §6. |
| `tokens.json` | Colours (dark + light), type scale, spacing, radii, sizes, strokes, motion, haptics | Import into the app's theme layer. Use token names, not raw values. |
| `themes/classic.json`, `themes/cs2.json` | Complete content packs: every name and every line of theme-voiced copy | Load at runtime by trip theme. Key parity between packs is guaranteed. |
| `content/auth.json` | Theme-independent copy for sign-in, invites, password reset, People and Account | Load always. These screens mostly appear before a trip (and so a theme) exists. §6.13. |
| `data/catalog.json` | Drink categories, popular drinks, ABVs, sizes, ABV slider maths, rating scale | Seed data for the log wizard. |
| `icons/drinks/*.svg` | 9 category icons (48×48 viewBox) | Coasters, chips, feed, wizard. Colour roles in §3.5. |
| `icons/ui/*.svg` | 23 UI icons (24×24 viewBox, 1.8 stroke, currentColor) | Navigation and controls. |
| `reference/product-spec-v1.md` | Original product spec | Behaviour, metrics catalogue, lifecycle. |

---

## 1. Design principles

1. **Built for 1 a.m.** The app is used in dark, loud bars, with one thumb, often slightly impaired. Every primary target is ≥ 44 pt, primary actions sit in the bottom two-thirds of the screen, and nothing needs reading before tapping.
2. **Logging is never a form.** One question per screen, pre-filled from habit, moving on the moment you answer. Everything optional stays small and already correct.
3. **Themes are a script, not a skin.** The app looks identical in every theme. A theme renames things (achievements, ranks, awards, archetypes, leaderboard) and rewrites the voice of the Wrapped and ceremony. Nothing visual changes.
4. **Spend boldness in one place.** The memorable element is the category **coaster**: a round printed beer mat with the name set on its bottom arc. Everything around it is quiet and disciplined.
5. **Hold the good stuff back.** The live app shows only what everyone already knows. Fun metrics, ranks, archetypes, awards and predictions stay behind locked tiles until the Wrapped.
6. **Celebrate the trip, not the drinking.** No health scolding, no BAC. Copy roasts the person, never the act.

---

## 2. Changes from the product spec

| # | Product spec | This design | Why |
|---|---|---|---|
| 1 | Category tap opens one bottom sheet with every field | **3-step wizard**: What → How big → Confirm, auto-advancing on tap | One decision per screen with big tiles; no form to read in a dark bar. |
| 2 | Rating in the log sheet | Rating asked on the **post-log toast**, in **Feed**, and in the **edit** sheet. Never on a new log. | Rating before the first sip is a guess, and it's the field most likely to make people abandon the log. |
| 3 | Sheet with visible fields for ABV, time, venue, note | On the Confirm step these are **one row of small chips** that show current values; tap a chip to edit inline | They're right almost every time, so they stay small. |
| 4 | ABV "editable" | **Non-linear ABV slider**: 0.1% steps up to 15%, 0.5% above, plus −/+ nudge buttons | 0.1% precision where beer/wine/cider live; nudges because 0.1% on a phone track is about 2 px. |
| 5 | Venue suggested on every log | Venue **suggested once per place**, then reused silently until GPS moves on | Zero taps for the common case. |
| 6 | Themes restyle colours, type and artwork (spec §12 colour row) | **Themes change content only.** One visual system for all themes. | Product owner decision (supersedes spec §12 "Colours" row and the per-theme colour tokens / typography assets). Per-theme *artwork* such as rank badges and achievement icons may still vary — see §10 Q1. |
| 7 | Classic light + dark; CS2 dark only | **Light/dark is a display setting**, independent of theme, available for every theme | Follows from #6. |
| 8 | Category grid with emoji | **Custom line icons** (`icons/drinks`) on round coasters | Consistent rendering across platforms, on-brand. Emoji remain only for the rating scale. |
| 9 | "Repeat last" and recents | "**Another {drink}**" primary button + recents/favourites rail + "**{drink} again**" tile inside each category | Three levels of speed (1, 1, 3 taps). |
| 10 | No accounts or sign-in; a trip just has members and an owner | **Invite-only accounts** (§6.13): one admin account is seeded on first boot; the admin sends single-use invite links; members sign in with email + password; the admin issues password reset links | Keeps a friend-group app private without needing email delivery. Links go wherever the group already chats, or as a QR code in person. |

---

## 3. Foundations

All values are in `tokens.json`. Units are points (pt) at 1×; the prototype phone is 360×760 pt with an 18 pt screen gutter.

### 3.1 Colour

One palette, two modes. Dark is default (bars at night). Light is a user display setting.

- **Dark wood** background `#23160E`, raised surfaces `#301F14` / `#3F2B1C`, **foam** ink `#FFF3DE`, **amber** accent `#F4A73B`.
- Accent fills always carry `onAccent` (`#24160C`) text/icons.
- In light mode, accent used *as text* darkens to `#8F520A` (`accentText`) to pass 4.5:1. Accent *fills* stay `#F4A73B`.
- Member avatars use a fixed 10-colour palette (`color.members.palette`), assigned in join order, stable for the trip.
- Destructive text: `danger`. There is no red fill anywhere.

### 3.2 Typography

- **Alfa Slab One** (display, 400 only): screen titles, big numbers, coaster labels, wizard questions, Wrapped headlines. Never for body copy or buttons.
- **Instrument Sans** (body, 400–700): everything else.
- Tabular numerals for totals, leaderboard values, countdowns, ABV, steppers.
- Sentence case everywhere. No all-caps labels. No letter-spaced eyebrows.
- Type scale: `tokens.json → type`. Wrapped headlines **wrap, never truncate**. Long names (e.g. the CS2 rank "Distinguished Master Guardian") may take three lines at 44 pt; step down to 36 pt only if a name would exceed three lines.

### 3.3 Layout

- Screen: safe-area top, 18 pt side gutters, tab bar pinned bottom (4 items, 48 pt min height, 20 pt bottom pad above home indicator).
- Vertical rhythm: 6 / 10 / 16 / 20 pt (`space`).
- Radii encode hierarchy: pills for chips, 14 pt for secondary buttons, 18–20 pt for tiles/blocks/primary buttons, 28 pt for sheet tops, circles for coasters, avatars and steppers.
- Minimum touch target 44×44 pt, no exceptions (including inline "Change" / "Undo" text buttons: pad them).

### 3.4 Iconography — UI

`icons/ui/*.svg`: 24 viewBox, 1.8 stroke, round caps/joins, `currentColor`. Default render size 20 pt (16 pt inside chips).

| File | Use |
|---|---|
| `glass` | Tab: Log; "Add to a trip" on the member sheet |
| `board` | Tab: Leaderboard |
| `list` | Tab: Feed |
| `gift` | Tab: Wrapped |
| `repeat` | "Another {drink}" button, "{drink} again" tile |
| `down` | Chevrons (rotate 90° for back, −90° for forward) |
| `x` | Close sheet; "Remove access" (in `danger`) |
| `star` | Favourite (filled accent when on) |
| `pin` / `clock` / `pct` / `note` | Confirm-step chips: venue / time / ABV / note |
| `lock` | Locked tiles, predictions locked |
| `hourglass` | Final-24h countdown |
| `bolt` | Achievement badge |
| `play` / `tv` / `share` | Wrapped / cast / share (also "Share link" for invites) |
| `user-plus` | "Invite someone", "People and invites" |
| `qr` | "Show QR code" on an invite |
| `key` | "Send password reset link" |
| `check` | Current trip in the trip switcher |
| `more` | Invite row options (⋯) |

### 3.5 Iconography — drink categories

`icons/drinks/*.svg`: 48 viewBox, line illustrations with a liquid fill. The exported files have colours baked in for the coaster context; in code, map these roles:

| Role | SVG in export | In code |
|---|---|---|
| Outline stroke (2.3, round) | `#3A2413` | `coasterInk` on coasters; `ink` (currentColor) elsewhere |
| Liquid fill | `#E9A640` | constant `drinkIcon.liquid` |
| Bubbles | `#F2E3C6` | the colour of the surface under the icon (coaster / surface2 / bg) |
| Ice cubes (spirit) | `#F2E3C6` @ 55% | surface colour @ 55% |
| Olive (cocktail) | `#7E8F33` | constant `drinkIcon.olive` |

Sizes: coaster 44% of coaster diameter; recents chip 20 pt; feed row 30 pt; wizard summary 46 pt; wizard sheet title 24 pt.

### 3.6 Motion and haptics

See `tokens.json → motion / haptics`. Rules:
- Motion answers a person's action (sheet opens, step advances, toast confirms). No ambient animation on live screens.
- The **wizard slide** plays only when the step changes, never when the same step re-renders (e.g. stepper tap).
- **Reduced motion:** no slides; opacity only or instant.
- Light haptic on every successful log / edit / delete / rating, and when an achievement banner appears.

### 3.7 Accessibility floor

- Text contrast ≥ 4.5:1 (≥ 3:1 at 24 pt+). Verified pairs: ink/bg, muted/bg, onAccent/accent, accentText/bg in both modes.
- All controls are real buttons with accessible names; icon-only buttons have labels ("Close", "Back", "Add to favourites", "Rate 4 of 5", "Lower ABV", "Raise ABV").
- Chips that toggle an editor expose `expanded`; favourite exposes `pressed`; the ABV slider exposes a value text like "6.3%".
- Toasts and achievement banners are polite live regions.
- Colour is never the only signal: selected tiles also get a 2 pt accent inset ring; your leaderboard row also says "you".
- Dynamic type: layouts must survive +2 steps. Tiles grow in height; wizard questions wrap.

---

## 4. Theme system (content only)

- A trip has exactly one theme, chosen by the owner, changeable until the ceremony starts (Owner settings, §6.12).
- The theme is a **content pack** (`themes/<id>.json`) with identical keys across packs. The UI never branches on theme for layout **with one exception**: the leaderboard's *columns* are defined by the pack (`leaderboard.columns`) — Classic shows a value + drinks line; CS2 shows a K / A / D / Rating table (§6.6). Build the leaderboard to render N columns from the pack.
- **Everything with a name comes from the pack:** nav label for the leaderboard tab, leaderboard title/subtitle, achievements (11), awards (14 incl. Night MVP), archetypes (10), ranks (10 Classic / 18 CS2, by std drinks per day), side leaderboard names, predictions naming (Predictions / Pick'em), and all Personal/Squad Wrapped copy (every card).
- **Placeholders** are `{name}` tokens. The renderer fills them; unknown placeholders are a bug (fail loudly in dev).
- Voice notes per pack are in `voice`. New themes (V2: Fantasy RPG, Wildlife Documentary, AI-generated) must supply every key; add a CI check for key parity (the current packs pass).
- Achievement and rank *logic* never changes with theme — only the label.
- **Screens to check per theme:** `screenshots/classic` vs `screenshots/cs2` show the same screens with the two packs.

---

## 5. App structure

```
Signed out                Sign in · Invite landing → Create account · Set a new password · Link problem   (§6.13)
First sign-in (admin)     Finish setting up
Signed in, no trips       No trip yet
Trip (switcher in top-left: "{trip name} ⌄" → your trips · People and invites (admin) · Account)
├── Log (home)            ← default tab
├── Leaderboard           ← "The Tab" / "Scoreboard"
├── Feed
└── Wrapped               ← locked teaser → Personal Wrapped → Squad Wrapped / ceremony
Overlays: Log wizard (bottom sheet), Edit drink (same sheet), Toast, Achievement banner, Predictions (full screen),
          Invite sheet (bottom sheet)
Off the switcher: People (admin only, full screen), Account (full screen)
```

Top bar on every tab: trip switcher (left, 44 pt tall), member avatar stack (right, overlapping 30 pt circles with a 2 pt bg-coloured ring). In the final 24 h, a countdown block sits directly under the top bar on every tab.

---

## 6. Screens

Screenshot file names below are relative to `screenshots/<theme>/`.

### 6.1 Log home — `01-log-home.png`, `01b-log-home-toast-and-achievement.png`, `25-light-mode-log-home.png`

Top to bottom:
1. **Top bar** (§5).
2. **Countdown** (final 24 h only): hourglass icon, `HH:MM:SS` in display type, caption `home.countdown`.
3. **Totals**, 2 columns (1.2fr / 1fr):
   - You: caption "You, this trip", value = trip std drinks (display 46, 1 decimal), sub "std drinks from {drinks} drinks".
   - Squad: caption "Squad", value (display 30, 85% opacity), sub "std from {drinks}".
4. **"Another {drink}"** primary button (58 pt, accent fill, repeat icon, size label right-aligned at 75% opacity). One tap logs an exact copy of your last drink (same drink, size, ABV, qty 1, time = now, current venue; rating and note cleared). Hidden when you have no drinks.
5. **Recents rail**: horizontally scrolling chips (44 pt). Each = drink icon + name + size (muted). Favourites first, marked with a filled star. De-duplicated by (category, drink, size). The item already shown in "Another" is omitted unless it's a favourite. **One tap logs it.**
6. **Coaster grid**, pushed to the bottom above the tab bar: 3×3 square coasters in fixed order Beer, Wine, Cocktail / Spirit, Shot, Cider / Seltzer, Soft, Other.
   - Coaster: circle filled `coaster`, dashed inner ring (r = 45/100, 1.6 stroke, 3–3 dash, `coasterRing`), category icon centred in the upper half (44% of diameter), label in display type set on the bottom arc (text-on-path, centred).
   - Pressed: scale 0.93 (120 ms). Tap opens the wizard for that category.
7. **Tab bar**.

**Empty trip** (`07-empty-trip-predictions-open.png`): totals show 0.0 with "No drinks yet" / "Nobody's started"; items 4–5 are replaced by the predictions card (while the prediction window is open) and the hint `home.firstDrinkHint`.

### 6.2 Log wizard — `02-…`, `03-…`, `04-…`, `05-…`, `06-edit-drink.png`

A bottom sheet (surface, 28 pt top radius, max 93% height, scrim behind). Header: back button (steps 2–3), centred title = category icon + category name (or "Edit drink"), close button. Under the header: a 3-segment progress bar (26×4 pt segments, filled up to the current step; hidden in edit mode).

**State machine**

```
                 tap coaster
                      │
                      ▼
 ┌──────────── Step 1: WHAT ─────────────┐
 │  "{drink} again" tile ────────────────┼──► Step 3 (with last size)
 │  drink tile ──────────────────────────┼──► Step 2
 │  Other… → text field + Next ──────────┼──► Step 2
 └───────────────────────────────────────┘
                      │
                      ▼
 ┌──────────── Step 2: HOW BIG ──────────┐
 │  size tile ───────────────────────────┼──► Step 3
 │  Custom → numeric field + Next ───────┼──► Step 3
 └───────────────────────────────────────┘
                      │
                      ▼
 ┌──────────── Step 3: CONFIRM ──────────┐
 │  summary card (tap → Step 1)          │
 │  quantity stepper + std estimate      │
 │  chips: venue · time · ABV · note     │──► inline editor (one at a time)
 │  ☆ favourite   [ Log {qty}{drink} ]   │──► save, close, toast
 └───────────────────────────────────────┘
 Back: 3→2→1. Close / scrim tap / swipe down: discard (no confirmation; nothing was saved).
 Edit mode: opens at Step 3; picking a drink in Step 1 returns straight to Step 3.
```

**Step 1 — What are you having?** (wizard question, display 28)
- If you've logged this category before, a full-width accent tile "**{drink} again**" + last size, with the repeat icon. → Step 3.
- 2-column grid of drink tiles (72 pt min): name (body 17/600) + ABV (caption). Order: your custom names first, then the catalogue list (`data/catalog.json`). Your last drink in this category carries the selected ring.
- Dashed "Other…" tile → reveals a text field and "Next". A new custom name is saved on Log and shown first next time.

**Step 2 — How big?**
- 2-column grid of size tiles from the catalogue. Title = named size ("Pint", "Bottle") or "{ml} ml"; subtitle = "{ml} ml, " for named sizes + **std drinks for one of this drink at this size** (e.g. "568 ml, 2.3 std").
- Current/last size carries the selected ring. Dashed "Custom" → numeric ml field + Next.

**Step 3 — Confirm**
- **Summary card** (surface2, full width, tappable → Step 1): drink icon 46 pt, drink name (display 24, max 2 lines, never truncated to 1), size line, chevron.
- **Quantity row** (surface2): − / value / + (46 pt circular buttons, 0.5 steps, minimum 0.5) and, right-aligned, the live std estimate (display 26, accentText) with caption "standard drinks".
- **Chips row** (wraps): venue, time, ABV, note. Chips show current values:
  - Venue: name; **dashed border** while it is only a GPS suggestion; muted "No venue" when skipped.
  - Time: "Now" or the chosen `HH:MM` (backdating).
  - ABV: "5.2%".
  - Note: note text (ellipsised at 170 pt) or muted "Note".
  - Tapping a chip toggles its inline editor below the row (only one open at a time; the chip shows as selected):
    - Venue: text field + "Skip" (or "Nearest" when skipped) + "Done".
    - Time: time picker + "Done".
    - ABV: **ABV slider** (§6.2.1).
    - Note: text field (80 chars) + "Done".
- **Rating** (edit mode only): 5 faces from the rating scale, 44 pt circles, selected ring.
- **Footer**: favourite toggle (60 pt square, star) + **Log** button (60 pt, accent, "Log {qty}{drink}", e.g. "Log 2 × Super Bock"). Edit mode: "Save changes" + a "Delete drink" text button (danger) below.

#### 6.2.1 ABV slider — `05-wizard-3-abv-slider.png`

- Block on surface2: − button, large value (display 30, e.g. "6.3%"), + button; slider under it; tick labels 0, 5, 10, **15** (accent, bold), 30, 50, 80 positioned by the mapping; footer "0.1% steps up to 15%, then 0.5%" + "Done".
- Slider is **integer positions 0–280**, mapped non-linearly (maths in `data/catalog.json → abvSlider`). The first 150 positions cover 0–15% at 0.1% resolution (54% of the track); the last 130 cover 15–80% at 0.5%.
- Value, chip label and std estimate update live while dragging. Dragging must not re-render the sheet (keep the gesture alive).
- −/+ move exactly one step; from exactly 15%, − goes to 14.9% and + to 15.5%.
- Drink presets snap to the scale on selection.

#### 6.2.2 Tap counts (acceptance criteria)

| Case | Taps |
|---|---|
| Exact repeat of last drink ("Another …") | 1 |
| Anything in recents/favourites | 1 |
| Usual drink in a category (coaster → "{drink} again" → Log) | 3 |
| New drink (coaster → drink → size → Log) | 4 |
| Rate the drink just logged (toast) | +1, optional |
| Undo (toast) | 1 |

### 6.3 Toast, undo and rating

- Inverted colours (toast/toastInk), 20 pt radius, pinned above the tab bar, 12 pt side insets. Slides up 16 pt + fades in; auto-dismisses after 6.5 s; replaced by the next toast.
- After a log: "Logged {qty}{drink}" + **Undo**, then "How is it? Rate it now or later in Feed." + 5 rating faces. Tapping a face rates the logged drink and replaces the toast with "Rated {drink} {face}". **Soft drinks don't get the rating ask.**
- After edit: "Saved changes" + Undo. After delete: "Deleted {drink}" + Undo. After undo: "Undone".
- Undo restores the exact previous state (removes a new drink, restores the pre-edit version, re-inserts a deleted one at its position).

### 6.4 Achievement banner — `01b-…`

- Slides down from the top 700 ms after the triggering log. Surface2 fill, 1.5 pt accent border, 20 pt radius. Accent circular badge with the bolt icon, achievement name (display 20, from the theme), description + `toasts.achievementPosted`. Auto-dismisses after 4.2 s. Haptic.
- The same achievement posts to the group feed immediately (§6.5).
- If several unlock at once, queue them (one banner at a time).

### 6.5 Feed — `10-feed-everyone.png`, edit `06-edit-drink.png`

- Title "Feed", segmented control Mine / Everyone, list grouped by day ("Tonight", "{weekday}, day {n}").
- Drink row (56 pt min): drink icon 30 pt; line 1 "{member}: {qty}{drink}, {size}" (member prefix omitted for your own); line 2 "{venue}, {HH:MM}" (ellipsised); right: rating face (if any) over "{std} std".
- Achievement row: surface2 pill row with accent bolt badge, "{member} unlocked {achievement}", description + time.
- Tapping **your own** drink opens the wizard in edit mode at Step 3. Others' rows are not tappable.

### 6.6 Leaderboard — `08-leaderboard.png`, `09-leaderboard-lower-locked-tiles.png`

Title and subtitle from the theme. Your row: surface2 background, accent rank, "you" suffix.

- **Classic (value list):** rank (display 20, muted) · avatar · name + thin accent bar (width ∝ value/leader) · value (display 20, tabular) with "{n} drinks" caption under it.
- **CS2 (table):** header row (Player · K · A · D · Rating, caption style) then one row per member with a 3 pt left border (line colour; accent for you), avatar + name, right-aligned tabular numbers, rating in accentText. Column definitions come from `leaderboard.columns`.
- Under the board: "Just unlocked" / "Highlights" — the two most recent group achievements.
- Lower on the tab: **Squad by day** (bar chart, 9 days, future days as short neutral stubs), **What we drink** (stacked bar + legend, category colours from `tokens.color.chartCategory`), then **Saved for the Wrapped** locked tiles (2-column grid, 1.5 pt dashed `ring` border, 16 pt radius, title + lock icon + "Unlocks in the Wrapped").
- Also on this tab (not drawn; use the same patterns): your ratings history (list of rated drinks with faces).

### 6.7 Final 24 hours — `11-final-24h-masked.png`

- Countdown block on every tab.
- Leaderboard keeps names but **sorted alphabetically**; ranks show "?"; values replaced by a neutral pill (Classic) or "?" cells (CS2). Your row is still highlighted. Note under the title: `leaderboard.maskedNote`; under the list: `leaderboard.maskedSort`.
- Logging keeps working normally.

### 6.8 Predictions — `12-…`, `13-…`, `14-…`

- **Form** (full screen): 5 questions, all by tap. Q1/Q2: number steppers pre-filled with sensible defaults (Q1 = 5 × trip days; Q2 = Q1 × members), step 1 (long-press to accelerate). Q3/Q4: row of 40 pt member avatars, single select with an accent ring. Q5: horizontal chips of drinks (catalogue popular + anything already logged). Primary "Lock predictions" pinned at the bottom; disabled until Q3–Q5 are answered.
- **Locked:** centred lock badge (72 pt), title, body, "{n} of {total} have predicted" + avatars, CTA "Log my first drink".
- **Missed:** a block on the Log home (where "Another" would be) explaining the window closed and what still counts. Dismissible after first view.
- Window closes at the member's first drink or 24 h after trip creation, whichever comes first. If a member taps a coaster while the window is open and they haven't predicted, log normally (don't block) — the missed state follows.

### 6.9 Personal Wrapped — `15-…` to `20-…`

- Full-screen story. 14 progress segments at the top (3 pt, done = ink 95%, todo = ink 22%). Tap right half = next, left half = back, hold = pause, swipe down = close.
- **Unlocked state** (`15`): system notification + in-app state: pre-line (muted), headline (display 44), body, CTA "Watch my Wrapped" pinned bottom.
- Card layout rules: one idea per card; **one** hero element (a number in `wrappedHuge` 128, or a line in `wrappedLine` 30); supporting lines in body 17; generous empty space; content aligned left; the hero number counts up from 0 over ~1.2 s on entry (the only ambient motion in the app).
- Backgrounds: bg by default; **amber full-bleed** (accent fill, onAccent text) for punchline cards (card 2 and one other per story at most).
- All 14 cards' copy is in `themes/<id>.json → wrappedPersonal.cards`. Drawn in the prototype: 1 (cold open), 2 (absurd units), 3 (guess ethanol — interactive slider for the guess, actual drops in after), 5 (peak day — only the peak bar in accent), 14 (archetype — accent headline, write-up, pace-twin card, Share + Watch again).
- Not drawn — build from the same rules: 4 (ABV & share: two stat lines), 6 (trail: map full-bleed with route in accent and venue pins, stat line under), 7 (top-rated → guilty pleasure: two beats with a swipe), 8 (loyal vs adventurous: two opposing bars), 9 (liver miles → economy: two beats), 10 (pace twin: two avatars and one line), 11 (achievements: grid of unlocked badges, 3 columns), 12 (prediction vs reality: two numbers stacked), 13 (rank: drumroll beat, then badge art + rank name).
- **Leaderboard position is never shown in Personal Wrapped.**
- End state: Share (renders the current card as a 1080×1920 image), Watch again, "Waiting for the ceremony…" teaser.

### 6.10 Squad Wrapped and the ceremony — `21-…`, `22-…`, `23-…`, `24-…`

- **Locked, non-owner** (`21`): title, sub, a blurred fanned stack of three cards as teaser, "Waiting for {owner}" block, "Rewatch my Wrapped".
- **Locked, owner** (`22`): "{n} of {total} have watched their own", primary "Start the ceremony" (theme label), secondary "Show on a TV first" (tv icon), settings rows for Theme and Wrapped unlock time.
- **Presenter remote** (`23`): shown on the owner's phone while casting. Device line, "Card {n} of 11", current card title, "Next: …" line, a presenter tip block (theme copy), a very large **Next / Reveal** button (≥180 pt tall), Back + Hold. Hold freezes auto-advance and any timers for dramatic pauses.
- **Cast mode** (`24`): 16:9, full-bleed dark, everything sized in viewport units (≥ 2 vw body, ≥ 7 vw titles) to read from across a room. Presenter-controlled advance only; no auto-advance. Card 10 (drawn): left column title + one-line subtitle, right column rows rising in from the bottom one per tap (last place first), the #1 slot is an accent bar with the MVP award name and "?" until revealed.
- All 11 cards' copy: `themes/<id>.json → wrappedSquad.cards`. Card 9 (awards) is one award per card; place the least-logged award (The Ghost / AFK) in the middle of the sequence for comic relief. Every member wins at least one award.

### 6.11 Day-by-day replay (Squad card 6)

Not drawn. Build as: full-bleed map (muted basemap tinted towards bg), each member a dot in their avatar colour leaving a 2 pt trail, each drink a pulse sized by std drinks, running leaderboard ticker on the right (top 6, re-orders with motion), day label top-left, **Night MVP** banner at each day's end (theme name `awards.night_mvp`), achievement pops at their real timestamps. 60–90 s for a two-week trip. Controls: play/pause, scrubber. "Save as video" export (1080×1920 and 1920×1080).

### 6.12 Owner settings

Rows: Theme (current name + hint "Renames achievements, ranks and awards" → picker listing packs with a one-line voice sample each), Wrapped unlock time (date-time picker), Start the ceremony. Theme and time are editable until the ceremony starts; changing the theme re-labels everything already earned (labels are looked up, never stored).

### 6.13 Sign-in, invites and accounts

Screens: `screenshots/classic/26-…` to `43-…`, and the "Getting in" and "People and invites" sections of the prototype. They are theme-independent, so they're only in `classic/`. The ASCII wireframes below are kept as a quick reference; where they differ from the renders, the renders win.

Drunkify is **invite-only**, with no public sign-up. One **admin** account exists from first boot. The admin invites everyone else with single-use links, shared wherever the group already chats or shown as a QR code in person. All copy is in `content/auth.json`. It is theme-independent, because most of these screens appear before there's a trip, and so before there's a theme.

**Two different roles:**
- The *admin* is app-wide: invites people, resets passwords, removes access. V1 has exactly one admin.
- The *trip owner* (§6.10, §6.12) is per trip: sets the theme and unlock time, starts the ceremony.

On trips they don't own, the admin is a normal member.

#### 6.13.1 Flows

```
ADMIN, FIRST RUN
 server first boot, no users ─► seed admin (configured email + one-time password, must change)
 Sign in ─► Finish setting up ─► No trip yet (admin) ─► Invite someone ─► Invite sheet ─► Share link / QR

INVITEE
 opens link ─► Invite landing ─┬─ Accept invite ─► Create account ─┬─► that trip's Log home (07)   [invite has a trip]
                               │                                   └─► No trip yet                [app-only invite]
                               ├─ "Already have an account?" ─► Sign in ─► same as above (invite used by that account)
                               └─ token bad ─► Link problem (expired · used · cancelled · invalid)

RETURNING
 open app ─┬─ valid session ──► last-opened trip's Log home (or No trip yet)
           └─ none / expired ─► Sign in ─► where they were going (deep link, notification target, else last trip)

FORGOTTEN PASSWORD
 member:  Sign in ▸ "Forgot password?" ▸ sheet: ask your admin
 admin:   People ▸ member ▸ Send password reset link ▸ share
 member:  opens link ▸ Set a new password ▸ signed in here, signed out everywhere else
```

#### 6.13.2 Shared layout and components

**Signed-out screen layout** (Sign in, Finish setting up, Invite landing, Create account, Set a new password, Link problem):
- No top bar and no tab bar. Full screen on `bg`, 18 pt gutters, safe areas respected.
- **Hero coaster** (`size.authCoaster`, 168 pt) centred in the upper third. Screens with three fields (Finish setting up, Create account) use the **compact** 72 pt coaster at top left instead, sharing a row with Sign out or Back, so the form fits without scrolling. It's the Beer coaster from §6.1, built the same way, with "Drunkify" set on the bottom arc. This is the only place the wordmark appears. It's the one bold element on the screen (principle 4) and it doesn't animate.
- Below it: title (screenTitle 30, wraps), body (body 15, muted), form, primary button. The form and button sit in the bottom two-thirds.
- **Keyboard up:** the coaster shrinks to 72 pt (scale + opacity, 220 ms; instant with reduced motion). The primary button rides on top of the keyboard and is never scrolled out of view. Return key: "Next" between fields; the last field submits.
- Light/dark follows the phone until the user picks a display setting (§6.13.13).

**Text field** (new component, the same family as the wizard's inline inputs):
- Label above (caption 13, muted). Field 52 pt tall (`size.inputHeight`), 12 pt radius (`radius.input`).
- Fill: `surface` on bg, `bg` on surface.
- Border: 1.5 pt `line` at rest, 2 pt `accent` on focus, 1.5 pt `danger` on error (`stroke.input`).
- Hint text under the field (caption, muted). An error replaces the hint (caption, `danger`) and is linked as the field's accessible description.
- Password fields have a trailing "Show" / "Hide" text button: 44×44 hit area, exposes `pressed`, accessible name "Show password". Hidden by default.
- Set platform autofill hints (`name`, `email`/`username`, `current-password`, `new-password`) so password managers work. Never block paste. No CAPTCHA.

**Primary button:** same as the Log button (60 pt, accent, 20 pt radius, button type 18).
- Busy: the label switches to the busy copy with a small spinner; the button and fields are disabled; repeat taps do nothing.
- Primary buttons stay **enabled**. Tapping with missing or invalid input moves focus to the first bad field and shows its error. The one exception is the rate-limit countdown (§6.13.3).

**Form-level errors** (bad credentials, rate limit, offline) appear in a block directly above the primary button: `danger` text on surface2, 14 pt radius, polite live region. All errors clear as soon as the user edits the field they relate to.

#### 6.13.3 Sign in — `26-sign-in.png`, `27-sign-in-error.png`, `28-forgot-password.png`

```
┌──────────────────────────────┐
│                              │
│         ◯  coaster           │  168 pt, "Drunkify" on the arc
│                              │
│  Welcome back                │  screenTitle
│  Sign in to get back to the  │  body, muted
│  trip.                       │
│                              │
│  Email                       │
│  [ you@example.com         ] │  52 pt
│  Password                    │
│  [ ••••••••••         Show ] │
│                              │
│  [         Sign in         ] │  60 pt primary
│       Forgot password?       │  text button, 44 pt
│                              │
│  Drunkify is invite-only.    │  caption, muted, centred
│  Ask your admin for a link.  │
└──────────────────────────────┘
```

- Email is trimmed and matched case-insensitively.
- **Wrong email or password:** one generic error ("That email and password don't match."). Never reveal whether the email exists. Keep both values so a typo can be fixed.
- **Rate limit:** after 5 failures in 15 minutes (per email and per device/IP) show "Too many tries. Try again in {m:ss}." The countdown runs live and the primary button is disabled until it reaches zero.
- **Offline:** `errors.offline`, with the form kept as is.
- **Forgot password?** opens a small bottom sheet (§6.2 sheet chrome, no progress bar): title, body ("Ask your admin to send you a reset link…"), "Got it". There is no email reset in V1 (§10 Q7).
- **Signed out by the server** (session expired or revoked): show `signIn.signedOutBanner` above the title, once.
- **Success:** go to Finish setting up if the account must change its password. Otherwise go to the pending deep-link target, else the last-opened trip's Log home, else No trip yet.

#### 6.13.4 Finish setting up (admin's first sign-in) — `29-admin-setup.png`

This screen appears after the admin signs in with the seeded one-time password, and never otherwise. The app can't be used until it's done. The only other action is a "Sign out" text button at top right.
- Title "You're the admin", plus a body explaining the role.
- Fields:
  - Your name (hint: shown on the leaderboard; 1–24 characters).
  - Email (pre-filled with the seeded email, editable).
  - New password (hint "At least 8 characters"). It must differ from the one-time password (`setup.samePassword`).
- "Save and continue" goes to No trip yet (admin variant). If trips already exist, it goes to the last one instead.

#### 6.13.5 Invite landing — `30-invite-landing.png`

Opened from `https://{host}/i/{token}`. This is a universal/app link: it opens in the app if the app is installed, otherwise in the web build of the same screen.

```
┌──────────────────────────────┐
│         ◯  coaster           │
│                              │
│  Hi Sam,                     │  body, muted (only if the invite has a name)
│  Alex invited you to         │  screenTitle, wraps
│  Drunkify                    │
│  ┌────────────────────────┐  │
│  │ Lisbon 2026        ●●●● │  │  trip card, only if the invite has a trip:
│  │ 5–14 Sep · 5 people     │  │  surface2, 18 pt radius, avatar stack (30 pt)
│  └────────────────────────┘  │
│  Log drinks with the group   │  body
│  on the trip, then watch it  │
│  all come back in the Wrapped│
│                              │
│  [      Accept invite      ] │  60 pt primary
│  Already have an account?    │  text button
│  Sign in                     │
│  Works once. Expires 3 Oct.  │  caption, muted
└──────────────────────────────┘
```

- The token is checked before anything renders: a skeleton shows for up to 1 s, then either this screen or Link problem (§6.13.7).
- **Accept invite** goes to Create account.
- **"Already have an account? Sign in"** goes to Sign in, carrying the token. After sign-in the invite is accepted by that account: the user joins the trip, if there is one, and lands there.
- **Someone is already signed in on this device:**
  - *Invite has a trip:* show "You're signed in as {name}.", a primary "Join {trip} as {name}", and "Not you? Sign out". Joining uses up the invite.
  - *Invite has no trip:* show `invite.alreadyMember` and "Open Drunkify". The invite is **not** used up, so it can still be forwarded to the right person.

#### 6.13.6 Create account — `31-create-account.png`, `32-joined-trip-toast.png`

Back button (top left, 44 pt) returns to the landing. Title "Create your account". One screen, three fields.

- **Your name:** pre-filled from the invite's name if there is one. Hint: shown on the leaderboard; 1–24 characters. If the invite has a trip and a member there already has this name, show a non-blocking hint: "There's already a {name} on this trip. Add an initial?"
- **Email.**
- **Password:** new-password autofill, Show toggle, hint "At least 8 characters".
- **Primary button:** "Join {trip}" if the invite has a trip, else "Create account". Caption under it: "You'll stay signed in on this phone."
- **Email already registered:** error on the email field with an inline "Sign in instead" button. It goes to Sign in with the email and the token carried over.
- **Success:**
  - The account is created, signed in, and the invite is marked accepted.
  - The inviter gets a push notification: "{name} accepted your invite."
  - The user lands on the trip's Log home in the empty / predictions-open state (`07`) with the toast "You're in. Welcome to {trip}." With no trip, they land on No trip yet.

#### 6.13.7 Link problem — `33-link-problem-expired.png`

One screen with variants for invite links (`expired`, `used`, `revoked`, `invalid`) and reset links (`resetExpired`, `invalid`). Layout:
- The hero coaster at 50% opacity.
- Title and body from `linkProblem`. Expired and cancelled invites name the inviter.
- A "Sign in" button: primary for `used` (it's probably their own account), secondary for the others. If someone is signed in, the button is "Open Drunkify" instead.

#### 6.13.8 No trip yet — `35-no-trip-admin.png`, `36-no-trip-member.png`

Shown when the user is signed in but on no trips. There's no tab bar.
- **Top bar:** "Drunkify ⌄" in place of the trip name. It opens the same switcher sheet (§6.13.9), so Account and People stay reachable.
- **Member:** hero coaster, "You're in", body. The screen updates live: when the admin adds the member to a trip, a push notification arrives and the screen switches to that trip.
- **Admin:** "No trips yet" and a body. Primary "Invite someone" (user-plus icon) opens the Invite sheet. Secondary "Create a trip" (trip creation isn't specified yet; §10 Q13).

#### 6.13.9 Trip switcher sheet — `37-trip-switcher.png`

The top-left "{trip name} ⌄" already exists (§5) but hasn't been drawn. It opens a bottom sheet containing:
- Your trips: 56 pt rows with trip name and dates; the current trip is checked. Tapping one switches to it.
- A hairline.
- "People and invites" (user-plus icon; **admin only**) with a forward chevron.
- "Account", led by your own avatar, with a forward chevron.

#### 6.13.10 People (admin only) — `38-people.png`, `39-member-sheet.png`

Full screen with a back button. Title "People".

```
┌──────────────────────────────┐
│ ‹  People                    │
│ [ ⊕  Invite someone        ] │  58 pt primary, user-plus icon
│                              │
│ Invites (2)                  │  sectionTitle
│ ◌S  Sam                   ⋯  │  dashed ring avatar
│     Lisbon 2026 · 5 days left│
│ ◌?  Unnamed invite        ⋯  │
│     Expired 28 Sep           │
│                              │
│ Members (4)                  │
│ ●A  Alex   Admin · you       │
│     alex@example.com         │
│ ●P  Priya                 ›  │
│     priya@example.com        │
└──────────────────────────────┘
```

- **Invite rows** (56 pt):
  - Avatar: a 1.5 pt dashed `ring` circle with the invite name's initial, or "?".
  - Line 1: the name, or "Unnamed invite".
  - Line 2 (muted): "{trip} · {n} days left", or "Expired {date}".
  - Trailing "⋯" button (accessible name "Invite options for {name}") opens an action sheet: Share a new link · Show QR code · Cancel invite (danger).
  - Expired invites sort last and disappear 30 days after expiry.
  - Links are stored hashed, so an old link can't be shown again. "Share a new link" issues a fresh token, kills the old one, and opens the Result state of the Invite sheet.
  - When an invite is accepted, its row moves to Members live.
- **Member rows** (56 pt):
  - Avatar in the member's colour for the current trip, or neutral surface2 if they aren't on it.
  - Name, then email (muted).
  - "Admin" tag (pill, surface2) and "you" where they apply.
  - Tapping a row (except your own) opens the member sheet. Emails are shown only here and on the user's own Account screen, never to other members.
- **Member sheet:** name (display 24), email, "Joined {date}", "Invited by {inviter}", trips. Action rows (44 pt):
  - **Add to a trip** (glass icon): picker of the admin's trips they're not on. They join as a member; avatar colour is assigned in join order (§3.1).
  - **Send password reset link** (key icon): opens the same Result layout as the Invite sheet, with the reset copy (`inviteSheet.reset*`).
  - **Remove access** (x icon, `danger`): opens a confirmation dialog (`people.removeConfirm`). In this section, only Remove access and Sign out ask for confirmation. Everything else is harmless or can be undone.

#### 6.13.11 Invite sheet — `40-invite-create.png`, `41-invite-link.png`, `42-invite-qr.png`

A bottom sheet with §6.2 chrome (surface, 28 pt top radius, close button, no progress bar). It has two states.

**Create**
- Question (wizardQuestion 28): "Who's it for?"
- Name field, optional, placeholder "Their name (optional)". It's used to greet them on the landing and to label the pending invite. They can change it when they create their account.
- "Add them to": a row of 44 pt pill chips, one per trip the admin is on, plus "No trip". Single select; the selected chip gets an accent fill. Defaults to the current trip, or "No trip" if the admin is on none.
- Primary "Create invite link".

**Result**
- Title "Invite for {name}" (or "Invite link").
- Link card (surface2, 18 pt radius): the URL without the scheme (`drunkify.app/i/…`) in body 15, one line, middle-ellipsised, selectable. Copy and share always use the full URL.
- Primary "Share link" (share icon) opens the system share sheet, pre-filled with `shareMessage` / `shareMessageTrip`.
- Secondary row, two 48 pt buttons (surface2, 14 pt radius): "Copy link" (shows toast "Link copied") · "QR code" (qr icon; accessible name "Show QR code").
- **QR state** replaces the link card:
  - The QR code at `size.qrCode` (232 pt), on a `coaster`-coloured card with 20 pt radius (`radius.qrCard`).
  - Modules in `coasterInk`, with a quiet zone of at least 4 modules.
  - Caption "Scan with a phone camera." and a full-width secondary "Back to link" button.
  - Keep the screen awake and bright while it shows, where the platform allows.
- Caption: "Works once, for one person. Expires {date}."
- Text button "Invite someone else" returns to Create with the name cleared and the trip kept.
- Closing the sheet never loses an invite; it stays in People.

**Tap counts (acceptance criteria)**

| Case | Taps |
|---|---|
| Admin invites a friend to the current trip (from People) | 3 (Invite someone → Create invite link → Share link), then pick an app |
| Next invite right after | 3 (Invite someone else → Create invite link → Share link) |
| Invitee, from opening the link to Log home | 2 taps + typing name, email, password |
| Returning user with a valid session | 0 |

#### 6.13.12 Set a new password — `34-reset-password.png`

Opened from a reset link, `https://{host}/r/{token}`.
- Hero coaster, title "Set a new password", body "For {email}.", a New password field, and "Save and sign in".
- **Success:** the user is signed in on this device and every other session for the account ends. Toast: `reset.done`.
- **Bad token:** Link problem (`resetExpired` or `invalid`).
- **A different account is signed in on this device:** it's signed out when the new password is saved.

#### 6.13.13 Account — `43-account.png`

Full screen, opened from the switcher, with a back button and the title "Account". The first three rows sit in one bordered block (like the ceremony settings, §6.10); Display and Sign out sit below it. Rows:
- **Your name:** edited inline.
- **Email:** changing it needs the current password.
- **Change password:** current + new. Other sessions end.
- **Display:** Match phone / Dark / Light, as a three-way segmented control (the Feed's Mine / Everyone control, §6.5, with three segments). This is where the light/dark display setting (§2 #7) lives.
- **"Sign out":** a text button in ink (not danger), pinned to the bottom. It asks for confirmation, because getting back in needs the password.

In V1 the admin can't delete their account or hand over the admin role.

#### 6.13.14 Accessibility, motion and haptics

These add to §3.7 and §3.6.
- Screen titles are headings. On a screen change, focus moves to the title. When a submit fails, focus moves to the first invalid field.
- The rate-limit countdown is announced when it starts and when it reaches zero, not every second.
- The QR code has alt text ("QR code for Sam's invite link"), and the plain link is always one tap away.
- Screen pushes use `motion.wizardStep` and sheets use `motion.sheetOpen`. There's no ambient motion.
- A light haptic plays on successful sign-in, account creation and invite creation.

---

## 7. Behaviour the UI depends on

- **Standard drinks:** `ml × abv/100 × 0.789 / 10 × qty`, shown to 1 decimal.
- **Recents:** your drinks newest-first, de-duplicated by (category, drink, size); favourites pinned first; cap at 12.
- **Favourites:** keyed by (category, drink, size); toggled from the Confirm step.
- **Wizard pre-fill:** the last drink you logged in that category (drink, ABV, size); otherwise the category's first catalogue drink and `defaultSize`.
- **Venue:** on the first log at a new place, pre-fill the nearest venue as a *suggestion* (dashed chip). Logging accepts it. Later logs within ~150 m reuse it silently (solid chip). Rename edits the name for this and subsequent logs at this place. Skip stores no venue name (GPS still stored).
- **Time:** defaults to now; backdating via the time chip. Feed sorts by the drink's time, not the log time.
- **GPS:** captured silently on every log (location permission assumed per product spec).
- **Undo:** single-level, scoped to the last action, available while its toast is visible.
- **Achievements:** evaluated after every log/edit/delete; banner for the earner, feed row for everyone. Deleting a drink does not revoke an already announced achievement.
- **Masking (final 24 h):** server returns names only for the main board (no order, no values) so clients can't leak positions.

**Accounts and sessions (§6.13)**
- **Seeding the admin:**
  - On server start, if there are no users, create one admin account with `mustChangePassword = true`.
  - Email comes from `ADMIN_EMAIL` (required in production).
  - Password comes from `ADMIN_PASSWORD` if it's set. Otherwise generate a random 20-character one-time password and print it once to the server log.
  - Seeding never runs again once any user exists and never overwrites an account. It must be safe if two instances boot at the same time.
- **Admin recovery:** a server command (`drunkify admin reset-link`) prints a single-use reset link for the admin. There's no UI for this.
- **Identity:**
  - Email (trimmed, lower-cased) is the sign-in identifier and is unique. V1 never verifies it and never sends email to it.
  - Display names are 1–24 characters and don't need to be unique.
  - Only the admin and the user themselves can see an email address.
- **Passwords:** 8–128 characters, any characters, no composition rules. Reject passwords on a common-password list. Hash with Argon2id.
- **Sessions:**
  - Users stay signed in. Store an opaque session token in secure storage (Keychain / Keystore; an HttpOnly Secure cookie on web).
  - Expiry is 90 days, renewed on every use. There's no idle timeout: the app is built for 1 a.m., not for a bank.
  - Sign out ends this session. A password change or reset ends every other session. Remove access ends all sessions.
- **Session lost mid-trip:** drinks logged after the session expired are kept on the device and sent after the next sign-in, but only if the same account signs in.
- **Invite tokens:**
  - At least 128 random bits, URL-safe, stored hashed, single-use.
  - Each invite expires after 7 days and records who created it, plus an optional name and trip.
  - States: pending → accepted | expired | revoked.
  - Acceptance is atomic, so two people can't both use one link.
- **Reset tokens:** same format as invite tokens, but they last 24 h, and creating a new one kills any earlier ones for that user.
- **Joining a trip from an invite:** the user becomes a member when the invite is accepted. Their avatar colour is the next one in join order. The predictions window rule is unchanged (§10 Q9).
- **Remove access:**
  - Ends the user's sessions, refuses future sign-ins and kills pending reset links.
  - Their drinks, achievements and name stay on their trips (§10 Q12).
  - The admin can't be removed.
- **Rate limits:** sign-in allows 5 failures per 15 minutes, per email and per IP; the server returns `retryAfter`. Token lookups are rate-limited per IP.
- **Authorisation:** every People, invite and reset endpoint checks the admin role on the server. Hiding the UI is not the control.

---

## 8. Product-spec §13 state checklist

| State | Where |
|---|---|
| Empty trip | `07` |
| Prediction prompt: open / submitted / missed | `07`, `12`, `13`, `14` |
| Locked teaser tiles | `09` |
| Final-24 h countdown + masked board | `11` (countdown also on Log home) |
| Personal Wrapped unlocked | `15` |
| Ceremony locked: teaser / waiting / owner | `21`, `22` |
| Owner controls: theme, unlock time, start | `22`, §6.12 |
| Achievement unlocked: own banner + feed entry | `01b`, `08`, `10` |
| Venue suggestion: suggested / renamed / skipped | `04` (editor open on a suggestion), §6.2 chip states |
| Light and dark | `25` vs all others |
| *Added with accounts (not in product spec §13; screenshots in `classic/` only):* | |
| Sign in: rest / field errors / bad credentials / rate-limited / offline / signed-out banner | `26`, `27`, `28` (forgot sheet), §6.13.3 |
| Admin first sign-in: finish setting up | `29` |
| Invite landing: with trip / without trip / already signed in | `30` (with trip), §6.13.5 |
| Create account: rest / duplicate name hint / email taken; landing in the trip | `31`, `32`, §6.13.6 |
| Link problem: expired / used / cancelled / invalid / reset expired | `33` (expired), §6.13.7 |
| No trip yet: member / admin | `35`, `36` |
| Trip switcher | `37` |
| People: invites / members / member sheet / remove confirmation | `38`, `39`, §6.13.10 |
| Invite sheet: create / result / QR / reset-link result | `40`, `41`, `42`, §6.13.11 |
| Set a new password | `34` |
| Account, sign-out confirmation | `43`, §6.13.13 |

---

## 9. Build notes

- Fonts: Alfa Slab One and Instrument Sans (Google Fonts, OFL). Bundle them; don't fetch at runtime.
- Coaster label on an arc: use text-on-path (SVG) or a platform equivalent; the arc is the lower half of a circle with radius 36% of the coaster, text centred.
- Everything in the prototype that is not in this spec (sample names, Lisbon venues, numbers) is placeholder data.
- The prototype's page chrome (headings, captions, the theme switch bar) is presentation only — not app UI.

---

## 10. Open questions for product

1. **Per-theme artwork.** Themes are content-only. Should rank badges and achievement icons still get per-theme artwork (the product spec asks for it), or one neutral set with theme names? This design assumes **one neutral set** (bolt badge for achievements; rank shown as text on a neutral badge).
2. **Rank bands** are placeholders (Classic 10, CS2 18 equal steps of 0.85). Tune after a test trip.
3. **Drink Rating 2.0** (CS2 leaderboard) needs a formula. The prototype shows sample values.
4. **Brand names** in the catalogue need a licensing check before shipping popular lists.
5. **Predictions default values** (Q1 = 5/day × days) — confirm.

*Accounts, sign-in and invites (§6.13):*

6. **Sign-in method.** This design uses email + password, which works with password managers and needs no email delivery. Passkeys would be kinder at 1 a.m. Add them as an option in V1.1?
7. **No email in V1.** Invites and password resets are links that the admin shares by hand. Email delivery, and with it a self-serve "forgot password", needs a mail provider. Add later?
8. **Group invite links.** One link per person keeps the pending list clean, but it's 8 shares for 8 friends. A multi-use trip link (e.g. "up to 10 people, 48 h") would be faster. This design assumes it's **not** in V1.
9. **Late joiners and predictions.** The prediction window closes 24 h after the trip is created, so someone invited on day 3 never gets to predict. Should each member get their own window (24 h from joining)?
10. **One admin.** V1 has exactly one admin, recoverable only with the server command. Should the admin be able to promote a second one?
11. ~~**"Admin" in the CS2 pack.**~~ **Resolved.** `themes/cs2.json → wrappedSquad.ownerSub` used to call the trip owner "the admin", which clashed with the new admin role. It now reads "You're the TO. Go live when the room is ready." (TO = tournament organiser, in keeping with the CS2 voice). The prototype and `screenshots/cs2/22-ceremony-locked-owner.png` show the new line.
12. **Removed users' data.** This design assumes their drinks stay on the trip, since the totals and Wrapped would be wrong otherwise. Confirm, and decide whether they're still eligible for awards.
13. **Trip creation** isn't specified in the product spec or here. This design assumes the admin creates trips and is their owner by default. The "Create a trip" button (§6.13.8) needs its own screen.
