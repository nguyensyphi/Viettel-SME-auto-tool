import { describe, expect, it } from "vitest";
import {
  LEAD_IMPORT_FIELDS,
  inspectHeaders,
  mapLeadRow,
} from "../src/index.js";

const mapping = inspectHeaders(LEAD_IMPORT_FIELDS).columnMap;

function makeRow(overrides: Partial<Record<string, string>> = {}): string[] {
  return LEAD_IMPORT_FIELDS.map((field) => {
    if (field === "company_name") return "  Công ty   Việt  ";
    return overrides[field] ?? "";
  });
}

describe("P0.3b minimal Excel row-adapter integration", () => {
  it("normalizes company and local phone while keeping email display separate from its lowercase key", () => {
    const result = mapLeadRow(
      makeRow({
        phone: " +84 (90) 123-4567 ",
        email: " Sales.Team@Example.COM ",
      }),
      mapping,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.lead.company_name).toBe("Công ty Việt");
    expect(result.lead.company_name_match_key).toBe("công ty việt");
    expect(result.lead.phone).toBe("0901234567");
    expect(result.lead.phone_status).toBe("VALID");
    expect(result.lead.phone_normalized).toBe("0901234567");
    expect(result.lead.email).toBe("Sales.Team@Example.COM");
    expect(result.lead.email_normalized).toBe("sales.team@example.com");
  });

  it("keeps international phone in NEEDS_REVIEW with no phone dedupe key", () => {
    const result = mapLeadRow(makeRow({ phone: "+86 139 1234 5678" }), mapping);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.lead.phone).toBe("+8613912345678");
    expect(result.lead.phone_status).toBe("NEEDS_REVIEW");
    expect(result.lead.phone_normalized).toBeNull();
  });

  it("returns row-level field errors for invalid phone and email without copying values into errors", () => {
    const secretPhone = "09012ABC67";
    const secretEmail = "not-a-real-email-value";
    const result = mapLeadRow(
      makeRow({ phone: secretPhone, email: secretEmail }),
      mapping,
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors).toEqual([
      { code: "PHONE_INVALID", field: "phone" },
      { code: "EMAIL_INVALID", field: "email" },
    ]);
    expect(JSON.stringify(result.errors)).not.toContain(secretPhone);
    expect(JSON.stringify(result.errors)).not.toContain(secretEmail);
  });
});
