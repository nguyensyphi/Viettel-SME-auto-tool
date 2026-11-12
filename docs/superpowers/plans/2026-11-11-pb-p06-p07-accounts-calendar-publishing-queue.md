# PB-P06 & PB-P07: Social Account Manager, Publishing Calendar, Publishing Queue & Duplicate/Reuse Control Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PB-P06 and PB-P07 (`MOD-PB-002` Sections 9, 10, 11, 12, 13, 15, 19.4, 19.5, 20.4, 20.5, 20.6, 22.3): Social Account & Browser Profile Management, Platform Content Preparation (`ZALO` / `FACEBOOK`), Publishing Calendar & Scheduling Rules (`maxPostsPerDay`, `minIntervalMinutes`), Duplicate/Reuse Control (`PB-017`), and Publishing Queue (`PublishingJob`, `PublishingJobStep`, `PublishingResult`).

**Architecture:** Add `PlatformContentFormatter` and `PublishingPolicyEngine` (`checkSchedulingConstraints`, `checkContentReusePolicy`) to `@am-sme/content-library`; add database models and repository methods (`SocialAccount`, `PublishingCampaign`, `PublishingSchedule`, `PublishingJob`, `PublishingJobStep`, `PublishingResult`) to `@am-sme/database`; and expose REST endpoints (`/api/v1/accounts/*`, `/api/v1/publishing/calendar`, `/api/v1/publishing/schedule`, `/api/v1/publishing/campaigns`, `/api/v1/publishing/jobs/*`) on `@am-sme/web`.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Next.js API, Prisma/SQL `@am-sme/database`, `@am-sme/content-library`.

**Spec:** `MOD-PB-002` (Technical Specification Draft 1.0, Sections 9, 10, 11, 12, 13, 15, 19.4, 19.5, 20.4, 20.5, 20.6, 22.3).

## Global Constraints
- Browser profiles MUST be isolated per account at `storage/browser_profiles/<account_id>`. Never extract or store cookies/tokens/passwords.
- Never rotate accounts automatically when an account fails or hits a rate limit (`PB-SC-009`).
- Never auto-schedule or publish `DRAFT` or `POST_EXPIRED` posts (`PB-SC-003`, `PB-SC-010`).
- Block duplicate publishing on the same account within cooldown window (`minReuseDays`, default 30 days) (`PB-SC-001`, `PB-017`).
- Enforce `maxPostsPerDay` (default 2) and `minIntervalMinutes` (default 180 minutes) per account (`PB-SC-004`, `PB-SC-005`).

## Review Focus
1. Attempting to schedule a post on an account whose platform does not match or is not allowed by the post (`PLATFORM_NOT_ALLOWED`).
2. Attempting to schedule a post on an account that has `SESSION_EXPIRED` or `SUSPENDED` status (`ACCOUNT_NOT_READY`).
3. Attempting to schedule the same content (`contentId` or `contentHash`) on the same account within the 30-day reuse cooldown (`DUPLICATE_CONTENT_ON_ACCOUNT`).
4. Attempting to schedule a post within `minIntervalMinutes` of another scheduled job or exceeding `maxPostsPerDay` (`MIN_INTERVAL_VIOLATION` / `DAILY_QUOTA_EXCEEDED`).
5. Failing a job on one account must never automatically reassign the job to another account (`PB-SC-009`).

---

### Task 1: Platform Content Preparation, Scheduling Rules & Reuse Policy Engine (Sections 11, 13, 15)

**Files:**
- Create: `am-viettel-sme/packages/content-library/src/publishing-policy.ts`
- Modify: `am-viettel-sme/packages/content-library/src/index.ts`
- Modify: `am-viettel-sme/packages/content-library/package.json`
- Test: `am-viettel-sme/packages/content-library/test/publishing-policy.test.ts`

- [x] **Step 1.1: Write failing tests for Platform Formatting, Scheduling Rules & Reuse Policy (`PB-SC-001` to `PB-SC-010`)**
  - Format post for `ZALO` (compact paragraphs, max 3 hashtags, AM CTA) vs `FACEBOOK` (structured paragraphs, up to 5 hashtags).
  - Block duplicate post on same account within `minReuseDays` (`PB-SC-001`) while allowing different accounts (`PB-SC-002`) or after cooldown expires (`PB-SC-008`).
  - Block `DRAFT` (`PB-SC-003`) and `POST_EXPIRED` (`PB-SC-010`) posts.
  - Enforce `maxPostsPerDay` (`PB-SC-004`) and `minIntervalMinutes` (`PB-SC-005`).
  - Enforce account readiness (`ACTIVE` / `CONNECTED` required, block `SESSION_EXPIRED` / `PAUSED`, `PB-SC-006`, `PB-SC-007`).

- [x] **Step 1.2: Implement `preparePlatformContent` and `evaluatePublishingSchedule` in `packages/content-library/src/publishing-policy.ts`**

- [x] **Step 1.3: Run tests and verify GREEN**

---

### Task 2: Database Schema & Repository for Social Accounts, Campaigns, Schedules & Publishing Jobs (Sections 19.4, 19.5)

**Files:**
- Create migration: `am-viettel-sme/packages/database/prisma/migrations/20261106000400_pb_06_07_publishing_and_accounts/migration.sql`
- Modify: `am-viettel-sme/packages/database/prisma/schema.prisma`
- Modify: `am-viettel-sme/packages/database/src/content-library-repository.ts`
- Test: `am-viettel-sme/packages/database/test/publishing-repository.test.ts`

- [x] **Step 2.1: Write failing tests for SocialAccount, PublishingCampaign, PublishingSchedule, PublishingJob, PublishingJobStep & PublishingResult persistence**
  - Create & update `SocialAccount` with isolated `profileDir`, `maxPostsPerDay`, `minIntervalMinutes`, `preferredWindows`, and status transitions (`ACTIVE`, `NEEDS_AUTH`, `SESSION_EXPIRED`, `PAUSED`).
  - Create `PublishingCampaign` and `PublishingSchedule`.
  - Create `PublishingJob` with unique `idempotencyKey`, record `PublishingJobStep` (`VALIDATE_CONTENT`, `CHECK_SESSION`, `PREPARE_COMPOSER`, `SUBMIT_POST`), and record `PublishingResult`.
  - Verify failing a job on account A never mutates or creates a fallback job on account B (`PB-SC-009`).

- [x] **Step 2.2: Implement migration, Prisma models, and repository methods**

- [x] **Step 2.3: Run tests and verify GREEN**

---

### Task 3: Accounts, Calendar, Schedule & Publishing Jobs HTTP APIs (Sections 20.4, 20.5, 20.6)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/publishing-api.test.ts`

- [x] **Step 3.1: Write failing tests for `/api/v1/accounts/*` and `/api/v1/publishing/*` endpoints**
  - `GET /api/v1/accounts`, `POST /api/v1/accounts`, `GET /api/v1/accounts/:id`, `PATCH /api/v1/accounts/:id`
  - `POST /api/v1/accounts/:id/check-session`, `POST /api/v1/accounts/:id/pause`, `POST /api/v1/accounts/:id/resume`
  - `GET /api/v1/publishing/calendar`, `POST /api/v1/publishing/schedule`, `POST /api/v1/publishing/campaigns`
  - `GET /api/v1/publishing/jobs`, `GET /api/v1/publishing/jobs/:id`
  - `POST /api/v1/publishing/jobs/:id/approve`, `POST /api/v1/publishing/jobs/:id/confirm-assisted`, `POST /api/v1/publishing/jobs/:id/cancel`, `POST /api/v1/publishing/jobs/:id/retry`

- [x] **Step 3.2: Implement endpoints in `http-api.ts` and `demo-services.ts`**

- [x] **Step 3.3: Run tests and verify GREEN**

---

### Task 4: Full E2E Integration & Monorepo Verification

**Files:**
- Create: `am-viettel-sme/apps/web/test/pb-p06-p07-integration.test.ts`
- Update: `docs/superpowers/plans/2026-11-11-pb-p06-p07-accounts-calendar-publishing-queue.md`

- [x] **Step 4.1: Write E2E test: Register Social Account -> Verify Session -> Create Campaign -> Schedule Approved Post -> Enforce Duplicate/Quota Rules -> Assisted Publish Confirmation -> Result Tracking**
- [x] **Step 4.2: Run full monorepo test suite (`corepack pnpm test`) and confirm 100% GREEN**
