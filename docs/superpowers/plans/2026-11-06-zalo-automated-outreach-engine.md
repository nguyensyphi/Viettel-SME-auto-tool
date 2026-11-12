# Kế hoạch Triển khai: Cơ chế Tự động Kết bạn & Gửi Tin nhắn Zalo từ File Excel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng cơ chế tự động hóa tiếp cận Zalo hoàn chỉnh: từ tệp khách hàng DNMTL đã trích xuất từ file Excel (5.003 dòng), tự động phân loại, ghép sản phẩm Viettel (Chữ ký số + Hóa đơn điện tử), tạo tin nhắn cá nhân hóa và điều khiển Playwright tự động tìm kiếm số điện thoại, gửi lời mời kết bạn và gửi tin nhắn chào hàng trên Zalo Web/PC với cơ chế an toàn, chống spam và ghi nhận kết quả thời gian thực.

**Architecture:**
- **Domain Layer (`@am-sme/domain`):** Bổ sung mẫu tin nhắn chuẩn hóa cho Doanh nghiệp mới thành lập (DNMTL) và Kế toán đối tác; hàm `renderZaloOutreachMessage` cá nhân hóa biến `{company_name}`, `{representative_name}`, `{am_name}`, `{product_name}` và bảo vệ dữ liệu PII.
- **Browser Automation Layer (`@am-sme/browser-automation`):** Xây dựng `ZaloOutreachAutomator` thực thi trên Playwright isolated context (`storage/browser_profiles/<account_id>`): tìm kiếm SĐT, nhận diện tài khoản có Zalo hay không, gửi lời mời kết bạn và gửi tin nhắn đính kèm tài liệu với nhịp gõ tự nhiên (natural typing delay).
- **Service & Queue Layer (`@am-sme/web` / `@am-sme/campaigns`):** Xây dựng `OutreachService` quản lý hàng đợi công việc (`outreach_tasks`), kiểm tra điều kiện an toàn (`evaluateContactTaskEligibility`), kiểm soát tốc độ (RateLimiter) và ghi nhận nhật ký hoạt động (`customer_activities` / timeline).
- **Presentation Layer (`@am-sme/web`):** Bổ sung giao diện điều khiển Chiến dịch Tiếp cận Zalo trực quan trên Web UI: tạo hàng đợi từ danh sách Lead đã import, xem trước tin nhắn, kích hoạt chế độ tự động chạy lần lượt từng khách hoặc duyệt thủ công 1-click, hiển thị thanh tiến độ và thống kê kết quả trực tiếp.

**Tech Stack:** TypeScript, Next.js 16, Playwright, Vitest, Node.js 22+.

**Spec:** ChatGPT Master Technical Specification `MOD-CA-001` (`CA-001` đến `CA-014`) & Master Plan PDF.

## Global Constraints
- Không lưu CCCD/CMND, ngày cấp, nơi cấp.
- Trình duyệt chạy trên isolated persistent context tại `storage/browser_profiles/<account_id>`. Không sử dụng chung cookie.
- Tự động kiểm tra `evaluateContactTaskEligibility` trước mọi lượt gửi tin (Fail-closed).
- Tuân thủ Kill Switch và Account Circuit Breaker khi gặp sự cố hoặc quản trị viên tạm dừng.
- Nhịp gõ phím và độ trễ ngẫu nhiên tự nhiên (25ms - 65ms per keystroke, 3s - 7s giữa các liên hệ) để bảo vệ tài khoản AM.

---

## Danh sách công việc (Tasks)

### Task 1: Mẫu tin nhắn chuẩn hóa DNMTL & Message Renderer trong Domain Layer
**Files:**
- Modify: `am-viettel-sme/packages/domain/src/messaging/templates.ts`
- Modify: `am-viettel-sme/packages/domain/src/messaging/message-generator.ts`
- Test: `am-viettel-sme/packages/domain/test/zalo-dnmtl-templates.test.ts`

- [x] **Step 1:** Viết failing test `zalo-dnmtl-templates.test.ts` kiểm tra:
  - Tồn tại mẫu `ZALO_DNMTL_INTRO_V1` (Chào doanh nghiệp mới thành lập: Viettel-CA + S-Invoice + vContract).
  - Tồn tại mẫu `ZALO_ACCOUNTING_PARTNER_V1` (Mời hợp tác đối tác kế toán/CTV).
  - `renderZaloOutreachMessage` thay thế chính xác các biến `{company_name}`, `{representative_name}`, `{am_name}`, `{product_name}`, `{am_phone}` và không để lọt CCCD/CMND.
- [x] **Step 2:** Cập nhật `templates.ts` thêm 2 mẫu tin chuẩn hóa theo đúng văn phong đặc tả.
- [x] **Step 3:** Cập nhật `message-generator.ts` xuất hàm render chuyên dụng cho Zalo Outreach với đầy đủ validation và cảnh báo PII.
- [x] **Step 4:** Chạy test xác nhận GREEN (`vitest run packages/domain/test/zalo-dnmtl-templates.test.ts`).

---

### Task 2: Playwright Zalo Outreach Automator (Tìm SĐT, Kết bạn, Nhắn tin)
**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/publishers/zalo-outreach-automator.ts`
- Modify: `am-viettel-sme/packages/browser-automation/src/index.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/zalo-outreach-automator.test.ts`

- [x] **Step 1:** Viết failing test `zalo-outreach-automator.test.ts` giả lập các kịch bản tương tác Playwright Page:
  - Kịch bản 1: Nhập SĐT -> Zalo báo không tìm thấy kết quả (`ZALO_ACCOUNT_NOT_FOUND`).
  - Kịch bản 2: Nhập SĐT -> Tìm thấy tài khoản -> Gửi lời mời kết bạn kèm lời chào (`FRIEND_REQUEST_SENT`).
  - Kịch bản 3: Nhập SĐT -> Mở khung chat -> Nhập tin nhắn chào giải pháp + đính kèm hình ảnh -> Gửi thành công (`MESSAGE_SENT`).
  - Kịch bản 4: Xử lý ngoại lệ khi mất kết nối mạng hoặc phiên hết hạn (`NEEDS_LOGIN`).
- [x] **Step 2:** Triển khai `zalo-outreach-automator.ts` sử dụng các bộ selector chuẩn của Zalo Web (`[data-id="search-input"]`, `#richInput`, nút kết bạn, nút gửi).
- [x] **Step 3:** Export module qua `index.ts`.
- [x] **Step 4:** Chạy test xác nhận GREEN (`vitest run packages/browser-automation/test/zalo-outreach-automator.test.ts`).

---

### Task 3: Outreach Work Queue & Execution Service (Quản lý hàng đợi & Nhịp gửi)
**Files:**
- Create: `am-viettel-sme/packages/campaigns/src/zalo-outreach-service.ts`
- Modify: `am-viettel-sme/packages/campaigns/src/index.ts`
- Modify: `am-viettel-sme/apps/web/src/server/demo-services.ts`
- Test: `am-viettel-sme/packages/campaigns/test/zalo-outreach-service.test.ts`
- Test: `am-viettel-sme/apps/web/test/outreach-api.test.ts`

- [x] **Step 1:** Viết failing test `zalo-outreach-service.test.ts` kiểm tra:
  - Tạo đợt tiếp cận từ danh sách Lead đã import (`createOutreachBatch`).
  - Tự động sinh `outreach_tasks` với nội dung cá nhân hóa cho từng lead.
  - Kiểm tra điều kiện `evaluateContactTaskEligibility` trước khi thực thi.
  - Thực thi lần lượt từng task có delay nhịp độ và cập nhật trạng thái (`QUEUED` -> `PROCESSING` -> `SENT` / `NOT_FOUND` / `FAILED`).
  - Tự động ghi nhận sự kiện vào Timeline của Lead (`MESSAGE_SENT_REPORTED` / `STAGE_CHANGE`).
- [x] **Step 2:** Triển khai `zalo-outreach-service.ts` với đầy đủ cơ chế state transition, rate limiting, kill switch.
- [x] **Step 3:** Tích hợp `zalo-outreach-service` vào `demo-services.ts` và export các API endpoints (`/api/v1/outreach/batches`, `/api/v1/outreach/batches/:id/run-next`, `/api/v1/outreach/batches/:id`).
- [x] **Step 4:** Chạy test xác nhận GREEN (`vitest run packages/campaigns/test/zalo-outreach-service.test.ts` và `vitest run apps/web/test/outreach-api.test.ts`).

---

### Task 4: Giao diện Quản lý Tiếp cận Zalo (Zalo Outreach UI) & Bảng Điều khiển
**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/campaign-view.tsx`
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Test: `am-viettel-sme/apps/web/test/zalo-outreach-ui.test.tsx`

- [x] **Step 1:** Viết test `zalo-outreach-ui.test.tsx` kiểm tra luồng tương tác trên giao diện:
  - Hiển thị danh sách khách hàng DNMTL sẵn sàng tiếp cận.
  - Chọn mẫu tin (Chào DN mới / Hợp tác kế toán) và xem trước nội dung cá nhân hóa.
  - Nút kích hoạt tiếp cận tự động (Auto-run) hoặc nút 1-click gửi thủ công.
  - Thanh tiến độ (Progress bar) và bộ đếm kết quả: Tổng số, Đã gửi, Đã gửi kết bạn, Không có Zalo, Lỗi.
- [x] **Step 2:** Cập nhật `campaign-view.tsx` và `workspace-app.tsx` thêm khu vực điều khiển **"Chiến dịch Tiếp cận Zalo (DNMTL)"** ngay trong tab Chiến dịch & CTV.
- [x] **Step 3:** Chạy test xác nhận GREEN (`vitest run apps/web/test/zalo-outreach-ui.test.tsx`).

---

### Task 5: Kiểm thử Toàn trình End-to-End & Xác minh Hệ thống
**Files:**
- Test: `am-viettel-sme/apps/web/test/e2e-excel-to-zalo-outreach.test.ts`

- [x] **Step 1:** Viết bài test E2E hoàn chỉnh:
  - Nạp danh sách doanh nghiệp có chứa cột nhạy cảm CMND/CCCD/Ngày cấp.
  - Kiểm tra hệ thống tự động loại bỏ PII, không ném lỗi `PERSONAL_IDENTIFIER_COLUMN_BLOCKED`.
  - Khởi tạo chiến dịch tiếp cận Zalo cho doanh nghiệp này.
  - Chạy chu trình gửi tự động: xác nhận các khách hàng được xử lý, trạng thái chuyển thành `SENT`, tóm tắt tiến độ cập nhật chính xác.
- [x] **Step 2:** Chạy toàn bộ test suite của dự án (`corepack pnpm test`) đảm bảo 100% pass không có lỗi phát sinh.
- [x] **Step 3:** Kiểm tra typecheck (`corepack pnpm typecheck`) sạch 0 lỗi.
