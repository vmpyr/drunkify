import type { FastifyReply } from 'fastify';
import { v7 as uuidv7 } from 'uuid';

import type { Config } from '../config.js';
import type { DatabaseContext, SessionRecord } from '../db/createDb.js';
import { generateSessionToken, hashToken } from './tokens.js';

export const SESSION_DURATION_SECONDS = 90 * 24 * 60 * 60;
export const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;
export const SESSION_RENEWAL_THROTTLE_MS = 60 * 60 * 1000;

export interface IssuedSession {
  id: string;
  token: string;
  expiresAt: number;
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export async function issueSession(
  db: DatabaseContext,
  input: { userId: string; userAgent?: string; now?: number },
): Promise<IssuedSession> {
  const now = input.now ?? Date.now();
  const token = generateSessionToken();
  const session = { id: uuidv7(), token, expiresAt: now + SESSION_DURATION_MS };
  await db.insertSession({
    id: session.id,
    userId: input.userId,
    tokenHash: hashToken(token),
    now,
    expiresAt: session.expiresAt,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return session;
}

export async function verifySession(
  db: DatabaseContext,
  token: string | undefined,
  now = Date.now(),
): Promise<{ session: SessionRecord; renewed: boolean } | null> {
  if (!token) return null;
  const session = await db.findActiveSession(hashToken(token), now);
  if (!session) return null;

  const renewed = now - session.lastUsedAt > SESSION_RENEWAL_THROTTLE_MS;
  if (renewed) {
    session.lastUsedAt = now;
    session.expiresAt = now + SESSION_DURATION_MS;
    await db.renewSession(session.id, session.lastUsedAt, session.expiresAt);
  }
  return { session, renewed };
}
