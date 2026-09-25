import { EventEmitter } from 'node:events';

export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface RealtimeEnvelope extends RealtimeEvent {
  id: number;
}

export class EventBus {
  readonly #emitter = new EventEmitter();
  readonly #sequences = new Map<string, number>();

  createEnvelope(channel: string, event: RealtimeEvent): RealtimeEnvelope {
    const id = (this.#sequences.get(channel) ?? 0) + 1;
    this.#sequences.set(channel, id);
    return { id, ...event };
  }

  publish(channel: string, event: RealtimeEvent): RealtimeEnvelope {
    const envelope = this.createEnvelope(channel, event);
    this.#emitter.emit(channel, envelope);
    return envelope;
  }

  subscribe(channel: string, listener: (event: RealtimeEnvelope) => void): () => void {
    this.#emitter.on(channel, listener);
    return () => this.#emitter.off(channel, listener);
  }
}

export const eventBus = new EventBus();
export const tripChannel = (tripId: string) => `trip:${tripId}`;
export const meChannel = (userId: string) => `me:${userId}`;
export const adminChannel = 'admin';
