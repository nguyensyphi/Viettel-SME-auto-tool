# Facebook Group Auto-Poster Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the battle-tested Facebook group posting engine from `fb-auto-poster` into Viettel AM SME Platform (`@am-sme/browser-automation`, `@am-sme/campaigns`, and `@am-sme/web`), enabling AMs to select accounts and target groups, execute real Playwright group publishing with checkpoint detection & GraphQL permalink capture, and monitor group posting logs with live statuses and post links.

**Architecture:**
- **Group Publisher Engine (`@am-sme/browser-automation`):** Port `fb-auto-poster`'s `facebook_poster.py` into `publishToFacebookGroup`, featuring confirm-identity handling, 10-selector composer trigger, React input activation, dual media upload, GraphQL & toast permalink capture, and pending moderation detection.
- **Campaign Job Execution & Queue (`@am-sme/campaigns` & `@am-sme/web`):** Upgrade `CampaignManager` and `WorkspaceOperationsHub` to store dispatched group jobs, enforce duplicate post window checks, and execute jobs through `PublishingWorker`.
- **Campaign UI & Live Log Monitor (`@am-sme/web`):** Upgrade `CampaignView` and `WorkspaceApp` with an interactive **Dispatch Modal** (account picker, group checklist, delay config), bulk Facebook group URL importer, and a live **Group Posting Execution Log Table** with direct post URLs and retry actions.

**Tech Stack:** TypeScript, Node.js 22+, Playwright, React 19, Vitest, Testing Library.

**Spec / Reference:**
- `am-viettel-sme/fb-auto-poster/bot/engines/facebook_poster.py`
- `am-viettel-sme/fb-auto-poster/bot/bot.py`
- `docs/specs/` & Master Plan Module 03 (`MOD-PC-003`).

## Global Constraints
- **Data Minimization & PII:** Never embed CCCD/CMND numbers or raw birth dates into group posts.
- **Playwright Profile Isolation:** Use isolated persistent context per account at `storage/browser_profiles/<account_id>`. Never use shared cookies or proxy bypassing.
- **Fail-Closed Safety:** Halt immediately if account checkpoint or suspension is detected, or if system kill switch is active.
- **Strict TDD:** Write failing tests first (RED), then implement (GREEN), then verify (REFACTOR).

## Review Focus
1. **Confirm Identity Modal**: Facebook frequently presents "Tiếp tục dưới tên..." on group entry; must be handled without timing out.
2. **Dynamic Group Layouts**: Some groups use discussion tab, buy/sell format, or public post composer; all 10 selectors must be tried gracefully.
3. **React State Binding**: Plain DOM text insertion fails to activate the "Đăng" button; must use `insert_text` with keypresses.
4. **GraphQL Link Capture**: If post URL is not shown in a toast, network response parser must extract the permalink.
5. **Pending Moderation Handling**: Group posts requiring admin approval must be marked as `PENDING_APPROVAL` with group reference rather than marked as failed.

---

### Task 1: `publishToFacebookGroup` Engine in `@am-sme/browser-automation`

**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/publishers/facebook-group-publisher.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/publishing-worker.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/index.ts`
- Create: `am-viettel-sme/packages/browser-automation/test/facebook-group-publisher.test.ts`

- [x] **Step 1.1 (RED):** Write failing unit tests in `packages/browser-automation/test/facebook-group-publisher.test.ts` covering:
  - Identity confirmation ("Tiếp tục dưới tên") click.
  - Checkpoint / suspension detection throwing `CHECKPOINT_DETECTED`.
  - Composer opening across diverse group layouts (discussion, buy/sell, public post).
  - React input activation and image file attachments.
  - Post verification via GraphQL network interception and pending moderation detection.
- [x] **Step 1.2 (GREEN):** Implement `publishToFacebookGroup` in `packages/browser-automation/src/publishers/facebook-group-publisher.ts`.
- [x] **Step 1.3 (GREEN):** Wire `publishToFacebookGroup` into `PublishingWorker.executePublishingJob` when `job.targetGroupUrl` is provided, returning `publishedUrl` and capturing pending approval. Export in `packages/browser-automation/src/index.ts`.
- [x] **Step 1.4 (VERIFY):** Run `corepack pnpm vitest run packages/browser-automation/test/facebook-group-publisher.test.ts packages/browser-automation/test/publishing-worker.test.ts`.

---

### Task 2: Group Campaign Dispatch & Execution Hub in `@am-sme/web`

**Files:**
- Modify: `am-viettel-sme/packages/campaigns/src/campaign-manager.ts`
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Create: `am-viettel-sme/apps/web/test/group-posting-operations.test.ts`

- [x] **Step 2.1 (RED):** Write failing integration tests in `apps/web/test/group-posting-operations.test.ts` verifying:
  - `POST /api/v1/campaigns/:id/dispatch` with custom `accountId` and `groupIds` creates queued group posting jobs.
  - `GET /api/v1/campaigns/group-jobs` returns the list of group posting jobs with status, group URL, account, and post URL.
  - `POST /api/v1/campaigns/group-jobs/:id/run` executes the job and updates status to `PUBLISHED` or `PENDING_APPROVAL` with `publishedUrl`.
  - `POST /api/v1/groups/bulk-import` parses multiple Facebook group URLs at once and deduplicates.
- [x] **Step 2.2 (GREEN):** Update `WorkspaceOperationsHub` with:
  - `groupPostingJobs: Map<string, GroupPostingJobRecord>`
  - `dispatchCampaignJobs(workspaceId, campaignId, accountId, groupIds, dispatchDate)`
  - `listGroupPostingJobs(workspaceId, campaignId?)`
  - `executeGroupPostingJob(workspaceId, jobId)`
  - `bulkRegisterGroups(workspaceId, urls, platform)`
- [x] **Step 2.3 (GREEN):** Route endpoints in `apps/web/src/server/http-api.ts`.
- [x] **Step 2.4 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/group-posting-operations.test.ts`.

---

### Task 3: Group Dispatch Modal, Live Logs & Bulk Import UI in `@am-sme/web`

**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/campaign-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Create: `am-viettel-sme/apps/web/test/group-posting-ui.test.ts`

- [x] **Step 3.1 (RED):** Write UI test in `apps/web/test/group-posting-ui.test.ts` testing:
  - Clicking "Điều phối đăng nhóm" opens the Dispatch Modal allowing account selection and group checklists.
  - Confirming dispatch calls `onDispatchCampaign` with selected account and group IDs.
  - Group Posting Monitor table displays dispatched jobs, their status badges, and clickable post URLs.
  - Clicking "Chạy đăng bài" triggers job execution and updates the row.
  - Bulk group importer textarea adds multiple Facebook group links.
- [x] **Step 3.2 (GREEN):** Implement Dispatch Modal, Group Posting Monitor table, and Bulk Group Importer inside `apps/web/src/ui/campaign-view.tsx` and wire in `apps/web/src/ui/workspace-app.tsx`.
- [x] **Step 3.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/group-posting-ui.test.ts apps/web/test/full-system-e2e.test.ts`.

---

### Task 4: Full System Verification & Regression Gate

- [x] **Step 4.1:** Run full monorepo typecheck: `corepack pnpm typecheck`.
- [x] **Step 4.2:** Run full regression suite: `corepack pnpm vitest run`.
- [x] **Step 4.3:** Verify live on Web Dashboard (`http://127.0.0.1:3000`) and update plan checkboxes.
