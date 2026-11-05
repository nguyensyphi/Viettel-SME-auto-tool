export interface KillSwitchState {
  active: boolean;
  reason?: string | undefined;
  activatedBy?: string | undefined;
  activatedAt?: string | undefined;
  clearedBy?: string | undefined;
  clearedAt?: string | undefined;
}

export interface KillSwitchStore {
  getState(): Promise<KillSwitchState>;
  setState(state: KillSwitchState): Promise<void>;
}

export interface KeyValueRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export class InMemoryKillSwitchStore implements KillSwitchStore {
  private state: KillSwitchState = { active: false };

  async getState(): Promise<KillSwitchState> {
    return { ...this.state };
  }

  async setState(state: KillSwitchState): Promise<void> {
    this.state = { ...state };
  }
}

export class RedisKillSwitchStore implements KillSwitchStore {
  private readonly redisKey: string;

  constructor(
    private readonly redis: KeyValueRedisClient,
    options?: { keyPrefix?: string | undefined },
  ) {
    this.redisKey = `${options?.keyPrefix ?? "am-sme:"}safety:kill-switch`;
  }

  async getState(): Promise<KillSwitchState> {
    const raw = await this.redis.get(this.redisKey);
    if (!raw) {
      return { active: false };
    }
    return JSON.parse(raw) as KillSwitchState;
  }

  async setState(state: KillSwitchState): Promise<void> {
    await this.redis.set(this.redisKey, JSON.stringify(state));
  }
}

export class KillSwitchController {
  constructor(private readonly store: KillSwitchStore) {}

  async isKillSwitchActive(): Promise<boolean> {
    const state = await this.store.getState();
    return state.active === true;
  }

  async getStatus(): Promise<KillSwitchState> {
    return this.store.getState();
  }

  async activateKillSwitch(
    reason: string,
    activatedBy = "system",
  ): Promise<KillSwitchState> {
    const trimmedReason = reason?.trim() ?? "";
    if (!trimmedReason) {
      throw new Error("reason is required to activate Kill Switch");
    }
    const actor = activatedBy.trim() || "system";
    const next: KillSwitchState = {
      active: true,
      reason: trimmedReason,
      activatedBy: actor,
      activatedAt: new Date().toISOString(),
    };
    await this.store.setState(next);
    return next;
  }

  async deactivateKillSwitch(clearedBy: string): Promise<KillSwitchState> {
    const actor = clearedBy?.trim() ?? "";
    if (!actor) {
      throw new Error("clearedBy operator identity is required to clear Kill Switch");
    }
    const next: KillSwitchState = {
      active: false,
      clearedBy: actor,
      clearedAt: new Date().toISOString(),
    };
    await this.store.setState(next);
    return next;
  }
}

