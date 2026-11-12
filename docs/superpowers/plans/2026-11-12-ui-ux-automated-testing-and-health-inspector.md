# Automated UI/UX Testing & Health Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a comprehensive dual-layer UI/UX verification mechanism: an in-app interactive diagnostic panel (UI/UX Health Inspector) and an automated Playwright visual smoke test runner with full-page screenshot capture.

**Architecture:** 
1. Client-side `UIHealthInspector` modal in `apps/web` that scans live DOM assets, ping APIs, checks layout overflow, and verifies form validation states with a visual scorecard.
2. CLI Playwright E2E visual runner (`scripts/run-ui-smoke.ts`) that launches a real Chromium browser against the live Next.js server, traverses all 8 tabs, asserts zero console errors / zero broken `<img>` elements / zero horizontal overflow, and captures full-page screenshot audits into `storage/reports/ui-audit/`.

**Tech Stack:** React 19, TypeScript 5.9, Playwright-core, Vitest 3.2, @testing-library/react.

**Spec:** Approved Design Specification in conversation (Option 3: Hybrid CLI Playwright E2E + In-App UI/UX Inspector).

## Global Constraints
- Node version: Node.js 22+.
- Package manager: `corepack pnpm` in `am-viettel-sme/`.
- Local-first architecture: Zero external telemetry or third-party tracking.
- Test runner: Vitest (`corepack pnpm test`) strictly enforcing TDD (RED-GREEN-REFACTOR).
- Fail-closed security and data minimization (no raw PII stored or surfaced in reports).

## Review Focus
1. **Broken Image / Missing Asset Detection:** Thẻ `<img>` có nguồn rỗng hoặc `naturalWidth === 0` phải bị gắn cờ FAILED ngay lập tức.
2. **Console Error Isolation:** Mọi lỗi unhandled JS error (`console.error`, uncaught exception) trong quá trình chuyển tab phải được ghi nhận và báo cáo.
3. **Viewport Overflow:** Không cho phép thanh cuộn ngang ngoài ý muốn xuất hiện (`document.body.scrollWidth > window.innerWidth`).
4. **Non-destructive Diagnostic:** Bộ kiểm tra sức khỏe UI không được thực hiện bất kỳ hành vi ghi đè hoặc xoá dữ liệu thật (chỉ dùng read-only pings hoặc rollback mocks).
5. **Safe Screenshot Storage:** Ảnh chụp lưu trữ cục bộ tại `storage/reports/ui-audit/`, tự động tạo thư mục nếu chưa tồn tại.

---

## Tasks

### Task 1: In-App UI/UX Health Inspector Component & Unit Tests (TDD)
**Files:**
- Create: `am-viettel-sme/apps/web/test/ui-health-inspector.test.ts`
- Create: `am-viettel-sme/apps/web/src/ui/ui-health-inspector.tsx`

- [x] Write failing unit test in `apps/web/test/ui-health-inspector.test.ts` testing:
  - Renders Inspector modal when `isOpen = true`.
  - Runs automated checks on mount or click "⚡ Chạy kiểm tra UI/UX":
    - API health (mocked endpoints `/auth/me`, `/leads`, `/campaigns-overview`, `/content/posts`, `/fb-poster/accounts`).
    - Asset integrity (scans `<img>` elements on DOM).
    - Viewport overflow check.
  - Displays summary metrics (Total, Passed, Warnings, Failed) and itemized checklist.
- [x] Run test to verify RED status.
- [x] Implement `UIHealthInspector` component in `apps/web/src/ui/ui-health-inspector.tsx`.
- [x] Run test to verify GREEN status.

### Task 2: Integrate UI/UX Health Inspector into Header & Navigation
**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Modify: `am-viettel-sme/apps/web/test/workspace-ui.test.tsx`

- [x] Write failing test in `apps/web/test/workspace-ui.test.tsx` checking:
  - Header contains "🔍 Kiểm tra UI/UX" button.
  - Clicking button opens the `UIHealthInspector` modal dialog.
- [x] Run test to verify RED status.
- [x] Update `workspace-app.tsx` to render the button in top header bar and toggle `UIHealthInspector` modal state.
- [x] Run test to verify GREEN status.

### Task 3: Playwright E2E Visual Smoke Runner Engine
**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/ui-smoke-runner.ts`
- Create: `am-viettel-sme/packages/browser-automation/test/ui-smoke-runner.test.ts`

- [x] Implement failing test in `packages/browser-automation/test/ui-smoke-runner.test.ts` testing tabs audit, console error recording, broken images check, overflow detection, and screenshot outputs.
- [x] Run test to verify RED status.
- [x] Implement `runUISmokeAudit` and `formatUISmokeSummary` in `packages/browser-automation/src/ui-smoke-runner.ts`.
- [x] Export from `packages/browser-automation/src/index.ts`.
- [x] Run test to verify GREEN status.

### Task 4: NPM Script Configuration & Runner Execution
**Files:**
- Modify: `am-viettel-sme/package.json`
- Create: `am-viettel-sme/scripts/run-ui-smoke.ts`

- [x] Add `"test:ui-e2e": "tsx scripts/run-ui-smoke.ts"`.
- [x] Execute `corepack pnpm test:ui-e2e` against active dev server at `http://127.0.0.1:3000`.
- [x] Verify 8 screenshots are generated in `am-viettel-sme/storage/reports/ui-audit/`.

### Task 5: End-to-End Verification & Health Check
- [x] Run all unit & integration test suites: `corepack pnpm test` (535 passed, 7 skipped across 96 test files).
- [x] Run TypeScript typecheck: `corepack pnpm typecheck` (0 errors).
- [x] Execute Playwright visual smoke suite: `corepack pnpm test:ui-e2e` (8/8 tabs PASS, 0 console errors, 0 broken images, 0 overflow, 8 screenshots saved).
- [x] Confirm dev server continues running normally on `http://127.0.0.1:3000` (HTTP 200 OK).
