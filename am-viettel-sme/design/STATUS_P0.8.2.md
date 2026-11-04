# Trạng thái P0.8.2 — Sửa hiển thị preview import

## Kết quả

Lỗi “bấm Tạo preview nhưng không thấy gì” được tái hiện bằng test giao diện. API validate trước đây trả thẳng object preview, trong khi UI xử lý phản hồi như một import handle có `status` và `preview` lồng bên trong. Do đó server đã tạo preview nhưng phía UI vẫn giữ trạng thái `UPLOADED` và không hiện phần Review. Nút vẫn dùng được trong lúc gửi request, nên các lần bấm nhanh có thể tạo thêm request validate và nhận `IMPORT_STATE_INVALID` sau khi request đầu đã chuyển trạng thái.

P0.8.2 sửa hợp đồng phản hồi validate để trả về handle đầy đủ (`status: VALIDATED`, thời hạn và preview lồng), đồng thời khóa nút và chặn submit validate thứ hai trong lúc request đầu đang chạy. Sau khi thành công, giao diện chuyển sang Review; các quyết định KEEP/MERGE/SKIP và bước approve/commit riêng vẫn giữ nguyên.

## File thay đổi so với P0.8.1

- `README.md` — ghi nhãn P0.8.2 và tóm tắt thay đổi preview.
- `apps/web/src/server/import-api.ts` — trả về `ImportHandleView` đầy đủ sau validate thành công.
- `apps/web/src/ui/workspace-app.tsx` — ngăn validate đồng thời, báo trạng thái đang xử lý và vô hiệu hóa nút trong lúc request chạy.
- `apps/web/test/import-api.test.ts` — xác nhận API trả `VALIDATED` cùng preview lồng.
- `apps/web/test/workspace-ui.test.tsx` — tái hiện lỗi UI và kiểm tra bấm nhanh hai lần chỉ phát ra một POST validate.
- `design/STATUS_P0.8.2.md` — báo cáo snapshot này.

CLI phục hồi mật khẩu Admin local của P0.8.1 cùng mã nguồn, hướng dẫn và test được giữ nguyên trong snapshot mới.

## Kiểm chứng thực tế

- TDD: test giao diện mới được chạy trước khi sửa và thất bại tại kỳ vọng `Review 1 dòng`; sau khi sửa, test chuyển sang pass.
- Test mục tiêu: **8/8** test của `apps/web/test/import-api.test.ts` và `apps/web/test/workspace-ui.test.tsx` đạt.
- Toàn workspace: `pnpm test` — **27/27 file, 233/233 test đạt**.
- `pnpm lint` — đạt.
- `pnpm format:check` — đạt.
- `pnpm typecheck` — đạt sau khi sinh Prisma Client bằng `DATABASE_URL` placeholder trỏ loopback. Lệnh chỉ sinh mã; không mở kết nối database.

Không chạy migration, không kết nối PostgreSQL thật, không dùng workbook/PII thật, và không commit lead. Các test persistence dùng PGlite trong tiến trình test.

## Ranh giới an toàn không đổi

Không sửa schema/migration, quy tắc dedupe, commit/idempotency, audit, contactability/suppression hoặc cổng consent. Preview vẫn theo quy trình validate → review thủ công rõ từng dòng → approve → commit riêng; chưa có cơ chế tự commit. Workbook raw bytes không được lưu; dữ liệu preview/PII tiếp tục nằm trong RAM tối đa 30 phút.

## Còn cần xác nhận

Chưa chạy browser E2E trên máy Windows của owner, chưa thay mã trên ứng dụng đang chạy ở máy người dùng, và chưa kiểm thử trên PostgreSQL native. Owner cần giải nén P0.8.2 vào thư mục mới rồi thử lại đúng file synthetic: chọn workbook → kiểm tra mapping → bấm **Tạo preview** một lần; xác nhận Review hiện ra và không còn validate 400 lặp. Dừng ở màn Review để giữ nguyên yêu cầu chưa commit. Chỉ sau khi owner xác nhận mới quyết định bước tiếp theo; không có triển khai hoặc thay đổi DB nào được thực hiện trong snapshot này.
