# Production Packaging, Full 4-Module Seed Data & Deployment Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the Viettel AM SME Automation Platform (`am-viettel-sme`) with complete 4-module synthetic seed data (`MOD-CA-001`, `MOD-PB-002`, `MOD-PC-003`, `MOD-OPS-004`), Docker Compose infrastructure (`PostgreSQL 16` + `Redis 7`), complete `.env.example` / `.env` templates, and a comprehensive Vietnamese Operational Runbook (`docs/RUNBOOK.md`).

**Architecture:**
- **Database & Demo Seed (`@am-sme/database` & `@am-sme/web`):** Extend `prisma/seed.synthetic.sql` and `WorkspaceOperationsHub` so both PostgreSQL and the in-memory Web Dashboard pre-populate realistic synthetic data across all 4 modules idempotently.
- **Infrastructure Packaging:** Provide a loopback-bound (`127.0.0.1`) `docker-compose.yml` for PostgreSQL 16 and Redis 7 with healthchecks, updated `.env.example` covering Google OAuth/Drive, Telegram Bot, Playwright profile paths, and Queue/Rate-limit parameters, plus `docs/RUNBOOK.md`.

**Tech Stack:** PostgreSQL 16, Redis 7, Docker Compose, PGlite, Vitest, Next.js.

---

### Task 1: Full 4-Module Idempotent Seed Data (`seed.synthetic.sql` & `operations-hub.ts`)

**Files:**
- Modify: `am-viettel-sme/packages/database/prisma/seed.synthetic.sql`
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/test/operations-hub.test.ts`
- Create: `am-viettel-sme/packages/database/test/seed-synthetic.test.ts`

- [x] **Step 1.1 (RED):** Write failing tests in `packages/database/test/seed-synthetic.test.ts` and `apps/web/test/operations-hub.test.ts` asserting that all 4 modules have idempotent synthetic seed data in PostgreSQL and `WorkspaceOperationsHub`.
- [x] **Step 1.2 (GREEN):** Update `packages/database/prisma/seed.synthetic.sql` and `apps/web/src/server/operations-hub.ts` with synthetic data for `SocialAccount`, `ContentPost`, `MediaAsset`, `CommunityGroup`, `GroupCampaign`, `PartnerLead`, `PartnerReferral`, and `PartnerConversion`.
- [x] **Step 1.3 (VERIFY):** Run `corepack pnpm vitest run packages/database/test/seed-synthetic.test.ts apps/web/test/operations-hub.test.ts`.

---

### Task 2: Docker Compose Infrastructure, `.env.example` & Operational Runbook (`docs/RUNBOOK.md`)

**Files:**
- Create: `am-viettel-sme/docker-compose.yml`
- Modify: `am-viettel-sme/.env.example`
- Modify: `am-viettel-sme/apps/web/.env`
- Create: `docs/RUNBOOK.md`
- Create: `am-viettel-sme/packages/config/test/deployment-packaging.test.ts`

- [x] **Step 2.1 (RED):** Write failing test `packages/config/test/deployment-packaging.test.ts` checking `docker-compose.yml`, `.env.example`, and `docs/RUNBOOK.md`.
- [x] **Step 2.2 (GREEN):** Create `am-viettel-sme/docker-compose.yml`, update `.env.example` and `apps/web/.env`, and author `docs/RUNBOOK.md`.
- [x] **Step 2.3 (VERIFY):** Run `corepack pnpm vitest run packages/config/test/deployment-packaging.test.ts` and verify all packaging & E2E tests pass.
