# AM Viettel SME — P0.8.2

Monorepo TypeScript cho workspace nội bộ AM. P0.8.2 tiếp tục P0.8.1, sửa luồng import để phản hồi validate mang trạng thái handle `VALIDATED` cùng preview mà giao diện cần hiển thị Review, đồng thời chặn submit preview lặp trong lúc request đang chạy. Bản này vẫn giữ CLI khôi phục mật khẩu Admin chỉ tại local từ P0.8.1. Đây vẫn là bản local-first; chưa phải triển khai staging/production.

## Trạng thái quan trọng trước khi chạy

- Admin đầu tiên được tạo bằng `pnpm db:bootstrap-admin` sau migration và seed workspace. CLI chỉ chạy khi chưa có Admin, ghi marker durable trong cùng transaction, không có HTTP bootstrap route và không thể chạy lại kể cả khi Admin đầu tiên bị vô hiệu hóa.
- Khi bootstrap đã thành công nhưng Admin không đăng nhập được, **không chạy lại `db:bootstrap-admin`**. Dùng `pnpm db:recover-admin-password` để thay credential hiện có của đúng Admin đang hoạt động; utility ghi audit cùng transaction, không xóa dữ liệu, không thay marker bootstrap và không tạo HTTP reset route. Utility chỉ chạy local với DB loopback; staging không được phép. Mật khẩu mới chỉ nhập trên terminal tương tác và được ẩn. Các session hiện có không bị thu hồi.
- Auth TTL đã được chốt: `AUTH_SESSION_TTL_MS=28800000` (8 giờ), `AUTH_INVITATION_TTL_MS=86400000` (24 giờ). Không thay đổi các giá trị này khi vận hành.
- Preview/review import giữ dữ liệu tạm trong RAM và hết hạn sau 30 phút kể từ khi tạo preview. Workbook gốc không được ghi vào đĩa; restart tiến trình sẽ làm mất handle, preview và prepared commit. App hiện là single-process.
- Kiểm thử persistence hiện dùng PGlite (PostgreSQL-compatible embedded engine), chưa xác nhận migration/runtime trên PostgreSQL server thật. Chưa có staging deployment hoặc backup/restore test trên PostgreSQL native.
- Dashboard/monitoring nâng cao thuộc P3; không có dashboard trong P0.7. Không tích hợp CRM thật, không gửi Zalo/Telegram, không cấu hình lịch hoặc automation.

## Yêu cầu và cài đặt local

Cần Node.js 22+, pnpm 11+ và Docker Compose cho PostgreSQL/Redis local. Dùng `.env.example` làm mẫu:

```bash
cp .env.example .env
```

Trong `.env`, đổi `POSTGRES_PASSWORD` và `DATABASE_URL` sang cùng một mật khẩu local riêng; đặt các giá trị `AUTH_SESSION_TTL_MS` và `AUTH_INVITATION_TTL_MS` theo chính sách được duyệt. Giữ `APP_ENV=local`, `DATA_MODE=synthetic`, `PUBLIC_SIGNUP_ENABLED=false`, `ZALO_SEND_MODE=disabled` và `APP_ORIGIN=http://127.0.0.1:3000` cho lần chạy local đầu tiên.

```bash
pnpm install --frozen-lockfile
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
pnpm db:validate
pnpm db:migrate:deploy
pnpm db:generate
pnpm db:seed:synthetic
# Lần bootstrap đầu: workspace slug không phải bí mật; CLI hỏi email và password.
AUTH_BOOTSTRAP_WORKSPACE_SLUG=am-sme-local-synthetic pnpm db:bootstrap-admin
pnpm typecheck
pnpm test
pnpm --filter @am-sme/web dev
```

Mở đúng `http://127.0.0.1:3000` để cùng origin khớp `APP_ORIGIN`. API và trang web chỉ bind vào loopback khi chạy local. Dừng dịch vụ bằng `docker compose --env-file .env -f infra/docker-compose.yml down` (không thêm `-v` nếu muốn giữ dữ liệu local).

Seed chỉ tạo dữ liệu doanh nghiệp/contact tổng hợp và không tạo user/Admin, không tạo consent để liên hệ. Không dùng workbook khách hàng thật hoặc production credentials.

CLI bootstrap chỉ chấp nhận `APP_ENV=local` hoặc `staging`, dữ liệu `synthetic`/`approved_test`, public signup tắt và Zalo sending disabled. Khi chạy trên terminal tương tác, password được nhập raw mode và không echo; nếu không có TTY an toàn thì CLI dừng. Có thể dùng `AUTH_BOOTSTRAP_ADMIN_EMAIL` và `AUTH_BOOTSTRAP_ADMIN_PASSWORD` qua process environment/secret injection an toàn; không lưu chúng trong `.env`, shell history hoặc command arguments. CLI tự bỏ qua hai biến nếu chúng chỉ xuất hiện trong `.env`. Sau thành công, `AdminBootstrapState` tự vô hiệu hóa CLI vĩnh viễn cho database đó. Lệnh này không có chức năng reset marker.

### Khôi phục mật khẩu Admin (P0.8.1)

Trên Windows PowerShell, mở terminal tương tác trong thư mục dự án đã giải nén, bảo đảm PostgreSQL local đang chạy và `.env` trỏ đúng DB local. Thay workspace slug dưới đây nếu dùng tên khác; slug không phải bí mật. Lệnh hỏi email Admin rồi hỏi mật khẩu mới; mật khẩu được nhập trong raw mode không echo, không nhận từ tham số hoặc biến môi trường.

```powershell
$env:AUTH_RECOVERY_WORKSPACE_SLUG = "am-sme-local-synthetic"
try { pnpm db:recover-admin-password } finally { Remove-Item Env:AUTH_RECOVERY_WORKSPACE_SLUG }
```

Lệnh chỉ chấp nhận `APP_ENV=local`, DB loopback, dataset `synthetic`/`approved_test`, public signup tắt và gửi Zalo disabled; `staging` bị từ chối. Nó chỉ nhắm một Admin `ACTIVE` có membership `ADMIN` và credential trong workspace được chỉ định. Nếu tài khoản/workspace không khớp, terminal không hỏi mật khẩu. Mật khẩu được băm Argon2id, cập nhật credential hiện có và audit `ADMIN_PASSWORD_RECOVERED` trong cùng transaction serializable. Không sửa marker bootstrap, không xóa hoặc thay đổi record khác, không ghi mật khẩu ra file/log và không thêm endpoint HTTP. CLI yêu cầu TTY an toàn.

Tiện ích này **không thu hồi session hiện có**; session đang mở có thể vẫn dùng được đến khi hết hạn hoặc được thu hồi theo quy trình riêng. Nếu nghi lộ phiên/thiết bị, cô lập dịch vụ và xử lý theo runbook thay vì coi đổi mật khẩu là đủ.

## Luồng giao diện

- **Dashboard hôm nay:** danh sách task trong phạm vi được cấp, tách việc đến hạn hôm nay và quá hạn; không thêm KPI thương mại hay giờ làm mặc định. Dashboard/monitoring nâng cao vẫn ngoài P0.
- **Lead:** danh sách theo phạm vi, chi tiết, contact đã mask, chuyển stage, ghi chú và tạo lead ở `PENDING_REVIEW` kèm nguồn khai báo. Ghi nhận nguồn không đồng nghĩa có quyền liên hệ.
- **Import Excel:** `.xlsx` tối đa 5 MiB → mapping allow-list → preview lỗi/candidate duplicate với contact đã mask → quyết định KEEP/MERGE/SKIP → approve → commit riêng. Commit dùng service transaction/idempotency của P0.4b; suppression, consent, provenance và duplicate được kiểm tra lại tại commit.
- **Tasks & Planner:** task list, tạo task `REVIEW_LEAD` hoặc `INTERNAL`, complete/defer và planner theo ngày/khoảng giờ nhập rõ ràng. P0 không tạo tác vụ gửi tin/call/email tự động.
- **Nhóm & quyền:** Manager xem nhóm/thành viên trong team; Admin xem workspace, mời người dùng và đổi membership role. Invitation link chỉ trả cho Admin, không tự gửi qua email/chat.
- **Audit:** xem sự kiện theo quyền; export CSV có audit event và chống CSV formula injection.

## API `/api/v1`

Mọi route nghiệp vụ yêu cầu session cookie HttpOnly, SameSite=Lax, kiểm tra Origin cho request thay đổi dữ liệu, và authorization phía server. Scope workspace/team/owner tiếp tục do auth guard và repository hiện có kiểm tra; lỗi ngoài phạm vi trả về dạng không tiết lộ record. Response đặt `Cache-Control: no-store`.

- Auth: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/invitations/accept`. Không có public signup.
- Import: `POST /import-jobs`, `GET /import-jobs/:id`, `PUT /import-jobs/:id/mapping`, `POST /import-jobs/:id/validate`, `POST /import-jobs/:id/approve`, `POST /import-jobs/:id/commit`.
- Lead: `GET/POST /leads`, `GET/PATCH /leads/:id`, `POST /leads/:id/stage`, `/assign`, `/notes`, `/contactability`, `/suppressions`.
- Task/planner: `GET/POST/PATCH /tasks`, `POST /tasks/:id/complete`, `POST /tasks/:id/defer`, `GET /planner/today`, `GET/POST /locked-time-blocks`.
- Team/admin/audit: `GET /teams`, `GET/POST /users`, `PATCH /users/:id`, `GET /audit-events` (CSV qua `?format=csv`).

`GET /import-jobs/:id` nhận handle tạm của preview trong cùng tiến trình hoặc ID ImportJob đã commit. Handle preview chỉ dành cho đúng actor/workspace; job đã commit được đọc theo phạm vi workspace/team/owner.

## Kiểm thử và giới hạn

```bash
pnpm db:validate
pnpm typecheck
pnpm test
pnpm --filter @am-sme/web build
```

Test persistence/schema trong snapshot chạy bằng PGlite; test API/UI chạy bằng Vitest/JSdom. PostgreSQL server thật, mail delivery, worker/BullMQ, rate-limit layer, backup/restore, staging TLS/deployment và browser E2E chưa được xác nhận. Chỉ dùng local hoặc staging riêng tư đã được phê duyệt; không deploy public. Xem [runbook P0.8](design/RUNBOOK_SECURITY_OPERATIONS_P0.8.md) để biết giới hạn vận hành và các quyết định còn chờ duyệt.

## Nguyên tắc dữ liệu

- Chỉ dữ liệu synthetic hoặc test dataset có mã phê duyệt.
- Không lưu workbook thô; không log PII từ upload; chỉ hiển thị contact đã mask mặc định.
- Lead mới giữ `PENDING_REVIEW`, contact mới `UNKNOWN`; unknown/suppressed/opt-out không mở cổng liên hệ.
- P0 không gửi Zalo/Telegram và không tự tạo campaign. Adapter CRM thực vẫn ngoài phạm vi.
- Retention policy không được tự đặt; staging yêu cầu cấu hình `DATA_RETENTION_DAYS` có phê duyệt.
