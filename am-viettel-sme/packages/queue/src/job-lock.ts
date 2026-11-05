import crypto from "node:crypto";

export interface LockResult {
  acquired: boolean;
  token?: string | undefined;
  key: string;
}

export interface JobLockAdapter {
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  release(key: string, token: string): Promise<boolean>;
}

export interface RedisLockClient {
  set(
    key: string,
    value: string,
    pxMode: "PX",
    ttlMs: number,
    nxMode: "NX",
  ): Promise<"OK" | null>;
  eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

export interface RedisJobLockAdapterOptions {
  keyPrefix?: string | undefined;
}

export class InMemoryJobLockAdapter implements JobLockAdapter {
  private locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      return false;
    }

    this.locks.set(key, {
      token,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  async release(key: string, token: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing) {
      return false;
    }

    if (existing.token !== token) {
      return false;
    }

    this.locks.delete(key);
    return true;
  }
}

export class RedisJobLockAdapter implements JobLockAdapter {
  // Atomic Lua unlock: deletes key only when caller owns the lock token
  private static readonly UNLOCK_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  private readonly keyPrefix: string;

  constructor(
    private readonly redisClient: RedisLockClient,
    options?: RedisJobLockAdapterOptions,
  ) {
    this.keyPrefix = options?.keyPrefix ?? "lock:";
  }

  async acquire(key: string, token: string, ttlMs: number): Promise<boolean> {
    const prefixedKey = `${this.keyPrefix}${key}`;
    const result = await this.redisClient.set(
      prefixedKey,
      token,
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  }

  async release(key: string, token: string): Promise<boolean> {
    const prefixedKey = `${this.keyPrefix}${key}`;
    const result = await this.redisClient.eval(
      RedisJobLockAdapter.UNLOCK_SCRIPT,
      1,
      prefixedKey,
      token,
    );
    return result === 1;
  }
}

export class JobLockManager {
  constructor(private readonly adapter: JobLockAdapter) {}

  async acquire(key: string, ttlMs: number): Promise<LockResult> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("lock key must be a non-empty string");
    }

    const token = crypto.randomUUID();
    const acquired = await this.adapter.acquire(normalizedKey, token, ttlMs);

    if (!acquired) {
      return { acquired: false, key: normalizedKey };
    }

    return {
      acquired: true,
      token,
      key: normalizedKey,
    };
  }

  async release(key: string, token: string): Promise<boolean> {
    return this.adapter.release(key.trim(), token);
  }
}
