import { seedAdminIfNeeded } from './auth/adminSeed.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, type DatabaseContext } from './db/createDb.js';
import { M2Store } from './db/m2Store.js';
import { eventBus } from './realtime/eventBus.js';
import { startPhaseScheduler } from './scheduler/phaseScheduler.js';

let db: DatabaseContext | undefined;
let stopPhaseScheduler: (() => void) | undefined;
try {
  const config = loadConfig();
  const database = createDb(config);
  db = database;
  await database.migrate();
  const app = await createApp({ config, db: database, eventBus });
  await seedAdminIfNeeded(database, config, console);
  const store = new M2Store(database);
  const phaseScheduler = await startPhaseScheduler({ store, bus: eventBus, logger: app.log });
  stopPhaseScheduler = () => phaseScheduler.stop();
  const sessionCleanup = setInterval(() => {
    void store
      .cleanupSessions(Date.now())
      .catch((error: unknown) => app.log.warn({ error }, 'Session cleanup failed'));
  }, 15_000);
  sessionCleanup.unref();
  await app.listen({ host: config.HOST, port: config.PORT });

  const shutdown = async () => {
    clearInterval(sessionCleanup);
    phaseScheduler.stop();
    await app.close();
    await database.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
} catch (error) {
  stopPhaseScheduler?.();
  if (db) await db.close().catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
}
