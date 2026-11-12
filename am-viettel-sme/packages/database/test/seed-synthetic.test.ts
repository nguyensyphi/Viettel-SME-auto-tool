import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsPath = join(packageRoot, "prisma", "migrations");
const seedPath = join(packageRoot, "prisma", "seed.synthetic.sql");

describe("Synthetic Seed SQL (Full 4-Module Idempotent Seed)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    const migrationFiles = readdirSync(migrationsPath)
      .sort()
      .map((name) => join(migrationsPath, name, "migration.sql"))
      .filter((path) => existsSync(path));

    pglite = new PGlite();
    for (const file of migrationFiles) {
      await pglite.exec(readFileSync(file, "utf8"));
    }
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("executes seed.synthetic.sql idempotently across MOD-CA-001, MOD-PB-002, and MOD-PC-003 tables", async () => {
    const seedSql = readFileSync(seedPath, "utf8");

    // Execute twice to verify ON CONFLICT DO NOTHING idempotency
    await pglite.exec(seedSql);
    await pglite.exec(seedSql);

    const leads = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Lead"`,
    );
    const accounts = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "SocialAccount"`,
    );
    const posts = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "ContentPost"`,
    );
    const groups = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "CommunityGroup"`,
    );
    const groupCampaigns = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "GroupCampaign"`,
    );
    const partners = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "PartnerLead"`,
    );
    const referrals = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "PartnerReferral"`,
    );
    const conversions = await pglite.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "PartnerConversion"`,
    );

    expect(Number(leads.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(accounts.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(posts.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(groups.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
    expect(Number(groupCampaigns.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(partners.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(referrals.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(conversions.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

