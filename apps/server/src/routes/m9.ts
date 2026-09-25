import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { eventBus as defaultEventBus, tripChannel, type EventBus } from '../realtime/eventBus.js';
import { M2Service, type CeremonyFailure, type DatabaseContext } from '../services/m2Service.js';

const parametersSchema = z.object({ tripId: z.string().uuid() });

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

function sendCeremonyFailure(reply: FastifyReply, failure: CeremonyFailure) {
  if (failure === 'forbidden') return sendError(reply, 403, 'forbidden', 'Trip owner required');
  if (failure === 'not_found') return sendError(reply, 404, 'not_found', 'Trip not found');
  return sendError(
    reply,
    409,
    failure,
    failure === 'already_started' ? 'Ceremony already started' : 'Ceremony has not started',
  );
}

export function registerM9Routes(
  app: FastifyInstance,
  options: { db: DatabaseContext; eventBus?: EventBus },
): void {
  const service = new M2Service(options.db);
  const bus = options.eventBus ?? defaultEventBus;

  app.get('/api/v1/trips/:tripId/wrapped/squad', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const result = await service.getSquadWrapped(parameters.data.tripId, request.auth!.userId);
    if (!result) return sendError(reply, 404, 'not_found', 'Trip not found');
    return result;
  });

  app.post('/api/v1/trips/:tripId/ceremony/start', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const result = await service.startCeremony(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if ('failure' in result) return sendCeremonyFailure(reply, result.failure);
    const channel = tripChannel(parameters.data.tripId);
    bus.publish(channel, { type: 'phase.changed', payload: { phase: 'ceremony' } });
    bus.publish(channel, { type: 'ceremony.started', payload: { ...result.state } });
    return result;
  });

  app.get('/api/v1/trips/:tripId/ceremony/state', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const state = await service.getCeremonyState(parameters.data.tripId, request.auth!.userId);
    if (!state) return sendError(reply, 404, 'not_found', 'Trip not found');
    return { state };
  });

  app.post('/api/v1/trips/:tripId/ceremony/advance', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    const body = z.object({ direction: z.enum(['next', 'back']) }).safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.advanceCeremony(
      parameters.data.tripId,
      request.auth!.userId,
      body.data.direction,
      Date.now(),
    );
    if ('failure' in result) return sendCeremonyFailure(reply, result.failure);
    if (result.changed) {
      bus.publish(tripChannel(parameters.data.tripId), {
        type: 'ceremony.step',
        payload: { ...result.state },
      });
    }
    return { state: result.state };
  });

  app.post('/api/v1/trips/:tripId/ceremony/hold', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    const body = z.object({ held: z.boolean() }).safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.holdCeremony(
      parameters.data.tripId,
      request.auth!.userId,
      body.data.held,
      Date.now(),
    );
    if ('failure' in result) return sendCeremonyFailure(reply, result.failure);
    if (result.changed) {
      bus.publish(tripChannel(parameters.data.tripId), {
        type: 'ceremony.step',
        payload: { ...result.state },
      });
    }
    return { state: result.state };
  });

  app.post('/api/v1/trips/:tripId/ceremony/restart', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const result = await service.restartCeremony(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if ('failure' in result) return sendCeremonyFailure(reply, result.failure);
    if (result.changed) {
      bus.publish(tripChannel(parameters.data.tripId), {
        type: 'ceremony.step',
        payload: { ...result.state },
      });
    }
    return { state: result.state };
  });
}
