import { describe, it, expect } from "vitest";
import { createDemoApiServices } from "../src/server/demo-services.js";
import { handleApiRequest } from "../src/server/http-api.js";

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

describe("Task 3.1: Outreach HTTP API Endpoints", () => {
  it("creates outreach batch, executes next queued task, and fetches summary", async () => {
    const services = createDemoApiServices();

    // 1. Authenticate to get session cookie
    const loginRes = await callApi(
      services,
      "/api/v1/auth/login",
      "POST",
      {
        workspaceId: "viettel-sme",
        email: "am@viettel.vn",
        password: "any-password",
      },
    );
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    // 2. Create outreach batch
    const createRes = await callApi(
      services,
      "/api/v1/outreach/batches",
      "POST",
      {
        batchName: "Đợt tiếp cận DN mới Dĩ An",
        leadIds: ["lead-01", "lead-02"],
        templateCode: "ZALO_DNMTL_INTRO_V1",
        action: "ADD_FRIEND_AND_SEND_MESSAGE",
        accountId: "zalo-dian-am01",
      },
      cookie,
    );
    expect(createRes.status).toBe(201);
    const createdData = (await createRes.json()) as {
      batch: { batchId: string; tasks: { id: string; status: string }[] };
      summary: { total: number; queued: number };
    };
    expect(createdData.batch.batchId).toBeDefined();
    expect(createdData.summary.total).toBe(2);
    expect(createdData.summary.queued).toBe(2);

    const batchId = createdData.batch.batchId;

    // 3. Run next task
    const runRes = await callApi(
      services,
      `/api/v1/outreach/batches/${batchId}/run-next`,
      "POST",
      {},
      cookie,
    );
    expect(runRes.status).toBe(200);
    const runData = (await runRes.json()) as {
      result: { task: { status: string }; status: string };
      summary: { total: number; sent: number; queued: number };
    };
    expect(runData.result.task.status).toBe("SENT");
    expect(runData.summary.sent).toBe(1);
    expect(runData.summary.queued).toBe(1);

    // 4. Get batch summary
    const getRes = await callApi(
      services,
      `/api/v1/outreach/batches/${batchId}`,
      "GET",
      undefined,
      cookie,
    );
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as {
      batch: { batchId: string; tasks: unknown[] };
      summary: { total: number; sent: number };
    };
    expect(getData.batch.batchId).toBe(batchId);
    expect(getData.summary.sent).toBe(1);
  });
});
