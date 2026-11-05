export interface RateLimitResult {
  allowed: boolean;
  current: number;
  remaining: number;
  resetInMs: number;
}

export interface RateLimitStore {
  incrementAndCheck(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult>;
}

export interface EvalRedisClient {
  eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly nowFn: () => number = () => Date.now()) {}

  async incrementAndCheck(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const now = this.nowFn();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      bucket = { count: 0, expiresAt: now + windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= limit;
    const remaining = Math.max(0, limit - bucket.count);
    const resetInMs = Math.max(0, bucket.expiresAt - now);

    return {
      allowed,
      current: bucket.count,
      remaining,
      resetInMs,
    };
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  private static readonly RATE_LIMIT_LUA = `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
      redis.call("PEXPIRE", KEYS[1], ARGV[1])
    end
    local ttl = redis.call("PTTL", KEYS[1])
    if ttl < 0 then
      ttl = tonumber(ARGV[1])
    end
    return { current, ttl }
  `;

  private readonly keyPrefix: string;

  constructor(
    private readonly redis: EvalRedisClient,
    options?: { keyPrefix?: string | undefined },
  ) {
    this.keyPrefix = `${options?.keyPrefix ?? "am-sme:"}safety:ratelimit:`;
  }

  async incrementAndCheck(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const raw = (await this.redis.eval(
      RedisRateLimitStore.RATE_LIMIT_LUA,
      1,
      `${this.keyPrefix}${key}`,
      windowMs,
    )) as [number, number];

    const current = Number(raw[0]);
    const resetInMs = Math.max(0, Number(raw[1]));
    const allowed = current <= limit;

    return {
      allowed,
      current,
      remaining: Math.max(0, limit - current),
      resetInMs,
    };
  }
}

export class RateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  async checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const normalized = key?.trim() ?? "";
    if (!normalized) {
      throw new Error("rate limit key must be non-empty");
    }
    if (limit <= 0 || windowMs <= 0) {
      throw new Error("limit and windowMs must be positive integers");
    }
    return this.store.incrementAndCheck(normalized, limit, windowMs);
  }
}

