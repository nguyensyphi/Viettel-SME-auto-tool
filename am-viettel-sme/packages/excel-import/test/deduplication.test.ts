import { describe, expect, it } from "vitest";
import {
  createReviewDecision,
  findDuplicateCandidates,
  type DeduplicationLead,
} from "../src/deduplication.js";

function lead(overrides: Partial<DeduplicationLead> = {}): DeduplicationLead {
  return {
    companyName: "Công ty Sao Mai",
    district: "Quận 1",
    phoneNormalized: null,
    emailNormalized: null,
    consentStatus: "UNKNOWN",
    contactabilityStatus: "UNKNOWN",
    ...overrides,
  };
}

function find(
  incoming: DeduplicationLead,
  existing: readonly (DeduplicationLead & { id: string })[],
  extraOptions: {
    explicitlyMapped?: boolean;
    permissionApproved?: boolean;
  } = {},
) {
  return findDuplicateCandidates(incoming, existing, {
    reviewGroupId: "import-row-12",
    ...(extraOptions.explicitlyMapped !== undefined ||
    extraOptions.permissionApproved !== undefined
      ? {
          taxIdMatchAuthorization: {
            explicitlyMapped: extraOptions.explicitlyMapped ?? false,
            permissionApproved: extraOptions.permissionApproved ?? false,
          },
        }
      : {}),
  });
}

describe("P0.4a duplicate candidate and review contract", () => {
  it("finds an exact phone candidate using normalized Vietnamese phone keys", () => {
    const group = find(lead({ phoneNormalized: "+84 912 345 678" }), [
      { id: "lead-phone", ...lead({ phoneNormalized: "0912345678" }) },
    ]);

    expect(group.candidates).toHaveLength(1);
    expect(group.candidates[0]?.matchTypes).toEqual(["EXACT_PHONE"]);
    expect(group.candidates[0]?.confidence).toBe("EXACT");
    expect(group.candidates[0]?.decisionRequired).toBe(true);
  });

  it("finds an exact email candidate using case-insensitive normalized keys", () => {
    const group = find(lead({ emailNormalized: "  SALES@SAOMAI.VN " }), [
      { id: "lead-email", ...lead({ emailNormalized: "sales@saomai.vn" }) },
    ]);

    expect(group.candidates[0]?.matchTypes).toContain("EXACT_EMAIL");
  });

  it("creates a company-and-district candidate without auto-merging", () => {
    const group = find(
      lead({ companyName: "Sao.Mai JSC", district: "Quận 1" }),
      [
        {
          id: "lead-fuzzy",
          ...lead({ companyName: "SAO-MAI JSC", district: "  QUẬN 1 " }),
        },
      ],
    );

    expect(group.candidates).toHaveLength(1);
    expect(group.candidates[0]?.matchTypes).toEqual(["COMPANY_DISTRICT"]);
    expect(group.candidates[0]?.confidence).toBe("FUZZY");
    expect(group.candidates[0]?.decisionRequired).toBe(true);
    expect(group.candidates[0]?.autoMerged).toBe(false);
  });

  it("returns multiple candidate records in stable order, not just the first match", () => {
    const group = find(
      lead({ phoneNormalized: "0912345678", emailNormalized: "a@saomai.vn" }),
      [
        { id: "lead-b", ...lead({ phoneNormalized: "0912345678" }) },
        { id: "lead-a", ...lead({ emailNormalized: "a@saomai.vn" }) },
      ],
    );

    expect(group.candidates.map((candidate) => candidate.leadId)).toEqual([
      "lead-a",
      "lead-b",
    ]);
    expect(group.candidates.map((candidate) => candidate.matchTypes)).toEqual([
      ["EXACT_EMAIL"],
      ["EXACT_PHONE"],
    ]);
  });

  it("masks phone, email, and contact name in the review payload", () => {
    const group = find(
      lead({
        contactName: "Nguyễn Thị Huyền",
        phoneNormalized: "0912345678",
        emailNormalized: "huyen.nguyen@saomai.vn",
      }),
      [
        {
          id: "lead-private",
          ...lead({
            contactName: "Nguyễn Thị Huyền",
            phoneNormalized: "0912345678",
            emailNormalized: "huyen.nguyen@saomai.vn",
          }),
        },
      ],
    );
    const payload = JSON.stringify(group);

    expect(group.incoming.phone).toBe("********78");
    expect(group.incoming.email).not.toBe("huyen.nguyen@saomai.vn");
    expect(group.incoming.contactName).not.toBe("Nguyễn Thị Huyền");
    expect(payload).not.toContain("0912345678");
    expect(payload).not.toContain("huyen.nguyen@saomai.vn");
    expect(payload).not.toContain("Nguyễn Thị Huyền");
  });

  it("accepts keep, merge-to-selected-candidate, and skip decisions without persistence", () => {
    const group = find(lead({ phoneNormalized: "0912345678" }), [
      { id: "lead-1", ...lead({ phoneNormalized: "0912345678" }) },
      { id: "lead-2", ...lead({ phoneNormalized: "0912345678" }) },
    ]);

    const keep = createReviewDecision(group, { action: "KEEP" });
    const merge = createReviewDecision(group, {
      action: "MERGE",
      targetLeadId: "lead-2",
    });
    const skip = createReviewDecision(group, { action: "SKIP" });

    expect(keep).toMatchObject({ valid: true, decision: { action: "KEEP" } });
    expect(merge).toMatchObject({
      valid: true,
      decision: { action: "MERGE", targetLeadId: "lead-2" },
    });
    expect(skip).toMatchObject({ valid: true, decision: { action: "SKIP" } });
    expect(merge.valid && merge.decision.persistence).toBe("NOT_PERFORMED");
  });

  it("rejects a merge target that is not in the current candidate group", () => {
    const group = find(lead({ phoneNormalized: "0912345678" }), [
      { id: "lead-1", ...lead({ phoneNormalized: "0912345678" }) },
    ]);

    expect(
      createReviewDecision(group, {
        action: "MERGE",
        targetLeadId: "unrelated-lead",
      }),
    ).toEqual({ valid: false, errorCode: "MERGE_TARGET_NOT_IN_CANDIDATES" });
  });

  it("keeps opt-out/suppression dominant and carries all evidence references through merge review", () => {
    const group = find(
      lead({
        phoneNormalized: "0912345678",
        consentStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
        contactabilityStatus: "ALLOWED_FOR_RECORDED_PURPOSE",
        consentEvidenceReferences: ["consent-incoming"],
        auditEvidenceReferences: ["audit-incoming"],
      }),
      [
        {
          id: "lead-opted-out",
          ...lead({
            phoneNormalized: "0912345678",
            consentStatus: "OPTED_OUT",
            contactabilityStatus: "SUPPRESSED",
            consentEvidenceReferences: ["consent-opt-out"],
            auditEvidenceReferences: ["audit-opt-out"],
          }),
        },
      ],
    );
    const candidate = group.candidates[0];
    expect(candidate?.restrictionConflict).toBe(true);

    const result = createReviewDecision(group, {
      action: "MERGE",
      targetLeadId: "lead-opted-out",
    });

    expect(result.valid).toBe(true);
    if (!result.valid || result.decision.action !== "MERGE") return;
    expect(result.decision.safety).toMatchObject({
      effectiveConsentStatus: "OPTED_OUT",
      effectiveContactabilityStatus: "SUPPRESSED",
      suppressionMustRemain: true,
      preservedConsentEvidenceReferences: [
        "consent-incoming",
        "consent-opt-out",
      ],
      preservedAuditEvidenceReferences: ["audit-incoming", "audit-opt-out"],
      preservedSuppressionInstructions: [
        { required: true, reason: "OPT_OUT", scope: "ALL_CHANNELS" },
      ],
    });
  });

  it("does not use tax ID unless it was both explicitly mapped and permission-approved", () => {
    const incoming = lead({
      companyName: "Incoming Corp",
      district: null,
      taxIdNormalized: "0312345678",
    });
    const existing = [
      {
        id: "lead-tax",
        ...lead({
          companyName: "Existing Corp",
          district: null,
          taxIdNormalized: "0312345678",
        }),
      },
    ];

    expect(find(incoming, existing).candidates).toHaveLength(0);
    expect(
      find(incoming, existing, {
        explicitlyMapped: true,
        permissionApproved: false,
      }).candidates,
    ).toHaveLength(0);
    expect(
      find(incoming, existing, {
        explicitlyMapped: true,
        permissionApproved: true,
      }).candidates[0]?.matchTypes,
    ).toEqual(["EXACT_TAX_ID"]);
  });
});
