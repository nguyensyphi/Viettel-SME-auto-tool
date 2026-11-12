import { createHash, randomUUID } from "node:crypto";
import {
  createReviewDecision,
  assessImportProvenance,
  type ConsentEvidenceInput,
  type ColumnMappingEntry,
  type DeduplicationLead,
  type DuplicateReviewGroup,
  type ImportIssue,
  type MappedLeadDraft,
  type ReviewDecisionRequest,
  inspectHeaders,
  mapLeadRow,
  validateColumnMapping,
  maskEmailForDisplay,
  maskPhoneForDisplay,
  parseXlsxWorkbook,
  type HeaderInspection,
  type ParsedWorkbookRow,
  type ParsedXlsxWorkbook,
  type XlsxParserLimits,
  type XlsxParseErrorCode,
} from "@am-sme/excel-import";
import {
  createImportReviewGroup,
  type CommitImportResult,
  type CreateImportJobResult,
  type ImportCommitRepository,
  type ImportCommitRow,
} from "./import-commit.js";

export type ImportReviewChoice =
  | { readonly rowNumber: number; readonly action: "KEEP" }
  | { readonly rowNumber: number; readonly action: "SKIP" }
  | {
      readonly rowNumber: number;
      readonly action: "MERGE";
      readonly targetLeadId: string;
    };

export interface ImportPreviewRow {
  readonly rowNumber: number;
  readonly status: "READY" | "INVALID";
  readonly companyName: string | null;
  readonly stage: "PENDING_REVIEW" | null;
  readonly contact: {
    readonly phoneMasked: string | null;
    readonly emailMasked: string | null;
  };
  readonly issues: readonly ImportIssue[];
  readonly consentStatus: string | null;
  readonly contactabilityStatus: string | null;
  readonly provenanceReviewReasons: readonly string[];
  readonly suppressionIntent: "ALL_CHANNELS" | null;
  readonly duplicateReview: DuplicateReviewGroup | null;
  /** Every row stays PENDING_REVIEW and requires an explicit AM decision. */
  readonly humanDecisionRequired: true;
}

export interface ImportPreview {
  readonly previewId: string;
  readonly headerInspection: HeaderInspection;
  readonly rows: readonly ImportPreviewRow[];
  readonly totalRows: number;
  /** False until a separate human review has resolved every row. */
  readonly commitEligible: false;
  readonly decisionStatus: "AWAITING_AM_REVIEW";
}

export type ImportPreviewResult =
  | { readonly success: true; readonly preview: ImportPreview }
  | {
      readonly success: false;
      readonly errorCode:
        | XlsxParseErrorCode
        | "ACTIVE_IMPORT_LIMIT_REACHED"
        | "HEADER_MAPPING_INVALID"
        | "PERSONAL_IDENTIFIER_COLUMN_BLOCKED";
      readonly headerInspection?: HeaderInspection;
    };

export interface PrepareReviewedCommitInput {
  readonly previewId: string;
  readonly decisions: readonly ImportReviewChoice[];
  /** Explicitly confirms that quarantined non-allow-listed columns are ignored. */
  readonly confirmIgnoredColumns?: boolean;
}

export interface PreparedImportSummary {
  readonly totalRows: number;
  readonly rowsToKeep: number;
  readonly rowsToMerge: number;
  readonly rowsToSkip: number;
  readonly duplicateCandidateRows: number;
}

export type PrepareReviewedCommitResult =
  | {
      readonly success: true;
      readonly preparedCommitId: string;
      readonly commitEligible: true;
      readonly summary: PreparedImportSummary;
    }
  | {
      readonly success: false;
      readonly errorCode:
        | "PREVIEW_NOT_FOUND"
        | "ACTIVE_IMPORT_LIMIT_REACHED"
        | "QUARANTINED_COLUMNS_NOT_ACKNOWLEDGED"
        | "NO_IMPORT_ROWS"
        | "ROW_DECISIONS_REQUIRED"
        | "DUPLICATE_ROW_DECISION"
        | "UNKNOWN_ROW_DECISION"
        | "ROW_ERRORS_UNRESOLVED"
        | "REVIEW_DECISION_INVALID";
      readonly rowNumber?: number;
      readonly decisionErrorCode?: string;
    };

export interface CommitImportWorkflowContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly uploaderUserId: string;
  readonly idempotencyKey: string;
}

export type CommitPreparedImportResult =
  | {
      readonly success: true;
      readonly result: Extract<CommitImportResult, { readonly success: true }>;
    }
  | {
      readonly success: false;
      readonly errorCode: string;
      readonly jobResult?: CreateImportJobResult;
      readonly result?: Extract<
        CommitImportResult,
        { readonly success: false }
      >;
    };

export interface ImportPreviewServiceOptions {
  readonly parserLimits?: Partial<XlsxParserLimits>;
  /** Bounds in-memory PII-bearing previews/prepared commits; there is no disk store. */
  readonly maxActiveImports?: number;
  readonly reviewGroupIdFactory?: (
    previewId: string,
    rowNumber: number,
  ) => string;
}

interface InternalPreviewRow {
  readonly rowNumber: number;
  readonly lead: MappedLeadDraft | null;
  readonly consentEvidence: ConsentEvidenceInput | undefined;
  readonly reviewGroup: DuplicateReviewGroup | null;
  readonly issues: readonly ImportIssue[];
  readonly publicRow: ImportPreviewRow;
}

interface InternalPreviewState {
  readonly previewId: string;
  readonly checksum: string;
  readonly totalRows: number;
  readonly headerInspection: HeaderInspection;
  readonly rows: readonly InternalPreviewRow[];
}

interface PreparedState {
  readonly commitRows: readonly ImportCommitRow[];
  readonly totalRows: number;
  readonly checksum: string;
}

const DEFAULT_MAX_ACTIVE_IMPORTS = 10;

function getCell(
  row: ParsedWorkbookRow,
  headerInspection: HeaderInspection,
  field: "phone" | "email",
): unknown {
  const mapping = headerInspection.columnMap.find(
    (entry) => entry.targetField === field,
  );
  return mapping ? row.values[mapping.sourceColumnIndex] : undefined;
}

function maskRawContact(
  value: unknown,
  kind: "phone" | "email",
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const display = typeof value === "string" ? value : String(value);
  return kind === "phone"
    ? maskPhoneForDisplay(display)
    : maskEmailForDisplay(display);
}

function previewRowForInvalid(
  row: ParsedWorkbookRow,
  headerInspection: HeaderInspection,
  issues: readonly ImportIssue[],
): InternalPreviewRow {
  return {
    rowNumber: row.rowNumber,
    lead: null,
    consentEvidence: undefined,
    reviewGroup: null,
    issues,
    publicRow: {
      rowNumber: row.rowNumber,
      status: "INVALID",
      companyName: null,
      stage: null,
      contact: {
        phoneMasked: maskRawContact(
          getCell(row, headerInspection, "phone"),
          "phone",
        ),
        emailMasked: maskRawContact(
          getCell(row, headerInspection, "email"),
          "email",
        ),
      },
      issues: [...issues],
      consentStatus: null,
      contactabilityStatus: null,
      provenanceReviewReasons: [],
      suppressionIntent: null,
      duplicateReview: null,
      humanDecisionRequired: true,
    },
  };
}

function isValidDecision(
  decision: ImportReviewChoice | undefined,
): decision is ImportReviewChoice {
  return Boolean(
    decision &&
    Number.isSafeInteger(decision.rowNumber) &&
    decision.rowNumber > 1 &&
    (decision.action === "KEEP" ||
      decision.action === "SKIP" ||
      (decision.action === "MERGE" &&
        typeof decision.targetLeadId === "string" &&
        decision.targetLeadId.trim() !== "")),
  );
}

function toReviewRequest(decision: ImportReviewChoice): ReviewDecisionRequest {
  if (decision.action === "MERGE") {
    return { action: "MERGE", targetLeadId: decision.targetLeadId };
  }
  return { action: decision.action };
}

/**
 * Orchestrates in-memory XLSX preview and P0.4b commit. Preview never calls the
 * database. Raw workbook bytes are not retained; mapped drafts are held only in
 * this service instance until discard or successful commit.
 */
export class ImportPreviewService {
  private readonly previews = new Map<string, InternalPreviewState>();
  private readonly prepared = new Map<string, PreparedState>();
  private readonly parserLimits: Partial<XlsxParserLimits>;
  private readonly maxActiveImports: number;
  private readonly reviewGroupIdFactory: (
    previewId: string,
    rowNumber: number,
  ) => string;

  constructor(
    private readonly repository: ImportCommitRepository,
    options: ImportPreviewServiceOptions = {},
  ) {
    this.parserLimits = options.parserLimits ?? {};
    this.maxActiveImports =
      options.maxActiveImports ?? DEFAULT_MAX_ACTIVE_IMPORTS;
    this.reviewGroupIdFactory =
      options.reviewGroupIdFactory ??
      ((previewId, rowNumber) => `${previewId}:row:${rowNumber}`);
  }

  previewWorkbook(input: {
    readonly filename: string;
    readonly bytes: Uint8Array;
    readonly existingLeads: readonly (DeduplicationLead & {
      readonly id: string;
    })[];
    readonly mapping?: readonly ColumnMappingEntry[];
    readonly consentEvidenceByRowNumber?: Readonly<
      Record<number, ConsentEvidenceInput>
    >;
  }): ImportPreviewResult {
    if (this.activeCount() >= this.maxActiveImports) {
      return { success: false, errorCode: "ACTIVE_IMPORT_LIMIT_REACHED" };
    }
    const parsed = parseXlsxWorkbook(
      input.filename,
      input.bytes,
      this.parserLimits,
    );
    if (!parsed.success) {
      return { success: false, errorCode: parsed.errorCode };
    }

    return this.previewParsedWorkbook({
      parsed,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      existingLeads: input.existingLeads,
      ...(input.mapping ? { mapping: input.mapping } : {}),
      ...(input.consentEvidenceByRowNumber
        ? { consentEvidenceByRowNumber: input.consentEvidenceByRowNumber }
        : {}),
    });
  }

  /** Accepts parser output from a private API staging flow; workbook bytes are never retained. */
  previewParsedWorkbook(input: {
    readonly parsed: ParsedXlsxWorkbook;
    readonly checksum: string;
    readonly existingLeads: readonly (DeduplicationLead & {
      readonly id: string;
    })[];
    readonly mapping?: readonly ColumnMappingEntry[];
    readonly consentEvidenceByRowNumber?: Readonly<
      Record<number, ConsentEvidenceInput>
    >;
  }): ImportPreviewResult {
    if (this.activeCount() >= this.maxActiveImports) {
      return { success: false, errorCode: "ACTIVE_IMPORT_LIMIT_REACHED" };
    }

    const parsed = input.parsed;
    let headerInspection = inspectHeaders(parsed.headers);
    if (headerInspection.status === "INVALID") {
      return {
        success: false,
        errorCode: "HEADER_MAPPING_INVALID",
        headerInspection,
      };
    }
    if (input.mapping) {
      const validated = validateColumnMapping(input.mapping);
      if (
        validated.status !== "READY" ||
        validated.columnMap.some(
          ({ sourceColumnIndex }) =>
            sourceColumnIndex >= parsed.headers.length ||
            typeof parsed.headers[sourceColumnIndex] !== "string" ||
            !parsed.headers[sourceColumnIndex]?.trim(),
        )
      ) {
        return {
          success: false,
          errorCode: "HEADER_MAPPING_INVALID",
          headerInspection,
        };
      }
      const selected = new Set(
        validated.columnMap.map((entry) => entry.sourceColumnIndex),
      );
      const quarantinedColumns = parsed.headers.flatMap((header, index) =>
        selected.has(index)
          ? []
          : [
              {
                sourceColumnIndex: index,
                classification: (headerInspection.quarantinedColumns.find(
                  (column) => column.sourceColumnIndex === index,
                )?.classification ?? "UNSUPPORTED") as
                  "UNSUPPORTED" | "PERSONAL_IDENTIFIER",
              },
            ],
      );
      headerInspection = {
        status: quarantinedColumns.length > 0 ? "NEEDS_REVIEW" : "READY",
        columnMap: validated.columnMap,
        quarantinedColumns,
        errors: [],
        warnings: quarantinedColumns.map((column) => ({
          code: "COLUMN_IGNORED_BY_MAPPING",
          sourceColumnIndex: column.sourceColumnIndex,
        })),
      };
    }
    if (headerInspection.status === "INVALID") {
      return {
        success: false,
        errorCode: "HEADER_MAPPING_INVALID",
        headerInspection,
      };
    }

    const previewId = randomUUID();
    const internalRows: InternalPreviewRow[] = parsed.rows.map((row) => {
      const mapped = mapLeadRow(row.values, headerInspection.columnMap);
      const suppliedEvidence =
        input.consentEvidenceByRowNumber?.[row.rowNumber];
      const consentEvidence = suppliedEvidence
        ? structuredClone(suppliedEvidence)
        : undefined;
      if (!mapped.success) {
        return previewRowForInvalid(row, headerInspection, mapped.errors);
      }

      const provenance = assessImportProvenance(mapped.lead, consentEvidence);
      const reviewGroup = createImportReviewGroup(
        mapped.lead,
        input.existingLeads,
        {
          reviewGroupId: this.reviewGroupIdFactory(previewId, row.rowNumber),
        },
        consentEvidence,
      );
      const publicRow: ImportPreviewRow = {
        rowNumber: row.rowNumber,
        status: "READY",
        companyName: mapped.lead.company_name,
        stage: mapped.lead.stage,
        contact: {
          phoneMasked: reviewGroup.incoming.phone,
          emailMasked: reviewGroup.incoming.email,
        },
        issues: [],
        consentStatus: provenance.consentStatus,
        contactabilityStatus: provenance.contactabilityStatus,
        provenanceReviewReasons: [...provenance.reviewReasons],
        suppressionIntent: provenance.suppression ? "ALL_CHANNELS" : null,
        duplicateReview: structuredClone(reviewGroup),
        humanDecisionRequired: true,
      };
      return {
        rowNumber: row.rowNumber,
        lead: mapped.lead,
        consentEvidence,
        reviewGroup,
        issues: [],
        publicRow,
      };
    });

    const publicPreview: ImportPreview = {
      previewId,
      headerInspection: structuredClone(headerInspection),
      rows: internalRows.map((row) => row.publicRow),
      totalRows: internalRows.length,
      commitEligible: false,
      decisionStatus: "AWAITING_AM_REVIEW",
    };
    if (!/^[a-f0-9]{64}$/u.test(input.checksum)) {
      return { success: false, errorCode: "HEADER_MAPPING_INVALID" };
    }
    const state: InternalPreviewState = {
      previewId,
      checksum: input.checksum,
      totalRows: internalRows.length,
      headerInspection: structuredClone(headerInspection),
      rows: internalRows,
    };
    this.previews.set(previewId, state);
    return { success: true, preview: publicPreview };
  }

  prepareReviewedCommit(
    input: PrepareReviewedCommitInput,
  ): PrepareReviewedCommitResult {
    const state = this.previews.get(input.previewId);
    if (!state) return { success: false, errorCode: "PREVIEW_NOT_FOUND" };
    if (this.prepared.size >= this.maxActiveImports) {
      return { success: false, errorCode: "ACTIVE_IMPORT_LIMIT_REACHED" };
    }
    if (
      state.headerInspection.status === "NEEDS_REVIEW" &&
      input.confirmIgnoredColumns !== true
    ) {
      return {
        success: false,
        errorCode: "QUARANTINED_COLUMNS_NOT_ACKNOWLEDGED",
      };
    }
    if (state.rows.length === 0) {
      return { success: false, errorCode: "NO_IMPORT_ROWS" };
    }

    const decisions = new Map<number, ImportReviewChoice>();
    for (const decision of input.decisions) {
      if (!isValidDecision(decision)) {
        return { success: false, errorCode: "UNKNOWN_ROW_DECISION" };
      }
      if (decisions.has(decision.rowNumber)) {
        return {
          success: false,
          errorCode: "DUPLICATE_ROW_DECISION",
          rowNumber: decision.rowNumber,
        };
      }
      decisions.set(decision.rowNumber, decision);
    }
    if (decisions.size !== state.rows.length) {
      return { success: false, errorCode: "ROW_DECISIONS_REQUIRED" };
    }

    const commitRows: ImportCommitRow[] = [];
    let rowsToKeep = 0;
    let rowsToMerge = 0;
    let rowsToSkip = 0;
    let duplicateCandidateRows = 0;
    for (const row of state.rows) {
      const decision = decisions.get(row.rowNumber);
      if (!decision) {
        return { success: false, errorCode: "ROW_DECISIONS_REQUIRED" };
      }
      if (!row.lead) {
        if (decision.action !== "SKIP") {
          return {
            success: false,
            errorCode: "ROW_ERRORS_UNRESOLVED",
            rowNumber: row.rowNumber,
          };
        }
        commitRows.push({
          rowNumber: row.rowNumber,
          disposition: "SKIP",
          issues: row.issues,
        });
        rowsToSkip += 1;
        continue;
      }
      const reviewGroup = row.reviewGroup;
      if (!reviewGroup) {
        return {
          success: false,
          errorCode: "REVIEW_DECISION_INVALID",
          rowNumber: row.rowNumber,
        };
      }
      if (reviewGroup.candidates.length > 0) duplicateCandidateRows += 1;
      const request = toReviewRequest(decision);
      const checked = validateImportReviewDecision(reviewGroup, request);
      if (!checked.valid) {
        return {
          success: false,
          errorCode: "REVIEW_DECISION_INVALID",
          rowNumber: row.rowNumber,
          decisionErrorCode: checked.errorCode,
        };
      }
      commitRows.push({
        rowNumber: row.rowNumber,
        disposition: decision.action,
        lead: row.lead,
        ...(row.consentEvidence
          ? { consentEvidence: row.consentEvidence }
          : {}),
        reviewGroup,
        reviewRequest: request,
        issues: row.issues,
      });
      if (decision.action === "KEEP") rowsToKeep += 1;
      if (decision.action === "MERGE") rowsToMerge += 1;
      if (decision.action === "SKIP") rowsToSkip += 1;
    }

    const preparedCommitId = randomUUID();
    this.prepared.set(preparedCommitId, {
      commitRows,
      totalRows: state.totalRows,
      checksum: state.checksum,
    });
    this.previews.delete(input.previewId);
    return {
      success: true,
      preparedCommitId,
      commitEligible: true,
      summary: {
        totalRows: state.totalRows,
        rowsToKeep,
        rowsToMerge,
        rowsToSkip,
        duplicateCandidateRows,
      },
    };
  }

  async commitPrepared(
    preparedCommitId: string,
    context: CommitImportWorkflowContext,
  ): Promise<CommitPreparedImportResult> {
    const prepared = this.prepared.get(preparedCommitId);
    if (!prepared) {
      return { success: false, errorCode: "PREPARED_COMMIT_NOT_FOUND" };
    }
    if (context.actorId !== context.uploaderUserId) {
      return { success: false, errorCode: "IMPORT_ACTOR_MISMATCH" };
    }

    let job: CreateImportJobResult;
    try {
      job = await this.repository.createJob({
        workspaceId: context.workspaceId,
        uploaderUserId: context.uploaderUserId,
        idempotencyKey: context.idempotencyKey,
        fileChecksum: prepared.checksum,
        totalRows: prepared.totalRows,
      });
    } catch {
      return { success: false, errorCode: "IMPORT_JOB_CREATE_FAILED" };
    }
    if (!job.success) {
      return { success: false, errorCode: job.errorCode, jobResult: job };
    }

    let result: CommitImportResult;
    try {
      result = await this.repository.commit({
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        jobId: job.jobId,
        idempotencyKey: context.idempotencyKey,
        fileChecksum: prepared.checksum,
        rows: prepared.commitRows,
      });
    } catch {
      return { success: false, errorCode: "IMPORT_COMMIT_CALL_FAILED" };
    }
    if (result.success) {
      this.prepared.delete(preparedCommitId);
      return { success: true, result };
    }
    return { success: false, errorCode: result.errorCode, result };
  }

  discardPreview(previewId: string): boolean {
    return this.previews.delete(previewId);
  }

  discardPreparedCommit(preparedCommitId: string): boolean {
    return this.prepared.delete(preparedCommitId);
  }

  private activeCount(): number {
    return this.previews.size + this.prepared.size;
  }
}

function validateImportReviewDecision(
  group: DuplicateReviewGroup,
  request: ReviewDecisionRequest,
):
  | { readonly valid: true }
  | { readonly valid: false; readonly errorCode: string } {
  // Reuse P0.4a's public validation contract without allowing preview to persist.
  const result = createReviewDecision(group, request);
  return result.valid
    ? { valid: true }
    : { valid: false, errorCode: result.errorCode };
}
