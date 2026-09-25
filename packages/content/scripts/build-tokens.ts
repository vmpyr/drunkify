import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(packageRoot, 'tokens.json');
const cssPath = resolve(packageRoot, 'css/tokens.css');
const tsPath = resolve(packageRoot, 'src/tokens.ts');
const checkOnly = process.argv.includes('--check');

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function leafValue(value: JsonValue): JsonValue {
  if (isObject(value) && 'value' in value) return value['value'] ?? '';
  return value;
}

function flatten(
  value: JsonValue,
  prefix: readonly string[],
  output: Array<readonly [string, JsonValue]>,
  skipMetadata = true,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, [...prefix, String(index)], output, skipMetadata));
    return;
  }
  if (isObject(value)) {
    if ('value' in value) {
      output.push([prefix.map(kebab).join('-'), leafValue(value)]);
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        key === 'value' ||
        (skipMetadata &&
          ['$description', 'use', 'source', 'note', 'property', 'trigger'].includes(key))
      )
        continue;
      flatten(child, [...prefix, key], output, skipMetadata);
    }
    return;
  }
  output.push([prefix.map(kebab).join('-'), value]);
}

function cssValue(section: string, path: string, value: JsonValue): string | null {
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'string') {
    const rendered = value.replace(
      /\{color\.<mode>\.([A-Za-z0-9_]+)\}/g,
      (_m, token: string) => `var(--color-${kebab(token)})`,
    );
    return /[;]|\b(?:of|fills|disable|same as)\b/i.test(rendered)
      ? JSON.stringify(rendered)
      : rendered;
  }
  if (typeof value !== 'number') return null;
  if (section === 'space' || section === 'radius' || section === 'size' || section === 'stroke')
    return `${value}px`;
  if (section === 'type') {
    if (path.endsWith('-size') || path.endsWith('-tracking')) return `${value}px`;
    return String(value);
  }
  if (
    section === 'motion' &&
    (path.endsWith('-duration') ||
      path.endsWith('-auto-dismiss') ||
      path.endsWith('-delay-after-log'))
  )
    return `${value}ms`;
  return String(value);
}

function declarations(
  entries: ReadonlyArray<readonly [string, JsonValue]>,
  section: string,
): string[] {
  return entries.flatMap(([path, value]) => {
    const rendered = cssValue(section, path, value);
    return rendered === null ? [] : [`  --${section}-${path}: ${rendered};`];
  });
}

function renderCss(tokens: JsonObject): string {
  const color = tokens['color'];
  if (!isObject(color) || !isObject(color['dark']) || !isObject(color['light'])) {
    throw new Error('tokens.json must define dark and light color objects');
  }

  const dark: Array<readonly [string, JsonValue]> = [];
  const light: Array<readonly [string, JsonValue]> = [];
  flatten(color['dark'], [], dark);
  flatten(color['light'], [], light);

  const rootLines = declarations(dark, 'color');
  for (const section of [
    'type',
    'space',
    'radius',
    'size',
    'stroke',
    'elevation',
    'motion',
  ] as const) {
    const node = tokens[section];
    if (!node) continue;
    const entries: Array<readonly [string, JsonValue]> = [];
    flatten(node, [], entries);
    rootLines.push(...declarations(entries, section));
  }

  const lightLines = declarations(light, 'color');
  return `/* Generated from ../tokens.json by scripts/build-tokens.ts. Do not edit. */\n:root {\n${rootLines.join('\n')}\n}\n\n:root[data-theme="light"] {\n${lightLines.join('\n')}\n}\n\n@media (prefers-color-scheme: light) {\n  :root[data-theme="system"] {\n${lightLines.map((line) => `  ${line}`).join('\n')}\n  }\n}\n\n.tabular-nums {\n  font-variant-numeric: tabular-nums;\n}\n`;
}

function renderTypeScript(tokens: JsonObject): string {
  const json = JSON.stringify(tokens, null, 2);
  return `// Generated from ../tokens.json by scripts/build-tokens.ts. Do not edit.\nexport const tokens = ${json} as const;\n\nexport const color = tokens['color'];\nexport const font = tokens.font;\nexport const type = tokens.type;\nexport const space = tokens.space;\nexport const radius = tokens.radius;\nexport const size = tokens.size;\nexport const stroke = tokens.stroke;\nexport const elevation = tokens.elevation;\nexport const motion = tokens.motion;\nexport const haptics = tokens.haptics;\nexport const tabular = { fontVariantNumeric: 'tabular-nums' } as const;\n`;
}

async function assertCurrent(path: string, expected: string): Promise<void> {
  let actual = '';
  try {
    actual = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${path} is missing; run pnpm --filter @drunkify/content tokens:build`);
  }
  if (actual !== expected) {
    throw new Error(`${path} is stale; run pnpm --filter @drunkify/content tokens:build`);
  }
}

const tokens = JSON.parse(await readFile(inputPath, 'utf8')) as JsonObject;
const css = renderCss(tokens);
const source = renderTypeScript(tokens);

if (checkOnly) {
  await Promise.all([assertCurrent(cssPath, css), assertCurrent(tsPath, source)]);
  console.log('Generated token outputs are current.');
} else {
  await Promise.all([writeFile(cssPath, css), writeFile(tsPath, source)]);
  console.log('Generated css/tokens.css and src/tokens.ts.');
}
