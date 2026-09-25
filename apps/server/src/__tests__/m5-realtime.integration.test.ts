import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { seedAdminIfNeeded } from '../auth/adminSeed.js';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/createDb.js';
import { M2Store } from '../db/m2Store.js';
import { EventBus, tripChannel } from '../realtime/eventBus.js';
import { runPhaseTransitionPass } from '../scheduler/phaseScheduler.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'drunkify-m5-realtime-'));
  tempDirs.push(directory);
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_DRIVER: 'sqlite',
    SQLITE_PATH: join(directory, 'drunkify.db'),
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD: 'CorrectHorseBattery7',
    PUBLIC_URL: 'https://drunkify.test',
    LOG_LEVEL: 'silent',
  });
  const db = createDb(config);
  await db.migrate();
  await seedAdminIfNeeded(db, config, { info() {} });
  const bus = new EventBus();
  const app = await createApp({ config, db, eventBus: bus, sseHeartbeatIntervalMs: 10 });
  const signIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { 'x-requested-with': 'drunkify' },
    payload: { email: 'admin@example.com', password: 'CorrectHorseBattery7' },
  });
  const cookie = firstHeader(signIn.headers['set-cookie']).split(';')[0]!;
  return { app, bus, cookie, db };
}

async function createTrip(
  app: Awaited<ReturnType<typeof createApp>>,
  cookie: string,
  unlockAt: number,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/trips',
    headers: { cookie, 'x-requested-with': 'drunkify' },
    payload: {
      name: 'M5 Trip',
      startDate: '2026-09-20',
      endDate: '2026-09-25',
      timezone: 'Etc/UTC',
      themeId: 'classic',
      unlockAt,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ trip: { id: string } }>().trip.id;
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  condition: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const timeoutAt = Date.now() + 1_000;
  while (!condition(text)) {
    if (Date.now() > timeoutAt) throw new Error(`Timed out reading SSE stream: ${text}`);
    const result = await reader.read();
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

describe('M5 realtime', () => {
  it('publishes monotonic channel events and unsubscribes without retaining replay data', () => {
    const bus = new EventBus();
    const received: number[] = [];
    const unsubscribe = bus.subscribe('trip:test', (event) => received.push(event.id));
    expect(bus.publish('trip:test', { type: 'one', payload: {} }).id).toBe(1);
    expect(bus.publish('trip:test', { type: 'two', payload: {} }).id).toBe(2);
    unsubscribe();
    bus.publish('trip:test', { type: 'three', payload: {} });
    expect(received).toEqual([1, 2]);
  });

  it('authenticates all three streams and sends hello before 20s-compatible heartbeats', async () => {
    const { app, bus, cookie, db } = await fixture();
    const tripId = await createTrip(app, cookie, Date.now() + 48 * 60 * 60 * 1000);

    for (const path of [
      `/api/v1/trips/${tripId}/events`,
      '/api/v1/me/events',
      '/api/v1/admin/events',
    ]) {
      const denied = await app.inject({ method: 'GET', url: path });
      expect(denied.statusCode).toBe(401);
    }

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    bus.publish(tripChannel(tripId), { type: 'drink.created', payload: { id: 'before' } });
    for (const path of [
      `/api/v1/trips/${tripId}/events`,
      '/api/v1/me/events',
      '/api/v1/admin/events',
    ]) {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { cookie, 'last-event-id': '1' },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('x-accel-buffering')).toBe('no');
      const reader = response.body!.getReader();
      const text = await readStreamUntil(reader, (value) => value.includes(':hb\n\n'));
      expect(text).toContain('event: hello');
      expect(text).toContain('"serverTime":');
      expect(text.indexOf('event: hello')).toBeLessThan(text.indexOf(':hb'));
      expect(text).not.toContain('"before"');
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }

    await app.close();
    await db.close();
  });

  it('publishes claimed phase transitions once and in lifecycle order', async () => {
    const { app, bus, cookie, db } = await fixture();
    const now = Date.now();
    const tripId = await createTrip(app, cookie, now - 1_000);
    const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const unsubscribe = bus.subscribe(tripChannel(tripId), ({ type, payload }) => {
      received.push({ type, payload });
    });

    const store = new M2Store(db);
    await runPhaseTransitionPass(store, bus, now);
    expect(received).toEqual([
      { type: 'phase.changed', payload: { phase: 'final_24h' } },
      { type: 'phase.changed', payload: { phase: 'wrapped_unlocked' } },
      { type: 'wrapped.unlocked', payload: {} },
    ]);

    await runPhaseTransitionPass(store, bus, now + 15_000);
    expect(received).toHaveLength(3);
    unsubscribe();
    await app.close();
    await db.close();
  });
});
