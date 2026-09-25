import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { DRINK_CATEGORIES, M2Service, type DatabaseContext } from '../services/m2Service.js';

const parametersSchema = z.object({ tripId: z.string().uuid() });

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

export function registerM6Routes(app: FastifyInstance, options: { db: DatabaseContext }): void {
  const service = new M2Service(options.db);

  app.get('/api/v1/trips/:tripId/predictions/me', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const state = await service.getPredictionState(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if (!state) return sendError(reply, 404, 'not_found', 'Trip not found');
    return { ...state, serverTime: Date.now(), answers: null };
  });

  app.put('/api/v1/trips/:tripId/predictions/me', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    const body = z
      .object({
        myTotalStd: z.number().int().nonnegative(),
        groupTotalStd: z.number().int().nonnegative(),
        topMemberId: z.string().uuid(),
        leastMemberId: z.string().uuid(),
        topDrink: z.string().trim().min(1).max(120),
        topDrinkCategory: z.enum(DRINK_CATEGORIES),
      })
      .safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.submitPrediction({
      id: uuidv7(),
      tripId: parameters.data.tripId,
      userId: request.auth!.userId,
      answers: body.data,
      now: Date.now(),
    });
    if ('failure' in result) {
      if (result.failure === 'not_found') {
        return sendError(reply, 404, 'not_found', 'Trip not found');
      }
      if (result.failure === 'invalid_member') {
        return sendError(reply, 422, 'validation_failed', 'Selected member is not in this trip');
      }
      return sendError(
        reply,
        409,
        result.failure,
        result.failure === 'already_locked'
          ? 'Predictions are already locked'
          : 'Prediction window is closed',
      );
    }
    return {
      state: 'locked',
      deadlineAt: result.state.deadlineAt,
      serverTime: Date.now(),
    };
  });

  app.post('/api/v1/trips/:tripId/predictions/me/dismiss-missed', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    if (
      !(await service.dismissMissedPredictionBanner(parameters.data.tripId, request.auth!.userId))
    ) {
      return sendError(reply, 404, 'not_found', 'Trip not found');
    }
    return reply.code(204).send();
  });

  app.get('/api/v1/trips/:tripId/predictions/status', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    if (!(await service.isTripMember(parameters.data.tripId, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    const status = await service.getPredictionStatus(parameters.data.tripId);
    if (!status) return sendError(reply, 404, 'not_found', 'Trip not found');
    return status;
  });
}
