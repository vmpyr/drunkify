import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { hashPassword, verifyPassword } from '../auth/password.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { InMemoryRateLimiter } from '../auth/rateLimiter.js';
import { issueSession, setSessionCookie } from '../auth/session.js';
import { generateSessionToken, hashToken } from '../auth/tokens.js';
import type { Config } from '../config.js';
import {
  createDynamicTransportFactory,
  createMailer,
  forgotPassword,
  invite as inviteTemplate,
  type Mailer,
} from '../mailer/index.js';
import {
  M2Service,
  type DatabaseContext,
  type InviteRecord,
  type TokenFailure,
  type UserRecord,
} from '../services/m2Service.js';

const emailSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(1).max(128);
const nameSchema = z.string().trim().min(1).max(24);
const tokenSchema = z.string().min(16).max(512);

const signInLimiter = new InMemoryRateLimiter();
const forgotLimiter = new InMemoryRateLimiter();
const tokenLimiter = new InMemoryRateLimiter({ limit: 20 });
const inviteCreateLimiter = new InMemoryRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });

function errorReply(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return reply.code(status).send({ error: { code, message, ...extra } });
}

function validationError(reply: FastifyReply, fields?: Record<string, string>) {
  return errorReply(reply, 422, 'validation_failed', 'Validation failed', fields ? { fields } : {});
}

function toUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    displayThemePref: user.displayThemePref,
    disabledAt: user.disabledAt,
  };
}

function inviteState(invite: InviteRecord, now = Date.now()) {
  return invite.state === 'pending' && invite.expiresAt <= now ? 'expired' : invite.state;
}

function toInvite(invite: InviteRecord) {
  return {
    id: invite.id,
    name: invite.name,
    email: invite.email,
    tripId: invite.tripId,
    tripName: invite.tripName,
    state: inviteState(invite),
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedBy: invite.acceptedBy,
    acceptedAt: invite.acceptedAt,
  };
}

function tokenFailure(reply: FastifyReply, failure: TokenFailure) {
  if (failure === 'invalid') return errorReply(reply, 404, 'invalid_token', 'Invalid token');
  if (failure === 'expired') return errorReply(reply, 410, 'token_expired', 'Token expired');
  if (failure === 'revoked') return errorReply(reply, 410, 'token_revoked', 'Token revoked');
  return errorReply(reply, 410, 'token_used', 'Token already used');
}

function requireSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth) return true;
  errorReply(reply, 401, 'unauthenticated', 'Authentication required');
  return false;
}

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireSession(request, reply)) return false;
  if (request.auth?.user.role === 'admin') return true;
  errorReply(reply, 403, 'forbidden', 'Admin access required');
  return false;
}

function baseUrl(config: Config): string {
  return (config.PUBLIC_URL ?? `http://localhost:${config.PORT}`).replace(/\/$/, '');
}

function requestIp(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function rateLimited(
  reply: FastifyReply,
  results: Array<{ allowed: boolean; retryAfter: number }>,
): boolean {
  const blocked = results.find((result) => !result.allowed);
  if (!blocked) return false;
  errorReply(reply, 429, 'rate_limited', 'Too many requests', {
    retryAfter: blocked.retryAfter,
  });
  return true;
}

function checkPassword(reply: FastifyReply, password: string): boolean {
  const problem = validatePassword(password);
  if (!problem) return true;
  if (problem === 'common') {
    errorReply(reply, 422, 'common_password', 'Choose a less common password');
  } else {
    validationError(reply, { password: problem });
  }
  return false;
}

function sendBestEffort(
  app: FastifyInstance,
  mailer: Mailer,
  message: Parameters<Mailer['send']>[0],
): void {
  void mailer.send(message).catch((error: unknown) => {
    app.log.warn({ event: 'mail_send_failed', error }, 'Mail send failed');
  });
}

export function registerM2Routes(
  app: FastifyInstance,
  options: { config: Config; db: DatabaseContext; mailer?: Mailer },
): void {
  const store = new M2Service(options.db);
  const mailer =
    options.mailer ??
    createMailer(
      options.config,
      options.config.MAILER === 'smtp'
        ? { transportFactory: createDynamicTransportFactory(() => import('nodemailer')) }
        : {},
    );

  app.post('/api/v1/auth/sign-in', async (request, reply) => {
    const parsed = z
      .object({ email: emailSchema, password: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    const user = await store.findUserByEmail(parsed.data.email);
    const passwordMatches = user
      ? await verifyPassword(user.passwordHash, parsed.data.password)
      : false;
    if (!user || !passwordMatches) {
      const results = [
        signInLimiter.check(`signin:email:${parsed.data.email}`),
        signInLimiter.check(`signin:ip:${requestIp(request)}`),
      ];
      if (rateLimited(reply, results)) return;
      return errorReply(reply, 401, 'bad_credentials', 'Email or password is incorrect');
    }
    if (user.disabledAt !== null) {
      return errorReply(reply, 403, 'account_disabled', 'Account access has been removed');
    }
    const session = await issueSession(options.db, {
      userId: user.id,
      ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    });
    setSessionCookie(reply, options.config, session.token);
    return { user: toUser(user) };
  });

  app.post('/api/v1/auth/sign-out', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    await store.revokeSession(request.auth!.id, Date.now());
    reply.clearCookie(options.config.SESSION_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/finish-setup', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    if (!request.auth!.user.mustChangePassword) {
      return errorReply(reply, 409, 'conflict', 'Initial setup is already complete');
    }
    const parsed = z
      .object({ name: nameSchema, email: emailSchema, newPassword: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    if (!checkPassword(reply, parsed.data.newPassword)) return;
    const current = await store.findUserById(request.auth!.userId);
    if (current && (await verifyPassword(current.passwordHash, parsed.data.newPassword))) {
      return errorReply(reply, 422, 'same_password', 'Choose a different password');
    }
    const result = await store.finishSetup({
      userId: request.auth!.userId,
      displayName: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.newPassword),
      now: Date.now(),
    });
    if (result === 'email_taken') {
      return errorReply(reply, 409, 'email_taken', 'Email is already in use');
    }
    return { user: toUser((await store.findUserById(request.auth!.userId))!) };
  });

  app.post('/api/v1/auth/forgot-password', async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(204).send();
    const results = [
      forgotLimiter.check(`forgot:email:${parsed.data.email}`),
      forgotLimiter.check(`forgot:ip:${requestIp(request)}`),
    ];
    if (results.some((result) => !result.allowed)) return reply.code(204).send();
    const user = await store.findUserByEmail(parsed.data.email);
    if (user && user.disabledAt === null) {
      const token = generateSessionToken();
      await store.createReset({
        id: uuidv7(),
        userId: user.id,
        tokenHash: hashToken(token),
        createdBy: null,
        now: Date.now(),
      });
      sendBestEffort(app, mailer, {
        to: user.email,
        ...forgotPassword(`${baseUrl(options.config)}/r/${token}`),
      });
    }
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/reset-password/:token', async (request, reply) => {
    if (rateLimited(reply, [tokenLimiter.check(`token:ip:${requestIp(request)}`)])) return;
    const parsed = z.object({ token: tokenSchema }).safeParse(request.params);
    if (!parsed.success) return { kind: 'invalid' };
    const reset = await store.lookupReset(hashToken(parsed.data.token));
    if (!reset) return { kind: 'invalid' };
    if (reset.usedAt !== null) return { kind: 'used' };
    if (reset.expiresAt <= Date.now()) return { kind: 'resetExpired' };
    return { email: reset.email };
  });

  app.post('/api/v1/auth/reset-password', async (request, reply) => {
    const parsed = z
      .object({ token: tokenSchema, newPassword: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    if (!checkPassword(reply, parsed.data.newPassword)) return;
    const result = await store.consumeReset({
      tokenHash: hashToken(parsed.data.token),
      passwordHash: await hashPassword(parsed.data.newPassword),
      now: Date.now(),
    });
    if ('failure' in result) return tokenFailure(reply, result.failure);
    const session = await issueSession(options.db, {
      userId: result.user.id,
      ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    });
    setSessionCookie(reply, options.config, session.token);
    return { user: toUser(result.user) };
  });

  app.post('/api/v1/auth/change-password', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z
      .object({ currentPassword: passwordSchema, newPassword: passwordSchema })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    const user = await store.findUserById(request.auth!.userId);
    if (!user || !(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return errorReply(reply, 401, 'bad_credentials', 'Current password is incorrect');
    }
    if (!checkPassword(reply, parsed.data.newPassword)) return;
    const now = Date.now();
    await store.updatePassword(user.id, await hashPassword(parsed.data.newPassword), now);
    await store.revokeSessions(user.id, now, request.auth!.id);
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/change-email', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z
      .object({ currentPassword: passwordSchema, newEmail: emailSchema })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    const user = await store.findUserById(request.auth!.userId);
    if (!user || !(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return errorReply(reply, 401, 'bad_credentials', 'Current password is incorrect');
    }
    const result = await store.updateEmail(user.id, parsed.data.newEmail, Date.now());
    if (result === 'email_taken') {
      return errorReply(reply, 409, 'email_taken', 'Email is already in use');
    }
    return { user: toUser((await store.findUserById(user.id))!) };
  });

  app.get('/api/v1/me', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    return { user: toUser((await store.findUserById(request.auth!.userId))!) };
  });

  app.patch('/api/v1/me', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z
      .object({
        name: nameSchema.optional(),
        displayThemePref: z.enum(['system', 'dark', 'light']).optional(),
      })
      .refine((value) => value.name !== undefined || value.displayThemePref !== undefined)
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    const user = await store.updateProfile(request.auth!.userId, {
      ...(parsed.data.name !== undefined ? { displayName: parsed.data.name } : {}),
      ...(parsed.data.displayThemePref !== undefined
        ? { displayThemePref: parsed.data.displayThemePref }
        : {}),
      now: Date.now(),
    });
    return { user: toUser(user!) };
  });

  app.post('/api/v1/invites', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    if (rateLimited(reply, [inviteCreateLimiter.check(`invite_create:${request.auth!.userId}`)])) {
      return;
    }
    const parsed = z
      .object({
        name: nameSchema.optional(),
        email: emailSchema.optional(),
        tripId: z.string().uuid().optional(),
        sendEmail: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    if (parsed.data.sendEmail && !parsed.data.email) {
      return validationError(reply, { email: 'required' });
    }
    const token = generateSessionToken();
    let invite: InviteRecord;
    try {
      invite = await store.createInvite({
        id: uuidv7(),
        tokenHash: hashToken(token),
        createdBy: request.auth!.userId,
        name: parsed.data.name ?? null,
        email: parsed.data.email ?? null,
        tripId: parsed.data.tripId ?? null,
        now: Date.now(),
      });
    } catch (error) {
      if (String(error).toLowerCase().includes('foreign key')) {
        return errorReply(reply, 404, 'not_found', 'Trip not found');
      }
      throw error;
    }
    const url = `${baseUrl(options.config)}/i/${token}`;
    if (parsed.data.sendEmail && invite.email) {
      sendBestEffort(app, mailer, {
        to: invite.email,
        ...inviteTemplate({
          inviter: invite.inviterName,
          ...(invite.name ? { name: invite.name } : {}),
          ...(invite.tripName ? { trip: invite.tripName } : {}),
          link: url,
          expires: new Date(invite.expiresAt).toISOString().slice(0, 10),
        }),
      });
    }
    return { invite: toInvite(invite), url };
  });

  app.get('/api/v1/invites', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const query = z
      .object({ state: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional() })
      .safeParse(request.query);
    if (!query.success) return validationError(reply);
    const items = await store.listInvites(Date.now(), query.data.state);
    return { items: items.map(toInvite), nextCursor: null };
  });

  app.post('/api/v1/invites/:id/reissue', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return validationError(reply);
    const token = generateSessionToken();
    const result = await store.reissueInvite(parsed.data.id, hashToken(token), Date.now());
    if (result === 'not_found') return errorReply(reply, 404, 'not_found', 'Invite not found');
    if (result === 'conflict') return errorReply(reply, 409, 'conflict', 'Invite was accepted');
    return {
      invite: toInvite((await store.getInviteById(parsed.data.id))!),
      url: `${baseUrl(options.config)}/i/${token}`,
    };
  });

  app.post('/api/v1/invites/:id/revoke', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return validationError(reply);
    const result = await store.revokeInvite(parsed.data.id);
    if (result === 'not_found') return errorReply(reply, 404, 'not_found', 'Invite not found');
    if (result === 'conflict') return errorReply(reply, 409, 'conflict', 'Invite was accepted');
    return { invite: toInvite((await store.getInviteById(parsed.data.id))!) };
  });

  app.get('/api/v1/invites/lookup/:token', async (request, reply) => {
    if (rateLimited(reply, [tokenLimiter.check(`token:ip:${requestIp(request)}`)])) return;
    const parsed = z.object({ token: tokenSchema }).safeParse(request.params);
    if (!parsed.success) return { kind: 'invalid' };
    const invite = await store.lookupInvite(hashToken(parsed.data.token));
    if (!invite) return { kind: 'invalid' };
    const state = inviteState(invite);
    if (state === 'expired') return { kind: 'expired', inviterName: invite.inviterName };
    if (state === 'accepted') return { kind: 'used', inviterName: invite.inviterName };
    if (state === 'revoked') return { kind: 'revoked', inviterName: invite.inviterName };
    return {
      invite: {
        name: invite.name,
        tripName: invite.tripName,
        tripDates: null,
        memberCount: null,
        inviterName: invite.inviterName,
      },
    };
  });

  app.post('/api/v1/invites/accept', async (request, reply) => {
    const parsed = z
      .object({
        token: tokenSchema,
        name: nameSchema,
        email: emailSchema,
        password: passwordSchema,
      })
      .safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    if (!checkPassword(reply, parsed.data.password)) return;
    const result = await store.acceptInviteNewUser({
      tokenHash: hashToken(parsed.data.token),
      userId: uuidv7(),
      email: parsed.data.email,
      displayName: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      now: Date.now(),
    });
    if ('failure' in result) {
      if (result.failure === 'email_taken') {
        return errorReply(reply, 409, 'email_taken', 'Email is already in use');
      }
      return tokenFailure(reply, result.failure);
    }
    const session = await issueSession(options.db, {
      userId: result.user.id,
      ...(request.headers['user-agent'] ? { userAgent: request.headers['user-agent'] } : {}),
    });
    setSessionCookie(reply, options.config, session.token);
    return { user: toUser(result.user), trip: result.tripId ? { id: result.tripId } : null };
  });

  app.post('/api/v1/invites/accept-as-member', async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const parsed = z.object({ token: tokenSchema }).safeParse(request.body);
    if (!parsed.success) return validationError(reply);
    const result = await store.acceptInviteAsMember({
      tokenHash: hashToken(parsed.data.token),
      userId: request.auth!.userId,
      now: Date.now(),
    });
    if ('failure' in result) return tokenFailure(reply, result.failure);
    return { trip: result.tripId ? { id: result.tripId } : null, consumed: result.consumed };
  });

  app.get('/api/v1/people', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const people = await store.listPeople();
    return { items: people.map((user) => ({ ...toUser(user), trips: [] })), nextCursor: null };
  });

  app.get('/api/v1/people/:userId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return validationError(reply);
    const user = await store.findUserById(parsed.data.userId);
    if (!user) return errorReply(reply, 404, 'not_found', 'User not found');
    return { user: toUser(user), trips: [], invitedBy: null, joinedAt: user.createdAt };
  });

  app.post('/api/v1/people/:userId/reset-link', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return validationError(reply);
    const user = await store.findUserById(parsed.data.userId);
    if (!user) return errorReply(reply, 404, 'not_found', 'User not found');
    if (user.disabledAt !== null) {
      return errorReply(reply, 409, 'conflict', 'Disabled users cannot reset passwords');
    }
    const token = generateSessionToken();
    await store.createReset({
      id: uuidv7(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdBy: request.auth!.userId,
      now: Date.now(),
    });
    return { url: `${baseUrl(options.config)}/r/${token}` };
  });

  app.delete('/api/v1/people/:userId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return validationError(reply);
    const result = await store.removeUser(parsed.data.userId, Date.now());
    if (result === 'not_found') return errorReply(reply, 404, 'not_found', 'User not found');
    if (result === 'forbidden') {
      return errorReply(reply, 403, 'cannot_remove_admin', 'The admin cannot be removed');
    }
    return reply.code(204).send();
  });
}
