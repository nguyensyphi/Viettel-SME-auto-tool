import { describe, expect, it } from "vitest";
import {
  LEAD_IMPORT_FIELDS,
  assessImportProvenance,
  inspectHeaders,
  mapLeadRow,
  validateColumnMapping,
} from "../src/index.js";

const expectedHeaders = [
  "lead_id",
  "company_name",
  "contact_name",
  "phone",
  "email",
  "industry",
  "district",
  "source",
  "source_url",
  "lawful_contact_basis",
  "consent_status",
  "product_interest",
  "owner_am",
  "stage",
  "last_contact_at",
  "next_action_at",
  "notes",
] as const;

const standardHeaders = [...expectedHeaders];

function mappedHeaders() {
  const result = inspectHeaders(standardHeaders);
  expect(result.status).toBe("READY");
  return result.columnMap;
}

describe("P0.3a Excel lead import contract", () => {
  it("defines the exact 17-column template in the approved order", () => {
    expect(LEAD_IMPORT_FIELDS).toEqual(expectedHeaders);
    const inspection = inspectHeaders(expectedHeaders);
    expect(inspection.status).toBe("READY");
    expect(inspection.columnMap.map((entry) => entry.targetField)).toEqual(
      expectedHeaders,
    );
  });

  it("maps approved field names if an uploaded workbook uses a different column order", () => {
    const sourceHeaders = [...expectedHeaders].reverse();
    const inspection = inspectHeaders(sourceHeaders);
    expect(inspection.status).toBe("READY");
    const values = sourceHeaders.map((header) =>
      header === "company_name"
        ? "Công ty giả"
        : header === "phone"
          ? "0901234567"
          : "",
    );
    const result = mapLeadRow(values, inspection.columnMap);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lead.company_name).toBe("Công ty giả");
      expect(result.lead.phone).toBe("0901234567");
    }
  });

  it("rejects a header set without the required company_name column", () => {
    const inspection = inspectHeaders(
      expectedHeaders.filter((header) => header !== "company_name"),
    );
    expect(inspection.status).toBe("INVALID");
    expect(inspection.errors.map((issue) => issue.code)).toContain(
      "MISSING_REQUIRED_FIELD",
    );
  });

  it("rejects duplicate headers after safe header canonicalization", () => {
    const inspection = inspectHeaders([...expectedHeaders, " COMPANY_NAME "]);
    expect(inspection.status).toBe("INVALID");
    expect(inspection.errors.map((issue) => issue.code)).toContain(
      "DUPLICATE_HEADER",
    );
  });

  it("ignores unknown columns instead of adding them to the allow-list mapping", () => {
    const inspection = inspectHeaders([...expectedHeaders, "legacy_code"]);
    expect(inspection.status).toBe("NEEDS_REVIEW");
    expect(inspection.columnMap).toHaveLength(expectedHeaders.length);
    expect(
      inspection.columnMap.some((entry) => entry.sourceColumnIndex === 17),
    ).toBe(false);
    expect(inspection.warnings.map((issue) => issue.code)).toContain(
      "UNKNOWN_COLUMN_IGNORED",
    );
    expect(inspection.quarantinedColumns).toEqual([
      { sourceColumnIndex: 17, classification: "UNSUPPORTED" },
    ]);
  });

  it.each([
    "CCCD",
    "Số CMND",
    "Số căn cước",
    "Số hộ chiếu",
    "Ngày cấp",
    "Nơi cấp",
    "Date of issue",
    "Date of birth",
  ])(
    "blocks personal-ID column %s and never maps its values",
    (sensitiveHeader) => {
      const headers = [...expectedHeaders, sensitiveHeader];
      const inspection = inspectHeaders(headers);
      expect(inspection.status).toBe("BLOCKED");
      expect(inspection.columnMap).toHaveLength(expectedHeaders.length);
      expect(inspection.warnings.map((issue) => issue.code)).toContain(
        "PERSONAL_IDENTIFIER_COLUMN_BLOCKED",
      );
      const values = [
        ...expectedHeaders.map((header) =>
          header === "company_name" ? "Công ty giả" : "",
        ),
        "SYNTHETIC-ID-DO-NOT-IMPORT",
      ];
      const mapped = mapLeadRow(values, inspection.columnMap);
      expect(mapped.success).toBe(true);
      if (mapped.success) {
        expect(JSON.stringify(mapped.lead)).not.toContain(
          "SYNTHETIC-ID-DO-NOT-IMPORT",
        );
        expect("cccd" in mapped.lead).toBe(false);
      }
    },
  );

  it("rejects a manual mapping to a target outside the allow-list", () => {
    const result = validateColumnMapping([
      { sourceColumnIndex: 0, targetField: "company_name" },
      { sourceColumnIndex: 1, targetField: "personal_id" },
    ]);
    expect(result.status).toBe("INVALID");
    expect(result.errors.map((issue) => issue.code)).toContain(
      "UNKNOWN_TARGET_FIELD",
    );
  });

  it("rejects duplicate target mappings rather than silently overwriting a lead field", () => {
    const result = validateColumnMapping([
      { sourceColumnIndex: 0, targetField: "company_name" },
      { sourceColumnIndex: 1, targetField: "company_name" },
    ]);
    expect(result.status).toBe("INVALID");
    expect(result.errors.map((issue) => issue.code)).toContain(
      "DUPLICATE_TARGET_FIELD",
    );
  });

  it("rejects a non-text cell instead of coercing a typed field such as phone", () => {
    const values: unknown[] = expectedHeaders.map((header) =>
      header === "company_name" ? "Công ty giả" : "",
    );
    values[3] = 84901234567;
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        code: "CELL_TYPE_MISMATCH",
        field: "phone",
      });
    }
  });

  it("rejects a new-row stage such as CONTACTED", () => {
    const values: string[] = expectedHeaders.map((header) =>
      header === "company_name" ? "Công ty giả" : "",
    );
    values[13] = "CONTACTED";
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        code: "NEW_LEAD_STAGE_NOT_ALLOWED",
        field: "stage",
      });
    }
  });

  it("keeps every new lead in PENDING_REVIEW and defaults consent/contactability closed", () => {
    const values = expectedHeaders.map((header) =>
      header === "company_name" ? " Công ty giả " : "",
    );
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lead.company_name).toBe("Công ty giả");
      expect(result.lead.lead_id).toBeNull();
      expect(result.lead.stage).toBe("PENDING_REVIEW");
      expect(result.lead.consent_status).toBe("UNKNOWN");
      expect(result.lead.lawful_contact_basis).toBe("UNKNOWN");
      expect(result.lead.contactability_status).toBe("UNKNOWN");
    }
  });

  it("downgrades an allowed workbook value at the provenance gate without complete proof", () => {
    const values: string[] = expectedHeaders.map((header) =>
      header === "company_name" ? "Công ty giả" : "",
    );
    values[10] = "ALLOWED_FOR_RECORDED_PURPOSE";
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.lead.consent_status).toBe("ALLOWED_FOR_RECORDED_PURPOSE");
      expect(result.lead.contactability_status).toBe("UNKNOWN");
      const decision = assessImportProvenance(result.lead);
      expect(decision.consentStatus).toBe("REVIEW_REQUIRED");
      expect(decision.contactabilityStatus).toBe("REVIEW_REQUIRED");
    }
  });

  it("requires a non-empty company_name value", () => {
    const values = expectedHeaders.map(() => "");
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        code: "REQUIRED_VALUE_MISSING",
        field: "company_name",
      });
    }
  });

  it("rejects unknown enum values without guessing or rewriting them", () => {
    const values: string[] = expectedHeaders.map((header) =>
      header === "company_name" ? "Công ty giả" : "",
    );
    values[7] = "internet_search";
    const result = mapLeadRow(values, mappedHeaders());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        code: "ENUM_VALUE_NOT_ALLOWED",
        field: "source",
      });
    }
  });
});
