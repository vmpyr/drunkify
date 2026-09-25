import { defineConfig } from 'drizzle-kit';

const driver = process.env.DB_DRIVER ?? 'sqlite';

export default defineConfig(
  driver === 'postgres'
    ? {
        dialect: 'postgresql',
        schema: './apps/server/src/db/schema.pg.ts',
        out: './drizzle/pg',
        dbCredentials: {
          url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/drunkify',
        },
      }
    : {
        dialect: 'sqlite',
        schema: './apps/server/src/db/schema.sqlite.ts',
        out: './drizzle/sqlite',
        dbCredentials: {
          url: process.env.SQLITE_PATH ?? './data/drunkify.db',
        },
      },
);
