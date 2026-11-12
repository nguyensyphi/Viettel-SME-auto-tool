# Facebook Dual-Channel Auto Poster, Media Enrichment & AI Lead Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Facebook Auto Posting into a dual-channel professional system (Hội nhóm Facebook vs Trang cá nhân & Fanpage), resolve media/photo attachment and group deletion UI issues, formalize account health lifecycle states, provide a 3-stage execution pipeline (Pre-flight, Stepper, Proof reporting), and integrate the 100-point AI Lead Scoring Engine aligned with the Viettel AM Growth master blueprint.

**Architecture:**
- **Domain Layer (`packages/domain`):** Pure TypeScript AI Lead Scoring engine implementing the 100-point rubric from Slide 4 (Industry 20pts, Established Age 15pts, Scale 15pts, Product Demand 25pts, Contact Info 15pts, Business Signals 10pts -> Tier A/B/C/D) and Viettel Product Matching matrix from Slide 3.
- **Browser Automation Layer (`packages/browser-automation`):** Account health state evaluator (`ACTIVE_OK`, `CHECKPOINT_2FA`, `SESSION_EXPIRED`, `RATE_LIMITED_BLOCK`, `WARMUP_NEW_NICK`), Fanpage & Personal Profile publisher (`facebook-page-publisher.ts`), and Screenshot Proof storage.
- **Backend API Layer (`apps/web/src/server/http-api.ts`):** Expose `/api/v1/fb-poster/dispatch-page-post`, `DELETE /api/v1/groups/:id`, lead scoring computation, and seed master posts with high-quality Viettel product banners.
- **Web UI Layer (`apps/web/src/ui/facebook-auto-poster-view.tsx`):** Dual sub-tabs (`👥 Đăng Hội Nhóm` & `📢 Đăng Fanpage & Cá Nhân`), rich media attachment/preview gallery with Viettel stock banners, Master Groups table with prominent "🗑️ Xóa" action, account health badge card, Pre-flight checklist modal, and Screenshot Proof popup.

**Tech Stack:** React 19, TypeScript 5.8, Next.js 15, Vitest, Playwright, Tailwind/Pure CSS Panels.

**Spec:** Slides 1-5 "VIETTEL AM GROWTH" & Master Plan `docs/master-plan/Code tool AM_compressed_1.pdf`.

---

## Global Constraints
- **Data Protection & PII:** Never store unmasked phone numbers in client payloads; use `maskPhone`.
- **Fail-Closed Posting Safety:** Anti-ban jitter delay (30s, 60s, 120s, 180s) strictly enforced; daily quota caps per account.
- **Playwright Profile Isolation:** User data directory strictly partitioned at `storage/browser_profiles/<account_id>`.
- **TDD Requirement:** Strictly write failing tests first (Red), implement code (Green), then refactor.

---

## Review Focus
1. **Empty / Missing Media Handling:** Master posts without media must render clean fallback placeholders and not throw DOM or network errors.
2. **Account Checkpoint Interruption:** If an account hits a Facebook checkpoint during dispatch, workers must transition account state to `CHECKPOINT_2FA` and halt gracefully without infinite retry loops.
3. **Group Deletion Cascade:** Deleting a group from Master Groups must remove it from active selection in the dispatch modal without state desynchronization.
4. **Dual-Channel Distinction:** Personal Profile posting must never attempt group composer selectors; Fanpage posting must support identity switching or direct page URL targeting.
5. **AI Lead Scoring Boundary Conditions:** Leads with incomplete data must receive "Chưa xác minh" flags without guessing or inflating scores beyond verified attributes.

---

### Task 1: AI Lead Scoring Engine (100-Point Rubric & Segment Matcher)

**Files:**
- Create: `am-viettel-sme/packages/domain/src/scoring/lead-scoring.ts`
- Modify: `am-viettel-sme/packages/domain/src/index.ts`
- Test: `am-viettel-sme/packages/domain/test/lead-scoring.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface LeadScoringInput {
    taxCode: string;
    companyName: string;
    establishedYear?: number;
    industry?: string;
    employeeCount?: number;
    hasPhone: boolean;
    hasEmail: boolean;
    hasWebsite: boolean;
    recentBusinessSignals?: string[];
  }
  export type LeadScoreTier = "A" | "B" | "C" | "D";
  export interface LeadScoreBreakdown {
    industryScore: number;       // max 20
    establishmentScore: number;  // max 15
    scaleScore: number;          // max 15
    productDemandScore: number;  // max 25
    contactInfoScore: number;    // max 15
    businessSignalScore: number; // max 10
    totalScore: number;          // max 100
    tier: LeadScoreTier;         // A: 80-100, B: 60-79, C: 40-59, D: <40
    recommendedProducts: string[];
    tierExplanation: string;
  }
  export function computeLeadScore(input: LeadScoringInput): LeadScoreBreakdown;
  ```

- [ ] **Step 1: Write failing unit test for `computeLeadScore`**
- [ ] **Step 2: Run test to verify failure (`corepack pnpm --filter @am-viettel-sme/domain test`)**
- [ ] **Step 3: Implement `computeLeadScore` in `packages/domain/src/scoring/lead-scoring.ts`**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Export from `packages/domain/src/index.ts`**

---

### Task 2: Account Health Lifecycle & Fanpage/Profile Publisher Engine

**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/facebook-page-publisher.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/facebook-publisher.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/index.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/facebook-page-publisher.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type FacebookAccountHealth =
    | "ACTIVE_OK"
    | "CHECKPOINT_2FA"
    | "SESSION_EXPIRED"
    | "RATE_LIMITED_BLOCK"
    | "WARMUP_NEW_NICK";

  export interface PagePublishInput {
    accountId: string;
    targetType: "PERSONAL_WALL" | "FANPAGE";
    targetUrl?: string; // Fanpage URL or timeline
    content: string;
    mediaPaths?: string[];
    callToActionUrl?: string;
  }
  export interface PagePublishResult {
    success: boolean;
    postUrl?: string;
    screenshotProofPath?: string;
    healthStatus: FacebookAccountHealth;
    error?: string;
  }
  export function publishToFacebookPageOrWall(input: PagePublishInput): Promise<PagePublishResult>;
  ```

- [ ] **Step 1: Write unit tests for `publishToFacebookPageOrWall` and health classification**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement `facebook-page-publisher.ts`**
- [ ] **Step 4: Run test to verify pass**
- [ ] **Step 5: Export from `packages/browser-automation/src/index.ts`**

---

### Task 3: Backend API Endpoints & Rich Seed Posts

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Test: `am-viettel-sme/apps/web/test/http-api.test.ts`

**Details:**
- Seed posts must include valid media paths with professional Viettel solution visuals (Viettel-CA, S-Invoice, vContract, FTTH Biz).
- Expose `POST /api/v1/fb-poster/dispatch-page-post` for personal wall / fanpage publishing.
- Support `DELETE /api/v1/groups/:id` to permanently delete group targets.
- Support `POST /api/v1/leads/:id/evaluate-score` using `computeLeadScore`.

- [ ] **Step 1: Write integration tests for new endpoints in `http-api.test.ts`**
- [ ] **Step 2: Run test to verify failure**
- [ ] **Step 3: Implement endpoints and enrich seed posts with media in `http-api.ts`**
- [ ] **Step 4: Run test to verify pass**

---

### Task 4: Frontend UI Enhancement (`facebook-auto-poster-view.tsx` & `workspace-app.tsx`)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/facebook-auto-poster-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/facebook-auto-poster-view.test.ts`

**Key UI Deliverables:**
1. **Sub-Tab Navigation:**
   - Tab 1: `👥 Đăng Hội Nhóm (Group Poster)`
   - Tab 2: `📢 Đăng Trang Cá Nhân & Fanpage (Profile & Page Poster)`
2. **Kho Bài Viết Mẫu (Master Posts):**
   - High-fidelity thumbnail rendering with image counter (`+N`).
   - Click to zoom / preview modal for attached images.
   - Quick Viettel stock image selectors in "Thêm bài viết mẫu mới" (1-click attach: CA, S-Invoice, vContract, FTTH graphics).
3. **Danh Sách Nhóm Mục Tiêu (Master Groups):**
   - Clear "Thao tác" column with a prominent red "🗑️ Xóa" button and window confirmation.
4. **Account Health Card:**
   - Visible badge for `ACTIVE_OK` (🟢), `CHECKPOINT_2FA` (🔴), `SESSION_EXPIRED` (🟡), `RATE_LIMITED_BLOCK` (🟠), `WARMUP_NEW_NICK` (🔵).
   - Direct button "🌐 Mở Chrome giải quyết" with account tooltip.
5. **3-Stage Pipeline Elements:**
   - Pre-flight checklist modal (Spin-tax test, delay setting, daily quota estimate).
   - 4-step transparent progress stepper on dispatch.
   - Proof viewer modal for screenshot proof & retry button for failed entries.

- [ ] **Step 1: Write failing UI component tests in `facebook-auto-poster-view.test.ts`**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement dual-tab, media gallery, delete action, account health badge, and proof modal**
- [ ] **Step 4: Connect props in `workspace-app.tsx`**
- [ ] **Step 5: Run tests to verify pass**

---

### Task 5: End-to-End Verification & Health Inspection

**Files:**
- Run: `am-viettel-sme/apps/web/test/ui-health-inspector.test.ts`
- Run: `am-viettel-sme/packages/browser-automation/test/ui-smoke-runner.test.ts`
- Run: `pnpm test:ui-e2e` against live localhost:3000

- [ ] **Step 1: Run full Vitest suite (`corepack pnpm test`) across all 96+ test suites**
- [ ] **Step 2: Run typecheck (`corepack pnpm typecheck`)**
- [ ] **Step 3: Run Playwright Visual Smoke (`pnpm test:ui-e2e`) and inspect screenshots in `storage/reports/ui-audit/`**
- [ ] **Step 4: Verify zero console errors, zero broken images, and proper Vietnamese typography**

