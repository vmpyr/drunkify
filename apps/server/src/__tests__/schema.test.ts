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

  it('declares the M6 prediction and achievement constraints in both dialects', () => {
    const sqlitePredictions = getSqliteTableConfig(sqliteTables.predictions);
    const pgPredictions = getPgTableConfig(pgTables.predictions);
    const sqliteAchievements = getSqliteTableConfig(sqliteTables.achievementUnlocks);
    const pgAchievements = getPgTableConfig(pgTables.achievementUnlocks);

    for (const predictions of [sqlitePredictions, pgPredictions]) {
      expect(predictions.indexes.map((item) => item.config.name)).toContain(
        'ux_predictions_trip_user',
      );
      expect(predictions.checks.map((item) => item.name)).toContain(
        'ck_predictions_q5_top_drink_category',
      );
      expect(
        predictions.foreignKeys.map((item) => ({
          column: item.reference().columns[0]?.name,
          onDelete: item.onDelete,
        })),
      ).toEqual(
        expect.arrayContaining([
          { column: 'trip_id', onDelete: 'cascade' },
          { column: 'user_id', onDelete: 'cascade' },
          { column: 'q3_top_member_id', onDelete: 'set null' },
          { column: 'q4_least_member_id', onDelete: 'set null' },
        ]),
      );
    }

    for (const achievements of [sqliteAchievements, pgAchievements]) {
      const indexes = achievements.indexes.map((item) => item.config);
      const personalIndex = indexes.find((item) => item.name === 'ux_achievement_unlocks_personal');
      const groupIndex = indexes.find((item) => item.name === 'ux_achievement_unlocks_group');
      const recentIndex = indexes.find(
        (item) => item.name === 'ix_achievement_unlocks_trip_unlocked',
      );
      expect(personalIndex?.unique).toBe(true);
      expect(personalIndex?.where).toBeDefined();
      expect(groupIndex?.unique).toBe(true);
      expect(groupIndex?.where).toBeDefined();
      expect(recentIndex?.unique).toBe(false);
      expect(
        achievements.foreignKeys.map((item) => ({
          column: item.reference().columns[0]?.name,
          onDelete: item.onDelete,
        })),
      ).toEqual(
        expect.arrayContaining([
          { column: 'trip_id', onDelete: 'cascade' },
          { column: 'user_id', onDelete: 'cascade' },
          { column: 'triggered_by_user_id', onDelete: 'restrict' },
          { column: 'drink_id', onDelete: 'set null' },
        ]),
      );
      const varsColumn = achievements.columns.find((column) => column.name === 'vars');
      expect(varsColumn?.notNull).toBe(true);
      expect(varsColumn?.default).toBeDefined();
    }
  });
});
