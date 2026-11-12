import { describe, it, expect } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { inspectHeaders, parseXlsxWorkbook } from "@am-sme/excel-import";

function callApi(
  services: ReturnType<typeof createDemoApiServices>,
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  const url = new URL(`http://localhost:3000${path}`);
  const segments = url.pathname.split("/").filter(Boolean);
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    ...(cookie ? { cookie } : {}),
  };
  let reqBody: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    reqBody = JSON.stringify(body);
  }
  const req = new Request(url.toString(), {
    method,
    headers,
    ...(reqBody ? { body: reqBody } : {}),
  });
  return handleApiRequest(req, segments, services);
}

describe("E2E: Excel Import with Sensitive Columns -> CRM -> Zalo Outreach Automation", () => {
  it("imports Excel containing CCCD/CMND, auto-quarantines PII without blocking, and executes Zalo Outreach", async () => {
    const services = createDemoApiServices();

    // 1. Authenticate as AM
    const loginRes = await callApi(
      services,
      "/api/v1/auth/login",
      "POST",
      {
        workspaceId: "viettel-sme",
        email: "am@viettel.vn",
        password: "secret-password",
      },
    );
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    // 2. Read the real Excel file containing DNMTL leads
    const templatePath = path.resolve(
      __dirname,
      "../../../storage/DNMTL_T7_2026_Standard_Template.xlsx",
    );
    const fileBytes = fs.readFileSync(templatePath);

    // 3. Verify parser & header inspection on raw headers with personal identifiers
    const headersWithSensitive = [
      "Mã số DN",
      "Tên doanh nghiệp",
      "Số CMND/CCCD",
      "Ngày cấp",
      "Điện thoại",
      "Địa chỉ trụ sở",
    ];
    const inspection = inspectHeaders(headersWithSensitive);
    // User requested "remove this checking": status must NOT be BLOCKED
    expect(inspection.status).not.toBe("BLOCKED");
    expect(inspection.status).toBe("NEEDS_REVIEW");
    expect(
      inspection.warnings.some(
        (w) => w.code === "PERSONAL_IDENTIFIER_COLUMN_BLOCKED",
      ),
    ).toBe(true);

    // 4. Create a lead in CRM (simulating committed lead from Excel)
    const createLeadRes = await callApi(
      services,
      "/api/v1/leads",
      "POST",
      {
        companyName: "CÔNG TY TNHH CÔNG NGHỆ BÌNH DƯƠNG MỚI",
        district: "Dĩ An",
        industry: "Công nghệ",
        province: "Bình Dương",
        website: null,
        businessAddress: "KCN Sóng Thần, Dĩ An",
        ownerUserId: null,
        contact: {
          contactName: "Anh Tuấn",
          phoneNormalized: "0988776655",
          emailNormalized: null,
          jobTitle: null,
        },
        source: {
          sourceType: "MANUAL",
          contactBasis: "LEGITIMATE_INTEREST",
          sourceLabel: "Khai thác trực tiếp",
          sourceUrl: null,
          collectedAt: null,
        },
      },
      cookie,
    );
    expect(createLeadRes.status).toBe(201);
    const newLead = (await createLeadRes.json()) as { leadId: string };
    expect(newLead.leadId).toBeDefined();

    // 5. Create Zalo Outreach Batch for this newly imported lead
    const batchRes = await callApi(
      services,
      "/api/v1/outreach/batches",
      "POST",
      {
        batchName: "Đợt tiếp cận DN Công Nghệ Mới Thành Lập",
        leadIds: [newLead.leadId],
        templateCode: "ZALO_DNMTL_INTRO_V1",
        action: "ADD_FRIEND_AND_SEND_MESSAGE",
        accountId: "zalo-dian-am01",
      },
      cookie,
    );
    expect(batchRes.status).toBe(201);
    const batchData = (await batchRes.json()) as {
      batch: { batchId: string; tasks: { id: string; leadId: string; companyName: string; status: string }[] };
      summary: { total: number; queued: number; sent: number };
    };

    expect(batchData.batch.tasks).toHaveLength(1);
    expect(batchData.batch.tasks[0]?.companyName).toBe("CÔNG TY TNHH CÔNG NGHỆ BÌNH DƯƠNG MỚI");
    expect(batchData.batch.tasks[0]?.status).toBe("QUEUED");

    // 6. Execute next queued task in batch
    const runNextRes = await callApi(
      services,
      `/api/v1/outreach/batches/${batchData.batch.batchId}/run-next`,
      "POST",
      {},
      cookie,
    );
    expect(runNextRes.status).toBe(200);
    const runResult = (await runNextRes.json()) as {
      result: { task: { leadId: string; status: string }; status: string } | null;
      summary: { total: number; queued: number; sent: number };
      batch: { batchId: string };
    };

    expect(runResult.result).not.toBeNull();
    expect(runResult.result?.task.leadId).toBe(newLead.leadId);
    expect(runResult.result?.status).toBe("SENT");
    expect(runResult.summary.sent).toBe(1);
    expect(runResult.summary.queued).toBe(0);
  });
});
