import { describe, it, expect } from "vitest";
import {
  classifyCustomerLead,
  CustomerSegment,
  type CustomerLeadInput,
} from "../src/classification/customer-classifier.js";

describe("Customer Classification Engine (M01-05)", () => {
  it("classifies newly established businesses (< 1 year or new tax registration) into NEW_ESTABLISHED segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "0109998881",
      businessName: "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ ALPHA",
      establishedYear: new Date().getFullYear(),
      industry: "Hoạt động dịch vụ công nghệ thông tin",
      isNewlyEstablished: true,
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.NEW_ESTABLISHED);
    expect(result.recommendedServices).toContain("VIETTEL_CA");
    expect(result.recommendedServices).toContain("HOA_DON_DIEN_TU");
    expect(result.screeningQuestions.length).toBeGreaterThan(0);
    expect(result.policyStatus).toBe("CAN_XAC_NHAN_LAI");
  });

  it("classifies retail, restaurant, and FnB businesses into RETAIL_FNB segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "0301122334",
      businessName: "NHÀ HÀNG BIỂN XANH",
      industry: "Dịch vụ phục vụ đồ uống, ăn uống",
      numberOfBranches: 2,
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.RETAIL_FNB);
    expect(result.recommendedServices).toContain("HOA_DON_DIEN_TU");
    expect(result.recommendedServices).toContain("FTTH");
    expect(result.recommendedServices).toContain("TENDOO");
  });

  it("classifies transport, delivery, and fleet businesses into LOGISTICS_TRANSPORT segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "3702233445",
      businessName: "CÔNG TY CP VẬN TẢI BÌNH DƯƠNG LOGISTICS",
      industry: "Vận tải hàng hóa bằng đường bộ, kho bãi",
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.LOGISTICS_TRANSPORT);
    expect(result.recommendedServices).toContain("VTRACKING");
    expect(result.recommendedServices).toContain("CAMERA_ND10");
    expect(result.recommendedServices).toContain("M2M_IOT");
  });

  it("classifies manufacturing and distribution companies into MANUFACTURING_DISTRIBUTION segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "3603344556",
      businessName: "CÔNG TY SẢN XUẤT VÀ PHÂN PHỐI ĐỒ GIA DỤNG MINH PHÁT",
      industry: "Sản xuất và phân phối hàng tiêu dùng FMCG",
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.MANUFACTURING_DISTRIBUTION);
    expect(result.recommendedServices).toContain("DMS_4_0");
    expect(result.recommendedServices).toContain("OFFICE_1");
    expect(result.recommendedServices).toContain("VCONTRACT");
  });

  it("classifies accounting firms, consulting, and finance into PROFESSIONAL_SERVICES segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "0104455667",
      businessName: "CÔNG TY TNHH ĐẠI LÝ THUẾ VÀ KẾ TOÁN TẬN TÂM",
      industry: "Hoạt động kế toán, kiểm toán và tư vấn thuế",
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.PROFESSIONAL_SERVICES);
    expect(result.recommendedServices).toContain("EASYBOOKS");
    expect(result.recommendedServices).toContain("MYSIGN");
  });

  it("classifies household businesses and micro enterprises into MICRO_INDIVIDUAL segment", () => {
    const lead: CustomerLeadInput = {
      taxCode: "8001122334",
      businessName: "HỘ KINH DOANH VĂN PHÒNG PHẨM BẢO NGỌC",
      isHouseholdBusiness: true,
    };

    const result = classifyCustomerLead(lead);

    expect(result.segment).toBe(CustomerSegment.MICRO_INDIVIDUAL);
    expect(result.recommendedServices).toContain("VIETTEL_CA");
    expect(result.recommendedServices).toContain("FTTH");
  });

  it("never infers headcount from charter capital (Master Plan safety constraint)", () => {
    const lead: CustomerLeadInput = {
      taxCode: "0105566778",
      businessName: "CÔNG TY CỔ PHẦN ĐẦU TƯ TÀI CHÍNH ABC",
      industry: "Đầu tư tài chính",
      charterCapitalVnd: 50_000_000_000, // 50 Billion VND charter capital
    };

    const result = classifyCustomerLead(lead);

    // Capital must not set inferred headcount
    expect(result.inferredHeadcount).toBeUndefined();
    expect(result.screeningQuestions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/nhân viên|quy mô|headcount/i),
      ]),
    );
  });

  it("prioritizes specific vertical industry (e.g. newly established Logistics or FnB) over generic NEW_ESTABLISHED while including starter CA/Sinvoice", () => {
    const newLogistics = classifyCustomerLead({
      taxCode: "3709991112",
      businessName: "CÔNG TY TNHH VẬN TẢI MỚI BÌNH DƯƠNG",
      establishedYear: new Date().getFullYear(),
      industry: "Vận tải hàng hóa bằng đường bộ",
      isNewlyEstablished: true,
    });

    expect(newLogistics.segment).toBe(CustomerSegment.LOGISTICS_TRANSPORT);
    expect(newLogistics.recommendedServices).toContain("VTRACKING");
    expect(newLogistics.recommendedServices).toContain("VIETTEL_CA");
  });
});
