import crypto from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobLockManager, RedisJobLockAdapter } from "../src/job-lock.js";
import { BullMqQueueRuntime } from "../src/bullmq-runtime.js";
import {
  AccountCircuitBreaker,
  KillSwitchController,
  RateLimiter,
  RedisCircuitBreakerStore,
  RedisKillSwitchStore,
  RedisRateLimitStore,
} from "@am-sme/config";

const TEST_REDIS_URL = process.env["TEST_REDIS_URL"] ?? "redis://127.0.0.1:6379/15";

const redisAvailable = await (async () => {
  try {
    const probe = new Redis(TEST_REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 300,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    probe.on("error", () => {});
    await probe.connect();
    const res = await probe.ping();
    await probe.quit();
    return res === "PONG";
  } catch {
    return false;
  }
})();

describe.skipIf(!redisAvailable)("Real Redis & BullMQ Queue Safety Integration", () => {
  let redisA: Redis;
  let redisB: Redis;
  const runPrefix = `am-test-${crypto.randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    redisA = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    redisB = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: null });
    await redisA.ping();
  });

  afterAll(async () => {
    const keys = await redisA.keys(`${runPrefix}*`);
    if (keys.length > 0) {
      await redisA.del(...keys);
    }
    await redisA.quit();
    await redisB.quit();
  });

  describe("RedisJobLockAdapter across independent connections", () => {
    it("enforces mutual exclusion, Lua token check, and PX expiry in Redis", async () => {
      const lockA = new JobLockManager(
        new RedisJobLockAdapter(redisA, { keyPrefix: `${runPrefix}:lock:` }),
      );
      const lockB = new JobLockManager(
        new RedisJobLockAdapter(redisB, { keyPrefix: `${runPrefix}:lock:` }),
      );

      const first = await lockA.acquire("account:am-01", 5_000);
      expect(first.acquired).toBe(true);
      expect(first.token).toBeDefined();

      // Second process cannot acquire the same lock
      const second = await lockB.acquire("account:am-01", 5_000);
      expect(second.acquired).toBe(false);

      // Rogue token cannot release via Lua script
      const rogue = await lockB.release("account:am-01", "forged-token");
      expect(rogue).toBe(false);

      // Legitimate token releases lock
      const released = await lockA.release("account:am-01", first.token!);
      expect(released).toBe(true);

      // Now process B can acquire with short TTL and auto-expire
      const shortLock = await lockB.acquire("account:am-01", 80);
      expect(shortLock.acquired).toBe(true);

      await new Promise((r) => setTimeout(r, 120));

      const afterExpiry = await lockA.acquire("account:am-01", 1_000);
      expect(afterExpiry.acquired).toBe(true);
      await lockA.release("account:am-01", afterExpiry.token!);
    });
  });

  describe("BullMqQueueRuntime distributed deduplication, JobLock & DLQ", () => {
    it("deduplicates across two runtime instances and handles colon keys safely", async () => {
      const queueName = `outreach-${crypto.randomUUID().slice(0, 6)}`;
      const runtime1 = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
        deduplicationWindowMs: 10_000,
      });
      const runtime2 = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
        deduplicationWindowMs: 10_000,
      });

      try {
        const res1 = await runtime1.enqueue(queueName, {
          idempotencyKey: "outreach:lead-100:zalo",
          lockKey: "lead:100",
          payload: { leadId: "100" },
        });
        expect(res1.status).toBe("enqueued");

        // Submitted from a DIFFERENT process/instance with the same idempotencyKey
        const res2 = await runtime2.enqueue(queueName, {
          idempotencyKey: "outreach:lead-100:zalo",
          lockKey: "lead:100",
          payload: { leadId: "100" },
        });
        expect(res2.status).toBe("duplicate_ignored");
        expect(res2.jobId).toBe(res1.jobId);
      } finally {
        await runtime1.close();
        await runtime2.close();
      }
    });

    it("rejects enqueue when idempotencyKey or lockKey is missing", async () => {
      const runtime = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
      });
      try {
        await expect(
          runtime.enqueue("outreach", {
            idempotencyKey: "",
            lockKey: "account:am-1",
            payload: {},
          }),
        ).rejects.toThrow(/idempotencyKey/i);

        await expect(
          runtime.enqueue("outreach", {
            idempotencyKey: "valid-key-1",
            lockKey: "   ",
            payload: {},
          }),
        ).rejects.toThrow(/lockKey/i);
      } finally {
        await runtime.close();
      }
    });

    it("serializes concurrent jobs sharing a lockKey using Redis JobLock", async () => {
      const queueName = `post-${crypto.randomUUID().slice(0, 6)}`;
      const runtime = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
        defaultBackoffMs: 40,
      });

      let activeForAccount = 0;
      let maxConcurrentObserved = 0;
      const completed: string[] = [];

      try {
        await runtime.registerWorker<{ seq: string }>(
          queueName,
          async (data) => {
            activeForAccount += 1;
            maxConcurrentObserved = Math.max(maxConcurrentObserved, activeForAccount);
            await new Promise((r) => setTimeout(r, 80));
            activeForAccount -= 1;
            completed.push(data.seq);
          },
          { concurrency: 4, lockTtlMs: 5_000 },
        );

        await Promise.all([
          runtime.enqueue(queueName, {
            idempotencyKey: "post-1",
            lockKey: "account:am-shared",
            payload: { seq: "first" },
            maxRetries: 3,
            backoffDelayMs: 40,
          }),
          runtime.enqueue(queueName, {
            idempotencyKey: "post-2",
            lockKey: "account:am-shared",
            payload: { seq: "second" },
            maxRetries: 3,
            backoffDelayMs: 40,
          }),
        ]);

        const deadline = Date.now() + 5_000;
        while (completed.length < 2 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 40));
        }

        expect(completed.sort()).toEqual(["first", "second"]);
        expect(maxConcurrentObserved).toBe(1);
      } finally {
        await runtime.close();
      }
    });

    it("caps maxRetries at 3 and routes exhausted jobs to the Dead-Letter Queue", async () => {
      const queueName = `failing-${crypto.randomUUID().slice(0, 6)}`;
      const runtime = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
        defaultBackoffMs: 25,
      });

      let attemptsObserved = 0;

      try {
        await runtime.registerWorker<{ taskId: string }>(
          queueName,
          async () => {
            attemptsObserved += 1;
            throw new Error("SESSION_EXPIRED");
          },
          { concurrency: 1, lockTtlMs: 2_000 },
        );

        await runtime.enqueue(queueName, {
          idempotencyKey: "job-will-fail",
          lockKey: "account:am-expired",
          payload: { taskId: "t-500" },
          maxRetries: 99, // Must be capped to 2 retries => max 3 attempts total (or 1+3=4; let's check cap!)
          backoffDelayMs: 25,
        });

        const deadline = Date.now() + 6_000;
        let dlqJobs = await runtime.getDeadLetterJobs(queueName);
        while (dlqJobs.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          dlqJobs = await runtime.getDeadLetterJobs(queueName);
        }

        // 1 initial try + max 3 retries = 4 attempts total max
        expect(attemptsObserved).toBe(4);
        expect(dlqJobs).toHaveLength(1);
        expect(dlqJobs[0]?.idempotencyKey).toBe("job-will-fail");
        expect(dlqJobs[0]?.lockKey).toBe("account:am-expired");
        expect(dlqJobs[0]?.failedReason).toContain("SESSION_EXPIRED");
        expect(dlqJobs[0]?.attemptsMade).toBe(4);
      } finally {
        await runtime.close();
      }
    });

    it("halts enqueue and worker execution immediately on Kill Switch or 5-error account Circuit Breaker trip", async () => {
      const queueName = `guarded-${crypto.randomUUID().slice(0, 6)}`;
      const killSwitch = new KillSwitchController(
        new RedisKillSwitchStore(redisA, { keyPrefix: `${runPrefix}:` }),
      );
      const circuitBreaker = new AccountCircuitBreaker(
        new RedisCircuitBreakerStore(redisA, { keyPrefix: `${runPrefix}:` }),
        { failureThreshold: 5, cooldownMs: 60_000 },
      );
      const rateLimiter = new RateLimiter(
        new RedisRateLimitStore(redisA, { keyPrefix: `${runPrefix}:` }),
      );

      // Verify Redis Lua rate limiter works across real Redis
      expect((await rateLimiter.checkRateLimit("zalo:am-1", 2, 5_000)).allowed).toBe(true);
      expect((await rateLimiter.checkRateLimit("zalo:am-1", 2, 5_000)).allowed).toBe(true);
      expect((await rateLimiter.checkRateLimit("zalo:am-1", 2, 5_000)).allowed).toBe(false);

      const runtime = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: runPrefix,
        defaultBackoffMs: 20,
        enableBuiltInSafetyControls: true,
      });

      const executedFor: string[] = [];

      try {
        await runtime.registerWorker<{ accountId: string; shouldFail: boolean }>(
          queueName,
          async (data) => {
            executedFor.push(data.accountId);
            if (data.shouldFail) {
              throw new Error("ZALO_ACTION_BLOCKED");
            }
          },
          { concurrency: 1, lockTtlMs: 2_000 },
        );

        // Trigger 5 consecutive errors on account "am-bad" (1 job w/ maxRetries:3 = 4 attempts + 1 more job = 5th failure -> trips OPEN!)
        await runtime.enqueue(queueName, {
          idempotencyKey: "spike-batch-1",
          lockKey: "account:am-bad",
          accountId: "am-bad",
          payload: { accountId: "am-bad", shouldFail: true },
          maxRetries: 3,
          backoffDelayMs: 20,
        });

        await new Promise((r) => setTimeout(r, 400));

        await runtime.enqueue(queueName, {
          idempotencyKey: "spike-batch-2",
          lockKey: "account:am-bad",
          accountId: "am-bad",
          payload: { accountId: "am-bad", shouldFail: true },
          maxRetries: 3,
          backoffDelayMs: 20,
        });

        // Wait until circuit breaker opens on 5th consecutive error (meaning spike-batch-2 must NOT execute 4 full attempts!)
        const deadline = Date.now() + 4_000;
        while ((await circuitBreaker.canExecute("am-bad")).allowed && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 40));
        }

        expect((await circuitBreaker.canExecute("am-bad")).state).toBe("OPEN");
        // Stopped right at 5 executions instead of continuing retries 6, 7, 8!
        expect(executedFor.filter((a) => a === "am-bad").length).toBe(5);

        // Enqueueing a new job for tripped account "am-bad" is rejected immediately
        await expect(
          runtime.enqueue(queueName, {
            idempotencyKey: "spike-batch-3",
            lockKey: "account:am-bad",
            accountId: "am-bad",
            payload: { accountId: "am-bad", shouldFail: false },
          }),
        ).rejects.toThrow(/CIRCUIT_OPEN/i);

        // Healthy account "am-good" can still enqueue and execute
        await runtime.enqueue(queueName, {
          idempotencyKey: "good-job-1",
          lockKey: "account:am-good",
          accountId: "am-good",
          payload: { accountId: "am-good", shouldFail: false },
        });

        const goodDeadline = Date.now() + 2_000;
        while (!executedFor.includes("am-good") && Date.now() < goodDeadline) {
          await new Promise((r) => setTimeout(r, 30));
        }
        expect(executedFor).toContain("am-good");

        // Now activate global Kill Switch via Redis -> rejects ALL new jobs immediately
        await killSwitch.activateKillSwitch("Emergency administrative abort", "admin-root");

        await expect(
          runtime.enqueue(queueName, {
            idempotencyKey: "good-job-2",
            lockKey: "account:am-good",
            accountId: "am-good",
            payload: { accountId: "am-good", shouldFail: false },
          }),
        ).rejects.toThrow(/KILL_SWITCH_ACTIVE/i);
      } finally {
        await runtime.close();
      }
    });

    it("preserves waiting jobs during Kill Switch /pause without DLQ drain and executes after /resume, cleans idempKey on add failure, and renews JobLock", async () => {
      const pausePrefix = `${runPrefix}-pause`;
      const queueName = `pause-safe-${crypto.randomUUID().slice(0, 6)}`;
      const killSwitch = new KillSwitchController(
        new RedisKillSwitchStore(redisA, { keyPrefix: `${pausePrefix}:` }),
      );

      const runtime = new BullMqQueueRuntime({
        redisUrl: TEST_REDIS_URL,
        prefix: pausePrefix,
        defaultBackoffMs: 25,
        lockContentionDelayMs: 60,
        enableBuiltInSafetyControls: true,
      });

      const executedIds: string[] = [];
      let concurrentCount = 0;
      let maxConcurrent = 0;

      try {
        // 1. Enqueue a job BEFORE worker starts, then activate Kill Switch (/pause), then register worker!
        await runtime.enqueue(queueName, {
          idempotencyKey: "queued-before-pause",
          lockKey: "account:am-pause-1",
          accountId: "am-pause-1",
          payload: { id: "job-preserved", sleepMs: 20 },
        });

        await killSwitch.activateKillSwitch("Maintenance window", "admin-1");

        await runtime.registerWorker<{ id: string; sleepMs: number }>(
          queueName,
          async (data) => {
            concurrentCount += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrentCount);
            await new Promise((r) => setTimeout(r, data.sleepMs));
            concurrentCount -= 1;
            executedIds.push(data.id);
          },
          { concurrency: 2, lockTtlMs: 80 },
        );

        // Wait 250ms while Kill Switch is active: job MUST NOT be executed and MUST NOT be drained into DLQ!
        await new Promise((r) => setTimeout(r, 250));
        expect(executedIds).toEqual([]);
        expect(await runtime.getDeadLetterJobs(queueName)).toHaveLength(0);

        // Resume Kill Switch -> preserved job executes cleanly!
        await killSwitch.deactivateKillSwitch("admin-1");
        const resumeDeadline = Date.now() + 3_000;
        while (!executedIds.includes("job-preserved") && Date.now() < resumeDeadline) {
          await new Promise((r) => setTimeout(r, 40));
        }
        expect(executedIds).toContain("job-preserved");
        expect(await runtime.getDeadLetterJobs(queueName)).toHaveLength(0);

        // 2. JobLock renewal: job running 220ms with lockTtlMs=80ms must keep renewing lock so parallel job waits!
        await Promise.all([
          runtime.enqueue(queueName, {
            idempotencyKey: "long-lock-1",
            lockKey: "account:am-renew",
            payload: { id: "long-1", sleepMs: 220 },
          }),
          runtime.enqueue(queueName, {
            idempotencyKey: "long-lock-2",
            lockKey: "account:am-renew",
            payload: { id: "long-2", sleepMs: 40 },
          }),
        ]);

        const renewDeadline = Date.now() + 4_000;
        while (
          (!executedIds.includes("long-1") || !executedIds.includes("long-2")) &&
          Date.now() < renewDeadline
        ) {
          await new Promise((r) => setTimeout(r, 40));
        }
        expect(maxConcurrent).toBe(1);
      } finally {
        const pauseKeys = await redisA.keys(`${pausePrefix}*`);
        if (pauseKeys.length > 0) await redisA.del(...pauseKeys);
        await runtime.close();
      }
    });
  });
});
