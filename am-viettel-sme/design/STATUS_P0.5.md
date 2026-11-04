# Trạng thái P0.5 — Lead workspace và timeline

## Kết quả

P0.5 bổ sung `LeadWorkspaceRepository` trong `@am-sme/database` làm backend application/persistence service; không thêm UI, route/controller hay server runtime.

- Có tạo/cập nhật lead và contact; danh sách hỗ trợ tìm kiếm, lọc, phân trang; detail trả source/provenance, contactability, notes, product interest và timeline.
- AM chỉ thấy/sửa lead mình sở hữu. Manager bị giới hạn ở lead của team mình và chỉ giao lead cho AM cùng team. Admin được truy cập lead trong workspace. Membership/role được kiểm tra từ DB; các truy vấn luôn gắn workspace.
- Danh sách và audit/timeline không trả số điện thoại, email hay nội dung ghi chú trong audit. Liên hệ trong list/detail được mask mặc định; consent detail chỉ trả cờ có bằng chứng, không trả evidence reference.
- Stage chỉ theo cạnh tuần tự trong thiết kế: `PENDING_REVIEW → NEW → QUALIFIED → CONTACTED → MEETING_SET → PROPOSAL → WON | LOST`. Không cho nhảy stage, đảo trạng thái kết thúc hoặc tự thêm cạnh khác. Cần source trước khi rời `PENDING_REVIEW` và trước `QUALIFIED`.
- Cho phép AM ghi product interest; ghi chú có thể thêm/sửa. Audit chỉ lưu action, entity ID và tên trường, không lưu giá trị note/contact/source/evidence.
- Bật `ALLOWED_FOR_RECORDED_PURPOSE` cần actor hợp lệ, route của kênh, source với contact basis có thể hành động, purpose, evidence reference và timestamp. `canContact` kiểm tra từng kênh; `UNKNOWN`, `REVIEW_REQUIRED`, `OPTED_OUT`, `SUPPRESSED` hoặc thiếu bằng chứng đều bị chặn. Package này không tạo task liên hệ.
- Suppression/opt-out ghi trạng thái `SUPPRESSED` và suppression cho đủ 5 kênh trong một transaction; mỗi bản ghi nối với audit event đúng theo DB guard. Audit failure làm rollback toàn bộ. P0.5 không cung cấp thao tác gỡ suppression/mở lại contactability vì chưa có chính sách được duyệt cho việc đó.

## Tệp thay đổi chính xác so với ZIP P0.4b

Đã sửa:

- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`
- `packages/database/test/schema-contract.test.ts`

Đã thêm:

- `design/STATUS_P0.5.md`
- `packages/database/prisma/migrations/20261102000600_p0_5_lead_workspace/migration.sql`
- `packages/database/src/lead-workspace.ts`
- `packages/database/test/lead-workspace.test.ts`

Không xóa file P0.4b nào.

## Migration và lưu trữ

Migration mới `20261102000600_p0_5_lead_workspace` chỉ thêm bảng workspace-scoped `LeadNote` và hai cột stage before/after vào `AuditEvent`. Migration cũ P0.4b và logic atomic import không bị sửa. P0.5 không chạy migration trên database của người dùng.

Nếu triển khai lên DB local, chạy lần lượt migrations có trong snapshot. Khi nâng DB P0.4a, trước đó vẫn phải kiểm tra điều kiện unique checksum của migration P0.4b theo hướng dẫn trong `STATUS_P0.4B.md`; không tự xóa/hợp nhất import job trùng.

## Kiểm thử thực tế

Quy trình test-first: test P0.5 đầu tiên fail vì module service chưa tồn tại trong khi 141 test baseline pass; sau khi implement, focused P0.5 PGlite suite pass **10/10**.

- `pnpm test`: **152/152 pass**, 16 test files (bao gồm P0.5 và các package trước).
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm format:check`: pass.
- `pnpm db:validate`: pass.
- `pnpm db:generate`: pass với Prisma 7.10.1.
- PGlite đã áp toàn bộ migration từ database rỗng và kiểm thử persistence, RBAC/team scope, timeline, consent/suppression audit-link, suppression rollback và không rò PII trong audit.

**PostgreSQL native chưa được kiểm thử.** PGlite là embedded PostgreSQL-compatible test adapter, không thay thế xác minh trên PostgreSQL server thật. Các lệnh Prisma validate/generate dùng URL placeholder và không kết nối database.

## Giới hạn và gói tiếp theo

Không thêm export, soft delete, retention job, Excel parser/preview, task scheduler/planner, HTTP API/UI, CRM, Zalo hoặc Telegram. P0.5 không thay đổi pipeline P0.4b; cột notes trong workbook không được đưa vào `LeadNote` bởi import commit hiện tại. Cũng chưa có chính sách được duyệt để gỡ suppression, mở lại contactability, hoặc chuyển stage ngoài graph tuần tự đã ghi.

Gói tiếp theo theo kế hoạch: **P0.6 — Tasks và AM planner**.

## Snapshot

ZIP có file dự án ở archive root. Tạo thư mục sibling mới sau rồi giải nén ZIP vào đúng thư mục đó; không ghi đè P0.4b:

`C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme-p0.5`
