import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { M2Store } from '../db/m2Store.js';
import type { DatabaseContext } from '../db/createDb.js';
import {
  adminChannel,
  type EventBus,
  meChannel,
  type RealtimeEnvelope,
  tripChannel,
} from './eventBus.js';

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

interface RealtimeRouteOptions {
  db: DatabaseContext;
  eventBus: EventBus;
  heartbeatIntervalMs?: number | undefined;
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

function formatEvent(event: RealtimeEnvelope): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

function openStream(
  request: FastifyRequest,
  reply: FastifyReply,
  bus: EventBus,
  channel: string,
  heartbeatIntervalMs: number,
): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.flushHeaders();

  const write = (value: string) => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(value);
  };
  write(
    formatEvent(
      bus.createEnvelope(channel, {
        type: 'hello',
        payload: { serverTime: Date.now() },
      }),
    ),
  );

  const unsubscribe = bus.subscribe(channel, (event) => write(formatEvent(event)));
  const heartbeat = setInterval(() => write(':hb\n\n'), heartbeatIntervalMs);
  heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.raw.once('close', cleanup);
  reply.raw.once('close', cleanup);
  reply.raw.once('error', cleanup);
}

export function registerRealtimeRoutes(app: FastifyInstance, options: RealtimeRouteOptions): void {
  const store = new M2Store(options.db);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  app.get('/api/v1/trips/:tripId/events', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    if (!(await store.isTripMember(parameters.data.tripId, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    openStream(
      request,
      reply,
      options.eventBus,
      tripChannel(parameters.data.tripId),
      heartbeatIntervalMs,
    );
  });

  app.get('/api/v1/me/events', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    openStream(
      request,
      reply,
      options.eventBus,
      meChannel(request.auth!.userId),
      heartbeatIntervalMs,
    );
  });

  app.get('/api/v1/admin/events', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    if (request.auth!.user.role !== 'admin') {
      return sendError(reply, 403, 'forbidden', 'Admin access required');
    }
    openStream(request, reply, options.eventBus, adminChannel, heartbeatIntervalMs);
  });
}
