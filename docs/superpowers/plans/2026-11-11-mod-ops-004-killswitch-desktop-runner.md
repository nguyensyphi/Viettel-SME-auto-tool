# Module 04: Operations Control Center, Kill Switch UI & Desktop Agent Runner (`MOD-OPS-004`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the final operational layer (`MOD-OPS-004`) by delivering `DesktopAgentRunner` (`@am-sme/browser-automation`) and the Web Dashboard Operations Control Panel (`KillSwitch` & `CircuitBreaker` management in `@am-sme/web`).

**Architecture:**
- **Desktop Agent Runner (`@am-sme/browser-automation`):** Orchestrates polling `QUEUED` jobs, checking the global `KillSwitchController`, executing jobs through `PublishingWorker`, persisting job steps/status, and dispatching safe Telegram notifications (`SESSION_EXPIRED`, `WAITING_CONFIRMATION`, `PUBLISHED`, `FAILED`).
- **Operations Control APIs & UI (`@am-sme/web`):** Expose `/api/v1/ops/status`, `/api/v1/ops/kill-switch`, and `/api/v1/social-accounts/:id/reset-circuit` in `http-api.ts` and `operations-hub.ts`, and render the **System Kill Switch & Circuit Breaker Control Panel** inside `AccountsView`.

**Tech Stack:** TypeScript, Node.js 22+, Playwright, React 19, Vitest, Testing Library.

---

### Task 1: `DesktopAgentRunner` in `@am-sme/browser-automation`

**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/desktop-agent-runner.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/index.ts`
- Create: `am-viettel-sme/packages/browser-automation/test/desktop-agent-runner.test.ts`

- [x] **Step 1.1 (RED):** Write failing unit tests in `packages/browser-automation/test/desktop-agent-runner.test.ts` covering kill-switch halt, job polling, step recording, and notification dispatch.
- [x] **Step 1.2 (GREEN):** Implement `DesktopAgentRunner` in `packages/browser-automation/src/desktop-agent-runner.ts` and export in `src/index.ts`.
- [x] **Step 1.3 (VERIFY):** Run `corepack pnpm vitest run packages/browser-automation/test/desktop-agent-runner.test.ts packages/browser-automation/test/publishing-worker.test.ts`.

---

### Task 2: Operations Control Center APIs & Kill Switch / Circuit Breaker UI (`@am-sme/web`)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/ui/accounts-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Create: `am-viettel-sme/apps/web/test/mod-ops-004-ui-api.test.ts`

- [x] **Step 2.1 (RED):** Write failing API + UI tests in `apps/web/test/mod-ops-004-ui-api.test.ts` covering `GET /api/v1/ops/status`, `POST /api/v1/ops/kill-switch`, `POST /api/v1/social-accounts/:id/reset-circuit`, and the `AccountsView` Kill Switch & Circuit Breaker controls.
- [x] **Step 2.2 (GREEN):** Implement the operations hub state, HTTP API endpoints, and `AccountsView` / `WorkspaceApp` UI wiring.
- [x] **Step 2.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/mod-ops-004-ui-api.test.ts apps/web/test/full-system-e2e.test.ts`.
