import {
  loadAuthContent,
  loadCatalog,
  t,
  ThemePackSchema,
  type ContentPack,
  type DrinkCategory,
  type ThemePack,
} from '@drunkify/content';
import { formatAbv, formatLitres, formatStd, litres } from '@drunkify/shared';
import { useQuery } from '@tanstack/react-query';

export const auth = loadAuthContent();
export const catalog = loadCatalog();

type Vars = Readonly<Record<string, string | number>>;

/** Auth copy (theme-independent, DS §6.13). */
export function a(key: string, vars?: Vars): string {
  return t(auth as unknown as ContentPack, key, vars);
}

/** Theme copy. Themes change words only, never visuals. */
export function tp(pack: ThemePack, key: string, vars?: Vars): string {
  return t(pack as unknown as ContentPack, key, vars);
}

/** Like tp but returns null for keys a pack doesn't define (optional card variants). */
export function tpMaybe(pack: ThemePack, key: string, vars?: Vars): string | null {
  try {
    return tp(pack, key, vars);
  } catch {
    return null;
  }
}

// Vite-native imports: the package's own loader uses JSON import attributes, which the dev
// server can't serve as modules.
const THEME_IMPORTERS: Record<string, () => Promise<{ default: unknown }>> = {
  classic: () => import('@drunkify/content/themes/classic.json'),
  cs2: () => import('@drunkify/content/themes/cs2.json'),
};

async function loadPack(themeId: string): Promise<ThemePack> {
  const importer = THEME_IMPORTERS[themeId] ?? THEME_IMPORTERS.classic!;
  return ThemePackSchema.parse((await importer()).default);
}

export function useThemePack(themeId: string | undefined) {
  return useQuery({
    queryKey: ['themePack', themeId],
    queryFn: () => loadPack(themeId ?? 'classic'),
    enabled: themeId !== undefined,
    staleTime: Infinity,
  });
}

/** Coaster order from DS §6.1. */
export const COASTER_ORDER: DrinkCategory[] = [
  'beer',
  'wine',
  'cocktail',
  'spirit',
  'shot',
  'cider',
  'seltzer',
  'soft',
  'other',
];

export function categoryOf(id: DrinkCategory) {
  return catalog.categories.find((category) => category.id === id)!;
}

export const CHART_COLOURS: Record<DrinkCategory, string> = {
  beer: '#F4A73B',
  cocktail: '#E88C7D',
  wine: '#C9534A',
  shot: '#FFF3DE',
  soft: '#7FA35C',
  spirit: '#D98E3F',
  cider: '#B7C95A',
  seltzer: '#9FD6C8',
  other: '#B39A7A',
};

const MEMBER_PALETTE = [
  '#F4A73B',
  '#8FC1E3',
  '#E88C7D',
  '#A7D17A',
  '#D6A8E6',
  '#E8D27A',
  '#9FD6C8',
  '#F2B4C8',
  '#C9B38A',
  '#B8C4F0',
];

export function memberColour(colorIndex: number | undefined): string {
  return MEMBER_PALETTE[(((colorIndex ?? 0) % 10) + 10) % 10]!;
}

export const FACES = catalog.ratingScale.map((entry) => entry.face);

export function face(rating: number | null | undefined): string {
  return rating ? (FACES[rating - 1] ?? '') : '';
}

/** Named catalogue sizes (Pint, Bottle) read as words; everything else as "330 ml". */
export function sizeName(category: DrinkCategory, ml: number): string {
  const size = categoryOf(category).sizes.find((entry) => entry.ml === ml);
  return size && !/ml$/i.test(size.label) ? size.label.toLowerCase() : `${ml} ml`;
}

export function qtyTxt(qty: number): string {
  return qty === 1 ? '' : `${qty % 1 ? qty.toFixed(1) : qty} × `;
}

export function qtyNum(qty: number): string {
  return qty % 1 ? qty.toFixed(1) : String(qty);
}

export const f1 = formatStd;
/** Litres of liquid; the app's only volume unit on screen. */
export const fmtL = formatLitres;
export const drinkLitres = (drink: { sizeMl: number; qty: number }) => litres(drink.sizeMl, drink.qty);
export const fmtAbv = (abv: number) => `${formatAbv(abv)}`;

export function hhmm(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function shortDate(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(ms);
}

export function tripDates(startDate: string, endDate: string): string {
  const parse = (value: string) => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!, 12);
  };
  const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(ms);
  const start = parse(startDate);
  const end = parse(endDate);
  const sameMonth = startDate.slice(0, 7) === endDate.slice(0, 7);
  return sameMonth
    ? `${fmt(start, { day: 'numeric' })}–${fmt(end, { day: 'numeric', month: 'short' })}`
    : `${fmt(start, { day: 'numeric', month: 'short' })}–${fmt(end, { day: 'numeric', month: 'short' })}`;
}

/** "Description, 04:10", or just the time when an achievement has no description. */
export function withTime(description: string | null, time: string): string {
  const text = (description ?? '').trim().replace(/\.$/, '');
  return text ? `${text}, ${time}` : time;
}

export function relativeAgo(ms: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function countdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
}

export function durationWords(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
