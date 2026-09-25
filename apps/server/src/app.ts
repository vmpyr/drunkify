import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { healthResponseSchema } from '@drunkify/shared';

export function createApp(): FastifyInstance {
  const app = Fastify({
    logger: true,
  });

  app.get('/healthz', () => healthResponseSchema.parse({ status: 'ok' }));

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
