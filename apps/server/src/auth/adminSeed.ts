import { v7 as uuidv7 } from 'uuid';

import type { Config } from '../config.js';
import type { DatabaseContext } from '../db/createDb.js';

export interface SeedLogger {
  info(message: string): void;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function seedAdminIfNeeded(
  db: DatabaseContext,
  config: Config,
  logger: SeedLogger,
  now = Date.now(),
): Promise<boolean> {
  if (!config.ADMIN_EMAIL) return false;
  if ((await db.countUsers()) > 0) return false;
  const result = await db.seedAdmin({
    id: uuidv7(),
    email: normalizeEmail(config.ADMIN_EMAIL),
    now,
    ...(config.ADMIN_PASSWORD ? { password: config.ADMIN_PASSWORD } : {}),
  });

  if (result.generatedPassword) {
    // Intentional redaction exception: this one-time bootstrap credential is unrecoverable.
    logger.info(
      `[SEED] one-time admin password (shown once, will not be logged again): ${result.generatedPassword}`,
    );
  }
  return result.created;
}
