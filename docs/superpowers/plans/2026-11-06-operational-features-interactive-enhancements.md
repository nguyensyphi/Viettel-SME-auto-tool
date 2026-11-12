# Kế hoạch Hoàn thiện Tương tác Đầy đủ cho các Module Nghiệp vụ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện tính năng tương tác hai chiều (tạo mới, cập nhật, phê duyệt) trên giao diện Web cho 3 phân hệ còn thiếu form thao tác: Quản lý Tài khoản & Phiên MXH (Accounts & QR Login), Lịch nội dung cá nhân (Publishing Calendar), và Chiến dịch Nhóm & Partner CRM (Campaigns & CTV).

**Architecture:**
- Mở rộng `WorkspaceOperationsHub` trong `operations-hub.ts` hỗ trợ thêm/kết nối tài khoản, tạo/duyệt chiến dịch, đăng ký/chuyển giai đoạn đối tác CTV.
- Bổ sung các REST endpoint tương ứng trong `http-api.ts`.
- Bổ sung form tương tác trực quan và modal QR Login trong `accounts-view.tsx`, `calendar-view.tsx`, `campaign-view.tsx`.

---

## Danh sách công việc (Tasks)

### Task 1: Tương tác Quản lý Tài khoản & Phiên MXH (Accounts & QR Login Flow)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/ui/accounts-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/operations-hub.test.ts`
- Test: `am-viettel-sme/apps/web/test/http-api.test.ts`

- [x] **Step 1:** Viết test kiểm tra:
  - `declareSocialAccount` tạo tài khoản mới ở trạng thái `NEEDS_LOGIN`.
  - `connectSocialAccount` đổi trạng thái thành `CONNECTED`.
  - API `POST /api/v1/social-accounts` và `POST /api/v1/social-accounts/:id/connect`.
- [x] **Step 2:** Triển khai các phương thức trong `operations-hub.ts` và route trong `http-api.ts`.
- [x] **Step 3:** Bổ sung Modal quét QR và Form khai báo tài khoản trong `accounts-view.tsx`.
- [x] **Step 4:** Chạy test xác nhận GREEN.

---

### Task 2: Tương tác Lên lịch Bài viết Mới (Publishing Calendar Compose)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/calendar-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/http-api.test.ts`

- [x] **Step 1:** Bổ sung form "Lên lịch bài viết mới" trong `calendar-view.tsx` (Mã, Chủ đề, Kênh Zalo/Facebook, Chế độ Full-Auto / Semi-Auto, Thời gian, Nội dung).
- [x] **Step 2:** Kết nối handler `onSchedulePost` trong `workspace-app.tsx` gọi `POST /api/v1/publishing-calendar`.
- [x] **Step 3:** Chạy test xác nhận GREEN.

---

### Task 3: Tương tác Chiến dịch & Quản lý Đối tác CTV (Campaigns & Partner CRM)
**Files:**
- Modify: `am-viettel-sme/apps/web/src/server/operations-hub.ts`
- Modify: `am-viettel-sme/apps/web/src/server/http-api.ts`
- Modify: `am-viettel-sme/apps/web/src/ui/campaign-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/operations-hub.test.ts`
- Test: `am-viettel-sme/apps/web/test/http-api.test.ts`

- [x] **Step 1:** Viết test kiểm tra `createCampaign`, `approveCampaign`, `registerPartner`, `transitionPartnerStage`.
- [x] **Step 2:** Thêm các method tương ứng trong `operations-hub.ts` và route trong `http-api.ts`.
- [x] **Step 3:** Thêm form tạo chiến dịch mới, nút duyệt chiến dịch, và form đăng ký CTV trong `campaign-view.tsx`.
- [x] **Step 4:** Chạy test xác nhận GREEN.

---

### Task 4: Kiểm thử toàn diện và đối soát chất lượng
- [x] Chạy `corepack pnpm test` (toàn bộ 50 test files, 343 tests passing GREEN).
- [x] Chạy `corepack pnpm typecheck` (`tsc --noEmit` 0 errors).
- [x] Chạy `corepack pnpm lint` (`eslint .` 0 errors).
