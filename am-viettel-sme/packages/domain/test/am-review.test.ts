import { describe, it, expect } from "vitest";
import {
  classifyCustomerLead,
  CustomerSegment,
} from "../src/classification/customer-classifier.js";
import { matchProductsForCustomer } from "../src/product-matching/matcher.js";
import { confirmSuggestion } from "../src/review/am-confirmation.js";

describe("Suggestion-only policy (P0: matrix is reference, AM decides)", () => {
  const lead = {
    taxCode: "0301122334",
    businessName: "NHÀ HÀNG BIỂN XANH",
    industry: "Dịch vụ phục vụ đồ uống, ăn uống",
  };

  it("marks classification output as a pending suggestion, never auto-assigned", () => {
    const result = classifyCustomerLead(lead);
    expect(result.suggestionStatus).toBe("PENDING_AM_REVIEW");
    expect(result.autoAssigned).toBe(false);
  });

  it("marks every product match as a pending suggestion", () => {
    const matches = matchProductsForCustomer({ segment: CustomerSegment.RETAIL_FNB });
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.suggestionStatus).toBe("PENDING_AM_REVIEW");
    }
  });

  it("produces an AM-confirmed profile only with explicit AM identity and timestamp", () => {
    const suggestion = classifyCustomerLead(lead);
    const confirmed = confirmSuggestion(suggestion, {
      amUserId: "am-001",
      confirmedSegment: CustomerSegment.RETAIL_FNB,
      confirmedServices: ["HOA_DON_DIEN_TU"],
      confirmedAt: "2026-11-05T08:00:00.000Z",
    });

    expect(confirmed.source).toBe("AM_CONFIRMED");
    expect(confirmed.confirmedBy).toBe("am-001");
    expect(confirmed.services).toEqual(["HOA_DON_DIEN_TU"]);
    expect(confirmed.overridden).toBe(false);
  });

  it("records an override when AM picks a different segment than suggested", () => {
    const suggestion = classifyCustomerLead(lead);
    const confirmed = confirmSuggestion(suggestion, {
      amUserId: "am-001",
      confirmedSegment: CustomerSegment.PROFESSIONAL_SERVICES,
      confirmedServices: ["MYSIGN"],
      confirmedAt: "2026-11-05T08:00:00.000Z",
    });
    expect(confirmed.overridden).toBe(true);
    expect(confirmed.segment).toBe(CustomerSegment.PROFESSIONAL_SERVICES);
  });

  it("rejects confirmation without AM id, without services, or with invalid timestamp", () => {
    const suggestion = classifyCustomerLead(lead);
    const base = {
      amUserId: "am-001",
      confirmedSegment: CustomerSegment.RETAIL_FNB,
      confirmedServices: ["FTTH"],
      confirmedAt: "2026-11-05T08:00:00.000Z",
    };
    expect(() => confirmSuggestion(suggestion, { ...base, amUserId: " " })).toThrow(/amUserId/);
    expect(() => confirmSuggestion(suggestion, { ...base, confirmedServices: [] })).toThrow(
      /confirmedServices/,
    );
    expect(() => confirmSuggestion(suggestion, { ...base, confirmedAt: "not-a-date" })).toThrow(
      /confirmedAt/,
    );
  });
});

