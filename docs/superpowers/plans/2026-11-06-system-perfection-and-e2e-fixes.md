# Kế hoạch Hoàn thiện Từng Tính năng — Viettel AM SME Automation Platform

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện toàn bộ các tính năng cốt lõi trên nền tảng Viettel AM SME (Dashboard, Tác vụ, Import Excel, Quản lý Lead, Tài khoản/Phiên mạng xã hội, Lịch nội dung, Chiến dịch & CTV) để mọi tính năng hoạt động thực tế trên giao diện web `http://127.0.0.1:3000` mà không còn lỗi, trùng lặp hay dữ liệu ảo rỗng.

**Architecture:**
- Chuyển `ApiServices` singleton sang `globalThis` trong Next.js runtime để bảo toàn session authentication và in-memory store qua mọi lần Hot Module Reload (tránh lỗi 401).
- Hoàn thiện bộ lọc trạng thái và transition trạng thái (`OPEN` -> `COMPLETED`) trong `TaskRepository`/`demo-services.ts` và de-duplicate ở UI để dứt điểm lỗi trùng key React và task không biến mất sau khi hoàn tất.
- Thay thế hoàn toàn stub `previewPort` bằng bộ engine Import thật: parse mọi dòng từ file Excel, sinh preview chi tiết, và commit lưu trực tiếp vào `leadsStore` để lead hiển thị ngay lập tức trong tab Lead.
- Khởi tạo sẵn dữ liệu hoạt động nghiệp vụ thật (Zalo AM Dĩ An, Facebook Fanpage SME, bài đăng lịch nội dung Chữ ký số/Hóa đơn điện tử/vBHXH, Chiến dịch số hóa SME).

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Node.js 22+.

**Spec:** `docs/specs/` & `docs/master-plan/Code tool AM_compressed_1.pdf`.

---

## Danh sách công việc (Tasks)

### Task 1: Runtime Session Stability & Global Singleton (Chống rớt phiên 401)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/runtime.ts`
- Test: `am-viettel-sme/apps/web/test/runtime-singleton.test.ts`

- [x] **Step 1:** Viết failing test `runtime-singleton.test.ts` kiểm tra `getApiServices()` giữ nguyên session và trạng thái qua nhiều lần gọi độc lập.
- [x] **Step 2:** Cập nhật `runtime.ts` sử dụng `globalThis.__apiServicesSingleton` thay vì biến module `let singleton`.
- [x] **Step 3:** Chạy test xác nhận GREEN (`vitest run apps/web/test/runtime-singleton.test.ts`).

---

### Task 2: Task Management & Dashboard Fixes (Dứt điểm task trùng lặp và nút Hoàn tất)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/task-management.test.ts`

- [x] **Step 1:** Viết failing test `task-management.test.ts` kiểm tra:
  - `listTasks` lọc đúng theo `filter.status` (`OPEN`, `IN_PROGRESS`, `COMPLETED`).
  - `completeTask` chuyển trạng thái thành `"COMPLETED"` và task không còn xuất hiện trong danh sách `OPEN`.
- [x] **Step 2:** Cập nhật `listTasks` trong `demo-services.ts` áp dụng filter `status` và `assigneeUserId`. Cập nhật `completeTask` gán `status = "DONE"`.
- [x] **Step 3:** Trong `workspace-app.tsx`, de-duplicate mảng task theo `id` trước khi `setData` để đảm bảo không bao giờ sinh duplicate React keys.
- [x] **Step 4:** Chạy test xác nhận GREEN (`vitest run apps/web/test/task-management.test.ts`).

---

### Task 3: Real Excel Import Engine & Lead Persistence in Workspace
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/demo-import-workflow.test.ts`

- [x] **Step 1:** Viết failing test `demo-import-workflow.test.ts` kiểm tra upload 1 file Excel (ví dụ `DNMTL_T7_2026_Standard_Template.xlsx`), chạy qua `previewWorkbook`, `prepareReviewedCommit`, `commitPrepared`, và kiểm tra lead mới được thêm vào `leadsStore`.
- [x] **Step 2:** Cập nhật `previewPort` trong `demo-services.ts`:
  - `previewWorkbook`: Sử dụng `parseXlsxWorkbook`, `inspectHeaders`, `mapLeadRow`, `assessImportProvenance`, và `findDuplicateCandidates` để sinh preview thật với danh sách dòng thực tế.
  - `prepareReviewedCommit`: Tổng hợp quyết định duyệt (KEEP / MERGE / SKIP).
  - `commitPrepared`: Chuyển đổi các dòng duyệt thành `StoredLead` và lưu trực tiếp vào `leadsStore`.
- [x] **Step 3:** Chạy test xác nhận GREEN (`vitest run apps/web/test/demo-import-workflow.test.ts`).

---

### Task 4: Lead Details, Stage Progression & Business Notes
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/lead-progression.test.ts`

- [x] **Step 1:** Viết failing test `lead-progression.test.ts` kiểm tra:
  - Chuyển giai đoạn lead (`NEW` -> `QUALIFIED` -> `PROPOSAL` -> `NEGOTIATION` -> `WON`).
  - Ghi timeline tương ứng khi chuyển giai đoạn.
  - Thêm ghi chú nghiệp vụ và kiểm tra nội dung ghi chú xuất hiện trong chi tiết lead.
- [x] **Step 2:** Cập nhật `transitionStage` và `addNote` trong `demo-services.ts` để cập nhật đúng timeline và mảng notes.
- [x] **Step 3:** Chạy test xác nhận GREEN.

---

### Task 5: Seed Operational Data (Accounts, Calendar, Campaigns)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/apps/web/test/operations-hub.test.ts`

- [x] **Step 1:** Viết failing test `operations-hub.test.ts` kiểm tra khởi tạo dữ liệu mẫu cho tài khoản Zalo/FB, lịch nội dung bài đăng số hóa SME, và chiến dịch bán hàng.
- [x] **Step 2:** Khởi tạo các tài khoản mạng xã hội ban đầu (`zalo-dian-am01` kết nối Zalo cá nhân AM, `fb-viettel-sme` Fanpage Viettel SME), các bài đăng lịch nội dung (Chữ ký số Viettel-CA, Hóa đơn điện tử S-Invoice), và chiến dịch mẫu ("Chiến dịch chuyển đổi số KCN Sóng Thần 2026").
- [x] **Step 3:** Chạy test xác nhận GREEN.

---

### Task 6: Verification toàn diện
- [x] Chạy `corepack pnpm test` (toàn bộ test suites: 49 files passed, 336 tests passed).
- [x] Chạy `corepack pnpm typecheck` (`tsc --noEmit`: 0 errors).
- [x] Chạy `corepack pnpm lint` (`eslint .`: 0 errors).
- [x] Kiểm tra dev server và giao diện người dùng.
