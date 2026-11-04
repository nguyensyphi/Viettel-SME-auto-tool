# Trạng thái P0.6 — Tasks và AM planner

## Kết quả

P0.6 bổ sung repository Tasks cho local/staging, không thêm UI, route/controller, worker, scheduler bên ngoài hay tích hợp CRM/Zalo/Telegram.

- Có tạo, giao, hoàn tất, hoãn và hủy task; task lưu lead/contact reference, outcome mục tiêu và kết quả hoàn tất, suggested service chỉ khi đã có `ProductInterest` được AM xác nhận, thời lượng, deadline, next action, priority reason và trạng thái. Hành động ghi AuditEvent trong cùng transaction; audit không lưu giá trị outcome/next action.
- Contact task loại `CALL`, `EMAIL`, `MEETING`, `FOLLOW_UP` cần lead, contact và channel. Tạo task liên hệ trực tiếp kiểm tra policy contactability đang có; trạng thái chưa duyệt, review, opt-out hoặc suppression bị chặn.
- Khi hoãn và AM đề xuất một contact action tiếp theo, hệ thống tạo task đề xuất ở trạng thái `PENDING_AM_APPROVAL`; planner không xếp task đó. Chỉ AM được giao task mới duyệt được; lúc duyệt policy contactability được đánh giá lại. Đây chỉ là task nội bộ, không gửi hoặc enqueue liên hệ.
- Locked time block được nhập thủ công, kiểm tra trùng thời gian, có audit và chỉ có thao tác tạo/đọc trong package này. Planner giữ nguyên các block, xếp task vào khoảng trống và không cập nhật/xóa block.
- Planner chỉ cho AM đang hoạt động lập kế hoạch ngày của chính mình. `Asia/Ho_Chi_Minh` là múi giờ cố định của ngày; người gọi phải truyền cửa sổ rảnh rõ ràng, không dùng giờ làm mặc định. Planner ưu tiên follow-up quá hạn/đến hạn, appointment, rồi stage theo thứ tự pipeline; tối đa 8 candidates, hoặc lấy toàn bộ nếu có dưới 5. Candidate và task xếp vừa khung giờ được trả riêng.
- Planner là phép tính đọc-only trên task hiện có nên chạy lại không ghi thêm hay nhân đôi task. Task liên hệ chỉ vào candidate khi đã được AM duyệt và policy hiện tại vẫn cho phép; task review/internal không liên hệ vẫn có thể được lên kế hoạch.

## Tệp thay đổi chính xác so với snapshot retention

Đã thêm:

- `design/STATUS_P0.6.md`
- `packages/database/prisma/migrations/20261102000800_p0_6_tasks_planner/migration.sql`
- `packages/database/src/tasks.ts`
- `packages/database/test/tasks.test.ts`

Đã sửa:

- `packages/database/package.json`
- `packages/database/prisma/schema.prisma`

Không sửa hoặc xóa file retention, P0.5, import/dedupe/review hay lead CRUD hiện có.

## Migration và kiểm thử thực tế

Migration mới nối tiếp `20261102000700_retention_job`. Contact task cũ (nếu có) được chuyển sang `PENDING_AM_APPROVAL`, không được mặc định xem là đã được AM duyệt. Không chạy migration trên database của người dùng hoặc dữ liệu thật.

- P0.6 test-first: test mới fail trước vì module `tasks.ts` chưa tồn tại; sau triển khai, focused P0.6 suite pass **10/10**.
- `pnpm test`: **178/178 pass**, 18 test files.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- `pnpm format:check`: pass.
- `pnpm db:format`, `pnpm db:validate`, `pnpm db:generate`: pass với URL placeholder; không kết nối DB thật.
- PGlite đã áp toàn bộ migration từ database rỗng và chạy fixture tổng hợp cho scope/RBAC, overload, due/overdue order, locked-block conflict/preservation, defer/AM approval, suppressed lead, planner idempotency, CRUD/audit, suggested service đã xác nhận và contactability fail-closed.

**PostgreSQL native chưa được kiểm thử.** PGlite là embedded PostgreSQL-compatible test adapter, không thay thế xác minh trên PostgreSQL server thật.

## Giới hạn và gói tiếp theo

Không có app UI/routes, thông báo/reminders, tác vụ định kỳ, auto-contact, voice/TTS, tích hợp CRM, Zalo/Telegram hoặc KPI thương mại. Cần kiểm thử migration trên PostgreSQL native và xác nhận quy trình/giờ làm với chủ dự án trước khi pilot dữ liệu thật. Gói tiếp theo theo thứ tự đã chốt là **P0.7 — Frontend UX và API integration**; không được triển khai trong package này.

## Snapshot

ZIP bàn giao có các file dự án ở archive root; lưu vào thư mục sibling mới, không ghi đè snapshot retention/P0.5:

`C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme-p0.6`
