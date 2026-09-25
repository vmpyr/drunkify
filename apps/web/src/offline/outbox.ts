import { IndexedDbOutboxStore } from './db.js';
import type {
  FlushResult,
  OutboxChangedDetail,
  OutboxRejection,
  OutboxSessionLostDetail,
  OutboxStore,
  PendingDrink,
  PendingDrinkInput,
  SyncError,
  SyncResult,
  SyncTransport,
} from './types.js';
import { createUuidV7 } from './uuidv7.js';

export const OUTBOX_CHANGED_EVENT = 'drunkify:outbox-changed';
export const OUTBOX_SESSION_LOST_EVENT = 'drunkify:outbox-session-lost';

const defaultStore = new IndexedDbOutboxStore();

interface EventDispatcher {
  dispatchEvent(event: Event): boolean;
}

export interface ReplayOptions {
  store: OutboxStore;
  userId: string;
  sync: SyncTransport;
  eventTarget?: EventDispatcher;
  onRejected?: (rejection: OutboxRejection) => void;
}

export interface InstallOutboxReplayOptions {
  getCurrentUserId: () => string | null;
  onRejected?: (rejection: OutboxRejection) => void;
}

export interface ReplayController {
  flush: () => Promise<FlushResult>;
  dispose: () => void;
}

function currentEventTarget(): EventDispatcher | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function customEvent<T>(type: string, detail: T): Event {
  return new CustomEvent<T>(type, { detail });
}

async function sortedForUser(store: OutboxStore, userId: string): Promise<PendingDrink[]> {
  return (await store.list())
    .filter((operation) => operation.userId === userId)
    .sort(
      (left, right) =>
        left.clientNowMs - right.clientNowMs || left.clientOpId.localeCompare(right.clientOpId),
    );
}

async function dispatchChanged(
  store: OutboxStore,
  userId: string,
  eventTarget = currentEventTarget(),
): Promise<void> {
  if (!eventTarget) return;
  const detail: OutboxChangedDetail = {
    userId,
    count: (await sortedForUser(store, userId)).length,
  };
  eventTarget.dispatchEvent(customEvent(OUTBOX_CHANGED_EVENT, detail));
}

function dispatchSessionLost(userId: string, eventTarget = currentEventTarget()): void {
  if (!eventTarget) return;
  const detail: OutboxSessionLostDetail = { userId };
  eventTarget.dispatchEvent(customEvent(OUTBOX_SESSION_LOST_EVENT, detail));
}

function sameOperation(left: PendingDrink, right: PendingDrink): boolean {
  return JSON.stringify({ ...left, attempts: 0 }) === JSON.stringify(right);
}

export async function enqueuePendingDrink(
  input: PendingDrinkInput,
  store: OutboxStore = defaultStore,
): Promise<PendingDrink> {
  const operation: PendingDrink = {
    clientOpId: input.clientOpId ?? createUuidV7(),
    tripId: input.tripId,
    type: input.type,
    drinkId: input.drinkId,
    ...(input.payload === undefined ? {} : { payload: input.payload }),
    clientNowMs: input.clientNowMs ?? Date.now(),
    userId: input.userId,
    attempts: 0,
  };
  if (operation.clientOpId === operation.drinkId) {
    throw new Error('clientOpId must differ from drinkId');
  }

  const existing = await store.get(operation.clientOpId);
  if (existing) {
    if (!sameOperation(existing, operation)) {
      throw new Error(`clientOpId ${operation.clientOpId} is already queued`);
    }
    return existing;
  }

  await store.put(operation);
  await dispatchChanged(store, operation.userId);
  return operation;
}

export async function removePendingDrink(
  clientOpId: string,
  store: OutboxStore = defaultStore,
): Promise<boolean> {
  const operation = await store.get(clientOpId);
  if (!operation) return false;
  await store.delete(clientOpId);
  await dispatchChanged(store, operation.userId);
  return true;
}

export async function listPendingDrinks(
  userId?: string,
  store: OutboxStore = defaultStore,
): Promise<PendingDrink[]> {
  const operations = await store.list();
  return operations
    .filter((operation) => userId === undefined || operation.userId === userId)
    .sort(
      (left, right) =>
        left.clientNowMs - right.clientNowMs || left.clientOpId.localeCompare(right.clientOpId),
    );
}

export async function countPendingDrinks(
  userId?: string,
  store: OutboxStore = defaultStore,
): Promise<number> {
  return (await listPendingDrinks(userId, store)).length;
}

export async function replayPendingDrinks(options: ReplayOptions): Promise<FlushResult> {
  const operations = await sortedForUser(options.store, options.userId);
  let attempted = 0;
  let synced = 0;
  let sessionLost = false;

  for (const queued of operations) {
    const operation = { ...queued, attempts: queued.attempts + 1 };
    await options.store.put(operation);
    attempted += 1;

    let result: SyncResult;
    try {
      result = await options.sync(operation);
    } catch {
      break;
    }

    if (result.status === 'session-lost') {
      sessionLost = true;
      dispatchSessionLost(options.userId, options.eventTarget);
      break;
    }
    if (result.status === 'error') {
      options.onRejected?.({ operation, error: result.error });
      await options.store.delete(operation.clientOpId);
      await dispatchChanged(options.store, options.userId, options.eventTarget);
      continue;
    }

    await options.store.delete(operation.clientOpId);
    synced += 1;
    await dispatchChanged(options.store, options.userId, options.eventTarget);
  }

  return {
    attempted,
    synced,
    remaining: (await sortedForUser(options.store, options.userId)).length,
    sessionLost,
  };
}

interface SyncResponse {
  results?: Array<{
    clientOpId?: string;
    status?: string;
    error?: Partial<SyncError>;
  }>;
}

async function syncWithServer(operation: PendingDrink): Promise<SyncResult> {
  const response = await fetch(
    `/api/v1/trips/${encodeURIComponent(operation.tripId)}/drinks/sync`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ops: [
          {
            clientOpId: operation.clientOpId,
            tripId: operation.tripId,
            type: operation.type,
            drinkId: operation.drinkId,
            ...(operation.payload === undefined ? {} : { payload: operation.payload }),
            clientNowMs: operation.clientNowMs,
            userId: operation.userId,
          },
        ],
      }),
    },
  );
  if (response.status === 401) return { status: 'session-lost' };
  if (response.status >= 500) {
    throw new Error(`Transient sync failure: ${response.status}`);
  }
  if (!response.ok) {
    return {
      status: 'error',
      error: {
        code: `http_${response.status}`,
        message: `Sync failed with status ${response.status}`,
      },
    };
  }

  const body = (await response.json()) as SyncResponse;
  const result = body.results?.[0];
  if (result?.clientOpId !== operation.clientOpId || result.status !== 'ok') {
    return {
      status: 'error',
      error: {
        code: result?.error?.code ?? 'invalid_sync_response',
        message: result?.error?.message ?? 'The server rejected the queued operation',
      },
    };
  }
  return { status: 'ok' };
}

export function installOutboxReplay(options: InstallOutboxReplayOptions): ReplayController {
  let disposed = false;
  let inFlight: Promise<FlushResult> | undefined;

  const flush = (): Promise<FlushResult> => {
    if (disposed) {
      return Promise.resolve({ attempted: 0, synced: 0, remaining: 0, sessionLost: false });
    }
    if (inFlight) return inFlight;
    const userId = options.getCurrentUserId();
    if (!userId) {
      return Promise.resolve({ attempted: 0, synced: 0, remaining: 0, sessionLost: false });
    }
    inFlight = replayPendingDrinks({
      store: defaultStore,
      userId,
      sync: syncWithServer,
      ...(options.onRejected ? { onRejected: options.onRejected } : {}),
    }).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const triggerFlush = (): void => {
    void flush();
  };
  const visibilityFlush = (): void => {
    if (document.visibilityState === 'visible') triggerFlush();
  };

  window.addEventListener('online', triggerFlush);
  window.addEventListener('focus', triggerFlush);
  document.addEventListener('visibilitychange', visibilityFlush);

  return {
    flush,
    dispose() {
      disposed = true;
      window.removeEventListener('online', triggerFlush);
      window.removeEventListener('focus', triggerFlush);
      document.removeEventListener('visibilitychange', visibilityFlush);
    },
  };
}
