# Trạng thái P0.4b — Atomic import commit, idempotency và audit

## Kết quả

P0.4b thêm `ImportCommitRepository` trong `@am-sme/database`. Repository nhận các dòng đã map; tự tính lại provenance/consent gate P0.3c; yêu cầu review group và KEEP/MERGE/SKIP hợp lệ theo contract P0.4a; rồi ghi dữ liệu trong cùng một database transaction. Không thêm parser workbook, UI/preview, route/API endpoint, lead CRUD, retention, planner, contact task/queue hoặc tích hợp gửi Zalo/Telegram.

Mỗi dòng được giữ, gộp hoặc bỏ qua đều có `ImportRowResult` và audit action. MERGE kiểm tra candidate/target trong workspace ở thời điểm commit; nếu snapshot không còn khớp hoặc làm yếu consent/suppression hiện tại, commit bị từ chối/rollback. Merge không xóa contact, evidence, consent, audit hoặc suppression cũ; thông tin contact không ghi đè dữ liệu đang có, chỉ bổ sung trường còn trống. Opt-out tạo suppression cả năm channel; opt-out/suppression ở target tiếp tục fail-closed.

Audit chỉ nhận action, entity ID, job ID, tên field đã thay đổi và enum trạng thái consent/contactability trước/sau; không ghi phone/email/tên liên hệ/evidence string/raw row. Import không tạo task hay side-effect queue. Idempotency key duy nhất theo workspace; SHA-256 checksum cũng duy nhất theo workspace. Cùng key/checksum được tái sử dụng; key dùng lại với file khác và checksum đã dùng với key khác đều bị từ chối. Commit replay trả kết quả cũ; lỗi transaction/audit rollback toàn bộ lead/contact/consent/suppression/row result/audit rồi thử đặt job `ROLLED_BACK` với `failureReasonCode` an toàn. Retry cùng key/checksum sau rollback được phép.

## Tệp thay đổi

- `packages/database/src/import-commit.ts` — SQL port, Prisma transaction adapter, tạo import job idempotent, gate/review validation, commit/merge/suppression/audit và rollback status.
- `packages/database/test/import-commit.test.ts` — PGlite integration tests dùng dữ liệu synthetic.
- `packages/database/prisma/schema.prisma` — thêm `ImportJob.failureReasonCode`, unique checksum theo workspace và các enum status before/after trên `AuditEvent`.
- `packages/database/prisma/migrations/20261102000500_p0_4b_import_commit/migration.sql` — migration tiến tới cho các thay đổi import job, audit trạng thái và checksum trên.
- `packages/database/package.json`, `pnpm-lock.yaml` — export persistence package và nối các workspace contract domain/import.
- `packages/excel-import/README.md`, `README.md` — cập nhật ranh giới P0.4b và hướng dẫn/giới hạn.
- `design/STATUS_P0.4B.md` — tài liệu package hiện tại.

Các file P0.4a khác được giữ nguyên; snapshot P0.4a gốc không bị sửa hoặc ghi đè.

## Kiểm thử và xác minh

Quy trình test-first đã chạy: test mới lần đầu fail vì module P0.4b chưa tồn tại; sau khi triển khai, test failure-injection phát hiện adapter test chưa chuyển `execute` qua hook. Sửa adapter rồi chạy pass.

- Test mới P0.4b: **11/11 pass** trên PGlite.
- `pnpm test`: **141/141 pass**, 15 test files (130 baseline P0.4a + 11 P0.4b).
- Các test bao phủ: job/idempotency key/checksum; validation và candidate chưa resolve; SKIP cho dòng lỗi; commit từ job đã map/review-resolve; tạo lead/contact/source/row result/audit; consent `ALLOWED` thiếu bằng chứng vẫn review-required và không tạo task; opt-out suppression 5 channel; database commit failure rollback cả batch; audit append failure rollback gồm suppression/audit; retry cùng idempotency key; repeated committed request; merge giữ target opt-out/suppression và audit status before/after; audit không chứa raw PII.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
- Với `DATABASE_URL` placeholder local, `pnpm db:validate` pass và `pnpm db:generate` pass (Prisma 7.10.1).
- Migration P0.4b và các transaction/failure path được chạy trong PGlite test suite; ZIP integrity được kiểm tra trước khi giao.

Persistence/migration thực tế đã được chạy trên PGlite, một embedded PostgreSQL-compatible test adapter. **Không chạy PostgreSQL native** trong workspace này; vì vậy đây không phải native PostgreSQL verification và không tuyên bố migration đã được kiểm chứng trên PostgreSQL server thật. Native PostgreSQL là bước kiểm chứng còn thiếu trước khi dùng trên DB local/staging.

## Áp dụng migration trong snapshot người dùng

Migration mới thay unique index checksum. Trước khi chạy trên một database P0.4a đã có dữ liệu, kiểm tra xem cùng workspace có nhiều `ImportJob.fileChecksum` trùng nhau hay không; migration sẽ thất bại nếu có duplicate. Không xóa hoặc hợp nhất job tự động. Xử lý duplicate theo quy trình được duyệt trước khi migrate.

Trong thư mục snapshot mới, sau khi cấu hình `.env` trỏ tới PostgreSQL local đã được duyệt:

```bash
pnpm install --frozen-lockfile
pnpm db:validate
pnpm db:migrate:deploy
pnpm db:generate
pnpm test
```

Không áp dụng migration lên production; chưa có dữ liệu/credential PostgreSQL người dùng trong lượt này.

## Bàn giao snapshot

Giải nén ZIP riêng vào thư mục mới, không ghi đè P0.4a. Tạo thư mục sibling chính xác:

`C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme-p0.4b`

ZIP có các file dự án ở archive root; khi giải nén, chọn chính thư mục `am-viettel-sme-p0.4b` mới tạo làm đích. Không giải nén vào thư mục P0.4a.
