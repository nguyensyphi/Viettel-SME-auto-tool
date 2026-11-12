# Module 03: Partner & Group Campaign Automation (`MOD-PC-003`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver end-to-end persistence, domain rules, and REST APIs for Module 03 (`MOD-PC-003` — Partner & Group Campaign Automation: `PC-P01`, `PC-P02`, `PC-P03`).

**Architecture:**
- **Domain (`@am-sme/campaigns`):** Enhance `PartnerCrmService`, `GroupManager`, and `CampaignManager` with cross-partner tax code deduplication (`DUPLICATE_REFERRAL_TAX_CODE`), referral/conversion listing, and Partner & Group Channel Analytics (`computePartnerChannelAnalytics`).
- **Database (`@am-sme/database`):** Add PostgreSQL schema & Prisma models (`CommunityGroup`, `GroupCampaign`, `GroupPostJob`, `PartnerLead`, `PartnerReferral`, `PartnerConversion`) and `PartnerCampaignsRepository` tested against PGlite.
- **Web API (`@am-sme/web`):** Expose `/api/v1/groups`, `/api/v1/campaigns/:id/dispatch`, `/api/v1/partners`, `/api/v1/partners/:id/referrals`, `/api/v1/partners/:id/reconciliation`, `/api/v1/partners/conversions`, `/api/v1/partners/conversions/:id/payout`, and `/api/v1/analytics/partners` while preserving 100% backward compatibility with existing `/api/v1/campaigns-overview`, `/api/v1/campaigns`, and `/api/v1/partners` endpoints.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, PostgreSQL / Prisma / PGlite, Next.js App Router (`http-api.ts`).

---

### Task 1: Domain Enhancements for `MOD-PC-003` (`@am-sme/campaigns`)

**Files:**
- Modify: `am-viettel-sme/packages/campaigns/src/partner-crm.ts`
- Create: `am-viettel-sme/packages/campaigns/test/mod-pc-003-domain.test.ts`

- [x] **Step 1.1 (RED):** Write failing tests in `am-viettel-sme/packages/campaigns/test/mod-pc-003-domain.test.ts` covering:
  - Cross-partner duplicate tax code rejection (`DUPLICATE_REFERRAL_TAX_CODE`) when a second partner refers an already-referred `normalizedTaxCode`.
  - Listing referrals (`listReferrals`) and conversions (`listConversions`) with optional `partnerId` filter.
  - Computing Partner & Group channel analytics (`getPartnerChannelAnalytics` with group category counts).
- [x] **Step 1.2 (GREEN):** Implement cross-partner tax code deduplication, `listReferrals`, `listConversions`, and `getPartnerChannelAnalytics` in `am-viettel-sme/packages/campaigns/src/partner-crm.ts`.
- [x] **Step 1.3 (VERIFY):** Run `corepack pnpm vitest run packages/campaigns/test/mod-pc-003-domain.test.ts packages/campaigns/test/partner-crm.test.ts packages/campaigns/test/campaign-manager.test.ts`.

---

### Task 2: PostgreSQL Migration & `PartnerCampaignsRepository` (`@am-sme/database`)

**Files:**
- Create: `am-viettel-sme/packages/database/prisma/migrations/20261106000500_pc_01_03_partner_and_group_campaigns/migration.sql`
- Modify: `am-viettel-sme/packages/database/prisma/schema.prisma`
- Create: `am-viettel-sme/packages/database/src/partner-campaigns-repository.ts`
- Modify: `am-viettel-sme/packages/database/package.json`
- Create: `am-viettel-sme/packages/database/test/partner-campaigns-repository.test.ts`

- [x] **Step 2.1 (RED):** Write failing PGlite repository tests in `am-viettel-sme/packages/database/test/partner-campaigns-repository.test.ts` covering group registration, group campaign & idempotent `GroupPostJob` persistence, partner registration (`phoneMasked` + `phoneHash`), stage transition, referral tax-code uniqueness, conversion with `commissionPolicyConfirmedByAmId`, payout (`PAID`), and reconciliation summary.
- [x] **Step 2.2 (GREEN):** Create the SQL migration, update `schema.prisma`, implement `PartnerCampaignsRepository`, and export in `package.json`.
- [x] **Step 2.3 (VERIFY):** Run `corepack pnpm vitest run packages/database/test/partner-campaigns-repository.test.ts`.

---

### Task 3: REST APIs for Groups, Campaign Dispatch, Referrals, Conversions & Analytics (`@am-sme/web`)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Create: `am-viettel-sme/apps/web/test/mod-pc-003-api.test.ts`

- [x] **Step 3.1 (RED):** Write failing API tests in `am-viettel-sme/apps/web/test/mod-pc-003-api.test.ts` covering:
  - `GET /api/v1/groups`, `POST /api/v1/groups`, `POST /api/v1/groups/:id/check-eligibility`
  - `POST /api/v1/campaigns/:id/dispatch`
  - `GET /api/v1/partners`, `POST /api/v1/partners/:id/referrals`, `GET /api/v1/partners/:id/reconciliation`
  - `POST /api/v1/partners/conversions`, `POST /api/v1/partners/conversions/:id/payout`
  - `GET /api/v1/analytics/partners`
- [x] **Step 3.2 (GREEN):** Extend `WorkspaceOperationsHub` in `operations-hub.ts` and wire routes + error mappings in `http-api.ts`.
- [x] **Step 3.3 (VERIFY):** Run `corepack pnpm vitest run apps/web/test/mod-pc-003-api.test.ts apps/web/test/operations-hub.test.ts`.

---

### Task 4: End-to-End Integration & Full Monorepo Verification

**Files:**
- Create: `am-viettel-sme/apps/web/test/mod-pc-003-integration.test.ts`

- [x] **Step 4.1:** Write E2E integration test `am-viettel-sme/apps/web/test/mod-pc-003-integration.test.ts` verifying the complete `MOD-PC-003` workflow across groups, campaign dispatch, partner onboarding, referral deduplication, commission approval, payout, and analytics.
- [x] **Step 4.2:** Run full monorepo test suite (`corepack pnpm test`) and verify 0 failures.
