import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryJobLockAdapter,
  JobLockManager,
  type JobLockAdapter,
} from "../src/job-lock.js";
import {
  SafeQueueManager,
  type QueueJobOptions,
} from "../src/queue-factory.js";

describe("Queue & Job Safety Core", () => {
  describe("Distributed Job Lock Safety", () => {
    let adapter: JobLockAdapter;
    let lockManager: JobLockManager;

    beforeEach(() => {
      adapter = new InMemoryJobLockAdapter();
      lockManager = new JobLockManager(adapter);
    });

    it("acquires lock successfully for a unique resource key", async () => {
      const lock = await lockManager.acquire("account:am-001:post", 5000);
      expect(lock.acquired).toBe(true);
      expect(lock.token).toBeDefined();
      expect(typeof lock.token).toBe("string");
    });

    it("prevents concurrent lock acquisition for the same resource key within TTL", async () => {
      const lock1 = await lockManager.acquire("account:am-001:post", 5000);
      expect(lock1.acquired).toBe(true);

      const lock2 = await lockManager.acquire("account:am-001:post", 5000);
      expect(lock2.acquired).toBe(false);
      expect(lock2.token).toBeUndefined();
    });

    it("allows re-acquiring after legitimate release with correct token", async () => {
      const lock1 = await lockManager.acquire("lead:123:outreach", 5000);
      expect(lock1.acquired).toBe(true);

      const released = await lockManager.release("lead:123:outreach", lock1.token!);
      expect(released).toBe(true);

      const lock2 = await lockManager.acquire("lead:123:outreach", 5000);
      expect(lock2.acquired).toBe(true);
    });

    it("refuses to release lock if token does not match (prevents rogue release)", async () => {
      const lock1 = await lockManager.acquire("lead:456:outreach", 5000);
      expect(lock1.acquired).toBe(true);

      const rogueRelease = await lockManager.release("lead:456:outreach", "wrong-token-abc");
      expect(rogueRelease).toBe(false);

      // Lock is still held by lock1
      const lock2 = await lockManager.acquire("lead:456:outreach", 5000);
      expect(lock2.acquired).toBe(false);
    });

    it("automatically expires lock when TTL has elapsed", async () => {
      const shortTtlMs = 50;
      const lock1 = await lockManager.acquire("account:am-test:burst", shortTtlMs);
      expect(lock1.acquired).toBe(true);

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 70));

      const lock2 = await lockManager.acquire("account:am-test:burst", 5000);
      expect(lock2.acquired).toBe(true);
    });
  });

  describe("Queue Factory & Idempotent Enqueueing", () => {
    let queueManager: SafeQueueManager;

    beforeEach(() => {
      queueManager = new SafeQueueManager({
        defaultMaxRetries: 3,
        defaultBackoffMs: 1000,
      });
    });

    it("enforces capped retry limits and backoff policy in job options", () => {
      const options: QueueJobOptions = {
        idempotencyKey: "task-outreach-lead-001",
        maxRetries: 10, // Requesting too many retries
      };

      const sanitized = queueManager.sanitizeJobOptions(options);

      // Max retries must be capped at 3 per Master Plan specs
      expect(sanitized.maxRetries).toBeLessThanOrEqual(3);
      expect(sanitized.backoff).toEqual({
        type: "exponential",
        delay: 1000,
      });
      expect(sanitized.jobId).toBe("task-outreach-lead-001");
    });

    it("rejects or deduplicates job with duplicate idempotencyKey within deduplication window", async () => {
      const job1 = await queueManager.submitJob("outreach-queue", {
        idempotencyKey: "idemp-lead-888-sms",
        payload: { leadId: "lead-888", channel: "sms" },
      });

      expect(job1.status).toBe("enqueued");
      expect(job1.jobId).toBe("idemp-lead-888-sms");

      // Duplicate submission
      const job2 = await queueManager.submitJob("outreach-queue", {
        idempotencyKey: "idemp-lead-888-sms",
        payload: { leadId: "lead-888", channel: "sms" },
      });

      expect(job2.status).toBe("duplicate_ignored");
      expect(job2.jobId).toBe("idemp-lead-888-sms");
    });

    it("throws error if job is missing mandatory idempotencyKey", async () => {
      await expect(
        queueManager.submitJob("outreach-queue", {
          // @ts-expect-error testing missing idempotencyKey
          payload: { leadId: "lead-999" },
        }),
      ).rejects.toThrow(/idempotencyKey is required/i);
    });
  });
});
