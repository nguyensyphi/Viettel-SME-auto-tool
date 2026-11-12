# PB-P08, PB-P09 & PB-P10: Desktop Publishing Assistant, Analytics & Telegram Notification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the final phases of Module 02 (`MOD-PB-002`, PB-P08, PB-P09, PB-P10 — Sections 14, 16, 17, 18, 20.7, 22.3): Desktop Publishing Assistant (`ASSISTED_PUBLISH` & `PREPARE_ONLY` modes with step callbacks & screenshot evidence), Personal Branding Telegram Notification Formatter & Dispatcher (never transmitting QR images or tokens), and Publishing Analytics & Reporting HTTP APIs (`/api/v1/analytics/publishing-summary`, `/api/v1/analytics/topics`, `/api/v1/analytics/accounts`).

**Architecture:** Enhance `@am-sme/browser-automation`'s `PublishingWorker` to support `PREPARE_ONLY` / `ASSISTED_PUBLISH` / `AUTO_PUBLISH` modes and step-by-step lifecycle callbacks; extend `@am-sme/telegram-bot` with Personal Branding notification builders (`formatPublishingNotification`, `formatMorningScheduleDigest`) guarded by `assertSafeTelegramText`; and expose `/api/v1/analytics/*` endpoints in `@am-sme/web`.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Next.js API, Playwright (`@am-sme/browser-automation`), `@am-sme/telegram-bot`, `@am-sme/database`.

**Spec:** `MOD-PB-002` (Technical Specification Draft 1.0, Sections 14, 16, 17, 18, 20.7, 22.3).

## Global Constraints
- Never transmit QR login images, session cookies, tokens, passwords, or PII over Telegram (`assertSafeTelegramText`).
- When a platform does not support safe auto-submit or is configured for `ASSISTED_PUBLISH` / `PREPARE_ONLY`, prepare the composer and wait for AM confirmation (`AWAITING_AM_CONFIRMATION`) while capturing screenshot evidence.
- Never rotate accounts on failure.

## Review Focus
1. Attempting to send a Telegram alert containing a QR image URL or base64 data URI must throw `FORBIDDEN_TELEGRAM_PAYLOAD`.
2. Executing a job in `PREPARE_ONLY` or `ASSISTED_PUBLISH` (without `amApprovedSubmission`) must populate the composer, take a draft screenshot, and return `AWAITING_AM_CONFIRMATION` without clicking submit.
3. Analytics summary must accurately aggregate counts by post status, job status (`PUBLISHED`, `QUEUED`, `WAITING_CONFIRMATION`, `FAILED`), topic distribution, and per-account publishing health.

---

### Task 1: Desktop Publishing Assistant Modes (`PREPARE_ONLY`, `ASSISTED_PUBLISH`, `AUTO_PUBLISH`) & Step Hooks (Section 14)

**Files:**
- Modify: `am-viettel-sme/packages/browser-automation/src/publishing-worker.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/publishing-worker.test.ts`

- [x] **Step 1.1: Write failing tests for `PREPARE_ONLY` / `ASSISTED_PUBLISH` modes and `onStep` execution trace callbacks**
- [x] **Step 1.2: Implement mode normalization and step callback hooks in `packages/browser-automation/src/publishing-worker.ts`**
- [x] **Step 1.3: Run tests and verify GREEN**

---

### Task 2: Personal Branding Telegram Notification Formatter & Dispatcher (Section 18, PB-016)

**Files:**
- Modify: `am-viettel-sme/packages/telegram-bot/src/alerts.ts`
- Test: `am-viettel-sme/packages/telegram-bot/test/bot.test.ts`

- [x] **Step 2.1: Write failing tests for Personal Branding Telegram alerts (`SESSION_EXPIRED`, `WAITING_AM_CONFIRMATION`, `JOB_FAILED`, `MORNING_SCHEDULE_DIGEST`) and QR/token leak prevention**
- [x] **Step 2.2: Implement `sendPublishingNotification` and `sendMorningScheduleDigest` in `packages/telegram-bot/src/alerts.ts`**
- [x] **Step 2.3: Run tests and verify GREEN**

---

### Task 3: Analytics & Reporting HTTP APIs (`/api/v1/analytics/*`, Section 17, 20.7, PB-015)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Test: `am-viettel-sme/apps/web/test/analytics-api.test.ts`

- [x] **Step 3.1: Write failing tests for `/api/v1/analytics/publishing-summary`, `/api/v1/analytics/topics`, and `/api/v1/analytics/accounts`**
- [x] **Step 3.2: Implement analytics endpoints in `apps/web/src/server/http-api.ts`**
- [x] **Step 3.3: Run tests and verify GREEN**

---

### Task 4: Full Module 02 End-to-End Integration & Monorepo Verification

**Files:**
- Create: `am-viettel-sme/apps/web/test/pb-p08-p09-p10-integration.test.ts`
- Update: `docs/superpowers/plans/2026-11-11-pb-p08-p09-p10-desktop-agent-analytics-telegram.md`

- [x] **Step 4.1: Write E2E test verifying full Module 02 lifecycle through Analytics & Telegram Notification dispatch**
- [x] **Step 4.2: Run full monorepo test suite (`corepack pnpm test`) and confirm 100% GREEN**
