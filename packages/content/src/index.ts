import authJson from '../auth.json' with { type: 'json' };
import catalogJson from '../catalog.json' with { type: 'json' };
import comparisonsJson from '../comparisons.json' with { type: 'json' };
import pricesJson from '../prices.json' with { type: 'json' };
import tokensJson from '../tokens.json' with { type: 'json' };

import {
  AuthContentSchema,
  CatalogSchema,
  ComparisonsSchema,
  PricesSchema,
  ThemePackSchema,
  TokensSchema,
  type AuthContent,
  type Catalog,
  type ComparisonsConfig,
  type ContentPack,
  type PricesConfig,
  type ThemePack,
  type Tokens,
} from './types.js';

export * from './expected-vars.js';
export * from './types.js';

export class ContentError extends Error {
  override readonly name = 'ContentError';
}

const authContent = AuthContentSchema.parse(authJson);
const catalog = CatalogSchema.parse(catalogJson);
const comparisons = ComparisonsSchema.parse(comparisonsJson);
const prices = PricesSchema.parse(pricesJson);
const tokens = TokensSchema.parse(tokensJson);

const themeImporters = {
  classic: () => import('../themes/classic.json', { with: { type: 'json' } }),
  cs2: () => import('../themes/cs2.json', { with: { type: 'json' } }),
} as const;

export type ThemeId = keyof typeof themeImporters;
const themeCache = new Map<string, Promise<ThemePack>>();

export function loadAuthContent(): AuthContent {
  return authContent;
}

export function loadCatalog(): Catalog {
  return catalog;
}

export function loadComparisons(): ComparisonsConfig {
  return comparisons;
}

export function loadPrices(): PricesConfig {
  return prices;
}

export function loadTokens(): Tokens {
  return tokens;
}

export function loadThemePack(id: string): Promise<ThemePack> {
  const cached = themeCache.get(id);
  if (cached) return cached;

  const importer = themeImporters[id as ThemeId];
  if (!importer) {
    return Promise.reject(new ContentError(`Unknown theme pack: ${id}`));
  }

  const pending = importer()
    .then((module) => ThemePackSchema.parse(module.default))
    .catch((error: unknown) => {
      themeCache.delete(id);
      throw error;
    });
  themeCache.set(id, pending);
  return pending;
}

export function invalidateThemePack(id?: string): void {
  if (id === undefined) themeCache.clear();
  else themeCache.delete(id);
}

function isDevelopment(): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (typeof viteEnv?.DEV === 'boolean') return viteEnv.DEV;
  const nodeEnv = (
    globalThis as typeof globalThis & {
      process?: { env?: { NODE_ENV?: string } };
    }
  ).process?.env?.NODE_ENV;
  return nodeEnv !== 'production';
}

function getByPath(pack: ContentPack, key: string): unknown {
  let current: unknown = pack;
  for (const segment of key.split('.')) {
    if (!segment || current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function t(
  pack: ContentPack,
  key: string,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const template = getByPath(pack, key);
  if (typeof template !== 'string') {
    throw new ContentError(`Unknown content key: ${key}`);
  }

  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!vars || !Object.prototype.hasOwnProperty.call(vars, name)) {
      if (isDevelopment()) {
        throw new ContentError(`Missing placeholder "${name}" for key "${key}"`);
      }
      return '';
    }
    return String(vars[name]);
  });
}
