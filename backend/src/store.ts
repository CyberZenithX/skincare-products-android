// Small key-value store used for the listing cache, rate limits and layer counters.
// Production: Upstash Redis (added to the Vercel project from the Marketplace).
// Tests and local dev without Redis: in-memory.

import { Redis } from '@upstash/redis';

export interface Store {
  readonly kind: 'redis' | 'memory';
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Atomic increment; sets the TTL when the key is new. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class RedisStore implements Store {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: Redis) {}
  async getJson<T>(key: string) {
    return (await this.redis.get<T>(key)) ?? null;
  }
  async setJson(key: string, value: unknown, ttlSeconds: number) {
    await this.redis.set(key, value, { ex: ttlSeconds });
  }
  async incr(key: string, ttlSeconds: number) {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, ttlSeconds);
    return n;
  }
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private data = new Map<string, { v: string; exp: number }>();
  private live(key: string) {
    const e = this.data.get(key);
    if (e && e.exp < Date.now()) this.data.delete(key);
    return this.data.get(key);
  }
  async getJson<T>(key: string) {
    const e = this.live(key);
    return e ? (JSON.parse(e.v) as T) : null;
  }
  async setJson(key: string, value: unknown, ttlSeconds: number) {
    this.data.set(key, { v: JSON.stringify(value), exp: Date.now() + ttlSeconds * 1000 });
  }
  async incr(key: string, ttlSeconds: number) {
    const e = this.live(key);
    const n = (e ? Number(JSON.parse(e.v)) : 0) + 1;
    this.data.set(key, { v: String(n), exp: e?.exp ?? Date.now() + ttlSeconds * 1000 });
    return n;
  }
}

/**
 * Upstash's Vercel integration sets KV_REST_API_URL / KV_REST_API_TOKEN;
 * a direct Upstash setup uses UPSTASH_REDIS_REST_URL / _TOKEN. Accept both.
 */
export function storeFromEnv(e: NodeJS.ProcessEnv): Store {
  const url = e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN;
  if (url && token) return new RedisStore(new Redis({ url, token }));
  return new MemoryStore();
}
