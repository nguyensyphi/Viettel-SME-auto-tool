# Comprehensive UX Synchronization & Operational Logic Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
Re-audit and enhance the Viettel AM platform's UI/UX to ensure airtight synchronization across all 8 modules, eliminate missing/redundant elements, enforce cross-tab cache invalidation on mutations, complete the end-to-end partner referral conversion lifecycle, polish error feedback, and add quick search/filtering and KPI metrics.

---

## Identified Issues & Required Fixes

1. **Reactive Cross-Tab Cache Invalidation & Force Reload on Mutations** (`workspace-app.tsx`):
   - Currently, `CACHE_TTL_MS = 60_000` causes `loadTab` to return early if cached within 60s.
   - All mutation handlers omitted `{ force: true }`, leaving the UI stale after actions.
   - Create `invalidateTabs(...tabNames)` to wipe cache timestamps for affected tabs.
   - Every mutating handler must invalidate dependent tabs and call `loadTab(currentTab, { force: true })`.

2. **Complete Partner Referral Conversion Lifecycle & Referral Table** (`campaign-view.tsx`, `workspace-app.tsx`):
   - Add a dedicated "Danh sách Giới thiệu SME (Referrals)" table displaying all registered referrals with status (`REFERRED` vs `CONVERTED`).
   - Add a "Chốt Hợp đồng & Tính Hoa hồng" action modal/button for `REFERRED` items that invokes `onRecordConversion`.
   - Wire `onRecordConversion` in `workspace-app.tsx` to `POST /api/v1/partners/conversions`.

3. **Polished Import Excel Commit UX & Seamless Navigation** (`workspace-app.tsx`):
   - Replace raw `{JSON.stringify(state.commitResult)}` with a styled success banner showing count of imported leads.
   - Invalidate `leads`, `home`, and `planner` tabs upon commit.
   - Add a prominent CTA button: `[👉 Xem danh sách Lead mới]` that switches to the `leads` tab and force reloads fresh data.

4. **Correct API Health Ping Endpoints** (`ui-health-inspector.tsx`):
   - Fix `/api/v1/content/posts` -> `/api/v1/contents`.
   - Fix `/api/v1/fb-poster/accounts` -> `/api/v1/social-accounts`.

5. **Lead Search and Tier/Stage Filter Controls** (`workspace-app.tsx`):
   - Add real-time text filter (company name, tax code) and Tier dropdown (All, Tier A, Tier B, Tier C, Tier D) to `LeadList`.

6. **Top Stats KPI Row on Dashboard** (`workspace-app.tsx`):
   - Add quick KPI overview cards to `TodayDashboard`: Active Leads by Tier, Connected Social Accounts, Scheduled Posts, and System Kill Switch status.

7. **Sidebar Messaging & User-Facing Error Translations** (`workspace-app.tsx`):
   - Update sidebar text to reflect multi-channel capabilities: "Tự động hoá SME Viettel: Facebook, Zalo, Google Drive & Excel".
   - Expand `formatUserFacingError` to translate operational errors: `KILL_SWITCH_ACTIVE`, `CIRCUIT_BREAKER_OPEN`, `ACCOUNT_NOT_CONNECTED`, `DUPLICATE_TAX_CODE`, `OUTREACH_BUSY`, `INVALID_LEAD_PHONE`.

---

## Tasks

- [ ] Task 1: Fix Core API Ping URLs in `ui-health-inspector.tsx` & write unit test.
- [ ] Task 2: Implement reactive cache invalidation (`invalidateTabs`) and force-reload across all mutating handlers in `workspace-app.tsx`.
- [ ] Task 3: Complete Partner Referral Conversion UI in `campaign-view.tsx` and wire `onRecordConversion` in `workspace-app.tsx`.
- [ ] Task 4: Polish Import Excel Commit state with formatted summary and "Xem danh sách Lead" CTA button.
- [ ] Task 5: Add Lead Search & Filter controls to `LeadList` in `workspace-app.tsx`.
- [ ] Task 6: Add Top Stats KPI overview cards to `TodayDashboard` and update sidebar copy.
- [ ] Task 7: Expand `formatUserFacingError` with operational error translations.
- [ ] Task 8: Run full Vitest suite and Playwright UI visual smoke runner to verify 100% PASS with zero errors.

