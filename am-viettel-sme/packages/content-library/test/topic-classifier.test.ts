import { describe, expect, it } from "vitest";
import {
  TopicClassifier,
  STANDARD_TOPIC_CATALOG,
  type TopicClassificationResult,
} from "../src/topic-classifier.js";

describe("Topic Classification Engine (PB-003)", () => {
  const classifier = new TopicClassifier();

  it("recognizes standard topic codes with EXPLICIT_METADATA and 1.0 confidence", () => {
    const result = classifier.classify({
      title: "Bài viết chữ ký số",
      content: "Nội dung tổng quát",
      topic: "CHU_KY_SO",
    });

    expect(result.status).toBe("CLASSIFIED");
    expect(result.topic).toBe("CHU_KY_SO");
    expect(result.confidence).toBe(1.0);
    expect(result.classificationMethod).toBe("EXPLICIT_METADATA");
    expect(result.products).toContain("DIGITAL_SIGNATURE");
  });

  it("classifies S-Invoice content using RULE_BASED matching when topic is missing or AUTO", () => {
    const result = classifier.classify({
      title: "Lưu ý khi xuất hóa đơn điện tử cho doanh nghiệp mới",
      content: "Hóa đơn điện tử S-Invoice của Viettel đáp ứng Nghị định 123 và Thông tư 78.",
      topic: "AUTO",
    });

    expect(result.status).toBe("CLASSIFIED");
    expect(result.topic).toBe("HOA_DON_DIEN_TU");
    expect(result.classificationMethod).toBe("RULE_BASED");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.products).toContain("EINVOICE");
  });

  it("classifies Internet cáp quang FTTH using RULE_BASED matching", () => {
    const result = classifier.classify({
      title: "Lắp đặt internet cáp quang tốc độ cao cho văn phòng",
      content: "Gói cước FTTH Viettel cung cấp IP tĩnh và băng thông quốc tế ổn định.",
    });

    expect(result.status).toBe("CLASSIFIED");
    expect(result.topic).toBe("FTTH");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.products).toContain("FTTH_BROADBAND");
  });

  it("classifies vContract e-contract content", () => {
    const result = classifier.classify({
      title: "Ký kết từ xa với hợp đồng điện tử vContract",
      content: "Giải pháp vContract giúp doanh nghiệp ký hợp đồng không giấy tờ trong 5 phút.",
    });

    expect(result.status).toBe("CLASSIFIED");
    expect(result.topic).toBe("VCONTRACT");
    expect(result.products).toContain("ECONTRACT");
  });

  it("returns NEEDS_CLASSIFICATION when content cannot be matched with confidence", () => {
    const result = classifier.classify({
      title: "Một buổi sáng cà phê ngắm mưa",
      content: "Chào ngày mới mọi người, chúc một tuần làm việc vui vẻ.",
    });

    expect(result.status).toBe("NEEDS_CLASSIFICATION");
    expect(result.topic).toBe("NEEDS_CLASSIFICATION");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("includes all 10 official topics in STANDARD_TOPIC_CATALOG", () => {
    const codes = STANDARD_TOPIC_CATALOG.map((t) => t.code);
    expect(codes).toContain("CHU_KY_SO");
    expect(codes).toContain("HOA_DON_DIEN_TU");
    expect(codes).toContain("VCONTRACT");
    expect(codes).toContain("FTTH");
    expect(codes).toContain("DIGITAL_TRANSFORMATION");
    expect(codes).toContain("BUSINESS_KNOWLEDGE");
    expect(codes).toContain("AM_EXPERIENCE");
    expect(codes).toContain("CUSTOMER_SUPPORT");
    expect(codes).toContain("PERSONAL_ACTIVITY");
    expect(codes).toContain("GENERAL_BRANDING");
    expect(STANDARD_TOPIC_CATALOG).toHaveLength(10);
  });
});

