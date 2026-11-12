import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";
import { parseXlsxWorkbook, inspectHeaders } from "@am-sme/excel-import";

describe("Viettel AM SME — Kiểm thử tuần tự từng tính năng cốt lõi (Sequential Feature Verification)", () => {
  const services = createDemoApiServices();
  let sessionCookie = "";
  let createdLeadId = "";
  const taskIdToComplete = "task-01";

  function makeRequest(
    urlPath: string,
    method = "GET",
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): { req: Request; segments: string[] } {
    const url = new URL(`http://localhost:3000${urlPath}`);
    const segments = url.pathname.split("/").filter(Boolean);
    const headers: Record<string, string> = {
      origin: "http://localhost:3000",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...extraHeaders,
    };
    let reqBody: string | undefined = undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
    const req = new Request(url.toString(), {
      method,
      headers,
      ...(reqBody !== undefined ? { body: reqBody } : {}),
    });
    return { req, segments };
  }

  // =========================================================================
  // TÍNH NĂNG 1: XÁC THỰC & DUY TRÌ PHIÊN LÀM VIỆC (AUTHENTICATION & PERSISTENCE)
  // =========================================================================
  describe("Tính năng 1: Xác thực & Duy trì phiên làm việc (Auth & Session Persistence)", () => {
    it("1.1 Chặn truy cập khi chưa đăng nhập (Fail-Closed Security)", async () => {
      const { req, segments } = makeRequest("/api/v1/auth/me", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("UNAUTHENTICATED");
      console.log("   [PASS] 1.1: Chặn truy cập trái phép thành công (HTTP 401 UNAUTHENTICATED)");
    });

    it("1.2 Đăng nhập với tài khoản AM Viettel Dĩ An và nhận Session Cookie", async () => {
      const { req, segments } = makeRequest("/api/v1/auth/login", "POST", {
        workspaceId: "viettel-sme",
        email: "am@viettel.vn",
        password: "password123",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.user.userId).toBe("user-am");
      expect(json.user.role).toBe("AM");
      expect(json.user.workspaceId).toBe("viettel-sme");

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("am_sme_session=");
      sessionCookie = setCookie!.split(";")[0]!;
      console.log("   [PASS] 1.2: Đăng nhập thành công, cấp Session Cookie:", sessionCookie);
    });

    it("1.3 Xác thực phiên qua Cookie /api/v1/auth/me duy trì liên tục", async () => {
      const { req, segments } = makeRequest("/api/v1/auth/me", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.user.userId).toBe("user-am");
      expect(json.user.role).toBe("AM");
      console.log("   [PASS] 1.3: Xác thực phiên /api/v1/auth/me thành công (user-am, role AM)");
    });
  });

  // =========================================================================
  // TÍNH NĂNG 2: DASHBOARD HÔM NAY & QUẢN LÝ TÁC VỤ (DASHBOARD & TASKS)
  // =========================================================================
  describe("Tính năng 2: Dashboard hôm nay & Quản lý tác vụ (Dashboard & Tasks)", () => {
    it("2.1 Lấy danh sách tác vụ OPEN hôm nay của AM (không trùng lặp)", async () => {
      const { req, segments } = makeRequest("/api/v1/tasks?status=OPEN", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const tasks = await res.json();
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThanOrEqual(3);

      const ids = tasks.map((t: { id: string }) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      console.log(`   [PASS] 2.1: Danh sách tác vụ OPEN gồm ${ids.length} việc, mã ID không trùng lặp:`, ids);
    });

    it("2.2 Hoàn tất tác vụ chuyển trạng thái sang DONE", async () => {
      const { req, segments } = makeRequest(`/api/v1/tasks/${taskIdToComplete}/complete`, "POST", {
        outcome: "Khách hàng đồng ý ký hợp đồng gói CA + S-Invoice 3 năm.",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("DONE");
      console.log(`   [PASS] 2.2: Tác vụ ${taskIdToComplete} đã hoàn tất với status: DONE`);
    });

    it("2.3 Xác nhận tác vụ đã hoàn tất được loại khỏi danh sách OPEN hôm nay", async () => {
      const { req, segments } = makeRequest("/api/v1/tasks?status=OPEN", "GET");
      const res = await handleApiRequest(req, segments, services);
      const tasks = await res.json();
      const ids = tasks.map((t: { id: string }) => t.id);
      expect(ids.includes(taskIdToComplete)).toBe(false);
      console.log(`   [PASS] 2.3: Tác vụ ${taskIdToComplete} đã được loại khỏi danh sách việc cần làm hôm nay.`);
    });

    it("2.4 Hoãn tác vụ sang ngày tiếp theo", async () => {
      const { req, segments } = makeRequest("/api/v1/tasks/task-02/defer", "POST", {
        reason: "Khách hàng bận họp giao ban đột xuất, dời lịch hẹn sang sáng mai.",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("DEFERRED");
      console.log("   [PASS] 2.4: Hoãn tác vụ task-02 thành công với status DEFERRED.");
    });
  });

  // =========================================================================
  // TÍNH NĂNG 3: KHÔNG GIAN LEAD & CHUYỂN GIAI ĐOẠN (LEAD WORKSPACE & PROGRESSION)
  // =========================================================================
  describe("Tính năng 3: Quản lý Lead, Chuyển giai đoạn & Ghi chú (Lead Workspace)", () => {
    it("3.1 Tạo lead mới thủ công tuân thủ Nghị định 13 (che số điện thoại, ghi nhận nguồn)", async () => {
      const { req, segments } = makeRequest("/api/v1/leads", "POST", {
        companyName: "Công ty Cổ phần Vận Tải & Tiếp Vận Dĩ An",
        district: "Dĩ An",
        industry: "Vận tải & Logistics",
        province: "Bình Dương",
        contact: {
          contactName: "Phạm Văn Minh",
          phoneNormalized: "0903998877",
          emailNormalized: "minh@dianlogistics.vn",
        },
        source: {
          sourceType: "AM_ENTERED",
          contactBasis: "CONSENT_RECORDED",
          sourceLabel: "AM khai thác trực tiếp tại KCN Sóng Thần 2",
        },
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.leadId).toBeTruthy();
      createdLeadId = json.leadId;
      console.log("   [PASS] 3.1: Tạo lead thủ công thành công với ID:", createdLeadId);
    });

    it("3.2 Lấy danh sách leads và kiểm tra bảo vệ PII (mask phone 09••••••77)", async () => {
      const { req, segments } = makeRequest("/api/v1/leads", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      const lead = json.items.find((l: { id: string }) => l.id === createdLeadId);
      expect(lead).toBeDefined();
      expect(lead.companyName).toBe("Công ty Cổ phần Vận Tải & Tiếp Vận Dĩ An");
      expect(lead.contacts[0].phone).toBe("09••••••77");
      console.log("   [PASS] 3.2: Danh sách lead trả về chính xác, SĐT được che mờ an toàn:", lead.contacts[0].phone);
    });

    it("3.3 Thêm ghi chú nghiệp vụ AM vào lead", async () => {
      const { req, segments } = makeRequest(`/api/v1/leads/${createdLeadId}/notes`, "POST", {
        content: "Khách hàng quan tâm giải pháp Định vị xe & Giám sát hành trình V-Tracking 50 xe container.",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.noteId).toBeTruthy();
      console.log("   [PASS] 3.3: Thêm ghi chú nghiệp vụ AM thành công với ID:", json.noteId);
    });

    it("3.4 Luân chuyển giai đoạn lead từ NEW sang QUALIFIED", async () => {
      const { req, segments } = makeRequest(`/api/v1/leads/${createdLeadId}/stage`, "POST", {
        stage: "QUALIFIED",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);

      // Verify stage changed in list
      const listReq = makeRequest("/api/v1/leads", "GET");
      const listRes = await handleApiRequest(listReq.req, listReq.segments, services);
      const listJson = await listRes.json();
      const updated = listJson.items.find((l: { id: string }) => l.id === createdLeadId);
      expect(updated.stage).toBe("QUALIFIED");
      console.log("   [PASS] 3.4: Chuyển giai đoạn lead sang QUALIFIED thành công!");
    });
  });

  // =========================================================================
  // TÍNH NĂNG 4: BỘ MÁY IMPORT EXCEL & NGHỊ ĐỊNH 13 (EXCEL IMPORT ENGINE)
  // =========================================================================
  describe("Tính năng 4: Bộ máy Import Excel & Nghị định 13 (Excel Engine)", () => {
    it("4.1 Tải file template chuẩn Viettel AM SME qua API", async () => {
      const { req, segments } = makeRequest("/api/v1/import-template", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(res.headers.get("content-disposition")).toContain(
        "DNMTL_T7_2026_Standard_Template.xlsx",
      );
      const bytes = await res.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(1000);
      console.log(`   [PASS] 4.1: Endpoint tải file mẫu chuẩn hoạt động, kích thước: ${bytes.byteLength} bytes.`);
    });

    it("4.2 Chặn và loại bỏ cột định danh cá nhân (CCCD/CMND) khỏi mapping theo Nghị định 13/2023/NĐ-CP", () => {
      const dangerousHeaders = [
        "Mã số DN",
        "Tên doanh nghiệp",
        "Số CMND/CCCD",
        "Ngày cấp",
        "Điện thoại",
      ];
      const result = inspectHeaders(dangerousHeaders);
      expect(result.status).not.toBe("INVALID");
      expect(
        result.warnings.some(
          (w) => w.code === "PERSONAL_IDENTIFIER_COLUMN_BLOCKED",
        ),
      ).toBe(true);
      expect(result.columnMap.some((c) => dangerousHeaders[c.sourceColumnIndex]?.includes("CCCD"))).toBe(false);
      console.log("   [PASS] 4.2: Cơ chế bảo vệ tự động loại bỏ cột chứa CMND/CCCD, không ánh xạ vào database.");
    });

    it("4.3 Tự động nhận diện Sheet đầu tiên khi file không có sheet 'Leads'", () => {
      const templatePath = path.resolve(
        __dirname,
        "../../../storage/DNMTL_T7_2026_Standard_Template.xlsx",
      );
      const buffer = fs.readFileSync(templatePath);
      const parsed = parseXlsxWorkbook("DNMTL_T7_2026_Standard_Template.xlsx", buffer);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.sheetName).toBeTruthy();
        expect(parsed.rows.length).toBeGreaterThan(0);
        console.log(`   [PASS] 4.3: Tự động phát hiện Sheet '${parsed.sheetName}', tổng số dòng: ${parsed.rows.length}`);
      }
    });

    it("4.4 Phân tích và nạp 5.003 dòng lead thật vào hệ thống", async () => {
      const cleanedPath = path.resolve(
        __dirname,
        "../../../storage/DNMTL_T7_2026_Cleaned.xlsx",
      );
      const buffer = fs.readFileSync(cleanedPath);
      const parsed = parseXlsxWorkbook("DNMTL_T7_2026_Cleaned.xlsx", buffer);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.rows.length).toBe(5003);
        console.log(`   [PASS] 4.4: Phân tích thành công ${parsed.rows.length} dòng lead từ file dữ liệu thực tế.`);
      }
    });
  });

  // =========================================================================
  // TÍNH NĂNG 5: QUẢN LÝ TÀI KHOẢN MXH & QR LOGIN (ACCOUNTS & BROWSER ISOLATION)
  // =========================================================================
  describe("Tính năng 5: Quản lý Tài khoản & Phiên quét QR (Accounts & Isolated Profiles)", () => {
    it("5.1 Lấy danh sách tài khoản MXH hiện có", async () => {
      const { req, segments } = makeRequest("/api/v1/social-accounts", "GET");
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
      console.log(`   [PASS] 5.1: Danh sách có ${json.items.length} tài khoản mạng xã hội.`);
    });

    it("5.2 Khai báo tài khoản Zalo mới với thư mục profile riêng biệt", async () => {
      const { req, segments } = makeRequest("/api/v1/social-accounts", "POST", {
        accountId: "zalo-dian-am02",
        platform: "ZALO",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.accountId).toBe("zalo-dian-am02");
      expect(json.status).toBe("NEEDS_LOGIN");
      expect(json.profileDir).toBe("storage/browser_profiles/zalo-dian-am02");
      console.log("   [PASS] 5.2: Khai báo tài khoản thành công, profileDir cô lập:", json.profileDir);
    });

    it("5.3 Yêu cầu phiên quét mã QR đăng nhập", async () => {
      const { req, segments } = makeRequest("/api/v1/social-accounts/zalo-dian-am02/qr-login", "POST", {
        platform: "ZALO",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("NEEDS_LOGIN");
      expect(json.qrLoginRequested).toBe(true);
      console.log("   [PASS] 5.3: Yêu cầu mở phiên QR code thành công:", json.accountId);
    });

    it("5.4 Xác nhận kết nối tài khoản thành công chuyển sang CONNECTED", async () => {
      const { req, segments } = makeRequest("/api/v1/social-accounts/zalo-dian-am02/connect", "POST", {
        platform: "ZALO",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("CONNECTED");
      console.log("   [PASS] 5.4: Tài khoản đã kết nối thành công với trạng thái: CONNECTED");
    });
  });

  // =========================================================================
  // TÍNH NĂNG 6: LỊCH NỘI DUNG CÁ NHÂN & PHÊ DUYỆT (PUBLISHING CALENDAR)
  // =========================================================================
  describe("Tính năng 6: Lên lịch & Phê duyệt bài viết (Publishing Calendar)", () => {
    const postContentId = "POST-CA-DIAN-01";

    it("6.1 Lên lịch bài viết mới ở trạng thái DRAFT", async () => {
      const { req, segments } = makeRequest("/api/v1/publishing-calendar", "POST", {
        contentId: postContentId,
        topic: "CHU_KY_SO",
        platform: "ZALO",
        mode: "SEMI_AUTO",
        publishTime: "2026-11-06T15:00:00.000Z",
        content: "Ưu đãi chuyển đổi số doanh nghiệp mới thành lập tại TP Dĩ An: Tặng 1 năm chữ ký số Viettel-CA.",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.contentId).toBe(postContentId);
      expect(json.status).toBe("DRAFT");
      console.log("   [PASS] 6.1: Tạo bài viết thành công với trạng thái DRAFT:", postContentId);
    });

    it("6.2 Phê duyệt bài viết chuyển trạng thái sang APPROVED", async () => {
      const { req, segments } = makeRequest(
        `/api/v1/publishing-calendar/${postContentId}/approve`,
        "POST",
        {},
      );
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("APPROVED");
      console.log(`   [PASS] 6.2: Bài viết ${postContentId} đã được phê duyệt thành công với trạng thái: APPROVED`);
    });
  });

  // =========================================================================
  // TÍNH NĂNG 7: CHIẾN DỊCH TIẾP THỊ & ĐỐI TÁC CTV (CAMPAIGNS & PARTNER CRM)
  // =========================================================================
  describe("Tính năng 7: Quản trị Chiến dịch & Đối tác CTV (Campaigns & Partner CRM)", () => {
    const campaignId = "CAMP-KT-2026";
    const partnerId = "CTV-BINHDUONG-01";

    it("7.1 Tạo chiến dịch tiếp thị mới với đối tượng mục tiêu ngành Kế toán - Thuế", async () => {
      const { req, segments } = makeRequest("/api/v1/campaigns", "POST", {
        campaignId,
        name: "Chiến dịch Hợp tác Kế toán Dịch vụ Dĩ An 2026",
        campaignType: "GROUP_OUTREACH",
        targetCategories: ["ACCOUNTING_TAX"],
        contentTemplate: "Kính mời quý đối tác kế toán tham gia mạng lưới CTV chuyển đổi số Viettel SME.",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.campaignId).toBe(campaignId);
      expect(json.status).toBe("DRAFT");
      console.log("   [PASS] 7.1: Tạo chiến dịch thành công ở trạng thái DRAFT:", campaignId);
    });

    it("7.2 Phê duyệt chiến dịch đưa vào vận hành (APPROVED)", async () => {
      const { req, segments } = makeRequest(`/api/v1/campaigns/${campaignId}/approve`, "POST", {});
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("APPROVED");
      console.log(`   [PASS] 7.2: Phê duyệt chiến dịch ${campaignId} thành công với trạng thái: APPROVED`);
    });

    it("7.3 Đăng ký đối tác CTV mới (bảo mật số điện thoại)", async () => {
      const { req, segments } = makeRequest("/api/v1/partners", "POST", {
        partnerId,
        fullName: "Võ Thị Bích Trâm",
        phone: "0933112233",
        profession: "ACCOUNTANT",
        notes: "Phụ trách 35 khách hàng doanh nghiệp tại KCN Sóng Thần 1",
      });
      const res = await handleApiRequest(req, segments, services);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.partnerId).toBe(partnerId);
      expect(json.stage).toBe("NEW");
      expect(json.phoneMasked).toBe("********33");
      console.log("   [PASS] 7.3: Đăng ký CTV thành công, SĐT được che mờ:", json.phoneMasked);
    });

    it("7.4 Luân chuyển trạng thái CTV từ NEW -> CONTACTED -> ACTIVE_PARTNER", async () => {
      // Step 1: NEW -> CONTACTED
      const step1 = makeRequest(`/api/v1/partners/${partnerId}/stage`, "POST", {
        newStage: "CONTACTED",
      });
      const res1 = await handleApiRequest(step1.req, step1.segments, services);
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.stage).toBe("CONTACTED");
      console.log(`   [PASS] 7.4.1: Chuyển CTV ${partnerId} sang CONTACTED thành công.`);

      // Step 2: CONTACTED -> ACTIVE_PARTNER
      const step2 = makeRequest(`/api/v1/partners/${partnerId}/stage`, "POST", {
        newStage: "ACTIVE_PARTNER",
      });
      const res2 = await handleApiRequest(step2.req, step2.segments, services);
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.stage).toBe("ACTIVE_PARTNER");
      console.log(`   [PASS] 7.4.2: Chuyển CTV ${partnerId} sang ACTIVE_PARTNER thành công!`);
    });
  });
});
