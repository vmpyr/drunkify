import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { M2Service, type DatabaseContext } from '../services/m2Service.js';

const parametersSchema = z.object({ tripId: z.string().uuid() });

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

export function registerM8Routes(app: FastifyInstance, options: { db: DatabaseContext }): void {
  const service = new M2Service(options.db);

  app.get('/api/v1/trips/:tripId/wrapped/status', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const status = await service.getWrappedStatus(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if (!status) return sendError(reply, 404, 'not_found', 'Trip not found');
    return status;
  });

  app.get('/api/v1/trips/:tripId/wrapped/personal', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const result = await service.getPersonalWrapped(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if (!result) return sendError(reply, 404, 'not_found', 'Trip not found');
    return result;
  });

  app.post('/api/v1/trips/:tripId/wrapped/personal/watched', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = parametersSchema.safeParse(request.params);
    if (!parameters.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const marked = await service.markPersonalWrappedWatched(
      parameters.data.tripId,
      request.auth!.userId,
      Date.now(),
    );
    if (!marked) return sendError(reply, 404, 'not_found', 'Trip not found');
    return reply.code(204).send();
  });
}
