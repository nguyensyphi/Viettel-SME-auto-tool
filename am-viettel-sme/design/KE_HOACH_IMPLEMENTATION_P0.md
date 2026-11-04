# Kế hoạch implementation P0 — Tool AM Viettel SME

**Phiên bản:** Draft 0.1  
**Trạng thái:** Chờ duyệt cùng design spec; chưa code, chưa tạo repo, chưa kết nối dịch vụ thật.

## 1. Nguyên tắc triển khai

- Modular monolith TypeScript; đề xuất pnpm monorepo, Next.js, NestJS, Prisma, PostgreSQL, Redis/BullMQ. Đổi framework chỉ trước khi chốt design.
- TDD cho từng task: viết test mô tả behavior, chạy để xác nhận fail, code tối thiểu, chạy pass, cập nhật docs/migration. Lỗi bất thường thì khoanh vùng và tái hiện trước khi sửa.
- Không chạy hệ thống trên Excel thật ngoài bản người dùng đưa; không commit workbook hoặc dữ liệu cá nhân. Test dùng fixture giả.
- Không có gửi tin Zalo/Telegram production trong P0; mọi integration dùng fake adapter. Không scrape web/social.
- Sau mỗi work package: typecheck, lint, unit/integration tests liên quan, review thay đổi, kiểm tra migration và secrets trước khi bàn giao.

## 2. Cấu trúc repo đề xuất

```text
apps/
  web/                    # Next.js: import, leads, tasks, admin
  api/                    # NestJS modular monolith: HTTP/API
  worker/                 # BullMQ consumer, cùng packages/domain
packages/
  domain/                 # entities, policies, services, ports
  contracts/              # DTO và validation schemas dùng chung
  database/               # Prisma schema, migrations, seed giả
  config/                 # env validation, logger, test config
  test-fixtures/          # dữ liệu tổng hợp, không có PII thật
infra/
  docker-compose.yml      # PostgreSQL, Redis, local object store nếu cần
```

`apps/worker` là entrypoint thực thi nền trong cùng repo/domain, không tạo microservice hay database riêng. Nếu local đơn giản hơn, có thể chạy worker trong process API cho đến khi cần tách.

## 3. Work packages và exit criteria

### P0.0 — Chốt thiết kế, biến cấu hình và bootstrap

**Làm:** duyệt spec/plan; chọn phiên bản Node/package manager; xác nhận authentication local vs OIDC, retention, địa bàn, AM, giờ làm và nguồn lead được phép. Khởi tạo monorepo, env schema, Docker Compose PostgreSQL/Redis, logger masking, health check.

**Test:** env thiếu/invalid thì fail-closed; logger không serialize token/phone/email; health check phản ánh DB/Redis; compose khởi động/dừng ổn định.

**Xong khi:** clean setup trên laptop theo README; `.env.example` chỉ có placeholder; secrets không vào git.

### P0.1 — Data model, migrations và audit foundation

**Làm:** `Workspace`, `User`, `Team`, `TeamMembership`, `Lead`, `LeadContact`, `LeadSource`, `ConsentRecord`, `SuppressionRecord`, `ProductInterest`, `ImportJob`, `ImportRowResult`, `Task`, `LockedTimeBlock`, `AuditEvent`. Index cho workspace, owner, stage, normalized identifiers, due time. Trạng thái lead/contactability tách riêng.

**Test:** migration up/down trên PostgreSQL test; tenant/workspace isolation; foreign key/index; audit insert-only; suppressed contact không thể chuyển sang contact-allowed bằng update thiếu actor/evidence.

**Xong khi:** schema có migration có thể lặp; seed chỉ dùng AM/lead giả; `AuditEvent` không có API update/delete.

### P0.2 — Authentication và RBAC

**Làm:** vai trò AM/Manager/Admin; quyền server-side; scope `workspace_id`, lead owner/team; security guard ở API; tạo user seed dev. Chốt OIDC nếu công ty có IdP, nếu không mới dùng local auth.

**Test:** AM đọc/sửa lead của mình; truy cập ID lead của AM khác bị 403/404 theo chính sách đã chọn; manager xem team; admin thao tác role; unauthenticated bị chặn; audit thay đổi quyền.

**Xong khi:** test authorization bao phủ mọi route P0; không dùng client-side hiding làm biện pháp bảo mật.

### P0.3 — Import Excel và preview

**Làm:** upload `.xlsx`, detect sheet/header, allow-list mapping, validate type/length, normalize phone/email/URL, status preview, quarantine unexpected columns, mask PII, errors by row/column. Tách `ExcelLeadImportAdapter` khỏi domain service. Import Job chạy qua queue khi cần.

**Test:** workbook hợp lệ; header sai; sheet rỗng; 4.373 dòng synthetic; row trống; điện thoại sai; email sai; trùng mã số thuế/phone/email; CMND/CCCD column present but not mapped; formula/macro/malformed file; upload lặp; file quá giới hạn.

**Xong khi:** người dùng nhìn thấy preview và lỗi trước khi import; không ghi raw personal identifier; file không thể truy cập công khai; repeated upload có checksum/idempotency.

### P0.4 — Dedupe, merge review và commit có kiểm soát

**Làm:** exact match theo tax ID/contact đã chuẩn hóa; fuzzy suggestion theo company name + district; màn hình AM chọn giữ/merge/skip; commit transaction/job ID; audit quyết định merge; xử lý retry an toàn.

**Test:** exact duplicate không tạo mới; fuzzy candidate không auto merge; hai AM thao tác đồng thời; rollback khi một batch thất bại; upload lại không nhân đôi; suppression được giữ khi merge.

**Xong khi:** mọi quyết định merge có người duyệt, before/after audit, và job status cuối rõ ràng.

### P0.5 — Lead workspace và timeline

**Làm:** list/detail/search/filter; assignment; stage transitions; source and provenance; contactability review; add/update notes; product interest do AM chọn; suppression/opt-out action. PII masking mặc định trên bảng và logs.

**Test:** field validation; stage transition; AM assignment boundaries; required source before qualification; no task contact for unknown/opt-out; export scope; soft delete/retention nếu được duyệt.

**Xong khi:** AM làm được vòng đời lead cơ bản; mọi thay đổi quan trọng tạo audit.

### P0.6 — Tasks và AM planner

**Làm:** task calendar/list; create, assign, complete, defer, cancel; locked blocks nhập tay; daily planner rules ưu tiên việc đến hạn/trễ, lịch hẹn nhập tay và stage. Candidate rule 5–8 tasks/day; timezone `Asia/Ho_Chi_Minh`; ưu tiên cấu hình thay vì hard-code KPI chưa có.

**Test:** AM nghỉ/không có lead; không có việc hợp lệ; task quá tải; due time; locked block conflict; deferred task; suppressed lead bị loại; planner sinh lại không duplicate tasks; thay lịch không xóa lịch khóa.

**Xong khi:** lịch hiển thị task, outcome, thời lượng, deadline, lý do ưu tiên và action; việc liên hệ mới vẫn phải được AM duyệt.

### P0.7 — Frontend UX và API integration

**Làm:** Dashboard, Lead list/detail, Import wizard, Dedupe review, Planner/calendar, Team/access, Audit. UI states loading/empty/error/retry/permission denied. API contract type-safe.

**Test:** RTL cho form/state; Playwright chỉ kiểm thử web nội bộ: login staging/test, import preview, review merge, role access, task complete. Dùng account/test data giả, không dùng storageState thật trong repo.

**Xong khi:** keyboard navigation, validation rõ, preview không lộ PII, happy path và error path chạy qua staging.

### P0.8 — Hardening và local pilot readiness

**Làm:** rate limits, file validation, CSRF/session controls phù hợp auth đã chọn; audit/event review; encrypted backup; restore runbook; retention/delete workflow; CI lint/typecheck/unit/integration/E2E smoke; deployment local README.

**Test:** restore backup; secret scan; dependency audit; import failure recovery; permission matrix; network/API error; log inspection; Playwright trace chỉ lưu synthetic data.

**Xong khi:** 10 lead giả/được duyệt và import mẫu hoạt động trên local; trước dữ liệu thật phải có checklist consent/source, retention, role owner và xác nhận pháp chế/đơn vị dữ liệu.

## 4. API contract dự kiến theo work package

1. `POST /import-jobs`, `GET /import-jobs/:id`; `PUT /import-jobs/:id/mapping`; `POST /import-jobs/:id/validate`; `POST /import-jobs/:id/approve`.
2. `GET/POST /leads`, `GET/PATCH /leads/:id`; `POST /leads/:id/assign`; `POST /leads/:id/contactability`; `POST /leads/:id/suppressions`.
3. `GET/POST/PATCH /tasks`; `POST /tasks/:id/complete`; `POST /tasks/:id/defer`; `GET /planner/today`; `GET/POST /locked-time-blocks`.
4. `GET /teams`, `GET/POST /users` (manager/admin rights); `GET /audit-events`.

Mutating import, merge, suppression, stage, assignment and role endpoints require authorization, actor context, audit, validation and idempotency where retries could duplicate outcomes.

## 5. Chỉ số pilot và go/no-go

Không đặt KPI doanh thu/lead thay chủ dự án. Đề xuất đo trên pilot 1 AM:

- tỷ lệ dòng import hợp lệ, lỗi, duplicate và được AM merge/skip;
- tỷ lệ lead có source/căn cứ/kênh đủ rõ trước khi lập task liên hệ;
- số task đến hạn được hoàn thành/hoãn và tỷ lệ quá hạn;
- số lần truy cập trái quyền bị chặn, sự kiện thiếu audit, log PII lộ;
- tỷ lệ import retry/rollback và thời gian xử lý của workbook 4.373 dòng;
- feedback AM về chất lượng mapping, dedupe và planner.

**Go:** import, scope/RBAC, audit, contactability gating, planner và restore pass; AM xác nhận dữ liệu seed/pilot có nguồn dùng được; retention và quy trình opt-out được duyệt.

**No-go:** còn bất kỳ đường API nào bỏ qua scope; import log/raw file lộ CMND/số đầy đủ; suppressed/unknown contact vẫn vào tác vụ; merge không audit; thiếu khả năng rollback/đối chiếu; chính sách vận hành chưa được pháp chế/đơn vị chịu trách nhiệm duyệt.

## 6. Ngoài P0

- P1: scoring rules sau khi ưu tiên dịch vụ và chính sách được xác nhận; Telegram bot/task planner; digest; voice-note transcript chỉ lưu sau AM xác nhận.
- P2: Zalo OA/OpenAPI hoặc ZBS adapter sandbox, approval workflow, template versioning, webhook retry/idempotency; campaign chỉ khi template/mục đích/quyền gửi phù hợp.
- P3: dashboard/monitoring nâng cao, Playwright E2E mở rộng, staging pilot 2 tuần, go/no-go.
- CRM adapter thật chỉ sau khi biết CRM, API, scopes, field mapping và người duyệt tích hợp.

## 7. Biến còn thiếu trước pilot

- Địa bàn, tên AM, dịch vụ ưu tiên, giờ làm việc, nguồn lead được phép.
- KPI tuần/tháng theo văn bản đang hiệu lực (không lấy KPI tháng 06/2025 làm chuẩn).
- Quyết định auth (OIDC công ty hay local), người tạo tài khoản admin, người phê duyệt merge/export/role.
- Retention workbook và lead/contact theo đơn vị quản lý dữ liệu.
- Zalo mode/quyền OA (chỉ cần trước P2), Telegram chat ID/role (trước P1). Không gửi token vào chat.

## 8. Điểm cần xác nhận trước khi code

1. Duyệt NestJS + Prisma là cách cụ thể hóa phương án 1 hay muốn framework khác.
2. P0 giữ Telegram bot ở P1 như phân kỳ ban đầu, hay chỉ muốn mock màn hình/command ngay trong P0? Đề xuất giữ P1 để P0 không trộn API bot với nền data chưa ổn.
3. Auth local cho pilot hay OIDC công ty? Nếu chưa có IdP, có thể dùng local auth ở local và đổi sang OIDC trước staging.
4. Chọn cách xử lý file gốc sau import: xóa ngay sau commit hay retention có thời hạn do quy định nội bộ duyệt.

Chỉ sau khi bạn duyệt spec và plan, mới chuyển sang bước viết code P0.

## 9. Addendum — chia task triển khai Excel theo template bắt buộc

Tách P0.3–P0.4 thành các task reviewable, không trộn một lần import toàn bộ:

### P0.3a — Template/schema và mapping

Tạo contract template gồm đúng các cột: `lead_id`, `company_name`, `contact_name`, `phone`, `email`, `industry`, `district`, `source`, `source_url`, `lawful_contact_basis`, `consent_status`, `product_interest`, `owner_am`, `stage`, `last_contact_at`, `next_action_at`, `notes`. `company_name` bắt buộc; contact có thể trống nhưng không được contact nếu thiếu route/căn cứ; `lead_id` sinh mới nếu blank; lead mới bắt buộc `PENDING_REVIEW`; không import CMND/CCCD, ngày/nơi cấp. Bổ sung enum/constraints từ design spec.

**Test-first:** template header chuẩn; thiếu cột bắt buộc; header trùng; cột ngoài allow-list; map sai kiểu; stage đã nhập thành `CONTACTED`; import giữ PENDING_REVIEW; unexpected personal-ID column bị loại và cảnh báo.

### P0.3b — Normalize phone/email và validation per field

Phone parser: trim formatting; local `0` + 9 chữ số giữ; `+84` + 9 chữ số đổi thành local `0`; chuỗi bắt đầu `84` chỉ chuyển nếu nhận ra pattern quốc gia 11 chữ số; international `+` khác giữ ở trạng thái `NEEDS_REVIEW`, không đem dedupe tự động; số lỗi vào row error, không đoán. Email trim/validate/lowercase, lưu normalized key riêng, UI preview mask.

**Test-first:** mẫu có dấu cách/gạch/ngoặc; +84; prefix 84; `+86` không bị biến thành số VN; số thiếu/thừa chữ số; email malformed; Unicode/company name normalization; phone/email chỉ được hiển thị mask trong preview/log.

### P0.3c — Provenance, căn cứ và consent gate

`source`/`source_url`/`lawful_contact_basis` phải là evidence do AM nhập hoặc map từ workbook. Default consent `UNKNOWN`. Workbook ghi `OPTED_OUT` phải ghi suppression; workbook ghi `ALLOWED_FOR_RECORDED_PURPOSE` không đủ một mình nếu thiếu evidence/kênh/mục đích/timestamp, chuyển thành `REVIEW_REQUIRED`. Không enqueue contact task sau import.

**Test-first:** lead thiếu source vào review; `OPTED_OUT` tạo suppression trong transaction; mọi planner/contact task bị chặn; consent trạng thái allowed không có bằng chứng không mở cổng; opt-out đè trạng thái allowed sau merge; audit thất bại rollback suppression/lead cùng nhau.

### P0.4a — Deduplication và review

Match exact theo phone/email chuẩn hóa; MST nếu cột này được AM map theo quyền; name+district chỉ sinh candidate fuzzy cho AM duyệt. Không tự merge. Nếu 2 contact trùng một phần, merge quyết định không được xóa evidence/audit/suppression. Giao diện preview hiển thị lý do match, mức chính xác/loại match, dữ liệu mask.

**Test-first:** exact phone; exact email; cùng tên+địa bàn là candidate chứ không merge; nhiều candidate; merge/skip; opt-out conflict; simultaneous approval.

### P0.4b — Atomic commit, idempotency, rollback và audit

Duyệt import commit bằng database transaction; idempotency key/checksum ngăn double-import; row errors/candidates phải được resolve hoặc skip. Commit lỗi bất kỳ → rollback data lead/contact/consent/suppression/audit trong cùng đơn vị transaction, job status `ROLLED_BACK` hoặc `FAILED` kèm lý do an toàn; audit failure không để import succeed.

**Test-first:** file sai định dạng; validation error; duplicate; opt-out; repeat request; commit DB failure; audit append failure; retry cùng idempotency key; verify không có lead lưng chừng và audit không chứa PII/raw row.

**Không auto-send:** acceptance test cấp API và service xác nhận không có side-effect từ ImportJob sang Zalo/Telegram queue. Contact task chỉ là `REVIEW_LEAD` nếu `next_action_at` có giá trị và contactability chưa rõ.
