# `@am-sme/excel-import` — P0.3c + P0.4a contracts

Package này cung cấp template 17 field, allow-list header/column mapping, adapter map một dòng, chuẩn hóa/validation P0.3b và pure provenance/consent gate P0.3c. Workbook rỗng nằm tại `templates/lead-import-template.xlsx`; có thể tạo lại bằng `python3 packages/excel-import/scripts/create-template.py` (cần `openpyxl`).

## Chuẩn hóa và validation

- `company_name` bắt buộc. Giá trị hiển thị được trim, gộp khoảng trắng và chuẩn hóa Unicode NFC. `company_name_match_key` bỏ khác biệt hoa/thường và dấu câu chỉ để hỗ trợ gợi ý/review sau này; đây không phải dedupe hoặc quyết định merge.
- Phone địa phương `0` + 9 chữ số được giữ; `+84` + 9 chữ số hoặc dạng prefix `84` đúng 11 chữ số chuyển sang `0` + 9 chữ số. Chỉ bỏ khoảng trắng, dấu gạch, chấm và ngoặc. Số quốc tế bắt đầu bằng `+` khác được giữ dưới dạng compact với `phone_status = NEEDS_REVIEW` và `phone_normalized = null`, vì vậy không thể dùng làm key dedupe tự động. Phone sai trả lỗi `PHONE_INVALID`; không tự đoán hoặc sửa.
- Email được trim và kiểm tra định dạng. Giá trị nhập đã trim giữ trong `email`; key lowercase riêng nằm ở `email_normalized`. Email sai trả lỗi `EMAIL_INVALID`. Error chỉ có code/field, không echo phone/email.
- `maskPhoneForDisplay` và `maskEmailForDisplay` là helper cho bề mặt hiển thị; preview/log (khi được triển khai ở package sau) phải dùng giá trị mask, không ghi giá trị phone/email đầy đủ. Package này chưa có UI preview hoặc logger.

`mapLeadRow` chỉ nhận column map đã allow-list, từ chối ô không phải text, kiểm tra các field trên và trả `PENDING_REVIEW` với contactability `UNKNOWN`. Bước tìm candidate và quyết định review được tách riêng trong module P0.4a bên dưới.

## Provenance và consent gate P0.3c

`assessImportProvenance` giữ `source`, `source_url` và `lawful_contact_basis` là provenance được map rõ ràng từ workbook; thiếu source hoặc căn cứ đủ điều kiện đưa dòng vào review. Consent trống vẫn là `UNKNOWN`, không suy diễn từ source, URL, lịch sử hay dữ liệu liên hệ.

Giá trị workbook `ALLOWED_FOR_RECORDED_PURPOSE` bị hạ thành `REVIEW_REQUIRED` nếu thiếu một trong các mục: provenance source, căn cứ liên hệ được chấp nhận, consent evidence reference, channel, purpose hoặc timestamp hợp lệ. Template hiện tại không có các cột consent evidence/channel/purpose/timestamp, nên một giá trị `ALLOWED` trong workbook hiện tại không thể tự mở cổng. Opt-out tạo suppression instruction áp dụng cho mọi channel vì template chưa nêu channel; effective contactability là `SUPPRESSED`. Hàm gộp trạng thái bảo đảm `OPTED_OUT` ưu tiên hơn `ALLOWED`.

Policy chặn task khi contactability chưa được duyệt, opt-out hoặc suppressed; kể cả trạng thái allowed cũng cần đủ source, basis, evidence, channel, purpose và timestamp. Import assessment không tạo task và không enqueue liên hệ.

`ImportProvenanceRepository` vẫn là contract cấp provenance. P0.4b bổ sung `ImportCommitRepository` trong `@am-sme/database`: service này tự tính lại assessment P0.3c, yêu cầu review group và quyết định P0.4a cho mọi dòng được commit, rồi ghi lead/contact/source/consent/suppression/row result/audit/job trong một transaction. Nó không dùng `recordImportProvenance` làm đường ghi độc lập và không tạo task/queue.

## P0.4a — Candidate matching và review contract

`findDuplicateCandidates(incoming, existingLeads, options)` chỉ tạo candidate, không tự merge. Phone/email được chuẩn hóa lại trước khi so sánh exact; mã số thuế chỉ được xét khi caller xác nhận cả việc map tường minh và quyền đã được duyệt. MST không được thêm vào template P0.3c. Tên doanh nghiệp đã chuẩn hóa cùng quận/huyện giống nhau tạo candidate mức `FUZZY`, không phải quyết định trùng.

Mỗi candidate chứa loại match, lý do, mức `EXACT`/`FUZZY`, cờ `decisionRequired: true`, `autoMerged: false`, trường hiển thị đã mask cho contact name/phone/email, cùng safety snapshot không chứa raw contact fields. Lead trùng nhiều điều kiện được gom thành một candidate; nhiều lead ứng viên vẫn được trả đầy đủ.

`createReviewDecision(group, request)` nhận `KEEP`, `MERGE` vào một candidate thuộc group, hoặc `SKIP`. Kết quả chỉ là payload contract có `persistence: NOT_PERFORMED`; chưa có API, lưu quyết định hay transaction DB. Quyết định merge mang theo consent/audit evidence references, suppression instructions và trạng thái hiệu lực fail-closed. Nếu có opt-out, consent vẫn là `OPTED_OUT`, contactability là `SUPPRESSED`, suppression all-channel phải còn hiệu lực; không được xóa evidence hoặc suppression.

P0.4a không gồm parser/upload/preview UI, API, lead CRUD, retention hoặc planner. P0.4b chỉ bổ sung repository/service persistence; đây chưa phải parser XLSX, endpoint hay giao diện import hoàn chỉnh.

## P0.3d — XLSX parser và in-memory import workflow

`parseXlsxWorkbook(filename, bytes, limits?)` chỉ nhận `.xlsx` có ZIP signature/workbook hợp lệ và đọc sheet hiển thị `Leads`. Sheet hướng dẫn trong template được bỏ qua sau khi parser vẫn kiểm tra worksheet để không chấp nhận công thức. Parser không thực thi công thức, macro hoặc external link; file `.xlsm`, `.xls`, encrypted, sai định dạng, hỏng, ZIP64/multi-disk, macro, external relationship và workbook có formula cell bị từ chối. Ô số/boolean/error không bị ép thành chuỗi; mapper P0.3b giữ nguyên kiểm tra kiểu.

Giới hạn mặc định, có thể cấu hình ở parser: file nén tối đa **5 MiB**; tối đa **256 ZIP entries**; tổng giải nén tối đa **16 MiB**; một entry tối đa **8 MiB**; tỷ lệ giải nén tối đa **100:1**; tối đa **10.001 chỉ số hàng** (header + 10.000 dòng), **64 cột**, **250.000 XML nodes** và **128 mức XML lồng nhau mỗi part**. Đây là chặn kỹ thuật cho parser, không phải giới hạn dữ liệu thật đã được chủ dự án phê duyệt.

`ImportPreviewService` gọi parser, `inspectHeaders`, `mapLeadRow`, normalization/validation, provenance và candidate matcher hiện hữu. Chỉ field allow-list được map. Header không hỗ trợ bị cách ly và cần AM xác nhận bỏ qua trước khi chuẩn bị commit; cột dạng định danh cá nhân bị chặn. Preview trả lỗi theo mã/field, candidate đã mask contact và `commitEligible: false`; mỗi dòng hợp lệ vẫn ở `PENDING_REVIEW`, UNKNOWN/REVIEW_REQUIRED không được xem là contactable, OPTED_OUT mang suppression intent all-channel.

Preview không ghi DB và không lưu workbook bytes. Mapped drafts/evidence được giữ tạm trong RAM của instance service (tối đa 10 import hoạt động mặc định), đến khi `discardPreview`/`discardPreparedCommit`, commit thành công hoặc tiến trình dừng; không có TTL được tự đặt. `prepareReviewedCommit` yêu cầu quyết định riêng cho mọi dòng: lỗi phải `SKIP`; candidate cần quyết định rõ `KEEP`, `MERGE` vào đúng candidate hoặc `SKIP`. Hàm này chỉ tạo handle commit trong bộ nhớ. Chỉ `commitPrepared` mới gọi `ImportCommitRepository.createJob/commit` của P0.4b; không có auto-commit trong upload/preview. Cần xác thực actor/quyền ở lớp API khi P0.7 tích hợp.

## Ranh giới hiện tại

Đã có parser/service API, nhưng chưa có web UI, API route/controller, upload runtime đa request, object storage, lead CRUD, retention cho workbook, planner hoặc liên hệ tự động. Import workflow chưa kiểm thử với PostgreSQL native; test persistence hiện có dùng PGlite, không phải PostgreSQL server thật. Không dùng workbook 4.373 dòng hay dữ liệu khách hàng thật; test chỉ dùng fixture tổng hợp. Không có kết nối Zalo/Telegram.

Chạy các test Excel và domain bằng `pnpm exec vitest run packages/excel-import/test packages/domain/test` hoặc toàn bộ bằng `pnpm test`.
