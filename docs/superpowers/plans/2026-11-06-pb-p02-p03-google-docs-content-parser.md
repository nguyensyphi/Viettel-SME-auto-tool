# PB-P02 & PB-P03: Google Docs Importer, Content Parser & Topic Classification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement PB-P02 and PB-P03: structured Google Docs importing, `[POST_START] ... [POST_END]` post parser, SHA-256 content hashing & versioning, standard topic classification, and PII protection across `@am-sme/content-library`, `@am-sme/database`, and `@am-sme/web`.

**Architecture:** Extend `@am-sme/content-library` with structured block parser and topic classification engine; add schema models (`google_documents`, `content_topics`, `contents`, `content_versions`) to `@am-sme/database`; and expose REST endpoints (`/api/v1/contents`, `/api/v1/google/documents`, `/api/v1/google/sync-documents`) on `@am-sme/web`.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Next.js API, Prisma/SQL `@am-sme/database`, `@am-sme/content-library`.

**Spec:** `MOD-PB-002` (Technical Specification Draft 1.0, Sections 3, 4, 16.3, 19.1, 19.2, 20.1, 20.2, 22.1).

---

### Global Constraints
- **Structured Post Markers:** Support both `[POST_START] ... [POST_END]` and legacy `---` separators. Mandatory fields: `POST_ID`, `TITLE`, `TOPIC`, `PLATFORMS`, `STATUS`, `CONTENT`.
- **Revision Integrity:** Never overwrite existing published or approved content in-place; calculate content hash (SHA-256) and create new version when content changes.
- **Fail-Closed PII Check:** Disallow posts containing sensitive national ID patterns (CCCD 12-digit, CMND 9-digit, date of birth) with explicit error `PII_DETECTED`.
- **Scope & Workspace Isolation:** All documents, topics, and contents are strictly scoped to `workspaceId`.
- **Zero Unapproved Publishing:** `DRAFT` posts cannot be scheduled; only `APPROVED` posts are eligible for publishing.

---

### Task 1: Enhanced Content Parser & SHA-256 Content Hashing (PB-002, 3.3, 16.3)

**Files:**
- Modify: `am-viettel-sme/packages/content-library/src/content-parser.ts`
- Modify: `am-viettel-sme/packages/content-library/src/index.ts`
- Test: `am-viettel-sme/packages/content-library/test/content-parser-v2.test.ts`

- [x] **Step 1.1: Write failing tests for `[POST_START] ... [POST_END]` parsing, metadata extraction, and hash calculation**
  - Verify parsing of all fields: `POST_ID`, `TITLE`, `TOPIC`, `TARGET`, `PLATFORMS`, `STATUS`, `MEDIA`, `PUBLISH_PRIORITY`, `CONTENT`, `HASHTAGS`, `PUBLISH_FROM`, `PUBLISH_UNTIL`.
  - Verify rejection on missing mandatory fields (`POST_ID`, `TITLE`, `CONTENT`, `PLATFORMS`, `STATUS`).
  - Verify rejection on duplicate `POST_ID` within same document.
  - Verify SHA-256 hash calculation: identical contents produce identical hash, text changes produce new hash.
  - Verify PII detection triggers `PII_DETECTED` error.

- [x] **Step 1.2: Implement parser logic in `packages/content-library/src/content-parser.ts`**
  - Add `calculateContentHash(post)`.
  - Add support for `[POST_START]` and `[POST_END]` delimiter extraction.
  - Parse multiline `CONTENT:` until next tag or `[POST_END]`.
  - Parse `HASHTAGS:` into string array `#Viettel #ChuKySo`.
  - Parse `PLATFORMS:` into `("ZALO" | "FACEBOOK")[]`.
  - Validate and normalize lifecycle status (`DRAFT`, `APPROVED`).

- [x] **Step 1.3: Run tests and verify GREEN**
  - Run: `powershell -Command "Set-Location am-viettel-sme; corepack pnpm vitest run packages/content-library/test/content-parser-v2.test.ts"`.

---

### Task 2: Standard Topic Classification Engine (PB-003, Section 4)

**Files:**
- Create: `am-viettel-sme/packages/content-library/src/topic-classifier.ts`
- Modify: `am-viettel-sme/packages/content-library/src/index.ts`
- Test: `am-viettel-sme/packages/content-library/test/topic-classifier.test.ts`

- [x] **Step 2.1: Write failing tests for topic classification**
  - Verify 10 official topics: `CHU_KY_SO`, `HOA_DON_DIEN_TU`, `VCONTRACT`, `FTTH`, `DIGITAL_TRANSFORMATION`, `BUSINESS_KNOWLEDGE`, `AM_EXPERIENCE`, `CUSTOMER_SUPPORT`, `PERSONAL_ACTIVITY`, `GENERAL_BRANDING`.
  - Verify metadata validation (if post specifies a valid topic code, accept with confidence 1.0).
  - Verify rule-based classification when TOPIC is omitted or marked `AUTO`: matches keywords in title/content.
  - Verify fallback to `NEEDS_CLASSIFICATION` when confidence is below threshold.

- [x] **Step 2.2: Implement `TopicClassifier` in `packages/content-library/src/topic-classifier.ts`**
  - Add topic catalog dictionary with Vietnamese keywords and product mappings.
  - Add `classifyPostTopic(post)` returning `{ topic, products, confidence, status }`.

- [x] **Step 2.3: Run tests and verify GREEN**
  - Run: `powershell -Command "Set-Location am-viettel-sme; corepack pnpm vitest run packages/content-library/test/topic-classifier.test.ts"`.

---

### Task 3: Database Models & Repository for Google Documents & Content Library (19.1, 19.2)

**Files:**
- Create migration: `am-viettel-sme/packages/database/prisma/migrations/20261106000200_pb_02_content_library/migration.sql`
- Modify: `am-viettel-sme/packages/database/prisma/schema.prisma`
- Create: `am-viettel-sme/packages/database/src/content-library-repository.ts`
- Modify: `am-viettel-sme/packages/database/package.json`
- Test: `am-viettel-sme/packages/database/test/content-library-repository.test.ts`

- [x] **Step 3.1: Write failing tests for Content Library persistence**
  - Test saving parsed posts from a Google Document.
  - Test version creation: updating existing post creates a new version record while preserving history.
  - Test list posts with topic, platform, and approval status filters.
  - Test approve and reject post actions.

- [x] **Step 3.2: Implement database migration, Prisma schema, and repository**
  - Add models `GoogleDocument`, `ContentPost`, `ContentVersion`.
  - Implement `ContentLibraryRepository` with workspace-partitioned SQL queries.

- [x] **Step 3.3: Run tests and verify GREEN**
  - Run: `powershell -Command "Set-Location am-viettel-sme; corepack pnpm vitest run packages/database/test/content-library-repository.test.ts"`.

---

### Task 4: Google Docs Sync Service & HTTP APIs (20.1, 20.2)

**Files:**
- Create: `am-viettel-sme/packages/content-library/src/google-docs-sync-service.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/content-api.test.ts`

- [x] **Step 4.1: Write failing tests for Content & Docs HTTP endpoints**
  - `POST /api/v1/google/sync-documents`: imports/syncs Google Doc by documentId.
  - `GET /api/v1/google/documents`: lists synced documents for workspace.
  - `GET /api/v1/contents`: lists parsed posts with filter by topic/status.
  - `GET /api/v1/contents/:id`: returns post detail and version history.
  - `POST /api/v1/contents/:id/approve`: transitions post status to `APPROVED`.
  - `POST /api/v1/contents/:id/reject`: transitions post status to `REJECTED`.

- [x] **Step 4.2: Implement endpoints in `apps/web/src/server/http-api.ts` & `demo-services.ts`**
  - Wire `GoogleDocsSyncService` with `GoogleDocsConnector` and `ContentLibraryRepository`.

- [x] **Step 4.3: Run tests and verify GREEN**
  - Run: `powershell -Command "Set-Location am-viettel-sme; corepack pnpm vitest run apps/web/test/content-api.test.ts"`.

---

### Task 5: Full E2E Verification & Monorepo Health Check

**Files:**
- Create: `am-viettel-sme/apps/web/test/pb-p02-p03-integration.test.ts`
- Update: `docs/superpowers/plans/2026-11-06-pb-p02-p03-google-docs-content-parser.md`

- [x] **Step 5.1: Write E2E integration test for Docs Import -> Parse -> Classify -> Versioning -> Approval**
- [x] **Step 5.2: Run full monorepo test suite (`corepack pnpm test`) and verify 100% GREEN**

