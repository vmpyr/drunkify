import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import {
  M2Service,
  type DatabaseContext,
  type MemberRecord,
  type TripRecord,
} from '../services/m2Service.js';
import { eventBus as defaultEventBus, tripChannel, type EventBus } from '../realtime/eventBus.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  sendError(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireSession(request, reply)) return false;
  if (request.auth!.user.role === 'admin') return true;
  sendError(reply, 403, 'forbidden', 'Admin access required');
  return false;
}

function phase(trip: TripRecord, now = Date.now()) {
  if (trip.ceremonyStartedAt !== null) return 'ceremony';
  if (now >= trip.unlockAt) return 'wrapped_unlocked';
  if (now >= trip.unlockAt - 24 * 60 * 60 * 1000) return 'final_24h';
  return 'live';
}

function toTrip(trip: TripRecord) {
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    timezone: trip.timezone,
    themeId: trip.themeId,
    unlockAt: trip.unlockAt,
    ownerId: trip.ownerId,
    ceremonyStartedAt: trip.ceremonyStartedAt,
    phase: phase(trip),
  };
}

function toMember(member: MemberRecord, request: FastifyRequest) {
  const canSeeEmail = request.auth?.user.role === 'admin' || request.auth?.userId === member.userId;
  return {
    userId: member.userId,
    name: member.name,
    colorIndex: member.colorIndex,
    joinedAt: member.joinedAt,
    isOwner: member.isOwner,
    isAdmin: member.role === 'admin',
    disabled: member.disabled,
    ...(canSeeEmail ? { email: member.email } : {}),
  };
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function registerM3Routes(
  app: FastifyInstance,
  options: { db: DatabaseContext; eventBus?: EventBus },
): void {
  const service = new M2Service(options.db);
  const bus = options.eventBus ?? defaultEventBus;

  app.post('/api/v1/trips', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        startDate: dateSchema,
        endDate: dateSchema,
        timezone: z.string().min(1).max(100),
        themeId: z.string().min(1).max(80),
        unlockAt: z.number().int().nonnegative(),
      })
      .safeParse(request.body);
    if (!parsed.success || parsed.data.startDate > parsed.data.endDate) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    if (!validTimezone(parsed.data.timezone)) {
      return sendError(reply, 422, 'validation_failed', 'Invalid timezone');
    }
    const trip = await service.createTrip({
      id: uuidv7(),
      ...parsed.data,
      ownerId: request.auth!.userId,
      now: Date.now(),
    });
    return { trip: toTrip(trip) };
  });

  app.get('/api/v1/trips', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const trips = await service.listTripsForUser(request.auth!.userId);
    return { trips: trips.map(toTrip) };
  });

  app.get('/api/v1/trips/:tripId', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    const trip = await service.getTrip(parsed.data.tripId);
    if (!trip) return sendError(reply, 404, 'not_found', 'Trip not found');
    if (!(await service.isTripMember(trip.id, request.auth!.userId))) {
      return sendError(reply, 403, 'forbidden', 'Trip membership required');
    }
    const members = await service.listTripMembers(trip.id);
    return {
      trip: toTrip(trip),
      members: members.map((member) => toMember(member, request)),
      serverTime: Date.now(),
    };
  });

  app.patch('/api/v1/trips/:tripId', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parameters = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        startDate: dateSchema.optional(),
        endDate: dateSchema.optional(),
        timezone: z.string().min(1).max(100).optional(),
        themeId: z.string().min(1).max(80).optional(),
        unlockAt: z.number().int().nonnegative().optional(),
      })
      .refine((value) => Object.values(value).some((item) => item !== undefined))
      .safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    if (body.data.timezone !== undefined && !validTimezone(body.data.timezone)) {
      return sendError(reply, 422, 'validation_failed', 'Invalid timezone');
    }
    const current = await service.getTrip(parameters.data.tripId);
    if (!current) return sendError(reply, 404, 'not_found', 'Trip not found');
    const startDate = body.data.startDate ?? current.startDate;
    const endDate = body.data.endDate ?? current.endDate;
    if (startDate > endDate) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.updateTrip(parameters.data.tripId, request.auth!.userId, {
      ...(body.data.name === undefined ? {} : { name: body.data.name }),
      ...(body.data.startDate === undefined ? {} : { startDate: body.data.startDate }),
      ...(body.data.endDate === undefined ? {} : { endDate: body.data.endDate }),
      ...(body.data.timezone === undefined ? {} : { timezone: body.data.timezone }),
      ...(body.data.themeId === undefined ? {} : { themeId: body.data.themeId }),
      ...(body.data.unlockAt === undefined ? {} : { unlockAt: body.data.unlockAt }),
      now: Date.now(),
    });
    if ('failure' in result) {
      if (result.failure === 'forbidden') {
        return sendError(reply, 403, 'forbidden', 'Trip owner required');
      }
      if (result.failure === 'ceremony_started') {
        return sendError(reply, 409, 'ceremony_started', 'Ceremony has started');
      }
      return sendError(reply, 404, 'not_found', 'Trip not found');
    }
    bus.publish(tripChannel(result.trip.id), {
      type: 'trip.updated',
      payload: toTrip(result.trip),
    });
    return { trip: toTrip(result.trip) };
  });

  app.get('/api/v1/trips/:tripId/members', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z.object({ tripId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return sendError(reply, 404, 'not_found', 'Trip not found');
    if (!(await service.isTripMember(parsed.data.tripId, request.auth!.userId))) {
      return sendError(reply, 404, 'not_found', 'Trip not found');
    }
    const members = await service.listTripMembers(parsed.data.tripId);
    return { members: members.map((member) => toMember(member, request)) };
  });

  app.post('/api/v1/people/:userId/trips', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parameters = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ tripId: z.string().uuid() }).safeParse(request.body);
    if (!parameters.success || !body.success) {
      return sendError(reply, 422, 'validation_failed', 'Validation failed');
    }
    const result = await service.addMemberToTrip(
      body.data.tripId,
      parameters.data.userId,
      Date.now(),
    );
    if ('failure' in result) {
      if (result.failure === 'ceremony_started') {
        return sendError(reply, 409, 'ceremony_started', 'Ceremony has started');
      }
      if (result.failure === 'conflict') {
        return sendError(reply, 409, 'conflict', 'User is already a member');
      }
      return sendError(reply, 404, 'not_found', 'Trip or user not found');
    }
    return { member: toMember(result.member, request) };
  });
}
