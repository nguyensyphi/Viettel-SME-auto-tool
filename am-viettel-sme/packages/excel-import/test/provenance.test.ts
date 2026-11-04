import { describe, expect, it } from "vitest";
import {
  LEAD_IMPORT_FIELDS,
  inspectHeaders,
  mapLeadRow,
} from "../src/index.js";
import {
  assessImportProvenance,
  recordImportProvenance,
  type ImportProvenanceRepository,
} from "../src/provenance.js";

const mapping = inspectHeaders(LEAD_IMPORT_FIELDS).columnMap;

function mapLead(overrides: Partial<Record<string, string>> = {}) {
  const row = LEAD_IMPORT_FIELDS.map((field) => {
    if (field === "company_name") return "Công ty thử nghiệm giả";
    return overrides[field] ?? "";
  });
  const result = mapLeadRow(row, mapping);
  if (!result.success) throw new Error("Synthetic fixture should map");
  return result.lead;
}

const completeConsentEvidence = {
  evidenceReference: "synthetic-evidence-ref-01",
  channel: "PHONE",
  purpose: "customer-requested service follow-up",
  capturedAt: "2026-11-02T10:00:00.000Z",
} as const;

describe("P0.3c import provenance and consent gate", () => {
  it("routes a row with missing source into review without inferring consent", () => {
    const lead = mapLead({ lawful_contact_basis: "CUSTOMER_REQUEST" });
    const decision = assessImportProvenance(lead);

    expect(decision.reviewRequired).toBe(true);
    expect(decision.reviewReasons).toContain("SOURCE_EVIDENCE_MISSING");
    expect(decision.consentStatus).toBe("UNKNOWN");
    expect(decision.contactabilityStatus).toBe("REVIEW_REQUIRED");
  });

  it("downgrades workbook ALLOWED when evidence, channel, purpose, and timestamp are absent", () => {
    const lead = mapLead({
      source: "CUSTOMER_REQUEST",
      lawful_contact_basis: "CUSTOMER_REQUEST",
      consent_status: "ALLOWED_FOR_RECORDED_PURPOSE",
    });
    const decision = assessImportProvenance(lead);

    expect(decision.consentStatus).toBe("REVIEW_REQUIRED");
    expect(decision.contactabilityStatus).toBe("REVIEW_REQUIRED");
    expect(decision.reviewReasons).toEqual(
      expect.arrayContaining([
        "CONSENT_EVIDENCE_MISSING",
        "CHANNEL_MISSING",
        "PURPOSE_MISSING",
        "CONSENT_TIMESTAMP_MISSING",
      ]),
    );
  });

  it("keeps ALLOWED closed unless source/basis and all explicit consent evidence are present", () => {
    const lead = mapLead({
      source: "CUSTOMER_REQUEST",
      lawful_contact_basis: "CUSTOMER_REQUEST",
      consent_status: "ALLOWED_FOR_RECORDED_PURPOSE",
    });
    const decision = assessImportProvenance(lead, completeConsentEvidence);

    expect(decision.reviewRequired).toBe(false);
    expect(decision.consentStatus).toBe("ALLOWED_FOR_RECORDED_PURPOSE");
    expect(decision.contactabilityStatus).toBe("ALLOWED_FOR_RECORDED_PURPOSE");
  });

  it("creates an all-channel suppression instruction for workbook OPTED_OUT", () => {
    const lead = mapLead({
      source: "CUSTOMER_REQUEST",
      lawful_contact_basis: "CUSTOMER_REQUEST",
      consent_status: "OPTED_OUT",
    });
    const decision = assessImportProvenance(lead, completeConsentEvidence);

    expect(decision.consentStatus).toBe("OPTED_OUT");
    expect(decision.contactabilityStatus).toBe("SUPPRESSED");
    expect(decision.suppression).toEqual({
      required: true,
      reason: "OPT_OUT",
      scope: "ALL_CHANNELS",
    });
  });

  it("keeps consent UNKNOWN by default and states that import enqueues no task", () => {
    const decision = assessImportProvenance(mapLead());
    expect(decision.consentStatus).toBe("UNKNOWN");
    expect(decision.contactTaskEnqueued).toBe(false);
  });

  it("passes lead, suppression intent, and safe audit metadata through one repository operation", async () => {
    const lead = mapLead({
      phone: "0901234567",
      email: "synthetic@example.test",
      consent_status: "OPTED_OUT",
    });
    const decision = assessImportProvenance(lead);
    const commands: unknown[] = [];
    const repository: ImportProvenanceRepository = {
      persistAtomically: async (command) => {
        commands.push(command);
      },
    };

    await recordImportProvenance(repository, lead, decision);

    expect(commands).toHaveLength(1);
    const command = commands[0] as {
      lead: {
        consent_status: string;
        contactability_status: string;
      };
      suppression: typeof decision.suppression;
      audit: { eventType: string; reviewReasons: readonly string[] };
    };
    expect(command.lead).toMatchObject({
      consent_status: "OPTED_OUT",
      contactability_status: "SUPPRESSED",
    });
    expect(command.suppression).toEqual(decision.suppression);
    expect(command.audit.eventType).toBe("IMPORT_PROVENANCE_ASSESSED");
    expect(JSON.stringify(command.audit)).not.toContain(lead.company_name);
    expect(JSON.stringify(command.audit)).not.toContain("0901234567");
    expect(JSON.stringify(command.audit)).not.toContain(
      "synthetic@example.test",
    );
    expect("contactTask" in command).toBe(false);
  });

  it("sends downgraded ALLOWED values to the persistence boundary", async () => {
    const lead = mapLead({
      source: "CUSTOMER_REQUEST",
      lawful_contact_basis: "CUSTOMER_REQUEST",
      consent_status: "ALLOWED_FOR_RECORDED_PURPOSE",
    });
    const decision = assessImportProvenance(lead);
    let persistedLead: {
      consent_status: string;
      contactability_status: string;
    } | null = null;
    const repository: ImportProvenanceRepository = {
      persistAtomically: async (command) => {
        persistedLead = command.lead;
      },
    };

    await recordImportProvenance(repository, lead, decision);

    expect(persistedLead).toMatchObject({
      consent_status: "REVIEW_REQUIRED",
      contactability_status: "REVIEW_REQUIRED",
    });
  });

  it("propagates repository failure so callers cannot report a committed import", async () => {
    const lead = mapLead({ consent_status: "OPTED_OUT" });
    const decision = assessImportProvenance(lead);
    const repository: ImportProvenanceRepository = {
      persistAtomically: async () => {
        throw new Error("AUDIT_WRITE_FAILED");
      },
    };

    await expect(
      recordImportProvenance(repository, lead, decision),
    ).rejects.toThrow("AUDIT_WRITE_FAILED");
  });
});
