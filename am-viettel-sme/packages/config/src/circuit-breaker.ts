import type { KeyValueRedisClient } from "./kill-switch.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number | undefined;
  lastError?: string | undefined;
}

export interface CircuitBreakerStore {
  getRecord(accountId: string): Promise<CircuitRecord>;
  setRecord(accountId: string, record: CircuitRecord): Promise<void>;
}

export class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private readonly records = new Map<string, CircuitRecord>();

  async getRecord(accountId: string): Promise<CircuitRecord> {
    const found = this.records.get(accountId);
    return found ? { ...found } : { state: "CLOSED", consecutiveFailures: 0 };
  }

  async setRecord(accountId: string, record: CircuitRecord): Promise<void> {
    this.records.set(accountId, { ...record });
  }
}

export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: KeyValueRedisClient,
    options?: { keyPrefix?: string | undefined },
  ) {
    this.keyPrefix = `${options?.keyPrefix ?? "am-sme:"}safety:circuit:`;
  }

  async getRecord(accountId: string): Promise<CircuitRecord> {
    const raw = await this.redis.get(`${this.keyPrefix}${accountId}`);
    if (!raw) {
      return { state: "CLOSED", consecutiveFailures: 0 };
    }
    return JSON.parse(raw) as CircuitRecord;
  }

  async setRecord(accountId: string, record: CircuitRecord): Promise<void> {
    await this.redis.set(`${this.keyPrefix}${accountId}`, JSON.stringify(record));
  }
}

export interface AccountCircuitBreakerOptions {
  failureThreshold?: number | undefined;
  cooldownMs?: number | undefined;
  nowFn?: (() => number) | undefined;
}

export class AccountCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly nowFn: () => number;

  constructor(
    private readonly store: CircuitBreakerStore,
    options?: AccountCircuitBreakerOptions,
  ) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.cooldownMs = options?.cooldownMs ?? 300_000;
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  private normalizeAccount(accountId: string): string {
    const normalized = accountId?.trim() ?? "";
    if (!normalized) {
      throw new Error("accountId is required for circuit breaker check");
    }
    return normalized;
  }

  async canExecute(accountId: string): Promise<{
    allowed: boolean;
    state: CircuitState;
    consecutiveFailures: number;
  }> {
    const id = this.normalizeAccount(accountId);
    const record = await this.store.getRecord(id);

    if (record.state === "OPEN") {
      const openedAt = record.openedAt ?? 0;
      if (this.nowFn() - openedAt >= this.cooldownMs) {
        const halfOpen: CircuitRecord = {
          ...record,
          state: "HALF_OPEN",
        };
        await this.store.setRecord(id, halfOpen);
        return {
          allowed: true,
          state: "HALF_OPEN",
          consecutiveFailures: halfOpen.consecutiveFailures,
        };
      }
      return {
        allowed: false,
        state: "OPEN",
        consecutiveFailures: record.consecutiveFailures,
      };
    }

    return {
      allowed: true,
      state: record.state,
      consecutiveFailures: record.consecutiveFailures,
    };
  }

  async recordSuccess(accountId: string): Promise<void> {
    const id = this.normalizeAccount(accountId);
    await this.store.setRecord(id, {
      state: "CLOSED",
      consecutiveFailures: 0,
    });
  }

  async recordFailure(
    accountId: string,
    errorReason?: string,
  ): Promise<{
    state: CircuitState;
    consecutiveFailures: number;
    trippedNow: boolean;
  }> {
    const id = this.normalizeAccount(accountId);
    const prev = await this.store.getRecord(id);
    const consecutiveFailures = prev.consecutiveFailures + 1;
    const shouldOpen =
      prev.state === "HALF_OPEN" || consecutiveFailures >= this.failureThreshold;

    const nextState: CircuitState = shouldOpen ? "OPEN" : "CLOSED";
    const trippedNow = shouldOpen && prev.state !== "OPEN";

    const updated: CircuitRecord = {
      state: nextState,
      consecutiveFailures,
      ...(shouldOpen ? { openedAt: this.nowFn() } : {}),
      ...(errorReason !== undefined ? { lastError: errorReason } : {}),
    };
    await this.store.setRecord(id, updated);

    return {
      state: nextState,
      consecutiveFailures,
      trippedNow,
    };
  }

  async resetAccount(accountId: string, operatorId: string): Promise<void> {
    const id = this.normalizeAccount(accountId);
    if (!operatorId?.trim()) {
      throw new Error("operatorId is required to reset account circuit breaker");
    }
    await this.store.setRecord(id, {
      state: "CLOSED",
      consecutiveFailures: 0,
    });
  }
}

