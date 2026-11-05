import { describe, expect, it } from "vitest";
import {
  InMemoryKillSwitchStore,
  KillSwitchController,
} from "../src/kill-switch.js";
import {
  AccountCircuitBreaker,
  InMemoryCircuitBreakerStore,
} from "../src/circuit-breaker.js";
import {
  InMemoryRateLimitStore,
  RateLimiter,
} from "../src/rate-limiter.js";

describe("Safety Mechanisms: Kill Switch, Circuit Breaker & Rate Limiter (Task 5)", () => {
  describe("KillSwitchController", () => {
    it("starts inactive, activates with mandatory reason, and requires operator id to clear", async () => {
      const killSwitch = new KillSwitchController(new InMemoryKillSwitchStore());

      expect(await killSwitch.isKillSwitchActive()).toBe(false);

      await expect(killSwitch.activateKillSwitch("   ")).rejects.toThrow(/reason/i);

      const active = await killSwitch.activateKillSwitch(
        "Detected abnormal Zalo rate-limit warning",
        "admin-01",
      );
      expect(active.active).toBe(true);
      expect(active.reason).toContain("Zalo rate-limit");
      expect(active.activatedBy).toBe("admin-01");
      expect(await killSwitch.isKillSwitchActive()).toBe(true);

      await expect(killSwitch.deactivateKillSwitch("")).rejects.toThrow(/clearedBy/i);

      const cleared = await killSwitch.deactivateKillSwitch("admin-01");
      expect(cleared.active).toBe(false);
      expect(await killSwitch.isKillSwitchActive()).toBe(false);
    });
  });

  describe("AccountCircuitBreaker", () => {
    it("trips OPEN automatically on 5 consecutive failures for an account without affecting other accounts", async () => {
      const breaker = new AccountCircuitBreaker(new InMemoryCircuitBreakerStore(), {
        failureThreshold: 5,
        cooldownMs: 60_000,
      });

      for (let i = 1; i <= 4; i++) {
        const res = await breaker.recordFailure("am-001", `err-${i}`);
        expect(res.state).toBe("CLOSED");
        expect(res.trippedNow).toBe(false);
        expect((await breaker.canExecute("am-001")).allowed).toBe(true);
      }

      const fifth = await breaker.recordFailure("am-001", "err-5");
      expect(fifth.state).toBe("OPEN");
      expect(fifth.consecutiveFailures).toBe(5);
      expect(fifth.trippedNow).toBe(true);

      // Blocked for am-001
      const gate = await breaker.canExecute("am-001");
      expect(gate.allowed).toBe(false);
      expect(gate.state).toBe("OPEN");

      // Other AM accounts remain unaffected
      const healthyGate = await breaker.canExecute("am-002");
      expect(healthyGate.allowed).toBe(true);
      expect(healthyGate.state).toBe("CLOSED");
    });

    it("resets consecutive failure count when a success occurs before threshold", async () => {
      const breaker = new AccountCircuitBreaker(new InMemoryCircuitBreakerStore(), {
        failureThreshold: 5,
        cooldownMs: 60_000,
      });

      await breaker.recordFailure("am-001", "transient-1");
      await breaker.recordFailure("am-001", "transient-2");
      await breaker.recordSuccess("am-001");

      const check = await breaker.canExecute("am-001");
      expect(check.allowed).toBe(true);
      expect(check.consecutiveFailures).toBe(0);
    });

    it("transitions OPEN -> HALF_OPEN after cooldown, closing on success or reopening on failure", async () => {
      let now = 1_000_000;
      const breaker = new AccountCircuitBreaker(new InMemoryCircuitBreakerStore(), {
        failureThreshold: 5,
        cooldownMs: 10_000,
        nowFn: () => now,
      });

      for (let i = 0; i < 5; i++) {
        await breaker.recordFailure("am-probe", "boom");
      }
      expect((await breaker.canExecute("am-probe")).allowed).toBe(false);

      // Advance past cooldown -> HALF_OPEN allows probe
      now += 10_001;
      const probe = await breaker.canExecute("am-probe");
      expect(probe.allowed).toBe(true);
      expect(probe.state).toBe("HALF_OPEN");

      // Failure during HALF_OPEN immediately reopens circuit
      const reopen = await breaker.recordFailure("am-probe", "still-broken");
      expect(reopen.state).toBe("OPEN");
      expect((await breaker.canExecute("am-probe")).allowed).toBe(false);

      // Advance again and succeed -> CLOSED
      now += 10_001;
      expect((await breaker.canExecute("am-probe")).state).toBe("HALF_OPEN");
      await breaker.recordSuccess("am-probe");
      const closed = await breaker.canExecute("am-probe");
      expect(closed.allowed).toBe(true);
      expect(closed.state).toBe("CLOSED");
      expect(closed.consecutiveFailures).toBe(0);
    });
  });

  describe("RateLimiter", () => {
    it("enforces request quota per window and resets when window expires", async () => {
      let now = 5_000_000;
      const limiter = new RateLimiter(new InMemoryRateLimitStore(() => now));

      const r1 = await limiter.checkRateLimit("zalo:am-01", 3, 60_000);
      const r2 = await limiter.checkRateLimit("zalo:am-01", 3, 60_000);
      const r3 = await limiter.checkRateLimit("zalo:am-01", 3, 60_000);
      const r4 = await limiter.checkRateLimit("zalo:am-01", 3, 60_000);

      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
      expect(r4.allowed).toBe(false);
      expect(r4.resetInMs).toBeGreaterThan(0);

      // Advance past window
      now += 60_001;
      const afterReset = await limiter.checkRateLimit("zalo:am-01", 3, 60_000);
      expect(afterReset.allowed).toBe(true);
      expect(afterReset.current).toBe(1);
    });
  });
});

