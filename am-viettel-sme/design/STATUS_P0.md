# Đối chiếu yêu cầu và trạng thái P0

**Cập nhật:** 02/11/2026, sau P0.3c.

> Trạng thái hiện hành và kết quả kiểm thử của P0.3c nằm trong [`STATUS_P0.3C.md`](./STATUS_P0.3C.md). Phần báo cáo bên dưới được giữ làm baseline/historic snapshot P0.3b; các ghi chú “chưa có consent/provenance gate” và “không thực hiện P0.3c” đã được thay thế bởi tài liệu mới.

## Kết luận

P0.0/P0.1 nền tảng, P0.2 auth foundation và P0.3a template/schema/mapping được giữ nguyên. P0.3b bổ sung pure functions chuẩn hóa/validation company name, phone, email và integration tối thiểu với adapter map một dòng. Đây vẫn chưa phải importer vận hành: chưa có parser `.xlsx` đầy đủ, preview/UI/log runtime, consent/provenance end-to-end, dedupe/merge hoặc commit DB. Lead CRUD, retention worker, planner, API/UI và staging cũng chưa triển khai.

## Theo yêu cầu đã gửi

| Yêu cầu                                               | Trạng thái hiện tại                                                                                                                                                                                                                                                                                                                                                                                                                                        | Còn thiếu / ranh giới                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Modular monolith, PostgreSQL, local trước rồi staging | Workspace TypeScript và `@am-sme/database`; Prisma 7.10.1                                                                                                                                                                                                                                                                                                                                                                                                  | Chưa chạy migration trên PostgreSQL server thật hoặc staging                                                                     |
| Workspace isolation                                   | Schema có `workspaceId`; auth credentials/sessions có FK composite; auth policy/HTTP guard khóa workspace/owner/team                                                                                                                                                                                                                                                                                                                                       | Lead CRUD/routes vẫn phải áp scope ở mỗi truy vấn                                                                                |
| Auth/RBAC P0.2                                        | Provider-neutral auth/session, local admin invite/password/session, Prisma persistence, server-side RBAC, HTTP guard/cookie helpers; baseline P0.2 58/58 test                                                                                                                                                                                                                                                                                              | Chưa có HTTP login/invite controllers, CSRF/rate-limit, email delivery hoặc OIDC adapter                                         |
| Tối thiểu hóa dữ liệu                                 | Không thêm trường CMND/CCCD/ngày cấp/nơi cấp/ngày sinh hoặc lưu raw workbook row; P0.3a chỉ trả metadata header/cột                                                                                                                                                                                                                                                                                                                                        | Chưa có parser runtime hoặc quy trình xử lý/retention file import hoàn chỉnh                                                     |
| Excel template 17 cột / schema / mapping / validation | **P0.3a + P0.3b:** template 17 field, allow-list mapping/header theo tên, block/cảnh báo cột định danh cá nhân; company name trim/gộp whitespace/NFC và tạo match key chỉ cho gợi ý; phone VN được chuẩn hóa theo pattern đã duyệt, international `+` khác giữ `NEEDS_REVIEW` không có key dedupe; email trim/validate và lowercase key riêng; lỗi không echo giá trị. Adapter vẫn giữ `PENDING_REVIEW`; consent/căn cứ/contactability mặc định `UNKNOWN`. | Chưa có parser/preview UI/log runtime, consent/provenance gate, dedupe/review, atomic commit/idempotency. Không liên hệ tự động. |
| Retention                                             | Schema `DataRetentionPolicy` theo workspace/category, không có ngày mặc định                                                                                                                                                                                                                                                                                                                                                                               | Chưa có quyết định thời hạn chính thức hoặc retention worker                                                                     |
| Opt-out/suppression/audit                             | Schema append-only và DB guard cho suppression/audit                                                                                                                                                                                                                                                                                                                                                                                                       | Service/API transaction và race-test trên PostgreSQL thật còn ở package sau                                                      |
| Synthetic/local/staging; không gửi Zalo thật          | P0.3b chỉ dùng giá trị tổng hợp trong tests; workbook template rỗng                                                                                                                                                                                                                                                                                                                                                                                        | Không dùng production/workbook thật; không gửi Zalo/Telegram                                                                     |
| Vị trí code trên máy người dùng                       | Sandbox không gắn ổ C:; ZIP snapshot P0.3b là artifact bàn giao                                                                                                                                                                                                                                                                                                                                                                                            | Giữ nguyên snapshot trước; giải nén snapshot mới vào thư mục sibling, không đè thư mục hiện tại                                  |

## File đã có từ P0.3a (giữ nguyên)

- `packages/excel-import/package.json`
- `pnpm-lock.yaml` (thêm importer workspace rỗng; không thêm dependency)
- `packages/excel-import/src/index.ts`
- `packages/excel-import/test/contract.test.ts`
- `packages/excel-import/scripts/create-template.py`
- `packages/excel-import/templates/lead-import-template.xlsx`
- `packages/excel-import/README.md`
- `.gitignore` (ngoại lệ chỉ cho template rỗng; vẫn ignore workbook/CSV dữ liệu)
- `README.md`
- `design/STATUS_P0.md`

## File thay đổi trong P0.3b

- `packages/excel-import/src/normalization.ts` (pure normalizers, validator contracts và mask helpers)
- `packages/excel-import/src/index.ts` (normalized keys/status và validation trong row adapter)
- `packages/excel-import/test/normalization.test.ts` (test pure functions)
- `packages/excel-import/test/adapter-validation.test.ts` (test integration adapter)
- `packages/excel-import/README.md`
- `packages/excel-import/scripts/create-template.py`
- `packages/excel-import/templates/lead-import-template.xlsx` (chỉ cập nhật hướng dẫn phiên bản P0.3b; không có hàng dữ liệu)
- `README.md`
- `design/STATUS_P0.md`

Không đổi Prisma schema/migration, lead CRUD, retention, planner hoặc tích hợp gửi tin. Không xóa file P0.2. `packages/database/generated/` vẫn là generated/ignored; README hướng dẫn chạy `pnpm db:generate` trước typecheck trong workspace mới.

## Kiểm tra thực tế P0.3b

- Test-first tương đương: 29 test P0.3b mới chạy đỏ trước implementation do thiếu normalizers/status; sau đó toàn bộ tests mới pass. Tests bao phủ whitespace/dấu phân cách, `+84`, prefix `84` 11 chữ số, `+86`, độ dài phone sai, malformed email, Unicode/NFC, tên công ty và masking; adapter không echo PII trong error.
- `pnpm exec vitest run packages/excel-import/test/normalization.test.ts packages/excel-import/test/adapter-validation.test.ts packages/excel-import/test/contract.test.ts`: **50/50** pass; gồm contract P0.3a 21/21.
- `pnpm test`: **108/108** pass trên 12 file.
- `pnpm typecheck`: pass sau khi sinh Prisma Client trong thư mục generated/ignored.
- `pnpm lint`: pass.
- `pnpm format:check`: pass.
- `DATABASE_URL` placeholder local + `pnpm db:validate`: pass; `pnpm db:generate`: pass, Prisma Client 7.10.1. Không áp dụng migration.
- Workbook QA bằng openpyxl và LibreOffice: đúng 17 header, 4 dropdown, 0 data rows, 0 formula; hướng dẫn P0.3b/`NEEDS_REVIEW` có mặt và hướng dẫn cũ đã bỏ. PDF render **3 trang** (1 header Leads, 2 hướng dẫn); các trang hướng dẫn không bị cắt hoặc có dấu `###`.
- Không có migration P0.3b; không đổi Prisma schema/lead CRUD/retention/planner/Zalo/Telegram. Docker/psql/PostgreSQL server thật chưa được kiểm tra trong môi trường này; đây là giới hạn kế thừa của snapshot.

## Bàn giao / bước kế tiếp

P0.3b là package duy nhất làm trong lượt này. Giữ nguyên snapshot trước tại `C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme`; giải nén ZIP P0.3b vào thư mục mới `C:\Users\LENOVO\Downloads\viettel hcm di an\AI agent\Project\viettel auto tool\New folder\am-viettel-sme-p0.3b` để giữ các snapshot trước.

Không thực hiện P0.3c, P0.4, lead CRUD, retention hay planner trong lượt này. Package hiện tại chỉ hoàn tất P0.3b; không phải parser/preview/importer vận hành.
