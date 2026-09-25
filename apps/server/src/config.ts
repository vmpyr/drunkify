import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    PUBLIC_URL: optionalString.pipe(z.string().url().optional()),
    DATA_DIR: z.string().default('/data'),
    DB_DRIVER: z.enum(['sqlite', 'postgres']).default('sqlite'),
    SQLITE_PATH: optionalString,
    DATABASE_URL: optionalString,
    DRUNKIFY_MIGRATIONS_DIR: optionalString,
    ADMIN_EMAIL: optionalString.pipe(z.string().email().optional()),
    ADMIN_PASSWORD: optionalString,
    SESSION_COOKIE_NAME: z.string().min(1).default('drunkify_session'),
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    TRUST_PROXY: booleanString,
    MAILER: z.enum(['log', 'smtp']).default('log'),
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: booleanString,
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAIL_FROM: z.string().default('Drunkify <no-reply@localhost>'),
    GEO_VENUE_PROVIDER: z.enum(['none', 'overpass']).default('none'),
    OVERPASS_URL: z.string().url().default('https://overpass-api.de/api/interpreter'),
    MAP_STYLE_URL: z.string().url().default('https://tiles.openfreemap.org/styles/liberty'),
    MAP_CSP_ORIGINS: z.string().default('https://tiles.openfreemap.org'),
    LOG_LEVEL: z.string().default('info'),
    TZ: optionalString,
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.PUBLIC_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_URL'],
        message: 'PUBLIC_URL is required in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.ADMIN_EMAIL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_EMAIL'],
        message: 'ADMIN_EMAIL is required in production',
      });
    }
    if (env.DB_DRIVER === 'postgres' && !env.DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DB_DRIVER=postgres',
      });
    }
    if (env.MAILER === 'smtp' && !env.SMTP_HOST) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when MAILER=smtp',
      });
    }
  })
  .transform((env) => {
    const publicUrlSecure = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).protocol === 'https:' : true;
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    return {
      ...env,
      SQLITE_PATH: env.SQLITE_PATH ?? resolve(env.DATA_DIR, 'drunkify.db'),
      DRUNKIFY_MIGRATIONS_DIR: env.DRUNKIFY_MIGRATIONS_DIR ?? resolve(repositoryRoot, 'drizzle'),
      COOKIE_SECURE:
        env.COOKIE_SECURE === undefined ? publicUrlSecure : env.COOKIE_SECURE === 'true',
      MAP_CSP_ORIGINS: env.MAP_CSP_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    };
  });

export type Config = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return result.data;
}
