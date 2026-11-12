# Facebook Anti-Checkpoint & Campaign Streamlining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
Transform the automated publishing platform into a resilient, anti-checkpoint system by adding:
1. Spin-tax parser and dynamic variable substitutor (`{Chào|Kính gửi}`, `[TÊN_NHÓM]`).
2. Configurable dispatch delays (jitter/cooldown) and spin-tax preview in `FacebookAutoPosterView`.
3. 1-Click import from approved Google Docs Content Library (`MOD-PB-002`) into Master Posts.
4. Streamlining `Chiến dịch & CTV` to eliminate architectural duplication and enforce Zalo outreach anti-ban quotas (max 30 leads/batch, no 0-lead batch).

---

## File Structure & Responsibilities

| File Path | Responsibility |
| :--- | :--- |
| `packages/domain/src/messaging/spin-tax.ts` | Pure spin-tax engine parsing `{A\|B\|C}` syntax and replacing `[TÊN_NHÓM]`, `[NGÀY_THÁNG]`. |
| `packages/domain/test/spin-tax.test.ts` | Unit tests for spin-tax syntax, nesting, and dynamic variables. |
| `apps/web/src/ui/facebook-auto-poster-view.tsx` | UI additions: spin-tax preview, dispatch cooldown delay picker, and "📥 Chọn từ Thư viện Google Docs" dialog. |
| `apps/web/test/facebook-auto-poster-view.test.ts` | UI tests for spin-tax preview, delay selection, and Google Docs post selector. |
| `apps/web/src/ui/campaign-view.tsx` | Streamlined Campaign & Partner CRM view with sub-tabs and Zalo outreach anti-ban guard. |
| `apps/web/test/campaign-view.test.ts` | Verification for 0-lead blocking and quota ceiling (max 30 leads/batch). |

---

## Tasks

### Task 1: Spin-tax Engine & Dynamic Variables (`packages/domain`)
- [x] Write failing test in `packages/domain/test/spin-tax.test.ts` testing `{A|B|C}` resolution, nested spin-tax, and `[TÊN_NHÓM]` variable substitution.
- [x] Run test to confirm RED status.
- [x] Implement `resolveSpinTax(template: string, variables?: Record<string, string>): string` in `packages/domain/src/messaging/spin-tax.ts`.
- [x] Export from `packages/domain/src/index.ts`.
- [x] Run test to verify GREEN status.

### Task 2: Dispatch Cooldown (Jitter) & Spin-tax in Auto Poster Facebook
- [x] Write failing test in `apps/web/test/facebook-auto-poster-view.test.ts` for:
  - Choosing delay spacing (e.g. 60s, 120s, 180s) in Dispatch modal.
  - Live Spin-tax preview button in Dispatch modal.
  - Passing `delaySeconds` to `onDispatchPost`.
- [x] Run test to confirm RED status.
- [x] Implement delay dropdown & spin-tax preview in `FacebookAutoPosterView`.
- [x] Update `workspace-app.tsx` dispatch handler to pass `delaySeconds` and apply spin-tax per group.
- [x] Run test to verify GREEN status.

### Task 3: 1-Click Import from Google Docs Library (`MOD-PB-002`)
- [x] Write failing test in `apps/web/test/facebook-auto-poster-view.test.ts` for "📥 Chọn từ Thư viện Google Docs" modal.
- [x] Run test to confirm RED status.
- [x] Add `libraryPosts` prop to `FacebookAutoPosterView` (passed from `contentsList`).
- [x] Add modal to select any approved post (e.g. PB001, PB002) and copy it into Master Posts with 1 click.
- [x] Run test to verify GREEN status.

### Task 4: Streamline `Chiến dịch & CTV` & Zalo Outreach Anti-Ban Guard
- [x] Write failing test in `apps/web/test/mod-pc-003-ui.test.ts` ensuring:
  - Zalo outreach button is disabled when 0 leads selected, and shows validation error.
  - Quota is capped at max 30 leads/batch.
- [x] Run test to confirm RED status.
- [x] Implement validation and quota caps in `campaign-view.tsx` and `workspace-app.tsx`.
- [x] Implement sub-tab navigation (`Tất cả`, `Chiến dịch & Hội nhóm`, `Mạng lưới CTV & Đối soát`, `Tiếp cận Zalo Cá nhân`) to eliminate vertical page clutter.
- [x] Run test to verify GREEN status.

### Task 5: End-to-End Verification & Health Check
- [x] Run all test suites: `corepack pnpm test` (529 passed | 7 skipped across 94 test files).
- [x] Run TypeScript typecheck: `corepack pnpm typecheck` (0 errors).
- [x] Verify dev server health on `http://127.0.0.1:3000` (HTTP 200 OK).
