export const DEFAULT_RATE_LIMIT_ATTEMPTS = 5;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}

export type RateLimitResult =
  { allowed: true; retryAfter: 0 } | { allowed: false; retryAfter: number };

export class InMemoryRateLimiter {
  readonly limit: number;
  readonly windowMs: number;

  private readonly events = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limit ?? DEFAULT_RATE_LIMIT_ATTEMPTS;
    this.windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.now = options.now ?? Date.now;

    if (!Number.isInteger(this.limit) || this.limit < 1) {
      throw new RangeError('Rate limiter limit must be a positive integer');
    }
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new RangeError('Rate limiter windowMs must be positive');
    }
  }

  check(key: string, now = this.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.limit) {
      this.events.set(key, recent);
      const oldest = recent[0];
      if (oldest === undefined) throw new Error('Rate limiter state is inconsistent');
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    this.events.set(key, recent);
    return { allowed: true, retryAfter: 0 };
  }

  reset(key?: string): void {
    if (key === undefined) this.events.clear();
    else this.events.delete(key);
  }
}

export function createRateLimiter(options: RateLimiterOptions = {}): InMemoryRateLimiter {
  return new InMemoryRateLimiter(options);
}
