import { describe, expect, it } from "vitest";
import {
  maskEmailForDisplay,
  maskPhoneForDisplay,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
} from "../src/index.js";

describe("P0.3b pure normalization contracts", () => {
  describe("Vietnamese and international phone normalization", () => {
    it.each([
      ["0901234567", "0901234567"],
      [" 090 123-45 (67) ", "0901234567"],
      ["(090) 123.4567", "0901234567"],
      ["+84 90-123-4567", "0901234567"],
      ["84901234567", "0901234567"],
    ])("normalizes %s to local Vietnamese form", (input, expected) => {
      expect(normalizePhone(input)).toEqual({
        status: "VALID",
        value: expected,
        normalizedKey: expected,
      });
    });

    it("preserves a non-Vietnamese international number for review without a dedupe key", () => {
      expect(normalizePhone(" +86 (139) 1234-5678 ")).toEqual({
        status: "NEEDS_REVIEW",
        value: "+8613912345678",
        normalizedKey: null,
      });
    });

    it.each([
      "090123456",
      "09012345678",
      "8490123456",
      "849012345678",
      "+8490123456",
      "09012ABC67",
      "++84901234567",
      "+86",
    ])("rejects malformed/short/long phone %s without guessing", (input) => {
      expect(normalizePhone(input)).toEqual({
        status: "INVALID",
        value: null,
        normalizedKey: null,
        errorCode: "PHONE_INVALID",
      });
    });

    it("treats blank optional phone values as empty", () => {
      expect(normalizePhone(" ( - . ) ")).toEqual({
        status: "EMPTY",
        value: null,
        normalizedKey: null,
      });
    });
  });

  describe("email normalization and safe display masks", () => {
    it("trims while retaining the entered value and returns a lowercase match key", () => {
      expect(normalizeEmail("  Sales.Team+HCM@Example.COM ")).toEqual({
        status: "VALID",
        value: "Sales.Team+HCM@Example.COM",
        normalizedKey: "sales.team+hcm@example.com",
      });
    });

    it.each([
      "not-an-email",
      "person@",
      "@example.com",
      "a..b@example.com",
      "person@example..com",
      "person name@example.com",
    ])("rejects malformed email %s", (input) => {
      expect(normalizeEmail(input)).toEqual({
        status: "INVALID",
        value: null,
        normalizedKey: null,
        errorCode: "EMAIL_INVALID",
      });
    });

    it("masks phone and email without exposing their full values", () => {
      const phone = "0901234567";
      const email = "trihuyen@example.com";
      const maskedPhone = maskPhoneForDisplay(phone);
      const maskedEmail = maskEmailForDisplay(email);
      expect(maskedPhone).not.toContain(phone);
      expect(maskedPhone).toContain("67");
      expect(maskedEmail).not.toContain("trihuyen");
      expect(maskedEmail).not.toContain("example.com");
      expect(maskedEmail).toMatch(/^t\*+@e\*+\.com$/);
      expect(maskPhoneForDisplay(null)).toBeNull();
      expect(maskEmailForDisplay(null)).toBeNull();
    });
  });

  describe("company display normalization and suggestion key", () => {
    it("preserves readable Unicode NFC display while collapsing whitespace", () => {
      const decomposed = "  Công ty   Việt  ";
      const result = normalizeCompanyName(decomposed);
      expect(result.display).toBe("Công ty Việt");
      expect(result.display).toBe(result.display.normalize("NFC"));
    });

    it("creates a case- and punctuation-insensitive suggestion key without changing display", () => {
      expect(normalizeCompanyName("  Công ty A&B,  ")).toEqual({
        display: "Công ty A&B,",
        matchKey: "công ty ab",
      });
      expect(normalizeCompanyName("CÔNG TY A-B").matchKey).toBe("công ty ab");
    });

    it("keeps blank company names empty for required-field rejection by the adapter", () => {
      expect(normalizeCompanyName("  \t ")).toEqual({
        display: "",
        matchKey: "",
      });
    });
  });
});
