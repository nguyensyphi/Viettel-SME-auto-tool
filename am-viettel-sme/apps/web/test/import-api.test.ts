import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ImportPreview,
  ImportReviewChoice,
} from "@am-sme/database/import-workflow";
import {
  InMemoryImportApi,
  PREVIEW_TTL_MS,
  type ImportPreviewPort,
} from "../src/server/import-api.js";

const actor = { userId: "am-1", workspaceId: "workspace-1" };
const otherActor = { userId: "am-2", workspaceId: "workspace-1" };
const file = await readFile(
  new URL(
    "../../../packages/excel-import/templates/lead-import-template.xlsx",
    import.meta.url,
  ),
);

function makePreviewService(): ImportPreviewPort & {
  readonly calls: string[];
  readonly discarded: string[];
} {
  const calls: string[] = [];
  const discarded: string[] = [];
  const preview: ImportPreview = {
    previewId: "preview-1",
    headerInspection: {
      status: "READY",
      columnMap: [{ sourceColumnIndex: 1, targetField: "company_name" }],
      quarantinedColumns: [],
      errors: [],
      warnings: [],
    },
    rows: [],
    totalRows: 0,
    commitEligible: false,
    decisionStatus: "AWAITING_AM_REVIEW",
  };
  return {
    calls,
    discarded,
    previewWorkbook: () => {
      calls.push("preview");
      return { success: true, preview };
    },
    prepareReviewedCommit: (_input: {
      previewId: string;
      decisions: readonly ImportReviewChoice[];
    }) => {
      void _input;
      calls.push("approve");
      return {
        success: true,
        preparedCommitId: "prepared-1",
        summary: {
          totalRows: 0,
          rowsToKeep: 0,
          rowsToMerge: 0,
          rowsToSkip: 0,
          duplicateCandidateRows: 0,
        },
      };
    },
    commitPrepared: async () => {
      calls.push("commit");
      return { success: true, result: { status: "COMMITTED", jobId: "job-1" } };
    },
    discardPreview: (id) => {
      discarded.push(`preview:${id}`);
      return true;
    },
    discardPreparedCommit: (id) => {
      discarded.push(`prepared:${id}`);
      return true;
    },
  };
}

describe("P0.7 in-memory import API", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects malformed and oversized workbooks before creating a handle", () => {
    const api = new InMemoryImportApi(makePreviewService());
    expect(
      api.upload({
        actor,
        filename: "bad.xlsx",
        bytes: Buffer.from("not xlsx"),
      }),
    ).toMatchObject({ success: false, errorCode: "INVALID_XLSX_SIGNATURE" });
    expect(
      api.upload({
        actor,
        filename: "large.xlsx",
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).toMatchObject({ success: false, errorCode: "FILE_TOO_LARGE" });
  });

  it("requires a separate human review before commit and never crosses owner scope", async () => {
    const workflow = makePreviewService();
    const api = new InMemoryImportApi(workflow);
    const uploaded = api.upload({
      actor,
      filename: "synthetic.xlsx",
      bytes: file,
    });
    expect(uploaded.success).toBe(true);
    if (!uploaded.success) return;
    const handle = uploaded.value.handle;
    expect(api.get(otherActor, handle)).toMatchObject({
      success: false,
      errorCode: "IMPORT_NOT_FOUND",
    });
    const validated = api.validate({
      actor,
      handle,
      filename: "synthetic.xlsx",
      bytes: file,
      existingLeads: [],
    });
    expect(validated.success).toBe(true);
    expect(validated).toMatchObject({
      success: true,
      value: {
        handle,
        status: "VALIDATED",
        expiresAt: expect.any(String),
        preview: { previewId: "preview-1" },
      },
    });
    expect(workflow.calls).toEqual(["preview"]);
    expect(
      await api.commit({
        actor,
        handle,
        idempotencyKey: "test-idempotency-key-1",
      }),
    ).toMatchObject({ success: false, errorCode: "COMMIT_NOT_PREPARED" });
    const approved = api.approve({ actor, handle, decisions: [] });
    expect(approved.success).toBe(true);
    expect(workflow.calls).toEqual(["preview", "approve"]);
    const committed = await api.commit({
      actor,
      handle,
      idempotencyKey: "test-idempotency-key-1",
    });
    expect(committed.success).toBe(true);
    expect(workflow.calls).toEqual(["preview", "approve", "commit"]);
  });

  it("expires preview and prepared PII at the selected 30-minute boundary", () => {
    vi.useFakeTimers();
    const workflow = makePreviewService();
    const api = new InMemoryImportApi(workflow);
    const uploaded = api.upload({
      actor,
      filename: "synthetic.xlsx",
      bytes: file,
    });
    expect(uploaded.success).toBe(true);
    if (!uploaded.success) return;
    const handle = uploaded.value.handle;
    expect(
      api.validate({
        actor,
        handle,
        filename: "synthetic.xlsx",
        bytes: file,
        existingLeads: [],
      }).success,
    ).toBe(true);
    vi.advanceTimersByTime(PREVIEW_TTL_MS - 1);
    expect(api.get(actor, handle).success).toBe(true);
    vi.advanceTimersByTime(1);
    expect(api.get(actor, handle)).toMatchObject({
      success: false,
      errorCode: "PREVIEW_EXPIRED",
    });
    expect(workflow.discarded).toContain("preview:preview-1");
  });

  it("rejects an upload whose bytes change between inspection and validation", () => {
    const api = new InMemoryImportApi(makePreviewService());
    const uploaded = api.upload({
      actor,
      filename: "synthetic.xlsx",
      bytes: file,
    });
    expect(uploaded.success).toBe(true);
    if (!uploaded.success) return;
    expect(
      api.validate({
        actor,
        handle: uploaded.value.handle,
        filename: "synthetic.xlsx",
        bytes: Buffer.from("different"),
        existingLeads: [],
      }),
    ).toMatchObject({ success: false, errorCode: "UPLOAD_CHECKSUM_MISMATCH" });
  });
});
