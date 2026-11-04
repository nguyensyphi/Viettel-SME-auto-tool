# Status P0.4a — Deduplication và human-review contract

## Hoàn tất

P0.4a bổ sung pure candidate engine và review decision contract trong `@am-sme/excel-import`. Exact matching dùng phone/email đã chuẩn hóa; MST chỉ được so sánh khi caller khai báo field được map tường minh và quyền đã duyệt. Tên doanh nghiệp đã chuẩn hóa cùng quận/huyện giống nhau tạo candidate `FUZZY`, tuyệt đối không tự merge. Hàm trả tất cả candidates, loại match/lý do, confidence và masked summary cho contact name/phone/email.

Decision contract nhận `KEEP`, `MERGE` vào đúng candidate trong group, hoặc `SKIP`. `MERGE` chỉ tạo payload với `persistence: NOT_PERFORMED`; payload giữ nguyên consent/audit evidence references, suppression instructions và trạng thái fail-closed. Khi có opt-out, consent hiệu lực là `OPTED_OUT`, contactability là `SUPPRESSED`, và suppression all-channel vẫn phải còn.

## Tệp thay đổi

- `packages/excel-import/src/deduplication.ts` — matching, candidate payload, decision validation và merge-safety summary.
- `packages/excel-import/src/index.ts` — public exports cho P0.4a.
- `packages/excel-import/test/deduplication.test.ts` — test-first coverage cho exact phone/email, normalized/fuzzy match, nhiều candidates, keep/merge/skip, merge target validation, opt-out/suppression precedence, tax-ID authorization và mask PII.
- `packages/excel-import/README.md` — cập nhật contract và ranh giới package.
- `design/STATUS_P0.4A.md` — status hiện tại.

Không thêm field vào template, Prisma schema hay migration.

## Kiểm tra thực tế

- `pnpm test` — **14 test files, 130/130 tests passed**; riêng `deduplication.test.ts`: **9/9 passed**.
- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm format:check` — pass.
- `DATABASE_URL=postgresql://local:local@127.0.0.1:5432/local pnpm db:generate` — pass; URL tạm chỉ dùng để nạp config/generate client, không có kết nối DB.
- `DATABASE_URL=postgresql://local:local@127.0.0.1:5432/local pnpm db:validate` — pass; schema hiện có hợp lệ.

Không chạy hoặc tuyên bố PostgreSQL native integration test. Test suite không xác minh persistence P0.4a.

## Giới hạn và bước kế tiếp

Không có parser/upload/preview UI, API, persistence, atomic commit/audit transaction, lead CRUD, retention, planner, Zalo/Telegram hay dữ liệu khách hàng thật. Candidate/review payload hiện là pure contract, chưa được importer hoặc repository gọi.

Bước kế tiếp theo kế hoạch là **P0.4b**: nối decision contract vào import commit có transaction atomic, audit bắt buộc, idempotency và rollback; chỉ cho commit sau khi row errors/candidates đã được resolve hoặc skip. Cần test bằng adapter/database tương ứng, tách rõ kiểm thử PGlite và PostgreSQL native nếu môi trường có hỗ trợ.
