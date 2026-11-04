import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "./normalization.js";

export {
  maskEmailForDisplay,
  maskPhoneForDisplay,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "./normalization.js";
export type {
  EmailNormalizationResult,
  NormalizedCompanyName,
  PhoneNormalizationResult,
} from "./normalization.js";
export {
  assessImportProvenance,
  recordImportProvenance,
} from "./provenance.js";
export type {
  AssessedImportProvenance,
  ConsentEvidenceInput,
  ImportProvenanceAssessment,
  ImportProvenanceCommitCommand,
  ImportProvenanceRepository,
  ProvenanceLeadDraft,
} from "./provenance.js";
export {
  createReviewDecision,
  findDuplicateCandidates,
} from "./deduplication.js";
export type {
  CreateReviewDecisionResult,
  DeduplicationLead,
  DeduplicationReviewDecision,
  DuplicateMatchType,
  DuplicateReviewCandidate,
  DuplicateReviewGroup,
  FindDuplicateCandidatesOptions,
  MaskedLeadSummary,
  MergeSafetySummary,
  ReviewDecisionRequest,
  TaxIdMatchAuthorization,
} from "./deduplication.js";

export const LEAD_IMPORT_FIELDS = [
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

export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number];
export const REQUIRED_LEAD_IMPORT_FIELDS = ["company_name"] as const;

export const LEAD_SOURCE_TYPES = [
  "AM_ENTERED",
  "CUSTOMER_REQUEST",
  "REFERRAL",
  "WEB_SOURCE",
  "IMPORTED",
  "OTHER",
] as const;
export type LeadSourceType = (typeof LEAD_SOURCE_TYPES)[number];

export const LAWFUL_CONTACT_BASES = [
  "UNKNOWN",
  "CUSTOMER_REQUEST",
  "EXISTING_RELATIONSHIP",
  "CONSENT_RECORDED",
  "OTHER_REVIEW_REQUIRED",
] as const;
export type LawfulContactBasis = (typeof LAWFUL_CONTACT_BASES)[number];

export const CONSENT_STATUSES = [
  "UNKNOWN",
  "REVIEW_REQUIRED",
  "ALLOWED_FOR_RECORDED_PURPOSE",
  "OPTED_OUT",
] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const NEW_LEAD_STAGE = "PENDING_REVIEW" as const;
export const FAIL_CLOSED_DEFAULTS = {
  lawful_contact_basis: "UNKNOWN",
  consent_status: "UNKNOWN",
  contactability_status: "UNKNOWN",
} as const;

const fieldSet: ReadonlySet<string> = new Set(LEAD_IMPORT_FIELDS);
const sourceSet: ReadonlySet<string> = new Set(LEAD_SOURCE_TYPES);
const lawfulBasisSet: ReadonlySet<string> = new Set(LAWFUL_CONTACT_BASES);
const consentStatusSet: ReadonlySet<string> = new Set(CONSENT_STATUSES);

export interface ColumnMappingEntry {
  readonly sourceColumnIndex: number;
  readonly targetField: LeadImportField;
}

export interface ImportIssue {
  readonly code: string;
  readonly field?: LeadImportField;
  readonly sourceColumnIndex?: number;
}

export type MappingStatus = "READY" | "NEEDS_REVIEW" | "BLOCKED" | "INVALID";

export interface ColumnMappingValidation {
  readonly status: "READY" | "INVALID";
  readonly columnMap: readonly ColumnMappingEntry[];
  readonly errors: readonly ImportIssue[];
}

export interface HeaderInspection {
  readonly status: MappingStatus;
  readonly columnMap: readonly ColumnMappingEntry[];
  readonly quarantinedColumns: readonly {
    readonly sourceColumnIndex: number;
    readonly classification: "UNSUPPORTED" | "PERSONAL_IDENTIFIER";
  }[];
  readonly errors: readonly ImportIssue[];
  readonly warnings: readonly ImportIssue[];
}

export interface MappedLeadDraft {
  readonly lead_id: string | null;
  readonly company_name: string;
  readonly company_name_match_key: string;
  readonly contact_name: string | null;
  readonly phone: string | null;
  readonly phone_status: "VALID" | "NEEDS_REVIEW" | null;
  readonly phone_normalized: string | null;
  readonly email: string | null;
  readonly email_normalized: string | null;
  readonly industry: string | null;
  readonly district: string | null;
  readonly source: LeadSourceType | null;
  readonly source_url: string | null;
  readonly lawful_contact_basis: LawfulContactBasis;
  readonly consent_status: ConsentStatus;
  readonly product_interest: string | null;
  readonly owner_am: string | null;
  readonly stage: typeof NEW_LEAD_STAGE;
  readonly last_contact_at: string | null;
  readonly next_action_at: string | null;
  readonly notes: string | null;
  /** Always UNKNOWN at this stage; workbook input cannot grant contact permission. */
  readonly contactability_status: "UNKNOWN";
}

export type LeadRowMappingResult =
  | { readonly success: true; readonly lead: MappedLeadDraft }
  | { readonly success: false; readonly errors: readonly ImportIssue[] };

function canonicalHeader(header: string): string {
  return header.normalize("NFC").trim().toLowerCase();
}

function classifyUnknownHeader(
  header: string,
): "UNSUPPORTED" | "PERSONAL_IDENTIFIER" {
  const folded = header
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const sensitiveMarkers = [
    "cmnd",
    "cccd",
    "chungminhnhan",
    "cancuoccongdan",
    "cancuoc",
    "personalid",
    "personalidentification",
    "identitycard",
    "identitynumber",
    "nationalid",
    "passport",
    "hochieu",
    "ngaycap",
    "noicap",
    "dateofissue",
    "issuedate",
    "placeofissue",
    "issuingplace",
    "ngaysinh",
    "dateofbirth",
    "birthdate",
    "dob",
  ];
  return sensitiveMarkers.some((marker) => folded.includes(marker))
    ? "PERSONAL_IDENTIFIER"
    : "UNSUPPORTED";
}

/**
 * Validate a manually supplied column map. Only the 17 approved target fields
 * can enter the mapped data, and each source/target may be used at most once.
 */
export function validateColumnMapping(
  entries: readonly {
    readonly sourceColumnIndex: number;
    readonly targetField: string;
  }[],
): ColumnMappingValidation {
  const errors: ImportIssue[] = [];
  const columnMap: ColumnMappingEntry[] = [];
  const seenSourceColumns = new Set<number>();
  const seenTargetFields = new Set<LeadImportField>();

  for (const entry of entries) {
    if (
      !Number.isInteger(entry.sourceColumnIndex) ||
      entry.sourceColumnIndex < 0
    ) {
      errors.push({ code: "INVALID_SOURCE_COLUMN_INDEX" });
      continue;
    }
    if (seenSourceColumns.has(entry.sourceColumnIndex)) {
      errors.push({
        code: "DUPLICATE_SOURCE_COLUMN",
        sourceColumnIndex: entry.sourceColumnIndex,
      });
      continue;
    }
    seenSourceColumns.add(entry.sourceColumnIndex);

    if (!fieldSet.has(entry.targetField)) {
      errors.push({
        code: "UNKNOWN_TARGET_FIELD",
        sourceColumnIndex: entry.sourceColumnIndex,
      });
      continue;
    }

    const targetField = entry.targetField as LeadImportField;
    if (seenTargetFields.has(targetField)) {
      errors.push({ code: "DUPLICATE_TARGET_FIELD", field: targetField });
      continue;
    }
    seenTargetFields.add(targetField);
    columnMap.push({ sourceColumnIndex: entry.sourceColumnIndex, targetField });
  }

  if (!seenTargetFields.has("company_name")) {
    errors.push({ code: "MISSING_REQUIRED_FIELD", field: "company_name" });
  }

  return {
    status: errors.length === 0 ? "READY" : "INVALID",
    columnMap,
    errors,
  };
}

/**
 * Match only exact allow-list field names (case-insensitive, surrounding-space
 * tolerant). Unknown columns are quarantined by index and never enter the map.
 * Personal-ID-like columns hard-block the workbook for manual cleanup/review.
 */
export function inspectHeaders(headers: readonly unknown[]): HeaderInspection {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const quarantinedColumns: HeaderInspection["quarantinedColumns"][number][] =
    [];
  const candidateMap: ColumnMappingEntry[] = [];
  const seenHeaders = new Set<string>();
  let hasPersonalIdentifierColumn = false;

  headers.forEach((rawHeader, sourceColumnIndex) => {
    if (typeof rawHeader !== "string" || rawHeader.trim() === "") {
      quarantinedColumns.push({
        sourceColumnIndex,
        classification: "UNSUPPORTED",
      });
      warnings.push({
        code: "EMPTY_OR_NON_TEXT_HEADER_IGNORED",
        sourceColumnIndex,
      });
      return;
    }

    const normalized = canonicalHeader(rawHeader);
    if (seenHeaders.has(normalized)) {
      errors.push({ code: "DUPLICATE_HEADER", sourceColumnIndex });
      return;
    }
    seenHeaders.add(normalized);

    if (fieldSet.has(normalized)) {
      candidateMap.push({
        sourceColumnIndex,
        targetField: normalized as LeadImportField,
      });
      return;
    }

    const classification = classifyUnknownHeader(rawHeader);
    quarantinedColumns.push({ sourceColumnIndex, classification });
    if (classification === "PERSONAL_IDENTIFIER") {
      hasPersonalIdentifierColumn = true;
      warnings.push({
        code: "PERSONAL_IDENTIFIER_COLUMN_BLOCKED",
        sourceColumnIndex,
      });
    } else {
      warnings.push({ code: "UNKNOWN_COLUMN_IGNORED", sourceColumnIndex });
    }
  });

  const validation = validateColumnMapping(candidateMap);
  errors.push(...validation.errors);
  const status: MappingStatus =
    errors.length > 0
      ? "INVALID"
      : hasPersonalIdentifierColumn
        ? "BLOCKED"
        : quarantinedColumns.length > 0
          ? "NEEDS_REVIEW"
          : "READY";

  return {
    status,
    columnMap: validation.columnMap,
    quarantinedColumns,
    errors,
    warnings,
  };
}

/** Map one row through the allow-list and P0.3b field-validation contracts. */
export function mapLeadRow(
  row: readonly unknown[],
  columnMap: readonly ColumnMappingEntry[],
): LeadRowMappingResult {
  const mappingValidation = validateColumnMapping(columnMap);
  if (mappingValidation.status !== "READY") {
    return { success: false, errors: mappingValidation.errors };
  }

  const values = new Map<LeadImportField, string | null>();
  const errors: ImportIssue[] = [];
  for (const {
    sourceColumnIndex,
    targetField,
  } of mappingValidation.columnMap) {
    const cell = row[sourceColumnIndex];
    if (
      cell === null ||
      cell === undefined ||
      (typeof cell === "string" && cell.trim() === "")
    ) {
      values.set(targetField, null);
      continue;
    }
    if (typeof cell !== "string") {
      errors.push({ code: "CELL_TYPE_MISMATCH", field: targetField });
      continue;
    }
    values.set(targetField, cell);
  }
  if (errors.length > 0) return { success: false, errors };

  const companyNameResult = normalizeCompanyName(
    values.get("company_name") ?? "",
  );
  const phoneResult = normalizePhone(values.get("phone"));
  const emailResult = normalizeEmail(values.get("email"));
  const fieldErrors: ImportIssue[] = [];
  if (companyNameResult.display === "") {
    fieldErrors.push({ code: "REQUIRED_VALUE_MISSING", field: "company_name" });
  }
  if (phoneResult.status === "INVALID") {
    fieldErrors.push({ code: phoneResult.errorCode, field: "phone" });
  }
  if (emailResult.status === "INVALID") {
    fieldErrors.push({ code: emailResult.errorCode, field: "email" });
  }
  if (fieldErrors.length > 0) return { success: false, errors: fieldErrors };

  const source = values.get("source") ?? null;
  if (source !== null && !sourceSet.has(source)) {
    return {
      success: false,
      errors: [{ code: "ENUM_VALUE_NOT_ALLOWED", field: "source" }],
    };
  }

  const lawfulBasisValue = values.get("lawful_contact_basis") ?? null;
  const lawfulBasis =
    lawfulBasisValue?.trim() || FAIL_CLOSED_DEFAULTS.lawful_contact_basis;
  if (!lawfulBasisSet.has(lawfulBasis)) {
    return {
      success: false,
      errors: [
        { code: "ENUM_VALUE_NOT_ALLOWED", field: "lawful_contact_basis" },
      ],
    };
  }

  const consentValue = values.get("consent_status") ?? null;
  const consentStatus =
    consentValue?.trim() || FAIL_CLOSED_DEFAULTS.consent_status;
  if (!consentStatusSet.has(consentStatus)) {
    return {
      success: false,
      errors: [{ code: "ENUM_VALUE_NOT_ALLOWED", field: "consent_status" }],
    };
  }

  const stageValue = values.get("stage")?.trim() ?? "";
  if (stageValue !== "" && stageValue !== NEW_LEAD_STAGE) {
    return {
      success: false,
      errors: [{ code: "NEW_LEAD_STAGE_NOT_ALLOWED", field: "stage" }],
    };
  }

  const leadId = values.get("lead_id")?.trim() || null;
  const mapped: MappedLeadDraft = {
    lead_id: leadId,
    company_name: companyNameResult.display,
    company_name_match_key: companyNameResult.matchKey,
    contact_name: values.get("contact_name") ?? null,
    phone: phoneResult.value,
    phone_status:
      phoneResult.status === "VALID" || phoneResult.status === "NEEDS_REVIEW"
        ? phoneResult.status
        : null,
    phone_normalized: phoneResult.normalizedKey,
    email: emailResult.value,
    email_normalized: emailResult.normalizedKey,
    industry: values.get("industry") ?? null,
    district: values.get("district") ?? null,
    source: source as LeadSourceType | null,
    source_url: values.get("source_url") ?? null,
    lawful_contact_basis: lawfulBasis as LawfulContactBasis,
    consent_status: consentStatus as ConsentStatus,
    product_interest: values.get("product_interest") ?? null,
    owner_am: values.get("owner_am") ?? null,
    stage: NEW_LEAD_STAGE,
    last_contact_at: values.get("last_contact_at") ?? null,
    next_action_at: values.get("next_action_at") ?? null,
    notes: values.get("notes") ?? null,
    contactability_status: FAIL_CLOSED_DEFAULTS.contactability_status,
  };

  return { success: true, lead: mapped };
}

export { DEFAULT_XLSX_PARSER_LIMITS, parseXlsxWorkbook } from "./workbook.js";
export type {
  ParsedWorkbookRow,
  ParsedXlsxWorkbook,
  XlsxParseErrorCode,
  XlsxParseFailure,
  XlsxParseResult,
  XlsxParserLimits,
} from "./workbook.js";
