import { describe, expect, it, vi } from 'vitest';

import {
  OUTBOX_CHANGED_EVENT,
  OUTBOX_SESSION_LOST_EVENT,
  enqueuePendingDrink,
  replayPendingDrinks,
} from './outbox.js';
import type {
  OutboxChangedDetail,
  OutboxRejection,
  OutboxSessionLostDetail,
  OutboxStore,
  PendingDrink,
  SyncTransport,
} from './types.js';

class MemoryStore implements OutboxStore {
  readonly operations = new Map<string, PendingDrink>();

  get(clientOpId: string): Promise<PendingDrink | undefined> {
    return Promise.resolve(this.operations.get(clientOpId));
  }

  put(operation: PendingDrink): Promise<void> {
    this.operations.set(operation.clientOpId, structuredClone(operation));
    return Promise.resolve();
  }

  delete(clientOpId: string): Promise<void> {
    this.operations.delete(clientOpId);
    return Promise.resolve();
  }

  list(): Promise<PendingDrink[]> {
    return Promise.resolve(
      Array.from(this.operations.values(), (operation) => structuredClone(operation)),
    );
  }
}

function operation(userId: string, clientOpId: string, clientNowMs: number): PendingDrink {
  return {
    clientOpId,
    tripId: '018f0000-0000-7000-8000-000000000001',
    type: 'create',
    drinkId: `018f0000-0000-7000-8000-${clientOpId.padStart(12, '0')}`,
    payload: { drinkName: 'Test' },
    clientNowMs,
    userId,
    attempts: 0,
  };
}

describe('offline outbox', () => {
  it('replays only operations owned by the currently signed-in account', async () => {
    const store = new MemoryStore();
    await store.put(operation('user-a', '1', 1));
    await store.put(operation('user-b', '2', 2));
    const sync = vi.fn<SyncTransport>().mockResolvedValue({ status: 'ok' });
    const eventTarget = new EventTarget();
    const changes: OutboxChangedDetail[] = [];
    eventTarget.addEventListener(OUTBOX_CHANGED_EVENT, (event) => {
      changes.push((event as CustomEvent<OutboxChangedDetail>).detail);
    });

    const result = await replayPendingDrinks({
      store,
      userId: 'user-a',
      sync,
      eventTarget,
    });

    expect(result).toEqual({ attempted: 1, synced: 1, remaining: 0, sessionLost: false });
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));
    expect((await store.list()).map(({ userId }) => userId)).toEqual(['user-b']);
    expect(changes).toEqual([{ userId: 'user-a', count: 0 }]);
  });

  it('retains identifiers and FIFO order when replay resumes after interruption', async () => {
    const store = new MemoryStore();
    await store.put(operation('user-a', '1', 1));
    await store.put(operation('user-a', '2', 2));
    const firstSync = vi
      .fn<SyncTransport>()
      .mockResolvedValueOnce({ status: 'ok' })
      .mockRejectedValueOnce(new TypeError('offline'));

    const interrupted = await replayPendingDrinks({
      store,
      userId: 'user-a',
      sync: firstSync,
    });
    const retained = await store.list();
    expect(interrupted).toEqual({
      attempted: 2,
      synced: 1,
      remaining: 1,
      sessionLost: false,
    });
    expect(retained[0]).toMatchObject({ clientOpId: '2', attempts: 1 });

    const resumedIds: string[] = [];
    const resumed = await replayPendingDrinks({
      store,
      userId: 'user-a',
      sync: (pending) => {
        resumedIds.push(pending.clientOpId);
        return Promise.resolve({ status: 'ok' });
      },
    });
    expect(resumedIds).toEqual(['2']);
    expect(resumed).toEqual({ attempted: 1, synced: 1, remaining: 0, sessionLost: false });
  });

  it('retains the queue and emits session lost when sync returns 401 semantics', async () => {
    const store = new MemoryStore();
    await store.put(operation('user-a', '1', 1));
    await store.put(operation('user-a', '2', 2));
    const eventTarget = new EventTarget();
    const details: OutboxSessionLostDetail[] = [];
    eventTarget.addEventListener(OUTBOX_SESSION_LOST_EVENT, (event) => {
      details.push((event as CustomEvent<OutboxSessionLostDetail>).detail);
    });

    const result = await replayPendingDrinks({
      store,
      userId: 'user-a',
      sync: () => Promise.resolve({ status: 'session-lost' }),
      eventTarget,
    });

    expect(result).toEqual({ attempted: 1, synced: 0, remaining: 2, sessionLost: true });
    expect(details).toEqual([{ userId: 'user-a' }]);
    expect(await store.list()).toHaveLength(2);
  });

  it('drops a definitively rejected op and continues with later queued work', async () => {
    const store = new MemoryStore();
    await store.put(operation('user-a', '1', 1));
    await store.put(operation('user-a', '2', 2));
    const rejected = vi.fn<(rejection: OutboxRejection) => void>();
    const sync = vi
      .fn<SyncTransport>()
      .mockResolvedValueOnce({
        status: 'error',
        error: { code: 'validation_failed', message: 'Invalid drink' },
      })
      .mockResolvedValueOnce({ status: 'ok' });

    const result = await replayPendingDrinks({
      store,
      userId: 'user-a',
      sync,
      onRejected: rejected,
    });

    expect(result).toEqual({ attempted: 2, synced: 1, remaining: 0, sessionLost: false });
    expect(rejected.mock.calls[0]?.[0].operation.clientOpId).toBe('1');
    expect(rejected.mock.calls[0]?.[0].error).toEqual({
      code: 'validation_failed',
      message: 'Invalid drink',
    });
  });

  it('mints a UUIDv7 op id distinct from the drink id and persists the same id', async () => {
    const store = new MemoryStore();
    const drinkId = '018f0000-0000-7000-8000-000000000099';

    const queued = await enqueuePendingDrink(
      {
        tripId: '018f0000-0000-7000-8000-000000000001',
        type: 'delete',
        drinkId,
        clientNowMs: 10,
        userId: 'user-a',
      },
      store,
    );

    expect(queued.clientOpId).not.toBe(drinkId);
    expect(queued.clientOpId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect((await store.list())[0]?.clientOpId).toBe(queued.clientOpId);
  });
});
