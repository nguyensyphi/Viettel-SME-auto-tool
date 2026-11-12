# PB-P01: Google OAuth + Google Drive Connector Implementation Plan

> **Status:** COMPLETED & VERIFIED (406 tests passing)

**Goal:** Implement PB-P01 (Google OAuth 2.0 connection, token lifecycle, folder registration, and Google Drive file listing with permission validation) inside `@am-sme/content-library`, `@am-sme/database`, and `@am-sme/web`.

**Architecture:** Extended the existing `@am-sme/content-library` connector layer with official OAuth 2.0 token management and Google Drive v3 REST client abstractions; added schema models (`GoogleConnection`, `GoogleDriveFolder`, `GoogleSyncLog`) with encrypted credential storage in `@am-sme/database`; and exposed REST endpoints on `@am-sme/web` (`/api/v1/google/...`) for folder registration, connection management, and file listing.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Next.js App API, `@am-sme/database` (Prisma/SQL), `@am-sme/content-library`.

**Spec:** `MOD-PB-002` (Technical Specification Draft 1.0, Section 3, 5, 19.1, 20.1, 21.2, 22.1, 25 PB-P01).

---

### Task 1: Database Schema & Migration for Google Integration (19.1) [COMPLETED]
- [x] Step 1.1: Write failing test for GoogleConnection and GoogleDriveFolder repository (`packages/database/test/google-connections.test.ts`).
- [x] Step 1.2: Add Prisma models and schema definitions (`prisma/migrations/20261106000100_pb_01_google_connections/migration.sql`, `prisma/schema.prisma`).
- [x] Step 1.3: Run tests and verify -> 4/4 tests passed.

### Task 2: Google OAuth 2.0 Service & Token Manager [COMPLETED]
- [x] Step 2.1: Write failing tests for GoogleOAuthService (`packages/content-library/test/google-oauth-service.test.ts`).
- [x] Step 2.2: Implement GoogleOAuthService with state signing and least-privilege scope checks (`packages/content-library/src/google-oauth-service.ts`).
- [x] Step 2.3: Run tests and verify -> 6/6 tests passed.

### Task 3: Enhanced Google Drive Folder & File Discovery Connector [COMPLETED]
- [x] Step 3.1: Write failing tests for Drive Folder hierarchy & listing (`packages/content-library/test/google-drive-connector-v2.test.ts`).
- [x] Step 3.2: Implement folder discovery and hierarchy parser in GoogleDriveConnector (`packages/content-library/src/google-drive-connector.ts`).
- [x] Step 3.3: Run tests and verify -> 4/4 tests passed (20/20 in package).

### Task 4: Web API Endpoints for Google Integration (`/api/v1/google/...`) [COMPLETED]
- [x] Step 4.1: Write failing API route tests (`apps/web/test/google-api.test.ts`).
- [x] Step 4.2: Implement endpoints in `apps/web/src/server/http-api.ts` and in-memory demo repository in `apps/web/src/server/demo-services.ts`.
- [x] Step 4.3: Run tests and verify -> 6/6 tests passed.

### Task 5: Integration & Verification of PB-P01 [COMPLETED]
- [x] Step 5.1: Write end-to-end integration test (`apps/web/test/pb-p01-integration.test.ts`).
- [x] Step 5.2: Run full monorepo test suite -> **406 passed, 7 skipped (413 total)**.
