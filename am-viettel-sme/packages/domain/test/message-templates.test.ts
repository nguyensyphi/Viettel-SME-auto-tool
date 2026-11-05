import { describe, it, expect } from "vitest";
import {
  MESSAGE_TEMPLATES,
  renderTemplate,
  getTemplate,
} from "../src/messaging/templates.js";

const vars = {
  contactGreeting: "Chị Lan",
  businessName: "NHÀ HÀNG BIỂN ĐÔNG",
  serviceName: "Hóa đơn điện tử",
  amName: "Nguyễn Văn AM",
  amTitle: "Chuyên viên Khách hàng Doanh nghiệp Viettel",
  amPhone: "0988123456",
};

// Claims that must not appear while policy is CAN_XAC_NHAN_LAI
const FORBIDDEN_CLAIMS = [/ưu đãi/i, /khuyến mại/i, /miễn phí/i, /giảm giá/i, /\d+\s*%/, /uu dai/i, /mien phi/i];

describe("Message templates (draft, pending compliance approval)", () => {
  it("provides several templates across SMS, ZALO, EMAIL and CALL_SCRIPT", () => {
    const channels = new Set(MESSAGE_TEMPLATES.map((t) => t.channel));
    expect(MESSAGE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const c of ["SMS", "ZALO", "EMAIL", "CALL_SCRIPT"]) {
      expect(channels.has(c as never)).toBe(true);
    }
  });

  it("marks every template as draft pending compliance review", () => {
    for (const t of MESSAGE_TEMPLATES) {
      expect(t.approvalStatus).toBe("DRAFT_PENDING_COMPLIANCE");
    }
  });

  it("includes an opt-out instruction in every written-channel template", () => {
    for (const t of MESSAGE_TEMPLATES.filter((x) => x.channel !== "CALL_SCRIPT")) {
      expect(renderTemplate(t, vars)).toMatch(/TU CHOI|TỪ CHỐI/);
    }
  });

  it("call scripts ask permission to continue and offer to stop contact", () => {
    for (const t of MESSAGE_TEMPLATES.filter((x) => x.channel === "CALL_SCRIPT")) {
      expect(renderTemplate(t, vars)).toMatch(/không muốn nhận|ngừng liên hệ/i);
    }
  });

  it("never makes price/promotion claims while policies are unconfirmed", () => {
    for (const t of MESSAGE_TEMPLATES) {
      const text = renderTemplate(t, vars);
      for (const re of FORBIDDEN_CLAIMS) {
        expect(text, `${t.templateId} matched ${re}`).not.toMatch(re);
      }
    }
  });

  it("does not reference a hard-coded opt-out shortcode", () => {
    for (const t of MESSAGE_TEMPLATES) {
      expect(t.body).not.toMatch(/gui\s+\d{3,5}|gửi\s+\d{3,5}/i);
    }
  });

  it("resolves all placeholders and throws on missing variables", () => {
    for (const t of MESSAGE_TEMPLATES) {
      expect(renderTemplate(t, vars)).not.toMatch(/\{\w+\}/);
    }
    const t = getTemplate("ZALO_INTRO_V1");
    expect(() => renderTemplate(t, { ...vars, amPhone: "" })).toThrow(/amPhone/);
  });

  it("keeps SMS templates within 2 GSM segments (306 chars) for typical input", () => {
    for (const t of MESSAGE_TEMPLATES.filter((x) => x.channel === "SMS")) {
      expect(renderTemplate(t, vars).length).toBeLessThanOrEqual(306);
    }
  });
});

