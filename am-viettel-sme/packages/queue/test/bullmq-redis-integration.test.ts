import crypto from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobLockManager, RedisJobLockAdapter } from "../src/job-lock.js";
import { BullMqQueueRuntime } from "../src/bullmq-runtime.js";

const TEST_REDIS_URL = process.env["TEST_REDIS_URL"] ?? "redis://127.0.0.1:6379/15";

describe("Real Redis & BullMQ Queue Safety Integration", () => {
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
  });
});
