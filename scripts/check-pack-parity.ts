import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';

import { AUTH_EXPECTED_VARS, EXPECTED_VARS } from '../packages/content/src/expected-vars.ts';
import {
  AuthContentSchema,
  CatalogSchema,
  ComparisonsSchema,
  PricesSchema,
  THEME_ARRAY_ELEMENT_SCHEMAS,
  ThemePackSchema,
  TokensSchema,
} from '../packages/content/src/types.ts';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type ExpectedVars = Readonly<Record<string, readonly string[]>>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = resolve(repoRoot, 'packages/content');
const errors: string[] = [];

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(relativePath: string): Promise<JsonValue> {
  return JSON.parse(await readFile(resolve(contentRoot, relativePath), 'utf8')) as JsonValue;
}

function validateSchema(label: string, schema: ZodTypeAny, value: JsonValue): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(
        `${label}${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      );
    }
  }
}

function compareObjectKeys(left: JsonValue, right: JsonValue, path = '<root>'): void {
  if (Array.isArray(left) || Array.isArray(right)) return;
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    const missing = leftKeys.filter((key) => !rightKeys.includes(key));
    const extra = rightKeys.filter((key) => !leftKeys.includes(key));
    if (missing.length || extra.length) {
      errors.push(
        `${path}: pack key mismatch (missing in cs2: ${missing.join(', ') || 'none'}; extra in cs2: ${extra.join(', ') || 'none'})`,
      );
    }
    for (const key of leftKeys.filter((candidate) => rightKeys.includes(candidate))) {
      compareObjectKeys(
        left[key] as JsonValue,
        right[key] as JsonValue,
        path === '<root>' ? key : `${path}.${key}`,
      );
    }
    return;
  }
  if (typeof left !== typeof right) {
    errors.push(`${path}: value type mismatch (${typeof left} vs ${typeof right})`);
  }
}

function validateArrays(value: JsonValue, path = ''): void {
  if (Array.isArray(value)) {
    const schema = THEME_ARRAY_ELEMENT_SCHEMAS[path as keyof typeof THEME_ARRAY_ELEMENT_SCHEMAS];
    if (!schema) {
      errors.push(`${path}: no array element schema registered`);
      return;
    }
    value.forEach((element, index) => validateSchema(`${path}[${index}]`, schema, element));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    validateArrays(child, path ? `${path}.${key}` : key);
  }
}

const validPlaceholder = /^\{([A-Za-z_]\w*)\}$/;
const braceExpression = /\{[^{}]*\}/g;
const placeholder = /\{([A-Za-z_]\w*)\}/g;
const unfinishedCopy = /\b(?:lorem ipsum|todo|tbd)\b/i;

function lintStrings(label: string, value: JsonValue, expected: ExpectedVars, path = ''): void {
  if (typeof value === 'string') {
    if (path === '$description' || path.endsWith('.$description')) return;
    for (const expression of value.match(braceExpression) ?? []) {
      if (!validPlaceholder.test(expression)) {
        errors.push(`${label}.${path}: malformed placeholder ${JSON.stringify(expression)}`);
      }
    }
    const allowed = new Set(expected[path] ?? []);
    for (const match of value.matchAll(placeholder)) {
      const name = match[1];
      if (name && !allowed.has(name)) {
        errors.push(
          `${label}.${path}: unknown placeholder {${name}} (allowed: ${[...allowed].join(', ') || 'none'})`,
        );
      }
    }
    if (unfinishedCopy.test(value)) {
      errors.push(`${label}.${path}: unfinished placeholder copy found`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => lintStrings(label, child, expected, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    lintStrings(label, child, expected, path ? `${path}.${key}` : key);
  }
}

const [classic, cs2, auth, catalog, comparisons, prices, tokens] = await Promise.all([
  readJson('themes/classic.json'),
  readJson('themes/cs2.json'),
  readJson('auth.json'),
  readJson('catalog.json'),
  readJson('comparisons.json'),
  readJson('prices.json'),
  readJson('tokens.json'),
]);

validateSchema('themes/classic.json', ThemePackSchema, classic);
validateSchema('themes/cs2.json', ThemePackSchema, cs2);
validateSchema('auth.json', AuthContentSchema, auth);
validateSchema('catalog.json', CatalogSchema, catalog);
validateSchema('comparisons.json', ComparisonsSchema, comparisons);
validateSchema('prices.json', PricesSchema, prices);
validateSchema('tokens.json', TokensSchema, tokens);
compareObjectKeys(classic, cs2);
validateArrays(classic);
validateArrays(cs2);
lintStrings('themes/classic.json', classic, EXPECTED_VARS);
lintStrings('themes/cs2.json', cs2, EXPECTED_VARS);
lintStrings('auth.json', auth, AUTH_EXPECTED_VARS);

if (errors.length) {
  console.error(
    `Content validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`,
  );
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log('Content schemas, theme parity, array elements, and placeholders are valid.');
}
