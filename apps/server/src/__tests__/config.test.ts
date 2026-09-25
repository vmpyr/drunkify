import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('derives SQLite and secure-cookie defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: '/tmp/drunkify-config-test',
      PUBLIC_URL: 'https://drunkify.test',
    });
    expect(config.DB_DRIVER).toBe('sqlite');
    expect(config.SQLITE_PATH).toBe('/tmp/drunkify-config-test/drunkify.db');
    expect(config.DRUNKIFY_MIGRATIONS_DIR).toMatch(/[/\\]drizzle$/);
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('allows an explicit insecure cookie for HTTP deployments', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PUBLIC_URL: 'http://localhost:3000',
      COOKIE_SECURE: 'false',
    });
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('fails fast for invalid production and Postgres configuration', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_URL.*ADMIN_EMAIL/);
    expect(() => loadConfig({ NODE_ENV: 'test', DB_DRIVER: 'postgres' })).toThrow(/DATABASE_URL/);
  });
});
