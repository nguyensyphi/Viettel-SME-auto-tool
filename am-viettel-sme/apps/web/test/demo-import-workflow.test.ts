import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createDemoApiServices } from "../src/server/demo-services.js";

describe("Task 3: Real Excel Import Engine & Lead Persistence in Demo Mode", () => {
  const actor = {
    userId: "user-am",
    workspaceId: "viettel-sme",
    role: "AM" as const,
    teamId: "team-dian",
  };

  it("parses real Excel file, generates real preview rows, and commits them to leadsStore", async () => {
    const services = createDemoApiServices();
    const filePath = path.resolve(process.cwd(), "storage/DNMTL_T7_2026_Standard_Template.xlsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const fileBytes = fs.readFileSync(filePath);

    // 1. Upload workbook
    const uploadResult = await services.imports.upload({
      actor,
      filename: "DNMTL_T7_2026_Standard_Template.xlsx",
      bytes: fileBytes,
    });
    expect(uploadResult.success).toBe(true);
    if (!uploadResult.success) return;
    const handle = uploadResult.value.handle;

    // 2. Validate & generate preview
    const previewResult = await services.imports.validate({
      actor,
      handle,
      filename: "DNMTL_T7_2026_Standard_Template.xlsx",
      bytes: fileBytes,
      existingLeads: [],
    });
    expect(previewResult.success).toBe(true);
    if (!previewResult.success) return;
    expect(previewResult.value.preview).toBeDefined();
    expect(previewResult.value.preview?.totalRows).toBe(5003);
    expect(previewResult.value.preview?.rows.length).toBeGreaterThan(0);

    // 3. Approve review decisions
    const decisions = (previewResult.value.preview?.rows ?? []).slice(0, 10).map((r) => ({
      rowNumber: r.rowNumber,
      action: "KEEP" as const,
    }));
    const approveResult = await services.imports.approve({
      actor,
      handle,
      decisions,
      confirmIgnoredColumns: true,
    });
    expect(approveResult.success).toBe(true);

    // 4. Commit
    const commitResult = await services.imports.commit({
      actor,
      handle,
      idempotencyKey: "test-idempotency-key-12345",
    });
    expect(commitResult.success).toBe(true);

    // 5. Verify leads appear in leadsStore
    const result = (await services.leads.listLeads(actor)) as unknown as {
      items: { companyName: string }[];
    };
    // Initial 5 demo leads + at least 10 committed leads
    expect(result.items.length).toBeGreaterThanOrEqual(15);
    const firstCommitted = result.items.find((l) =>
      l.companyName.includes("ĐẠI THÀNH"),
    );
    expect(firstCommitted).toBeDefined();
  });

  it("successfully uploads and processes workbook containing CMND/CCCD by quarantining them instead of blocking", async () => {
    const services = createDemoApiServices();
    const userPath = "C:/Users/LENOVO/.gemini/antigravity/brain/e0fecde4-58e1-4727-8f7a-91297c1ba44c/.user_uploaded/media_1793900499687_8745997d.xlsx";
    if (!fs.existsSync(userPath)) return;
    const fileBytes = fs.readFileSync(userPath);

    // 1. Upload workbook with CMND/CCCD columns
    const uploadResult = await services.imports.upload({
      actor,
      filename: "DNMTL_T7.2026.xlsx",
      bytes: fileBytes,
    });
    // Must succeed (not return PERSONAL_IDENTIFIER_COLUMN_BLOCKED)
    expect(uploadResult.success).toBe(true);
    if (!uploadResult.success) return;
    const handle = uploadResult.value.handle;

    // Verify CMND/CCCD columns were quarantined and not added to columnMap
    const columnMap = uploadResult.value.headerInspection?.columnMap ?? [];
    expect(columnMap.some((c) => c.sourceColumnIndex === 15)).toBe(false); // CMND is excluded

    // 2. Validate & generate preview
    const previewResult = await services.imports.validate({
      actor,
      handle,
      filename: "DNMTL_T7.2026.xlsx",
      bytes: fileBytes,
      existingLeads: [],
    });
    expect(previewResult.success).toBe(true);
    if (!previewResult.success) return;
    expect(previewResult.value.preview).toBeDefined();
    expect(previewResult.value.preview?.totalRows).toBe(5003);
  });
});
