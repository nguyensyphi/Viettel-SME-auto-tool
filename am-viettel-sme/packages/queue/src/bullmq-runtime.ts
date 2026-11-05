import crypto from "node:crypto";
import {
  AccountCircuitBreaker,
  KillSwitchController,
  RedisCircuitBreakerStore,
  RedisKillSwitchStore,
} from "@am-sme/config";
import {
  DelayedError,
  Queue,
  UnrecoverableError,
  Worker,
  type Job,
} from "bullmq";
import { Redis } from "ioredis";
import { JobLockManager, RedisJobLockAdapter } from "./job-lock.js";
import type { JobSubmissionResult } from "./queue-factory.js";

export interface BullMqRuntimeOptions {
  redisUrl: string;
  prefix?: string | undefined;
  defaultMaxRetries?: number | undefined;
  defaultBackoffMs?: number | undefined;
  deduplicationWindowMs?: number | undefined;
  lockContentionDelayMs?: number | undefined;
  enableBuiltInSafetyControls?: boolean | undefined;
  circuitFailureThreshold?: number | undefined;
  circuitCooldownMs?: number | undefined;
}

export interface ProtectedJobInput<T = unknown> {
  jobName?: string | undefined;
  idempotencyKey: string;
  lockKey: string;
  accountId?: string | undefined;
  payload: T;
  maxRetries?: number | undefined;
  backoffDelayMs?: number | undefined;
}

export interface ProtectedJobEnvelope<T = unknown> {
  idempotencyKey: string;
  lockKey: string;
  accountId?: string | undefined;
  payload: T;
}

export interface WorkerRegistrationOptions {
  concurrency?: number | undefined;
  lockTtlMs?: number | undefined;
}

export interface DeadLetterEntry {
  originalQueue: string;
  originalJobId: string;
  idempotencyKey: string;
  lockKey: string;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

const MAX_RETRIES_CAP = 3;

export function toBullMqJobId(idempotencyKey: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 16);
  const slug = idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `job_${slug}_${digest}`;
}

function inferAccountId(
  explicitAccountId: string | undefined,
  lockKey: string,
): string | undefined {
  const trimmed = explicitAccountId?.trim();
  if (trimmed) return trimmed;
  if (lockKey.startsWith("account:")) {
    const extracted = lockKey.slice("account:".length).split(":")[0]?.trim();
    return extracted || undefined;
  }
  return undefined;
}

export class BullMqQueueRuntime {
  private readonly redisUrl: string;
  private readonly prefix: string;
  private readonly defaultMaxRetries: number;
  private readonly defaultBackoffMs: number;
  private readonly deduplicationWindowMs: number;
  private readonly lockContentionDelayMs: number;

  private readonly sharedRedis: Redis;
  private readonly lockManager: JobLockManager;
  private readonly killSwitch?: KillSwitchController | undefined;
  private readonly circuitBreaker?: AccountCircuitBreaker | undefined;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly extraConnections: Redis[] = [];
  private readonly pendingDlqWrites = new Set<Promise<void>>();

  constructor(options: BullMqRuntimeOptions) {
    this.redisUrl = options.redisUrl;
    this.prefix = options.prefix ?? "am-sme";
    this.defaultMaxRetries = Math.min(
      Math.max(0, options.defaultMaxRetries ?? MAX_RETRIES_CAP),
      MAX_RETRIES_CAP,
    );
    this.defaultBackoffMs = options.defaultBackoffMs ?? 1_000;
    this.deduplicationWindowMs = options.deduplicationWindowMs ?? 60_000;
    this.lockContentionDelayMs = options.lockContentionDelayMs ?? 50;

    this.sharedRedis = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.lockManager = new JobLockManager(
      new RedisJobLockAdapter(this.sharedRedis, {
        keyPrefix: `${this.prefix}:lock:`,
      }),
    );

    if (options.enableBuiltInSafetyControls) {
      const keyPrefix = `${this.prefix}:`;
      this.killSwitch = new KillSwitchController(
        new RedisKillSwitchStore(this.sharedRedis, { keyPrefix }),
      );
      this.circuitBreaker = new AccountCircuitBreaker(
        new RedisCircuitBreakerStore(this.sharedRedis, { keyPrefix }),
        {
          failureThreshold: options.circuitFailureThreshold ?? 5,
          cooldownMs: options.circuitCooldownMs ?? 300_000,
        },
      );
    }
  }

  private getOrCreateQueue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.sharedRedis,
        prefix: this.prefix,
      });
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  private getDlqName(queueName: string): string {
    return `${queueName}-dlq`;
  }

  async enqueue<T>(
    queueName: string,
    input: ProtectedJobInput<T>,
  ): Promise<JobSubmissionResult> {
    const idempotencyKey = input.idempotencyKey?.trim() ?? "";
    if (!idempotencyKey) {
      throw new Error("idempotencyKey is required for every BullMQ job");
    }

    const lockKey = input.lockKey?.trim() ?? "";
    if (!lockKey) {
      throw new Error("lockKey is required for distributed JobLock safety");
    }

    if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
      throw new Error("KILL_SWITCH_ACTIVE: emergency stop rejects new jobs");
    }

    const accountId = inferAccountId(input.accountId, lockKey);
    if (this.circuitBreaker && accountId) {
      const gate = await this.circuitBreaker.canExecute(accountId);
      if (!gate.allowed) {
        throw new Error(`CIRCUIT_OPEN: account ${accountId} is halted`);
      }
    }

    const jobId = toBullMqJobId(idempotencyKey);
    const idempRedisKey = `${this.prefix}:idemp:${queueName}:${crypto
      .createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")}`;

    const claimed = await this.sharedRedis.set(
      idempRedisKey,
      jobId,
      "PX",
      this.deduplicationWindowMs,
      "NX",
    );

    if (claimed !== "OK") {
      return { status: "duplicate_ignored", jobId };
    }

    const requestedRetries = input.maxRetries ?? this.defaultMaxRetries;
    const cappedRetries = Math.min(Math.max(0, requestedRetries), MAX_RETRIES_CAP);
    const attempts = 1 + cappedRetries;
    const backoffDelay = input.backoffDelayMs ?? this.defaultBackoffMs;

    const envelope: ProtectedJobEnvelope<T> = {
      idempotencyKey,
      lockKey,
      ...(accountId !== undefined ? { accountId } : {}),
      payload: input.payload,
    };

    const queue = this.getOrCreateQueue(queueName);
    await queue.add(input.jobName ?? "execute", envelope, {
      jobId,
      attempts,
      backoff: {
        type: "exponential",
        delay: backoffDelay,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    return { status: "enqueued", jobId };
  }

  async registerWorker<T>(
    queueName: string,
    handler: (payload: T, job: Job<ProtectedJobEnvelope<T>>) => Promise<void>,
    options?: WorkerRegistrationOptions,
  ): Promise<Worker<ProtectedJobEnvelope<T>>> {
    const workerConn = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.extraConnections.push(workerConn);

    const lockTtlMs = options?.lockTtlMs ?? 30_000;
    const dlqQueue = this.getOrCreateQueue(this.getDlqName(queueName));

    const worker = new Worker<ProtectedJobEnvelope<T>>(
      queueName,
      async (job, bullToken) => {
        if (this.killSwitch && (await this.killSwitch.isKillSwitchActive())) {
          throw new UnrecoverableError("KILL_SWITCH_ACTIVE: worker halted");
        }

        const lockKey = job.data.lockKey;
        const accountId = inferAccountId(job.data.accountId, lockKey);

        if (this.circuitBreaker && accountId) {
          const gate = await this.circuitBreaker.canExecute(accountId);
          if (!gate.allowed) {
            throw new UnrecoverableError(
              `CIRCUIT_OPEN: account ${accountId} halted`,
            );
          }
        }

        const lock = await this.lockManager.acquire(lockKey, lockTtlMs);

        if (!lock.acquired || !lock.token) {
          if (bullToken) {
            await job.moveToDelayed(Date.now() + this.lockContentionDelayMs, bullToken);
            throw new DelayedError();
          }
          throw new Error(`JOB_LOCK_CONTENTION:${lockKey}`);
        }

        try {
          await handler(job.data.payload, job);
          if (this.circuitBreaker && accountId) {
            await this.circuitBreaker.recordSuccess(accountId);
          }
        } catch (err) {
          if (
            this.circuitBreaker &&
            accountId &&
            !(err instanceof UnrecoverableError) &&
            !(err instanceof DelayedError)
          ) {
            const msg = err instanceof Error ? err.message : String(err);
            const trip = await this.circuitBreaker.recordFailure(accountId, msg);
            if (trip.state === "OPEN") {
              throw new UnrecoverableError(`CIRCUIT_OPEN: ${msg}`);
            }
          }
          throw err;
        } finally {
          await this.lockManager.release(lockKey, lock.token);
        }
      },
      {
        connection: workerConn,
        prefix: this.prefix,
        concurrency: options?.concurrency ?? 1,
      },
    );

    worker.on("failed", (job, err) => {
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 1;
      const permanentlyFailed =
        err.name === "UnrecoverableError" || job.attemptsMade >= maxAttempts;
      if (!permanentlyFailed) return;

      const writePromise = (async () => {
        const entry: DeadLetterEntry = {
          originalQueue: queueName,
          originalJobId: String(job.id ?? ""),
          idempotencyKey: job.data.idempotencyKey,
          lockKey: job.data.lockKey,
          failedReason: err.message,
          attemptsMade: job.attemptsMade,
          failedAt: new Date().toISOString(),
        };
        await dlqQueue.add("dead-letter", entry, {
          jobId: `dlq_${String(job.id ?? crypto.randomUUID())}`,
          attempts: 1,
        });
      })();

      this.pendingDlqWrites.add(writePromise);
      void writePromise.finally(() => {
        this.pendingDlqWrites.delete(writePromise);
      });
    });

    await worker.waitUntilReady();
    this.workers.push(worker as unknown as Worker);
    return worker;
  }

  async getDeadLetterJobs(queueName: string): Promise<DeadLetterEntry[]> {
    if (this.pendingDlqWrites.size > 0) {
      await Promise.allSettled([...this.pendingDlqWrites]);
    }
    const dlqQueue = this.getOrCreateQueue(this.getDlqName(queueName));
    const jobs = await dlqQueue.getJobs(["waiting", "delayed", "completed", "failed"]);
    return jobs.map((j) => j.data as DeadLetterEntry);
  }

  async close(): Promise<void> {
    if (this.pendingDlqWrites.size > 0) {
      await Promise.allSettled([...this.pendingDlqWrites]);
    }
    for (const worker of this.workers) {
      await worker.close();
    }
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    for (const conn of this.extraConnections) {
      await conn.quit();
    }
    await this.sharedRedis.quit();
  }
}
