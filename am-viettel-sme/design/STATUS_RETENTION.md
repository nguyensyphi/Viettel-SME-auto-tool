# Trạng thái package Retention

## Kết quả

Đã thêm retention job/service có thể gọi trực tiếp, không tạo scheduler, giao diện hay tích hợp ngoài. Job đọc policy theo workspace và chỉ thực thi category khi có đủ `retentionDays`, approver, `approvedAt` hợp lệ và `timeBasis` được hỗ trợ. Thiếu policy, số ngày, phê duyệt hoặc time basis đều trả trạng thái `BLOCKED` kèm reason code; không xóa dữ liệu ở các trường hợp đó.

Trong Prisma, `DataRetentionPolicy.timeBasis` là nullable, không có default; migration cũ vì thế vẫn fail-closed. Service chỉ có nhánh thực thi cho `IMPORT_ROW_RESULTS` theo `createdAt`, với cutoff UTC `asOf - retentionDays`; chỉ bản ghi **cũ hơn nghiêm ngặt** cutoff (`createdAt < cutoff`) mới đủ điều kiện. Bản ghi đúng bằng cutoff được giữ lại. Job append một audit marker trong cùng transaction; unique index theo workspace/run/category làm retry cùng `runId` idempotent.

Không có mặc định retention period hoặc policy được tạo. Giá trị ngày trong test là fixture tổng hợp chỉ để kiểm tra nhánh approved, không phải cấu hình dự án.

## Category bị chặn

- `RAW_WORKBOOK`: chưa có storage adapter/vòng đời workbook để thực thi; trạng thái `CATEGORY_HANDLER_UNAVAILABLE`.
- `LEAD_DATA`: chưa có quyết định retention/rectify được duyệt; có thể ảnh hưởng consent, suppression và hard-stop contactability nên không có nhánh xóa; trạng thái `LEAD_DATA_POLICY_REVIEW_REQUIRED`.
- `AUDIT_EVENTS`: bị chặn bằng `AUDIT_APPEND_ONLY`; không có thao tác sửa/xóa evidence audit.
- `IMPORT_ROW_RESULTS`: chỉ có thể thực thi khi policy được duyệt đầy đủ, basis là `CREATED_AT`, và category executor kiểm tra policy lần nữa bên trong transaction. Mọi category khác hoặc time basis khác đều no-op.

Log/result chỉ chứa category, trạng thái, reason code, cutoff và số bản ghi; không ghi workspace ID, người duyệt, số điện thoại/email, nội dung lead hoặc exception thô. Không thay đổi opt-out/suppression gates hiện có.

## Tệp thay đổi so với snapshot P0.5

Đã sửa:

- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`

Đã thêm:

- `design/STATUS_RETENTION.md`
- `packages/database/prisma/migrations/20261102000700_retention_job/migration.sql`
- `packages/database/src/retention.ts`
- `packages/database/test/retention.test.ts`

Không xóa hoặc sửa nội dung các file implementation P0.5; không đổi lockfile.

## Kiểm thử thực tế

TDD: suite retention ban đầu fail trước implementation vì `packages/database/src/retention.ts` chưa tồn tại. Sau implement và sửa lỗi kiểu tham số audit trong PGlite, kết quả cuối:

- `pnpm exec vitest run packages/database/test/retention.test.ts`: **16/16 pass**.
- `pnpm test`: **168/168 pass**, 17 test files.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm format:check`: pass.
- `pnpm db:validate`: pass.
- `pnpm db:generate`: pass với Prisma 7.10.1.

PGlite áp migration từ database rỗng với dữ liệu synthetic. Đã kiểm tra category thiếu/unapproved/null days/thiếu hoặc sai basis, cutoff và boundary, retry/idempotency, audit append-only, rollback khi append audit thất bại, log không chứa PII, và bảo toàn contact `SUPPRESSED` cùng suppression record. **PostgreSQL native chưa được kiểm thử**; Prisma validate/generate dùng URL placeholder, không kết nối DB. Không chạy migration lên laptop hoặc DB live.

## Còn thiếu và bước kế tiếp

Chủ dự án/đơn vị dữ liệu vẫn cần quyết định retention period, người duyệt, time basis và cách xử lý cho từng category trước khi cấu hình policy. Cần xác nhận riêng vòng đời raw workbook; phạm vi lead/contact và cách bảo vệ consent/suppression; audit không được xóa theo thiết kế hiện tại. Không chạy retention trên dữ liệu thật trước các quyết định đó và kiểm thử PostgreSQL native.

Theo thứ tự đã chốt, package kế tiếp là **P0.6 — Tasks và AM planner**.
