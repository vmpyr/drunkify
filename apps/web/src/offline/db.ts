import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import type { OutboxStore, PendingDrink } from './types.js';

const DATABASE_NAME = 'drunkify-offline';
const DATABASE_VERSION = 1;
const PENDING_DRINKS_STORE = 'pendingDrinks';

interface DrunkifyOfflineDatabase extends DBSchema {
  pendingDrinks: {
    key: string;
    value: PendingDrink;
    indexes: {
      byUser: string;
    };
  };
}

let databasePromise: Promise<IDBPDatabase<DrunkifyOfflineDatabase>> | undefined;

function getDatabase(): Promise<IDBPDatabase<DrunkifyOfflineDatabase>> {
  databasePromise ??= openDB<DrunkifyOfflineDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(PENDING_DRINKS_STORE)) {
        const store = database.createObjectStore(PENDING_DRINKS_STORE, {
          keyPath: 'clientOpId',
        });
        store.createIndex('byUser', 'userId');
      }
    },
  });
  return databasePromise;
}

export class IndexedDbOutboxStore implements OutboxStore {
  async get(clientOpId: string): Promise<PendingDrink | undefined> {
    return (await getDatabase()).get(PENDING_DRINKS_STORE, clientOpId);
  }

  async put(operation: PendingDrink): Promise<void> {
    await (await getDatabase()).put(PENDING_DRINKS_STORE, operation);
  }

  async delete(clientOpId: string): Promise<void> {
    await (await getDatabase()).delete(PENDING_DRINKS_STORE, clientOpId);
  }

  async list(): Promise<PendingDrink[]> {
    return (await getDatabase()).getAll(PENDING_DRINKS_STORE);
  }
}
