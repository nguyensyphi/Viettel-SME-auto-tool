# CẨM NANG TRIỂN KHAI & VẬN HÀNH HỆ THỐNG (OPERATIONAL RUNBOOK)
**Dự án:** Viettel AM SME Automation Platform (`am-viettel-sme`)  
**Đơn vị áp dụng:** Đội ngũ AM Doanh nghiệp SME — Viettel Dĩ An / Bình Dương & TP.HCM  
**Phiên bản:** 1.0 (Đầy đủ 4 Module: `MOD-CA-001`, `MOD-PB-002`, `MOD-PC-003`, `MOD-OPS-004`)

---

## 1. Kiến trúc 4 Module Nghiệp vụ

1. **`MOD-CA-001` — Customer Acquisition & Lead Workspace:**
   - Nhập danh sách Doanh nghiệp Mới Thành lập (DNMTL) từ tệp `.xlsx` qua quy trình 4 bước (`UPLOAD` -> `VALIDATE` -> `APPROVE` -> `COMMIT`).
   - Tự động cách ly/chặn các cột định danh cá nhân nhạy cảm (CMND, CCCD, Ngày sinh) theo Nghị định 13/2023/NĐ-CP.
   - Phân loại khách hàng (`NEW_ESTABLISHED`, `GROWTH_SME`, `ACCOUNTING`), gợi ý bộ giải pháp (`VIETTEL_CA`, `SINVOICE`, `VCONTRACT`, `VBHXH`, `FTTH`) với cơ chế bắt buộc AM xác nhận (`CAN_XAC_NHAN_LAI`).
   - Kiểm tra điều kiện liên hệ Fail-Closed (`evaluateContactTaskEligibility`) và chặn tuyệt đối danh sách từ chối (`SuppressionRecord` / Opt-out).

2. **`MOD-PB-002` — Personal Branding Automation:**
   - Kết nối Google OAuth, đồng bộ bài viết từ Google Docs theo định dạng `[POST_START]...[POST_END]`, tự động phân loại 10 chủ đề và lưu lịch sử phiên bản (`ContentVersion`).
   - Đồng bộ hình ảnh từ Google Drive, chấm điểm ghép ảnh tự động theo công thức trọng số $0.4P + 0.3T + 0.15F + 0.1V + 0.05R$.
   - Quản lý lịch đăng bài (`PublishingCalendar`), kiểm soát chống đăng trùng bài trong 14 ngày / cùng chủ đề trong 48 giờ, và thực thi qua Playwright (`PREPARE_ONLY`, `ASSISTED_PUBLISH`, `AUTO_PUBLISH`).

3. **`MOD-PC-003` — Partner & Group Campaign Automation:**
   - Quản lý danh mục Hội nhóm Cộng đồng Zalo/Facebook (`CommunityGroup`), tự động phân loại nhóm (`ACCOUNTING_TAX`, `BANKING_FINANCE`, `BUSINESS_ASSOCIATION`, `STARTUP_SME`) và chặn đăng vào nhóm `READ_ONLY` / `BLOCKED` hoặc đang trong thời gian chờ (`minHoursBetweenPosts`).
   - Quản lý vòng đời Cộng tác viên (`NEW` -> `CONTACTED` -> `ACTIVE_PARTNER`), che SĐT hiển thị (`phoneMasked`), băm SHA-256 chống trùng SĐT, **chống trùng mã số thuế giới thiệu chéo giữa các CTV** (`DUPLICATE_REFERRAL_TAX_CODE`) và đối soát chi trả hoa hồng (`APPROVED_PENDING_PAYOUT` -> `PAID`).

4. **`MOD-OPS-004` — Operations Control, Queue Safety & Telegram Bot:**
   - Khóa phân tán `JobLock` và `idempotencyKey` cho mọi tác vụ hàng đợi.
   - Ngắt mạch tự động theo từng tài khoản (`AccountCircuitBreaker`) và công tắc dừng khẩn cấp toàn hệ thống (`KillSwitchController`) điều khiển qua Telegram (`/status`, `/pause`, `/resume`, `/jobs`).

---

## 2. Yêu cầu Hệ thống & Cài đặt Hạ tầng

### 2.1. Yêu cầu phần mềm
- **Node.js:** `>= 22.0.0`
- **Package Manager:** `corepack pnpm` (`pnpm@11.25.0`)
- **Docker Desktop:** Để khởi chạy PostgreSQL 16 và Redis 7 tại máy local (`127.0.0.1`).

### 2.2. Khởi chạy PostgreSQL 16 & Redis 7 bằng Docker Compose
```powershell
Set-Location am-viettel-sme
Copy-Item .env.example .env -ErrorAction SilentlyContinue
docker compose up -d
```
- PostgreSQL lắng nghe tại `127.0.0.1:5432` (database `am_sme`).
- Redis lắng nghe tại `127.0.0.1:6379`.

### 2.3. Chạy Migration & Khởi tạo Dữ liệu Mẫu (Synthetic Seed)
```powershell
Set-Location am-viettel-sme
corepack pnpm db:generate
corepack pnpm db:migrate:deploy
corepack pnpm db:seed:synthetic
```

### 2.4. Khởi chạy Web Dashboard (`http://127.0.0.1:3000`)
```powershell
Set-Location am-viettel-sme
corepack pnpm --filter @am-sme/web dev
```
Tài khoản trải nghiệm sẵn có trên môi trường Demo Local:
- **AM Viettel Dĩ An:** `am@viettel.vn`
- **Trưởng phòng SME:** `manager@viettel.vn`
- **Quản trị viên:** `admin@viettel.vn`

---

## 3. Các Nguyên tắc An toàn Bắt buộc (Ironclad Guardrails)

1. **Bảo vệ Dữ liệu Cá nhân (Nghị định 13/2023/NĐ-CP):**
   - Tuyệt đối không lưu số CCCD/CMND, ngày sinh hoặc dòng Excel thô vào cơ sở dữ liệu.
   - Mọi số điện thoại CTV được che hiển thị (`phoneMasked`) và băm SHA-256 (`phoneHash`).
2. **Cô lập Hồ sơ Trình duyệt (`storage/browser_profiles/<account_id>`):**
   - Mỗi tài khoản Zalo/Facebook của AM sử dụng một thư mục hồ sơ trình duyệt độc lập tại `storage/browser_profiles/<account_id>`.
   - Không trích xuất cookie/token, không gửi mã QR đăng nhập qua Telegram. Khi phiên hết hạn (`SESSION_EXPIRED`), AM xác thực trực tiếp trên màn hình máy tính của mình.
3. **Kiểm tra Kiểm thử Toàn diện trước khi Bàn giao:**
   ```powershell
   Set-Location am-viettel-sme
   corepack pnpm test
   ```

