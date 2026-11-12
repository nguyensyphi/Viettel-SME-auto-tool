import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_XLSX_PARSER_LIMITS,
  inspectHeaders,
  parseXlsxWorkbook,
  validateColumnMapping,
  type ColumnMappingEntry,
  type DeduplicationLead,
  type HeaderInspection,
} from "@am-sme/excel-import";
import type {
  CommitImportWorkflowContext,
  ImportPreview,
  ImportPreviewResult,
  ImportReviewChoice,
  PreparedImportSummary,
} from "@am-sme/database/import-workflow";

export const PREVIEW_TTL_MS = 30 * 60 * 1000;

export interface ImportActor {
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ImportPreviewPort {
  previewWorkbook(input: {
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly existingLeads: readonly (DeduplicationLead & {
      readonly id: string;
    })[];
    readonly mapping?: readonly ColumnMappingEntry[];
  }): ImportPreviewResult;
  prepareReviewedCommit(input: {
    readonly previewId: string;
    readonly decisions: readonly ImportReviewChoice[];
    readonly confirmIgnoredColumns?: boolean;
  }):
    | {
        readonly success: true;
        readonly preparedCommitId: string;
        readonly summary: PreparedImportSummary;
      }
    | {
        readonly success: false;
        readonly errorCode: string;
        readonly rowNumber?: number;
      };
  commitPrepared(
    preparedCommitId: string,
    context: CommitImportWorkflowContext,
  ): Promise<unknown>;
  discardPreview(previewId: string): boolean;
  discardPreparedCommit(preparedCommitId: string): boolean;
}

export interface ImportHandleView {
  readonly handle: string;
  readonly status:
    "UPLOADED" | "VALIDATED" | "APPROVED" | "COMMITTED" | "EXPIRED";
  readonly expiresAt: string | null;
  readonly headers?: readonly {
    readonly index: number;
    readonly name: string | null;
  }[];
  readonly suggestedMapping?: readonly ColumnMappingEntry[];
  readonly headerInspection?: HeaderInspection;
  readonly preview?: ImportPreview;
  readonly summary?: PreparedImportSummary;
  readonly commitResult?: unknown;
}

interface ImportState {
  readonly handle: string;
  readonly ownerUserId: string;
  readonly workspaceId: string;
  readonly checksum: string;
  readonly filename: string;
  readonly headers: readonly unknown[];
  readonly originalInspection: HeaderInspection;
  mapping: readonly ColumnMappingEntry[];
  status: ImportHandleView["status"];
  previewId: string | null;
  preview: ImportPreview | null;
  preparedCommitId: string | null;
  summary: PreparedImportSummary | null;
  commitResult: unknown;
  expiresAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export type ImportApiResult<T> =
  | { readonly success: true; readonly value: T }
  | {
      readonly success: false;
      readonly errorCode: string;
      readonly rowNumber?: number;
    };

export class InMemoryImportApi {
  private readonly imports = new Map<string, ImportState>();
  private readonly expired = new Map<string, number>();

  constructor(
    private readonly workflow: ImportPreviewPort,
    private readonly options: {
      readonly now?: () => number;
      readonly ttlMs?: number;
      readonly maxFileBytes?: number;
    } = {},
  ) {}

  upload(input: {
    readonly actor: ImportActor;
    readonly filename: string;
    readonly bytes: Uint8Array;
  }): ImportApiResult<ImportHandleView> {
    this.cleanupExpired();
    if (!input.filename.toLowerCase().endsWith(".xlsx")) {
      return { success: false, errorCode: "FILE_EXTENSION_NOT_ALLOWED" };
    }
    const maxBytes =
      this.options.maxFileBytes ?? DEFAULT_XLSX_PARSER_LIMITS.maxFileBytes;
    if (input.bytes.byteLength > maxBytes) {
      return { success: false, errorCode: "FILE_TOO_LARGE" };
    }
    const activeCount = [...this.imports.values()].filter(
      (state) => state.status !== "COMMITTED",
    ).length;
    if (activeCount >= 10) {
      return { success: false, errorCode: "ACTIVE_IMPORT_LIMIT_REACHED" };
    }
    const parsed = parseXlsxWorkbook(input.filename, input.bytes);
    if (!parsed.success) return { success: false, errorCode: parsed.errorCode };
    const headerInspection = inspectHeaders(parsed.headers);
    if (headerInspection.status === "INVALID") {
      return { success: false, errorCode: "HEADER_MAPPING_INVALID" };
    }
    const handle = randomUUID();
    const state: ImportState = {
      handle,
      ownerUserId: input.actor.userId,
      workspaceId: input.actor.workspaceId,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      filename: "upload.xlsx",
      headers: [...parsed.headers],
      originalInspection: structuredClone(headerInspection),
      mapping: [...headerInspection.columnMap],
      status: "UPLOADED",
      previewId: null,
      preview: null,
      preparedCommitId: null,
      summary: null,
      commitResult: null,
      expiresAt: this.now() + (this.options.ttlMs ?? PREVIEW_TTL_MS),
      timer: null,
    };
    this.imports.set(handle, state);
    state.timer = setTimeout(
      () => this.expire(state),
      this.options.ttlMs ?? PREVIEW_TTL_MS,
    );
    state.timer.unref?.();
    return {
      success: true,
      value: this.view(state),
    };
  }

  setMapping(
    actor: ImportActor,
    handle: string,
    mapping: readonly ColumnMappingEntry[],
  ): ImportApiResult<ImportHandleView> {
    const state = this.stateFor(actor, handle);
    if (!state) return this.missing(handle);
    if (state.status !== "UPLOADED")
      return { success: false, errorCode: "IMPORT_STATE_INVALID" };
    const validated = validateColumnMapping(mapping);
    if (
      validated.status !== "READY" ||
      validated.columnMap.some(
        ({ sourceColumnIndex }) =>
          sourceColumnIndex >= state.headers.length ||
          typeof state.headers[sourceColumnIndex] !== "string" ||
          !state.headers[sourceColumnIndex]?.trim(),
      )
    ) {
      return { success: false, errorCode: "HEADER_MAPPING_INVALID" };
    }
    state.mapping = validated.columnMap;
    return { success: true, value: this.view(state) };
  }

  validate(input: {
    readonly actor: ImportActor;
    readonly handle: string;
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly existingLeads: readonly (DeduplicationLead & {
      readonly id: string;
    })[];
  }): ImportApiResult<ImportHandleView> {
    const state = this.stateFor(input.actor, input.handle);
    if (!state) return this.missing(input.handle);
    if (state.status !== "UPLOADED")
      return { success: false, errorCode: "IMPORT_STATE_INVALID" };
    if (
      input.bytes.byteLength >
      (this.options.maxFileBytes ?? DEFAULT_XLSX_PARSER_LIMITS.maxFileBytes)
    ) {
      return { success: false, errorCode: "FILE_TOO_LARGE" };
    }
    const checksum = createHash("sha256").update(input.bytes).digest("hex");
    if (checksum !== state.checksum)
      return { success: false, errorCode: "UPLOAD_CHECKSUM_MISMATCH" };
    const result = this.workflow.previewWorkbook({
      filename: input.filename,
      bytes: input.bytes,
      existingLeads: input.existingLeads,
      mapping: state.mapping,
    });
    if (!result.success) return { success: false, errorCode: result.errorCode };
    state.previewId = result.preview.previewId;
    state.preview = result.preview;
    state.status = "VALIDATED";
    this.clearTimer(state);
    state.expiresAt = this.now() + (this.options.ttlMs ?? PREVIEW_TTL_MS);
    state.timer = setTimeout(
      () => this.expire(state),
      this.options.ttlMs ?? PREVIEW_TTL_MS,
    );
    state.timer.unref?.();
    return { success: true, value: this.view(state) };
  }

  approve(input: {
    readonly actor: ImportActor;
    readonly handle: string;
    readonly decisions: readonly ImportReviewChoice[];
    readonly confirmIgnoredColumns?: boolean;
  }): ImportApiResult<{ readonly summary: PreparedImportSummary }> {
    const state = this.stateFor(input.actor, input.handle);
    if (!state) return this.missing(input.handle);
    if (state.status !== "VALIDATED" || !state.previewId) {
      return { success: false, errorCode: "IMPORT_STATE_INVALID" };
    }
    const result = this.workflow.prepareReviewedCommit({
      previewId: state.previewId,
      decisions: input.decisions,
      ...(input.confirmIgnoredColumns === undefined
        ? {}
        : { confirmIgnoredColumns: input.confirmIgnoredColumns }),
    });
    if (!result.success) {
      return {
        success: false,
        errorCode: result.errorCode,
        ...(result.rowNumber === undefined
          ? {}
          : { rowNumber: result.rowNumber }),
      };
    }
    state.preview = null;
    state.previewId = null;
    state.preparedCommitId = result.preparedCommitId;
    state.summary = result.summary;
    state.status = "APPROVED";
    return { success: true, value: { summary: result.summary } };
  }

  async commit(input: {
    readonly actor: ImportActor;
    readonly handle: string;
    readonly idempotencyKey: string;
  }): Promise<ImportApiResult<unknown>> {
    const state = this.stateFor(input.actor, input.handle);
    if (!state) return this.missing(input.handle);
    if (state.status === "COMMITTED")
      return { success: true, value: state.commitResult };
    if (state.status !== "APPROVED" || !state.preparedCommitId) {
      return { success: false, errorCode: "COMMIT_NOT_PREPARED" };
    }
    if (!/^[\x21-\x7e]{8,128}$/u.test(input.idempotencyKey)) {
      return { success: false, errorCode: "IDEMPOTENCY_KEY_REQUIRED" };
    }
    const result = await this.workflow.commitPrepared(state.preparedCommitId, {
      workspaceId: state.workspaceId,
      actorId: input.actor.userId,
      uploaderUserId: state.ownerUserId,
      idempotencyKey: input.idempotencyKey,
    });
    state.commitResult = result;
    const succeeded =
      typeof result === "object" &&
      result !== null &&
      "success" in result &&
      result.success === true;
    if (succeeded) {
      state.status = "COMMITTED";
      this.clearTimer(state);
      state.expiresAt = this.now() + (this.options.ttlMs ?? PREVIEW_TTL_MS);
      state.preview = null;
      state.summary = null;
      state.preparedCommitId = null;
      state.timer = setTimeout(
        () => this.expire(state),
        this.options.ttlMs ?? PREVIEW_TTL_MS,
      );
      state.timer.unref?.();
    }
    return { success: true, value: result };
  }

  get(actor: ImportActor, handle: string): ImportApiResult<ImportHandleView> {
    const state = this.stateFor(actor, handle);
    if (!state) return this.missing(handle);
    return { success: true, value: this.view(state) };
  }

  dispose(): void {
    for (const state of this.imports.values()) {
      this.clearTimer(state);
      if (state.previewId) this.workflow.discardPreview(state.previewId);
      if (state.preparedCommitId)
        this.workflow.discardPreparedCommit(state.preparedCommitId);
    }
    this.imports.clear();
    this.expired.clear();
  }

  private view(state: ImportState): ImportHandleView {
    return {
      handle: state.handle,
      status: state.status,
      expiresAt:
        state.expiresAt === null
          ? null
          : new Date(state.expiresAt).toISOString(),
      ...(state.status !== "COMMITTED"
        ? {
            headers: state.headers.map((header, index) => ({
              index,
              name: typeof header === "string" ? header : null,
            })),
            suggestedMapping: state.mapping,
            headerInspection:
              state.preview?.headerInspection ?? state.originalInspection,
          }
        : {}),
      ...(state.preview ? { preview: state.preview } : {}),
      ...(state.summary ? { summary: state.summary } : {}),
      ...(state.commitResult === null
        ? {}
        : { commitResult: state.commitResult }),
    };
  }

  private stateFor(actor: ImportActor, handle: string): ImportState | null {
    this.cleanupExpired();
    const state = this.imports.get(handle);
    if (
      !state ||
      state.ownerUserId !== actor.userId ||
      state.workspaceId !== actor.workspaceId
    ) {
      return null;
    }
    if (state.expiresAt !== null && this.now() >= state.expiresAt) {
      this.expire(state);
      return null;
    }
    return state;
  }

  private missing(handle: string): ImportApiResult<never> {
    this.cleanupExpired();
    return this.expired.has(handle)
      ? { success: false, errorCode: "PREVIEW_EXPIRED" }
      : { success: false, errorCode: "IMPORT_NOT_FOUND" };
  }

  private expire(state: ImportState): void {
    if (this.imports.get(state.handle) !== state) return;
    if (state.previewId) this.workflow.discardPreview(state.previewId);
    if (state.preparedCommitId)
      this.workflow.discardPreparedCommit(state.preparedCommitId);
    this.clearTimer(state);
    state.preview = null;
    state.previewId = null;
    state.preparedCommitId = null;
    state.summary = null;
    state.commitResult = null;
    state.status = "EXPIRED";
    this.imports.delete(state.handle);
    this.expired.set(state.handle, this.now() + 5 * 60 * 1000);
  }

  private clearTimer(state: ImportState): void {
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [handle, expiresAt] of this.expired) {
      if (expiresAt <= now) this.expired.delete(handle);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
