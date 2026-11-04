# Trạng thái P0.8 — Bảo mật, vận hành và bootstrap Admin

## Kết quả chính

- Đặt `AUTH_SESSION_TTL_MS=28800000` (8 giờ) và `AUTH_INVITATION_TTL_MS=86400000` (24 giờ) trong `.env.example` đúng quyết định đã duyệt.
- Bổ sung `pnpm db:bootstrap-admin`: chỉ chạy ở local/staging, yêu cầu workspace đã có, từ chối nếu đã có Admin hoặc marker; không có HTTP bootstrap. Email/password nhận qua process env injection an toàn hoặc terminal; credential bootstrap chỉ có trong `.env` bị bỏ qua. Terminal password vào raw mode không echo, non-TTY không an toàn thì từ chối; không có cờ lệnh nhận password.
- Tạo User ACTIVE + membership ADMIN + credential Argon2id + audit event và marker trong một transaction serializable. Marker singleton không có FK tới User, có DB trigger từ chối UPDATE/DELETE và được commit cùng giao dịch; sau thành công CLI bị vô hiệu hóa bền vững, kể cả Admin bị deactivated hoặc membership thay đổi.
- Có runbook P0.8 về phân loại dữ liệu, RBAC/audit, secret/encryption/key rotation, backup/restore, incident, import, queue tương lai, opt-out, mất thiết bị, kịch bản Zalo/Telegram chưa kết nối, monitoring/owner và quyết định kỹ thuật/pháp chế.
- Không tạo lịch chạy, không deploy, không dùng production/live data, không gửi Zalo/Telegram và không xóa dữ liệu. Retention periods/policies vẫn unset và fail-closed.

## Kiểm chứng thực tế

- TDD: test bootstrap mới chạy đỏ trước implementation vì module `admin-bootstrap` chưa tồn tại; sau implementation, test chuyển xanh.
- `pnpm test`: **25 test files, 225/225 tests passed**. Có kiểm tra PGlite synthetic cho tạo Admin/hash/audit/marker, second run bị từ chối, deactivation không mở lại bootstrap, pre-existing Admin bị từ chối trước khi hỏi credential, rollback khi audit append lỗi, marker UPDATE/DELETE bị chặn, credential env bị xóa và không xuất hiện trong output, TTY password không echo, non-TTY fail-closed, TTL chính xác và HTTP bootstrap trả 404.
- `pnpm exec vitest run packages/database/test/admin-bootstrap.test.ts packages/database/test/auth-schema.test.ts`: **10/10 passed** sau migration marker append-only.
- `pnpm exec vitest run packages/auth/test/local-auth-adapter.test.ts packages/database/test/admin-bootstrap.test.ts packages/database/test/auth-schema.test.ts`: **18/18 passed**; bao gồm invite one-time/expired, login, phiên hết hạn/deactivated account và không có self-signup.
- Regression auth trong suite hiện có nằm trong `packages/auth/test/local-auth-adapter.test.ts`, `packages/database/test/auth-schema.test.ts` và `packages/database/test/prisma-auth-repository.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
- `DATABASE_URL=<loopback synthetic placeholder> pnpm db:validate`: pass; `pnpm db:generate`: pass với URL cấu hình tổng hợp, không kết nối DB.
- `pnpm --filter @am-sme/web build`: production build pass.
- PostgreSQL migration được áp dụng trong PGlite synthetic test. Không chạy `db:migrate:deploy` lên server PostgreSQL.

## Giới hạn và blocker

- **PostgreSQL native chưa được kiểm thử**; PGlite không chứng minh native migration/transaction/backup behavior. Chưa có staging, browser E2E hoặc TLS deployment verification.
- CLI orchestration và DB service được kiểm thử trên PGlite; chưa chạy CLI executable qua PostgreSQL native, vì môi trường không có server PostgreSQL. TTY behavior được kiểm thử bằng synthetic TTY stream, không phải phiên terminal người dùng.
- Chưa tạo/chạy backup hoặc restore. Quy trình backup mã hóa và restore vào DB disposable chỉ là runbook đề xuất, chưa thực thi.
- Chưa có dashboard/cảnh báo tự động, queue/worker, mail delivery, bulk session revoke hay UI suspend account. Thiết bị mất cần operator cô lập dịch vụ nếu chưa có quy trình thu hồi session được duyệt.
- Retention theo từng category, người duyệt, time basis, lưu trữ backup và xử lý yêu cầu xóa/đính chính vẫn chờ chủ dữ liệu/pháp chế/tuân thủ; không đặt thời hạn trong P0.8. Tài liệu không đưa ra tư vấn pháp lý.
- RTO/RPO **đề xuất, chưa cam kết**: RPO ≤ 24 giờ; RTO ≤ 8 giờ cho pilot nội bộ, cần đo sau native restore test và được owner duyệt.

## File thay đổi so với snapshot P0.7

- `.env.example`
- `README.md`
- `apps/web/test/http-api.test.ts`
- `design/RUNBOOK_SECURITY_OPERATIONS_P0.8.md`
- `design/STATUS_P0.8.md`
- `packages/auth/test/local-auth-adapter.test.ts`
- `package.json`
- `pnpm-lock.yaml`
- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261103000100_p0_8_admin_bootstrap/migration.sql`
- `packages/database/scripts/bootstrap-admin.ts`
- `packages/database/src/admin-bootstrap-terminal.ts`
- `packages/database/src/admin-bootstrap.ts`
- `packages/database/test/admin-bootstrap-terminal.test.ts`
- `packages/database/test/admin-bootstrap.test.ts`

P0.7 ZIP gốc được giữ nguyên. ZIP P0.8 không bao gồm `.env`, `node_modules`, `.next` hoặc generated Prisma client. Test credentials là chuỗi ngẫu nhiên sinh trong RAM; không thêm password/email thật vào source hoặc fixture.

## Duyệt tiếp trước pilot

Trước staging/pilot với người thật, cần chủ dự án chỉ định owner dữ liệu/bảo mật/vận hành; duyệt phân loại, retention và căn cứ sử dụng dữ liệu; duyệt key custody/backup cùng RTO/RPO chính thức; kiểm thử migration và restore trên PostgreSQL native; và xử lý khoảng trống suspend/revoke-all-session cho thiết bị mất. Chưa được coi P0.8 là phê duyệt triển khai production.
