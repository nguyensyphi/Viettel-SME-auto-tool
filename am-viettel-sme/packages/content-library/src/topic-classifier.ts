export interface TopicDefinition {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly defaultProducts: readonly string[];
  readonly keywords: readonly string[];
}

export interface TopicClassificationResult {
  readonly topic: string;
  readonly products: readonly string[];
  readonly confidence: number;
  readonly classificationMethod: "EXPLICIT_METADATA" | "RULE_BASED" | "FALLBACK";
  readonly status: "CLASSIFIED" | "NEEDS_CLASSIFICATION";
}

export const STANDARD_TOPIC_CATALOG: readonly TopicDefinition[] = [
  {
    code: "CHU_KY_SO",
    name: "Chữ ký số",
    description: "Giải pháp chữ ký số Viettel-CA, Cloud-CA và ký số từ xa.",
    defaultProducts: ["DIGITAL_SIGNATURE"],
    keywords: [
      "chữ ký số",
      "viettel-ca",
      "viettel ca",
      "usb token",
      "ký số",
      "token ca",
      "cloud ca",
      "ca viettel",
      "chữ ký điện tử",
    ],
  },
  {
    code: "HOA_DON_DIEN_TU",
    name: "Hóa đơn điện tử",
    description: "Giải pháp hóa đơn điện tử S-Invoice theo Nghị định 123 và Thông tư 78.",
    defaultProducts: ["EINVOICE"],
    keywords: [
      "hóa đơn điện tử",
      "s-invoice",
      "sinvoice",
      "thông tư 78",
      "nghị định 123",
      "xuất hóa đơn",
      "hóa đơn khởi tạo từ máy tính tiền",
    ],
  },
  {
    code: "VCONTRACT",
    name: "Hợp đồng điện tử",
    description: "Giải pháp hợp đồng điện tử vContract ký kết pháp lý không giấy tờ.",
    defaultProducts: ["ECONTRACT"],
    keywords: [
      "hợp đồng điện tử",
      "vcontract",
      "v-contract",
      "ký hợp đồng",
      "ký kết từ xa",
      "hợp đồng không giấy tờ",
    ],
  },
  {
    code: "FTTH",
    name: "Internet cáp quang",
    description: "Hạ tầng Internet cáp quang Viettel tốc độ cao, IP tĩnh dành cho doanh nghiệp.",
    defaultProducts: ["FTTH_BROADBAND"],
    keywords: [
      "internet cáp quang",
      "cáp quang",
      "ftth",
      "băng thông",
      "ip tĩnh",
      "wifi doanh nghiệp",
      "gói cước doanh nghiệp",
      "đường truyền internet",
    ],
  },
  {
    code: "DIGITAL_TRANSFORMATION",
    name: "Chuyển đổi số",
    description: "Giải pháp số hóa toàn diện quy trình kinh doanh SME.",
    defaultProducts: ["DIGITAL_TRANSFORMATION"],
    keywords: [
      "chuyển đổi số",
      "số hóa",
      "quy trình số",
      "erp",
      "crm doanh nghiệp",
      "tự động hóa doanh nghiệp",
    ],
  },
  {
    code: "BUSINESS_KNOWLEDGE",
    name: "Kiến thức doanh nghiệp",
    description: "Kiến thức thuế, kế toán, pháp lý và vận hành doanh nghiệp mới thành lập.",
    defaultProducts: [],
    keywords: [
      "doanh nghiệp mới",
      "thành lập doanh nghiệp",
      "kê khai thuế",
      "thuế môn bài",
      "mã số thuế",
      "kế toán",
      "pháp lý doanh nghiệp",
      "chi phí doanh nghiệp",
    ],
  },
  {
    code: "AM_EXPERIENCE",
    name: "Kinh nghiệm AM",
    description: "Chia sẻ kinh nghiệm thực tế của Account Manager trong tư vấn giải pháp.",
    defaultProducts: [],
    keywords: [
      "kinh nghiệm am",
      "tư vấn khách hàng",
      "chuyên viên am",
      "đồng hành cùng doanh nghiệp",
      "câu chuyện tư vấn",
      "kinh nghiệm thực chiến",
    ],
  },
  {
    code: "CUSTOMER_SUPPORT",
    name: "Chăm sóc khách hàng",
    description: "Hoạt động hỗ trợ kỹ thuật, chăm sóc và giải đáp thắc mắc khách hàng.",
    defaultProducts: [],
    keywords: [
      "chăm sóc khách hàng",
      "hỗ trợ kỹ thuật",
      "tổng đài viettel",
      "hotline viettel",
      "đồng hành hỗ trợ",
      "giải đáp thắc mắc",
    ],
  },
  {
    code: "PERSONAL_ACTIVITY",
    name: "Hoạt động cá nhân",
    description: "Hoạt động công việc cá nhân, tham gia sự kiện và đào tạo chuyên môn.",
    defaultProducts: [],
    keywords: [
      "hoạt động cá nhân",
      "sự kiện",
      "đào tạo",
      "workshop",
      "hội thảo",
      "teambuilding",
      "buổi tập huấn",
    ],
  },
  {
    code: "GENERAL_BRANDING",
    name: "Xây dựng thương hiệu",
    description: "Nội dung thương hiệu Viettel Solutions và giá trị cốt lõi.",
    defaultProducts: [],
    keywords: [
      "viettel solutions",
      "thương hiệu",
      "viettel telecom",
      "tập đoàn viettel",
      "giá trị thương hiệu",
      "sứ mệnh viettel",
    ],
  },
];

const topicByCode = new Map<string, TopicDefinition>(
  STANDARD_TOPIC_CATALOG.map((t) => [t.code, t]),
);

function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export class TopicClassifier {
  classify(input: {
    readonly title?: string | undefined;
    readonly content?: string | undefined;
    readonly topic?: string | undefined;
  }): TopicClassificationResult {
    const rawTopic = input.topic?.trim().toUpperCase();

    // 1. Check explicit metadata topic
    if (rawTopic && rawTopic !== "AUTO" && rawTopic !== "NEEDS_CLASSIFICATION") {
      const matched = topicByCode.get(rawTopic);
      if (matched) {
        return {
          topic: matched.code,
          products: matched.defaultProducts,
          confidence: 1.0,
          classificationMethod: "EXPLICIT_METADATA",
          status: "CLASSIFIED",
        };
      }
    }

    // 2. Rule-based keyword matching across title and content
    const combinedNormalized = normalizeText(
      `${input.title ?? ""} ${input.content ?? ""}`,
    );

    let bestTopic: TopicDefinition | null = null;
    let maxMatchCount = 0;

    for (const def of STANDARD_TOPIC_CATALOG) {
      let count = 0;
      for (const kw of def.keywords) {
        const normKw = normalizeText(kw);
        if (combinedNormalized.includes(normKw)) {
          count++;
        }
      }
      if (count > maxMatchCount) {
        maxMatchCount = count;
        bestTopic = def;
      }
    }

    if (bestTopic && maxMatchCount > 0) {
      const confidence = Math.min(0.95, 0.75 + maxMatchCount * 0.1);
      return {
        topic: bestTopic.code,
        products: bestTopic.defaultProducts,
        confidence,
        classificationMethod: "RULE_BASED",
        status: "CLASSIFIED",
      };
    }

    // 3. Fallback: Needs manual AM review
    return {
      topic: "NEEDS_CLASSIFICATION",
      products: [],
      confidence: 0.0,
      classificationMethod: "FALLBACK",
      status: "NEEDS_CLASSIFICATION",
    };
  }

  classifyPostTopic(input: {
    readonly title?: string | undefined;
    readonly content?: string | undefined;
    readonly topic?: string | undefined;
  }): TopicClassificationResult {
    return this.classify(input);
  }
}

