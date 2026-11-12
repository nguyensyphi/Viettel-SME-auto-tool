export type TemplateChannel = "SMS" | "ZALO" | "EMAIL" | "CALL_SCRIPT";

export interface TemplateVariables {
  contactGreeting: string;
  businessName: string;
  serviceName: string;
  amName: string;
  amTitle: string;
  amPhone: string;
}

export interface MessageTemplate {
  templateId: string;
  channel: TemplateChannel;
  purpose: string;
  /** All templates are drafts until legal/compliance approves the wording. */
  approvalStatus: "DRAFT_PENDING_COMPLIANCE";
  body: string;
}

/**
 * Draft templates. Rules:
 * - No price, promotion or "free" claims while policies are CAN_XAC_NHAN_LAI.
 * - Every written message carries an opt-out instruction (reply TU CHOI).
 * - No hard-coded opt-out shortcode; replace only with a compliance-approved one.
 * - Only business-level identity; never personal IDs or birth dates.
 */
export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
  {
    templateId: "SMS_INTRO_V1",
    channel: "SMS",
    purpose: "Giới thiệu lần đầu ngắn gọn",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Viettel kinh gui {businessName}: AM {amName} xin phep gioi thieu giai phap {serviceName}. " +
      "Can tu van, vui long goi {amPhone}. Tra loi TU CHOI de ngung nhan tin.",
  },
  {
    templateId: "SMS_APPOINTMENT_V1",
    channel: "SMS",
    purpose: "Xin lịch hẹn tư vấn",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Viettel kinh gui {businessName}: AM {amName} mong duoc hen 15 phut trao doi ve {serviceName} " +
      "theo thoi gian thuan tien cua Quy khach. LH {amPhone}. Tra loi TU CHOI de ngung nhan tin.",
  },
  {
    templateId: "ZALO_INTRO_V1",
    channel: "ZALO",
    purpose: "Giới thiệu lần đầu qua Zalo",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Kính gửi {contactGreeting} - {businessName},\n\n" +
      "Em là {amName}, {amTitle}. Em xin phép chia sẻ thông tin về giải pháp {serviceName} " +
      "để {contactGreeting} tham khảo khi doanh nghiệp có nhu cầu.\n\n" +
      "Nếu thuận tiện, em xin một buổi trao đổi ngắn để hiểu rõ quy trình hiện tại của doanh nghiệp " +
      "trước khi đề xuất phương án phù hợp.\n\n" +
      "Trân trọng,\n{amName} - {amTitle}\nĐiện thoại/Zalo: {amPhone}\n\n" +
      "Nếu không muốn nhận thêm thông tin, {contactGreeting} vui lòng trả lời TỪ CHỐI.",
  },
  {
    templateId: "ZALO_FOLLOWUP_V1",
    channel: "ZALO",
    purpose: "Nhắc lại sau lần liên hệ trước (chỉ khi khách chưa từ chối)",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Kính gửi {contactGreeting} - {businessName},\n\n" +
      "Em là {amName} (Viettel). Em xin phép hỏi lại {contactGreeting} đã có thời gian xem thông tin " +
      "về {serviceName} em gửi trước đó chưa ạ? Nếu cần, em có thể gửi tài liệu chi tiết hoặc hẹn " +
      "trao đổi trực tiếp.\n\n" +
      "Trân trọng,\n{amName} - {amPhone}\n\n" +
      "Nếu không muốn nhận thêm thông tin, {contactGreeting} vui lòng trả lời TỪ CHỐI.",
  },
  {
    templateId: "EMAIL_INTRO_V1",
    channel: "EMAIL",
    purpose: "Email giới thiệu chính thức",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Kính gửi {contactGreeting} - {businessName},\n\n" +
      "Tôi là {amName}, {amTitle}. Tôi xin gửi tới Quý doanh nghiệp thông tin về giải pháp {serviceName} " +
      "của Viettel.\n\n" +
      "Để đề xuất phương án sát với nhu cầu, tôi mong được trao đổi ngắn về quy trình hiện tại của doanh nghiệp. " +
      "Bảng giá và điều kiện áp dụng sẽ được gửi sau khi xác nhận theo chính sách hiện hành.\n\n" +
      "Trân trọng,\n{amName}\n{amTitle}\nĐiện thoại: {amPhone}\n\n" +
      "---\nNếu không muốn nhận email tiếp theo, vui lòng trả lời email này với nội dung TỪ CHỐI.",
  },
  {
    templateId: "CALL_SCRIPT_INTRO_V1",
    channel: "CALL_SCRIPT",
    purpose: "Kịch bản gọi điện lần đầu cho AM",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "[Chào hỏi] Kính chào {contactGreeting}, em là {amName}, {amTitle}. " +
      "Em gọi để giới thiệu ngắn về giải pháp {serviceName} cho {businessName}. " +
      "{contactGreeting} có tiện nghe máy khoảng 2 phút không ạ?\n" +
      "[Nếu không tiện] Dạ em cảm ơn, em xin phép gọi lại vào lúc khác thuận tiện hơn.\n" +
      "[Nếu không muốn nhận] Dạ em ghi nhận và sẽ ngừng liên hệ. Em cảm ơn {contactGreeting}.\n" +
      "[Câu hỏi sàng lọc] Hiện doanh nghiệp đang xử lý nghiệp vụ liên quan bằng giải pháp nào ạ?",
  },
  {
    templateId: "ZALO_DNMTL_INTRO_V1",
    channel: "ZALO",
    purpose: "Chào doanh nghiệp mới thành lập (DNMTL): Chữ ký số Viettel-CA, Hóa đơn điện tử S-Invoice",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Em chào {contactGreeting}, em là {amName} từ Viettel.\n\n" +
      "Em thấy {companyName} mới thành lập nên muốn kết nối để hỗ trợ doanh nghiệp các giải pháp số hóa như chữ ký số, hóa đơn điện tử và hợp đồng điện tử.\n\n" +
      "Nếu anh/chị đang cần tìm hiểu hoặc triển khai các dịch vụ này, em có thể gửi thông tin và tư vấn giải pháp phù hợp với nhu cầu của công ty mình ạ.\n\n" +
      "Rất mong được kết nối và hỗ trợ anh/chị!\n" +
      "Liên hệ AM Viettel: {amPhone}\n\n" +
      "(Nếu không muốn nhận tin nhắn, vui lòng nhắn TỪ CHỐI)",
  },
  {
    templateId: "ZALO_ACCOUNTING_PARTNER_V1",
    channel: "ZALO",
    purpose: "Mời hợp tác đối tác kế toán, thuế và CTV giới thiệu dịch vụ Viettel SME",
    approvalStatus: "DRAFT_PENDING_COMPLIANCE",
    body:
      "Em chào {contactGreeting}, em là {amName} từ Viettel.\n\n" +
      "Bên em đang triển khai các giải pháp chữ ký số và hóa đơn điện tử dành cho doanh nghiệp, đồng thời có chính sách hợp tác dành cho các đơn vị kế toán và đối tác giới thiệu khách hàng.\n\n" +
      "Em muốn kết nối để gửi anh/chị thông tin sản phẩm và chính sách hợp tác cụ thể cho {companyName}. Nếu phù hợp, hy vọng hai bên có thể cùng phối hợp lâu dài ạ.\n\n" +
      "Liên hệ AM Viettel: {amPhone}\n\n" +
      "(Nếu không muốn nhận tin nhắn, vui lòng nhắn TỪ CHỐI)",
  },
];

const PLACEHOLDER = /\{(\w+)\}/g;

export function getTemplate(templateId: string): MessageTemplate {
  const template = MESSAGE_TEMPLATES.find((t) => t.templateId === templateId);
  if (!template) {
    throw new Error(`Unknown templateId: ${templateId}`);
  }
  return template;
}

export function defaultTemplateFor(channel: TemplateChannel): MessageTemplate {
  const template = MESSAGE_TEMPLATES.find((t) => t.channel === channel);
  if (!template) {
    throw new Error(`No template for channel ${channel}`);
  }
  return template;
}

export function renderTemplate(
  template: MessageTemplate,
  vars: TemplateVariables & { companyName?: string },
): string {
  return template.body.replace(PLACEHOLDER, (_match, key: string) => {
    const map = vars as unknown as Record<string, string | undefined>;
    let value = map[key];
    if (key === "companyName" && !value) value = map.businessName;
    if (key === "businessName" && !value) value = map.companyName;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return value.trim();
  });
}

