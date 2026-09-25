import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';

import { healthResponseSchema, readinessResponseSchema } from '@drunkify/shared';

import { setSessionCookie, verifySession } from './auth/session.js';
import type { Config } from './config.js';
import { SCHEMA_VERSION, type DatabaseContext } from './db/createDb.js';
import { registerM2Routes } from './routes/m2.js';
import { registerM3Routes } from './routes/m3.js';
import { registerM4Routes } from './routes/m4.js';
import { registerM5Routes } from './routes/m5.js';
import { registerM6Routes } from './routes/m6.js';
import { registerM8Routes } from './routes/m8.js';
import { registerM9Routes } from './routes/m9.js';
import { eventBus as defaultEventBus } from './realtime/eventBus.js';
import type { EventBus } from './realtime/eventBus.js';
import { registerRealtimeRoutes } from './realtime/sse.js';

export interface AppOptions {
  config: Config;
  db: DatabaseContext;
  startedAt?: number;
  eventBus?: EventBus;
  sseHeartbeatIntervalMs?: number;
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const startedAt = options.startedAt ?? Date.now();
  const app = Fastify({
    logger: { level: options.config.LOG_LEVEL },
    trustProxy: options.config.TRUST_PROXY,
    logController: new LogController({ disableRequestLogging: true }),
  });

  await app.register(fastifyCookie);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const requestedWith = request.headers['x-requested-with'];
      const origin = request.headers.origin;
      const expectedOrigin = options.config.PUBLIC_URL
        ? new URL(options.config.PUBLIC_URL).origin
        : undefined;
      if (
        requestedWith !== 'drunkify' ||
        (origin !== undefined && expectedOrigin !== undefined && origin !== expectedOrigin)
      ) {
        return reply
          .code(400)
          .send({ error: { code: 'bad_request', message: 'Invalid request origin' } });
      }
    }
    const token = request.cookies[options.config.SESSION_COOKIE_NAME];
    const auth = await verifySession(options.db, token);
    request.auth = auth?.session ?? null;
    if (auth?.renewed && token) setSessionCookie(reply, options.config, token);
  });

  registerM2Routes(app, options);
  registerM3Routes(app, options);
  registerM4Routes(app, options);
  registerM5Routes(app, options);
  registerM6Routes(app, options);
  registerM8Routes(app, options);
  registerM9Routes(app, options);
  registerRealtimeRoutes(app, {
    db: options.db,
    eventBus: options.eventBus ?? defaultEventBus,
    heartbeatIntervalMs: options.sseHeartbeatIntervalMs,
  });

  app.get('/healthz', () => healthResponseSchema.parse({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    const response = {
      schemaVersion: SCHEMA_VERSION,
      uptimeSec: Math.max(0, (Date.now() - startedAt) / 1000),
    };
    try {
      await options.db.ping();
      const schemaVersion = await options.db.getSchemaVersion();
      return readinessResponseSchema.parse({ ...response, status: 'ok', schemaVersion });
    } catch {
      return reply
        .code(503)
        .send(readinessResponseSchema.parse({ ...response, status: 'not_ready' }));
    }
  });

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
  if (existsSync(join(publicDir, 'index.html'))) {
    void app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
