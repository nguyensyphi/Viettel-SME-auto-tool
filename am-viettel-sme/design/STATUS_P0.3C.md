# Trạng thái P0.3c — Provenance và consent gate

## Kết quả

P0.3c hoàn tất trong phạm vi pure validation/domain service và repository contract. `source`, `source_url` và `lawful_contact_basis` được giữ như provenance map từ workbook; thiếu source hoặc căn cứ hợp lệ thì dòng cần review. Consent để trống vẫn là `UNKNOWN`. Workbook ghi `OPTED_OUT` tạo suppression instruction phạm vi mọi channel (template hiện không có trường channel), và trạng thái hiệu lực là `SUPPRESSED`. Workbook ghi `ALLOWED_FOR_RECORDED_PURPOSE` bị hạ `REVIEW_REQUIRED` nếu thiếu consent evidence, channel, purpose hoặc timestamp hợp lệ. Gate chặn contact task nếu status chưa duyệt, opted-out hoặc suppressed; trạng thái allowed cũng cần đủ evidence. Import không tạo hoặc enqueue contact task.

Repository nhận một aggregate command gồm lead đã qua gate, suppression intent nếu có và audit metadata chỉ chứa reason codes/intent; không có raw phone/email trong metadata audit. Contract yêu cầu adapter tương lai ghi lead, suppression và audit trong cùng DB transaction.

## TDD và kiểm tra thực tế

- Trước khi triển khai logic, test mới chạy đỏ: policy có **2 test fail** do thiếu kiểm tra consent evidence và hàm gộp trạng thái; provenance test chưa load được module chưa tồn tại. Sau vòng implement đầu, test bắt thêm lỗi suppression chưa được gửi thành field riêng trong repository command; lỗi đã được sửa.
- Test mục tiêu sau sửa: **39/39 pass** (3 file test domain/Excel).
- Toàn repo: `pnpm test` — **13 files, 121/121 tests pass**.
- `pnpm typecheck` — pass sau khi chạy `pnpm db:generate` để tạo Prisma Client ignored/generated.
- `pnpm lint` — pass; `pnpm format:check` — pass.
- `pnpm db:validate` — pass; `pnpm db:generate` — pass (Prisma 7.10.1).

## File thay đổi

- `README.md` và `design/STATUS_P0.md` — cập nhật trạng thái tổng quan, giữ báo cáo cũ làm baseline lịch sử.
- `design/STATUS_P0.3C.md` — báo cáo snapshot này.
- `packages/domain/src/contactability/policy.ts` — consent evidence gate, provenance review assessment, suppression intent và merge precedence fail-closed.
- `packages/domain/test/contactability-policy.test.ts` — test consent evidence thiếu, status UNKNOWN/OPTED_OUT/SUPPRESSED và opt-out ưu tiên.
- `packages/excel-import/src/provenance.ts` — pure importer provenance assessor và repository port.
- `packages/excel-import/src/index.ts` — xuất public API/type provenance.
- `packages/excel-import/test/provenance.test.ts` — test missing source, unknown default, downgrade ALLOWED, suppression, effective repository payload, audit metadata và repository failure propagation.
- `packages/excel-import/test/contract.test.ts` — regression test giá trị ALLOWED thô không mở contactability.
- `packages/excel-import/README.md` — cập nhật ranh giới và cách dùng gate.
- `packages/excel-import/package.json`, `pnpm-lock.yaml` — khai báo dependency workspace domain.

## Chưa triển khai / bước tiếp theo

Không thêm Prisma field, schema hay migration. Snapshot không có Excel DB importer hoặc transaction ghi lead/suppression/audit; vì vậy P0.3c không giả lập transaction, không tuyên bố rollback DB đã được kiểm thử, và chưa có kiểm thử PostgreSQL native cho import. `pnpm db:validate`/`db:generate` chỉ xác nhận schema/client hiện có. Atomic commit và kiểm thử audit-failure rollback thuộc P0.4b. Gói kế tiếp theo kế hoạch là **P0.4a dedupe/review**; chưa triển khai parser/preview UI, dedupe/merge, lead CRUD, retention, planner, Zalo/Telegram hoặc dữ liệu khách hàng thật.

Giữ nguyên snapshot P0.3b. Bản mới được đóng gói riêng để giải nén vào thư mục sibling `C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme-p0.3c`.
