import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DB_DRIVER: 'postgres',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? 'admin@example.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'postgres-smoke-password',
});
const db = createDb(config);
try {
  await db.migrate();
  await seedAdminIfNeeded(db, config, console);
  await db.ping();
  console.log('Postgres migration and admin seed smoke passed');
} finally {
  await db.close();
}
