import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const monorepoRoot = resolve(packageRoot, "../..");
const repoRoot = resolve(monorepoRoot, "..");

describe("Production & Local Deployment Packaging (MOD-OPS-004 Packaging)", () => {
  it("provides loopback-bound docker-compose.yml for PostgreSQL 16 and Redis 7 with healthchecks", () => {
    const composePath = resolve(monorepoRoot, "docker-compose.yml");
    expect(existsSync(composePath)).toBe(true);

    const content = readFileSync(composePath, "utf8");
    expect(content).toContain("postgres:16");
    expect(content).toContain("redis:7");
    expect(content).toContain("127.0.0.1:5432:5432");
    expect(content).toContain("127.0.0.1:6379:6379");
    expect(content).toContain("healthcheck:");
  });

  it("provides complete .env.example and apps/web/.env with all 4-module configuration keys and safe defaults", () => {
    const envExamplePath = resolve(monorepoRoot, ".env.example");
    const webEnvPath = resolve(monorepoRoot, "apps/web/.env");
    expect(existsSync(envExamplePath)).toBe(true);
    expect(existsSync(webEnvPath)).toBe(true);

    for (const filePath of [envExamplePath, webEnvPath]) {
      const envText = readFileSync(filePath, "utf8");
      expect(envText).toContain("DATABASE_URL=");
      expect(envText).toContain("REDIS_URL=");
      expect(envText).toContain("PUBLIC_SIGNUP_ENABLED=false");
      expect(envText).toContain("ZALO_SEND_MODE=disabled");
      expect(envText).toContain("BROWSER_PROFILES_ROOT=storage/browser_profiles");
      expect(envText).toContain("GOOGLE_CLIENT_ID=");
      expect(envText).toContain("TELEGRAM_BOT_TOKEN=");
    }
  });

  it("provides comprehensive operational runbook docs/RUNBOOK.md covering all 4 modules and Decree 13 safety rules", () => {
    const runbookPath = resolve(repoRoot, "docs/RUNBOOK.md");
    expect(existsSync(runbookPath)).toBe(true);

    const runbook = readFileSync(runbookPath, "utf8");
    expect(runbook).toContain("MOD-CA-001");
    expect(runbook).toContain("MOD-PB-002");
    expect(runbook).toContain("MOD-PC-003");
    expect(runbook).toContain("storage/browser_profiles");
    expect(runbook).toContain("db:migrate:deploy");
    expect(runbook).toContain("db:seed:synthetic");
  });
});

