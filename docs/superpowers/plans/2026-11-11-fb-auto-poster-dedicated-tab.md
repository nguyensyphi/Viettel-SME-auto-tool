# Facebook Auto Poster Dedicated Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a dedicated, first-class "Auto Poster Facebook" tab on the left sidebar of the Viettel AM SME dashboard, bringing the exact operational workflow from `fb-auto-poster` (`Master_Posts`, `Master_Groups`, nick selector, 1-click Playwright runner, and real-time `posting_log` table with direct post links).

**Architecture:**
- **UI Component (`@am-sme/web`):** Create `FacebookAutoPosterView` in `apps/web/src/ui/facebook-auto-poster-view.tsx`, featuring metrics counters, Master Posts management, Master Groups list with bulk URL paste importer, and live Playwright execution log table with direct clickable post links.
- **Navigation & Workspace Integration (`@am-sme/web`):** Add `fb-poster` ("Auto Poster Facebook") to the sidebar menu in `WorkspaceApp` (`apps/web/src/ui/workspace-app.tsx`), wire data loading for accounts, groups, campaigns, and group posting jobs.
- **Operations & API Enhancements:** Support quick 1-click group post dispatch directly from any Master Post to selected target groups without requiring separate campaign approvals.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Playwright.

**Spec / Reference:**
- `am-viettel-sme/fb-auto-poster/data/Master_Posts.xlsx`
- `am-viettel-sme/fb-auto-poster/data/Master_Groups.xlsx`
- `am-viettel-sme/fb-auto-poster/data/posting_log.xlsx`
- `am-viettel-sme/fb-auto-poster/bot/bot.py`

## Global Constraints
- **Data Minimization & PII:** Never embed CCCD/CMND numbers or raw customer data in Facebook group posts.
- **Playwright Profile Isolation:** Use isolated persistent context per account at `storage/browser_profiles/<account_id>`.
- **Fail-Closed Safety:** Halt immediately if account checkpoint is detected or if kill switch is active.
- **Strict TDD:** Write failing tests first (RED), then implement (GREEN), then verify (REFACTOR).

## Review Focus
1. **Sidebar Navigation**: Clicking "Auto Poster Facebook" must navigate to `fb-poster` tab and persist selection.
2. **Account Selection**: AM can choose from connected Facebook accounts (`fb-viettel-sme`, clone nicks).
3. **1-Click Dispatch**: Selecting a Master Post and target groups instantly enqueues group posting jobs.
4. **Live Execution & Logs**: Clicking "Chạy đăng bài" immediately runs the job and updates status to `PUBLISHED` or `PENDING_APPROVAL` with direct permalink.
5. **Bulk Group Import**: AM can paste multiple Facebook group URLs at once to populate Master Groups.

---

### Task 1: Dedicated `FacebookAutoPosterView` Component

**Files:**
- Create: `am-viettel-sme/apps/web/src/ui/facebook-auto-poster-view.tsx`
- Create: `am-viettel-sme/apps/web/test/facebook-auto-poster-view.test.ts`

- [x] **Step 1.1 (RED):** Write failing UI tests in `apps/web/test/facebook-auto-poster-view.test.ts` covering:
  - Header rendering with account selector and status metrics.
  - Master Posts list and form to create a new post with title and content.
  - Master Groups list and bulk group URL import form.
  - 1-Click dispatch modal: choosing a post and target groups, calling `onDispatchPost`.
  - Live posting log table displaying status badges, direct post URLs, and "Chạy đăng bài" button calling `onRunJob`.
- [x] **Step 1.2 (GREEN):** Implement `FacebookAutoPosterView` in `apps/web/src/ui/facebook-auto-poster-view.tsx`.
- [x] **Step 1.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/facebook-auto-poster-view.test.ts`.

---

### Task 2: Direct Post Dispatch API & Operations Support

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/test/group-posting-operations.test.ts`

- [x] **Step 2.1 (RED):** Add integration test in `apps/web/test/group-posting-operations.test.ts` for `POST /api/v1/fb-poster/dispatch-post` allowing immediate group posting job creation with `{ accountId, postTitle, content, groupIds, mediaPaths }`.
- [x] **Step 2.2 (GREEN):** Implement `dispatchDirectGroupPost` in `WorkspaceOperationsHub` and route in `http-api.ts`.
- [x] **Step 2.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/group-posting-operations.test.ts`.

---

### Task 3: Sidebar Integration in `WorkspaceApp`

**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Modify: `am-viettel-sme/apps/web/test/full-system-e2e.test.ts`

- [x] **Step 3.1 (RED):** Add test case in `apps/web/test/full-system-e2e.test.ts` checking that "Auto Poster Facebook" exists in sidebar and renders `FacebookAutoPosterView` when clicked.
- [x] **Step 3.2 (GREEN):** Update `WorkspaceApp` in `apps/web/src/ui/workspace-app.tsx`:
  - Add tab `"fb-poster"` with label `"Auto Poster Facebook"` to sidebar.
  - In `loadTab("fb-poster")`, load accounts, groups, campaigns/posts, and groupJobs.
  - Render `FacebookAutoPosterView` with all action handlers wired (`onDispatchPost`, `onRunJob`, `onBulkImportGroups`, `onCreatePost`, `onRegisterGroup`).
- [x] **Step 3.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/full-system-e2e.test.ts`.

---

### Task 4: Full System Verification

- [x] **Step 4.1:** Run full monorepo typecheck: `corepack pnpm typecheck`.
- [x] **Step 4.2:** Run full regression test suite: `corepack pnpm vitest run`.
- [x] **Step 4.3:** Verify live dashboard view and update plan checkboxes.
