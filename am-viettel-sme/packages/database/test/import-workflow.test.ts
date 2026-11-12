import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  LEAD_IMPORT_FIELDS,
  type DeduplicationLead,
} from "@am-sme/excel-import";
import {
  ImportPreviewService,
  type CommitImportWorkflowContext,
} from "../src/import-workflow.js";
import type {
  CommitImportInput,
  CommitImportResult,
  CreateImportJobInput,
  CreateImportJobResult,
  ImportCommitRepository,
} from "../src/import-commit.js";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: readonly { name: string; xml: string }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.xml);
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    local.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, eocd]);
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function syntheticWorkbook(
  rowValues: readonly (readonly string[])[],
  headerOverrides: readonly string[] = LEAD_IMPORT_FIELDS,
): Buffer {
  const allRows = [headerOverrides, ...rowValues];
  const sheetData = allRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowNumber}" t="inlineStr"><is><t>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</t></is></c>`,
        )
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  return zip([
    {
      name: "[Content_Types].xml",
      xml: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    },
    {
      name: "xl/workbook.xml",
      xml: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1" state="visible"/></sheets></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: "xl/worksheets/sheet1.xml",
      xml: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
    },
  ]);
}

function row(
  overrides: Partial<Record<(typeof LEAD_IMPORT_FIELDS)[number], string>>,
): string[] {
  return LEAD_IMPORT_FIELDS.map((field) =>
    field === "company_name"
      ? (overrides.company_name ?? "Công ty Tổng hợp")
      : (overrides[field] ?? ""),
  );
}

function existingLead(
  values: Partial<DeduplicationLead> & { id: string },
): DeduplicationLead & { id: string } {
  return {
    id: values.id,
    companyName: values.companyName ?? "Doanh nghiệp mẫu",
    contactName: values.contactName ?? "Nguyễn Văn A",
    district: values.district ?? "Dĩ An",
    phoneNormalized: values.phoneNormalized ?? null,
    emailNormalized: values.emailNormalized ?? null,
    consentStatus: values.consentStatus ?? "UNKNOWN",
    contactabilityStatus: values.contactabilityStatus ?? "UNKNOWN",
  };
}

function fakeRepository() {
  const calls: { jobs: CreateImportJobInput[]; commits: CommitImportInput[] } =
    {
      jobs: [],
      commits: [],
    };
  const repository = {
    createJob: vi.fn(
      async (input: CreateImportJobInput): Promise<CreateImportJobResult> => {
        calls.jobs.push(input);
        return {
          success: true,
          jobId: "00000000-0000-4000-8000-000000000001",
          reused: false,
        };
      },
    ),
    commit: vi.fn(
      async (input: CommitImportInput): Promise<CommitImportResult> => {
        calls.commits.push(input);
        return {
          success: true,
          status: "COMMITTED",
          jobId: input.jobId,
          rowsCommitted: input.rows.filter(
            (item) => item.disposition !== "SKIP",
          ).length,
          rowsSkipped: input.rows.filter((item) => item.disposition === "SKIP")
            .length,
          alreadyCommitted: false,
        };
      },
    ),
  } as unknown as ImportCommitRepository;
  return { repository, calls };
}

const commitContext: CommitImportWorkflowContext = {
  workspaceId: "00000000-0000-4000-8000-000000000010",
  actorId: "00000000-0000-4000-8000-000000000011",
  uploaderUserId: "00000000-0000-4000-8000-000000000011",
  idempotencyKey: "synthetic-import-001",
};

describe("P0.3d in-memory import preview and reviewed commit", () => {
  it("maps, normalizes, assesses provenance, returns masked exact/fuzzy candidates, and writes nothing on preview", () => {
    const { repository, calls } = fakeRepository();
    const service = new ImportPreviewService(repository);
    const bytes = syntheticWorkbook([
      row({
        company_name: "  Công ty   TỔNG HỢP  ",
        phone: "0901234567",
        email: "sales@example.test",
        district: "Dĩ An",
      }),
      row({
        company_name: "Doanh nghiệp mẫu",
        phone: "0907654321",
        district: "Dĩ An",
      }),
      row({
        company_name: "Công ty rút lại",
        consent_status: "OPTED_OUT",
        phone: "0912345678",
      }),
    ]);
    const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = service.previewWorkbook({
      filename: "synthetic.xlsx",
      bytes,
      existingLeads: [
        existingLead({ id: "existing-exact", phoneNormalized: "0901234567" }),
        existingLead({
          id: "existing-fuzzy",
          companyName: "Doanh nghiệp mẫu",
          district: "Dĩ An",
        }),
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.preview.commitEligible).toBe(false);
    expect(result.preview.decisionStatus).toBe("AWAITING_AM_REVIEW");
    expect(result.preview.rows.map((item) => item.status)).toEqual([
      "READY",
      "READY",
      "READY",
    ]);
    expect(result.preview.rows[0]?.companyName).toBe("Công ty TỔNG HỢP");
    expect(result.preview.rows[0]?.stage).toBe("PENDING_REVIEW");
    expect(result.preview.rows[0]?.contact.phoneMasked).not.toBe("0901234567");
    expect(result.preview.rows[0]?.contact.emailMasked).not.toBe(
      "sales@example.test",
    );
    expect(result.preview.rows[0]).toMatchObject({
      consentStatus: "UNKNOWN",
      contactabilityStatus: "REVIEW_REQUIRED",
    });
    expect(
      result.preview.rows[0]?.duplicateReview?.candidates[0]?.matchTypes,
    ).toContain("EXACT_PHONE");
    expect(
      result.preview.rows[1]?.duplicateReview?.candidates[0]?.confidence,
    ).toBe("FUZZY");
    expect(result.preview.rows[2]).toMatchObject({
      consentStatus: "OPTED_OUT",
      contactabilityStatus: "SUPPRESSED",
      suppressionIntent: "ALL_CHANNELS",
    });
    const serialized = JSON.stringify(result.preview);
    expect(serialized).not.toContain("0901234567");
    expect(serialized).not.toContain("sales@example.test");
    expect(logs).not.toHaveBeenCalled();
    expect(calls.jobs).toHaveLength(0);
    expect(calls.commits).toHaveLength(0);
    logs.mockRestore();
  });

  it("keeps malformed rows visible as code-only errors and requires SKIP before preparing commit", async () => {
    const { repository, calls } = fakeRepository();
    const service = new ImportPreviewService(repository);
    const result = service.previewWorkbook({
      filename: "synthetic.xlsx",
      bytes: syntheticWorkbook([
        row({ company_name: "Bad phone row", phone: "not-a-phone" }),
        row({ company_name: "Good row", phone: "0901234567" }),
      ]),
      existingLeads: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.preview.rows[0]?.status).toBe("INVALID");
    expect(result.preview.rows[0]?.issues).toContainEqual({
      code: "PHONE_INVALID",
      field: "phone",
    });
    expect(
      service.prepareReviewedCommit({
        previewId: result.preview.previewId,
        decisions: [],
      }),
    ).toMatchObject({ success: false, errorCode: "ROW_DECISIONS_REQUIRED" });
    expect(
      service.prepareReviewedCommit({
        previewId: result.preview.previewId,
        decisions: [
          { rowNumber: 2, action: "KEEP" },
          { rowNumber: 3, action: "KEEP" },
        ],
      }),
    ).toMatchObject({
      success: false,
      errorCode: "ROW_ERRORS_UNRESOLVED",
      rowNumber: 2,
    });

    const prepared = service.prepareReviewedCommit({
      previewId: result.preview.previewId,
      decisions: [
        { rowNumber: 2, action: "SKIP" },
        { rowNumber: 3, action: "KEEP" },
      ],
    });
    expect(prepared).toMatchObject({
      success: true,
      commitEligible: true,
      summary: { totalRows: 2, rowsToKeep: 1, rowsToSkip: 1 },
    });
    expect(calls.jobs).toHaveLength(0);
    expect(calls.commits).toHaveLength(0);
    if (!prepared.success) return;

    const committed = await service.commitPrepared(
      prepared.preparedCommitId,
      commitContext,
    );
    expect(committed).toMatchObject({
      success: true,
      result: { status: "COMMITTED" },
    });
    expect(calls.jobs).toHaveLength(1);
    expect(calls.commits).toHaveLength(1);
    expect(calls.commits[0]?.rows.map((item) => item.disposition)).toEqual([
      "SKIP",
      "KEEP",
    ]);
    expect(calls.commits[0]?.rows[1]?.lead?.stage).toBe("PENDING_REVIEW");
  });

  it("requires explicit acknowledgement before ignoring unauthorized but non-identifier headers", () => {
    const { repository } = fakeRepository();
    const service = new ImportPreviewService(repository);
    const headers = [...LEAD_IMPORT_FIELDS, "legacy_code"];
    const result = service.previewWorkbook({
      filename: "synthetic.xlsx",
      bytes: syntheticWorkbook(
        [row({ company_name: "Company" }).concat("ignored")],
        headers,
      ),
      existingLeads: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.preview.headerInspection.status).toBe("NEEDS_REVIEW");
    expect(result.preview.headerInspection.columnMap).toHaveLength(
      LEAD_IMPORT_FIELDS.length,
    );
    expect(
      service.prepareReviewedCommit({
        previewId: result.preview.previewId,
        decisions: [{ rowNumber: 2, action: "KEEP" }],
      }),
    ).toMatchObject({
      success: false,
      errorCode: "QUARANTINED_COLUMNS_NOT_ACKNOWLEDGED",
    });
    expect(
      service.prepareReviewedCommit({
        previewId: result.preview.previewId,
        confirmIgnoredColumns: true,
        decisions: [{ rowNumber: 2, action: "KEEP" }],
      }),
    ).toMatchObject({ success: true, commitEligible: true });
  });

  it("rejects duplicate, missing, and personal-identifier headers without mapping them", () => {
    const { repository } = fakeRepository();
    const service = new ImportPreviewService(repository);
    const duplicateHeaders = [...LEAD_IMPORT_FIELDS, "PHONE"];
    expect(
      service.previewWorkbook({
        filename: "synthetic.xlsx",
        bytes: syntheticWorkbook(
          [row({ company_name: "Company" }).concat("")],
          duplicateHeaders,
        ),
        existingLeads: [],
      }),
    ).toMatchObject({ success: false, errorCode: "HEADER_MAPPING_INVALID" });

    const missingHeaders = LEAD_IMPORT_FIELDS.filter(
      (field) => field !== "company_name",
    );
    expect(
      service.previewWorkbook({
        filename: "synthetic.xlsx",
        bytes: syntheticWorkbook(
          [row({ company_name: "Company" }).slice(1)],
          missingHeaders,
        ),
        existingLeads: [],
      }),
    ).toMatchObject({ success: false, errorCode: "HEADER_MAPPING_INVALID" });

    const personalHeaders = [...LEAD_IMPORT_FIELDS, "CCCD"];
    const personalResult = service.previewWorkbook({
      filename: "synthetic.xlsx",
      bytes: syntheticWorkbook(
        [row({ company_name: "Company" }).concat("synthetic-id-123456")],
        personalHeaders,
      ),
      existingLeads: [],
    });
    expect(personalResult.success).toBe(true);
    if (personalResult.success) {
      expect(JSON.stringify(personalResult.preview)).not.toContain("synthetic-id-123456");
    }
  });

  it("validates merge targets as human decisions and does not call persistence during preparation", () => {
    const { repository, calls } = fakeRepository();
    const service = new ImportPreviewService(repository);
    const result = service.previewWorkbook({
      filename: "synthetic.xlsx",
      bytes: syntheticWorkbook([
        row({ company_name: "Company", phone: "0901234567" }),
      ]),
      existingLeads: [
        existingLead({ id: "candidate-1", phoneNormalized: "0901234567" }),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      service.prepareReviewedCommit({
        previewId: result.preview.previewId,
        decisions: [
          { rowNumber: 2, action: "MERGE", targetLeadId: "not-a-candidate" },
        ],
      }),
    ).toMatchObject({ success: false, errorCode: "REVIEW_DECISION_INVALID" });
    const prepared = service.prepareReviewedCommit({
      previewId: result.preview.previewId,
      decisions: [
        { rowNumber: 2, action: "MERGE", targetLeadId: "candidate-1" },
      ],
    });
    expect(prepared).toMatchObject({
      success: true,
      summary: { rowsToMerge: 1, duplicateCandidateRows: 1 },
    });
    expect(calls.jobs).toHaveLength(0);
    expect(calls.commits).toHaveLength(0);
  });
});
