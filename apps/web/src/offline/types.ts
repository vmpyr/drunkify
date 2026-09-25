export type PendingDrinkType = 'create' | 'update' | 'delete' | 'rate';

export interface PendingDrink {
  clientOpId: string;
  tripId: string;
  type: PendingDrinkType;
  drinkId: string;
  payload?: unknown;
  clientNowMs: number;
  userId: string;
  attempts: number;
}

export interface PendingDrinkInput {
  clientOpId?: string;
  tripId: string;
  type: PendingDrinkType;
  drinkId: string;
  payload?: unknown;
  clientNowMs?: number;
  userId: string;
}

export interface OutboxStore {
  get(clientOpId: string): Promise<PendingDrink | undefined>;
  put(operation: PendingDrink): Promise<void>;
  delete(clientOpId: string): Promise<void>;
  list(): Promise<PendingDrink[]>;
}

export interface SyncError {
  code: string;
  message: string;
}

export type SyncResult =
  { status: 'ok' } | { status: 'error'; error: SyncError } | { status: 'session-lost' };

export type SyncTransport = (operation: PendingDrink) => Promise<SyncResult>;

export interface OutboxRejection {
  operation: PendingDrink;
  error: SyncError;
}

export interface FlushResult {
  attempted: number;
  synced: number;
  remaining: number;
  sessionLost: boolean;
}

export interface OutboxChangedDetail {
  userId: string;
  count: number;
}

export interface OutboxSessionLostDetail {
  userId: string;
}
