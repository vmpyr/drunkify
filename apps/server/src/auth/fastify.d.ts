import type { SessionRecord } from '../db/createDb.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionRecord | null;
  }
}
