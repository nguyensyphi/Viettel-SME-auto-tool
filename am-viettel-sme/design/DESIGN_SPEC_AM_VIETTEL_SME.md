# Design Spec — Tool AM Viettel SME

**Phiên bản:** Draft 0.1  
**Ngày:** 02/11/2026  
**Trạng thái:** Chờ chủ dự án duyệt — chưa triển khai code  
**Phạm vi đang chốt:** P0 — Excel import, quản lý lead, RBAC/audit log, lịch công việc AM.

## 1. Mục tiêu và ranh giới

Xây một công cụ nội bộ giúp AM nhập dữ liệu doanh nghiệp từ Excel, làm sạch/đối chiếu bản ghi, quản lý lead và giao việc chăm sóc hằng ngày. Excel là nguồn dữ liệu đầu tiên. Lõi nghiệp vụ phải độc lập với Excel để sau này cắm CRM qua adapter mà không phải sửa mô hình lead hoặc planner.

P0 không tự tìm/scrape lead, không tự gửi tin, không chứa API Zalo production, không điều khiển Zalo cá nhân, không triển khai Facebook/Instagram automation. Lead import vào mặc định `PENDING_REVIEW`; không có nguồn và căn cứ liên hệ được ghi nhận thì không được biến thành tác vụ liên hệ hoặc đưa vào luồng gửi tin sau này.

Tool không thay CRM/BCCS/SME HUB và không xác nhận giá, ưu đãi, điều kiện pháp lý hay KPI. Cẩm nang tháng 06/2025 chỉ là tài liệu tham chiếu để xây taxonomy/sàng lọc; chính sách sản phẩm có thể đổi.

## 2. Các quyết định đã thống nhất

1. Modular monolith TypeScript; Next.js cho web nội bộ, PostgreSQL cho dữ liệu nghiệp vụ, Redis + BullMQ cho việc nền.
2. Chạy local trước; sau khi P0 chạy ổn và được duyệt mới lên staging.
3. Chưa tích hợp CRM. Có sẵn interface/port cho CRM tương lai; adapter CRM chưa cài đặt.
4. Ưu tiên P0 như trên. Telegram/Zalo là các kênh điều hành/tương tác ở giai đoạn sau; P0 xây task API và planner để Telegram có thể dùng lại sau này, chưa nối bot production hay gửi tin.
5. Không bắt đầu code cho tới khi chủ dự án duyệt design spec và implementation plan.

**Lựa chọn kỹ thuật đề xuất để cụ thể hóa phương án 1:** Next.js + NestJS + Prisma, pnpm monorepo. NestJS modules chạy như một ứng dụng nghiệp vụ; worker BullMQ dùng chung domain code, có thể chạy chung khi phát triển local. Chủ dự án có thể đổi NestJS/Prisma trước khi duyệt.

## 3. Kiến trúc logic

```text
Next.js internal web
  ├── Import Excel / review dedupe
  ├── Lead workspace / task calendar / admin
  └── API client
        ↓
NestJS modular monolith
  ├── Identity & Access (AM / Manager / Admin)
  ├── Lead & Contactability
  ├── Excel Import & Dedupe
  ├── Tasks & Planner
  ├── Product Catalog / Fit Rules (reference only in P0)
  ├── Audit & Data Governance
  └── Integration Ports (CRM future; Zalo/Telegram later)
        ↓
PostgreSQL + Prisma migrations
Redis/BullMQ for import/planner jobs
Local private file store in dev → private object storage in staging
```

`LeadRepository` và `CrmAdapter` không đồng nghĩa nhau: hệ thống dùng repository nội bộ làm nguồn chuẩn; về sau `CrmAdapter` sẽ chuyển đổi DTO chuẩn của tool sang API CRM ngoài. Excel chỉ là adapter nhập liệu, không phải kiểu dữ liệu cốt lõi.

## 4. Vai trò và quyền

- **AM:** xem/sửa lead được giao; nhập lead; import và review hàng mình phụ trách; quản lý lịch/task cá nhân; ghi kết quả. Không xem chi tiết lead của AM khác nếu chưa được phân công.
- **Manager:** xem lead/task trong team; phân công/điều chỉnh; duyệt merge; xem báo cáo tổng hợp; không xem bí mật tích hợp.
- **Admin:** quản lý người dùng, role, cấu hình import, danh mục sản phẩm và tích hợp; truy cập/export dữ liệu phải được audit.

Mọi truy vấn gắn `workspace_id` và áp dụng phạm vi dữ liệu ở backend, không chỉ ẩn nút ở UI. Mặc định chỉ một workspace nội bộ cho pilot, nhưng schema có `workspace_id` để tách nhóm/đơn vị sau này. Không triển khai SaaS multi-tenant khách hàng trong P0.

## 5. Mô hình dữ liệu P0

- `Workspace`, `User`, `Team`, `TeamMembership`: tổ chức và RBAC.
- `Lead`: tên doanh nghiệp, mã số thuế (nếu có và cần), ngành, địa bàn, website, địa chỉ doanh nghiệp tối thiểu, stage, owner, ghi chú nghiệp vụ.
- `LeadContact`: tên/chức vụ liên hệ, phone/email, loại liên hệ (đầu mối doanh nghiệp/cá nhân), trạng thái liên hệ. Không có trường CMND/CCCD, ngày cấp hoặc nơi cấp.
- `LeadSource`: loại nguồn, URL nguồn, ngày lấy, người nhập, ghi chú quyền/điều khoản nguồn và căn cứ liên hệ.
- `ConsentRecord`: chủ thể/contact, kênh, mục đích/phạm vi, trạng thái, thời điểm, nguồn chứng cứ và người ghi nhận. Giá trị ban đầu `UNKNOWN`/`REVIEW_REQUIRED`; không tự suy ra đồng ý từ việc số điện thoại xuất hiện trong Excel hay nguồn công khai.
- `SuppressionRecord`: chặn theo contact/channel/workspace; hỗ trợ opt-out và yêu cầu ngừng liên hệ.
- `ProductInterest`: sản phẩm AM quan tâm hoặc AM xác nhận; không tự động suy diễn thành nhu cầu chắc chắn.
- `ImportJob`, `ImportRowResult`, `ColumnMapping`: mapping, thống kê lỗi, trạng thái duyệt, checksum và lịch sử job. Không lưu cả hàng thô trong log.
- `Task`: lead (có thể rỗng), loại việc, outcome cần đạt, thời lượng dự kiến, due time, trạng thái, lý do ưu tiên, người giao/người nhận, nguồn tạo, liên kết task trước/sau.
- `LockedTimeBlock`: lịch bận AM nhập tay trong P0; planner không được tự sửa hoặc chồng lịch.
- `AuditEvent`: actor, action, entity ID, timestamp, request/job ID, changed field names, kết quả. Không ghi token, số điện thoại/email đầy đủ hoặc nội dung nhạy cảm.

### Trạng thái

- Lead lifecycle: `PENDING_REVIEW → NEW → QUALIFIED → CONTACTED → MEETING_SET → PROPOSAL → WON | LOST`. Chuyển trạng thái có actor, thời gian và audit.
- Contactability độc lập với lifecycle: `UNKNOWN`, `REVIEW_REQUIRED`, `ALLOWED_FOR_RECORDED_PURPOSE`, `OPTED_OUT`, `SUPPRESSED`. `OPTED_OUT`/`SUPPRESSED` là chặn cứng đối với tác vụ liên hệ và campaign tương lai.
- Task: `OPEN`, `IN_PROGRESS`, `DONE`, `DEFERRED`, `CANCELLED`. Hoãn phải có thời điểm tiếp theo hoặc lý do; không tự tạo tin nhắn.
- Import: `UPLOADED → MAPPED → VALIDATED → NEEDS_REVIEW → APPROVED → COMMITTED`, hoặc `REJECTED/FAILED/ROLLED_BACK`.

## 6. Luồng import Excel

1. AM tải `.xlsx` lên private storage; xác thực MIME/đuôi file, sheet, header và giới hạn cấu hình. File gốc không được công khai.
2. AM map cột sang schema chuẩn. Mapping mặc định chỉ nhận allow-list. Các cột `CMND`, ngày/nơi cấp, và mọi trường không cần cho bán hàng bị loại khỏi mapping; cảnh báo khi workbook chứa chúng.
3. Validate theo từng dòng: tên công ty, địa bàn, mã số thuế tùy chọn, số điện thoại/email, URL; chuẩn hóa dấu cách, Unicode, domain/email, số Việt Nam. Giá trị không hợp lệ giữ nguyên trong hàng preview đã mask để AM sửa/tải danh sách lỗi, không âm thầm đoán.
4. Dedupe chính xác theo mã số thuế, phone/email đã chuẩn hóa; so khớp tên + địa bàn chỉ tạo gợi ý để AM duyệt, không tự merge fuzzy. Hệ thống không tự chọn bản ghi “đúng hơn”.
5. Preview tổng số hợp lệ/lỗi/trùng/mới, mẫu giá trị đã mask, mapping, và các trường nhạy cảm bị loại. AM duyệt merge/skip trước khi commit.
6. Commit theo transaction/job idempotency. Nếu bước commit lỗi, rollback toàn bộ job hoặc ghi rõ các batch đã commit theo thiết kế được duyệt; không để trạng thái nhập mập mờ.
7. Lead mới ở `PENDING_REVIEW`, contactability `UNKNOWN`, `source_url`/`source_type` phải được bổ sung. Không tự gắn consent, owner, product fit, hoặc gửi tin.
8. Sau commit, file thô bị xóa theo chính sách retention do chủ dự án/đơn vị tuân thủ duyệt. Lưu kết quả job và lỗi đã mask để audit. Retention chính thức là quyết định mở trước pilot.

File nhận được có 4.373 dòng, 19 cột; có tên doanh nghiệp, số liên hệ, thông tin người đại diện và cột CMND. P0 tuyệt đối không đưa bản ghi cá nhân này vào test/fixture hoặc tài liệu thiết kế. Mã số thuế/doanh nghiệp và địa chỉ cũng chỉ giữ khi cần cho quy trình được duyệt.

## 7. Lead, quyền liên hệ và product fit

P0 dùng lead stages và nhu cầu do AM xác nhận, không tự động lead score. Product Fit Rules được lưu versioned, có nguồn/trang cẩm nang và trạng thái `CAN_XAC_NHAN_LAI`; chỉ hiển thị gợi ý để AM kiểm tra. Không dùng vốn điều lệ thay cho quy mô nhân sự. Workbook hiện không có headcount, source URL, lawful-contact-basis hay consent status; các dữ liệu này phải được AM ghi nhận sau import.

Gợi ý cẩm nang cho phép lọc theo ngành/loại hình, quy mô nếu biết, pain point do AM ghi nhận và câu hỏi sàng lọc. Mọi giá, ưu đãi, hoa hồng, KPI, bundle, hồ sơ và điều kiện ghi nhận đều không được đưa vào gợi ý như chính sách hiện hành nếu chưa được cập nhật từ văn bản đang hiệu lực.

## 8. Planner và trải nghiệm UI

P0 có các màn hình: Dashboard hôm nay; Leads (lọc, giao, trạng thái); Import (upload → mapping → preview → dedupe → approve); Lead detail (source, contactability, nhu cầu, timeline/audit); Calendar/Tasks; Team & role; Audit view cho người được phép.

Planner lập tối đa 5–8 việc/ngày như mục tiêu UX trong prompt gốc, chỉ trong giờ làm việc đã cấu hình và không đè `LockedTimeBlock`. Ưu tiên task đến hạn/trễ, cuộc hẹn AM đã nhập, lead đang ở stage cần follow-up và task bị hoãn; score và KPI chưa cấu hình thì không giả lập. Không có lead đủ điều kiện thì hiện việc review dữ liệu/chuẩn bị hồ sơ/tổng kết. AM có thể Hoàn thành/Hoãn/Không phù hợp và ghi outcome. Tạo liên hệ mới hoặc campaign mới luôn chờ AM duyệt.

Thời gian lưu UTC; hiển thị theo `Asia/Ho_Chi_Minh`. P0 không đồng bộ Google Calendar/CRM. Notification in-app trước; Telegram digest/commands thuộc P1 theo phân kỳ ban đầu.

## 9. API contract mức thiết kế

- `POST /api/import-jobs` — tạo job upload, trả `jobId`.
- `POST /api/import-jobs/:id/mapping` — lưu mapping allow-list.
- `POST /api/import-jobs/:id/validate` — chạy validation/dedupe, trả preview summary.
- `POST /api/import-jobs/:id/approve` — duyệt import và lựa chọn merge/skip; cần idempotency key.
- `GET /api/import-jobs/:id` — trạng thái và lỗi đã mask.
- `GET/POST /api/leads`, `GET/PATCH /api/leads/:id` — list/detail/update theo RBAC.
- `POST /api/leads/:id/contactability` — ghi căn cứ/trạng thái/kênh; audit.
- `POST /api/leads/:id/suppressions` — chặn liên hệ; ưu tiên ngay lập tức.
- `GET/POST/PATCH /api/tasks`; `POST /api/tasks/:id/complete`; `POST /api/tasks/:id/defer`.
- `GET /api/planner/today` — đề xuất task theo rules đã cấu hình.
- `GET /api/audit-events` — chỉ manager/admin theo permission, có pagination và export audit.

API dùng DTO phiên bản hóa; frontend và mọi adapter gọi cùng domain services, không truy cập DB trực tiếp.

## 10. CRM, Telegram, Zalo và automation về sau

- `CrmAdapter` (chưa implement): `pullLeads`, `pushLeadChanges`, `mapExternalRecord`, `healthCheck`; mỗi CRM connector khai báo scopes và field mapping, không được bypass RBAC/contactability. P0 chỉ có interface + fake adapter test.
- Telegram P1: webhook secret, allow-list chat ID, RBAC kiểm tra server-side, PII chi tiết chỉ nhắn riêng AM; group chỉ nhận số tổng hợp. `/today`, `/lead`, `/report`, `/stop` theo Prompt 6; P0 chưa kết nối token thật.
- Zalo: chỉ OA OpenAPI/ZBS chính thức. OA tư vấn phụ thuộc tương tác được Zalo công nhận; tài liệu OA hiện ghi OA OpenAPI gửi tin tư vấn trong 7 ngày từ tương tác cuối và thời hạn miễn phí 48 giờ. Broadcast hiện cần người quan tâm OA, khung gửi 06:00–19:59 và công cụ được mô tả là OA Manager Web. ZBS Template Message từ 01/01/2026 thay các loại tin UID giao dịch/marketing và ZNS; chỉ template được duyệt, đúng mục đích giao dịch/hậu mãi. Nếu use case bán hàng không phù hợp, tạo task AM gửi thủ công sau khi kiểm tra căn cứ, không ép sang API. Quyền OA/App/ZBS, pricing, rate limit, template, webhook, vùng/loại OA phải xác nhận lại trước P2.
- Không có Playwright cho Zalo cá nhân, không scrape Facebook/Instagram, không lách rate limit/CAPTCHA/MFA.

## 11. Bảo mật và kiểm soát dữ liệu

- Chỉ thu thập trường cần thiết; loại bỏ CMND/CCCD, ngày cấp/nơi cấp. Mask số điện thoại/email trong logs và danh sách nhóm.
- HTTPS ở staging; encryption at rest theo hạ tầng; secrets ở environment/secret manager; local `.env` bị gitignore; không ghi secrets thật vào spec, commit, fixture hay screenshots.
- RBAC server-side và workspace/owner scoping; rate limit auth/import; secure cookies; password hash Argon2id nếu dùng local auth; admin provisioning an toàn.
- Audit append-only: ứng dụng không có endpoint sửa/xóa; DB role chỉ INSERT/SELECT bảng audit; export và thay đổi role đều audit. Tách audit khỏi nội dung PII, giữ entity ID và field names.
- Raw workbook xử lý riêng, xóa theo retention được duyệt. Sao lưu PostgreSQL có mã hóa, test restore trong staging.
- Có cơ chế export/delete/rectify theo luồng được pháp chế/đơn vị dữ liệu duyệt; không hứa thời hạn pháp lý khi chưa xác nhận.

Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 có hiệu lực 01/01/2026; Nghị định 91/2020/NĐ-CP về tin nhắn rác, thư điện tử rác, cuộc gọi rác là nguồn cần rà soát cùng bộ phận pháp chế/tuân thủ. Đây là yêu cầu thiết kế, không phải tư vấn pháp lý. Không coi dữ liệu công khai là căn cứ tự động để quảng cáo.

## 12. Tiêu chí nghiệm thu P0

1. Có thể nhập workbook mẫu 4.373 dòng vào staging/local bằng preview; không ghi CMND/CCCD hoặc trường bị loại xuống DB.
2. Mỗi import có thể tái lập/đối chiếu qua `jobId`; file trùng không tạo lead trùng; fuzzy match cần người duyệt.
3. Mọi lead mới ở `PENDING_REVIEW`; không có source/basis thì contactability không được bật.
4. AM không đọc/sửa lead ngoài scope; Manager xem đúng team; Admin quản lý user; thử cả API trực tiếp để chứng minh RBAC.
5. Mọi import, dedupe decision, assignment, status change, opt-out, export và thay đổi role có audit event; logs không lộ PII đầy đủ.
6. Planner không gợi task contact cho `OPTED_OUT`/`SUPPRESSED`, không chồng lịch khóa, và lưu mọi task modification.
7. P0 không thể phát tin thật đến Zalo/Telegram; test chỉ dùng fake adapters/test bot.
8. Có migration up/down, backup/restore test, README local, seed data giả, unit/integration/E2E smoke.

## 13. Việc còn cần chủ dự án điền trước khi bật pilot

`DIA_BAN`, `AM_NAME`, dịch vụ ưu tiên, KPI tuần/tháng theo văn bản đang hiệu lực, giờ làm việc, nguồn lead được phép, loại CRM tương lai (đã chốt không dùng ngay), Zalo mode (OA tư vấn/Broadcast/ZBS Template), loại/quyền OA và Telegram chat ID. Zalo OA ID và token chỉ cấu hình qua secret manager/env; không gửi vào chat hay tài liệu. Xác nhận ai phê duyệt lần đầu liên hệ/campaign, retention raw file và quy trình opt-out/complaint.

## 14. Nguồn tham chiếu

- Cẩm nang nội bộ AM Viettel SME, 06/2025, 140 trang. Chính tài liệu ghi các policy tham chiếu có thể được thay thế; mọi giá/KPI/bundle đều `CAN_XAC_NHAN_LAI`.
- [Zalo OA — Tổng quan các loại tin nhắn](https://oa.zalo.me/home/documents/vie/guides/tong-quan-cac-loai-tin-nhan-tren-zalo-official-account-_3651713298729094511)
- [Zalo OA — ZBS Template Message](https://oa.zalo.me/home/documents/vie/guides/zbs-template-message)
- [Zalo OA — Khởi tạo ứng dụng và cấp quyền](https://oa.zalo.me/home/documents/vie/guides/Khoi-tao-ung-dung-va-cap-quyen_117071366476220195)
- [Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 — Cổng Chính phủ](https://chinhphu.vn/?pageid=27160&docid=214590&classid=1&typegroupid=3)
- [Nghị định 91/2020/NĐ-CP — Cổng văn bản Chính phủ](https://vanban.chinhphu.vn/default.aspx?pageid=27160&docid=200773)

## 15. Addendum — Excel contract và chuẩn hóa khách hàng (theo yêu cầu mới)

Template nghiệp vụ tối thiểu có đủ cột: `lead_id`, `company_name`, `contact_name`, `phone`, `email`, `industry`, `district`, `source`, `source_url`, `lawful_contact_basis`, `consent_status`, `product_interest`, `owner_am`, `stage`, `last_contact_at`, `next_action_at`, `notes`. Có thể thêm `province` vì workbook nguồn có tỉnh/thành; không bắt buộc thêm trong template pilot nếu địa bàn chỉ có một vùng. Không đưa cột CMND/CCCD, ngày cấp/nơi cấp, ngày sinh hoặc thông tin cá nhân không cần thiết.

| Cột                    | Quy tắc nhập/validation                                                                                                                        | Chuẩn hóa và xử lý lỗi                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lead_id`              | Không bắt buộc khi tạo lead mới; nếu có phải là mã ngoài duy nhất trong workspace                                                              | Sinh UUID nội bộ khi trống; mã không hợp lệ đưa vào preview lỗi, không dùng làm khóa DB                                                                                                                                                                |
| `company_name`         | Bắt buộc; trim; không rỗng                                                                                                                     | Chuẩn hóa khoảng trắng/Unicode NFC; giữ tên hiển thị; tìm trùng không phân biệt hoa-thường và dấu câu chỉ để gợi ý                                                                                                                                     |
| `contact_name`         | Tùy chọn; chỉ tên đầu mối liên hệ công việc                                                                                                    | Trim, giới hạn độ dài cấu hình; không dùng tên người đại diện làm bằng chứng liên hệ                                                                                                                                                                   |
| `phone`                | Tùy chọn; nếu có phải phân loại hợp lệ VN/quốc tế cần review/không hợp lệ                                                                      | Bỏ khoảng trắng, `-`, `.`, `(`, `)`; `+84` + 9 chữ số chuyển thành `0` + 9 chữ số; chuỗi 11 chữ số bắt đầu `84` chỉ chuyển khi là mã quốc gia rõ ràng; giữ `+` quốc tế khác để review, không ép thành số VN; số không hợp lệ chỉ báo lỗi, không tự sửa |
| `email`                | Tùy chọn; ít nhất một trong `phone`/`email`/contact route được duyệt mới có thể follow-up                                                      | Trim, lowercase domain/local theo chính sách; format sai vào preview lỗi; lưu normalized value riêng để match                                                                                                                                          |
| `industry`             | Tùy chọn; giá trị từ nguồn AM/import, không tự suy đoán ngành bằng bên thứ ba                                                                  | Giữ original + mã taxonomy nếu AM chọn; không match với mã ngành chưa map                                                                                                                                                                              |
| `district`             | Tùy chọn; vùng AM được phân công thì dùng để lọc                                                                                               | Trim, normalize Unicode; không tự geocode hoặc tra nguồn ngoài                                                                                                                                                                                         |
| `source`               | Bắt buộc khi đưa lead ra khỏi review; enum cấu hình/giá trị “AM nhập tay”                                                                      | Nguồn không hợp lệ/thiếu đưa vào `PENDING_REVIEW`; không có nguồn thì không tạo contact task                                                                                                                                                           |
| `source_url`           | Tùy chọn với AM nhập trực tiếp; bắt buộc khi khai là nguồn web; URL http/https hợp lệ                                                          | Bỏ tracking params chỉ nếu chính sách đã duyệt; không truy cập tự động URL trong import                                                                                                                                                                |
| `lawful_contact_basis` | Enum `UNKNOWN`, `CUSTOMER_REQUEST`, `EXISTING_RELATIONSHIP`, `CONSENT_RECORDED`, `OTHER_REVIEW_REQUIRED`; không coi source công khai là căn cứ | Import `UNKNOWN` nếu trống; `OTHER_REVIEW_REQUIRED` không cho phép liên hệ cho tới khi người có quyền review và ghi bằng chứng                                                                                                                         |
| `consent_status`       | Enum `UNKNOWN`, `REVIEW_REQUIRED`, `ALLOWED_FOR_RECORDED_PURPOSE`, `OPTED_OUT`                                                                 | Import `OPTED_OUT` thành suppression trong cùng transaction; status `ALLOWED...` từ Excel không tự được tin nếu thiếu consent evidence (kênh, mục đích, timestamp, nguồn), giữ `REVIEW_REQUIRED` cho tới khi AM review                                 |
| `product_interest`     | Tùy chọn; ID dịch vụ từ catalog hiện hành hoặc text đưa vào review                                                                             | Giá trị chưa map vào product catalog không tự tạo product rule; không tự gán score                                                                                                                                                                     |
| `owner_am`             | Tùy chọn khi upload; nếu có phải trùng tài khoản active được mời vào workspace và người import có quyền phân công                              | AM không tồn tại/inactive/không đúng scope thì báo lỗi dòng; lead mặc định owner là AM importer khi quy tắc phân công được duyệt                                                                                                                       |
| `stage`                | Cột tồn tại theo template nhưng với lead mới chỉ nhận trống hoặc `PENDING_REVIEW`                                                              | Giá trị khác bị từ chối cho dòng mới; update stage cho lead đã có phải qua API/action riêng có permission/audit                                                                                                                                        |
| `last_contact_at`      | Tùy chọn ISO 8601; không chấp nhận ngày mơ hồ như `01/02/26` nếu mapping không xác định locale                                                 | Parse về UTC, hiển thị theo `Asia/Ho_Chi_Minh`; ngày tương lai đưa warning/review                                                                                                                                                                      |
| `next_action_at`       | Tùy chọn ISO 8601; không tự tạo gửi tin                                                                                                        | Nếu có và contactability chưa rõ, chỉ tạo task `REVIEW_LEAD`, không tạo task gọi/gửi; ngày quá khứ thành overdue cần AM review                                                                                                                         |
| `notes`                | Tùy chọn; không đưa dữ liệu nhạy cảm hoặc nội dung định danh không cần thiết                                                                   | Giới hạn kích thước cấu hình; mask trong log; nêu cảnh báo khi có vẻ chứa số giấy tờ nhưng không lưu raw row ngoài retention đã duyệt                                                                                                                  |

**Số điện thoại và duplicate:** normalize local VN ở bước parse, giữ `phone_original` chỉ trong staging preview có quyền hạn chế; sau commit chỉ giữ normalized phone nếu trường này thực sự cần cho công việc. Không gọi API tra cứu thuê bao. Exact duplicate: normalized phone/email; thêm MST/doanh nghiệp nếu AM map cột và tổ chức duyệt. `company_name + district` chỉ là fuzzy candidate, không tự merge. Khi merge hai record, mọi `OPTED_OUT`/suppression phải thắng trạng thái cho phép; không được xóa audit/evidence cũ.

**Import preview/status:** upload → chọn sheet/header → map cột → validate/normalize → dedupe suggestions → AM review merge/skip → approve → commit transaction → audit. `ImportJob` có `idempotencyKey`, file checksum, uploader, `PENDING/VALIDATING/NEEDS_REVIEW/APPROVED/COMMITTED/FAILED/ROLLED_BACK`, counts, timestamps và summary mask. Không auto-send và không tạo contact tasks khi commit. Lead mới luôn `PENDING_REVIEW`.

## 16. Data contracts mức thiết kế

```ts
export type LeadStage =
  | "PENDING_REVIEW"
  | "NEW"
  | "QUALIFIED"
  | "CONTACTED"
  | "MEETING_SET"
  | "PROPOSAL"
  | "WON"
  | "LOST";
export type ConsentStatus =
  "UNKNOWN" | "REVIEW_REQUIRED" | "ALLOWED_FOR_RECORDED_PURPOSE" | "OPTED_OUT";
export type ContactBasis =
  | "UNKNOWN"
  | "CUSTOMER_REQUEST"
  | "EXISTING_RELATIONSHIP"
  | "CONSENT_RECORDED"
  | "OTHER_REVIEW_REQUIRED";

export interface Lead {
  id: string;
  workspaceId: string;
  externalLeadId: string | null;
  companyName: string;
  industry: string | null;
  district: string | null;
  source: string | null;
  sourceUrl: string | null;
  contactBasis: ContactBasis;
  stage: LeadStage;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface LeadContact {
  id: string;
  leadId: string;
  contactName: string | null;
  phoneNormalized: string | null;
  phoneDisplayMasked: string | null;
  emailNormalized: string | null;
  emailDisplayMasked: string | null;
}
export interface ImportJob {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  status:
    | "UPLOADED"
    | "MAPPED"
    | "VALIDATING"
    | "NEEDS_REVIEW"
    | "APPROVED"
    | "COMMITTED"
    | "FAILED"
    | "ROLLED_BACK";
  fileChecksum: string;
  idempotencyKey: string;
  sheetName: string | null;
  rowCount: number;
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  createdAt: string;
  committedAt: string | null;
}
export interface ConsentRecord {
  id: string;
  leadContactId: string;
  channel: "PHONE" | "EMAIL" | "ZALO_OA" | "OTHER";
  purpose: string;
  status: ConsentStatus;
  evidenceRef: string | null;
  evidenceAt: string | null;
  recordedByUserId: string;
  createdAt: string;
}
export interface SuppressionRecord {
  id: string;
  workspaceId: string;
  leadContactId: string | null;
  channel: "ALL" | "PHONE" | "EMAIL" | "ZALO_OA";
  reason: "OPT_OUT" | "COMPLAINT" | "MANUAL_BLOCK";
  active: boolean;
  createdByUserId: string;
  createdAt: string;
  liftedAt: string | null;
}
export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  importJobId: string | null;
  changedFields: string[];
  occurredAt: string;
  requestId: string | null;
}
```

Data contracts trên là interface thiết kế, chưa triển khai schema DB ở P0.0. ORM ở P0.1 phải lưu đầy đủ quan hệ/unique constraints/transactions; audit event không chứa `phone`, `email`, token hoặc raw Excel row.

## 17. API contract cho Excel import

- `POST /api/import-jobs` multipart upload, tạo job chưa import; trả `{jobId,status}`.
- `PUT /api/import-jobs/:id/mapping` nhận `{sheetName, columnMap}`.
- `POST /api/import-jobs/:id/validate` trả summary counts và lỗi theo dòng/cột đã mask.
- `GET /api/import-jobs/:id/preview?page=&pageSize=` trả preview đã mask, dedupe candidates và lựa chọn chưa duyệt.
- `POST /api/import-jobs/:id/decisions` nhận `{decisions:[{rowNumber,action:'CREATE'|'MERGE'|'SKIP',targetLeadId?}]}`; fuzzy candidates cần AM/Manager review.
- `POST /api/import-jobs/:id/commit` yêu cầu `Idempotency-Key`; all-or-nothing transaction theo job, audit mỗi quyết định, rollback nếu lỗi.
- `GET /api/import-jobs/:id` trả trạng thái, counts, summary; không trả workbook raw.

Tất cả endpoints phải áp dụng RBAC/workspace scope. `OPTED_OUT` tạo suppression trong cùng transaction với lead; nếu audit append thất bại thì transaction rollback, không để lead/contact ở trạng thái chưa được chặn. Không có endpoint “import and send”.
