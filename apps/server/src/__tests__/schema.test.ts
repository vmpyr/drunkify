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

  it('declares the M8 wrapped view and snapshot constraints in both dialects', () => {
    const sqliteViews = getSqliteTableConfig(sqliteTables.wrappedViews);
    const pgViews = getPgTableConfig(pgTables.wrappedViews);
    const sqliteSnapshots = getSqliteTableConfig(sqliteTables.wrappedSnapshots);
    const pgSnapshots = getPgTableConfig(pgTables.wrappedSnapshots);

    for (const views of [sqliteViews, pgViews]) {
      const uniqueIndex = views.indexes.find(
        (item) => item.config.name === 'ux_wrapped_views_trip_user',
      );
      expect(uniqueIndex?.config.unique).toBe(true);
      expect(
        views.foreignKeys.map((item) => ({
          column: item.reference().columns[0]?.name,
          onDelete: item.onDelete,
        })),
      ).toEqual(
        expect.arrayContaining([
          { column: 'trip_id', onDelete: 'cascade' },
          { column: 'user_id', onDelete: 'cascade' },
        ]),
      );
      expect(views.columns.find((column) => column.name === 'view_count')?.default).toBe(0);
    }

    for (const snapshots of [sqliteSnapshots, pgSnapshots]) {
      const indexes = snapshots.indexes.map((item) => item.config);
      const personalIndex = indexes.find((item) => item.name === 'ux_wrapped_snapshots_personal');
      const squadIndex = indexes.find((item) => item.name === 'ux_wrapped_snapshots_squad');
      const latestIndex = indexes.find((item) => item.name === 'ix_wrapped_snapshots_latest');
      expect(personalIndex?.unique).toBe(true);
      expect(personalIndex?.where).toBeDefined();
      expect(squadIndex?.unique).toBe(true);
      expect(squadIndex?.where).toBeDefined();
      expect(latestIndex?.unique).toBe(false);
      expect(
        snapshots.foreignKeys.map((item) => ({
          column: item.reference().columns[0]?.name,
          onDelete: item.onDelete,
        })),
      ).toEqual(
        expect.arrayContaining([
          { column: 'trip_id', onDelete: 'cascade' },
          { column: 'user_id', onDelete: 'cascade' },
        ]),
      );
      expect(snapshots.columns.find((column) => column.name === 'payload')?.notNull).toBe(true);
      expect(snapshots.columns.find((column) => column.name === 'revision')?.default).toBe(1);
      expect(snapshots.columns.find((column) => column.name === 'source_revision')?.notNull).toBe(
        true,
      );
    }
  });

  it('declares the M9 ceremony singleton and bounds in both dialects', () => {
    const sqliteCeremony = getSqliteTableConfig(sqliteTables.ceremonyState);
    const pgCeremony = getPgTableConfig(pgTables.ceremonyState);
    for (const ceremony of [sqliteCeremony, pgCeremony]) {
      expect(
        ceremony.indexes.find((item) => item.config.name === 'ux_ceremony_state_trip')?.config
          .unique,
      ).toBe(true);
      expect(ceremony.checks.map((item) => item.name)).toEqual(
        expect.arrayContaining([
          'ck_ceremony_state_status',
          'ck_ceremony_state_card_index',
          'ck_ceremony_state_sub_step',
        ]),
      );
      expect(
        ceremony.foreignKeys.map((item) => ({
          column: item.reference().columns[0]?.name,
          onDelete: item.onDelete,
        })),
      ).toEqual(
        expect.arrayContaining([
          { column: 'trip_id', onDelete: 'cascade' },
          { column: 'started_by', onDelete: 'set null' },
        ]),
      );
    }
  });
});
