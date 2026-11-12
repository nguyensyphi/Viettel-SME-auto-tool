/**
 * AI Lead Scoring Engine (100-Point Rubric)
 * Direct implementation of Viettel AM Growth Blueprint (Slides 3 & 4)
 *
 * Scoring breakdown (Max 100 points):
 * 1. Mức độ phù hợp ngành nghề: 20 pts
 * 2. Thời gian thành lập: 15 pts
 * 3. Quy mô doanh nghiệp: 15 pts
 * 4. Nhu cầu sản phẩm dự kiến: 25 pts
 * 5. Có thông tin liên hệ doanh nghiệp: 15 pts
 * 6. Tín hiệu kinh doanh gần đây: 10 pts
 *
 * Tiers:
 * A - Ưu tiên cao: 80 - 100 điểm
 * B - Tiềm năng: 60 - 79 điểm
 * C - Cần nuôi dưỡng: 40 - 59 điểm
 * D - Chưa phù hợp: < 40 điểm
 *
 * Core rule: Thiếu dữ liệu thì tính 0 điểm tiêu chí đó, KHÔNG tự suy diễn.
 */

export interface LeadScoringInput {
  taxCode: string;
  companyName: string;
  establishedYear?: number | undefined;
  industry?: string | undefined;
  employeeCount?: number | undefined;
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite?: boolean | undefined;
  recentBusinessSignals?: readonly string[] | undefined;
}

export type LeadScoreTier = "A" | "B" | "C" | "D";

export interface LeadScoreBreakdown {
  industryScore: number;       // max 20
  establishmentScore: number;  // max 15
  scaleScore: number;          // max 15
  productDemandScore: number;  // max 25
  contactInfoScore: number;    // max 15
  businessSignalScore: number; // max 10
  totalScore: number;          // max 100
  tier: LeadScoreTier;
  recommendedProducts: string[];
  tierExplanation: string;
}

export function computeLeadScore(input: LeadScoringInput): LeadScoreBreakdown {
  const currentYear = new Date().getFullYear();

  // 1. Mức độ phù hợp ngành nghề (max 20)
  let industryScore = 0;
  const indUpper = (input.industry ?? "").toUpperCase();
  const nameUpper = input.companyName.toUpperCase();

  const isHighMatchIndustry =
    indUpper.includes("VẬN TẢI") ||
    indUpper.includes("LOGISTICS") ||
    indUpper.includes("BÁN LẺ") ||
    indUpper.includes("PHÂN PHỐI") ||
    indUpper.includes("KHO BÃI") ||
    indUpper.includes("SẢN XUẤT") ||
    indUpper.includes("XÂY DỰNG") ||
    indUpper.includes("KẾ TOÁN") ||
    indUpper.includes("THUẾ") ||
    nameUpper.includes("LOGISTICS") ||
    nameUpper.includes("VẬN TẢI") ||
    nameUpper.includes("XÂY DỰNG") ||
    nameUpper.includes("SẢN XUẤT");

  if (isHighMatchIndustry) {
    industryScore = 20;
  } else if (input.industry && input.industry.trim().length > 0) {
    industryScore = 10;
  } else {
    industryScore = 0;
  }

  // 2. Thời gian thành lập (max 15)
  let establishmentScore = 0;
  let isNewlyEstablished = false;
  if (input.establishedYear !== undefined && input.establishedYear > 1900) {
    const age = currentYear - input.establishedYear;
    if (age <= 1) {
      establishmentScore = 15;
      isNewlyEstablished = true;
    } else if (age <= 3) {
      establishmentScore = 10;
    } else {
      establishmentScore = 6;
    }
  } else {
    establishmentScore = 0; // Chưa rõ năm thành lập
  }

  // 3. Quy mô doanh nghiệp (max 15)
  let scaleScore = 0;
  if (input.employeeCount !== undefined && input.employeeCount > 0) {
    if (input.employeeCount >= 10 && input.employeeCount <= 50) {
      scaleScore = 15; // Chuẩn SME vàng
    } else if (input.employeeCount > 50) {
      scaleScore = 12; // Doanh nghiệp vừa
    } else {
      scaleScore = 10; // Micro / HKD
    }
  } else {
    scaleScore = 0; // Chưa rõ quy mô
  }

  // 4. Product Matching & Demand Score (max 25)
  const products = new Set<string>();

  // Slide 3 Matching Rules:
  if (isNewlyEstablished) {
    products.add("VIETTEL_CA");
    products.add("HOA_DON_DIEN_TU");
    products.add("VBHXH");
    products.add("VCONTRACT");
  }

  if (indUpper.includes("KẾ TOÁN") || indUpper.includes("THUẾ")) {
    products.add("VIETTEL_CA");
    products.add("HOA_DON_DIEN_TU");
    products.add("VBHXH");
  }

  if (indUpper.includes("VẬN TẢI") || indUpper.includes("LOGISTICS") || indUpper.includes("KHO")) {
    products.add("FTTH");
    products.add("M2M_IOT");
    products.add("VTRACKING");
    products.add("CLOUD");
  }

  if (indUpper.includes("BÁN LẺ") || indUpper.includes("PHÂN PHỐI")) {
    products.add("HOA_DON_DIEN_TU");
    products.add("1OFFICE");
  }

  if (indUpper.includes("XÂY DỰNG") || indUpper.includes("BẤT ĐỘNG SẢN")) {
    products.add("VCONTRACT");
    products.add("VIETTEL_CA");
    products.add("FTTH");
  }

  if (indUpper.includes("SẢN XUẤT")) {
    products.add("FTTH");
    products.add("M2M_IOT");
    products.add("1OFFICE");
    products.add("CLOUD");
  }

  // Fallback defaults if industry is generic but newly established
  if (products.size === 0 && isNewlyEstablished) {
    products.add("VIETTEL_CA");
    products.add("HOA_DON_DIEN_TU");
  }

  const recommendedProducts = Array.from(products);

  let productDemandScore = 0;
  if (recommendedProducts.length >= 3) {
    productDemandScore = 25; // Nhu cầu giải pháp số tích hợp
  } else if (recommendedProducts.length >= 1) {
    productDemandScore = 15;
  } else {
    productDemandScore = 0;
  }

  // 5. Có thông tin liên hệ doanh nghiệp (max 15)
  let contactInfoScore = 0;
  const hasContactChannel = input.hasPhone || input.hasEmail;
  if (input.hasPhone && (input.hasEmail || input.hasWebsite)) {
    contactInfoScore = 15;
  } else if (input.hasPhone) {
    contactInfoScore = 10;
  } else if (input.hasEmail || input.hasWebsite) {
    contactInfoScore = 5;
  } else {
    contactInfoScore = 0;
  }

  // 6. Tín hiệu kinh doanh gần đây (max 10)
  let businessSignalScore = 0;
  if (input.recentBusinessSignals && input.recentBusinessSignals.length > 0) {
    businessSignalScore = Math.min(10, input.recentBusinessSignals.length * 5);
  } else {
    businessSignalScore = 0;
  }

  const totalScore =
    industryScore +
    establishmentScore +
    scaleScore +
    productDemandScore +
    contactInfoScore +
    businessSignalScore;

  let tier: LeadScoreTier;
  let tierExplanation: string;

  if (totalScore >= 80) {
    tier = "A";
    tierExplanation = "A - Ưu tiên cao (80-100đ): Ưu tiên xác minh và tiếp cận sớm qua Zalo & cuộc gọi trực tiếp.";
  } else if (totalScore >= 60) {
    tier = "B";
    tierExplanation = "B - Tiềm năng (60-79đ): Đưa vào danh sách chăm sóc định kỳ, gửi kịch bản giới thiệu giải pháp.";
  } else if (totalScore >= 40) {
    tier = "C";
    tierExplanation = "C - Cần nuôi dưỡng (40-59đ): Tiếp tục bổ sung dữ liệu MST, liên hệ trước khi khai thác chuyên sâu.";
  } else {
    tier = "D";
    tierExplanation = "D - Chưa phù hợp (<40đ): Lưu trữ hoặc loại khỏi danh sách khai thác hiện tại.";
  }

  return {
    industryScore,
    establishmentScore,
    scaleScore,
    productDemandScore,
    contactInfoScore,
    businessSignalScore,
    totalScore,
    tier,
    recommendedProducts,
    tierExplanation,
  };
}

