# PB-P04 & PB-P05: Google Drive Media Importer, Content-Media Matching & Validation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PB-P04 and PB-P05: Google Drive media validation & versioning, weighted Content-Media Matching Engine (`Score = 0.40P + 0.30T + 0.15F + 0.10V + 0.05R`), Content Validation Engine, and Content Approval audit history across `@am-sme/content-library`, `@am-sme/database`, and `@am-sme/web`.

**Architecture:** Extend `@am-sme/content-library` with media validation, weighted media scoring/matching, and content validation rules; add database models (`MediaAsset`, `MediaVersion`, `ContentMediaLink`, `ContentApproval`) to `@am-sme/database`; and expose REST endpoints (`/api/v1/media/*`, `/api/v1/contents/:id/match-media`, `/api/v1/contents/:id/validate`, `/api/v1/contents/:id/versions`) on `@am-sme/web`.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Next.js API, Prisma/SQL `@am-sme/database`, `@am-sme/content-library`.

**Spec:** `MOD-PB-002` (Technical Specification Draft 1.0, Sections 5, 6, 7, 19.2, 19.3, 20.2, 20.3, 22.2).

---

### Task 1: Media Validation & Weighted Content-Media Matching Engine (PB-004, PB-005, Section 5)

**Files:**
- Modify: `am-viettel-sme/packages/content-library/src/media-matcher.ts`
- Modify: `am-viettel-sme/packages/content-library/src/index.ts`
- Test: `am-viettel-sme/packages/content-library/test/media-matcher-v2.test.ts`

- [x] **Step 1.1: Write failing tests for media validation and weighted matching (`PB-MT-001` to `PB-MT-010`)**
  - Validate supported image MIME types (`image/jpeg`, `image/png`, `image/webp`) and reject PDFs/unsupported files (`PB-MT-007`).
  - Validate max file size limit (15 MB) (`PB-MT-006`).
  - Detect duplicate SHA-256 checksums (`PB-MT-005`).
  - Test priority matching & scoring formula $Score = 0.40P + 0.30T + 0.15F + 0.10V + 0.05R$:
    - Direct `MEDIA_ID` / `MEDIA_FILENAME` override (`PB-MT-010`).
    - Exact `POST_ID` match (`PB-MT-001`).
    - Topic match (`PB-MT-002`) and rejection of wrong topic (`PB-MT-003`).
    - `SHARED_MEDIA` fallback (`NEEDS_REVIEW` or `MATCHED`).
    - Missing media detection (`MISSING_MEDIA`, `PB-MT-004`).

- [x] **Step 1.2: Implement `validateMediaCandidate` and `rankAndMatchMedia` in `packages/content-library/src/media-matcher.ts`**
  - Preserve backward compatibility for legacy `matchMediaToPost`.

- [x] **Step 1.3: Run tests and verify GREEN**

---

### Task 2: Content Validation Engine (PB-006, Section 7)

**Files:**
- Create: `am-viettel-sme/packages/content-library/src/content-validator.ts`
- Modify: `am-viettel-sme/packages/content-library/src/index.ts`
- Modify: `am-viettel-sme/packages/content-library/package.json`
- Test: `am-viettel-sme/packages/content-library/test/content-validator.test.ts`

- [x] **Step 2.1: Write failing tests for ContentValidator**
  - Check non-empty title & body, valid `postCode`, valid standard `topicCode` (reject `NEEDS_CLASSIFICATION`).
  - Check platform list non-empty (`ZALO`, `FACEBOOK`).
  - Check media requirement: if media required, must have matched `APPROVED` media.
  - Check validity window (`validFrom` <= now <= `validUntil`), rejecting expired posts (`POST_EXPIRED`).
  - Check PII absence and duplicate content hash prevention.

- [x] **Step 2.2: Implement `validateContentForPublishing` in `packages/content-library/src/content-validator.ts`**

- [x] **Step 2.3: Run tests and verify GREEN**

---

### Task 3: Database Schema & Repository for Media Assets, Links & Content Approvals (19.2, 19.3)

**Files:**
- Create migration: `am-viettel-sme/packages/database/prisma/migrations/20261106000300_pb_04_05_media_and_approvals/migration.sql`
- Modify: `am-viettel-sme/packages/database/prisma/schema.prisma`
- Modify: `am-viettel-sme/packages/database/src/content-library-repository.ts`
- Test: `am-viettel-sme/packages/database/test/media-and-approvals.test.ts`

- [x] **Step 3.1: Write failing tests for Media & Approval persistence**
  - Upsert `MediaAsset` and verify version bump when `checksum` changes (`PB-MT-009`).
  - Detect duplicate checksum across different drive files in workspace.
  - Link matched media to content (`ContentMediaLink`).
  - Record `ContentApproval` (`APPROVED`, `REJECTED`, `REVISION_REQUIRED`, `SUSPENDED`) with auditor metadata (`approvedBy`, `contentVersion`, `mediaVersion`, `approvedPlatforms`, `notes`).

- [x] **Step 3.2: Implement migration, Prisma models, and repository methods**

- [x] **Step 3.3: Run tests and verify GREEN**

---

### Task 4: Media & Content Validation HTTP APIs (20.2, 20.3)

**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/media-and-validation-api.test.ts`

- [x] **Step 4.1: Write failing tests for Media & Validation HTTP endpoints**
  - `GET /api/v1/media` & `GET /api/v1/media/:id` & `GET /api/v1/media/:id/preview`
  - `POST /api/v1/media/sync`
  - `POST /api/v1/media/:id/approve`
  - `POST /api/v1/contents/:id/match-media`
  - `POST /api/v1/contents/:id/validate`
  - `POST /api/v1/contents/:id/approve` (with approval audit record)
  - `GET /api/v1/contents/:id/versions`

- [x] **Step 4.2: Implement endpoints in `http-api.ts` and `demo-services.ts`**

- [x] **Step 4.3: Run tests and verify GREEN**

---

### Task 5: Full E2E Integration & Monorepo Verification

**Files:**
- Create: `am-viettel-sme/apps/web/test/pb-p04-p05-integration.test.ts`
- Update: `docs/superpowers/plans/2026-11-11-pb-p04-p05-media-matching-validation.md`

- [x] **Step 5.1: Write E2E test: Drive Media Sync -> Media Approve -> Post Match Media -> Validate -> Approve with Audit Trail**
- [x] **Step 5.2: Run full monorepo test suite (`corepack pnpm test`) and confirm 100% GREEN**
