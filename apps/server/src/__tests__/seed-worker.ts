import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';

const sqlitePath = process.argv[2];
if (!sqlitePath) throw new Error('SQLite path is required');

const config = loadConfig({
  NODE_ENV: 'test',
  DB_DRIVER: 'sqlite',
  SQLITE_PATH: sqlitePath,
  ADMIN_EMAIL: 'ADMIN@EXAMPLE.COM',
  COOKIE_SECURE: 'false',
});
const db = createDb(config);
try {
  await seedAdminIfNeeded(db, config, console);
} finally {
  await db.close();
}
