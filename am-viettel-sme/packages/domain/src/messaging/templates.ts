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

export function renderTemplate(template: MessageTemplate, vars: TemplateVariables): string {
  return template.body.replace(PLACEHOLDER, (_match, key: string) => {
    const value = (vars as unknown as Record<string, string | undefined>)[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return value.trim();
  });
}

