import { seedAdminIfNeeded } from './auth/adminSeed.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, type DatabaseContext } from './db/createDb.js';

let db: DatabaseContext | undefined;
try {
  const config = loadConfig();
  const database = createDb(config);
  db = database;
  await database.migrate();
  const app = await createApp({ config, db: database });
  await seedAdminIfNeeded(database, config, console);
  await app.listen({ host: config.HOST, port: config.PORT });

  const shutdown = async () => {
    await app.close();
    await database.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  if (db) await db.close().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
}
