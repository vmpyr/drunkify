import { z } from 'zod';

const text = z.string();
const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const stringRecordSchema = z.record(z.string(), text);

type ContentNode = string | { readonly [key: string]: ContentNode };
const contentNodeSchema: z.ZodType<ContentNode> = z.lazy(() =>
  z.union([text, z.record(z.string(), contentNodeSchema)]),
);
const contentObjectSchema = z.record(z.string(), contentNodeSchema);

export const LeaderboardColumnSchema = z
  .object({
    key: text.min(1),
    label: text.min(1),
    meaning: text.optional(),
    primary: z.boolean().optional(),
    display: text.optional(),
  })
  .strict();

export const RankBandSchema = z
  .object({
    min: nonNegativeNumber,
    name: text.min(1),
  })
  .strict();

export const AchievementContentSchema = z
  .object({ trigger: text, name: text, description: text })
  .strict();
export const AwardContentSchema = z.object({ criterion: text, name: text }).strict();
export const ArchetypeContentSchema = z
  .object({ behaviour: text, name: text, writeup: text })
  .strict();
export const AbsurdUnitLabelSchema = z
  .object({ label: z.object({ singular: text, plural: text }).strict() })
  .strict();

export const ThemePackSchema = z
  .object({
    $description: text,
    id: text.min(1),
    name: text.min(1),
    voice: text,
    nav: stringRecordSchema,
    leaderboard: z
      .object({
        title: text,
        subtitle: text,
        columns: z.array(LeaderboardColumnSchema).min(1),
        you: text,
        maskedNote: text,
        maskedSort: text,
        achievementsHeading: text,
        achievementsNote: text,
        yourRankTeaser: stringRecordSchema,
      })
      .strict(),
    home: stringRecordSchema,
    logWizard: stringRecordSchema,
    toasts: stringRecordSchema,
    feed: stringRecordSchema,
    locked: z.object({ sectionTitle: text, tileNote: text, tiles: z.array(text) }).strict(),
    predictions: stringRecordSchema,
    achievements: z.record(z.string(), AchievementContentSchema),
    awards: z.record(z.string(), AwardContentSchema),
    archetypes: z
      .object({
        metronome: ArchetypeContentSchema,
        chaos: ArchetypeContentSchema,
        connoisseur: ArchetypeContentSchema,
        explorer: ArchetypeContentSchema,
        tortoise: ArchetypeContentSchema,
        speedrunner: ArchetypeContentSchema,
        designated: ArchetypeContentSchema,
        loyalist: ArchetypeContentSchema,
        night_owl: ArchetypeContentSchema,
        social: ArchetypeContentSchema,
        secondaryPrefix: text,
        partner: text,
        partnerNote: text,
      })
      .strict(),
    ranks: z.object({ basis: text, bands: z.array(RankBandSchema).min(1) }).strict(),
    sideLeaderboards: stringRecordSchema,
    comparisons: z
      .object({
        absurdUnits: z
          .object({
            bathtub: AbsurdUnitLabelSchema,
            olympic_pool: AbsurdUnitLabelSchema,
            pub_keg: AbsurdUnitLabelSchema,
            tanker_truck: AbsurdUnitLabelSchema,
            fire_hydrant: AbsurdUnitLabelSchema,
          })
          .strict(),
      })
      .strict(),
    wrappedPersonal: z
      .object({
        notification: stringRecordSchema,
        ready: stringRecordSchema,
        nav: stringRecordSchema,
        cards: z.record(z.string(), contentObjectSchema),
      })
      .strict(),
    wrappedSquad: z
      .object({
        title: text,
        guestSub: text,
        waitingTitle: text,
        waitingBody: text,
        rewatch: text,
        ownerSub: text,
        ownerWatched: text,
        start: text,
        cast: text,
        presenting: text,
        reveal: text,
        back: text,
        hold: text,
        footer: text,
        cards: z.record(z.string(), contentObjectSchema),
      })
      .strict(),
    owner: stringRecordSchema,
  })
  .strict();

const authSectionSchema = contentObjectSchema;
export const AuthContentSchema = z
  .object({
    $description: text,
    voice: text,
    brand: authSectionSchema,
    fields: authSectionSchema,
    signIn: authSectionSchema,
    setup: authSectionSchema,
    invite: authSectionSchema,
    linkProblem: authSectionSchema,
    reset: authSectionSchema,
    noTrip: authSectionSchema,
    errors: authSectionSchema,
    people: authSectionSchema,
    inviteSheet: authSectionSchema,
    account: authSectionSchema,
    email: authSectionSchema,
  })
  .strict();

export const DrinkCategorySchema = z.enum([
  'beer',
  'wine',
  'cocktail',
  'spirit',
  'shot',
  'cider',
  'seltzer',
  'soft',
  'other',
]);
const CatalogSizeSchema = z.object({ ml: finiteNumber.positive(), label: text }).strict();
const CatalogCategorySchema = z
  .object({
    id: DrinkCategorySchema,
    name: text,
    defaultSize: finiteNumber.positive(),
    sizes: z.array(CatalogSizeSchema).min(1),
    drinks: z.array(z.tuple([text, nonNegativeNumber])),
  })
  .strict();
export const CatalogSchema = z
  .object({
    $description: text,
    standardDrink: z
      .object({
        gramsPerStd: finiteNumber.positive(),
        ethanolDensity: finiteNumber.positive(),
        formula: text,
      })
      .strict(),
    abvSlider: z
      .object({
        min: nonNegativeNumber,
        max: finiteNumber.positive(),
        segments: z
          .array(
            z
              .object({
                from: nonNegativeNumber,
                to: finiteNumber.positive(),
                step: finiteNumber.positive(),
                positions: z.number().int().positive(),
              })
              .strict(),
          )
          .min(1),
        totalPositions: z.number().int().positive(),
        posToAbv: text,
        abvToPos: text,
        ticks: z.array(nonNegativeNumber),
        nudge: text,
        display: text,
      })
      .strict(),
    categories: z.array(CatalogCategorySchema).min(1),
    ratingScale: z
      .array(z.object({ value: z.number().int().min(1).max(5), face: text }).strict())
      .length(5),
    note: text,
  })
  .strict();

export const PricesSchema = z
  .object({
    currency: z.literal('EUR'),
    categoryPrices: z
      .object({
        beer: nonNegativeNumber,
        wine: nonNegativeNumber,
        cocktail: nonNegativeNumber,
        spirit: nonNegativeNumber,
        shot: nonNegativeNumber,
        cider: nonNegativeNumber,
        seltzer: nonNegativeNumber,
        soft: nonNegativeNumber,
        other: nonNegativeNumber,
      })
      .strict(),
    gdpComparison: z
      .object({ referenceCountry: text.min(1), gdpPerSecondEUR: finiteNumber.positive() })
      .strict(),
  })
  .strict();

export const AbsurdUnitKeySchema = z.enum([
  'bathtub',
  'olympic_pool',
  'pub_keg',
  'tanker_truck',
  'fire_hydrant',
]);
export const AbsurdDisplaySchema = z.enum(['count', 'percent', 'minutes']);
const absurdUnitConfigSchema = z
  .object({ volumeL: finiteNumber.positive(), displayAs: AbsurdDisplaySchema })
  .strict();
export const ComparisonsSchema = z
  .object({
    absurdUnits: z
      .object({
        bathtub: absurdUnitConfigSchema,
        olympic_pool: absurdUnitConfigSchema,
        pub_keg: absurdUnitConfigSchema,
        tanker_truck: absurdUnitConfigSchema,
        fire_hydrant: absurdUnitConfigSchema,
      })
      .strict(),
    liverMilesKmPerL: finiteNumber.positive(),
    liverMilesReferenceDistances: z
      .array(z.object({ label: text.min(1), km: finiteNumber.positive() }).strict())
      .min(1),
  })
  .strict();

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const TokensSchema = z
  .object({
    $description: text,
    color: z.record(z.string(), jsonValueSchema),
    font: z.record(z.string(), jsonValueSchema),
    type: z.record(z.string(), jsonValueSchema),
    space: z.record(z.string(), jsonValueSchema),
    radius: z.record(z.string(), jsonValueSchema),
    size: z.record(z.string(), jsonValueSchema),
    stroke: z.record(z.string(), jsonValueSchema),
    elevation: z.record(z.string(), jsonValueSchema),
    motion: z.record(z.string(), jsonValueSchema),
    haptics: z.record(z.string(), jsonValueSchema),
  })
  .strict();

export const THEME_ARRAY_ELEMENT_SCHEMAS = {
  'leaderboard.columns': LeaderboardColumnSchema,
  'locked.tiles': z.string(),
  'ranks.bands': RankBandSchema,
} as const;

export type ThemePack = z.infer<typeof ThemePackSchema>;
export type AuthContent = z.infer<typeof AuthContentSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type PricesConfig = z.infer<typeof PricesSchema>;
export type ComparisonsConfig = z.infer<typeof ComparisonsSchema>;
export type Tokens = z.infer<typeof TokensSchema>;
export type LeaderboardColumn = z.infer<typeof LeaderboardColumnSchema>;
export type RankBand = z.infer<typeof RankBandSchema>;
export type DrinkCategory = z.infer<typeof DrinkCategorySchema>;
export type AbsurdUnitKey = z.infer<typeof AbsurdUnitKeySchema>;
export type ContentPack = ThemePack | AuthContent;
