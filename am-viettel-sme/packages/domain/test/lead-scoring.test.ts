import { describe, it, expect } from "vitest";
import {
  computeLeadScore,
  type LeadScoringInput,
  type LeadScoreBreakdown,
} from "../src/scoring/lead-scoring.js";

describe("AI Lead Scoring Engine (100-Point Rubric)", () => {
  it("should score a newly established SME with full contact info as Tier A (80-100 pts)", () => {
    const input: LeadScoringInput = {
      taxCode: "3701234567",
      companyName: "CÔNG TY TNHH CÔNG NGHỆ & VẬN TẢI BÌNH DƯƠNG",
      establishedYear: new Date().getFullYear(), // < 1 year
      industry: "Vận tải & Logistics",
      employeeCount: 25,
      hasPhone: true,
      hasEmail: true,
      hasWebsite: true,
      recentBusinessSignals: ["Mở rộng chi nhánh Dĩ An", "Tuyển dụng nhân sự lái xe"],
    };

    const result: LeadScoreBreakdown = computeLeadScore(input);

    expect(result.industryScore).toBe(20);
    expect(result.establishmentScore).toBe(15);
    expect(result.scaleScore).toBe(15);
    expect(result.productDemandScore).toBe(25);
    expect(result.contactInfoScore).toBe(15);
    expect(result.businessSignalScore).toBe(10);
    expect(result.totalScore).toBe(100);
    expect(result.tier).toBe("A");
    expect(result.tierExplanation).toContain("Ưu tiên xác minh và tiếp cận sớm");
    expect(result.recommendedProducts).toEqual(
      expect.arrayContaining(["FTTH", "M2M_IOT", "VIETTEL_CA", "HOA_DON_DIEN_TU"]),
    );
  });

  it("should score a standard mature SME as Tier B (60-79 pts)", () => {
    const input: LeadScoringInput = {
      taxCode: "3709876543",
      companyName: "CÔNG TY TNHH THƯƠNG MẠI BÁN LẺ DĨ AN",
      establishedYear: new Date().getFullYear() - 2, // 2 years old
      industry: "Bán lẻ & Phân phối",
      employeeCount: 15,
      hasPhone: true,
      hasEmail: false,
      hasWebsite: false,
      recentBusinessSignals: [],
    };

    const result = computeLeadScore(input);

    expect(result.tier).toBe("B");
    expect(result.totalScore).toBeGreaterThanOrEqual(60);
    expect(result.totalScore).toBeLessThan(80);
    expect(result.tierExplanation).toContain("Đưa vào danh sách chăm sóc");
  });

  it("should score a lead with missing/incomplete data as Tier C or D without hallucinating scores", () => {
    const incompleteLead: LeadScoringInput = {
      taxCode: "3700001111",
      companyName: "HỘ KINH DOANH CHƯA RÕ THÔNG TIN",
      hasPhone: false,
      hasEmail: false,
      hasWebsite: false,
    };

    const result = computeLeadScore(incompleteLead);

    // Missing contact info, establishment year, scale -> strictly 0 points on those
    expect(result.contactInfoScore).toBe(0);
    expect(result.establishmentScore).toBe(0);
    expect(result.scaleScore).toBe(0);
    expect(result.businessSignalScore).toBe(0);
    expect(result.totalScore).toBeLessThan(40);
    expect(result.tier).toBe("D");
    expect(result.tierExplanation).toContain("Lưu trữ hoặc loại khỏi danh sách");
  });

  it("should match products correctly according to Viettel SME Product Matrix (Slide 3)", () => {
    const accountantLead: LeadScoringInput = {
      taxCode: "3705556666",
      companyName: "ĐẠI LÝ THUẾ & KẾ TOÁN DĨ AN",
      industry: "Kế toán - Dịch vụ thuế",
      hasPhone: true,
      hasEmail: true,
      hasWebsite: false,
    };

    const result = computeLeadScore(accountantLead);
    expect(result.recommendedProducts).toContain("VIETTEL_CA");
    expect(result.recommendedProducts).toContain("HOA_DON_DIEN_TU");
    expect(result.recommendedProducts).toContain("VBHXH");
  });
});

