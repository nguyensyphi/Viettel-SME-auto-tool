import { describe, expect, it } from "vitest";
import { resolveSpinTax, extractSpinTaxVariationsCount } from "../src/messaging/spin-tax.js";

describe("SpinTax Engine — Anti-Spam & Anti-Ban Content Permutation", () => {
  it("resolves simple spin-tax choices correctly", () => {
    const template = "{Xin chào|Kính gửi} Quý Doanh nghiệp";
    const resolved = resolveSpinTax(template, {}, () => 0); // Chooses first variant
    expect(resolved).toBe("Xin chào Quý Doanh nghiệp");

    const resolvedSecond = resolveSpinTax(template, {}, () => 0.99); // Chooses second variant
    expect(resolvedSecond).toBe("Kính gửi Quý Doanh nghiệp");
  });

  it("handles nested spin-tax blocks", () => {
    const template = "{Kính chào|{Chào|Thân ái}} anh chị";
    const resolved = resolveSpinTax(template, {}, () => 0.9);
    expect(["Kính chào anh chị", "Chào anh chị", "Thân ái anh chị"]).toContain(resolved);
  });

  it("substitutes dynamic variables like [TÊN_NHÓM] and [NGÀY_THÁNG]", () => {
    const template = "Kính gửi thành viên nhóm [TÊN_NHÓM], ưu đãi ngày [NGÀY_THÁNG]";
    const resolved = resolveSpinTax(template, {
      TÊN_NHÓM: "Hội Doanh nhân Trẻ Dĩ An",
      NGÀY_THÁNG: "12/11/2026",
    });
    expect(resolved).toBe("Kính gửi thành viên nhóm Hội Doanh nhân Trẻ Dĩ An, ưu đãi ngày 12/11/2026");
  });

  it("calculates total possible variation combinations", () => {
    const template = "{A|B|C} và {1|2} cùng {X|Y}";
    const count = extractSpinTaxVariationsCount(template);
    expect(count).toBe(3 * 2 * 2); // 12 combinations
  });

  it("leaves normal text untouched when no spin-tax blocks exist", () => {
    const plain = "Bản tin Chữ ký số Viettel-CA Cloud giá ưu đãi 2026.";
    expect(resolveSpinTax(plain)).toBe(plain);
  });
});

