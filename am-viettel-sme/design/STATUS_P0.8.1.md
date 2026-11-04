# Trạng thái P0.8.1 — Khôi phục mật khẩu Admin

## Kết quả

Đã thêm `pnpm db:recover-admin-password` như một CLI riêng **chỉ cho local**; staging và DB không phải loopback bị từ chối. Khi bootstrap Admin đã hoàn tất nhưng đăng nhập báo `INVALID_CREDENTIALS`, không chạy lại `db:bootstrap-admin`; chạy lệnh khôi phục trong terminal PowerShell tương tác tại thư mục dự án:

```powershell
$env:AUTH_RECOVERY_WORKSPACE_SLUG = "am-sme-local-synthetic"
try { pnpm db:recover-admin-password } finally { Remove-Item Env:AUTH_RECOVERY_WORKSPACE_SLUG }
```

Thay slug nếu workspace local dùng tên khác. CLI hỏi email Admin, chỉ tiếp tục nếu tìm thấy đúng một tài khoản `ACTIVE` có membership `ADMIN` và credential trong workspace đó, rồi yêu cầu mật khẩu mới bằng terminal raw mode không echo. Mật khẩu không nhận qua tham số hoặc biến môi trường, không được ghi vào file/log; chỉ hash Argon2id được lưu. Cập nhật credential và append audit `ADMIN_PASSWORD_RECOVERED` nằm trong cùng transaction serializable. Actor là `NULL` vì đây là thao tác phục hồi offline không có app session; audit vẫn ghi action, target User, field, outcome và thời điểm.

Utility không gọi lại bootstrap, không đụng `AdminBootstrapState`, không thêm HTTP endpoint, không xóa/chỉnh record khác. Session hiện có được giữ nguyên, không thu hồi.

## Kiểm chứng

- TDD: test mới được chạy trước implementation và thất bại do module recovery/prompt chưa tồn tại; sau implementation, bộ test mục tiêu đạt **7/7**.
- `pnpm test`: **27 test files, 232/232 tests passed**.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
- Smoke test launcher: `APP_ENV` thiếu hoặc bằng `staging` đều bị từ chối với `APP_ENV_NOT_ALLOWED`; `APP_ENV=local` nhưng DB host không loopback bị từ chối với `LOCAL_DATABASE_MUST_USE_LOOPBACK`. Cả ba trường hợp dừng trước khi khởi tạo kết nối DB.
- `DATABASE_URL=<loopback synthetic placeholder> pnpm db:validate`: pass; `pnpm db:generate` pass với placeholder loopback chỉ dùng cho sinh client, không kết nối DB.
- Persistence được kiểm thử bằng PGlite với migration hiện có. Ca thành công chứng minh hash thay đổi, audit được append nguyên tử, bootstrap marker và synthetic session vẫn còn nguyên; ca audit lỗi chứng minh credential rollback; non-Admin bị từ chối trước khi hỏi mật khẩu; terminal prompt không echo.
- Không sửa schema/migration, không chạy `db:migrate:deploy`, không kết nối PostgreSQL thật và không chạy thao tác trên DB của owner trong lúc chuẩn bị snapshot.

## File thay đổi so với P0.8

- `README.md`
- `design/RUNBOOK_SECURITY_OPERATIONS_P0.8.md`
- `design/STATUS_P0.8.1.md` (mới)
- `package.json`
- `packages/database/package.json`
- `packages/database/scripts/recover-admin-password.ts` (mới)
- `packages/database/src/admin-bootstrap-terminal.ts`
- `packages/database/src/admin-password-recovery.ts` (mới)
- `packages/database/test/admin-password-recovery-terminal.test.ts` (mới)
- `packages/database/test/admin-password-recovery.test.ts` (mới)

Snapshot P0.8 gốc không bị ghi đè. Không thêm password/email thật hoặc `.env` vào source/fixture.

## Giới hạn còn lại và bước duyệt tiếp

- Cần owner tự chạy CLI trên laptop Windows với `.env`/PostgreSQL local và workspace slug đã xác nhận, rồi thử đăng nhập bằng mật khẩu vừa nhập. Chưa xác nhận tương tác terminal Windows thực tế.
- PostgreSQL native, staging/TLS, backup/restore và browser E2E vẫn chưa được kiểm chứng; PGlite không thay thế các bước đó. CLI recovery chủ ý không chạy trên staging.
- Đổi mật khẩu **không thu hồi session đang mở**. Nếu cần logout-all/suspend khi phục hồi, cần owner duyệt một thay đổi riêng; ngoài phạm vi đã duyệt ở bản này.
- Audit recovery hiện có `actorId=NULL` do không có phiên ứng dụng xác thực. Nếu cần lưu danh tính operator, cần owner duyệt cơ chế attribution riêng, không ghi thông tin bí mật vào log.
- Bước tiếp theo cần owner xác nhận thao tác local thành công; trước khi mở rộng sang staging/pilot, duyệt riêng session revocation/actor attribution nếu muốn và yêu cầu kiểm thử trên PostgreSQL native. Không có thay đổi P0 rộng hơn hoặc deploy nào được thực hiện trong snapshot này.
