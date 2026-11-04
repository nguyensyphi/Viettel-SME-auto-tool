# Trạng thái P0.3d — XLSX parser và import preview

## Kết quả

Đã thêm parser `.xlsx` chỉ đọc và `ImportPreviewService` dùng được như service API cho P0.7. Không có UI, HTTP route/controller, object storage hoặc thay đổi schema/migration.

- Parser đọc sheet hiển thị `Leads` của template hiện hành; sheet hướng dẫn được bỏ qua. Không ép ô numeric/boolean/error thành chuỗi. Formula cell, macro, external link, file mã hóa, ZIP không hợp lệ, chữ ký/đuôi file không khớp và định dạng `.xlsm`/`.xls` bị từ chối. Không tính toán công thức hay thực thi nội dung workbook.
- Giới hạn mặc định: file nén **5 MiB**, **256 ZIP entries**, tổng giải nén **16 MiB**, mỗi entry **8 MiB**, tỷ lệ tối đa **100:1**, tối đa **10.001 chỉ số hàng** (header + 10.000 dòng dữ liệu), **64 cột**, **250.000 XML nodes/part** và **128 mức XML lồng nhau**. Các giới hạn parser có thể cấu hình; đây là guard kỹ thuật, không phải quyết định dung lượng dữ liệu thật.
- Preview gọi mapping allow-list, validation/normalization, provenance và duplicate candidate contract sẵn có. Unknown columns bị cách ly; cần AM xác nhận bỏ qua trước khi chuẩn bị commit. Personal-identifier header bị chặn. Contact trong preview được mask; lỗi chỉ chứa code/field. Dòng hợp lệ có stage `PENDING_REVIEW`; UNKNOWN/REVIEW_REQUIRED không thành contactable; OPTED_OUT giữ suppression intent all-channel.
- Preview không gọi repository và không ghi DB. `commitEligible` luôn `false` ở preview. Người duyệt phải quyết định KEEP/MERGE/SKIP cho từng dòng; lỗi chỉ được SKIP, MERGE phải trỏ tới candidate trong nhóm. `prepareReviewedCommit` chỉ phát handle nội bộ trong RAM; `commitPrepared` mới gọi `ImportCommitRepository.createJob/commit` của P0.4b. Không có auto-commit lúc upload/preview.
- Raw workbook bytes không được ghi hoặc giữ lại. Mapped drafts/evidence chứa PII được giữ tạm trong RAM của service instance (mặc định tối đa 10 import hoạt động), tới khi discard, commit thành công hoặc tiến trình dừng; không tự đặt TTL/retention period. Preview mất khi tiến trình dừng. Không có log PII.

## Tệp thay đổi chính xác so với snapshot P0.6

Đã thêm:

- `design/STATUS_P0.3D.md`
- `packages/database/src/import-workflow.ts`
- `packages/database/test/import-workflow.test.ts`
- `packages/excel-import/src/workbook.ts`
- `packages/excel-import/test/workbook-parser.test.ts`

Đã sửa:

- `packages/database/package.json` — export subpath `@am-sme/database/import-workflow`
- `packages/excel-import/README.md` — mô tả parser, giới hạn và ranh giới workflow
- `packages/excel-import/package.json` — thêm runtime XML parser `saxes`
- `packages/excel-import/src/index.ts` — export API parser
- `pnpm-lock.yaml` — khóa dependency `saxes`

Không sửa migration, Prisma schema, lead/task/planner/retention logic hoặc gói trước. `prisma format` không làm thay đổi schema so với snapshot P0.6.

## Kiểm thử và xác minh

- Test-first cho parser: suite mới fail trước khi `workbook.ts` tồn tại; sau triển khai parser và service suites pass **15/15**.
- `pnpm test`: **193/193 pass**, 20 test files (178 baseline + 15 mới).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
- `pnpm db:format`, `pnpm db:validate`, `pnpm db:generate`: pass với URL placeholder localhost; không kết nối DB thật và không sửa schema.
- Test P0.4b hiện có dùng PGlite cho transaction repository và pass trong full suite. Test service P0.3d dùng repository port giả để chứng minh preview/prepare không gọi DB và chỉ `commitPrepared` gọi create/commit. **Không kiểm thử trên PostgreSQL native.**
- Chỉ dùng template trống và workbook fixture tổng hợp; không mở, đưa vào test hoặc xử lý workbook thật 4.373 dòng.

## Giới hạn còn lại

Chưa có UI, route/API, upload đa request, lưu preview server-side, authentication/authorization ở endpoint, object storage hoặc native PostgreSQL verification. Service giữ drafts PII trong RAM và bị giới hạn số import; lớp tích hợp P0.7 cần điều phối cùng instance hoặc bổ sung thiết kế lưu trạng thái đã phê duyệt, không được lưu raw workbook. Không có thêm quyết định về giá, căn cứ liên hệ hoặc thời hạn retention.

Gói tiếp theo theo thứ tự đã chốt: **P0.7 — Frontend UX và API integration**.
