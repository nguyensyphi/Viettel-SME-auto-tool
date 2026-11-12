# Kế hoạch Triển khai Đồng bộ Tài khoản & Mở Trình duyệt Đăng nhập Facebook (Kết hợp Phương án A & B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Mục tiêu
Giải quyết dứt điểm vấn đề tài khoản Facebook trong tab **Auto Poster Facebook** và trang **Tài khoản & Phiên**:
1. Tự động quét và đồng bộ toàn bộ các profile tài khoản thật đã có trong `fb-auto-poster/sessions/` (`facebook_profile_nguyen_van_son`, `facebook_profile_tin`, `facebook_profile_tin_nguyen`, `Acc Chính`, `clone`, `clone_profile`...) vào kho tài khoản hệ thống với tên hiển thị trực quan.
2. Cung cấp cơ chế mở trực tiếp Google Chrome / Playwright trên màn hình Windows desktop từ Web UI để AM đăng nhập nick mới, xử lý 2FA/OTP hoặc xác minh checkpoint.
3. Cho phép chọn bất kỳ nick nào trong danh sách trên dropdown Auto Poster, đồng bộ với các file `.bat` ngoài hệ thống nếu AM đăng nhập từ bên ngoài.

---

## File Structure

- **Thêm mới / Cập nhật Backend:**
  - `apps/web/src/server/fb-account-scanner.ts`: Module quét thư mục `fb-auto-poster/sessions` & `storage/browser_profiles`, trích xuất tên tài khoản, kiểm tra trạng thái profile có cookies hay không.
  - `apps/web/src/server/desktop-login-launcher.ts`: Module mở Google Chrome thật với `--user-data-dir` tương ứng trên Windows để AM đăng nhập tương tự `login_account.py`.
  - `apps/web/src/server/operations-hub.ts`: Bổ sung `syncFacebookAccounts()`, `launchDesktopLogin()`, nạp nick tự động vào `state.accounts`.
  - `apps/web/src/server/http-api.ts`: Bổ sung các endpoint `POST /api/v1/fb-poster/sync-accounts`, `POST /api/v1/social-accounts/launch-browser`, `POST /api/v1/social-accounts/declare-and-launch`.

- **Thêm mới / Cập nhật Frontend:**
  - `apps/web/src/ui/facebook-auto-poster-view.tsx`: Bổ sung nút "Đồng bộ nick", nút "Mở trình duyệt đăng nhập", modal "Thêm nick Facebook mới", cập nhật dropdown chọn tài khoản linh hoạt.
  - `apps/web/src/ui/workspace-app.tsx`: Bổ sung handlers kết nối API đồng bộ nick và mở trình duyệt.

- **Thêm mới Tests:**
  - `apps/web/test/fb-account-sync.test.ts`: Test unit & integration cho việc scan profile, chuẩn hóa tên, nạp vào hub, và gọi API đồng bộ.

---

## Task 1: Module Quét & Chuẩn hóa Tài khoản (`fb-account-scanner.ts`)

- [x] **Step 1.1**: Viết failing test `apps/web/test/fb-account-sync.test.ts` kiểm tra hàm `scanFacebookSessions()` phát hiện đúng các thư mục profile trong `fb-auto-poster/sessions`, chuẩn hóa tên (`facebook_profile_nguyen_van_son` -> `Nguyễn Văn Sơn`, `Acc Chính`, `clone`), và xác định trạng thái `CONNECTED` nếu có dữ liệu phiên.
- [x] **Step 1.2**: Chạy `corepack pnpm vitest run test/fb-account-sync.test.ts` xác nhận test thất bại (RED).
- [x] **Step 1.3**: Triển khai `apps/web/src/server/fb-account-scanner.ts` với logic quét thư mục, parse display name, xác định `profileDir` an toàn.
- [x] **Step 1.4**: Chạy lại test xác nhận test chuyển sang PASS (GREEN).

---

## Task 2: Module Mở Trình duyệt Đăng nhập Desktop (`desktop-login-launcher.ts`)

- [x] **Step 2.1**: Viết test trong `fb-account-sync.test.ts` kiểm tra `launchDesktopLoginBrowser()` tìm đúng đường dẫn Chrome / executable và chuẩn bị lệnh mở trình duyệt với `--user-data-dir` tương ứng.
- [x] **Step 2.2**: Triển khai `apps/web/src/server/desktop-login-launcher.ts` hỗ trợ mở Chrome trên Windows (kế thừa cơ chế của `fb-auto-poster/auth/login_account.py`).
- [x] **Step 2.3**: Chạy test kiểm tra PASS.

---

## Task 3: Tích hợp vào OperationsHub & HTTP API

- [x] **Step 3.1**: Viết test trong `fb-account-sync.test.ts` cho các route API:
  - `POST /api/v1/fb-poster/sync-accounts` -> nạp tất cả các nick vào `workspaceId`.
  - `POST /api/v1/social-accounts/launch-browser` -> kích hoạt mở trình duyệt desktop.
  - `POST /api/v1/social-accounts/declare-and-launch` -> khai báo nick mới và mở trình duyệt.
- [x] **Step 3.2**: Cập nhật `apps/web/src/server/operations-hub.ts`:
  - Thêm phương thức `syncFacebookAccountsFromSessions(workspaceId: string)`.
  - Tự động gọi đồng bộ ngay khi khởi tạo workspace hoặc khi người dùng yêu cầu.
  - Thêm phương thức `launchAccountDesktopBrowser(workspaceId: string, accountId: string)`.
- [x] **Step 3.3**: Cập nhật `apps/web/src/server/http-api.ts` để nối các endpoint trên.
- [x] **Step 3.4**: Chạy test kiểm tra toàn bộ API hoạt động chính xác (GREEN).

---

## Task 4: Nâng cấp Giao diện Auto Poster Facebook & Tài khoản

- [x] **Step 4.1**: Cập nhật `apps/web/src/ui/facebook-auto-poster-view.tsx`:
  - Thêm nút **"🔄 Đồng bộ nick từ fb-auto-poster"** với tooltip hướng dẫn.
  - Thêm nút **"🌐 Mở trình duyệt đăng nhập"** ngay cạnh dropdown chọn tài khoản.
  - Thêm nút **"➕ Thêm nick Facebook"** mở dialog nhập tên nick mới và mở trình duyệt đăng nhập ngay.
  - Hiển thị danh sách tài khoản kèm nhãn trạng thái trực quan (`🟢 Đã kết nối`, `⚪ Cần đăng nhập`).
- [x] **Step 4.2**: Cập nhật `apps/web/src/ui/workspace-app.tsx` liên kết các hàm callback gọi API tương ứng.
- [x] **Step 4.3**: Cập nhật test UI `apps/web/test/facebook-auto-poster-view.test.ts` kiểm tra các nút bấm và dropdown mới.

---

## Task 5: Kiểm tra Toàn diện & Xác thực Thực tế (Verification)

- [x] **Step 5.1**: Chạy toàn bộ test suite `corepack pnpm vitest run` đảm bảo 100% tests PASS.
- [x] **Step 5.2**: Chạy `corepack pnpm typecheck` đảm bảo 0 lỗi TypeScript.
- [x] **Step 5.3**: Kiểm tra trực tiếp trên dev server (port 3000) xem danh sách tài khoản thực tế (`Nguyễn Văn Sơn`, `Tín Nguyễn`, `Acc Chính`, v.v.) đã xuất hiện trên UI.
- [x] **Step 5.4**: Báo cáo kết quả chi tiết cho người dùng.

