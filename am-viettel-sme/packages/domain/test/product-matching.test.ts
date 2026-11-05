import { describe, it, expect } from "vitest";
import {
  matchProductsForCustomer,
  type ProductMatchInput,
} from "../src/product-matching/matcher.js";
import { CustomerSegment } from "../src/classification/customer-classifier.js";

describe("Product Matching Engine (M01-06)", () => {
  it("matches Viettel CA and Sinvoice bundle for newly established business", () => {
    const input: ProductMatchInput = {
      segment: CustomerSegment.NEW_ESTABLISHED,
      businessNeeds: ["khai_thue", "xuat_hoa_don"],
    };

    const matches = matchProductsForCustomer(input);

    expect(matches.length).toBeGreaterThan(0);
    const serviceIds = matches.map((m) => m.serviceId);
    expect(serviceIds).toContain("VIETTEL_CA");
    expect(serviceIds).toContain("HOA_DON_DIEN_TU");

    // Must recommend starter bundle
    const caMatch = matches.find((m) => m.serviceId === "VIETTEL_CA");
    expect(caMatch?.bundleAvailable).toBe(true);
    expect(caMatch?.policyStatus).toBe("CAN_XAC_NHAN_LAI");
    expect(caMatch?.requiredConfirmations).toContain("Xác nhận bảng giá và ưu đãi bundle hiện hành");
  });

  it("matches vTracking and Camera ND10 for transport companies with fleet size", () => {
    const input: ProductMatchInput = {
      segment: CustomerSegment.LOGISTICS_TRANSPORT,
      fleetCount: 15,
      businessNeeds: ["dinh_vi_phuong_tien", "giam_sat_hinh_anh"],
    };

    const matches = matchProductsForCustomer(input);
    const serviceIds = matches.map((m) => m.serviceId);

    expect(serviceIds).toContain("VTRACKING");
    expect(serviceIds).toContain("CAMERA_ND10");

    const vtracking = matches.find((m) => m.serviceId === "VTRACKING");
    expect(vtracking?.painPointsAddressed).toEqual(
      expect.arrayContaining([expect.stringMatching(/hành trình|vị trí|nhiên liệu/i)]),
    );
  });

  it("matches Tendoo POS and e-invoice for retail/FnB stores", () => {
    const input: ProductMatchInput = {
      segment: CustomerSegment.RETAIL_FNB,
      businessNeeds: ["ban_hang", "may_tinh_tien"],
    };

    const matches = matchProductsForCustomer(input);
    const serviceIds = matches.map((m) => m.serviceId);

    expect(serviceIds).toContain("TENDOO");
    expect(serviceIds).toContain("HOA_DON_DIEN_TU");
  });

  it("matches EasyBooks and MySign for accounting and tax consulting firms", () => {
    const input: ProductMatchInput = {
      segment: CustomerSegment.PROFESSIONAL_SERVICES,
      businessNeeds: ["dich_vu_ke_toan", "ky_so_tu_xa"],
    };

    const matches = matchProductsForCustomer(input);
    const serviceIds = matches.map((m) => m.serviceId);

    expect(serviceIds).toContain("EASYBOOKS");
    expect(serviceIds).toContain("MYSIGN");
  });

  it("always attaches policy confirmation warnings to prevent quoting outdated guide tariffs", () => {
    const input: ProductMatchInput = {
      segment: CustomerSegment.NEW_ESTABLISHED,
    };

    const matches = matchProductsForCustomer(input);

    for (const match of matches) {
      expect(match.policyStatus).toBe("CAN_XAC_NHAN_LAI");
      expect(match.requiredConfirmations.length).toBeGreaterThan(0);
    }
  });

  it("supports full 17-product matrix catalog including DI_DONG_TRA_SAU, VBHXH, EASY_HRM, VOFFICE and responds to scale/businessNeeds signals", () => {
    const microMatches = matchProductsForCustomer({
      segment: CustomerSegment.MICRO_INDIVIDUAL,
      businessNeeds: ["di_dong", "bhxh"],
      employeeCount: 12,
    });
    const microIds = microMatches.map((m) => m.serviceId);
    expect(microIds).toContain("DI_DONG_TRA_SAU");
    expect(microIds).toContain("VBHXH");

    const enterpriseMatches = matchProductsForCustomer({
      segment: CustomerSegment.MANUFACTURING_DISTRIBUTION,
      employeeCount: 60,
      branchCount: 3,
      businessNeeds: ["nhan_su", "van_phong_dien_tu"],
    });
    const entIds = enterpriseMatches.map((m) => m.serviceId);
    expect(entIds).toContain("EASY_HRM");
    expect(entIds).toContain("VOFFICE");
  });
});
