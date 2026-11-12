import { describe, it, expect } from "vitest";
import {
  MESSAGE_TEMPLATES,
  type MessageTemplate,
} from "../src/messaging/templates.js";
import {
  renderZaloOutreachMessage,
  type ZaloOutreachRenderInput,
} from "../src/messaging/message-generator.js";

describe("Task 1: Zalo Outreach Templates for Newly Established Enterprises (DNMTL)", () => {
  it("defines standard compliant templates ZALO_DNMTL_INTRO_V1 and ZALO_ACCOUNTING_PARTNER_V1", () => {
    const dnmtlTemplate = MESSAGE_TEMPLATES.find(
      (t) => t.templateId === "ZALO_DNMTL_INTRO_V1",
    );
    expect(dnmtlTemplate).toBeDefined();
    expect(dnmtlTemplate?.channel).toBe("ZALO");
    expect(dnmtlTemplate?.body).toContain("{companyName}");
    expect(dnmtlTemplate?.body).toContain("{amName}");
    expect(dnmtlTemplate?.body).toContain("chữ ký số");

    const accountingTemplate = MESSAGE_TEMPLATES.find(
      (t) => t.templateId === "ZALO_ACCOUNTING_PARTNER_V1",
    );
    expect(accountingTemplate).toBeDefined();
    expect(accountingTemplate?.channel).toBe("ZALO");
    expect(accountingTemplate?.body).toContain("kế toán");
    expect(accountingTemplate?.body).toContain("chính sách hợp tác");
  });

  it("renders personalized DNMTL greeting message correctly with variables", () => {
    const input: ZaloOutreachRenderInput = {
      templateCode: "ZALO_DNMTL_INTRO_V1",
      variables: {
        companyName: "CÔNG TY TNHH CÔNG NGHỆ ÁNH DƯƠNG",
        representativeName: "Anh Tuấn",
        amName: "Lê Văn AM",
        amPhone: "0976543210",
        suggestedProducts: ["Chữ ký số Viettel-CA", "Hóa đơn điện tử S-Invoice"],
        province: "Bình Dương",
      },
    };

    const rendered = renderZaloOutreachMessage(input);
    expect(rendered.content).toContain("Em chào Anh Tuấn, em là Lê Văn AM từ Viettel.");
    expect(rendered.content).toContain("CÔNG TY TNHH CÔNG NGHỆ ÁNH DƯƠNG mới thành lập");
    expect(rendered.content).toContain("chữ ký số");
    expect(rendered.content).toContain("0976543210");
  });

  it("falls back to generic greeting when representativeName is missing", () => {
    const input: ZaloOutreachRenderInput = {
      templateCode: "ZALO_DNMTL_INTRO_V1",
      variables: {
        companyName: "CÔNG TY CP THƯƠNG MẠI MINH ĐỨC",
        amName: "Nguyễn Văn AM",
        amPhone: "0988001122",
      },
    };

    const rendered = renderZaloOutreachMessage(input);
    expect(rendered.content).toContain("Em chào anh/chị, em là Nguyễn Văn AM từ Viettel.");
    expect(rendered.content).toContain("CÔNG TY CP THƯƠNG MẠI MINH ĐỨC mới thành lập");
  });

  it("blocks and rejects content containing CCCD/CMND personal identifiers", () => {
    const inputWithPii: ZaloOutreachRenderInput = {
      templateCode: "ZALO_DNMTL_INTRO_V1",
      variables: {
        companyName: "CÔNG TY TNHH ABC CCCD: 079123456789",
        amName: "Lê Văn AM",
        amPhone: "0976543210",
      },
    };

    expect(() => renderZaloOutreachMessage(inputWithPii)).toThrowError(
      /PII_DETECTED/i,
    );
  });
});

