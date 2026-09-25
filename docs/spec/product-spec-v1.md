# Drunkify — V1 Product Spec (for UI Design)

## 1. Product in one line

A mobile-first, just-for-fun drink tracker for a group of friends on a trip. Everyone logs drinks during the trip, and at the end the app turns the data into a dramatic, funny, shareable **"Wrapped"** reveal: a personal story for each person, then a group ceremony watched together.

**Tone:** playful, roasting and self-aware. It celebrates the trip, not the drinking. There is no health scolding and no blood-alcohol estimates. Standard-drink figures are for fun only.

**Primary platform:** phone, one thumb, often used in dark bars. The Squad Wrapped also needs a **big-screen / cast mode**.

---

## 2. Core concepts

| Concept | Meaning |
|---|---|
| **Trip** | A group container. It has a name, members, an owner, a chosen **theme** and a scheduled **Wrapped unlock time**. |
| **Member** | A user in the trip. The **owner** has extra controls: theme, unlock time, starting the ceremony. |
| **Drink log** | One logged drink: category, drink name, size, ABV, quantity, time, GPS, venue, optional rating, optional note. |
| **Standard drink (std)** | 10 g of pure alcohol. Grams = ml × ABV% × 0.789. This is the fair unit for comparing a beer with a shot. |
| **Theme** | A skin that renames and restyles archetypes, ranks, awards, achievements, leaderboards and copy. V1 ships **Classic** and **CS2**. |
| **Wrapped** | The end-of-trip story. **Personal Wrapped** has one per member. **Squad Wrapped** is one shared ceremony. |

**Drink categories:** Beer, Wine, Cocktail, Spirit, Shot, Cider, Seltzer, Soft (non-alcoholic), Other.

---

## 3. Trip lifecycle and phases

```
Created ──► Prediction window ──► Live trip ──► Final 24h ──► Personal Wrapped unlocked ──► Ceremony started
            (first 24h or until                  (countdown,     (at scheduled time)          (owner presses
             member's first drink)                leaderboard                                  "Start the ceremony")
                                                  positions hidden)
```

| Phase | What changes in the UI |
|---|---|
| **Prediction window** | Each member is prompted to submit predictions before their first drink or within 24 h of trip creation, whichever comes first. After that, predictions lock and are hidden from everyone until the Squad Wrapped. |
| **Live trip** | Logging, the live dashboard, and a live achievements feed that everyone can see. |
| **Final 24 h** | This is the 24 h before the scheduled unlock time. A **countdown** appears on the home screen. **Leaderboard positions are hidden**: names are shown but ranks and order are masked, to build suspense for the finale. |
| **Personal Wrapped unlocked** | At the scheduled time, every member's Personal Wrapped opens at once, with a notification and a celebration state. |
| **Ceremony** | The Squad Wrapped stays locked, shown as a teaser, until the owner presses **"Start the ceremony"**. It is designed to be watched together on a big screen. |

The owner sets and can edit the unlock time in trip settings.

---

## 4. Logging a drink

The main screen needs to be quick, usable with one thumb, and forgiving.

1. **Category grid**: big tiles with an emoji and a label.
2. Tapping a category opens a **bottom sheet** with:
   - **Drink type**: popular options for the category (brands, cocktails, wine styles, spirits…) plus "Other…" for free text. Custom names are remembered and appear at the top next time.
   - **Size chips**: common sizes for the category (e.g. beer 250 / 330 / 500 / pint 568 ml; wine 125 / 175 / 250 / bottle 750 ml; spirit and shot 20 / 40 / 60 ml) plus a custom ml input.
   - **ABV**: filled in from the drink type, and editable.
   - **Quantity stepper** in 0.5 steps.
   - **Live standard-drink estimate** for the current selection.
   - **Time**: defaults to now, and can be edited to log a drink later.
   - **Venue**: **pre-filled with the nearest venue suggestion** from GPS. The user can accept it with one tap, rename it or skip it.
   - **Rating (optional)**: a 5-point emoji scale: 🤮 😐 🙂 😍 🔥
   - **Note (optional)**, short.
3. **Save**: the drink is added instantly, the phone buzzes lightly, and a toast appears with **Undo**.

**Captured silently:** GPS coordinates on every log. Location access is assumed to be granted, and city and country are worked out from the coordinates.

**Quick actions:** "Repeat last", a horizontal row of **recent drinks** for one-tap re-logging, and **favourites** (star a recent drink).

**Editing:** tap any feed entry to reopen the same sheet in edit mode, which includes Delete.

**Predictions form** (once per member, during the prediction window):
1. My total std drinks for the trip (number)
2. The group's total std drinks (number)
3. Who tops the leaderboard (member picker)
4. Who drinks the least (member picker)
5. The group's most-ordered drink (drink picker)

Show a clear "locked and hidden until the ceremony" confirmation.

---

## 5. Live dashboard (during the trip)

**Visible while the trip is live:**
- **Totals** for you and for the group: drinks and std drinks
- **Main leaderboard**, ranked by std drinks. Positions are masked in the final 24 h.
- **Breakdowns** by day and by category
- **Achievements feed**, e.g. "Alex just unlocked ACE 🎯"
- **Your own ratings history**
- **Feed** of drinks grouped by day, with a Mine / Everyone filter

**Held back for the Wrapped.** Show these as locked teaser tiles ("Unlocks in the Wrapped 🔒"):
- Absurd units
- Archetypes and rank badges
- All fun metrics
- Side leaderboards
- Crowd favourite and most divisive drink
- The replay
- Predictions
- Awards

**Visibility:** everyone in the trip sees everyone's stats, ratings and locations. The only exception is predictions, which stay hidden until the reveal.

---

## 6. Metrics catalogue

These are the stats the Wrapped cards are built from. They apply to each member and to the group.

### 6.1 Volume and alcohol
- **Total drinks**: count, including half quantities
- **Total volume in real units**: ml, litres, UK pints, US pints, std drinks, grams of pure alcohol
- **Pure ethanol drunk** (the headline figure): e.g. "1.4 L of pure alcohol"
- **Average ABV**, weighted by volume
- **Share of the group's alcohol**: e.g. "you drank 31% of the trip's alcohol"

### 6.2 Absurd units (generic set)
The same total expressed as bathtubs, % of an Olympic pool, pub kegs (50 L), beer tanker trucks and fire hydrants. Pick the unit that gives the funniest number for the card.

### 6.3 Distribution
- **Days**: drinks per day, peak day, quietest day
- **Time of day**: drinks per hour, used by the drunk-o-meter
- **Location**: by city, country and venue; most-visited venue; the personal pub-crawl trail on a map
- **Category and drink**: top drinks and category mix

### 6.4 Ratings (rolled up by drink name)
- Your top-rated drink
- **Guilty pleasure**: a drink you rated low but kept ordering
- **Crowd favourite**: the drink with the highest group average rating
- **Most divisive**: the drink with the biggest spread in ratings between members

### 6.5 Fun metrics
| Metric | What it says |
|---|---|
| **Liver miles** | The ethanol you drank converted into how far a car could drive on it as fuel |
| **Economy comparison** | Estimated spend, from average local prices per drink type per city, compared with something absurd (e.g. a fraction of a country's GDP) |
| **Drunk-o-meter** | A group chart of drinks per hour across the whole trip, with the biggest peaks labelled as "incidents" |
| **Brand loyalty** | How often you ordered the same drink |
| **Adventurousness** | How many unique drinks you tried |
| **Pace twin** | The member whose drinking pattern most closely matched yours: "You and Sam were basically one organism on Day 6" |
| **The keg** | What percentage of one pub keg you (or the group) emptied |
| **Drink Rating 2.0** | A composite score in the style of an esports rating. It appears in the CS2 theme's leaderboard. |

### 6.6 Leaderboards
- **Main:** by std drinks (the fair measure across drink types)
- **Side boards:** most drinks, most litres, most variety, best pacer, earliest first drink, latest last drink, longest daily streak

### 6.7 Archetypes (personality card)
Each member gets a **main and a secondary archetype**, based on how they drank (the theme changes only the name), plus a horoscope-style write-up and a **compatible drinking partner** (their pace twin).

| # | Behaviour | Classic | CS2 |
|---|---|---|---|
| 1 | Steady pace, little day-to-day change | The Metronome | Anchor |
| 2 | Wild swings, late shots | Chaos Agent | Entry Fragger |
| 3 | Rates a lot, wine and cocktails, premium drinks | The Connoisseur | IGL |
| 4 | Most unique drinks | The Explorer | Lurker |
| 5 | Slow, long sessions, lasts longest | The Tortoise | Clutch Master |
| 6 | Huge first hour, fades early | The Speedrunner | Rusher |
| 7 | High share of soft drinks | Designated Hero | Support |
| 8 | Same drink over and over | The Loyalist | One-Tap Andy |
| 9 | Mostly after midnight | Night Owl | Night Shift |
| 10 | Most venues and most drinks logged at the same time as others | Social Butterfly | Rifler |

### 6.8 Rank badges
Rank is based on **std drinks per day of the trip**, so short and long trips are comparable. The bands are **placeholders to adjust after a test trip**.

- **Classic (10 ranks):** Teetotaller (<0.5) · Sipper (0.5–1.5) · Lightweight (1.5–3) · Social Drinker (3–4.5) · Regular (4.5–6) · Pub Veteran (6–8) · Barfly (8–10) · The Tank (10–12) · Legend (12–15) · Liver of Steel (15+)
- **CS2 (18 ranks):** Silver I → Silver Elite Master → Gold Nova I–Master → Master Guardian I, II, Elite → Distinguished Master Guardian → Legendary Eagle → Legendary Eagle Master → Supreme Master First Class → Global Elite. These split the same 0–15+ range into equal steps of about 0.85.

Rank badges need artwork for each theme.

---

## 7. Achievements (live, during the trip)

Unlocking an achievement shows a toast to the person who earned it and posts to the group feed. Each achievement needs an icon for each theme.

| Trigger | Classic | CS2 |
|---|---|---|
| First drink of the trip (per person) | First Blood | First Blood |
| 5 drinks within one hour | Five Alive | ACE |
| Soft drink between two alcoholic drinks | Pit Stop | Eco Round |
| 4 venues in one night | Pub Crawler | Full Rotation |
| Drink logged on a plane | Mile-High Pint | Jump Throw |
| 3 or more members log within 1 minute | Cheers! | Executed |
| Drink logged after 3 AM | Night Owl | Overtime |
| Rated 20 drinks | Critic | Demo Reviewer |
| 100 drinks across the group | Century Club | Frag 100 |
| Drinks in 2+ countries within 24 h | Passport Stamp | Map Veto |
| 5 visits to the same venue | The Regular | Home Map |

---

## 8. Awards (revealed in the Squad Wrapped)

Every member wins **at least one** award. There is also a **Night MVP** for each day, which appears in the replay.

| Criterion | Classic | CS2 |
|---|---|---|
| Most std drinks | Trip MVP | Major MVP |
| Most shots | Shot Caller | Headshot Machine |
| Fanciest drinks (wine, cocktails, premium) | Wine Snob | Skin Collector |
| Logged the least | The Ghost | AFK |
| Earliest first drink of the trip | Early Bird | Pistol Round Winner |
| Latest last drink of the trip | Last One Standing | 1v5 Clutch |
| Most unique drinks | Most Adventurous | Map Pool Master |
| Lowest average rating | Harshest Critic | Toxic Teammate |
| Highest average rating | Hype Man | Caster |
| Least day-to-day change | Most Consistent | The Machine |
| Biggest bounce back after a quiet day | Comeback Kid | 0–12 Comeback |
| Most visits to one venue | Venue Legend of *\<venue\>* | Home Map Advantage |
| Best predictions | Oracle | Pick'em Champion |

---

## 9. Personal Wrapped (14 cards)

The format is a swipeable story with one idea per full-screen card, built to be screenshotted and shared. **Leaderboard position is left out on purpose**, so it stays a surprise for the ceremony.

| # | Card | Content | Why it's here |
|---|---|---|---|
| 1 | **Cold open** | "We need to talk." → the total drink count counts up | Comic tension straight away |
| 2 | **Real units → absurd units** | Litres and pints, then *swipe* → "…or 0.6 bathtubs" | Setup, then punchline |
| 3 | **Guess your ethanol** | A slider for the user's guess, then the actual figure next to it | Interactive; most people guess low, which is the joke |
| 4 | **ABV and your share** | Average ABV and share of the group's alcohol | A breather card |
| 5 | **Peak day roast** | Day distribution chart: "Day 4. We don't talk about Day 4." | Roasts the peak day by name |
| 6 | **Your trail** | Map of your pub-crawl route and your most-visited venue | Something visual after the numbers |
| 7 | **Top drink → guilty pleasure** | Top-rated drink, then *swipe* → the drink you rated low and drank anyway | Starts nice, then turns on you |
| 8 | **Loyal or adventurous?** | Brand loyalty vs adventurousness | Sets up the archetype reveal |
| 9 | **The absurd run** | Liver miles, then the economy comparison, back to back | Absurd stats in a row |
| 10 | **Pace twin** | "You and Sam were basically one organism on Day 6" | Something to shout across the room about |
| 11 | **Achievements** | Grid of unlocked badges | A pat on the back |
| 12 | **Prediction vs reality** | What you predicted for yourself vs what actually happened | Roasting yourself before the finale |
| 13 | **Rank badge** | Drumroll → theme rank badge | Build-up |
| 14 | **Archetype** | Main and secondary archetype, write-up, compatible drinking partner | The big finish, and the card people screenshot |

End state: share buttons, a "Waiting for the ceremony…" teaser, and replay of the story.

---

## 10. Squad Wrapped (11 cards, a ceremony)

This is watched together on a big screen. The owner starts it, and a **cast / big-screen mode** is needed with large type, presenter-controlled advance, and room for dramatic pauses. It builds from light, low-stakes cards to the #1 reveal.

| # | Card | Content | Why it's here |
|---|---|---|---|
| 1 | **Group total** | Group total counts up, then in absurd units | Gets the room going |
| 2 | **Drunk-o-meter** | Chart of the whole trip with peaks labelled as "incidents" | Brings back stories from the trip |
| 3 | **The keg** | What % of a pub keg the group emptied | Quick laugh |
| 4 | **Cities and venues** | Breakdown by city and venue, plus the top venue | Sets up the replay |
| 5 | **Crowd favourite → most divisive** | The group's best-rated drink, then the drink everyone disagreed on | Starts arguments |
| 6 | **Day-by-day replay** | See §11 | The energy peak in the middle |
| 7 | **Side leaderboards** | Variety, pace, earliest, latest, streaks | Low-stakes wins so everyone places somewhere |
| 8 | **Predictions reveal** | Each member's predictions vs reality, ending on the Oracle | Comedy: everyone's day-one confidence falls apart |
| 9 | **Awards ceremony** | One award per card, in presenter style, with **The Ghost** placed in the middle for comic relief | Everyone gets a moment |
| 10 | **Main leaderboard, reverse order** | Revealed from last place up to #1, which is crowned Trip MVP | The climax |
| 11 | **Credits roll** | Every member's archetype plus **blooper stats**: smallest drink logged, strangest note, most-edited entry, the lone 4 AM "water" | Ends on a laugh |

---

## 11. Day-by-day replay

- An animated map that plays through the whole trip hour by hour
- Each member is a coloured dot leaving a trail
- Each drink appears as a **pulse**, sized by its std drinks
- A **running leaderboard ticker** on the side
- **Night MVP** is shown as each day ends
- **Achievements pop up** at the moment they happened
- Length: about **60–90 seconds** for a two-week trip
- Controls: play/pause and scrub
- **Export as video** for sharing

---

## 12. Themes

The trip owner picks the theme. It restyles the whole trip experience: live dashboard, achievements and both Wrappeds.

| Element | Classic | CS2 |
|---|---|---|
| **Voice** | Dry, roasting pub-quiz host | HLTV-style caster hyping a Major final |
| **Colours** | Amber, foam white, dark wood | Near-black, T-side orange, CT-side blue |
| **Main leaderboard name** | "The Tab" | "Scoreboard" |
| **Leaderboard columns** | Drinks · Std drinks | **K** (std drinks) · **A** (drinks logged in sync with others) · **D** (soft drinks) · **Drink Rating 2.0** |
| **Ranks** | 10 pub ranks (§6.8) | 18 competitive ranks (§6.8) |
| **Archetypes / awards / achievements** | Classic names (§6.7, §7, §8) | CS2 names (§6.7, §7, §8) |

**Assets needed per theme:** colour tokens, typography, rank badges, achievement icons, award card frames, archetype illustrations, and the Wrapped card backgrounds and transitions.

---

## 13. States to design

- **Empty trip**: no drinks yet
- **Prediction prompt**: open, submitted (locked), and missed/expired
- **Locked teaser tiles** on the live dashboard
- **Final-24 h countdown**, and the leaderboard with masked positions
- **Personal Wrapped unlocked**: notification and celebration
- **Ceremony locked**: teaser, and "waiting for the owner" for non-owners
- **Owner controls**: theme picker, unlock time picker, "Start the ceremony"
- **Achievement unlocked**: your own toast, and an entry in the group feed
- **Venue suggestion**: suggested, renamed, skipped
- Light and dark mode for the Classic theme. CS2 is dark only.

---

## 14. Out of scope for V1 (planned for V2)

A small AI model will generate content for a specific trip or theme:
- **Local specialties**, e.g. "tried 3 local drinks" achievements based on where the trip is
- **Units based on the city or country**, e.g. "a year of the average beer for someone in \<country\>"
- **Custom write-ups for each person**
- **More themes**, e.g. Fantasy RPG or Wildlife Documentary

Keep the theme system and card layouts flexible enough that generated text and new themes can drop in without a redesign.
