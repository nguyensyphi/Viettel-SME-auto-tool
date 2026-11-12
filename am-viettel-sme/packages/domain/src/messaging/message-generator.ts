import {
  evaluateContactTaskEligibility,
  type ContactTaskEligibilityInput,
  type ContactTaskBlockReason,
} from "../contactability/policy.js";
import type { AmConfirmedProfile } from "../review/am-confirmation.js";
import {
  defaultTemplateFor,
  getTemplate,
  renderTemplate,
  type MessageTemplate,
  type TemplateChannel,
} from "./templates.js";

export type OutreachChannel = TemplateChannel;

export interface AmProfile {
  fullName: string;
  title: string;
  phoneNumber: string;
}

export interface OutreachMessageRequest {
  channel: OutreachChannel;
  businessName: string;
  contactName?: string | undefined;
  serviceOffering: string;
  amProfile: AmProfile;
  eligibilityInput: ContactTaskEligibilityInput;
  /** Required: engine suggestions are never used without AM confirmation. */
  amConfirmation?: AmConfirmedProfile | undefined;
  templateId?: string | undefined;
}

export type OutreachBlockReason =
  | ContactTaskBlockReason
  | "AM_CONFIRMATION_MISSING"
  | "SERVICE_NOT_CONFIRMED";

export type OutreachMessageResult =
  | {
      allowed: true;
      messageText: string;
      channel: OutreachChannel;
      templateId: string;
      approvalStatus: MessageTemplate["approvalStatus"];
    }
  | { allowed: false; blockReason: OutreachBlockReason };

const SERVICE_NAMES: Record<string, string> = {
  VIETTEL_CA: "Chữ ký số Viettel CA",
  HOA_DON_DIEN_TU: "Hóa đơn điện tử",
  VTRACKING: "giám sát hành trình vTracking",
  CAMERA_ND10: "camera giám sát phương tiện",
  FTTH: "Internet cáp quang doanh nghiệp",
  TENDOO: "quản lý bán hàng Tendoo",
  EASYBOOKS: "kế toán EasyBooks",
  MYSIGN: "ký số từ xa MySign",
  VCONTRACT: "hợp đồng điện tử vContract",
  DMS_4_0: "quản lý kênh phân phối DMS",
  OFFICE_1: "quản trị doanh nghiệp 1Office",
  M2M_IOT: "kết nối thiết bị M2M/IoT",
  VOICE_BRANDNAME: "cuộc gọi thương hiệu Voice Brandname",
  DI_DONG_TRA_SAU: "gói cước di động trả sau doanh nghiệp",
  VBHXH: "kê khai Bảo hiểm xã hội điện tử vBHXH",
  EASY_HRM: "quản trị nhân sự EasyHRM",
  VOFFICE: "văn phòng điện tử vOffice",
};

/**
 * Produces a DRAFT message for AM review. Never sends. Gate order:
 * 1) contactability (fail-closed, opt-out always wins), 2) AM confirmation.
 */
export function generateOutreachMessage(
  request: OutreachMessageRequest,
): OutreachMessageResult {
  const eligibility = evaluateContactTaskEligibility(request.eligibilityInput);
  if (!eligibility.allowed) {
    return { allowed: false, blockReason: eligibility.reason };
  }

  if (!request.amConfirmation || request.amConfirmation.source !== "AM_CONFIRMED") {
    return { allowed: false, blockReason: "AM_CONFIRMATION_MISSING" };
  }

  if (!request.amConfirmation.services.includes(request.serviceOffering)) {
    return { allowed: false, blockReason: "SERVICE_NOT_CONFIRMED" };
  }

  const template = request.templateId
    ? getTemplate(request.templateId)
    : defaultTemplateFor(request.channel);
  if (template.channel !== request.channel) {
    throw new Error(
      `Template ${template.templateId} is for channel ${template.channel}, not ${request.channel}`,
    );
  }

  const messageText = renderTemplate(template, {
    contactGreeting: request.contactName?.trim() || "Quý khách",
    businessName: request.businessName,
    serviceName: SERVICE_NAMES[request.serviceOffering] ?? "chuyển đổi số doanh nghiệp",
    amName: request.amProfile.fullName,
    amTitle: request.amProfile.title,
    amPhone: request.amProfile.phoneNumber,
  });

  return {
    allowed: true,
    messageText,
    channel: request.channel,
    templateId: template.templateId,
    approvalStatus: template.approvalStatus,
  };
}

export interface ZaloOutreachRenderInput {
  templateCode: "ZALO_DNMTL_INTRO_V1" | "ZALO_ACCOUNTING_PARTNER_V1" | string;
  variables: {
    companyName: string;
    representativeName?: string | undefined;
    amName: string;
    amPhone: string;
    suggestedProducts?: readonly string[] | undefined;
    province?: string | undefined;
  };
}

const SENSITIVE_PII_PATTERN =
  /(?:\b(?:cccd|cmnd|căn\s*cước|chứng\s*minh)\b[^\n\r]{0,25}\b\d{9,12}\b|\b0\d{11}\b|\b(?:sn|sinh\s*ngày|ngày\s*sinh|dob|birthdate)\b[^\n\r]{0,20}\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)/iu;

export function renderZaloOutreachMessage(
  input: ZaloOutreachRenderInput,
): { content: string; templateCode: string } {
  const combinedText = `${input.variables.companyName} ${input.variables.representativeName ?? ""} ${input.variables.amName}`;
  if (SENSITIVE_PII_PATTERN.test(combinedText)) {
    throw new Error(
      "PII_DETECTED: Outreach message inputs must never embed CCCD/CMND personal identifiers",
    );
  }

  const template = getTemplate(input.templateCode);
  const greeting = input.variables.representativeName?.trim() || "anh/chị";

  let content = template.body
    .replace(/\{contactGreeting\}/g, greeting)
    .replace(/\{companyName\}/g, input.variables.companyName.trim())
    .replace(/\{amName\}/g, input.variables.amName.trim())
    .replace(/\{amPhone\}/g, input.variables.amPhone.trim())
    .replace(/\{province\}/g, input.variables.province?.trim() ?? "TP.HCM");

  if (input.variables.suggestedProducts && input.variables.suggestedProducts.length > 0) {
    content = content.replace(
      /\{product_name\}/g,
      input.variables.suggestedProducts.join(", "),
    );
  }

  return {
    content,
    templateCode: template.templateId,
  };
}

