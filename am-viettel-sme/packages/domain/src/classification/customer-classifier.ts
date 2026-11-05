export enum CustomerSegment {
  NEW_ESTABLISHED = "NEW_ESTABLISHED",
  RETAIL_FNB = "RETAIL_FNB",
  LOGISTICS_TRANSPORT = "LOGISTICS_TRANSPORT",
  MANUFACTURING_DISTRIBUTION = "MANUFACTURING_DISTRIBUTION",
  PROFESSIONAL_SERVICES = "PROFESSIONAL_SERVICES",
  MICRO_INDIVIDUAL = "MICRO_INDIVIDUAL",
}

export interface CustomerLeadInput {
  taxCode: string;
  businessName: string;
  establishedYear?: number;
  industry?: string;
  isNewlyEstablished?: boolean;
  isHouseholdBusiness?: boolean;
  numberOfBranches?: number;
  charterCapitalVnd?: number;
  headcountConfirmed?: number;
}

export interface ClassificationResult {
  segment: CustomerSegment;
  recommendedServices: string[];
  screeningQuestions: string[];
  policyStatus: "CAN_XAC_NHAN_LAI" | "CURRENT_CONFIRMED";
  suggestedCta: string;
  inferredHeadcount?: undefined;
}

export function classifyCustomerLead(lead: CustomerLeadInput): ClassificationResult {
  const currentYear = new Date().getFullYear();
  const isRecentEstablishment =
    lead.isNewlyEstablished ||
    (lead.establishedYear !== undefined && currentYear - lead.establishedYear <= 1);

  const nameUpper = lead.businessName.toUpperCase();
  const industryUpper = (lead.industry ?? "").toUpperCase();

  // Rule 1: Household Business / Micro Individual
  if (
    lead.isHouseholdBusiness ||
    nameUpper.includes("HỘ KINH DOANH") ||
    nameUpper.includes("HKD")
  ) {
    return {
      segment: CustomerSegment.MICRO_INDIVIDUAL,
      recommendedServices: ["VIETTEL_CA", "HOA_DON_DIEN_TU", "FTTH", "DI_DONG_TRA_SAU"],
      screeningQuestions: [
        "Hiện hộ kinh doanh đang dùng chữ ký số và hóa đơn điện tử của nhà cung cấp nào?",
        "Cơ sở có bao nhiêu nhân viên hoặc thiết bị cần kết nối mạng internet?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Hẹn tư vấn gói combo chữ ký số và internet FTTH cơ bản cho hộ kinh doanh.",
    };
  }

  // Rule 2: Newly established enterprise
  if (isRecentEstablishment) {
    return {
      segment: CustomerSegment.NEW_ESTABLISHED,
      recommendedServices: [
        "VIETTEL_CA",
        "HOA_DON_DIEN_TU",
        "FTTH",
        "VCONTRACT",
      ],
      screeningQuestions: [
        "Doanh nghiệp đã đăng ký chữ ký số khai thuế ban đầu và mua hóa đơn điện tử chưa?",
        "Doanh nghiệp dự kiến có bao nhiêu nhân sự làm việc tại văn phòng để tư vấn gói internet phù hợp?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Xin lịch tư vấn combo khai thuế ban đầu (Viettel CA + Hóa đơn điện tử) cùng kế toán.",
    };
  }

  // Rule 3: Transport & Logistics
  if (
    industryUpper.includes("VẬN TẢI") ||
    industryUpper.includes("LOGISTICS") ||
    industryUpper.includes("KHO BÃI") ||
    nameUpper.includes("VẬN TẢI") ||
    nameUpper.includes("LOGISTICS")
  ) {
    return {
      segment: CustomerSegment.LOGISTICS_TRANSPORT,
      recommendedServices: ["VTRACKING", "CAMERA_ND10", "M2M_IOT"],
      screeningQuestions: [
        "Đơn vị đang quản lý bao nhiêu xe và phương tiện vận tải?",
        "Đội xe đã lắp định vị vTracking hoặc camera giám sát theo Nghị định 10 chưa?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Hẹn khảo sát phương tiện và đối chiếu tiêu chuẩn kỹ thuật thiết bị định vị/camera cùng người quản lý đội xe.",
    };
  }

  // Rule 4: Retail, FnB, Restaurant
  if (
    industryUpper.includes("ĂN UỐNG") ||
    industryUpper.includes("ĐỒ UỐNG") ||
    industryUpper.includes("BÁN LẺ") ||
    industryUpper.includes("NHÀ HÀNG") ||
    nameUpper.includes("NHÀ HÀNG") ||
    nameUpper.includes("CAFÉ") ||
    nameUpper.includes("COFFEE") ||
    nameUpper.includes("QUÁN")
  ) {
    return {
      segment: CustomerSegment.RETAIL_FNB,
      recommendedServices: ["HOA_DON_DIEN_TU", "FTTH", "TENDOO"],
      screeningQuestions: [
        "Cửa hàng đang sử dụng phần mềm quản lý bán hàng (POS) nào?",
        "Lượng hóa đơn xuất ra mỗi tháng là bao nhiêu và có xuất từ máy tính tiền không?",
        "Cửa hàng có bao nhiêu nhân viên và khách truy cập Wi-Fi cùng lúc?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Demo giải pháp hóa đơn khởi tạo từ máy tính tiền và gói internet Wi-Fi cho cửa hàng.",
    };
  }

  // Rule 5: Professional Services, Accounting, Consulting
  if (
    industryUpper.includes("KẾ TOÁN") ||
    industryUpper.includes("KIỂM TOÁN") ||
    industryUpper.includes("TƯ VẤN THUẾ") ||
    industryUpper.includes("TÀI CHÍNH") ||
    nameUpper.includes("KẾ TOÁN") ||
    nameUpper.includes("ĐẠI LÝ THUẾ")
  ) {
    return {
      segment: CustomerSegment.PROFESSIONAL_SERVICES,
      recommendedServices: ["EASYBOOKS", "MYSIGN", "VIETTEL_CA", "VOICE_BRANDNAME"],
      screeningQuestions: [
        "Đơn vị đang làm dịch vụ kế toán cho bao nhiêu công ty khách hàng?",
        "Nhu cầu ký số từ xa (MySign) và phần mềm kế toán EasyBooks của đơn vị hiện tại ra sao?",
        "Quy mô nhân viên của công ty hiện tại là bao nhiêu?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Hẹn demo giải pháp kế toán EasyBooks và chữ ký số từ xa MySign cùng kế toán trưởng.",
    };
  }

  // Rule 6: Manufacturing & Distribution
  if (
    industryUpper.includes("SẢN XUẤT") ||
    industryUpper.includes("PHÂN PHỐI") ||
    nameUpper.includes("SẢN XUẤT") ||
    nameUpper.includes("PHÂN PHỐI")
  ) {
    return {
      segment: CustomerSegment.MANUFACTURING_DISTRIBUTION,
      recommendedServices: ["DMS_4_0", "OFFICE_1", "VCONTRACT", "VOICE_BRANDNAME"],
      screeningQuestions: [
        "Doanh nghiệp có bao nhiêu nhân viên bán hàng ngoài thị trường và nhà phân phối?",
        "Hệ thống hiện tại theo dõi đơn hàng và hàng tồn kho như thế nào?",
        "Quy mô nhân sự tổng thể của doanh nghiệp là bao nhiêu?",
      ],
      policyStatus: "CAN_XAC_NHAN_LAI",
      suggestedCta: "Hẹn khảo sát quy trình quản lý kênh phân phối (DMS) và quy trình hợp đồng điện tử vContract.",
    };
  }

  // Fallback: Default to NEW_ESTABLISHED or standard SME inquiry
  return {
    segment: CustomerSegment.NEW_ESTABLISHED,
    recommendedServices: ["VIETTEL_CA", "HOA_DON_DIEN_TU", "FTTH"],
    screeningQuestions: [
      "Doanh nghiệp đang sử dụng các dịch vụ số cơ bản (chữ ký số, hóa đơn điện tử) của đơn vị nào?",
      "Quy mô nhân sự hiện tại của công ty là bao nhiêu?",
    ],
    policyStatus: "CAN_XAC_NHAN_LAI",
    suggestedCta: "Liên hệ tìm hiểu nhu cầu hạ tầng số và giải pháp Viettel SME.",
  };
}
