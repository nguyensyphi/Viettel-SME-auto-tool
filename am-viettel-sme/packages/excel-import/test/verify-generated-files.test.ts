import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseXlsxWorkbook, inspectHeaders } from "../src/index.js";

describe("Verify generated files for user import", () => {
  it("verifies DNMTL_T7_2026_Cleaned.xlsx", () => {
    const filePath = path.resolve(__dirname, "../../../storage/DNMTL_T7_2026_Cleaned.xlsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    const parsed = parseXlsxWorkbook("DNMTL_T7_2026_Cleaned.xlsx", bytes);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.sheetName).toBe("Leads");
      expect(parsed.rows.length).toBe(5003);
      const inspection = inspectHeaders(parsed.headers);
      expect(inspection.status).toBe("NEEDS_REVIEW");
      expect(inspection.errors).toHaveLength(0);
      expect(inspection.columnMap.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("verifies DNMTL_T7_2026_Standard_Template.xlsx", () => {
    const filePath = path.resolve(__dirname, "../../../storage/DNMTL_T7_2026_Standard_Template.xlsx");
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    const parsed = parseXlsxWorkbook("DNMTL_T7_2026_Standard_Template.xlsx", bytes);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.sheetName).toBe("Leads");
      expect(parsed.rows.length).toBe(5003);
      const inspection = inspectHeaders(parsed.headers);
      expect(inspection.status).toBe("READY");
      expect(inspection.errors).toHaveLength(0);
      expect(inspection.columnMap).toHaveLength(17);
    }
  });
});

