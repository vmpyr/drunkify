import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import { schemaTables as pgTables } from '../db/schema.pg.js';
import { schemaTables as sqliteTables } from '../db/schema.sqlite.js';

describe('database schema parity', () => {
  it('keeps table and column names identical across dialects', () => {
    expect(Object.keys(pgTables).sort()).toEqual(Object.keys(sqliteTables).sort());

    for (const key of Object.keys(sqliteTables) as Array<keyof typeof sqliteTables>) {
      const sqlite = getSqliteTableConfig(sqliteTables[key]);
      const postgres = getPgTableConfig(pgTables[key]);
      expect(postgres.name).toBe(sqlite.name);
      expect(postgres.columns.map((column) => column.name).sort()).toEqual(
        sqlite.columns.map((column) => column.name).sort(),
      );
    }
  });
});
