# Viettel AM Automation Platform — Kế Hoạch Triển Khai Hoàn Thiện Toàn Diện

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện toàn bộ hệ thống Viettel AM Automation Platform từ nền tảng P0.8.2 lên chuẩn đầy đủ của Master Plan: hoàn tất Module 01 (Outreach), xây dựng Module 02 (Personal Branding với Playwright), Module 03 (Partner Campaign) và Shared Core (BullMQ Queue, Kill Switch, Telegram Bot).

**Architecture:** Monorepo TypeScript gồm Next.js web UI, Node/NestJS modular domain packages, Prisma ORM + PostgreSQL, Redis + BullMQ cho bất đồng bộ, Playwright persistent browser contexts cho quản lý tài khoản/đăng bài, và Telegram Bot API cho điều hành nhanh.

**Tech Stack:** Node.js 22+, TypeScript 5.9+, Next.js 16, Prisma 7, PostgreSQL 17, Redis 7, BullMQ, Playwright, Vitest, Zod, Argon2id.

**Spec:** `docs/master-plan/Code tool AM_compressed_1.pdf` và `am-viettel-sme/design/DESIGN_SPEC_AM_VIETTEL_SME.md`.

---

## Global Constraints

1. **Tuân thủ dữ liệu & Tối thiểu hóa:** Tuyệt đối không lưu CMND/CCCD/ngày sinh của người đại diện; không lưu file raw thô vào database.
2. **Cơ chế Fail-Closed Contactability:** Khách hàng thiếu căn cứ pháp lý hoặc nguồn chứng cứ bị chặn liên hệ; khách đã opt-out/suppressed bị khóa vĩnh viễn trên mọi kênh.
3. **Quản lý trình duyệt Playwright:** Sử dụng `launchPersistentContext` với thư mục `userDataDir` riêng biệt cho từng tài khoản (`storage/browser_profiles/<account_id>`). Không dùng proxy lách luật, AM quét QR trực tiếp.
4. **Idempotency & Job Safety:** Mọi tác vụ hàng đợi (Queue Job) bắt buộc có `idempotencyKey`, `Job Lock` và chính sách retry có giới hạn (Dead Letter Queue).
5. **Kill Switch & Circuit Breaker:** Hệ thống phải có nút dừng khẩn cấp toàn bộ worker ngay lập tức khi phát hiện sự cố bất thường.
6. **Phương pháp TDD:** Viết test trước cho mọi chức năng và đảm bảo 233 test hiện có không bị regression.

---

## Review Focus

1. **Khách hàng đã opt-out nhưng hệ thống vẫn sinh tin nhắn chào hàng:** Cổng `ContactabilityPolicy` phải chặn ngay từ tầng sinh tin nhắn và hàng đợi outreach.
2. **Playwright bị mất session hoặc hết hạn QR khi đang chạy job đăng bài:** Xử lý ngoại lệ graceful, cập nhật tài khoản sang `NEEDS_LOGIN`, gửi alert cho AM, không retry vô hạn.
3. **Hai worker cùng tranh nhau gửi tin hoặc đăng bài trên 1 tài khoản:** Áp dụng Redis Job Lock theo `account_id` hoặc `lead_id`.
4. **Worker bị crash giữa lúc đang commit dữ liệu:** Dùng database transaction và reconciliation job để đưa trạng thái về `FAILED` hoặc `ROLLED_BACK`.
5. **Tin nhắn sinh ra sai sản phẩm hoặc giá chính sách đã hết hạn:** Kiểm tra version và cờ `CAN_XAC_NHAN_LAI` trước khi xuất bản tin nhắn.

---

# Lộ Trình 4 Giai Đoạn (Phased Roadmap)

```text
Phase 1: Shared Core Queue & Module 01 Completion (Customer Outreach)
Phase 2: Module 02 — Personal Branding Automation (Playwright Browser Engine)
Phase 3: Module 03 — Partner & Group Campaign Automation
Phase 4: Operations & Control (Telegram Admin Bot & Dashboard Hardening)
```

---

## GIAI ĐOẠN 1: Shared Core Queue & Hoàn Thiện Module 01

### Task 1: Tích hợp Hàng đợi Bất đồng bộ (BullMQ + Redis)
**Files:**
- Create: `am-viettel-sme/packages/queue/package.json`
- Create: `am-viettel-sme/packages/queue/src/queue-factory.ts`
- Create: `am-viettel-sme/packages/queue/src/job-lock.ts`
- Create: `am-viettel-sme/packages/queue/src/index.ts`
- Test: `am-viettel-sme/packages/queue/test/queue-safety.test.ts`

**Interfaces:**
- Consumes: `@am-sme/config` (Redis URL).
- Produces: `createQueue(name: string)`, `acquireJobLock(key: string, ttlMs: number): Promise<boolean>`, `releaseJobLock(key: string): Promise<void>`.

- [x] **Step 1: Viết failing test cho Queue & Job Lock**
- [x] **Step 2: Chạy test để xác nhận FAIL**
- [x] **Step 3: Cài đặt BullMQ và viết module quản lý Lock & Idempotency**
- [x] **Step 4: Chạy test để xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 2: Bộ Phân Loại Khách Hàng (Customer Classification Engine — M01-05)
**Files:**
- Create: `am-viettel-sme/packages/domain/src/classification/types.ts`
- Create: `am-viettel-sme/packages/domain/src/classification/rules.ts`
- Create: `am-viettel-sme/packages/domain/src/classification/classifier.ts`
- Modify: `am-viettel-sme/packages/domain/src/index.ts`
- Test: `am-viettel-sme/packages/domain/test/classifier.test.ts`

**Interfaces:**
- Consumes: Raw lead attributes (`companyName`, `industry`, `notes`, `source`).
- Produces: `classifyCustomer(input: CustomerClassificationInput): CustomerClassificationResult` trả về `customerType` (DIRECT_A, PARTNER_B, CTV_C, UNKNOWN_D), `confidenceScore` (0.0..1.0), `reasons: string[]`, `reviewStatus: "AUTO_APPROVED" | "PENDING_REVIEW"`.

- [x] **Step 1: Viết failing test cho các kịch bản phân loại: kế toán thuế -> Nhóm B, logistics/chữ ký số -> Nhóm A, ngân hàng -> Nhóm C, thiếu thông tin -> Nhóm D (confidence < 0.8)**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai luật phân loại và thuật toán chấm điểm confidence**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 3: Bộ Ghép Sản Phẩm & Chính Sách (Product Matching Engine — M01-06)
**Files:**
- Create: `am-viettel-sme/packages/domain/src/product-matching/catalog.ts`
- Create: `am-viettel-sme/packages/domain/src/product-matching/matcher.ts`
- Test: `am-viettel-sme/packages/domain/test/product-matcher.test.ts`

**Interfaces:**
- Consumes: `CustomerClassificationResult`, thông tin ngành nghề/nhu cầu.
- Produces: `matchProducts(lead: LeadProfile): ProductMatchRecommendation[]` với 15 sản phẩm Viettel SME, tín hiệu sàng lọc, câu hỏi kiểm tra và cờ `policyStatus: "CAN_XAC_NHAN_LAI"`.

- [x] **Step 1: Viết failing test kiểm tra matching logic cho 15 sản phẩm từ ma trận**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai catalog JSON và Matcher Service**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 4: Thư Viện Mẫu Tin Nhắn Động (Message Template Generator — M01-07)
**Files:**
- Create: `am-viettel-sme/packages/domain/src/messaging/template-engine.ts`
- Create: `am-viettel-sme/packages/domain/src/messaging/templates.ts`
- Test: `am-viettel-sme/packages/domain/test/template-engine.test.ts`

**Interfaces:**
- Consumes: `TemplateContext` (`company_name`, `contact_person`, `product_name`, `am_name`, `benefit`, `price`,...).
- Produces: `renderMessage(templateId: string, context: TemplateContext): RenderedMessage` kèm kiểm tra validation biến bắt buộc.

- [x] **Step 1: Viết failing test cho việc render template với biến động và chặn khi thiếu biến hoặc sai đối tượng**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Cài đặt Template Engine (hỗ trợ versioning và gắn đính kèm file/ảnh)**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 5: Hệ Thống Phòng Vệ: Kill Switch, Circuit Breaker & Rate Limiter
**Files:**
- Create: `am-viettel-sme/packages/config/src/kill-switch.ts`
- Create: `am-viettel-sme/packages/config/src/circuit-breaker.ts`
- Create: `am-viettel-sme/packages/config/src/rate-limiter.ts`
- Test: `am-viettel-sme/packages/config/test/safety-mechanisms.test.ts`

**Interfaces:**
- Produces: `isKillSwitchActive(): Promise<boolean>`, `activateKillSwitch(reason: string)`, `checkRateLimit(key: string, limit: number, windowMs: number)`.

- [x] **Step 1: Viết failing test: khi Kill Switch bật thì từ chối mọi background job mới, Circuit Breaker tự ngắt sau 5 lỗi liên tiếp**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai các module an toàn qua Redis/Memory state**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

## GIAI ĐOẠN 2: Module 02 — Personal Branding Automation (Playwright Browser Engine)

### Task 6: Quản Lý Profile Trình Duyệt Playwright (Browser Profile Manager — M02-06)
**Files:**
- Create: `am-viettel-sme/packages/browser-automation/package.json`
- Create: `am-viettel-sme/packages/browser-automation/src/profile-manager.ts`
- Create: `am-viettel-sme/packages/browser-automation/src/types.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/profile-manager.test.ts`

**Interfaces:**
- Produces: `launchAccountBrowser(accountId: string, platform: "ZALO" | "FACEBOOK", options: { headless: boolean }): Promise<BrowserContext>`, `getProfileDir(accountId: string): string`.

- [x] **Step 1: Viết failing test khởi tạo và cô lập profile độc lập theo `accountId`**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Playwright Persistent Context manager với thư mục profile riêng biệt**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 7: Luồng Đăng Nhập Tương Tác & Giám Sát Phiên (Interactive Login & Health Monitor)
**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/login-flow.ts`
- Create: `am-viettel-sme/packages/browser-automation/src/health-monitor.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/login-flow.test.ts`

**Interfaces:**
- Produces: `startLoginSession(accountId: string, platform: "ZALO" | "FACEBOOK"): Promise<{ status: "CONNECTED" | "TIMEOUT" | "FAILED" }>`, `checkSessionHealth(accountId: string, platform: string): Promise<boolean>`.

- [x] **Step 1: Viết failing test mô phỏng phát hiện session thành công hoặc văng ra màn hình đăng nhập**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai luồng mở browser (headless: false) để AM quét QR Zalo / đăng nhập FB và tự động lưu session**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 8: Trình Kết Nối Google Docs & Google Drive (M02-01, M02-02)
**Files:**
- Create: `am-viettel-sme/packages/content-library/package.json`
- Create: `am-viettel-sme/packages/content-library/src/google-docs-connector.ts`
- Create: `am-viettel-sme/packages/content-library/src/google-drive-connector.ts`
- Create: `am-viettel-sme/packages/content-library/src/content-parser.ts`
- Test: `am-viettel-sme/packages/content-library/test/connectors.test.ts`

**Interfaces:**
- Produces: `importPostsFromDoc(documentId: string): Promise<ParsedPost[]>`, `syncMediaAssets(folderId: string): Promise<MediaAsset[]>`.

- [x] **Step 1: Viết failing test parser tách bài viết từ định dạng Docs chuẩn (`CONTENT_ID`, `TOPIC`, `CONTENT`)**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Google API connectors và cache ảnh nội bộ**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 9: Bộ Ghép Ảnh & Lập Lịch Đăng Bài (Media Matcher & Publishing Scheduler)
**Files:**
- Create: `am-viettel-sme/packages/content-library/src/media-matcher.ts`
- Create: `am-viettel-sme/packages/content-library/src/publishing-scheduler.ts`
- Test: `am-viettel-sme/packages/content-library/test/scheduler.test.ts`

**Interfaces:**
- Produces: `matchMediaToPost(post: ParsedPost): MediaAsset[]`, `schedulePost(postId: string, accountId: string, publishTime: Date)`.

- [x] **Step 1: Viết failing test ghép ảnh theo `content_id`/`topic`, chặn khi thiếu ảnh bắt buộc, quản lý vòng đời `DRAFT -> APPROVED -> SCHEDULED`**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Media Matcher và Scheduler**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 10: Worker Thực Thi Đăng Bài Bằng Playwright (Publishing Worker)
**Files:**
- Create: `am-viettel-sme/packages/browser-automation/src/publishing-worker.ts`
- Create: `am-viettel-sme/packages/browser-automation/src/publishers/zalo-publisher.ts`
- Create: `am-viettel-sme/packages/browser-automation/src/publishers/facebook-publisher.ts`
- Test: `am-viettel-sme/packages/browser-automation/test/publishing-worker.test.ts`

**Interfaces:**
- Produces: `executePublishingJob(job: PublishingJob): Promise<PublishingResult>`. Hỗ trợ cả 2 chế độ: Full-Auto và Semi-Auto (AM xác nhận).

- [x] **Step 1: Viết failing test điều phối job đăng bài: mở browser, gõ phím có delay ngẫu nhiên, đính kèm ảnh, chụp ảnh màn hình làm bằng chứng**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Publishing Worker và các adapter Zalo/Facebook**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

## GIAI ĐOẠN 3: Module 03 — Partner & Group Campaign Automation

### Task 11: Quản Lý Nhóm & Chiến Dịch (Group Database & Campaign Manager — M03-01, M03-02)
**Files:**
- Create: `am-viettel-sme/packages/campaigns/package.json`
- Create: `am-viettel-sme/packages/campaigns/src/group-manager.ts`
- Create: `am-viettel-sme/packages/campaigns/src/campaign-manager.ts`
- Test: `am-viettel-sme/packages/campaigns/test/campaign-manager.test.ts`

- [x] **Step 1: Viết failing test tạo chiến dịch tìm CTV, phân loại nhóm (Kế toán, Ngân hàng, Doanh nghiệp), kiểm tra quyền đăng bài của nhóm**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Group Manager và Campaign Manager**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 12: Partner CRM & Theo Dõi Chuyển Đổi CTV (M03-10)
**Files:**
- Create: `am-viettel-sme/packages/campaigns/src/partner-crm.ts`
- Test: `am-viettel-sme/packages/campaigns/test/partner-crm.test.ts`

- [x] **Step 1: Viết failing test vòng đời CTV (`NEW -> CONTACTED -> ACTIVE_PARTNER`), đối soát doanh thu và hoa hồng**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Partner CRM service**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

## GIAI ĐOẠN 4: Điều Hành, Giám Sát & Web UI

### Task 13: Telegram Admin Bot (Shared Core Controller)
**Files:**
- Create: `am-viettel-sme/packages/telegram-bot/package.json`
- Create: `am-viettel-sme/packages/telegram-bot/src/bot.ts`
- Create: `am-viettel-sme/packages/telegram-bot/src/alerts.ts`
- Test: `am-viettel-sme/packages/telegram-bot/test/bot.test.ts`

- [x] **Step 1: Viết failing test xử lý lệnh `/dashboard`, `/jobs`, `/pause`, `/resume` và phát System Alert**
- [x] **Step 2: Chạy test xác nhận FAIL**
- [x] **Step 3: Triển khai Telegram Bot qua Telegram Bot API (không gửi mật khẩu/QR qua bot)**
- [x] **Step 4: Chạy test xác nhận PASS**
- [x] **Step 5: Commit task**

---

### Task 14: Nâng Cấp Web Dashboard & E2E Testing
**Files:**
- Modify: `am-viettel-sme/apps/web/src/ui/workspace-app.tsx`
- Create: `am-viettel-sme/apps/web/src/ui/accounts-view.tsx`
- Create: `am-viettel-sme/apps/web/src/ui/calendar-view.tsx`
- Create: `am-viettel-sme/apps/web/src/ui/campaign-view.tsx`
- Test: `am-viettel-sme/apps/web/test/full-system-e2e.test.ts`

- [ ] **Step 1: Viết test E2E kiểm tra toàn bộ luồng từ Import Lead -> Match Sản Phẩm -> Lập Lịch Đăng Bài -> Quản Lý CTV**
- [ ] **Step 2: Chạy test xác nhận FAIL**
- [ ] **Step 3: Hoàn thiện các giao diện Dashboard trên Next.js**
- [ ] **Step 4: Chạy test xác nhận PASS toàn bộ**
- [ ] **Step 5: Commit và hoàn thành**

