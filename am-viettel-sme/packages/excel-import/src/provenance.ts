import {
  evaluateImportedProvenance,
  type ConsentEvidenceInput,
  type ConsentStatus,
  type ContactabilityStatus,
  type ImportProvenanceAssessment,
  type ImportSuppressionInstruction,
} from "@am-sme/domain/contactability";
import type { MappedLeadDraft } from "./index.js";

export type { ConsentEvidenceInput, ImportProvenanceAssessment };

export interface AssessedImportProvenance extends ImportProvenanceAssessment {
  provenance: {
    source: MappedLeadDraft["source"];
    sourceUrl: MappedLeadDraft["source_url"];
    lawfulContactBasis: MappedLeadDraft["lawful_contact_basis"];
    origin: "MAPPED_FROM_WORKBOOK";
  };
}

export type ProvenanceLeadDraft = Omit<
  MappedLeadDraft,
  "consent_status" | "contactability_status"
> & {
  consent_status: ConsentStatus;
  contactability_status: ContactabilityStatus;
};

/**
 * Assess only explicit workbook values and separately supplied consent proof.
 * This function performs no persistence, task creation, or contact enqueue.
 */
export function assessImportProvenance(
  lead: MappedLeadDraft,
  consentEvidence?: ConsentEvidenceInput,
): AssessedImportProvenance {
  const assessment = evaluateImportedProvenance({
    source: lead.source,
    sourceUrl: lead.source_url,
    lawfulContactBasis: lead.lawful_contact_basis,
    consentStatus: lead.consent_status,
    ...(consentEvidence ? { consentEvidence } : {}),
  });

  return {
    ...assessment,
    provenance: {
      source: lead.source,
      sourceUrl: lead.source_url,
      lawfulContactBasis: lead.lawful_contact_basis,
      origin: "MAPPED_FROM_WORKBOOK",
    },
  };
}

export interface ImportProvenanceCommitCommand {
  /** Effective gated statuses, never the raw consent value alone. */
  lead: ProvenanceLeadDraft;
  decision: AssessedImportProvenance;
  suppression: ImportSuppressionInstruction | null;
  audit: {
    eventType: "IMPORT_PROVENANCE_ASSESSED";
    reviewReasons: readonly string[];
    suppressionRequested: boolean;
  };
}

/**
 * Repository boundary for a later persistence adapter. A concrete adapter must
 * persist lead, any suppression, and audit in one DB transaction. There is no
 * DB import implementation in P0.3c; this port does not emulate one.
 */
export interface ImportProvenanceRepository {
  persistAtomically(command: ImportProvenanceCommitCommand): Promise<void>;
}

/**
 * Send one aggregate command across the repository boundary. Audit metadata is
 * limited to reason codes and suppression intent; raw lead fields are excluded.
 */
export async function recordImportProvenance(
  repository: ImportProvenanceRepository,
  lead: MappedLeadDraft,
  decision: AssessedImportProvenance,
): Promise<void> {
  const effectiveLead: ProvenanceLeadDraft = {
    ...lead,
    consent_status: decision.consentStatus,
    contactability_status: decision.contactabilityStatus,
  };

  await repository.persistAtomically({
    lead: effectiveLead,
    decision,
    suppression: decision.suppression,
    audit: {
      eventType: "IMPORT_PROVENANCE_ASSESSED",
      reviewReasons: decision.reviewReasons,
      suppressionRequested: decision.suppression !== null,
    },
  });
}
